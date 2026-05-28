import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { auditMutation, checkRateLimit, rateLimitKey } from "@/lib/security";
import { callWbParserPositions, type WbParserRpcResponse } from "@/lib/wb-parser-rpc";

export const dynamic = "force-dynamic";
export const maxDuration = 1800; // 30 минут — большие кампании могут идти долго

// Авто-кластеризация фраз кампании по реальным WB-preset через wb-parser SSH.
//
// Алгоритм (см. ТЗ):
// 1. Берём все canonical нормфразы кампании из campaign_preset_keywords.
// 2. Чанкуем по nm_id (SSH-RPC принимает per-article).
// 3. Multi-pass до 10 попыток: упавшие фразы повторяем, пока не успешные или 10 проходов.
// 4. Группируем успешные {phrase: real_preset_id} по preset_id.
// 5. Для каждого preset_id в одной транзакции:
//    - target = manual_cluster WHERE preset_id = M
//    - есть → добавляем недостающие фразы, удаляем эти же из всех остальных кластеров.
//    - нет → создаём (source='manual', preset_id=M, name=материнская фраза по freq).
//    - после прохода удаляем кластеры с пустым phrases_json.
//
// Прогресс — globalThis.__scanCampaignProgress[advertId]; читается через GET.

interface ScanProgress {
  total: number;
  scanned: number;       // успешно получили preset_id
  failed: number;        // всего фраз, упавших ВСЁ время (после всех попыток)
  pass: number;          // текущий проход (0..MAX_PASSES)
  running: boolean;
  startedAt: string;
  finishedAt: string | null;
  summary: {
    clustersCreated: number;
    clustersUpdated: number;
    clustersDeleted: number;
    phrasesMoved: number;
  } | null;
  error: string | null;
}

const g = globalThis as unknown as {
  __scanCampaignProgress?: Record<number, ScanProgress>;
  __scanCampaignLocks?: Set<number>;
};

if (!g.__scanCampaignProgress) g.__scanCampaignProgress = {};
if (!g.__scanCampaignLocks) g.__scanCampaignLocks = new Set();

const MAX_PASSES = 10;
const PASS_DELAY_MS = 2500;
const CHUNK_SIZE = 50;

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function sshBatch(article: number, keywords: string[]): Promise<WbParserRpcResponse> {
  return callWbParserPositions(article, keywords);
}

export async function GET(request: NextRequest) {
  const advertId = Number(request.nextUrl.searchParams.get("advertId"));
  if (!advertId) return NextResponse.json({ ok: false, error: "advertId required" }, { status: 400 });
  const p = g.__scanCampaignProgress?.[advertId] || null;
  return NextResponse.json({ ok: true, progress: p });
}

