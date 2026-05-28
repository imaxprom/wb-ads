import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Автоимпорт кластеров из MPSTATS Seo API.
// POST /api/sync/mpstats-clusters
//   { nmId: 165140159, limit?: 20 }        — топ-N фраз из search_texts_wb для subject товара
//   { subjectId: 133, limit?: 20 }         — явный выбор предмета
//   { keyword: "трусы женские" }           — одиночный импорт по фразе
//
// Для каждой входной фразы дёргаем MPSTATS /api/seo/keywords/cluster.
// Ответ содержит массив variants (preset, norm_query, word, wb_count, norm_query_count, freq_365).
// Группируем по preset → один preset = один кластер в manual_clusters (UPSERT по mpstats_preset_id).

const MPSTATS_URL = "https://mpstats.io/api/seo/keywords/cluster";

interface MpstatsVariant {
  preset: number;
  norm_query: string;
  word: string;
  wb_count: number;
  norm_query_count: number;
  freq_365?: number;
}

interface ClusterAgg {
  preset: number;
  norm_query: string;
  phrases: Set<string>;
  totalFreq: number; // sum of wb_count across variants (= norm_query_count)
}

async function callMpstats(token: string, keyword: string): Promise<{ variants: MpstatsVariant[]; status: number; error?: string }> {
  try {
    const res = await fetch(MPSTATS_URL, {
      method: "POST",
      headers: {
        "X-Mpstats-TOKEN": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ keywords: [keyword], type: "keywords", filter: "" }),
    });
    const text = await res.text();
    if (!res.ok) return { variants: [], status: res.status, error: text.slice(0, 200) };
    let data: { result?: MpstatsVariant[] };
    try { data = JSON.parse(text); } catch { return { variants: [], status: res.status, error: "parse" }; }
    return { variants: data.result || [], status: res.status };
  } catch (err) {
    return { variants: [], status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const body = await request.json().catch(() => null) as { nmId?: number; subjectId?: number; limit?: number; keyword?: string } | null;
  if (!body) return NextResponse.json({ ok: false, error: "body required" }, { status: 400 });

  // 1. Получаем токен MPSTATS
  const tokenRow = db.prepare("SELECT value FROM settings WHERE key = 'mpstats_api_token'").get() as { value: string } | undefined;
  const token = tokenRow?.value?.trim() || "";
  if (!token) return NextResponse.json({ ok: false, error: "mpstats_api_token не задан в настройках" }, { status: 400 });

  // 2. Собираем входной список фраз
  let inputKeywords: string[];
  if (body.keyword) {
    inputKeywords = [body.keyword.trim()].filter(Boolean);
  } else {
    let subjectId: number | null = null;
    if (body.subjectId) {
      subjectId = body.subjectId;
    } else if (body.nmId) {
      // subject_id для товара — из products (если есть) или из активных кампаний
      const subjRow = db.prepare(`
        SELECT c.subject_id
        FROM campaigns c
        WHERE c.subject_id IS NOT NULL
          AND c.nms_json LIKE ?
        LIMIT 1
      `).get(`%${body.nmId}%`) as { subject_id: number } | undefined;
      subjectId = subjRow?.subject_id ?? null;
    }
    if (!subjectId) return NextResponse.json({ ok: false, error: "не удалось определить subject_id (передай subjectId или keyword)" }, { status: 400 });

    const limit = Math.max(1, Math.min(50, body.limit ?? 20));
    const rows = db.prepare(`
      SELECT phrase_raw FROM search_texts_wb
      WHERE subject_id = ?
        AND snapshot_date = (SELECT MAX(snapshot_date) FROM search_texts_wb WHERE subject_id = ?)
      ORDER BY frequency DESC
      LIMIT ?
    `).all(subjectId, subjectId, limit) as { phrase_raw: string }[];
    inputKeywords = rows.map((r) => r.phrase_raw).filter(Boolean);
    if (inputKeywords.length === 0) return NextResponse.json({ ok: false, error: "нет фраз в search_texts_wb для этого subject_id" }, { status: 400 });
  }

  // 3. Последовательно (с gap) дёргаем MPSTATS по каждой фразе, агрегируем по preset
  const aggByPreset = new Map<number, ClusterAgg>();
  const failed: { keyword: string; status: number; error?: string }[] = [];
  const gapMs = 600;

  for (let i = 0; i < inputKeywords.length; i++) {
    const kw = inputKeywords[i];
    const r = await callMpstats(token, kw);
    if (r.variants.length === 0) {
      failed.push({ keyword: kw, status: r.status, error: r.error });
    } else {
      for (const v of r.variants) {
        if (!v.preset || !v.word) continue;
        let agg = aggByPreset.get(v.preset);
        if (!agg) {
          agg = { preset: v.preset, norm_query: v.norm_query, phrases: new Set<string>(), totalFreq: v.norm_query_count || 0 };
          aggByPreset.set(v.preset, agg);
        }
        agg.phrases.add(v.word);
      }
    }
    if (i < inputKeywords.length - 1) await new Promise((res) => setTimeout(res, gapMs));
  }

  // 4. UPSERT в manual_clusters. Приоритет matching'а: сначала mpstats_preset_id (идемпотентно).
  //    Если уже есть ручной кластер с тем же name — не трогаем (пользователь мог сделать «сделать своим»
  //    и mpstats_preset_id обнулён; ре-импорт создаст второй кластер с таким же name → UNIQUE(name) выкинет ошибку,
  //    которую ловим ниже и репортим как skipped).
  const created: { preset: number; name: string; phrasesCount: number }[] = [];
  const updated: { preset: number; name: string; phrasesCount: number }[] = [];
  const skipped: { preset: number; name: string; reason: string }[] = [];

  const selectByPreset = db.prepare("SELECT id FROM manual_clusters WHERE mpstats_preset_id = ?");
  const updateStmt = db.prepare(`
    UPDATE manual_clusters
    SET phrases_json = ?, updated_at = datetime('now'), imported_at = datetime('now')
    WHERE id = ?
  `);
  // Пишем preset одновременно в mpstats_preset_id (метка источника) и preset_id (унифицированное
  // поле, по которому теперь работает основная логика). Оба UNIQUE INDEX'а должны устоять —
  // mpstats-импорт идемпотентен per preset.
  const insertStmt = db.prepare(`
    INSERT INTO manual_clusters (name, phrases_json, source, mpstats_preset_id, preset_id, imported_at, created_at, updated_at)
    VALUES (?, ?, 'mpstats', ?, ?, datetime('now'), datetime('now'), datetime('now'))
  `);

  for (const agg of aggByPreset.values()) {
    const phrases = Array.from(agg.phrases);
    const payload = JSON.stringify(phrases);
    const name = agg.norm_query;

    const existing = selectByPreset.get(agg.preset) as { id: number } | undefined;
    if (existing) {
      updateStmt.run(payload, existing.id);
      updated.push({ preset: agg.preset, name, phrasesCount: phrases.length });
      continue;
    }
    try {
      insertStmt.run(name, payload, agg.preset, agg.preset);
      created.push({ preset: agg.preset, name, phrasesCount: phrases.length });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Скорее всего UNIQUE(name) — уже есть ручной кластер с таким именем.
      skipped.push({ preset: agg.preset, name, reason: msg.includes("UNIQUE") ? "имя занято ручным кластером" : msg });
    }
  }

  return NextResponse.json({
    ok: true,
    inputKeywords: inputKeywords.length,
    clustersFound: aggByPreset.size,
    created,
    updated,
    skipped,
    failed,
  });
}
