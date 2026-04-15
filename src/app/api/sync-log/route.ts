import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { localDateStr } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const logs = db.prepare(`
    SELECT id, type, started_at, finished_at, total, success, errors, error_details, duration_sec
    FROM sync_log
    ORDER BY id DESC
    LIMIT 100
  `).all() as {
    id: number; type: string; started_at: string; finished_at: string;
    total: number; success: number; errors: number;
    error_details: string | null; duration_sec: number;
  }[];

  // Check if any recent sync (last hour) had errors
  const recentErrors = db.prepare(`
    SELECT COUNT(*) as cnt FROM sync_log
    WHERE errors > 0 AND started_at >= datetime('now', '-1 hour')
  `).get() as { cnt: number };

  return NextResponse.json({ logs, hasRecentErrors: recentErrors.cnt > 0 });
}

// POST — log a sync step from client
export async function POST(request: NextRequest) {
  const db = getDb();
  const body = await request.json();
  const now = new Date();
  const ts = localDateStr(now) + " " + now.toTimeString().slice(0, 8);

  db.prepare(`
    INSERT INTO sync_log (type, started_at, finished_at, total, success, errors, error_details, duration_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    body.type || "unknown",
    body.started_at || ts,
    ts,
    body.total ?? 1,
    body.success ?? (body.ok ? 1 : 0),
    body.errors ?? (body.ok ? 0 : 1),
    body.error_details || null,
    body.duration_sec ?? 0,
  );

  return NextResponse.json({ ok: true });
}
