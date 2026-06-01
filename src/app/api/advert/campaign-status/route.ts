import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiKey } from "@/lib/api-key";
import { auditMutation, checkRateLimit, rateLimitKey } from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const WB_BASE = "https://advert-api.wildberries.ru";
const TIMEOUT_MS = 15000;

type Action = "start" | "pause";

interface Body {
  advertId?: number;
  action?: Action;
}

function isCrossOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  if (!origin && !referer) return false;
  if (request.headers.get("sec-fetch-site") === "same-origin") return false;

  const requestHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || request.nextUrl.host;
  const requestProto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "");
  const expectedOrigins = new Set([
    `${requestProto}://${requestHost}`,
    request.nextUrl.origin,
  ]);

  // VM108 can sit behind an internal HTTP proxy while the public browser origin is HTTPS.
  // Accept the public host with both schemes; proxy.ts still enforces browser same-origin
  // metadata before this high-risk route is reached.
  const hostOnly = requestHost.split(",")[0]?.trim();
  if (hostOnly) {
    expectedOrigins.add(`https://${hostOnly}`);
    expectedOrigins.add(`http://${hostOnly}`);
  }

  let sourceUrl: URL;
  try { sourceUrl = new URL(origin || referer || ""); }
  catch { return true; }
  if (expectedOrigins.has(sourceUrl.origin)) return false;

  // В локальной разработке браузер может открыть 127.0.0.1, а Next внутри собрать origin
  // как localhost. Это один и тот же loopback-хост, если порт совпадает.
  const requestUrl = new URL(`${requestProto}://${requestHost}`);
  const loopbacks = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  const originPort = sourceUrl.port || (sourceUrl.protocol === "https:" ? "443" : "80");
  const requestPort = requestUrl.port || (requestUrl.protocol === "https:" ? "443" : "80");
  if (loopbacks.has(sourceUrl.hostname) && loopbacks.has(requestUrl.hostname) && originPort === requestPort) {
    return false;
  }

  return true;
}

function actionLabel(action: Action): string {
  return action === "start" ? "запуск" : "пауза";
}

function allowedCurrentStatuses(action: Action): number[] {
  // WB: start — statuses 4/11, pause — status 9.
  return action === "start" ? [4, 11] : [9];
}

function targetStatus(action: Action): number {
  return action === "start" ? 9 : 11;
}

