import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiKey } from "@/lib/api-key";

const BASE = "https://advert-api.wildberries.ru";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export async function POST() {
  const apiKey = getApiKey();
  const db = getDb();
  const errors: string[] = [];
  let statsCount = 0, bidsCount = 0;

  const campaigns = db.prepare("SELECT advert_id, nms_json FROM campaigns WHERE status = 9 AND payment_type = 'cpm'").all() as { advert_id: number; nms_json: string }[];
  const items: { advert_id: number; nm_id: number }[] = [];
  for (const c of campaigns) {
    for (const nmId of JSON.parse(c.nms_json || "[]")) {
      items.push({ advert_id: c.advert_id, nm_id: nmId });
    }
  }
  if (items.length === 0) return NextResponse.json({ ok: true, stats: 0, bids: 0 });

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const weekAgoDate = new Date(Date.now() - 7 * 86400000);
  const weekAgo = `${weekAgoDate.getFullYear()}-${String(weekAgoDate.getMonth() + 1).padStart(2, "0")}-${String(weekAgoDate.getDate()).padStart(2, "0")}`;

  // Stats
  try {
    const res = await fetch(`${BASE}/adv/v0/normquery/stats`, {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ from: weekAgo, to: today, items }),
    });
    if (res.ok) {
      const data = await res.json();
      const stmt = db.prepare(`INSERT OR REPLACE INTO search_cluster_stats (advert_id, nm_id, norm_query, date, views, clicks, ctr, cpc, cpm, orders, avg_pos, atbs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertStats = db.transaction(() => {
        for (const group of data.stats || []) {
          for (const s of group.stats || []) {
            stmt.run(group.advert_id, group.nm_id, s.norm_query, today, s.views, s.clicks, s.ctr, s.cpc, s.cpm, s.orders, s.avg_pos, s.atbs);
            statsCount++;
          }
        }
      });
      insertStats();
    } else { errors.push(`normquery/stats: ${res.status}`); }
  } catch (e) { errors.push(`normquery/stats: ${e instanceof Error ? e.message : String(e)}`); }

  await sleep(200);

  // Bids
  try {
    const res = await fetch(`${BASE}/adv/v0/normquery/get-bids`, {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    if (res.ok) {
      const data = await res.json();
      const stmt = db.prepare(`INSERT OR REPLACE INTO search_cluster_bids (advert_id, nm_id, norm_query, bid_kopecks, updated_at) VALUES (?, ?, ?, ?, datetime('now'))`);
      const insertBids = db.transaction(() => {
        for (const b of data.bids || []) {
          stmt.run(b.advert_id, b.nm_id, b.norm_query, b.bid_kopecks);
          bidsCount++;
        }
      });
      insertBids();
    }
  } catch (e) { errors.push(`normquery/get-bids: ${e instanceof Error ? e.message : String(e)}`); }

  return NextResponse.json({ ok: true, stats: statsCount, bids: bidsCount, errors });
}
