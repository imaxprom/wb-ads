import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureCmpPage } from "@/lib/ensure-browser";
import { localDateStr } from "@/lib/format";
import { getHotCampaignAdvertIds, sortByAdvertPriority } from "@/lib/campaign-queue";
import { CMP_USER_AGENT, loadSavedCmpSession } from "@/lib/wb-cmp-session";
import { dbTimestampAgeMs } from "@/lib/db-time";
import { Client } from "pg";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const g = globalThis as unknown as {
  __wbSniffCmpPage?: import("puppeteer").Page | null;
  __wbSniffRunning?: boolean;
  __presetInfoProgress?: { current: number; total: number; running: boolean; ok: number; err: number };
  __syncCancelled?: boolean;
};

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export async function GET() {
  const p = g.__presetInfoProgress || { current: 0, total: 0, running: false, ok: 0, err: 0 };
  return NextResponse.json(p);
}

interface PresetItem {
  name: string;
  is_excluded: boolean;
  views?: number;
  clicks?: number;
  baskets?: number;
  orders?: number;
  shks?: number;
  ctr?: number;
  cpc?: number;
  cpm?: number;
  avg_pos?: number;
  spend?: number;
  actual_cpm?: number | null;
  currency?: string;
}

interface PresetResponse {
  items: PresetItem[];
  total?: Partial<PresetItem>;
  count: number;
}

const CACHE_WINDOW_MS = 10 * 60 * 1000;

