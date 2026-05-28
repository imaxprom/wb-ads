import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const BASE = process.env.WB_ADS_INTERNAL_BASE_URL || "http://127.0.0.1:3001";
const LOCAL_TOKEN = process.env.WB_ADS_LOCAL_TOKEN || "";

const g = globalThis as unknown as {
  __searchTextsAllProgress?: { current: number; total: number; running: boolean; ok: number; err: number };
  __syncCancelled?: boolean;
};

export async function GET() {
  const p = g.__searchTextsAllProgress || { current: 0, total: 0, running: false, ok: 0, err: 0 };
  return NextResponse.json(p);
}

// Обёртка: собирает все уникальные subject_id активных кампаний (status 9 или 11) и
// последовательно запускает sync для каждого через /api/sync/search-texts-wb.
// Вызывается планировщиком в 06:00 МСК или вручную (ручка ↻ в будущем).
export async function POST(request: NextRequest) {
  const db = getDb();
  const sp = request.nextUrl.searchParams;
  const interval = sp.get("interval") || "yesterday";
  const force = sp.get("force") === "1";

  const subjects = db.prepare(`
    SELECT DISTINCT subject_id
    FROM campaigns
    WHERE status IN (9, 11) AND subject_id IS NOT NULL AND subject_id > 0
    ORDER BY subject_id
  `).all() as { subject_id: number }[];

  if (subjects.length === 0) {
    return NextResponse.json({ ok: true, subjects: 0, note: "no active campaigns with subject_id" });
  }

  const results: Array<{ subjectId: number; ok: boolean; collected?: number; skipped?: boolean; error?: string }> = [];

  g.__searchTextsAllProgress = { current: 0, total: subjects.length, running: true, ok: 0, err: 0 };

  let okCount = 0, errCount = 0;
  for (let i = 0; i < subjects.length; i++) {
    if (g.__syncCancelled) { results.push({ subjectId: 0, ok: false, error: "cancelled" }); break; }
    const { subject_id } = subjects[i];
    g.__searchTextsAllProgress = { current: i, total: subjects.length, running: true, ok: okCount, err: errCount };
    try {
      const qs = new URLSearchParams({ subjectId: String(subject_id), interval });
      if (force) qs.set("force", "1");
      const headers = LOCAL_TOKEN ? { "x-local-token": LOCAL_TOKEN } : undefined;
      const res = await fetch(`${BASE}/api/sync/search-texts-wb?${qs.toString()}`, { method: "POST", headers });
      const d = await res.json();
      results.push({
        subjectId: subject_id,
        ok: Boolean(d.ok),
        collected: d.collected,
        skipped: d.skipped,
        error: d.error,
      });
      if (d.ok) okCount++; else errCount++;
    } catch (e) {
      results.push({ subjectId: subject_id, ok: false, error: String(e) });
      errCount++;
    }
  }

  g.__searchTextsAllProgress = { current: subjects.length, total: subjects.length, running: false, ok: okCount, err: errCount };

  const totalCollected = results.reduce((s, r) => s + (r.collected || 0), 0);
  return NextResponse.json({
    ok: true,
    interval,
    subjects: subjects.length,
    totalCollected,
    results,
  });
}
