import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBrowser } from "@/lib/ensure-browser";
import { localDateStr } from "@/lib/format";
import { downloadSearchTextsXlsx, parseSearchTextsXlsx, type SellerSession } from "@/lib/wb-search-texts-xlsx";
import { loadSavedSellerSession } from "@/lib/wb-seller-session";
import { dbTimestampAgeMs } from "@/lib/db-time";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const g = globalThis as unknown as {
  __wbSniffPage?: import("puppeteer").Page | null;
  __wbSniffRunning?: boolean;
};

// Синк «Аналитики поиска» WB premium — через выгрузку xlsx.
//
// Путь: /file-manager/download → poll → /tokensjrpc → GET <downloadUrl> → zip → xlsx → parse.
// Даёт до 1500+ фраз per subject за один вызов (vs 500 у старого /search-texts с пагинацией).
//
// Puppeteer используется только для одноразового чтения Authorizev3 + cookies из localStorage
// seller-профиля. Всё остальное — чистый Node fetch.
//
// snapshot_date = МСК-«вчера» на момент sync. Таблица search_texts_wb хранит историю per-day.
// Кэш 6 часов — в 06:00 МСК снимок обновляется планировщиком. Ручной запуск через ?force=1.

const CACHE_WINDOW_MS = 6 * 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  const db = getDb();
  const sp = request.nextUrl.searchParams;
  const subjectId = Number(sp.get("subjectId") || "0");
  const interval = (sp.get("interval") || "yesterday") as "yesterday" | "week" | "month";
  const force = sp.get("force") === "1";

  if (!subjectId) {
    return NextResponse.json({ ok: false, error: "subjectId required" }, { status: 400 });
  }
  if (interval !== "yesterday") {
    // snapshot_date-логика рассчитана на interval=yesterday (данные за предыдущий календарный день).
    // Для week/month пришлось бы хранить по другому — пока не поддерживаем.
    return NextResponse.json({ ok: false, error: "only interval=yesterday is supported" }, { status: 400 });
  }

  // snapshot_date = МСК-«вчера» на момент sync
  const yesterdayMsk = localDateStr(new Date(Date.now() - 86400000));

  // Cache check: если snapshot за yesterdayMsk уже есть и свежий — skip.
  if (!force) {
    const r = db.prepare(
      "SELECT MAX(updated_at) u FROM search_texts_wb WHERE subject_id = ? AND snapshot_date = ?",
    ).get(subjectId, yesterdayMsk) as { u: string | null } | undefined;
    if (r?.u) {
      const ageMs = dbTimestampAgeMs(r.u);
      if (ageMs != null && ageMs >= 0 && ageMs < CACHE_WINDOW_MS) {
        return NextResponse.json({ ok: true, skipped: true, note: `fresh in cache (<${CACHE_WINDOW_MS / 3600000}h)` });
      }
    }
  }

  // Seller subject_name для колонки subject_name в БД
  const subjectRow = db.prepare("SELECT name FROM subject_min_cpm WHERE subject_id = ?").get(subjectId) as { name: string } | undefined;
  const subjectName = subjectRow?.name ?? null;

  // Prefer saved seller session copied from an authenticated browser. Fallback to
  // Puppeteer profile for local interactive runs.
  const savedSession = loadSavedSellerSession();
  let session: SellerSession | null = savedSession;
  if (!session) {
    const auto = await ensureBrowser();
    if (!auto.page) return NextResponse.json({ ok: false, error: auto.error || "no browser" }, { status: 400 });
    const page = auto.page;
    const tok = await page.evaluate(() => localStorage.getItem("wb-eu-passport-v2.access-token"));
    const allCookies = await page.cookies("https://seller.wildberries.ru", "https://seller-content.wildberries.ru");
    const sid = allCookies.find((c) => c.name === "x-supplier-id")?.value || "";
    const cookieHeader = allCookies.map((c) => `${c.name}=${c.value}`).join("; ");
    if (!tok) return NextResponse.json({ ok: false, error: "no access-token in puppeteer profile" }, { status: 401 });
    session = { authorizev3: tok, supplierId: sid, cookieHeader };
  }

  // 4-step flow: create task → poll → generate-token → download
  const t0 = Date.now();
  let bytes: Buffer;
  let meta;
  try {
    const result = await downloadSearchTextsXlsx({ session, subjectId, interval });
    bytes = result.bytes;
    meta = result.meta;
  } catch (e) {
    return NextResponse.json({ ok: false, error: `download failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
  const downloadMs = Date.now() - t0;

  // Парсинг xlsx → массив фраз
  let rows;
  try {
    rows = await parseSearchTextsXlsx(bytes);
  } catch (e) {
    return NextResponse.json({ ok: false, error: `parse failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
  const parseMs = Date.now() - t0 - downloadMs;

  // Upsert в search_texts_wb. Удалить предыдущий snapshot за этот (subject_id, snapshot_date),
  // чтобы если в предыдущей попытке сохранилось меньше фраз — не осталось мусора.
  const insert = db.prepare(`
    INSERT OR REPLACE INTO search_texts_wb
      (phrase_lc, snapshot_date, phrase_raw, subject_id, subject_name,
       frequency, frequency_dynamic,
       open_card, open_card_dyn,
       add_to_cart, add_to_cart_dyn,
       open_to_cart,
       orders, orders_dyn,
       cart_to_order, items_with_orders,
       updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const deletePrev = db.prepare(
    "DELETE FROM search_texts_wb WHERE subject_id = ? AND snapshot_date = ?",
  );

  let inserted = 0;
  db.transaction(() => {
    deletePrev.run(subjectId, yesterdayMsk);
    for (const r of rows) {
      if (!r.phrase) continue;
      insert.run(
        r.phrase.trim().toLowerCase(), yesterdayMsk,
        r.phrase,
        subjectId, subjectName,
        r.frequency, r.frequency - r.frequencyPrev,    // frequency_dynamic = current - prev
        r.openCard, r.openCard - r.openCardPrev,
        r.addToCart, r.addToCart - r.addToCartPrev,
        r.openToCart,
        r.orders, r.orders - r.ordersPrev,
        r.cartToOrder, r.itemsWithOrders,
      );
      inserted++;
    }
  })();

  return NextResponse.json({
    ok: true,
    subjectId,
    snapshot_date: yesterdayMsk,
    collected: inserted,
    fileSize: bytes.length,
    wbReport: { name: meta.name, generatedAt: meta.generatedAt, size: meta.size, taskId: meta.id },
    timings: { downloadMs, parseMs, totalMs: Date.now() - t0 },
  });
}
