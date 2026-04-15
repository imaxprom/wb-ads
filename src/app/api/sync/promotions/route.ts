import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiKey } from "@/lib/api-key";

const BASE = "https://dp-calendar-api.wildberries.ru";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export async function POST() {
  const apiKey = getApiKey();
  const db = getDb();
  const errors: string[] = [];

  // Our nm_ids
  const products = db.prepare("SELECT nm_id FROM products").all() as { nm_id: number }[];
  const ourNmIds = new Set(products.map((p) => p.nm_id));
  if (ourNmIds.size === 0) return NextResponse.json({ ok: true, promos: 0, products: 0 });

  // 1. Get active promotions (today ± 7 days)
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 86400000).toISOString().replace(/\.\d+Z/, "Z");
  const end = new Date(now.getTime() + 30 * 86400000).toISOString().replace(/\.\d+Z/, "Z");

  let promos: { id: number; name: string; type: string; startDateTime: string; endDateTime: string }[] = [];
  try {
    const res = await fetch(
      `${BASE}/api/v1/calendar/promotions?startDateTime=${start}&endDateTime=${end}&allPromo=true&limit=1000&offset=0`,
      { headers: { Authorization: apiKey } }
    );
    if (res.ok) {
      const data = await res.json();
      promos = data?.data?.promotions || [];
    } else {
      errors.push(`promotions list: ${res.status}`);
    }
  } catch (e) {
    errors.push(`promotions list: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Filter: only currently active (today within start-end) and regular type
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const activePromos = promos.filter(
    (p) => p.type === "regular" && p.startDateTime.slice(0, 10) <= today && p.endDateTime.slice(0, 10) >= today
  );

  // 2. For each active promo, check which of our products participate
  // Rate limit: 10 req / 6 sec → pause 700ms between requests
  let totalFound = 0;

  // Clear old data
  db.exec("DELETE FROM product_promotions");

  const insert = db.prepare(`
    INSERT OR REPLACE INTO product_promotions (nm_id, promo_id, promo_name, promo_type, start_date, end_date, plan_discount)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const promo of activePromos) {
    await sleep(700);
    try {
      const res = await fetch(
        `${BASE}/api/v1/calendar/promotions/nomenclatures?promotionID=${promo.id}&inAction=true&limit=1000&offset=0`,
        { headers: { Authorization: apiKey } }
      );
      if (!res.ok) {
        if (res.status === 429) await sleep(3000);
        continue;
      }

      const data = await res.json();
      const noms = data?.data?.nomenclatures || [];

      const insertBatch = db.transaction(() => {
        for (const n of noms) {
          if (!ourNmIds.has(n.id)) continue;
          insert.run(
            n.id, promo.id, promo.name, promo.type,
            promo.startDateTime.slice(0, 10), promo.endDateTime.slice(0, 10),
            n.planDiscount || null
          );
          totalFound++;
        }
      });
      insertBatch();
    } catch {
      // skip individual promo errors
    }
  }

  return NextResponse.json({
    ok: true,
    promosChecked: activePromos.length,
    productsInPromos: totalFound,
    errors,
  });
}
