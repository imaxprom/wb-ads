import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBrowser } from "@/lib/ensure-browser";
import { localDateStr } from "@/lib/format";
import { fetchDjemForNmId } from "@/lib/wb-djem-stats";
import type { SellerSession } from "@/lib/wb-search-texts-xlsx";
import { loadSavedSellerSession } from "@/lib/wb-seller-session";
import { dbTimestampAgeMs } from "@/lib/db-time";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Синк Джема per-nmId: 3 запроса в seller-content analytics API с разными topOrderBy,
// мёрдж по фразе, upsert в phrase_djem_stats. Период фиксированный 90 дней (today-89..today MSK).
//
// Cache: 1 час на пару (nm_id), т.к. данные за сегодня обновляются редко, а 90-дневное окно
// «съезжает» только в полночь МСК. force=1 — принудительный ресинк.
//
// Authorizev3 токен достаём из Puppeteer-профиля seller-кабинета (та же схема, что у premium
// search-analysis через downloadSearchTextsXlsx).

const CACHE_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  const db = getDb();
  const sp = request.nextUrl.searchParams;
  const nmId = Number(sp.get("nmId") || "0");
  const force = sp.get("force") === "1";
  const debug = sp.get("debug") === "1";

  if (!nmId) return NextResponse.json({ ok: false, error: "nmId required" }, { status: 400 });

  // Период 90 дней по МСК, включая сегодня
  const endDate = localDateStr(new Date());
  const startDate = localDateStr(new Date(Date.now() - 89 * 86400000));

  // Cache check: если строки для этого nmId свежие (<1ч) и период совпадает — skip
  if (!force) {
    const r = db.prepare(
      "SELECT MAX(updated_at) u, MIN(period_start) ps, MAX(period_end) pe FROM phrase_djem_stats WHERE nm_id = ?",
    ).get(nmId) as { u: string | null; ps: string | null; pe: string | null } | undefined;
    if (r?.u && r.ps === startDate && r.pe === endDate) {
      const ageMs = dbTimestampAgeMs(r.u);
      if (ageMs != null && ageMs >= 0 && ageMs < CACHE_WINDOW_MS) {
        return NextResponse.json({ ok: true, skipped: true, note: "fresh (<1h)", cached: { ageMs } });
      }
    }
  }

  // Auth
  let session: SellerSession | null = loadSavedSellerSession();
  if (!session) {
    const auto = await ensureBrowser();
    if (!auto.page) return NextResponse.json({ ok: false, error: auto.error || "no browser" }, { status: 400 });
    const page = auto.page;
    const tok = await page.evaluate(() => localStorage.getItem("wb-eu-passport-v2.access-token"));
    const cookies = await page.cookies("https://seller.wildberries.ru", "https://seller-content.wildberries.ru");
    const sid = cookies.find((c) => c.name === "x-supplier-id")?.value || "";
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    if (!tok) return NextResponse.json({ ok: false, error: "no access-token in puppeteer profile" }, { status: 401 });
    session = { authorizev3: tok, supplierId: sid, cookieHeader };
  }

  const t0 = Date.now();
  let stats;
  let debugSample: unknown = null;
  try {
    const r = await fetchDjemForNmId(session, nmId, startDate, endDate, debug);
    stats = r.stats;
    debugSample = r.debugSample ?? null;
  } catch (e) {
    return NextResponse.json({ ok: false, error: `fetch: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
  const fetchMs = Date.now() - t0;

  // Upsert
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO phrase_djem_stats
      (nm_id, phrase, period_start, period_end,
       view_count, open_card_count, add_to_cart_count, order_count, order_sum,
       avg_position, ctr, open_to_cart_conversion, cart_to_order_conversion, avg_price, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  // Маппинг на существующие колонки БД: view_count здесь используется под frequency
  // (запросов в WB поиске); order_sum/avg_price не отдаются API — пишем 0.
  let written = 0;
  db.transaction(() => {
    for (const s of stats.values()) {
      upsert.run(
        nmId, s.phrase, startDate, endDate,
        s.frequency, s.openCardCount, s.addToCartCount, s.orderCount, 0,
        s.avgPosition, s.ctr, s.openToCartConversion, s.cartToOrderConversion, 0,
      );
      written++;
    }
  })();

  return NextResponse.json({
    ok: true,
    nmId,
    period: { start: startDate, end: endDate },
    phrases: stats.size,
    written,
    fetchMs,
    ...(debug ? { debugSample } : {}),
  });
}
