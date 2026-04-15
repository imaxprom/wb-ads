import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiKey } from "@/lib/api-key";
import { localDateStr } from "@/lib/format";

const BASE = "https://advert-api.wildberries.ru";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function normalizeDate(d: string): string { return d.slice(0, 10); }

export async function POST() {
  const apiKey = getApiKey();
  const db = getDb();
  const errors: string[] = [];

  const activeIds = (db.prepare("SELECT advert_id FROM campaigns WHERE status IN (9, 11)").all() as { advert_id: number }[]).map((r) => r.advert_id);
  if (activeIds.length === 0) return NextResponse.json({ ok: true, daily: 0, byNm: 0, errors: [] });

  const endDate = localDateStr(new Date());
  const startDate = localDateStr(new Date(Date.now() - 7 * 86400000));

  interface NmData { nmId: number; views: number; clicks: number; cpc: number; sum: number; orders: number; sum_price: number; cr: number; atbs: number; shks: number; canceled: number; }
  interface DayData { date: string; views: number; clicks: number; ctr: number; cpc: number; sum: number; atbs: number; orders: number; shks: number; sum_price: number; cr: number; canceled: number; apps: { nms: NmData[] }[]; }
  interface CampStats { advertId: number; days: DayData[]; }

  const allStats: CampStats[] = [];

  for (let i = 0; i < activeIds.length; i += 50) {
    const batch = activeIds.slice(i, i + 50);
    try {
      const res = await fetch(
        `${BASE}/adv/v3/fullstats?ids=${batch.join(",")}&beginDate=${startDate}&endDate=${endDate}`,
        { headers: { Authorization: apiKey } }
      );
      if (!res.ok) { errors.push(`fullstats batch ${i}: ${res.status}`); continue; }
      const data = await res.json();
      if (Array.isArray(data)) allStats.push(...data);
    } catch (e) {
      errors.push(`fullstats batch ${i}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (i + 50 < activeIds.length) await sleep(200);
  }

  const stmtDaily = db.prepare(`
    INSERT OR REPLACE INTO campaign_stats_daily
      (advert_id, date, views, clicks, ctr, cpc, sum, atbs, orders, shks, sum_price, cr, canceled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const stmtByNm = db.prepare(`
    INSERT OR REPLACE INTO campaign_stats_by_nm
      (advert_id, nm_id, date, views, clicks, ctr, cpc, sum, orders, sum_price, cr, atbs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let dailyCount = 0, nmCount = 0;

  const insertAll = db.transaction(() => {
    for (const camp of allStats) {
      for (const day of camp.days || []) {
        const date = normalizeDate(day.date);
        stmtDaily.run(camp.advertId, date, day.views, day.clicks, day.ctr, day.cpc, day.sum, day.atbs, day.orders, day.shks, day.sum_price, day.cr, day.canceled);
        dailyCount++;

        // Aggregate NMs across apps
        const nmMap = new Map<number, { views: number; clicks: number; sum: number; orders: number; sum_price: number; atbs: number }>();
        for (const app of day.apps || []) {
          for (const nm of app.nms || []) {
            const ex = nmMap.get(nm.nmId);
            if (ex) { ex.views += nm.views; ex.clicks += nm.clicks; ex.sum += nm.sum; ex.orders += nm.orders; ex.sum_price += nm.sum_price; ex.atbs += nm.atbs; }
            else nmMap.set(nm.nmId, { views: nm.views, clicks: nm.clicks, sum: nm.sum, orders: nm.orders, sum_price: nm.sum_price, atbs: nm.atbs });
          }
        }
        for (const [nmId, s] of nmMap) {
          const ctr = s.views > 0 ? Math.round((s.clicks / s.views) * 10000) / 100 : 0;
          const cpc = s.clicks > 0 ? Math.round((s.sum / s.clicks) * 100) / 100 : 0;
          const cr = s.clicks > 0 ? Math.round((s.orders / s.clicks) * 10000) / 100 : 0;
          stmtByNm.run(camp.advertId, nmId, date, s.views, s.clicks, ctr, cpc, s.sum, s.orders, s.sum_price, cr, s.atbs);
          nmCount++;
        }
      }
    }
  });
  insertAll();

  return NextResponse.json({ ok: true, daily: dailyCount, byNm: nmCount, errors });
}
