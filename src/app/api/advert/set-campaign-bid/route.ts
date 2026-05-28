import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiKey } from "@/lib/api-key";
import { auditMutation, checkRateLimit, rateLimitKey } from "@/lib/security";
import { readBidLimitRub, WB_MAX_BID_RUB } from "@/lib/bid-limits";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/advert/set-campaign-bid
// Body: { advertId, cpmRub }
//
// Меняет единую CPM-ставку Uni-кампании через WB open API.
//
// WB-документация (актуально на 2026-04):
//   PATCH https://advert-api.wildberries.ru/api/advert/v1/bids
//   Body: { bids: [{ advert_id, nm_bids: [{ nm_id, bid_kopecks, placement }] }] }
//     placement = "combined"        — для Uni (поиск+рекомендации)
//                 "search"|"recommendations" — для ручной
//     bid_kopecks — в копейках (НЕ рублях, отличие от старого /adv/v0/cpm).
//
//   Для Uni шлём ставку на ВСЕ nmIds кампании (одинаковую) — единая ставка кампании.
//
// Clamp-to-min: если cpmRub < subject_min_cpm.min_cpm_unified, применяем min (без ошибки).
// Лимит WB: cpm ≤ 29999 ₽.

const WB_URL = "https://advert-api.wildberries.ru/api/advert/v1/bids";
const TIMEOUT_MS = 15000;