export async function POST(request: NextRequest) {
  const db = getDb();
  const sp = request.nextUrl.searchParams;
  const errors: string[] = [];
  const skipped: string[] = [];
  const force = sp.get("force") === "1";

  // Period: по умолчанию — последние 7 дней (утром today→today даёт нули, т.к. статистика WB кэш ~30м).
  // UI селектор «Сегодня» в панели «Запросы» использует days=7 для стабильной картины.
  const today = localDateStr(new Date());
  const weekAgo = localDateStr(new Date(Date.now() - 6 * 86400000));
  const fromParam = sp.get("from") || weekAgo;
  const toParam = sp.get("to") || today;

  // Определяем какие (advert_id, nm_id) пары синкать.
  // По умолчанию: активные (status=9) + на паузе (status=11) кампании × все их nm_ids.
  const idsParam = sp.get("advertIds");
  const single = sp.get("advertID");
  const singleNm = sp.get("nmId");

  type Pair = { advert_id: number; nm_id: number };
  let pairs: Pair[];

  if (single && singleNm) {
    pairs = [{ advert_id: Number(single), nm_id: Number(singleNm) }];
  } else {
    let adverts: number[];
    if (idsParam) {
      adverts = idsParam.split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
    } else {
      // Только «горячие» кампании. Остальные — через ?advertIds=... или test-panel.
      adverts = getHotCampaignAdvertIds(db);
    }
    if (adverts.length === 0) return NextResponse.json({ ok: true, pairs: 0, rowsWritten: 0 });

    const ph = adverts.map(() => "?").join(",");
    // Пары (кампания × nm_id) из nms_json — preset-info требует nm_id, на который
    // настроен preset. Если nms_json пуст, fallback на campaign_stats_by_nm.
    const camps = db.prepare(
      `SELECT advert_id, nms_json FROM campaigns WHERE advert_id IN (${ph})`,
    ).all(...adverts) as { advert_id: number; nms_json: string | null }[];
    const pairSet = new Set<string>();
    pairs = [];
    for (const c of camps) {
      let nms: number[] = [];
      try { const arr = JSON.parse(c.nms_json || "[]"); if (Array.isArray(arr)) nms = arr.map(Number).filter(Boolean); } catch { /* */ }
      for (const nm of nms) {
        const k = `${c.advert_id}:${nm}`;
        if (!pairSet.has(k)) { pairSet.add(k); pairs.push({ advert_id: c.advert_id, nm_id: nm }); }
      }
    }
    if (pairs.length === 0) {
      pairs = db.prepare(
        `SELECT DISTINCT advert_id, nm_id FROM campaign_stats_by_nm WHERE advert_id IN (${ph})`,
      ).all(...adverts) as Pair[];
    }
    // Сохранить приоритет: пары одного advert_id идут группой согласно adverts[]
    pairs = sortByAdvertPriority(pairs, adverts);
  }

  if (pairs.length === 0) return NextResponse.json({ ok: true, pairs: 0, rowsWritten: 0 });

  // 10-минутный кэш как у ивирмы (expiredAt:+10m).
  if (!force) {
    const cacheCheck = db.prepare(
      "SELECT MAX(updated_at) u FROM campaign_preset_keywords WHERE advert_id=? AND nm_id=?",
    );
    const fresh: typeof pairs = [];
    for (const p of pairs) {
      const r = cacheCheck.get(p.advert_id, p.nm_id) as { u: string | null } | undefined;
      if (r?.u) {
        const ageMs = dbTimestampAgeMs(r.u);
        if (ageMs != null && ageMs >= 0 && ageMs < CACHE_WINDOW_MS) { skipped.push(`${p.advert_id}/${p.nm_id}`); continue; }
      }
      fresh.push(p);
    }
    pairs = fresh;
    if (pairs.length === 0) {
      return NextResponse.json({ ok: true, pairs: 0, rowsWritten: 0, skipped, note: "all fresh in cache" });
    }
  }

  const savedSession = loadSavedCmpSession();
  let page: import("puppeteer").Page | null = null;

  async function refreshAuth(): Promise<{ accessToken: string; supplierId: string }> {
    if (savedSession) {
      return { accessToken: savedSession.authorizev3, supplierId: savedSession.supplierId };
    }
    if (!page) {
      const auto = await ensureCmpPage();
      if (!auto.page) throw new Error(auto.error || "Браузер не запущен");
      page = auto.page;
    }
    if (!page!.url().includes("cmp.wildberries.ru")) {
      await page!.goto("https://cmp.wildberries.ru/campaigns/list", { waitUntil: "domcontentloaded", timeout: 20000 });
      await sleep(300);
    }
    const tok = await page!.evaluate(() => localStorage.getItem("access-token"));
    const cs = await page!.cookies("https://cmp.wildberries.ru", "https://seller.wildberries.ru");
    const sid = cs.find((c) => c.name === "x-supplier-id")?.value || "";
    return { accessToken: tok || "", supplierId: sid };
  }

  let { accessToken, supplierId } = await refreshAuth().catch((e) => ({ accessToken: "", supplierId: "", error: e instanceof Error ? e.message : String(e) }) as { accessToken: string; supplierId: string; error?: string });
  if (!accessToken) return NextResponse.json({ ok: false, error: "Не найден access-token" }, { status: 401 });

  async function fetchPage(advertID: number, nmId: number, pageNumber: number): Promise<{ status: number | string; body: PresetResponse | null }> {
    const url =
      `https://cmp.wildberries.ru/api/v1/advert/${advertID}/preset-info` +
      `?page_size=300&page_number=${pageNumber}` +
      `&filter_query=&from=${fromParam}&to=${toParam}` +
      `&sort_direction=descend&nm_id=${nmId}` +
      `&calc_pages=true&calc_total=true`;
    if (savedSession) {
      try {
        const ac = new AbortController();
        const tmr = setTimeout(() => ac.abort(), 15000);
        const res = await fetch(url, {
          method: "GET",
          signal: ac.signal,
          headers: {
            "X-SupplierId": supplierId,
            "Authorizev3": accessToken,
            "Lang": "ru",
            "Accept": "application/json",
            "Cookie": savedSession.cookieHeader,
            "Origin": "https://cmp.wildberries.ru",
            "Referer": "https://cmp.wildberries.ru/campaigns/list",
            "User-Agent": CMP_USER_AGENT,
          },
        });
        clearTimeout(tmr);
        if (res.status !== 200) return { status: res.status, body: null };
        return { status: 200, body: await res.json() as PresetResponse };
      } catch (e) { return { status: "error:" + String(e), body: null }; }
    }
    return await page!.evaluate(
      async (u: string, s: string, t: string | null) => {
        try {
          const ac = new AbortController();
          const tmr = setTimeout(() => ac.abort(), 15000);
          const res = await fetch(u, {
            method: "GET",
            credentials: "include",
            signal: ac.signal,
            headers: { "X-SupplierId": s, "Authorizev3": t || "", "Lang": "ru", "Accept": "application/json" },
          });
          clearTimeout(tmr);
          if (res.status !== 200) return { status: res.status, body: null };
          const json = await res.json();
          return { status: 200, body: json };
        } catch (e) { return { status: "error:" + String(e), body: null }; }
      },
      url, supplierId, accessToken,
    );
  }

  const insert = db.prepare(`
    INSERT OR REPLACE INTO campaign_preset_keywords
      (advert_id, nm_id, name, is_excluded,
       views, clicks, baskets, orders, shks,
       ctr, cpc, cpm, avg_pos, spend,
       actual_cpm, currency, from_date, to_date, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const delPair = db.prepare("DELETE FROM campaign_preset_keywords WHERE advert_id = ? AND nm_id = ?");

  const GAP_MS = 250; // 4 rps как у ивирмы (limit:1, period:250)

  let pairsOk = 0;
  let rowsWritten = 0;
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const pg = databaseUrl ? new Client({ connectionString: databaseUrl }) : null;

  g.__presetInfoProgress = { current: 0, total: pairs.length, running: true, ok: 0, err: 0 };

  if (pg) await pg.connect();
  try {
    for (let i = 0; i < pairs.length; i++) {
      if (g.__syncCancelled) { errors.push("cancelled by user"); break; }
      const { advert_id, nm_id } = pairs[i];
      g.__presetInfoProgress = { current: i, total: pairs.length, running: true, ok: pairsOk, err: errors.length };
      try {
        // page 1
        let r = await fetchPage(advert_id, nm_id, 1);
        if (r.status === 429) {
          errors.push(`${advert_id}/${nm_id}: 429 → skip`);
          await sleep(GAP_MS);
          continue;
        }
        if (typeof r.status === "string" && r.status.startsWith("error")) {
          errors.push(`${advert_id}/${nm_id}: net-err → re-auth + retry`);
          await sleep(3000);
          try {
            const fresh = await refreshAuth();
            accessToken = fresh.accessToken || accessToken;
            supplierId = fresh.supplierId || supplierId;
          } catch { /* */ }
          r = await fetchPage(advert_id, nm_id, 1);
        }
        if (r.status !== 200 || !r.body) {
          errors.push(`${advert_id}/${nm_id}: ${r.status}`);
          await sleep(GAP_MS);
          continue;
        }

        const count = r.body.count || 0;
        const totalPages = Math.max(1, Math.ceil(count / 300));
        const allItems: PresetItem[] = [...(r.body.items || [])];
        let pageFailed = false;
        for (let p = 2; p <= totalPages; p++) {
          await sleep(GAP_MS);
          const rp = await fetchPage(advert_id, nm_id, p);
          if (rp.status !== 200 || !rp.body) {
            errors.push(`${advert_id}/${nm_id} page ${p}: ${rp.status}`);
            pageFailed = true;
            break;
          }
          allItems.push(...(rp.body.items || []));
        }
        if (pageFailed) {
          await sleep(GAP_MS);
          continue;
        }

        if (pg) {
          await pg.query("BEGIN");
          try {
            await pg.query("DELETE FROM campaign_preset_keywords WHERE advert_id = $1 AND nm_id = $2", [advert_id, nm_id]);
            for (const it of allItems) {
              if (!it.name) continue;
              const info = await pg.query(`
                INSERT INTO campaign_preset_keywords
                  (advert_id, nm_id, name, is_excluded,
                   views, clicks, baskets, orders, shks,
                   ctr, cpc, cpm, avg_pos, spend,
                   actual_cpm, currency, from_date, to_date, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, now()::text)
                ON CONFLICT (advert_id, nm_id, name) DO UPDATE SET
                  is_excluded = EXCLUDED.is_excluded,
                  views = EXCLUDED.views,
                  clicks = EXCLUDED.clicks,
                  baskets = EXCLUDED.baskets,
                  orders = EXCLUDED.orders,
                  shks = EXCLUDED.shks,
                  ctr = EXCLUDED.ctr,
                  cpc = EXCLUDED.cpc,
                  cpm = EXCLUDED.cpm,
                  avg_pos = EXCLUDED.avg_pos,
                  spend = EXCLUDED.spend,
                  actual_cpm = EXCLUDED.actual_cpm,
                  currency = EXCLUDED.currency,
                  from_date = EXCLUDED.from_date,
                  to_date = EXCLUDED.to_date,
                  updated_at = now()::text
              `, [
                advert_id, nm_id, it.name,
                it.is_excluded ? 1 : 0,
                it.views ?? 0, it.clicks ?? 0, it.baskets ?? 0, it.orders ?? 0, it.shks ?? 0,
                it.ctr ?? 0, it.cpc ?? 0, it.cpm ?? 0, it.avg_pos ?? 0, it.spend ?? 0,
                it.actual_cpm ?? null, it.currency ?? null, fromParam, toParam,
              ]);
              rowsWritten += info.rowCount ?? 0;
            }
            await pg.query("COMMIT");
          } catch (e) {
            await pg.query("ROLLBACK").catch(() => {});
            throw e;
          }
        } else {
          db.transaction(() => {
            delPair.run(advert_id, nm_id);
            for (const it of allItems) {
              if (!it.name) continue;
              insert.run(
                advert_id, nm_id, it.name,
                it.is_excluded ? 1 : 0,
                it.views ?? 0, it.clicks ?? 0, it.baskets ?? 0, it.orders ?? 0, it.shks ?? 0,
                it.ctr ?? 0, it.cpc ?? 0, it.cpm ?? 0, it.avg_pos ?? 0, it.spend ?? 0,
                it.actual_cpm ?? null, it.currency ?? null, fromParam, toParam,
              );
              rowsWritten++;
            }
          })();
        }
        pairsOk++;
      } catch (e) {
        errors.push(`${advert_id}/${nm_id}: ${e instanceof Error ? e.message : String(e)}`);
      }
      await sleep(GAP_MS);
    }
  } finally {
    if (pg) await pg.end();
  }

  g.__presetInfoProgress = { current: pairs.length, total: pairs.length, running: false, ok: pairsOk, err: errors.length };

  return NextResponse.json({ ok: true, pairs: pairsOk, rowsWritten, skipped, errors });
}
