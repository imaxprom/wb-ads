import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiKey } from "@/lib/api-key";
import { localDateStr } from "@/lib/format";
import { getHotCampaignAdvertIds, sortByAdvertPriority } from "@/lib/campaign-queue";
import { Client } from "pg";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const BASE = "https://advert-api.wildberries.ru";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

interface StatItem {
  norm_query: string;
  avg_pos?: number;
  views?: number;
  clicks?: number;
  ctr?: number;
  cpc?: number;
  cpm?: number;
  atbs?: number;
  orders?: number;
}

// Note: WB API returns stats aggregated over the FULL (from..to) period — no
// per-day breakdown inside the response. So we call once per day per (advert_id, nm_id)
// to get per-day granularity. For "today only" sync this is 1 request per pair.
export async function POST(request: NextRequest) {
  const db = getDb();
  const apiKey = getApiKey();
  const sp = request.nextUrl.searchParams;

  const idsParam = sp.get("advertIds");
  let advertIds: number[];
  if (idsParam) {
    advertIds = idsParam.split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
  } else {
    // Только «горячие» кампании. Остальные — через ?advertIds=... или test-panel.
    advertIds = getHotCampaignAdvertIds(db);
  }
  const days = Math.max(1, Math.min(31, Number(sp.get("days") || "1")));
  if (advertIds.length === 0) return NextResponse.json({ ok: true, rowsWritten: 0 });

  // Pairs (advert_id, nm_id) that actually had impressions — skip dead nm_ids.
  const ph = advertIds.map(() => "?").join(",");
  const rawPairs = db.prepare(`
    SELECT DISTINCT advert_id, nm_id FROM campaign_stats_by_nm
    WHERE advert_id IN (${ph}) AND (views > 0 OR clicks > 0)
  `).all(...advertIds) as { advert_id: number; nm_id: number }[];
  if (rawPairs.length === 0) return NextResponse.json({ ok: true, rowsWritten: 0, note: "no active nm_ids" });
  // Переупорядочиваем пары по приоритету advert_id (active+hot-paused впереди)
  const pairs = sortByAdvertPriority(rawPairs, advertIds);

  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    dates.push(localDateStr(new Date(Date.now() - i * 86400000)));
  }

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO campaign_keyword_stats_daily
      (advert_id, nm_id, date, norm_query,
       avg_pos, views, clicks, ctr, cpc, cpm, atbs, orders, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const delDay = db.prepare("DELETE FROM campaign_keyword_stats_daily WHERE advert_id = ? AND nm_id = ? AND date = ?");

  const errors: string[] = [];
  let rowsWritten = 0;
  let reqsOk = 0;
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const pg = databaseUrl ? new Client({ connectionString: databaseUrl }) : null;

  // Rate limit: 10 req/min → 6s between requests. С батчингом мы делаем
  // 1 запрос на всю дату (все pairs пачкой), поэтому лимит сильно не трогаем.
  const GAP_MS = 6100;
  const CHUNK = 50; // максимальный размер items[] в одном запросе WB

  // WB response: { stats: [{ advert_id, nm_id, stats: [{norm_query, views, ...}] }, ...] }
  type GroupResp = { advert_id: number; nm_id: number; stats?: StatItem[] };

  if (pg) await pg.connect();
  try {
    for (const date of dates) {
      for (let chunkStart = 0; chunkStart < pairs.length; chunkStart += CHUNK) {
        const chunk = pairs.slice(chunkStart, chunkStart + CHUNK);
        try {
          const res = await fetch(`${BASE}/adv/v0/normquery/stats`, {
            method: "POST",
            headers: { "Authorization": apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: date,
              to: date,
              items: chunk.map((p) => ({ advert_id: p.advert_id, nm_id: p.nm_id })),
            }),
          });
          if (res.status === 429) {
            errors.push(`${date} chunk[${chunkStart}]: 429, wait 60s`);
            await sleep(60000);
            continue;
          }
          if (!res.ok) {
            errors.push(`${date} chunk[${chunkStart}]: ${res.status}`);
            await sleep(GAP_MS);
            continue;
          }
          const data = await res.json();
          const groups = (data?.stats || []) as GroupResp[];

          if (pg) {
            await pg.query("BEGIN");
            try {
              // Удаляем прежние строки для каждого item в chunk (даже если WB не вернул для него stats)
              for (const p of chunk) {
                await pg.query(
                  "DELETE FROM campaign_keyword_stats_daily WHERE advert_id = $1 AND nm_id = $2 AND date = $3",
                  [p.advert_id, p.nm_id, date],
                );
              }
              for (const g of groups) {
                for (const s of (g.stats || [])) {
                  const info = await pg.query(`
                    INSERT INTO campaign_keyword_stats_daily
                      (advert_id, nm_id, date, norm_query,
                       avg_pos, views, clicks, ctr, cpc, cpm, atbs, orders, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now()::text)
                  `, [
                    g.advert_id, g.nm_id, date, s.norm_query,
                    s.avg_pos ?? 0,
                    s.views ?? 0,
                    s.clicks ?? 0,
                    s.ctr ?? 0,
                    s.cpc ?? 0,
                    s.cpm ?? 0,
                    s.atbs ?? 0,
                    s.orders ?? 0,
                  ]);
                  rowsWritten += info.rowCount ?? 0;
                }
              }
              await pg.query("COMMIT");
            } catch (e) {
              await pg.query("ROLLBACK").catch(() => {});
              throw e;
            }
          } else {
            db.transaction(() => {
              // Удаляем прежние строки для каждого item в chunk (даже если WB не вернул для него stats)
              for (const p of chunk) {
                delDay.run(p.advert_id, p.nm_id, date);
              }
              for (const g of groups) {
                for (const s of (g.stats || [])) {
                  stmt.run(
                    g.advert_id, g.nm_id, date, s.norm_query,
                    s.avg_pos ?? 0,
                    s.views ?? 0,
                    s.clicks ?? 0,
                    s.ctr ?? 0,
                    s.cpc ?? 0,
                    s.cpm ?? 0,
                    s.atbs ?? 0,
                    s.orders ?? 0,
                  );
                  rowsWritten++;
                }
              }
            })();
          }
          reqsOk++;
        } catch (e) {
          errors.push(`${date} chunk[${chunkStart}]: ${e instanceof Error ? e.message : String(e)}`);
        }
        // gap только если ещё есть чанки/даты впереди
        const more = (chunkStart + CHUNK < pairs.length) || (date !== dates[dates.length - 1]);
        if (more) await sleep(GAP_MS);
      }
    }
  } finally {
    if (pg) await pg.end();
  }

  return NextResponse.json({ ok: true, pairs: pairs.length, dates: dates.length, reqsOk, rowsWritten, errors });
}
