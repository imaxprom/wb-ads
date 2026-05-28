import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { localDateStr } from "@/lib/format";
import { ensureBrowser } from "@/lib/ensure-browser";
import { loadSavedSellerSession } from "@/lib/wb-seller-session";

export const dynamic = "force-dynamic";

const g = globalThis as unknown as {
  __wbSniffPage?: import("puppeteer").Page | null;
  __wbSniffRunning?: boolean;
};

const ENTRY_POINTS_URL = "https://seller-content.wildberries.ru/ns/analytics-api/content-analytics/api/v2/customer-profile/entry-points";

export async function GET(request: NextRequest) {
  const db = getDb();
  const nmId = Number(request.nextUrl.searchParams.get("nmId") || "0");
  const days = Math.min(90, Math.max(1, Number(request.nextUrl.searchParams.get("days") || "7")));
  const offset = Math.max(0, Number(request.nextUrl.searchParams.get("offset") || "0"));

  const end = localDateStr(new Date(Date.now() - offset * 86400000));
  const start = localDateStr(new Date(Date.now() - (days - 1 + offset) * 86400000));
  const todayStr = localDateStr(new Date());
  // Cache only past single-day queries (today's data mutates throughout the day).
  // Whole-store (nmId=0) is cached too.
  const cacheable = days === 1 && end < todayStr;

  if (cacheable) {
    const cached = db.prepare(
      "SELECT total_json, entry_points_json FROM buyer_entry_points WHERE nm_id = ? AND start_date = ? AND end_date = ?"
    ).get(nmId, start, end) as { total_json: string; entry_points_json: string } | undefined;

    if (cached) {
      return NextResponse.json({
        ok: true,
        data: { total: JSON.parse(cached.total_json), entryPoints: JSON.parse(cached.entry_points_json) },
        period: { start, end },
        source: "db",
      });
    }
  }

  // Multi-day: aggregate from daily records in DB
  if (nmId && days > 1) {
    const rows = db.prepare(
      "SELECT total_json, entry_points_json FROM buyer_entry_points WHERE nm_id = ? AND start_date >= ? AND end_date <= ?"
    ).all(nmId, start, end) as { total_json: string; entry_points_json: string }[];

    if (rows.length >= days * 0.7) {
      // We have enough daily data — but entry-points can't be summed correctly client-side
      // Fall through to live request for multi-day periods
    }
  }

  const savedSession = loadSavedSellerSession();
  let result: { error?: string; data?: unknown };
  if (savedSession) {
    try {
      const res = await fetch(ENTRY_POINTS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Origin": "https://seller.wildberries.ru",
          "Referer": "https://seller.wildberries.ru/",
          "Authorizev3": savedSession.authorizev3,
          "Cookie": savedSession.cookieHeader,
        },
        body: JSON.stringify({
          start, end,
          subjects: [], brands: [],
          nms: nmId ? [nmId] : [],
          tagIds: [],
          repeatedAction: "notSelected",
        }),
      });
      result = res.ok ? await res.json() as { error?: string; data?: unknown } : { error: `HTTP ${res.status}` };
    } catch (e) {
      result = { error: String(e) };
    }
  } else {
    // Live request via Puppeteer fallback
    const auto = await ensureBrowser();
    if (!auto.page) {
      return NextResponse.json({ ok: false, error: auto.error || "Браузер не запущен" }, { status: 400 });
    }
    const page = auto.page;

    const accessToken = await page.evaluate(() => {
      return localStorage.getItem("wb-eu-passport-v2.access-token");
    });

    if (!accessToken) {
      return NextResponse.json({ ok: false, error: "Не найден access-token" }, { status: 400 });
    }

    result = await page.evaluate(
      async (url: string, body: string, token: string) => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorizev3": token },
          body,
          credentials: "include",
        });
        if (!res.ok) return { error: `HTTP ${res.status}` };
        return await res.json();
      } catch (e) {
        return { error: String(e) };
      }
    },
    ENTRY_POINTS_URL,
    JSON.stringify({
      start, end,
      subjects: [], brands: [],
      nms: nmId ? [nmId] : [],
      tagIds: [],
      repeatedAction: "notSelected",
    }),
    accessToken,
    ) as { error?: string; data?: unknown };
  }

  if (result.error) {
    // Forward WB rate-limit as 429 so the UI can handle it distinctly.
    const status = /429|too\s*many|limited/i.test(result.error) ? 429 : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  // Cache single-day results for past dates only (today's data changes through the day).
  if (cacheable && result.data) {
    const d = result.data as { total: unknown; entryPoints: unknown[] };
    db.prepare(
      "INSERT OR REPLACE INTO buyer_entry_points (nm_id, start_date, end_date, total_json, entry_points_json, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
    ).run(nmId, start, end, JSON.stringify(d.total), JSON.stringify(d.entryPoints));
  }

  return NextResponse.json({ ok: true, data: result.data, period: { start, end }, source: "live" });
}
