import { NextRequest, NextResponse } from "next/server";
import { ensureCmpPage } from "@/lib/ensure-browser";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Debug: дёрнуть preset-info и показать ВСЕ поля + top-level ключи, чтобы найти preset_id.
// GET /api/debug/advert-presets?advertId=19494001&nmId=163785912

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const advertId = Number(sp.get("advertId") || "0");
  const nmId = Number(sp.get("nmId") || "0");
  if (!advertId || !nmId) return NextResponse.json({ ok: false, error: "advertId, nmId required" }, { status: 400 });

  const auto = await ensureCmpPage();
  if (!auto.page) return NextResponse.json({ ok: false, error: auto.error || "no browser" }, { status: 400 });
  const page = auto.page;

  try {
    if (!page.url().includes("cmp.wildberries.ru")) {
      await page.goto("https://cmp.wildberries.ru/campaigns/list", { waitUntil: "domcontentloaded", timeout: 20000 });
    }
  } catch { /* */ }

  const result = await page.evaluate(async (aid: number, nm: number) => {
    const tok = localStorage.getItem("access-token") || "";
    const sid = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("x-supplier-id="))?.split("=")[1] || "";

    // 1) preset-info с полными опциями, посмотрим ВСЕ поля
    const url1 =
      `https://cmp.wildberries.ru/api/v1/advert/${aid}/preset-info` +
      `?page_size=50&page_number=1&filter_query=&from=2026-04-14&to=2026-04-21` +
      `&sort_direction=descend&nm_id=${nm}&calc_pages=true&calc_total=true`;
    const out: Record<string, unknown> = { probes: {} };
    try {
      const res = await fetch(url1, {
        method: "GET", credentials: "include",
        headers: { "X-SupplierId": sid, "Authorizev3": tok, "Lang": "ru", "Accept": "application/json" },
      });
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try { json = JSON.parse(text); } catch { /* */ }
      (out.probes as Record<string, unknown>)["preset-info"] = {
        status: res.status,
        topLevelKeys: Object.keys(json),
        count: json.count,
        firstItemKeys: Array.isArray(json.items) && json.items[0] ? Object.keys(json.items[0] as object) : [],
        firstItem: Array.isArray(json.items) && json.items[0] ? json.items[0] : null,
        // всё что кроме items (для обнаружения top-level preset_id)
        nonItemFields: Object.fromEntries(Object.entries(json).filter(([k]) => k !== "items").map(([k, v]) => {
          if (Array.isArray(v)) return [k, `Array[${v.length}]`];
          if (typeof v === "object" && v !== null) return [k, Object.keys(v)];
          return [k, v];
        })),
      };
    } catch (e) { (out.probes as Record<string, unknown>)["preset-info"] = { error: String(e) }; }

    // 2) /v5/configvalues (из evirma) — может вернёт ui_nm_presets_bets
    try {
      const res = await fetch(`https://cmp.wildberries.ru/api/v5/configvalues`, {
        method: "GET", credentials: "include",
        headers: { "X-SupplierId": sid, "Authorizev3": tok, "Lang": "ru", "Accept": "application/json" },
      });
      const text = await res.text();
      (out.probes as Record<string, unknown>)["configvalues"] = { status: res.status, preview: text.slice(0, 1500) };
    } catch (e) { (out.probes as Record<string, unknown>)["configvalues"] = { error: String(e) }; }

    return out;
  }, advertId, nmId);

  return NextResponse.json({ ok: true, advertId, nmId, result });
}
