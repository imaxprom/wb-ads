import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiKey } from "@/lib/api-key";
import { getHotCampaignAdvertIds } from "@/lib/campaign-queue";
import { Client } from "pg";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BASE = "https://advert-api.wildberries.ru";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

interface Bid { advert_id: number; nm_id: number; norm_query: string; bid: number }

export async function POST(request: NextRequest) {
  const db = getDb();
  const apiKey = getApiKey();
  const sp = request.nextUrl.searchParams;

  // Determine which (advert_id, nm_id) pairs to query.
  const idsParam = sp.get("advertIds");
  let advertIds: number[];
  if (idsParam) {
    advertIds = idsParam.split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
  } else {
    // Только «горячие» кампании. Остальные — через ?advertIds=... или test-panel.
    advertIds = getHotCampaignAdvertIds(db);
  }
  if (advertIds.length === 0) return NextResponse.json({ ok: true, bidsWritten: 0 });

  // Build pairs from campaign_stats_by_nm (nm_ids that actually had impressions)
  const ph = advertIds.map(() => "?").join(",");
  const pairs = db.prepare(`
    SELECT DISTINCT advert_id, nm_id FROM campaign_stats_by_nm
    WHERE advert_id IN (${ph}) AND (views > 0 OR clicks > 0)
  `).all(...advertIds) as { advert_id: number; nm_id: number }[];
  if (pairs.length === 0) return NextResponse.json({ ok: true, bidsWritten: 0, note: "no active nm_ids" });

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO campaign_keyword_bids
      (advert_id, nm_id, norm_query, bid, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
  const delPairs = db.prepare("DELETE FROM campaign_keyword_bids WHERE advert_id = ? AND nm_id = ?");

  const errors: string[] = [];
  let bidsWritten = 0;
  let pairsOk = 0;
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const pg = databaseUrl ? new Client({ connectionString: databaseUrl }) : null;

  // Rate limit: 5 req/sec, batch 1 pair per request (API accepts multiple but
  // responses aren't labeled clearly enough — pair-level is simpler & safe).
  const GAP_MS = 250;

  if (pg) await pg.connect();
  try {
    for (const { advert_id, nm_id } of pairs) {
      try {
        const res = await fetch(`${BASE}/adv/v0/normquery/get-bids`, {
          method: "POST",
          headers: { "Authorization": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ items: [{ advert_id, nm_id }] }),
        });
        if (res.status === 429) {
          errors.push(`${advert_id}/${nm_id}: 429 → pause 5s`);
          await sleep(5000);
          continue;
        }
        if (!res.ok) { errors.push(`${advert_id}/${nm_id}: ${res.status}`); await sleep(GAP_MS); continue; }
        const data = await res.json();
        const bids: Bid[] = Array.isArray(data?.bids) ? data.bids : [];

        if (pg) {
          await pg.query("BEGIN");
          try {
            await pg.query("DELETE FROM campaign_keyword_bids WHERE advert_id = $1 AND nm_id = $2", [advert_id, nm_id]);
            for (const b of bids) {
              const info = await pg.query(`
                INSERT INTO campaign_keyword_bids
                  (advert_id, nm_id, norm_query, bid, updated_at)
                VALUES ($1, $2, $3, $4, now()::text)
              `, [b.advert_id, b.nm_id, b.norm_query, b.bid]);
              bidsWritten += info.rowCount ?? 0;
            }
            await pg.query("COMMIT");
          } catch (e) {
            await pg.query("ROLLBACK").catch(() => {});
            throw e;
          }
        } else {
          db.transaction(() => {
            delPairs.run(advert_id, nm_id);
            for (const b of bids) {
              stmt.run(b.advert_id, b.nm_id, b.norm_query, b.bid);
              bidsWritten++;
            }
          })();
        }
        pairsOk++;
      } catch (e) {
        errors.push(`${advert_id}/${nm_id}: ${e instanceof Error ? e.message : String(e)}`);
      }
      await sleep(GAP_MS);
    }
  } finally {
    if (pg) await pg.end();
  }

  return NextResponse.json({ ok: true, pairs: pairsOk, bidsWritten, errors });
}