interface Body {
  advertId?: number;
  cpmRub?: number;
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
  `);
}

function logEntry(db: ReturnType<typeof getDb>, row: {
  advert_id: number | null;
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
      VALUES (?, NULL, NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.advert_id,
      row.requested_kopecks, row.final_kopecks, row.clamped ? 1 : 0,
      row.wb_status, row.wb_response, row.our_status, row.error, row.duration_ms,
    );
  } catch (e) {
    console.error("[set-campaign-bid] failed to log:", e);
  }
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const t0 = Date.now();
  let body: Body;
  try { body = await request.json(); }
  catch {
    console.log("[set-campaign-bid] ← invalid json");
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const { advertId, cpmRub } = body;
  console.log(`[set-campaign-bid] → advert=${advertId} cpmRub=${cpmRub}`);

  if (!advertId || !Number.isFinite(cpmRub) || (cpmRub as number) <= 0) {
    const err = "advertId and cpmRub > 0 are required";
    logEntry(db, {
      advert_id: advertId ?? null,
      requested_kopecks: null, final_kopecks: null, clamped: false,
      wb_status: null, wb_response: null, our_status: "validation_fail", error: err,
      duration_ms: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: err }, { status: 400 });
  }

  const rl = checkRateLimit(rateLimitKey(request, "set-campaign-bid", advertId), 10, 60 * 1000);
  if (!rl.ok) {
    auditMutation(request, {
      action: "set-campaign-bid",
      targetType: "advert",
      targetId: advertId,
      status: "blocked",
      details: { reason: "rate_limit", retryAfterSec: rl.retryAfterSec, cpmRub },
    });
    return NextResponse.json({ ok: false, error: "rate limit", retryAfterSec: rl.retryAfterSec }, { status: 429 });
  }
  auditMutation(request, {
    action: "set-campaign-bid",
    targetType: "advert",
    targetId: advertId,
    status: "accepted",
    details: { cpmRub },
  });

  // Validate campaign state
  const camp = db.prepare(
    "SELECT advert_id, type, status, bid_type, payment_type, subject_id, placements_json, nms_json FROM campaigns WHERE advert_id = ?",
  ).get(advertId) as {
    advert_id: number; type: number | null; status: number;
    bid_type: string | null; payment_type: string | null;
    subject_id: number | null; placements_json: string | null;
    nms_json: string | null;
  } | undefined;

  const failValidation = (err: string) => {
    console.log("[set-campaign-bid] validation fail:", err);
    logEntry(db, {
      advert_id: advertId,
      requested_kopecks: Math.round((cpmRub as number) * 100), final_kopecks: null, clamped: false,
      wb_status: null, wb_response: null, our_status: "validation_fail", error: err,
      duration_ms: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: err }, { status: 400 });
  };

  if (!camp) return failValidation("campaign not found in local db");
  if (![4, 9, 11].includes(camp.status)) return failValidation(`campaign status ${camp.status} — ставку можно менять только у 4/9/11`);
  if (camp.payment_type !== "cpm") return failValidation(`payment_type=${camp.payment_type} — поддерживается только cpm`);
  if (camp.bid_type === "manual") return failValidation("для ручного аукциона используйте /api/advert/set-bid");

  // Парсим список nmIds для смены ставки.
  let nmIds: number[] = [];
  try { nmIds = JSON.parse(camp.nms_json || "[]"); } catch { /* */ }
  if (!Array.isArray(nmIds) || nmIds.length === 0) return failValidation("в кампании нет nmIds");

  // Clamp-to-min по Uni-минимуму
  const requestedRub = Math.round(cpmRub as number);
  let finalRub = requestedRub;
  let clamped = false;
  if (camp.subject_id) {
    const minRow = db.prepare(
      "SELECT min_cpm_unified FROM subject_min_cpm WHERE subject_id = ?",
    ).get(camp.subject_id) as { min_cpm_unified: number | null } | undefined;
    const minRub = Math.round(minRow?.min_cpm_unified ?? 0);
    if (minRub > 0 && requestedRub < minRub) {
      finalRub = minRub;
      clamped = true;
      console.log(`[set-campaign-bid] clamp: requested=${requestedRub}₽ < min=${minRub}₽ → using ${finalRub}₽`);
    }
  }
  const maxAllowedRub = Math.min(readBidLimitRub(db, "uni"), WB_MAX_BID_RUB);
  if (finalRub > maxAllowedRub) {
    const err = `cpm ${finalRub}₽ превышает максимальную ставку Uni ${maxAllowedRub}₽`;
    logEntry(db, {
      advert_id: advertId,
      requested_kopecks: requestedRub * 100, final_kopecks: finalRub * 100, clamped,
      wb_status: null, wb_response: null, our_status: "validation_fail", error: err,
      duration_ms: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: err }, { status: 400 });
  }

  // Тело WB-запроса. Для Uni placement="combined", bid_kopecks=рубли*100.
  // На все nmIds кампании отправляем одну и ту же ставку — единая ставка кампании.
  const bidKopecks = finalRub * 100;
  const wbBody = {
    bids: [
      {
        advert_id: advertId,
        nm_bids: nmIds.map((nm_id) => ({
          nm_id,
          bid_kopecks: bidKopecks,
          placement: "combined" as const,
        })),
      },
    ],
  };
  console.log(`[set-campaign-bid] → WB PATCH ${WB_URL} body:`, JSON.stringify(wbBody));

  const apiKey = getApiKey();
  const ac = new AbortController();
  const tmr = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let wbRes: Response;
  try {
    wbRes = await fetch(WB_URL, {
      method: "PATCH",
      signal: ac.signal,
      headers: { "Authorization": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(wbBody),
    });
  } catch (e) {
    clearTimeout(tmr);
    const err = `wb network: ${e instanceof Error ? e.message : String(e)}`;
    console.log("[set-campaign-bid] network error:", err);
    logEntry(db, {
      advert_id: advertId,
      requested_kopecks: requestedRub * 100, final_kopecks: finalRub * 100, clamped,
      wb_status: null, wb_response: null, our_status: "network_error", error: err,
      duration_ms: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: err }, { status: 502 });
  }
  clearTimeout(tmr);

  let wbText = "";
  try { wbText = await wbRes.text(); } catch { /* */ }
  console.log(`[set-campaign-bid] ← WB status=${wbRes.status} body="${wbText.slice(0, 500)}"`);

  if (!wbRes.ok) {
    const err = `wb http ${wbRes.status}`;
    logEntry(db, {
      advert_id: advertId,
      requested_kopecks: requestedRub * 100, final_kopecks: finalRub * 100, clamped,
      wb_status: wbRes.status, wb_response: wbText.slice(0, 2000),
      our_status: "wb_error", error: err,
      duration_ms: Date.now() - t0,
    });
    auditMutation(request, {
      action: "set-campaign-bid",
      targetType: "advert",
      targetId: advertId,
      status: "failed",
      details: { requestedRub, finalRub, wbStatus: wbRes.status },
    });
    let detail: unknown = wbText;
    try { detail = JSON.parse(wbText); } catch { /* */ }
    return NextResponse.json({ ok: false, status: wbRes.status, error: err, detail }, { status: 502 });
  }

  // Успех — обновляем БД (campaigns.bid_kopecks), чтобы UI сразу подхватил.
  db.prepare("UPDATE campaigns SET bid_kopecks = ?, updated_at = datetime('now') WHERE advert_id = ?")
    .run(finalRub * 100, advertId);

  logEntry(db, {
    advert_id: advertId,
    requested_kopecks: requestedRub * 100, final_kopecks: finalRub * 100, clamped,
    wb_status: wbRes.status, wb_response: wbText.slice(0, 2000),
    our_status: "ok:campaign_level", error: null,
    duration_ms: Date.now() - t0,
  });

  auditMutation(request, {
    action: "set-campaign-bid",
    targetType: "advert",
    targetId: advertId,
    status: "success",
    details: { requestedRub, finalRub, clamped },
  });

  console.log(`[set-campaign-bid] ← ok finalRub=${finalRub} clamped=${clamped}`);

  return NextResponse.json({
    ok: true,
    requestedRub,
    appliedRub: finalRub,
    bidKopecks: finalRub * 100,
    clamped,
  });
}
