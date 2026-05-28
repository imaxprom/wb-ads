import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiKey } from "@/lib/api-key";
import { auditMutation, checkRateLimit, rateLimitKey } from "@/lib/security";
import { readBidLimitRub, WB_MAX_BID_RUB } from "@/lib/bid-limits";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/advert/set-cpc-bid
// Body: { advertId, cpcRub }
//
// Меняет ставку CPC-кампании через WB open API:
// PATCH https://advert-api.wildberries.ru/api/advert/v1/bids
// Body: { bids: [{ advert_id, nm_bids: [{ nm_id, bid_kopecks, placement }] }] }
const WB_URL = "https://advert-api.wildberries.ru/api/advert/v1/bids";
const TIMEOUT_MS = 15000;

interface Body {
  advertId?: number;
  cpcRub?: number;
}

type Placement = "search" | "recommendations";

function ensureLogTable(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bid_changes_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT DEFAULT (datetime('now')),
      advert_id INTEGER,
      nm_id INTEGER,
      phrases_json TEXT,
      requested_kopecks INTEGER,
      final_kopecks INTEGER,
      clamped INTEGER DEFAULT 0,
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
  advert_id: number | null;
  nm_id?: number | null;
  requested_kopecks: number | null;
  final_kopecks: number | null;
  wb_status: number | null;
  wb_response: string | null;
  our_status: string;
  error: string | null;
  duration_ms: number;
}) {
  try {
    ensureLogTable(db);
    db.prepare(`
      INSERT INTO bid_changes_log
        (advert_id, nm_id, phrases_json, requested_kopecks, final_kopecks, clamped,
         wb_status, wb_response, our_status, error, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.advert_id,
      row.nm_id ?? null,
      JSON.stringify([]),
      row.requested_kopecks,
      row.final_kopecks,
      0,
      row.wb_status,
      row.wb_response,
      row.our_status,
      row.error,
      row.duration_ms,
    );
  } catch (e) {
    console.error("[set-cpc-bid] failed to log:", e);
  }
}

function parseNms(raw: string | null): number[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed)
      ? parsed.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
      : [];
  } catch {
    return [];
  }
}

function parsePlacements(raw: string | null): Placement[] {
  try {
    const p = JSON.parse(raw || "{}") as { search?: boolean; recommendations?: boolean };
    const result: Placement[] = [];
    if (p.search) result.push("search");
    if (p.recommendations) result.push("recommendations");
    return result;
  } catch {
    return [];
  }
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const t0 = Date.now();
  let body: Body;
  try { body = await request.json(); }
  catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const { advertId, cpcRub } = body;
  if (!advertId || !Number.isFinite(cpcRub) || (cpcRub as number) <= 0) {
    const err = "advertId and cpcRub > 0 are required";
    logEntry(db, {
      advert_id: advertId ?? null,
      requested_kopecks: null, final_kopecks: null,
      wb_status: null, wb_response: null, our_status: "validation_fail", error: err,
      duration_ms: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: err }, { status: 400 });
  }

  const rl = checkRateLimit(rateLimitKey(request, "set-cpc-bid", advertId), 10, 60 * 1000);
  if (!rl.ok) {
    auditMutation(request, {
      action: "set-cpc-bid",
      targetType: "advert",
      targetId: advertId,
      status: "blocked",
      details: { reason: "rate_limit", retryAfterSec: rl.retryAfterSec, cpcRub },
    });
    return NextResponse.json({ ok: false, error: "rate limit", retryAfterSec: rl.retryAfterSec }, { status: 429 });
  }
  auditMutation(request, {
    action: "set-cpc-bid",
    targetType: "advert",
    targetId: advertId,
    status: "accepted",
    details: { cpcRub },
  });

  const camp = db.prepare(
    "SELECT advert_id, status, payment_type, placements_json, nms_json FROM campaigns WHERE advert_id = ?",
  ).get(advertId) as {
    advert_id: number;
    status: number;
    payment_type: string | null;
    placements_json: string | null;
    nms_json: string | null;
  } | undefined;

  const failValidation = (err: string) => {
    logEntry(db, {
      advert_id: advertId,
      requested_kopecks: Math.round((cpcRub as number) * 100), final_kopecks: null,
      wb_status: null, wb_response: null, our_status: "validation_fail", error: err,
      duration_ms: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: err }, { status: 400 });
  };

  if (!camp) return failValidation("campaign not found in local db");
  if (![4, 9, 11].includes(camp.status)) return failValidation(`campaign status ${camp.status} — ставку можно менять только у 4/9/11`);
  if (camp.payment_type !== "cpc") return failValidation(`payment_type=${camp.payment_type} — поддерживается только cpc`);

  const nmIds = parseNms(camp.nms_json);
  if (nmIds.length === 0) return failValidation("в кампании нет nmIds");

  const placements = parsePlacements(camp.placements_json);
  if (placements.length === 0) return failValidation("в кампании нет активных placements");

  const requestedRub = Math.round(cpcRub as number);
  const maxAllowedRub = Math.min(readBidLimitRub(db, "cpc"), WB_MAX_BID_RUB);
  if (requestedRub > maxAllowedRub) {
    const err = `cpc ${requestedRub}₽ превышает максимальную ставку CPC ${maxAllowedRub}₽`;
    logEntry(db, {
      advert_id: advertId,
      requested_kopecks: requestedRub * 100, final_kopecks: requestedRub * 100,
      wb_status: null, wb_response: null, our_status: "validation_fail", error: err,
      duration_ms: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: err }, { status: 400 });
  }

  const bidKopecks = requestedRub * 100;
  const wbBody = {
    bids: [
      {
        advert_id: advertId,
        nm_bids: nmIds.flatMap((nm_id) => placements.map((placement) => ({
          nm_id,
          bid_kopecks: bidKopecks,
          placement,
        }))),
      },
    ],
  };

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
    logEntry(db, {
      advert_id: advertId,
      requested_kopecks: bidKopecks, final_kopecks: bidKopecks,
      wb_status: null, wb_response: null, our_status: "network_error", error: err,
      duration_ms: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: err }, { status: 502 });
  } finally {
    clearTimeout(tmr);
  }

  const wbText = await wbRes.text();
  if (!wbRes.ok) {
    const err = `WB status ${wbRes.status}`;
    logEntry(db, {
      advert_id: advertId,
      requested_kopecks: bidKopecks, final_kopecks: bidKopecks,
      wb_status: wbRes.status, wb_response: wbText.slice(0, 2000),
      our_status: "wb_error", error: err,
      duration_ms: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: err, status: wbRes.status, body: wbText }, { status: 502 });
  }

  db.prepare("UPDATE campaigns SET bid_kopecks = ?, updated_at = datetime('now') WHERE advert_id = ?")
    .run(bidKopecks, advertId);

  logEntry(db, {
    advert_id: advertId,
    requested_kopecks: bidKopecks, final_kopecks: bidKopecks,
    wb_status: wbRes.status, wb_response: wbText.slice(0, 2000),
    our_status: "ok:cpc_campaign_level", error: null,
    duration_ms: Date.now() - t0,
  });

  auditMutation(request, {
    action: "set-cpc-bid",
    targetType: "advert",
    targetId: advertId,
    status: "success",
    details: { cpcRub: requestedRub, nmIds: nmIds.length, placements },
  });

  return NextResponse.json({
    ok: true,
    advertId,
    cpcRub: requestedRub,
    bidKopecks,
    placements,
    nmIds,
    wbStatus: wbRes.status,
  });
}
