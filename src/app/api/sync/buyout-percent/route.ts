import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBrowser } from "@/lib/ensure-browser";
import { localDateStr } from "@/lib/format";
import { loadSavedSellerSession, type SavedSellerSession } from "@/lib/wb-seller-session";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

// 30-дневный % выкупа артикула из seller-content /sales-funnel/report/details.
// Дневной buyout_percent в sales_funnel_daily нерепрезентативен (заказ сегодня, выкуп через
// 2-5 дней), поэтому дёргаем агрегат за 30 дней и кладём в products.buyout_percent_30d.
// Используется во вкладке «Карточки» → «Воронка продаж» для расчёта ДРРп и CPS.

interface CampRow { nms_json: string | null; status: number }

function collectActiveNmIds(db: ReturnType<typeof getDb>): number[] {
  const rows = db.prepare(
    "SELECT nms_json, status FROM campaigns WHERE status IN (9, 11)",
  ).all() as CampRow[];
  const set = new Set<number>();
  for (const r of rows) {
    try {
      const arr = JSON.parse(r.nms_json || "[]");
      if (Array.isArray(arr)) for (const n of arr) if (typeof n === "number") set.add(n);
    } catch { /* skip */ }
  }
  return Array.from(set);
}

interface FetchResult { buyoutPercent: number | null; status: number; error?: string }

async function fetchBuyoutWithSession(session: SavedSellerSession, nmId: number, start: string, end: string): Promise<FetchResult> {
  const body = JSON.stringify({
    nms: [nmId], brands: [], tagIds: [], subjects: [],
    skipDeletedNm: false,
    currentPeriod: { start, end },
    orderBy: { field: "orders", mode: "desc" },
    limit: 5, offset: 0,
  });
  try {
    const res = await fetch(
      "https://seller.wildberries.ru/ns/analytics-api/content-analytics/api/v1/sales-funnel/report/details",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Lang": "ru",
          "Origin": "https://seller.wildberries.ru",
          "Referer": "https://seller.wildberries.ru/",
          "Authorizev3": session.authorizev3,
          "Cookie": session.cookieHeader,
        },
        body,
      },
    );
    const text = await res.text();
    if (!res.ok) return { buyoutPercent: null, status: res.status, error: text.slice(0, 200) };
    let data: { data?: { buyoutPercent?: { current?: number } }[] };
    try { data = JSON.parse(text); } catch { return { buyoutPercent: null, status: res.status, error: "parse" }; }
    const pct = data?.data?.[0]?.buyoutPercent?.current;
    if (typeof pct !== "number") return { buyoutPercent: null, status: res.status, error: "no buyoutPercent" };
    return { buyoutPercent: pct, status: res.status };
  } catch (err) {
    return { buyoutPercent: null, status: 0, error: String(err) };
  }
}

async function fetchBuyoutForNm(page: import("puppeteer").Page, nmId: number, start: string, end: string): Promise<FetchResult> {
  return await page.evaluate(async (nm: number, s: string, e: string) => {
    const tok = localStorage.getItem("wb-eu-passport-v2.access-token") || "";
    if (!location.hostname.includes("seller.wildberries.ru")) {
      location.href = "https://seller.wildberries.ru/";
      await new Promise((r) => setTimeout(r, 500));
    }
    const body = JSON.stringify({
      nms: [nm], brands: [], tagIds: [], subjects: [],
      skipDeletedNm: false,
      currentPeriod: { start: s, end: e },
      orderBy: { field: "orders", mode: "desc" },
      limit: 5, offset: 0,
    });
    try {
      const res = await fetch(
        "https://seller.wildberries.ru/ns/analytics-api/content-analytics/api/v1/sales-funnel/report/details",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "Authorizev3": tok,
            "Accept": "application/json",
            "Lang": "ru",
          },
          body,
        },
      );
      const text = await res.text();
      if (!res.ok) return { buyoutPercent: null, status: res.status, error: text.slice(0, 200) };
      let data: { data?: { buyoutPercent?: { current?: number } }[] };
      try { data = JSON.parse(text); } catch { return { buyoutPercent: null, status: res.status, error: "parse" }; }
      const item = data?.data?.[0];
      const pct = item?.buyoutPercent?.current;
      if (typeof pct !== "number") {
        return { buyoutPercent: null, status: res.status, error: "no buyoutPercent" };
      }
      return { buyoutPercent: pct, status: res.status };
    } catch (err) {
      return { buyoutPercent: null, status: 0, error: String(err) };
    }
  }, nmId, start, end);
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const sp = request.nextUrl.searchParams;
  const gap = Math.max(0, Number(sp.get("gap") || "1500"));
  const backoff429 = Math.max(1000, Number(sp.get("backoff429") || "30000"));
  const maxRetries = Math.max(0, Number(sp.get("maxRetries") || "3"));

  const nmIdsParam = sp.get("nmIds");
  let nmIds: number[];
  if (nmIdsParam) {
    nmIds = nmIdsParam.split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
  } else {
    nmIds = collectActiveNmIds(db);
  }
  if (nmIds.length === 0) return NextResponse.json({ ok: false, error: "no active nmIds" }, { status: 400 });

  const end = localDateStr(new Date(Date.now() - 86400000)); // вчера
  const start = localDateStr(new Date(Date.now() - 30 * 86400000)); // 29 дней назад

  const savedSession = loadSavedSellerSession();
  let page: import("puppeteer").Page | null = null;
  if (!savedSession) {
    const auto = await ensureBrowser();
    if (!auto.page) return NextResponse.json({ ok: false, error: auto.error || "no browser" }, { status: 400 });
    page = auto.page;

    // Ensure we're on seller.wildberries.ru so credentials properly carry.
    try {
      const url = page.url();
      if (!url.includes("seller.wildberries.ru")) {
        await page.goto("https://seller.wildberries.ru/", { waitUntil: "domcontentloaded", timeout: 30000 });
      }
    } catch { /* continue anyway */ }
  }

  const updateStmt = db.prepare(
    "UPDATE products SET buyout_percent_30d = ?, buyout_updated_at = datetime('now') WHERE nm_id = ?",
  );

  const results: { nmId: number; buyoutPercent: number | null; status: number; error?: string }[] = [];
  let updated = 0;
  let total429 = 0;

  for (let i = 0; i < nmIds.length; i++) {
    const nmId = nmIds[i];
    let attempt = 0;
    let r: FetchResult = { buyoutPercent: null, status: 0, error: "not attempted" };
    while (attempt <= maxRetries) {
      r = savedSession ? await fetchBuyoutWithSession(savedSession, nmId, start, end) : await fetchBuyoutForNm(page!, nmId, start, end);
      if (r.status === 429) {
        total429 += 1;
        attempt += 1;
        if (attempt > maxRetries) break;
        await new Promise((res) => setTimeout(res, backoff429));
        continue;
      }
      break;
    }

    if (r.buyoutPercent != null) {
      updateStmt.run(r.buyoutPercent, nmId);
      updated += 1;
    }
    results.push({ nmId, buyoutPercent: r.buyoutPercent, status: r.status, error: r.error });

    if (i < nmIds.length - 1 && gap > 0) {
      await new Promise((res) => setTimeout(res, gap));
    }
  }

  return NextResponse.json({
    ok: true,
    period: { start, end },
    requested: nmIds.length,
    updated,
    total_429: total429,
    results,
  });
}
