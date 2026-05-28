import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiKey } from "@/lib/api-key";
import { auditMutation, checkRateLimit, rateLimitKey } from "@/lib/security";
import { readBidLimitRub, WB_MAX_BID_RUB } from "@/lib/bid-limits";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/advert/set-bid
// Body: { advertId, nmId, phrases: string[], bidRub: number }
//
// Шлёт CPM-ставку в WB open API `/adv/v0/normquery/bids` (scope Реклама, rate-limit 2 rps).
//
// ВАЖНО: `bid` в этом endpoint в РУБЛЯХ, не копейках. Swagger WB утверждает что в копейках,
// но реально WB отклоняет с "значение ставки не должно превышать 29999 рублей" при bid=54900
// (принимая 54900 как рубли). Совпадает с `get-bids` / `normquery/stats`, где `bid` тоже рубли.
// В БД actual_cpm продолжаем хранить в копейках (как отдаёт preset-info) — конвертируем.
//
// Лимит WB: bid ≤ 29999 рублей.
//
// Формат ответа: HTTP 200 даже при ошибках. В теле — `{success:[{...}], failed:[{...reason}]}`.
// Если phrase попал в `failed` — ставка НЕ применена, несмотря на 200.
//
// Фраза должна быть канонической нормфразой WB-кластеризатора — длинные варианты WB
// молча отбрасывает (см. memory/wb_normquery_bids_api.md).
//
// Clamp-to-min: если bidRub < subject_min_cpm, применяем min (без ошибки).
//
// Логирование: console.log по шагам + запись в `bid_changes_log`. Таблица создаётся лениво.

const WB_URL = "https://advert-api.wildberries.ru/adv/v0/normquery/bids";
const TIMEOUT_MS = 15000;

interface Body {
  advertId?: number;
  nmId?: number;
  phrases?: string[];
  bidRub?: number;
}

