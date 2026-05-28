import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDb } from "@/lib/db";
import { getApiKey, getPricesApiKey } from "@/lib/api-key";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type PublicCardPrice = {
  nmId: number;
  basePrice: number;
  minBasePrice: number;
  maxBasePrice: number;
};

function toRub(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n / 100);
}

async function fetchPublicCardPrice(nmId: number): Promise<PublicCardPrice> {
  const url = `https://card.wb.ru/cards/v4/detail?appType=1&curr=rub&dest=-1257786&spp=30&nm=${nmId}`;
  const { stdout } = await execFileAsync("curl", [
    "-sS",
    "-L",
    "--max-time",
    "10",
    "-A",
    "Mozilla/5.0",
    url,
  ], { maxBuffer: 1024 * 1024, timeout: 12000 });

  const data = JSON.parse(stdout);
  const product = data?.products?.[0];
  const sizes = Array.isArray(product?.sizes) ? product.sizes : [];
  const basePrices: number[] = [];

  for (const size of sizes) {
    const price = size?.price;
    if (!price) continue;
    const base = toRub(price.basic);
    if (base) basePrices.push(base);
  }

  if (basePrices.length === 0) {
    throw new Error(`public-card base price is empty for nmId=${nmId}`);
  }

  return {
    nmId,
    basePrice: basePrices[0],
    minBasePrice: Math.min(...basePrices),
    maxBasePrice: Math.max(...basePrices),
  };
}

