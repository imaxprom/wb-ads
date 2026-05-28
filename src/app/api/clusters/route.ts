import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// Ручная база кластеров. CRUD поверх таблицы manual_clusters.

interface ClusterRow {
  id: number;
  name: string;
  phrases_json: string;
  created_at: string;
  updated_at: string;
  source: string | null;
  mpstats_preset_id: number | null;
  preset_id: number | null;
  imported_at: string | null;
}

function parsePhrases(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

// GET /api/clusters — список всех кластеров с total_frequency из search_texts_wb
export async function GET() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, name, phrases_json, created_at, updated_at,
           source, mpstats_preset_id, preset_id, imported_at
    FROM manual_clusters ORDER BY id
  `).all() as ClusterRow[];

  // Готовим фрекси — берём самый свежий snapshot_date (последний доступный день).
  const wbFreqRows = db.prepare(`
    SELECT phrase_lc, frequency
    FROM search_texts_wb
    WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM search_texts_wb)
  `).all() as { phrase_lc: string; frequency: number }[];
  const freqMap = new Map(wbFreqRows.map((r) => [r.phrase_lc, r.frequency]));

  const out = rows.map((r) => {
    const phrases = parsePhrases(r.phrases_json);
    // Имя кластера тоже учитывается в суммарной frequency
    const uniqLc = new Set<string>([r.name.trim().toLowerCase()]);
    for (const p of phrases) uniqLc.add(p.trim().toLowerCase());
    let totalFrequency = 0;
    for (const lc of uniqLc) totalFrequency += freqMap.get(lc) ?? 0;
    return {
      id: r.id,
      name: r.name,
      phrases,
      phrasesCount: phrases.length,
      totalFrequency,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      source: r.source || "manual",
      mpstatsPresetId: r.mpstats_preset_id ?? null,
      presetId: r.preset_id ?? null,
      importedAt: r.imported_at ?? null,
    };
  });

  return NextResponse.json({ ok: true, clusters: out });
}

// POST /api/clusters — создать кластер {name, phrases: string[]}
export async function POST(request: NextRequest) {
  const db = getDb();
  const body = await request.json().catch(() => null) as { name?: string; phrases?: string[] } | null;
  const name = (body?.name || "").trim();
  // Фразы сохраняем как есть — только фильтр пустых. Пользователь сам решает, что и как разделять.
  const phrases = Array.isArray(body?.phrases)
    ? body!.phrases.map((p) => String(p)).filter((p) => p.trim())
    : [];

  if (!name) return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });

  try {
    const r = db.prepare(`
      INSERT INTO manual_clusters (name, phrases_json, created_at, updated_at)
      VALUES (?, ?, datetime('now'), datetime('now'))
    `).run(name, JSON.stringify(phrases));
    return NextResponse.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ ok: false, error: "cluster with this name already exists" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// POST /api/clusters/bulk-import — массовый импорт
// Убрано: держим отдельный endpoint /api/clusters/bulk (если понадобится, добавим).
