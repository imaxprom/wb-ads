import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiKey } from "@/lib/api-key";
import { localDateStr } from "@/lib/format";

const BASE = "https://seller-analytics-api.wildberries.ru";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function formatDate(d: Date): string { return localDateStr(d); }

export async function POST(request: NextRequest) {
  const apiKey = getApiKey();
  const db = getDb();
  const errors: string[] = [];

  // ?days=1 syncs only today, ?days=14 syncs last 14 days (default: 3 days)
  const daysParam = Number(request.nextUrl.searchParams.get("days") || "3");
  const daysToSync = Math.min(14, Math.max(1, daysParam));

  // Get all tracked nm_ids from products table
  const ourNmIds = new Set<number>(
    (db.prepare("SELECT nm_id FROM products").all() as { nm_id: number }[]).map((r) => r.nm_id)
  );

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO sales_funnel_daily
      (nm_id, date, open_card_count, add_to_cart_count, orders_count, orders_sum,
       buyouts_count, buyouts_sum, cancel_count,
       add_to_cart_conversion, cart_to_order_conversion, buyout_percent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let totalCount = 0;

  for (let dayOffset = daysToSync - 1; dayOffset >= 0; dayOffset--) {
    const date = new Date(Date.now() - dayOffset * 86400000);
    const dateStr = formatDate(date);

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${BASE}/api/analytics/v3/sales-funnel/products`, {
          method: "POST",
          headers: { Authorization: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            brandNames: [], subjectIds: [], tagIds: [],
            selectedPeriod: { start: dateStr, end: dateStr },
            aggregationLevel: "day", page: 1,
          }),
        });

        if (res.status === 429) {
          await sleep(attempt === 0 ? 10000 : 20000);
          continue;
        }
        if (!res.ok) { errors.push(`funnel ${dateStr}: ${res.status}`); break; }

        const data = await res.json();
        const products = data?.data?.products || [];

        const insertDay = db.transaction(() => {
          for (const p of products) {
            if (!ourNmIds.has(p.product.nmId)) continue;
            const s = p.statistic.selected;
            const conv = s.conversions || {};
            stmt.run(p.product.nmId, dateStr, s.openCount, s.cartCount, s.orderCount, s.orderSum, s.buyoutCount, s.buyoutSum, s.cancelCount, conv.addToCartPercent ?? 0, conv.cartToOrderPercent ?? 0, conv.buyoutPercent ?? 0);
            totalCount++;
          }
        });
        insertDay();
        break;
      } catch (e) {
        if (attempt === 1) errors.push(`funnel ${dateStr}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await sleep(3000);
  }

  return NextResponse.json({ ok: true, synced: totalCount, errors });
}
