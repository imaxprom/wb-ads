import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { auditMutation } from "@/lib/security";
import { BID_LIMIT_KEYS, WB_MAX_BID_RUB } from "@/lib/bid-limits";

const ALLOWED_KEYS = new Set([
  "active_tab",
  "ad_panel_tab",
  "ad_queries_djem_sort",
  "ad_queries_filter",
  "ad_queries_v2_col_hidden",
  "ad_queries_v2_col_order",
  "ad_queries_v2_col_widths",
  "ads_col_hidden",
  "ads_col_order",
  "ads_col_widths",
  "ads_days",
  "ads_offset",
  "auto_sync_enabled",
  "auto_sync_interval",
  "col_hidden",
  "col_widths",
  "dashboard_offset",
  "dashboard_period",
  "deep_sync_date",
  "detail_col_hidden",
  "detail_col_order",
  "detail_col_widths",
  "last_sync_time",
  "mpstats_api_token",
  BID_LIMIT_KEYS.manualAuction,
  BID_LIMIT_KEYS.uni,
  BID_LIMIT_KEYS.cpc,
  "test_sync_config",
  "test_sync_auto_enabled",
  "test_sync_auto_interval",
  "test_sync_last_run",
  "test_log_ack_error_id",
  "sync_log_ack_error_id",
  "theme",
]);

const SENSITIVE_KEYS = new Set(["mpstats_api_token"]);
const BID_LIMIT_KEY_SET = new Set<string>(Object.values(BID_LIMIT_KEYS));

export async function GET() {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const result: Record<string, string> = {};
  for (const r of rows) {
    if (SENSITIVE_KEYS.has(r.key)) {
      result[`${r.key}_set`] = r.value ? "true" : "false";
      continue;
    }
    result[r.key] = r.value;
  }
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "object body required" }, { status: 400 });
  }
  const keys = Object.keys(body || {});
  const bad = keys.filter((key) => !ALLOWED_KEYS.has(key));
  if (bad.length > 0) {
    auditMutation(request, { action: "settings-update", targetType: "settings", status: "blocked", details: { reason: "unknown_keys", keys: bad } });
    return NextResponse.json({ ok: false, error: "unknown settings keys", keys: bad }, { status: 400 });
  }
  const badBidLimits = keys.filter((key) => {
    if (!BID_LIMIT_KEY_SET.has(key)) return false;
    const value = Number(body[key]);
    return !Number.isFinite(value) || Math.round(value) < 1 || Math.round(value) > WB_MAX_BID_RUB;
  });
  if (badBidLimits.length > 0) {
    auditMutation(request, { action: "settings-update", targetType: "settings", status: "blocked", details: { reason: "invalid_bid_limits", keys: badBidLimits } });
    return NextResponse.json({ ok: false, error: `bid limits must be from 1 to ${WB_MAX_BID_RUB} rub`, keys: badBidLimits }, { status: 400 });
  }
  const db = getDb();
  const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  const update = db.transaction(() => {
    for (const [key, value] of Object.entries(body)) {
      stmt.run(key, String(value));
    }
  });
  update();
  auditMutation(request, { action: "settings-update", targetType: "settings", status: "success", details: { keys } });
  return NextResponse.json({ ok: true });
}
