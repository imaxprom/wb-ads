import { NextRequest, NextResponse } from "next/server";
import { ensureBrowser } from "@/lib/ensure-browser";
import { localDateStr } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Debug: один raw-запрос к WB Джем без nmId. Смотрим, что отдаёт API:
// — работает ли вообще без nmId,
// — есть ли в items поле nmId (критично для нашей задачи).

const DJEM_URL = "https://seller-content.wildberries.ru/ns/analytics-api/content-analytics/api/v2/search-report/product/search-texts";

export async function POST(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const date = sp.get("date") || localDateStr(new Date());
  const limit = Number(sp.get("limit") || "100");
  const includeNmId = sp.get("nmId");  // если передать — добавить в body

  const auto = await ensureBrowser();
  if (!auto.page) return NextResponse.json({ ok: false, error: auto.error || "no browser" }, { status: 400 });
  const page = auto.page;
  const tok = await page.evaluate(() => localStorage.getItem("wb-eu-passport-v2.access-token"));
  const cookies = await page.cookies("https://seller.wildberries.ru", "https://seller-content.wildberries.ru");
  const sid = cookies.find((c) => c.name === "x-supplier-id")?.value || "";
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  if (!tok) return NextResponse.json({ ok: false, error: "no access-token" }, { status: 401 });

  // Предыдущий день — prevPeriod
  const prevDate = localDateStr(new Date(Date.parse(date) - 86_400_000));

  const body: Record<string, unknown> = {
    currentPeriod: { start: date, end: date },
    prevPeriod: { start: prevDate, end: prevDate },
    limit,
    topOrderBy: "orders",
    orderBy: { field: "orders", mode: "desc" },
  };
  if (includeNmId) body.nmId = Number(includeNmId);

  const res = await fetch(DJEM_URL, {
    method: "POST",
    headers: {
      "Authorizev3": tok,
      "X-SupplierId": sid,
      "Lang": "ru",
      "Origin": "https://seller.wildberries.ru",
      "Referer": "https://seller.wildberries.ru/",
      "Cookie": cookieHeader,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not json */ }

  // Извлекаем items и смотрим какие у них ключи + первые 3 примера
  const items = (json as { data?: { items?: unknown[] }; items?: unknown[] })?.data?.items
             ?? (json as { items?: unknown[] })?.items
             ?? [];
  const firstKeys = items.length ? Object.keys(items[0] as Record<string, unknown>) : [];
  const sample = items.slice(0, 3);

  return NextResponse.json({
    ok: res.ok,
    status: res.status,
    requestBody: body,
    itemsCount: items.length,
    firstKeys,
    sample,
    rawTop: typeof json === "object" && json ? Object.keys(json as Record<string, unknown>) : [],
    errorText: !res.ok ? text.slice(0, 500) : undefined,
  });
}