function ensureLogTable(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_status_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT DEFAULT (datetime('now')),
      advert_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      before_status INTEGER,
      after_status INTEGER,
      wb_status INTEGER,
      wb_response TEXT,
      our_status TEXT NOT NULL,
      error TEXT,
      duration_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_campaign_status_log_advert ON campaign_status_log(advert_id, at DESC);
  `);
}

function logEntry(db: ReturnType<typeof getDb>, row: {
  advertId: number;
  action: Action;
  beforeStatus: number | null;
  afterStatus: number | null;
  wbStatus: number | null;
  wbResponse: string | null;
  ourStatus: string;
  error: string | null;
  durationMs: number;
}) {
  try {
    ensureLogTable(db);
    db.prepare(`
      INSERT INTO campaign_status_log
        (advert_id, action, before_status, after_status, wb_status, wb_response, our_status, error, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.advertId,
      row.action,
      row.beforeStatus,
      row.afterStatus,
      row.wbStatus,
      row.wbResponse,
      row.ourStatus,
      row.error,
      row.durationMs,
    );
  } catch (e) {
    console.error("[campaign-status] failed to log:", e);
  }
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const t0 = Date.now();

  if (isCrossOrigin(request)) {
    auditMutation(request, {
      action: "campaign-status",
      targetType: "advert",
      targetId: null,
      status: "blocked",
      details: { reason: "cross_origin" },
    });
    return NextResponse.json({ ok: false, error: "same-origin request required" }, { status: 403 });
  }

  let body: Body;
  try { body = await request.json(); }
  catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const advertId = Number(body.advertId);
  const action = body.action;
  if (!Number.isInteger(advertId) || advertId <= 0 || (action !== "start" && action !== "pause")) {
    return NextResponse.json({ ok: false, error: "advertId and action=start|pause are required" }, { status: 400 });
  }

  const rl = checkRateLimit(rateLimitKey(request, `campaign-status:${action}`, advertId), 10, 60 * 1000);
  if (!rl.ok) {
    auditMutation(request, {
      action: `campaign-${action}`,
      targetType: "advert",
      targetId: advertId,
      status: "blocked",
      details: { reason: "rate_limit", retryAfterSec: rl.retryAfterSec },
    });
    return NextResponse.json({ ok: false, error: "rate limit", retryAfterSec: rl.retryAfterSec }, { status: 429 });
  }

  const camp = db.prepare("SELECT advert_id, status, name FROM campaigns WHERE advert_id = ?")
    .get(advertId) as { advert_id: number; status: number; name: string | null } | undefined;

  if (!camp) {
    logEntry(db, {
      advertId,
      action,
      beforeStatus: null,
      afterStatus: null,
      wbStatus: null,
      wbResponse: null,
      ourStatus: "validation_fail",
      error: "campaign not found in local db",
      durationMs: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: "campaign not found in local db" }, { status: 404 });
  }

  const allowed = allowedCurrentStatuses(action);
  if (!allowed.includes(camp.status)) {
    const err = `campaign status ${camp.status} cannot be changed by ${action}`;
    logEntry(db, {
      advertId,
      action,
      beforeStatus: camp.status,
      afterStatus: null,
      wbStatus: null,
      wbResponse: null,
      ourStatus: "validation_fail",
      error: err,
      durationMs: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: err }, { status: 400 });
  }

  auditMutation(request, {
    action: `campaign-${action}`,
    targetType: "advert",
    targetId: advertId,
    status: "accepted",
    details: { beforeStatus: camp.status, name: camp.name },
  });

  const apiKey = getApiKey();
  const url = `${WB_BASE}/adv/v0/${action}?id=${advertId}`;
  const ac = new AbortController();
  const tmr = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let wbRes: Response;
  try {
    wbRes = await fetch(url, {
      method: "GET",
      signal: ac.signal,
      headers: { Authorization: apiKey },
    });
  } catch (e) {
    clearTimeout(tmr);
    const err = `wb network: ${e instanceof Error ? e.message : String(e)}`;
    logEntry(db, {
      advertId,
      action,
      beforeStatus: camp.status,
      afterStatus: null,
      wbStatus: null,
      wbResponse: null,
      ourStatus: "network_error",
      error: err,
      durationMs: Date.now() - t0,
    });
    auditMutation(request, {
      action: `campaign-${action}`,
      targetType: "advert",
      targetId: advertId,
      status: "failed",
      details: { beforeStatus: camp.status, error: err },
    });
    return NextResponse.json({ ok: false, error: err }, { status: 502 });
  }
  clearTimeout(tmr);

  let wbText = "";
  try { wbText = await wbRes.text(); } catch { /* noop */ }

  if (!wbRes.ok) {
    const err = `wb http ${wbRes.status}`;
    logEntry(db, {
      advertId,
      action,
      beforeStatus: camp.status,
      afterStatus: null,
      wbStatus: wbRes.status,
      wbResponse: wbText.slice(0, 2000),
      ourStatus: "wb_error",
      error: err,
      durationMs: Date.now() - t0,
    });
    auditMutation(request, {
      action: `campaign-${action}`,
      targetType: "advert",
      targetId: advertId,
      status: "failed",
      details: { beforeStatus: camp.status, wbStatus: wbRes.status },
    });
    let detail: unknown = wbText;
    try { detail = JSON.parse(wbText); } catch { /* noop */ }
    return NextResponse.json({ ok: false, status: wbRes.status, error: err, detail }, { status: 502 });
  }

  const nextStatus = targetStatus(action);
  db.prepare(`
    UPDATE campaigns
    SET status = ?, change_time = datetime('now'), updated_at = datetime('now')
    WHERE advert_id = ?
  `).run(nextStatus, advertId);

  logEntry(db, {
    advertId,
    action,
    beforeStatus: camp.status,
    afterStatus: nextStatus,
    wbStatus: wbRes.status,
    wbResponse: wbText.slice(0, 2000),
    ourStatus: "ok",
    error: null,
    durationMs: Date.now() - t0,
  });

  auditMutation(request, {
    action: `campaign-${action}`,
    targetType: "advert",
    targetId: advertId,
    status: "success",
    details: { beforeStatus: camp.status, afterStatus: nextStatus },
  });

  return NextResponse.json({
    ok: true,
    advertId,
    action,
    actionLabel: actionLabel(action),
    beforeStatus: camp.status,
    status: nextStatus,
  });
}
