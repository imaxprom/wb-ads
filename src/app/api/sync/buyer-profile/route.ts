import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { localDateStr } from "@/lib/format";
import { ensureBrowser } from "@/lib/ensure-browser";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

const g = globalThis as unknown as {
  __wbSniffPage?: import("puppeteer").Page | null;
  __wbSniffRunning?: boolean;
  __buyerProgress?: { current: number; total: number; running: boolean };
};

const ENTRY_POINTS_URL = "https://seller-content.wildberries.ru/ns/analytics-api/content-analytics/api/v2/customer-profile/entry-points";
const PARALLEL_FAST = 3;
const PARALLEL_SLOW = 2;
const PAUSE_FAST = 1000;
const PAUSE_SLOW = 3000;

export async function GET() {
  const progress = g.__buyerProgress || { current: 0, total: 0, running: false };
  return NextResponse.json(progress);
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const days = Math.min(90, Math.max(1, Number(request.nextUrl.searchParams.get("days") || "1")));
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

  const accessToken = await page.evaluate(() => {
    return localStorage.getItem("wb-eu-passport-v2.access-token");
  });

  if (!accessToken) {
    return NextResponse.json({ ok: false, error: "Не найден access-token" }, { status: 400 });
  }

  const nmIds = (db.prepare("SELECT nm_id FROM products").all() as { nm_id: number }[]).map((r) => r.nm_id);
  if (nmIds.length === 0) {
    return NextResponse.json({ ok: true, synced: 0, errors: ["Нет товаров"] });
  }

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO buyer_entry_points
      (nm_id, start_date, end_date, total_json, entry_points_json)
    VALUES (?, ?, ?, ?, ?)
  `);

  let totalSynced = 0;
  const parallel = days <= 1 ? PARALLEL_FAST : PARALLEL_SLOW;
  const pause = days <= 1 ? PAUSE_FAST : PAUSE_SLOW;
  g.__buyerProgress = { current: 0, total: nmIds.length * days, running: true };

  // For each day in the range, sync all products
  for (let dayIdx = 0; dayIdx < days; dayIdx++) {
    const date = localDateStr(new Date(Date.now() - dayIdx * 86400000));

    for (let chunkStart = 0; chunkStart < nmIds.length; chunkStart += parallel) {
      const chunk = nmIds.slice(chunkStart, chunkStart + parallel);
      g.__buyerProgress = { current: chunkStart + chunk.length + dayIdx * nmIds.length, total: nmIds.length * days, running: true };

      try {
        const results = await page.evaluate(
          async (url: string, nmIDs: number[], start: string, end: string, token: string) => {
            const promises = nmIDs.map(async (nmID) => {
              try {
                const res = await fetch(url, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorizev3": token },
                  body: JSON.stringify({
                    start, end,
                    subjects: [], brands: [], nms: [nmID], tagIds: [],
                    repeatedAction: "notSelected",
                  }),
                  credentials: "include",
                });
                if (!res.ok) return { nmID, error: `HTTP ${res.status}` };
                const json = await res.json();
                return { nmID, data: json.data };
              } catch (e) {
                return { nmID, error: String(e) };
              }
            });
            return Promise.all(promises);
          },
          ENTRY_POINTS_URL,
          chunk,
          date,
          date,
          accessToken,
        ) as { nmID: number; data?: { total: unknown; entryPoints: unknown[] }; error?: string }[];

        const insertBatch = db.transaction(() => {
          for (const r of results) {
            if (r.error) { errors.push(`nm ${r.nmID} ${date}: ${r.error}`); continue; }
            if (r.data) {
              stmt.run(r.nmID, date, date, JSON.stringify(r.data.total), JSON.stringify(r.data.entryPoints));
              totalSynced++;
            }
          }
        });
        insertBatch();
      } catch (err) {
        errors.push(`chunk ${date}: ${err instanceof Error ? err.message : String(err)}`);
      }

      await sleep(pause);
    }
  }

  g.__buyerProgress = { current: nmIds.length * days, total: nmIds.length * days, running: false };

  return NextResponse.json({ ok: true, synced: totalSynced, products: nmIds.length, days, errors });
}
