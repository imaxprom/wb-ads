import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const db = getDb();
  const sp = request.nextUrl.searchParams;
  const advertId = Number(sp.get("advertId") || "0");
  const phrase = sp.get("phrase");
  const status = sp.get("status"); // ok | no_ad | no_organic | both_none | parser_error | ssh_error
  const limit = Math.min(1000, Math.max(1, Number(sp.get("limit") || "200")));

  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (advertId) { conditions.push("advert_id = ?"); params.push(advertId); }
  if (phrase) { conditions.push("norm_query = ?"); params.push(phrase); }
  if (status) { conditions.push("status = ?"); params.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db.prepare(`
    SELECT id, advert_id, nm_id, norm_query, ad_pos, organic_pos, boost,
           is_advertised, status, via, elapsed_sec, raw_error, recorded_at
    FROM position_sync_log
    ${where}
    ORDER BY id DESC
    LIMIT ?
  `).all(...params, limit);

  // Сводка по статусам за последний час
  const summary = db.prepare(`
    SELECT status, COUNT(*) cnt
    FROM position_sync_log
    WHERE recorded_at >= datetime('now', '-1 hour')
    ${advertId ? "AND advert_id = ?" : ""}
    GROUP BY status
  `).all(...(advertId ? [advertId] : [])) as { status: string; cnt: number }[];

  return NextResponse.json({
    ok: true,
    rows,
    summary: Object.fromEntries(summary.map((s) => [s.status, s.cnt])),
    limit,
  });
}
