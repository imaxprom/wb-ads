import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { callWbParserPositions } from "@/lib/wb-parser-rpc";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Call the Russia-based wb-parser server via SSH to fetch real promo/organic
// positions. Bypasses WB geo-block on the Mac by using curl_cffi + proxies on
// the remote (already configured in ~/wb-parser/proxy_positions.py).
async function sshPositions(article: number, keywords: string[]): Promise<{
  ok: boolean;
  elapsed?: number;
  data?: Record<string, { promo_pos: number | null; organic_pos: number | null; is_advertised: boolean }>;
  error?: string;
}> {
  return callWbParserPositions(article, keywords);
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const sp = request.nextUrl.searchParams;
  const advertId = Number(sp.get("advertID") || "0");
  if (!advertId) return NextResponse.json({ ok: false, error: "advertID required" }, { status: 400 });

  // Pick top phrases for this campaign grouped by nm_id — each nm_id batched
  // into one SSH call (proxy_positions.get_positions takes 1 article + N keywords).
  const topRows = db.prepare(`
    SELECT nm_id, norm_query, SUM(views) views
    FROM campaign_keyword_stats_daily
    WHERE advert_id = ? AND date >= date('now', '-7 days')
    GROUP BY nm_id, norm_query
    ORDER BY views DESC
    LIMIT 20
  `).all(advertId) as { nm_id: number; norm_query: string; views: number }[];

  if (topRows.length === 0) return NextResponse.json({ ok: true, processed: 0, note: "нет активных фраз" });

  // Group by nm_id
  const byNm = new Map<number, string[]>();
  for (const r of topRows) {
    const list = byNm.get(r.nm_id) || [];
    list.push(r.norm_query);
    byNm.set(r.nm_id, list);
  }

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO campaign_phrase_positions
      (advert_id, nm_id, norm_query, ad_pos, organic_pos, boost, preset_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const errors: string[] = [];
  let processed = 0;
  let totalElapsed = 0;

  for (const [nm_id, keywords] of byNm) {
    const resp = await sshPositions(nm_id, keywords);
    if (!resp.ok || !resp.data) {
      errors.push(`${nm_id}: ${resp.error || "no data"}`);
      continue;
    }
    totalElapsed += resp.elapsed || 0;
    db.transaction(() => {
      for (const [phrase, info] of Object.entries(resp.data!)) {
        const adPos = info.promo_pos || 0;
        const orgPos = info.organic_pos || 0;
        const boost = (orgPos > 0 && adPos > 0) ? orgPos - adPos : 0;
        stmt.run(advertId, nm_id, phrase, adPos, orgPos, boost, "");
        processed++;
      }
    })();
  }

  return NextResponse.json({ ok: true, processed, serverElapsed: totalElapsed, errors });
}
