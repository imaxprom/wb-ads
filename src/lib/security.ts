import { NextRequest } from "next/server";
import { getDb } from "./db";

const g = globalThis as unknown as {
  __wbAdsRateLimit?: Map<string, number[]>;
};

function rateMap() {
  if (!g.__wbAdsRateLimit) g.__wbAdsRateLimit = new Map();
  return g.__wbAdsRateLimit;
}

export function checkRateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const since = now - windowMs;
  const map = rateMap();
  const hits = (map.get(key) || []).filter((ts) => ts > since);
  if (hits.length >= limit) {
    const retryAfterMs = Math.max(1000, windowMs - (now - hits[0]));
    map.set(key, hits);
    return { ok: false, retryAfterSec: Math.ceil(retryAfterMs / 1000) };
  }
  hits.push(now);
  map.set(key, hits);
  return { ok: true };
}

export function rateLimitKey(req: NextRequest, action: string, target?: string | number | null): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local";
  return `${action}:${target ?? "global"}:${ip}`;
}

function ensureAuditTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS security_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT DEFAULT (datetime('now')),
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      status TEXT NOT NULL,
      method TEXT,
      path TEXT,
      ip TEXT,
      user_agent TEXT,
      details_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_security_audit_at ON security_audit_log(at DESC);
    CREATE INDEX IF NOT EXISTS idx_security_audit_action ON security_audit_log(action, at DESC);
  `);
  return db;
}

export function auditMutation(req: NextRequest, row: {
  action: string;
  targetType?: string;
  targetId?: string | number | null;
  status: "accepted" | "success" | "blocked" | "failed";
  details?: Record<string, unknown>;
}) {
  try {
    const db = ensureAuditTable();
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null;
    db.prepare(`
      INSERT INTO security_audit_log
        (action, target_type, target_id, status, method, path, ip, user_agent, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.action,
      row.targetType || null,
      row.targetId == null ? null : String(row.targetId),
      row.status,
      req.method,
      req.nextUrl.pathname,
      ip,
      req.headers.get("user-agent"),
      row.details ? JSON.stringify(row.details).slice(0, 4000) : null,
    );
  } catch (e) {
    console.warn("[security] audit failed:", e);
  }
}