export async function POST(request: NextRequest) {
  const advertId = Number(request.nextUrl.searchParams.get("advertId"));
  if (!advertId) return NextResponse.json({ ok: false, error: "advertId required" }, { status: 400 });

  const rl = checkRateLimit(rateLimitKey(request, "scan-campaign", advertId), 2, 60 * 60 * 1000);
  if (!rl.ok) {
    auditMutation(request, {
      action: "scan-campaign",
      targetType: "advert",
      targetId: advertId,
      status: "blocked",
      details: { reason: "rate_limit", retryAfterSec: rl.retryAfterSec },
    });
    return NextResponse.json({ ok: false, error: "rate limit", retryAfterSec: rl.retryAfterSec }, { status: 429 });
  }
  auditMutation(request, { action: "scan-campaign", targetType: "advert", targetId: advertId, status: "accepted" });

  // Авто-сброс залипшего lock'а (Next.js hot-reload в dev мог убить scan-handler на середине,
  // оставив lock=true но без живого процесса). Если последний прогресс старше 15 мин и
  // помечен running — считаем сдохшим и снимаем lock.
  if (g.__scanCampaignLocks!.has(advertId)) {
    const stale = g.__scanCampaignProgress?.[advertId];
    const now = Date.now();
    const startedMs = stale?.startedAt ? new Date(stale.startedAt).getTime() : 0;
    const ageMin = startedMs > 0 ? (now - startedMs) / 60000 : 999;
    if (stale?.running && ageMin > 15) {
      g.__scanCampaignLocks!.delete(advertId);
      if (g.__scanCampaignProgress?.[advertId]) {
        g.__scanCampaignProgress[advertId].running = false;
        g.__scanCampaignProgress[advertId].error = "stale lock cleared (likely hot-reload kill)";
      }
    } else {
      return NextResponse.json({ ok: false, error: "scan already running for this advert" }, { status: 409 });
    }
  }

  const body = await request.json().catch(() => null) as { phrases?: string[] } | null;
  const explicitPhrases = Array.isArray(body?.phrases)
    ? body!.phrases.map((p) => String(p)).filter((p) => p.trim())
    : null;

  const db = getDb();

  // 1. Список (nm_id, phrase). Если клиент передал список фраз — сканируем их (UI шлёт тот
  // набор, что виден сейчас под активным фильтром: Управляемые / Активные / Исключения / Все).
  // Иначе — fallback: все фразы из campaign_preset_keywords. nm_id для SSH берём из campaign.nms_json[0].
  let phraseRows: { nm_id: number; phrase: string }[];
  if (explicitPhrases) {
    const camp = db.prepare(`SELECT nms_json FROM campaigns WHERE advert_id = ?`).get(advertId) as { nms_json: string | null } | undefined;
    let firstNmId: number | null = null;
    try {
      const nms = JSON.parse(camp?.nms_json || "[]") as number[];
      if (Array.isArray(nms) && nms.length > 0) firstNmId = Number(nms[0]) || null;
    } catch { /* */ }
    if (!firstNmId) {
      return NextResponse.json({ ok: false, error: "campaign has no nm_ids — can't determine SSH article" }, { status: 400 });
    }
    // Дедуп по lower-case
    const seen = new Set<string>();
    phraseRows = [];
    for (const p of explicitPhrases) {
      const lc = p.trim().toLowerCase();
      if (seen.has(lc)) continue;
      seen.add(lc);
      phraseRows.push({ nm_id: firstNmId, phrase: p });
    }
  } else {
    // Fallback: все из preset_info. Приоритет: без preset_id в search_phrase_meta идут первыми.
    phraseRows = db.prepare(`
      SELECT cpk.nm_id, MIN(cpk.name) AS phrase,
             MIN(CASE WHEN spm.preset_id IS NULL THEN 0 ELSE 1 END) AS has_meta
      FROM campaign_preset_keywords cpk
      LEFT JOIN search_phrase_meta spm ON spm.phrase = lower(cpk.name)
      WHERE cpk.advert_id = ?
      GROUP BY cpk.nm_id, lower(cpk.name)
      ORDER BY has_meta ASC, MIN(cpk.name) ASC
    `).all(advertId) as { nm_id: number; phrase: string }[];
  }

  if (phraseRows.length === 0) {
    return NextResponse.json({ ok: false, error: "no phrases to scan" }, { status: 404 });
  }

  const total = phraseRows.length;
  g.__scanCampaignLocks!.add(advertId);
  g.__scanCampaignProgress![advertId] = {
    total,
    scanned: 0,
    failed: 0,
    pass: 0,
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    summary: null,
    error: null,
  };

  // Глобальная карта результатов (выживает между проходами).
  const presetByPhrase = new Map<string, number>();   // lc(phrase) → preset_id
  const phraseRawByLc = new Map<string, string>();    // lc → original case
  for (const r of phraseRows) phraseRawByLc.set(r.phrase.trim().toLowerCase(), r.phrase);

  // Фразы для повтора в текущем проходе — изначально все.
  let pending: { nm_id: number; phrase: string }[] = phraseRows.map((r) => ({ nm_id: r.nm_id, phrase: r.phrase }));
  let lastScanError: string | null = null;

  try {
    for (let pass = 1; pass <= MAX_PASSES && pending.length > 0; pass++) {
      g.__scanCampaignProgress![advertId].pass = pass;

      const stillPending: typeof pending = [];

      // По nm_id, по чанкам
      const passByNm = new Map<number, string[]>();
      for (const p of pending) {
        const arr = passByNm.get(p.nm_id) ?? [];
        arr.push(p.phrase);
        passByNm.set(p.nm_id, arr);
      }

      for (const [nmId, phrases] of passByNm.entries()) {
        for (let i = 0; i < phrases.length; i += CHUNK_SIZE) {
          const chunk = phrases.slice(i, i + CHUNK_SIZE);
          const resp = await sshBatch(nmId, chunk);

          if (!resp.ok || !resp.data) {
            // Весь chunk упал → ретраим весь chunk на следующем проходе.
            lastScanError = resp.error || "wb-parser returned no data";
            g.__scanCampaignProgress![advertId].error = lastScanError;
            for (const ph of chunk) stillPending.push({ nm_id: nmId, phrase: ph });
            continue;
          }
          for (const ph of chunk) {
            const info = resp.data[ph];
            // info.error=true означает «WB вернул неполный ответ» (для повтора позиций),
            // но preset_id у parser'а заполняется через metadata.catalog_value fallback и
            // валиден независимо от позиций. Для скана-кластеризации хватит preset_id.
            if (!info || info.preset_id == null) {
              stillPending.push({ nm_id: nmId, phrase: ph });
              continue;
            }
            const lc = ph.trim().toLowerCase();
            presetByPhrase.set(lc, info.preset_id);
            // Прогресс
            g.__scanCampaignProgress![advertId].scanned = presetByPhrase.size;

            // Обновляем search_phrase_meta — стандартная семантика insert/update-same/update-changed.
            const existing = db.prepare(`SELECT preset_id FROM search_phrase_meta WHERE phrase = ?`).get(lc) as { preset_id: number | null } | undefined;
            const tokensJson = info.tokens && info.tokens.length > 0 ? JSON.stringify(info.tokens) : null;
            if (!existing) {
              db.prepare(`INSERT INTO search_phrase_meta (phrase, preset_id, tokens_json) VALUES (?, ?, ?)`).run(lc, info.preset_id, tokensJson);
            } else if (existing.preset_id === info.preset_id) {
              db.prepare(`
                UPDATE search_phrase_meta
                  SET last_verified_at = datetime('now'), checks_count = checks_count + 1,
                      tokens_json = COALESCE(?, tokens_json)
                WHERE phrase = ?
              `).run(tokensJson, lc);
            } else {
              db.prepare(`
                UPDATE search_phrase_meta
                  SET preset_id = ?, tokens_json = ?,
                      last_verified_at = datetime('now'), last_changed_at = datetime('now'),
                      checks_count = checks_count + 1
                WHERE phrase = ?
              `).run(info.preset_id, tokensJson, lc);
            }
          }
        }
      }

      pending = stillPending;
      if (pending.length > 0 && pass < MAX_PASSES) await sleep(PASS_DELAY_MS);
    }

    g.__scanCampaignProgress![advertId].failed = pending.length;

    if (presetByPhrase.size === 0 && pending.length === total) {
      throw new Error(`wb-parser scan failed for all ${total} phrases${lastScanError ? `: ${lastScanError}` : ""}`);
    }

    // Реструктуризация manual_clusters по результатам.
    // Группируем фразы по preset_id, выбираем материнскую (max frequency в search_texts_wb).
    const buckets = new Map<number, string[]>();   // preset_id → [phrase_raw, ...]
    for (const [lc, presetId] of presetByPhrase.entries()) {
      const arr = buckets.get(presetId) ?? [];
      arr.push(phraseRawByLc.get(lc) || lc);
      buckets.set(presetId, arr);
    }

    // Самый свежий snapshot частотности — для выбора имени кластера.
    const freqRows = db.prepare(`
      SELECT phrase_lc, frequency
      FROM search_texts_wb
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM search_texts_wb)
    `).all() as { phrase_lc: string; frequency: number }[];
    const freqMap = new Map(freqRows.map((r) => [r.phrase_lc, r.frequency]));

    function pickRootPhrase(phrases: string[]): string {
      let best = phrases[0];
      let bestFreq = freqMap.get(best.trim().toLowerCase()) ?? 0;
      for (const p of phrases) {
        const f = freqMap.get(p.trim().toLowerCase()) ?? 0;
        if (f > bestFreq) { best = p; bestFreq = f; }
      }
      return best;
    }

    let clustersCreated = 0;
    let clustersUpdated = 0;
    let clustersDeleted = 0;
    let phrasesMoved = 0;

    const tx = db.transaction(() => {
      for (const [presetId, phrases] of buckets.entries()) {
        const phraseLcSet = new Set(phrases.map((p) => p.trim().toLowerCase()));

        // 1. Найти target по preset_id.
        const target = db.prepare(`SELECT id, name, phrases_json FROM manual_clusters WHERE preset_id = ?`).get(presetId) as { id: number; name: string; phrases_json: string } | undefined;

        let targetId: number;
        let targetPhrasesLc = new Set<string>();
        if (target) {
          targetId = target.id;
          try {
            const arr = JSON.parse(target.phrases_json) as string[];
            for (const p of arr) targetPhrasesLc.add(p.trim().toLowerCase());
            targetPhrasesLc.add(target.name.trim().toLowerCase());
          } catch { /* */ }
          // Добавляем недостающие фразы.
          const newPhraseList = [...new Set([...JSON.parse(target.phrases_json || "[]"), ...phrases.filter((p) => !targetPhrasesLc.has(p.trim().toLowerCase()))])];
          if (newPhraseList.length !== JSON.parse(target.phrases_json || "[]").length) {
            db.prepare(`UPDATE manual_clusters SET phrases_json = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(newPhraseList), targetId);
            clustersUpdated++;
            for (const p of phrases) targetPhrasesLc.add(p.trim().toLowerCase());
          }
        } else {
          // Создаём новый кластер. Имя = root phrase by frequency.
          const rootPhrase = pickRootPhrase(phrases);
          // Имя должно быть уникальным — UNIQUE(name). Если совпадёт — ловим и придумываем суффикс.
          let nameToUse = rootPhrase;
          let suffix = 0;
          const phrasesArr = phrases.filter((p) => p !== rootPhrase);  // root phrase в name, остальные в phrases_json
          while (true) {
            try {
              const r = db.prepare(`
                INSERT INTO manual_clusters (name, phrases_json, source, preset_id, created_at, updated_at)
                VALUES (?, ?, 'manual', ?, datetime('now'), datetime('now'))
              `).run(nameToUse, JSON.stringify(phrasesArr), presetId);
              targetId = Number(r.lastInsertRowid);
              clustersCreated++;
              targetPhrasesLc = new Set(phrases.map((p) => p.trim().toLowerCase()));
              break;
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              if (msg.includes("UNIQUE") && msg.includes("name") && suffix < 5) {
                suffix++;
                nameToUse = `${rootPhrase} #${suffix}`;
                continue;
              }
              throw e;
            }
          }
        }

        // 2. Удалить эти фразы из всех ОСТАЛЬНЫХ кластеров (preset_id != current).
        const otherClusters = db.prepare(`SELECT id, name, phrases_json FROM manual_clusters WHERE id != ?`).all(targetId) as { id: number; name: string; phrases_json: string }[];
        for (const oc of otherClusters) {
          let arr: string[] = [];
          try { arr = JSON.parse(oc.phrases_json) as string[]; } catch { /* */ }
          const filtered = arr.filter((p) => !phraseLcSet.has(p.trim().toLowerCase()));
          if (filtered.length === arr.length) continue; // ничего не удалили
          phrasesMoved += arr.length - filtered.length;
          // Также проверяем: если name самого кластера попал в phraseLcSet — этот кластер
          // должен «опустеть» полностью (его имя теперь принадлежит другому preset_id).
          // Удаляем такой кластер целиком.
          if (phraseLcSet.has(oc.name.trim().toLowerCase()) && filtered.length === 0) {
            db.prepare(`DELETE FROM manual_clusters WHERE id = ?`).run(oc.id);
            clustersDeleted++;
            continue;
          }
          if (filtered.length === 0 && !phraseLcSet.has(oc.name.trim().toLowerCase())) {
            // Все phrases удалены, но name не наш → удаляем кластер (он пустой).
            db.prepare(`DELETE FROM manual_clusters WHERE id = ?`).run(oc.id);
            clustersDeleted++;
            continue;
          }
          db.prepare(`UPDATE manual_clusters SET phrases_json = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(filtered), oc.id);
        }
      }
    });

    tx();

    g.__scanCampaignProgress![advertId].running = false;
    g.__scanCampaignProgress![advertId].finishedAt = new Date().toISOString();
    g.__scanCampaignProgress![advertId].summary = { clustersCreated, clustersUpdated, clustersDeleted, phrasesMoved };
    auditMutation(request, {
      action: "scan-campaign",
      targetType: "advert",
      targetId: advertId,
      status: "success",
      details: { total, scanned: presetByPhrase.size, failed: pending.length, clustersCreated, clustersUpdated, clustersDeleted, phrasesMoved },
    });

    return NextResponse.json({
      ok: true,
      total,
      scanned: presetByPhrase.size,
      failed: pending.length,
      passesUsed: g.__scanCampaignProgress![advertId].pass,
      summary: { clustersCreated, clustersUpdated, clustersDeleted, phrasesMoved },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    g.__scanCampaignProgress![advertId].running = false;
    g.__scanCampaignProgress![advertId].finishedAt = new Date().toISOString();
    g.__scanCampaignProgress![advertId].error = msg;
    auditMutation(request, { action: "scan-campaign", targetType: "advert", targetId: advertId, status: "failed", details: { error: msg } });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  } finally {
    g.__scanCampaignLocks!.delete(advertId);
  }
}