function ensureLogTable(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bid_changes_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT DEFAULT (datetime('now')),
      advert_id INTEGER,
      nm_id INTEGER,
      phrases_json TEXT,
      phrases_count INTEGER,
      requested_kopecks INTEGER,
      final_kopecks INTEGER,
      clamped INTEGER,
      wb_status INTEGER,
      wb_response TEXT,
      our_status TEXT,
      error TEXT,
      duration_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_bid_log_at ON bid_changes_log(at DESC);
    CREATE INDEX IF NOT EXISTS idx_bid_log_advert ON bid_changes_log(advert_id, at DESC);
  `);
}

function logEntry(db: ReturnType<typeof getDb>, row: {
  advert_id: number | null; nm_id: number | null; phrases: string[];
  requested_kopecks: number | null; final_kopecks: number | null; clamped: boolean;
  wb_status: number | null; wb_response: string | null;
  our_status: string; error: string | null; duration_ms: number;
}) {
  try {
    ensureLogTable(db);
    db.prepare(`
      INSERT INTO bid_changes_log
        (advert_id, nm_id, phrases_json, phrases_count, requested_kopecks, final_kopecks,
         clamped, wb_status, wb_response, our_status, error, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.advert_id, row.nm_id, JSON.stringify(row.phrases), row.phrases.length,
      row.requested_kopecks, row.final_kopecks, row.clamped ? 1 : 0,
      row.wb_status, row.wb_response, row.our_status, row.error, row.duration_ms,
    );
  } catch (e) {
    console.error("[set-bid] failed to log:", e);
  }
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const t0 = Date.now();
  let body: Body;
  try { body = await request.json(); }
  catch {
    console.log("[set-bid] ← invalid json");
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const { advertId, nmId, phrases, bidRub } = body;
  console.log(`[set-bid] → advert=${advertId} nm=${nmId} bidRub=${bidRub} phrases=`, phrases);

  if (!advertId || !nmId || !Array.isArray(phrases) || phrases.length === 0 || !Number.isFinite(bidRub) || (bidRub as number) <= 0) {
    const err = "advertId, nmId, phrases[], bidRub > 0 are required";
    console.log("[set-bid] validation fail:", err);
    logEntry(db, {
      advert_id: advertId ?? null, nm_id: nmId ?? null, phrases: phrases ?? [],
      requested_kopecks: null, final_kopecks: null, clamped: false,
      wb_status: null, wb_response: null, our_status: "validation_fail", error: err,
      duration_ms: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: err }, { status: 400 });
  }
  const uniquePhrases = Array.from(new Set(phrases.map((p) => p.trim()).filter(Boolean)));
  if (uniquePhrases.length === 0) {
    const err = "empty phrases after trim";
    logEntry(db, {
      advert_id: advertId, nm_id: nmId, phrases: [],
      requested_kopecks: null, final_kopecks: null, clamped: false,
      wb_status: null, wb_response: null, our_status: "validation_fail", error: err,
      duration_ms: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: err }, { status: 400 });
  }

  const rl = checkRateLimit(rateLimitKey(request, "set-bid", advertId), 30, 60 * 1000);
  if (!rl.ok) {
    auditMutation(request, {
      action: "set-bid",
      targetType: "advert",
      targetId: advertId,
      status: "blocked",
      details: { reason: "rate_limit", retryAfterSec: rl.retryAfterSec, nmId, phrases: uniquePhrases.length },
    });
    return NextResponse.json({ ok: false, error: "rate limit", retryAfterSec: rl.retryAfterSec }, { status: 429 });
  }
  auditMutation(request, {
    action: "set-bid",
    targetType: "advert",
    targetId: advertId,
    status: "accepted",
    details: { nmId, bidRub, phrases: uniquePhrases.length },
  });

  // Validate campaign state
  const camp = db.prepare(
    "SELECT advert_id, status, bid_type, payment_type, subject_id FROM campaigns WHERE advert_id = ?",
  ).get(advertId) as { advert_id: number; status: number; bid_type: string | null; payment_type: string | null; subject_id: number | null } | undefined;

  const failValidation = (err: string) => {
    console.log("[set-bid] validation fail:", err);
    logEntry(db, {
      advert_id: advertId, nm_id: nmId, phrases: uniquePhrases,
      requested_kopecks: Math.round((bidRub as number) * 100), final_kopecks: null, clamped: false,
      wb_status: null, wb_response: null, our_status: "validation_fail", error: err,
      duration_ms: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: err }, { status: 400 });
  };

  if (!camp) return failValidation("campaign not found in local db");
  if (![4, 9, 11].includes(camp.status)) return failValidation(`campaign status ${camp.status} — ставку можно менять только у 4/9/11`);
  if (camp.payment_type !== "cpm") return failValidation(`payment_type=${camp.payment_type} — поддерживается только cpm`);
  if (camp.bid_type !== "manual") return failValidation("bid_type=" + camp.bid_type + " — ставку фразы можно менять только при ручной модели");

  const sentPhraseSet = new Set(uniquePhrases.map((p) => p.toLowerCase()));
  const manualClusters = db.prepare("SELECT name, phrases_json FROM manual_clusters ORDER BY id").all() as { name: string; phrases_json: string }[];
  const clusterParentSet = new Set(manualClusters.map((cluster) => cluster.name.trim().toLowerCase()).filter(Boolean));
  for (const cluster of manualClusters) {
    const parentLc = cluster.name.trim().toLowerCase();
    if (sentPhraseSet.has(parentLc)) continue;
    let children: string[] = [];
    try {
      const parsed = JSON.parse(cluster.phrases_json || "[]");
      if (Array.isArray(parsed)) children = parsed.map((x) => String(x).trim().toLowerCase());
    } catch {
      children = [];
    }
    const childHit = children.find((child) => child && child !== parentLc && sentPhraseSet.has(child) && !clusterParentSet.has(child));
    if (childHit) {
      return failValidation("phrase \"" + childHit + "\" belongs to cluster \"" + cluster.name + "\" — set bid on parent phrase");
    }
  }

  // Clamp-to-min (в рублях — WB API ожидает bid в рублях, не копейках)
  const requestedRub = Math.round(bidRub as number);
  let finalRub = requestedRub;
  let clamped = false;
  if (camp.subject_id) {
    const minRow = db.prepare(
      "SELECT min_cpm_search FROM subject_min_cpm WHERE subject_id = ?",
    ).get(camp.subject_id) as { min_cpm_search: number | null } | undefined;
    const minRub = Math.round(minRow?.min_cpm_search ?? 0);
    if (minRub > 0 && requestedRub < minRub) {
      finalRub = minRub;
      clamped = true;
      console.log(`[set-bid] clamp: requested=${requestedRub}₽ < min=${minRub}₽ → using ${finalRub}₽`);
    }
  }

  const maxAllowedRub = Math.min(readBidLimitRub(db, "manualAuction"), WB_MAX_BID_RUB);
  if (finalRub > maxAllowedRub) {
    const err = `bid ${finalRub}₽ превышает максимальную ставку Аукциона ${maxAllowedRub}₽`;
    logEntry(db, {
      advert_id: advertId, nm_id: nmId, phrases: uniquePhrases,
      requested_kopecks: requestedRub * 100, final_kopecks: finalRub * 100, clamped,
      wb_status: null, wb_response: null, our_status: "validation_fail", error: err,
      duration_ms: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: err }, { status: 400 });
  }

  const wbBody = {
    bids: uniquePhrases.map((q) => ({
      advert_id: advertId,
      nm_id: nmId,
      norm_query: q,
      bid: finalRub,
    })),
  };
  console.log(`[set-bid] → WB ${WB_URL} body:`, JSON.stringify(wbBody));

  const apiKey = getApiKey();
  const ac = new AbortController();
  const tmr = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let wbRes: Response;
  try {
    wbRes = await fetch(WB_URL, {
      method: "POST",
      signal: ac.signal,
      headers: { "Authorization": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(wbBody),
    });
  } catch (e) {
    clearTimeout(tmr);
    const err = `wb network: ${e instanceof Error ? e.message : String(e)}`;
    console.log("[set-bid] network error:", err);
    logEntry(db, {
      advert_id: advertId, nm_id: nmId, phrases: uniquePhrases,
      requested_kopecks: requestedRub * 100, final_kopecks: finalRub * 100, clamped,
      wb_status: null, wb_response: null, our_status: "network_error", error: err,
      duration_ms: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: err }, { status: 502 });
  }
  clearTimeout(tmr);

  let wbText = "";
  try { wbText = await wbRes.text(); } catch { /* */ }
  console.log(`[set-bid] ← WB status=${wbRes.status} body="${wbText.slice(0, 500)}"`);

  // HTTP-уровневая ошибка
  if (!wbRes.ok) {
    const err = `wb http ${wbRes.status}`;
    logEntry(db, {
      advert_id: advertId, nm_id: nmId, phrases: uniquePhrases,
      requested_kopecks: requestedRub * 100, final_kopecks: finalRub * 100, clamped,
      wb_status: wbRes.status, wb_response: wbText.slice(0, 2000),
      our_status: "wb_error", error: err,
      duration_ms: Date.now() - t0,
    });
    auditMutation(request, {
      action: "set-bid",
      targetType: "advert",
      targetId: advertId,
      status: "failed",
      details: { nmId, requestedRub, finalRub, wbStatus: wbRes.status, phrases: uniquePhrases.length },
    });
    let detail: unknown = wbText;
    try { detail = JSON.parse(wbText); } catch { /* */ }
    return NextResponse.json({ ok: false, status: wbRes.status, error: err, detail }, { status: 502 });
  }

  // WB отдаёт 200 даже при validation-ошибках — смотрим в тело {success:[], failed:[{reason}]}
  let wbJson: { success?: Array<{ norm_query: string }>; failed?: Array<{ norm_query: string; reason: string }> } = {};
  try { wbJson = wbText ? JSON.parse(wbText) : {}; } catch { /* */ }
  const failed = wbJson.failed ?? [];
  const success = wbJson.success ?? [];

  if (failed.length > 0 && success.length === 0) {
    // Вообще ничего не применилось
    const reasons = Array.from(new Set(failed.map((f) => f.reason))).join("; ");
    const err = `WB отклонил ставку: ${reasons}`;
    console.log(`[set-bid] WB rejected all: ${err}`);
    logEntry(db, {
      advert_id: advertId, nm_id: nmId, phrases: uniquePhrases,
      requested_kopecks: requestedRub * 100, final_kopecks: finalRub * 100, clamped,
      wb_status: wbRes.status, wb_response: wbText.slice(0, 2000),
      our_status: "wb_rejected", error: err,
      duration_ms: Date.now() - t0,
    });
    auditMutation(request, {
      action: "set-bid",
      targetType: "advert",
      targetId: advertId,
      status: "failed",
      details: { nmId, requestedRub, finalRub, reason: "wb_rejected", phrases: uniquePhrases.length },
    });
    return NextResponse.json({ ok: false, status: wbRes.status, error: err, wb: wbJson }, { status: 400 });
  }

  // Частичный успех (mixed): часть применилась, часть нет. Обновим БД только для applied.
  const appliedPhrases = success.map((s) => s.norm_query).filter((q): q is string => typeof q === "string" && q.length > 0);
  // Если WB не вернул success[] явно, но нет failed — считаем все применёнными (fallback).
  const toUpdate = appliedPhrases.length > 0 ? appliedPhrases : (failed.length === 0 ? uniquePhrases : []);

  const update = db.prepare(
    "UPDATE campaign_preset_keywords SET actual_cpm = ?, updated_at = datetime('now') WHERE advert_id = ? AND nm_id = ? AND lower(name) = lower(?)",
  );
  const upsertBid = db.prepare(`
    INSERT INTO campaign_keyword_bids (advert_id, nm_id, norm_query, bid, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(advert_id, nm_id, norm_query) DO UPDATE SET
      bid = excluded.bid,
      updated_at = datetime('now')
  `);
  let updated = 0;
  const tx = db.transaction(() => {
    for (const q of toUpdate) {
      const r = update.run(finalRub * 100, advertId, nmId, q);
      upsertBid.run(advertId, nmId, q, finalRub);
      updated += r.changes;
    }
  });
  tx();

  const partial = failed.length > 0 && success.length > 0;
  console.log(`[set-bid] ← applied=${toUpdate.length}/${uniquePhrases.length} dbUpdated=${updated} finalRub=${finalRub} clamped=${clamped} partial=${partial}`);

  logEntry(db, {
    advert_id: advertId, nm_id: nmId, phrases: uniquePhrases,
    requested_kopecks: requestedRub * 100, final_kopecks: finalRub * 100, clamped,
    wb_status: wbRes.status, wb_response: wbText.slice(0, 2000),
    our_status: partial ? "wb_partial" : "ok", error: partial ? `partial: ${failed.length} failed` : null,
    duration_ms: Date.now() - t0,
  });

  auditMutation(request, {
    action: "set-bid",
    targetType: "advert",
    targetId: advertId,
    status: partial ? "failed" : "success",
    details: { nmId, requestedRub, finalRub, applied: toUpdate.length, sent: uniquePhrases.length, partial },
  });

  return NextResponse.json({
    ok: true,
    applied: toUpdate.length,
    sent: uniquePhrases.length,
    updated,
    requestedRub,
    bidRub: finalRub,
    bidKopecks: finalRub * 100,
    clamped,
    partial,
    failed: failed.length > 0 ? failed : undefined,
  });
}
