import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiKey } from "@/lib/api-key";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST() {
  const apiKey = getApiKey();
  const db = getDb();

  // 1. Fetch all cards from WB Content API
  const allCards: Record<string, unknown>[] = [];
  let cursor: Record<string, unknown> = { limit: 100 };

  for (let i = 0; i < 20; i++) {
    const res = await fetch(
      "https://content-api.wildberries.ru/content/v2/get/cards/list",
      {
        method: "POST",
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { sort: { ascending: false }, cursor, filter: { withPhoto: -1 } },
        }),
      }
    );
    if (!res.ok) break;
    const data = await res.json();
    const cards = data?.cards || [];
    allCards.push(...cards);
    const cur = data?.cursor;
    if (!cur || cur.total === 0 || cards.length === 0) break;
    cursor = { limit: 100, updatedAt: cur.updatedAt, nmID: cur.nmID };
    await sleep(200);
  }

  // 2. Upsert cards into products
  const upsert = db.prepare(`
    INSERT INTO products (nm_id, vendor_code, title, subject, brand, colors, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(nm_id) DO UPDATE SET
      vendor_code = excluded.vendor_code, title = excluded.title,
      subject = excluded.subject, brand = excluded.brand,
      colors = excluded.colors, updated_at = datetime('now')
  `);

  const insertCards = db.transaction(() => {
    for (const card of allCards) {
      const chars = (card.characteristics as { name: string; value: unknown }[]) || [];
      const colorChar = chars.find((c) => c.name?.toLowerCase().includes("цвет"));
      const colors = Array.isArray(colorChar?.value)
        ? (colorChar.value as string[]).join(", ")
        : colorChar?.value ? String(colorChar.value) : null;
      upsert.run(card.nmID, card.vendorCode || null, card.title || null,
        card.subjectName || null, card.brand || null, colors);
    }
  });
  insertCards();

  // 3. Fetch prices from WB Prices API
  let pricesUpdated = 0;
  try {
    for (let offset = 0; offset < 10000; offset += 1000) {
      const res = await fetch(
        `https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1000&offset=${offset}`,
        { headers: { Authorization: apiKey } }
      );
      if (!res.ok) break;
      const data = await res.json();
      const goods = data?.data?.listGoods || [];
      if (goods.length === 0) break;

      const updatePrice = db.prepare("UPDATE products SET price = ?, discount = ? WHERE nm_id = ?");
      const batch = db.transaction(() => {
        for (const g of goods) {
          const sz = ((g.sizes as { price: number }[]) || [])[0];
          if (sz) { updatePrice.run(sz.price, (g.discount as number) || 0, g.nmID); pricesUpdated++; }
        }
      });
      batch();
      await sleep(200);
    }
  } catch { /* skip */ }

  // 4. Fetch ratings from sales-funnel/products API (official, authorized)
  let ratingsUpdated = 0;
  try {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const res = await fetch(
      "https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products",
      {
        method: "POST",
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          brandNames: [], subjectIds: [], tagIds: [],
          selectedPeriod: { start: today, end: today },
          aggregationLevel: "day", page: 1,
        }),
      }
    );

    if (res.ok) {
      const data = await res.json();
      const products = data?.data?.products || [];

      const updateRating = db.prepare(
        "UPDATE products SET rating = ? WHERE nm_id = ?"
      );

      const batch = db.transaction(() => {
        for (const p of products) {
          const prod = p.product || {};
          const fbRating = prod.feedbackRating || null;
          if (fbRating != null) {
            updateRating.run(fbRating, prod.nmId);
            ratingsUpdated++;
          }
        }
      });
      batch();
    }
  } catch { /* skip */ }

  return NextResponse.json({ ok: true, products: allCards.length, pricesUpdated, ratingsUpdated });
}
