import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { localDateStr } from "@/lib/format";
import { ensureBrowser } from "@/lib/ensure-browser";

/**
 * Sync funnel data via Puppeteer browser (auth_wb).
 *
 * Approach based on EVIRMA 2 extension analysis:
 * 1. Read access token from localStorage["wb-eu-passport-v2.access-token"]
 * 2. Make fetch with Authorizev3 header + credentials: "include"
 * 3. Use /v1/sales-funnel/report/product/history for daily breakdown
 */

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

const g = globalThis as unknown as {
  __wbSniffPage?: import("puppeteer").Page | null;
  __wbSniffRunning?: boolean;
  __djemProgress?: { current: number; total: number; nmId: number; running: boolean };
};

const FUNNEL_BASE = "https://seller-content.wildberries.ru/ns/analytics-api/content-analytics/api/v1/sales-funnel";

export async function GET() {
  const progress = g.__djemProgress || { current: 0, total: 0, nmId: 0, running: false };
  return NextResponse.json(progress);
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const days = Math.min(90, Math.max(1, Number(request.nextUrl.searchParams.get("days") || "7")));
  const errors: string[] = [];
  const startTime = Date.now();

  let page = g.__wbSniffPage;
  if (!page || !g.__wbSniffRunning) {
    const auto = await ensureBrowser();
    if (!auto.page) {
      return NextResponse.json({ ok: false, error: auto.error || "Браузер не запущен" }, { status: 400 });
    }
    page = auto.page;
  }

  // Ensure we're on seller portal
  const currentUrl = page.url();
  if (!currentUrl.includes("seller.wildberries.ru") || currentUrl.includes("seller-auth") || currentUrl.includes("about-portal")) {
    try {
      await page.goto("https://seller.wildberries.ru/analytics/sales-funnel", {
        waitUntil: "networkidle2",
        timeout: 15000,
      });
    } catch {
      return NextResponse.json({ ok: false, error: "Не удалось открыть seller.wildberries.ru. Авторизуйтесь в браузере." }, { status: 400 });
    }
  }

  // Step 1: Read access token from localStorage (as EVIRMA does)
  const accessToken = await page.evaluate(() => {
    return localStorage.getItem("wb-eu-passport-v2.access-token");
  });

  if (!accessToken) {
    return NextResponse.json({
      ok: false,
      error: "Не найден access-token в localStorage. Убедитесь, что вы авторизованы в seller.wildberries.ru",
    }, { status: 400 });
  }

  const endDate = localDateStr(new Date());
  const startDate = localDateStr(new Date(Date.now() - (days - 1) * 86400000));

  const nmIds = (db.prepare("SELECT nm_id FROM products").all() as { nm_id: number }[]).map((r) => r.nm_id);
  if (nmIds.length === 0) {
    return NextResponse.json({ ok: true, synced: 0, errors: ["Нет товаров"] });
  }

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO auth_wb_funnel_daily
      (nm_id, date, view_count, open_card_count, add_to_cart_count, add_to_wishlist_count,
       orders_count, orders_sum, buyouts_count, buyouts_sum, cancel_count, cancel_sum,
       view_to_open_conversion, open_to_cart_conversion, cart_to_order_conversion, buyout_percent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let totalSynced = 0;
  const PARALLEL = 3;
  g.__djemProgress = { current: 0, total: nmIds.length, nmId: 0, running: true };

  // Process in chunks of PARALLEL
  for (let chunkStart = 0; chunkStart < nmIds.length; chunkStart += PARALLEL) {
    const chunk = nmIds.slice(chunkStart, chunkStart + PARALLEL);
    g.__djemProgress = { current: chunkStart + chunk.length, total: nmIds.length, nmId: chunk[0], running: true };

    try {
      // Send all chunk requests in parallel inside one page.evaluate
      const results = await page.evaluate(
        async (url: string, nmIDs: number[], start: string, end: string, token: string) => {
          const promises = nmIDs.map(async (nmID) => {
            try {
              const res = await fetch(url, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorizev3": token,
                },
                body: JSON.stringify({
                  nmID,
                  currentPeriod: { start, end },
                }),
                credentials: "include",
              });
              if (!res.ok) {
                const text = await res.text().catch(() => "");
                return { nmID, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
              }
              const json = await res.json();
              return { nmID, ...json };
            } catch (e) {
              return { nmID, error: String(e) };
            }
          });
          return Promise.all(promises);
        },
        `${FUNNEL_BASE}/report/product/history`,
        chunk,
        startDate,
        endDate,
        accessToken,
      ) as { nmID: number; data?: Record<string, unknown>[]; error?: string }[];

      // Process results
      const insertBatch = db.transaction(() => {
        for (const result of results) {
          if (result.error) {
            errors.push(`nm ${result.nmID}: ${result.error}`);
            continue;
          }
          const daysData = result.data || [];
          if (Array.isArray(daysData)) {
            for (const day of daysData) {
              const d = day as Record<string, { current?: number }>;
              stmt.run(
                result.nmID,
                day.date,
                d.viewCount?.current || 0,
                d.openCardCount?.current || 0,
                d.addToCartCount?.current || 0,
                d.addToWishlistCount?.current || 0,
                d.orderCount?.current || 0,
                d.orderSum?.current || 0,
                d.buyoutCount?.current || 0,
                d.buyoutSum?.current || 0,
                d.cancelCount?.current || 0,
                d.cancelSum?.current || 0,
                d.viewToOpenConversion?.current || 0,
                d.openToCartConversion?.current || 0,
                d.cartToOrderConversion?.current || 0,
                d.buyoutPercent?.current || 0,
              );
              totalSynced++;
            }
          }
        }
      });
      insertBatch();
    } catch (err) {
      errors.push(`chunk [${chunk.join(",")}]: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Rate limit: pause between chunks
    await sleep(1000);
  }

  g.__djemProgress = { current: nmIds.length, total: nmIds.length, nmId: 0, running: false };

  return NextResponse.json({
    ok: true,
    synced: totalSynced,
    products: nmIds.length,
    period: { start: startDate, end: endDate },
    errors,
  });
}
