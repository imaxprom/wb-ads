import { NextRequest, NextResponse } from "next/server";
import { ensureBrowser } from "@/lib/ensure-browser";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Debug: вызывает seller-content /sales-funnel/report/details для одного nm_id
// за указанный период и возвращает сырой ответ WB. Нужно, чтобы увидеть что WB реально
// возвращает в поле buyoutPercent.
//
// GET /api/debug/buyout?nmId=165140159&start=2026-03-20&end=2026-04-20

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const nmId = Number(sp.get("nmId") || "0");
  const start = sp.get("start") || "";
  const end = sp.get("end") || "";
  if (!nmId || !start || !end) return NextResponse.json({ ok: false, error: "nmId, start, end required" }, { status: 400 });

  const auto = await ensureBrowser();
  if (!auto.page) return NextResponse.json({ ok: false, error: auto.error || "no browser" }, { status: 400 });
  const page = auto.page;

  const result = await page.evaluate(async (nm: number, s: string, e: string) => {
    const tok = localStorage.getItem("wb-eu-passport-v2.access-token") || "";
    // Ensure we're on seller.wildberries.ru so credentials/cookies properly carry.
    if (!location.hostname.includes("seller.wildberries.ru")) {
      location.href = "https://seller.wildberries.ru/";
      await new Promise((r) => setTimeout(r, 500));
    }
    const body = JSON.stringify({
      nms: [nm],
      brands: [],
      tagIds: [],
      subjects: [],
      skipDeletedNm: false,
      currentPeriod: { start: s, end: e },
      orderBy: { field: "orders", mode: "desc" },
      limit: 5,
      offset: 0,
    });
    // Пробуем 2 варианта URL
    const urls = [
      "https://seller-content.wildberries.ru/ns/analytics-api/content-analytics/api/v1/sales-funnel/report/details",
      "https://seller.wildberries.ru/ns/analytics-api/content-analytics/api/v1/sales-funnel/report/details",
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "Authorizev3": tok,
            "Accept": "application/json",
            "Lang": "ru",
          },
          body,
        });
        const text = await res.text();
        let data: unknown = text;
        try { data = JSON.parse(text); } catch { /* */ }
        return { url, status: res.status, data };
      } catch (err) {
        // try next
        if (url === urls[urls.length - 1]) return { status: 0, error: String(err) };
      }
    }
    return { status: 0, error: "no url succeeded" };
  }, nmId, start, end);

  return NextResponse.json(result);
}
