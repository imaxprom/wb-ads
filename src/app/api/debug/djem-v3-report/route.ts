import { NextRequest, NextResponse } from "next/server";
import { ensureBrowser } from "@/lib/ensure-browser";
import { localDateStr } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Debug: raw POST к v3/search-report/report с body 1:1 как в UI WB Джем.
// Передаём nmIds (опционально) через query ?nmIds=1,2,3. По умолчанию пусто (весь кабинет).
// Возвращаем полный ответ (или топ-структуру, если огромный).

const URL = "https://seller-content.wildberries.ru/ns/analytics-api/content-analytics/api/v3/search-report/report";

export async function POST(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const date = sp.get("date") || localDateStr(new Date());
  const nmIdsCsv = sp.get("nmIds") || "";
  const nmIds = nmIdsCsv ? nmIdsCsv.split(",").map((s) => Number(s.trim())).filter(Boolean) : [];
  const full = sp.get("full") === "1"; // вернуть весь ответ

  const auto = await ensureBrowser();
  if (!auto.page) return NextResponse.json({ ok: false, error: auto.error || "no browser" }, { status: 400 });
  const page = auto.page;
  const tok = await page.evaluate(() => localStorage.getItem("wb-eu-passport-v2.access-token"));
  const cookies = await page.cookies("https://seller.wildberries.ru", "https://seller-content.wildberries.ru");
  const sid = cookies.find((c) => c.name === "x-supplier-id")?.value || "";
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  if (!tok) return NextResponse.json({ ok: false, error: "no access-token" }, { status: 401 });

  const prevDate = localDateStr(new Date(Date.parse(date) - 86_400_000));

  const body = {
    currentPeriod: { start: date, end: date },
    pastPeriod: { start: prevDate, end: prevDate },
    nmIds,
    subjectIds: [],
    brandNames: [],
    includeSearchTexts: true,
    includeSubstitutedSKUs: true,
    orderBy: { field: "openCard", mode: "desc" },
    positionCluster: "all",
    tagIds: [],
  };

  const res = await fetch(URL, {
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
  try { json = JSON.parse(text); } catch { /* */ }

  if (full) {
    return NextResponse.json({ ok: res.ok, status: res.status, body: json, size: text.length });
  }

  // Карта ключей верхнего уровня и data.*, + примеры массивов
  const data = (json as { data?: Record<string, unknown> })?.data;
  const summary: Record<string, unknown> = {};
  if (data) {
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v)) {
        summary[k] = { type: "array", length: v.length, firstItem: v[0], firstKeys: v[0] ? Object.keys(v[0] as Record<string, unknown>) : [] };
      } else if (typeof v === "object" && v !== null) {
        summary[k] = { type: "object", keys: Object.keys(v as Record<string, unknown>) };
      } else {
        summary[k] = { type: typeof v, value: v };
      }
    }
  }

  return NextResponse.json({
    ok: res.ok,
    status: res.status,
    requestBody: body,
    responseSize: text.length,
    topKeys: typeof json === "object" && json ? Object.keys(json as Record<string, unknown>) : [],
    dataStructure: summary,
    errorText: !res.ok ? text.slice(0, 500) : undefined,
  });
}