export async function POST() {
  const apiKey = getApiKey();
  const pricesApiKey = getPricesApiKey();
  const db = getDb();
  const errors: string[] = [];
  const warnings: string[] = [];
  const health = {
    content: { ok: false, cards: 0, pages: 0 },
    prices: {
      ok: false,
      attempted: false,
      pages: 0,
      goodsSeen: 0,
      pricesUpdated: 0,
      source: "",
      status: 0 as number | string,
      retryable: true,
      fallback: {
        attempted: false,
        ok: false,
        source: "public-card-v4",
        cardsSeen: 0,
        pricesUpdated: 0,
        errors: [] as string[],
      },
    },
    ratings: {
      ok: false,
      attempted: false,
      productsSeen: 0,
      ratingsUpdated: 0,
      status: 0 as number | string,
    },
  };

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
    health.content.pages++;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      errors.push(`content-api cards page ${i + 1}: HTTP ${res.status} ${text.slice(0, 160)}`);
      break;
    }
    const data = await res.json();
    const cards = data?.cards || [];
    allCards.push(...cards);
    const cur = data?.cursor;
    if (!cur || cur.total === 0 || cards.length === 0) break;
    cursor = { limit: 100, updatedAt: cur.updatedAt, nmID: cur.nmID };
    await sleep(200);
  }
  health.content.cards = allCards.length;
  health.content.ok = allCards.length > 0 && errors.filter((e) => e.startsWith("content-api")).length === 0;
  if (allCards.length === 0) errors.push("content-api cards: zero cards received");

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
  const priceErrors: string[] = [];
  try {
    for (let offset = 0; offset < 10000; offset += 1000) {
      health.prices.attempted = true;
      const res = await fetch(
        `https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1000&offset=${offset}`,
        { headers: { Authorization: pricesApiKey } }
      );
      health.prices.pages++;
      health.prices.status = res.status;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const msg = `prices-api page offset=${offset}: HTTP ${res.status} ${text.slice(0, 240)}`;
        priceErrors.push(msg);
        if (res.status === 401 || res.status === 403) health.prices.retryable = false;
        break;
      }
      const data = await res.json();
      const goods = data?.data?.listGoods || [];
      health.prices.goodsSeen += goods.length;
      if (goods.length === 0) break;

      const updatePrice = db.prepare("UPDATE products SET price = ?, discount = ?, min_price = ?, max_price = ? WHERE nm_id = ?");
      const batch = db.transaction(() => {
        for (const g of goods) {
          const sizes = ((g.sizes as { price: number; discountedPrice?: number }[]) || []);
          if (sizes.length === 0) continue;
          const discounted = sizes
            .map((s) => (typeof s.discountedPrice === "number" ? s.discountedPrice : s.price))
            .filter((p) => p > 0);
          if (discounted.length === 0) continue;
          const minP = Math.round(Math.min(...discounted));
          const maxP = Math.round(Math.max(...discounted));
          const basePrice = sizes[0].price;
          updatePrice.run(basePrice, (g.discount as number) || 0, minP, maxP, g.nmID);
          pricesUpdated++;
        }
      });
      batch();
      await sleep(200);
    }
  } catch (e) {
    priceErrors.push(`prices-api: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (pricesUpdated > 0) {
    health.prices.source = "prices-api";
  }

  if (pricesUpdated === 0 && allCards.length > 0) {
    const updatePublicPrice = db.prepare("UPDATE products SET price = ?, min_price = ?, max_price = ? WHERE nm_id = ?");
    const getExistingDiscount = db.prepare("SELECT discount FROM products WHERE nm_id = ?");
    const uniqueNmIds = [...new Set(allCards.map((card) => Number(card.nmID)).filter((nmId) => Number.isFinite(nmId) && nmId > 0))];
    health.prices.fallback.attempted = true;
    health.prices.fallback.cardsSeen = uniqueNmIds.length;

    for (const nmId of uniqueNmIds) {
      try {
        const price = await fetchPublicCardPrice(nmId);
        const existing = getExistingDiscount.get(nmId) as { discount: number | null } | undefined;
        const sellerDiscount = Math.max(0, Math.min(99, Number(existing?.discount || 0)));
        const factor = (100 - sellerDiscount) / 100;
        const minPrice = Math.round(price.minBasePrice * factor);
        const maxPrice = Math.round(price.maxBasePrice * factor);
        updatePublicPrice.run(price.basePrice, minPrice, maxPrice, price.nmId);
        pricesUpdated++;
        health.prices.fallback.pricesUpdated++;
      } catch (e) {
        health.prices.fallback.errors.push(e instanceof Error ? e.message : String(e));
      }
      await sleep(120);
    }

    health.prices.fallback.ok = health.prices.fallback.pricesUpdated > 0;
    if (health.prices.fallback.ok) {
      health.prices.source = "public-card-v4";
      warnings.push(...priceErrors);
      if (health.prices.fallback.errors.length > 0) {
        warnings.push(`public-card-v4: ${health.prices.fallback.errors.length} products without fallback price`);
      }
    }
  }

  if (pricesUpdated === 0) {
    errors.push(...priceErrors);
  }
  health.prices.pricesUpdated = pricesUpdated;
  health.prices.ok = health.prices.attempted && pricesUpdated > 0;
  if (health.prices.attempted && pricesUpdated === 0) {
    errors.push("prices-api: zero prices updated");
  }

  // 4. Fetch ratings from sales-funnel/products API (official, authorized)
  let ratingsUpdated = 0;
  try {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    health.ratings.attempted = true;
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
    health.ratings.status = res.status;

    if (res.ok) {
      const data = await res.json();
      const products = data?.data?.products || [];
      health.ratings.productsSeen = products.length;

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
    } else {
      const text = await res.text().catch(() => "");
      warnings.push(`ratings-api: HTTP ${res.status} ${text.slice(0, 160)}`);
    }
  } catch (e) {
    warnings.push(`ratings-api: ${e instanceof Error ? e.message : String(e)}`);
  }
  health.ratings.ratingsUpdated = ratingsUpdated;
  health.ratings.ok = health.ratings.attempted && warnings.every((w) => !w.startsWith("ratings-api")) && ratingsUpdated > 0;
  if (health.ratings.attempted && ratingsUpdated === 0) {
    warnings.push("ratings-api: zero ratings updated");
  }

  const ok = errors.length === 0;
  return NextResponse.json({
    ok,
    retryable: health.prices.retryable,
    products: allCards.length,
    pricesUpdated,
    ratingsUpdated,
    warnings,
    errors,
    health,
  }, { status: ok ? 200 : 502 });
}
