import { getDb } from "./db";
import { localDateStr } from "./format";

export function logSync(type: string, total: number, success: number, errors: string[], startTime: number) {
  const db = getDb();
  const now = new Date();
  const duration = (Date.now() - startTime) / 1000;
  db.prepare(`
    INSERT INTO sync_log (type, started_at, finished_at, total, success, errors, error_details, duration_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    type,
    localDateStr(new Date(startTime)) + " " + new Date(startTime).toTimeString().slice(0, 8),
    localDateStr(now) + " " + now.toTimeString().slice(0, 8),
    total,
    success,
    errors.length,
    errors.length > 0 ? JSON.stringify(errors) : null,
    Math.round(duration * 10) / 10,
  );
}
