import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiKey } from "@/lib/api-key";
import { localDateStr } from "@/lib/format";
import { getHotCampaignAdvertIds } from "@/lib/campaign-queue";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const BASE = "https://advert-api.wildberries.ru";

// Гибридный source списка фраз через open API. Дополняет (не заменяет) closed cmp /preset-info.
// Источники:
//   POST /adv/v0/normquery/list      → каркас active/excluded (camelCase!)
//   POST /adv/v0/normquery/get-bids  → actual_cpm per фраза (snake_case)
//   POST /adv/v0/normquery/stats     → views/clicks/atbs/orders/ctr/cpc/cpm/avg_pos за период
//
// UPSERT в campaign_preset_keywords по PK (advert_id, nm_id, name) с **MAX-семантикой** для чисел:
// если closed cmp уже записал views=100, а open вернул views=80 — оставляем 100 (бoльшее = истина).
// Расхождения is_excluded → берём последнюю запись (последний sync wins).

const g = globalThis as unknown as {
  __presetInfoOpenProgress?: { current: number; total: number; running: boolean; ok: number; err: number };
};

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export async function GET() {
  const p = g.__presetInfoOpenProgress || { current: 0, total: 0, running: false, ok: 0, err: 0 };
  return NextResponse.json(p);
}

interface ListResp {
  items?: Array<{
    advertId?: number;
    nmId?: number;
    advert_id?: number;
    nm_id?: number;
    normQueries?: { active?: string[]; excluded?: string[] };
    norm_queries?: { active?: string[]; excluded?: string[] };
  }> | null;
}

interface BidsResp {
  bids?: Array<{
    advert_id: number;
    nm_id: number;
    norm_query: string;
    bid?: number;
    bid_kopecks?: number;
    currency?: string;
  }>;
}

interface StatItem {
  norm_query: string;
  views?: number;
  clicks?: number;
  ctr?: number;
  cpc?: number;
  cpm?: number;
  atbs?: number;
  orders?: number;
  avg_pos?: number;
}
interface StatsResp {
  stats?: Array<{ advert_id: number; nm_id: number; stats?: StatItem[] }>;
}

type Pair = { advert_id: number; nm_id: number };

function pairKey(p: Pair) {
  return `${p.advert_id}/${p.nm_id}`;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const apiKey = getApiKey();
  const sp = request.nextUrl.searchParams;

  // Параметры
  const advertIdParam = sp.get("advertID") || sp.get("advertId");
  const nmIdParam = sp.get("nmId");
  const today = localDateStr(new Date());
  const weekAgo = localDateStr(new Date(Date.now() - 6 * 86400000));
  const fromParam = sp.get("from") || weekAgo;
  const toParam = sp.get("to") || today;

  // Сборка списка пар (advert_id, nm_id) для синка.
  let pairs: Pair[];
  if (advertIdParam) {
    const advertId = Number(advertIdParam);
    if (!advertId) return NextResponse.json({ ok: false, error: "advertID invalid" }, { status: 400 });
    if (nmIdParam) {
      pairs = [{ advert_id: advertId, nm_id: Number(nmIdParam) }];
    } else {
      const camp = db.prepare(`SELECT nms_json FROM campaigns WHERE advert_id = ?`).get(advertId) as { nms_json: string | null } | undefined;
      let nms: number[] = [];
      try {
        const arr = JSON.parse(camp?.nms_json || "[]");
        if (Array.isArray(arr)) nms = arr.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
      } catch { /* */ }
      if (nms.length === 0) return NextResponse.json({ ok: false, error: "no nm_ids in campaign" }, { status: 400 });
      pairs = nms.map((nm_id) => ({ advert_id: advertId, nm_id }));
    }
  } else {
    // Все горячие кампании × их nm_ids.
    const adverts = getHotCampaignAdvertIds(db);
    if (adverts.length === 0) return NextResponse.json({ ok: true, note: "no hot campaigns" });
    const ph = adverts.map(() => "?").join(",");
    const camps = db.prepare(`SELECT advert_id, nms_json FROM campaigns WHERE advert_id IN (${ph})`).all(...adverts) as { advert_id: number; nms_json: string | null }[];
    pairs = [];
    for (const c of camps) {
      try {
        const arr = JSON.parse(c.nms_json || "[]");
        if (Array.isArray(arr)) {
          for (const n of arr) {
            const v = Number(n);
            if (Number.isFinite(v) && v > 0) pairs.push({ advert_id: c.advert_id, nm_id: v });
          }
        }
      } catch { /* */ }
    }
  }
  if (pairs.length === 0) return NextResponse.json({ ok: true, note: "no pairs to sync" });

  g.__presetInfoOpenProgress = { current: 0, total: pairs.length, running: true, ok: 0, err: 0 };

  // UPSERT с MAX-семантикой для числовых полей. Текстовые — last-write-wins.
  const upsertStmt = db.prepare(`
    INSERT INTO campaign_preset_keywords
      (advert_id, nm_id, name, is_excluded, views, clicks, baskets, orders, shks,
       ctr, cpc, cpm, avg_pos, spend, actual_cpm, currency, from_date, to_date, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(advert_id, nm_id, name) DO UPDATE SET
      is_excluded = excluded.is_excluded,
      views     = MAX(campaign_preset_keywords.views,    excluded.views),
      clicks    = MAX(campaign_preset_keywords.clicks,   excluded.clicks),
      baskets   = MAX(campaign_preset_keywords.baskets,  excluded.baskets),
      orders    = MAX(campaign_preset_keywords.orders,   excluded.orders),
      shks      = MAX(campaign_preset_keywords.shks,     excluded.shks),
      ctr       = MAX(campaign_preset_keywords.ctr,      excluded.ctr),
      cpc       = MAX(campaign_preset_keywords.cpc,      excluded.cpc),
      cpm       = MAX(campaign_preset_keywords.cpm,      excluded.cpm),
      avg_pos   = MAX(campaign_preset_keywords.avg_pos,  excluded.avg_pos),
      spend     = MAX(campaign_preset_keywords.spend,    excluded.spend),
      actual_cpm = COALESCE(MAX(campaign_preset_keywords.actual_cpm, excluded.actual_cpm), excluded.actual_cpm, campaign_preset_keywords.actual_cpm),
      currency  = COALESCE(excluded.currency, campaign_preset_keywords.currency),
      from_date = excluded.from_date,
      to_date   = excluded.to_date,
      updated_at = datetime('now')
  `);

  const errors: string[] = [];
  let pairsOk = 0;
  let rowsTouched = 0;

  // WB normquery endpoints accept up to 100 items per request. Batch by that hard limit:
  // 3 requests per chunk (list/get-bids/stats), not 3 requests per advert/nm pair.
  const CHUNK_SIZE = 100;
  const REQUEST_GAP_MS = 500;
  const CHUNK_GAP_MS = 6100;
  const pairChunks = chunks(pairs, CHUNK_SIZE);

  for (let chunkIndex = 0; chunkIndex < pairChunks.length; chunkIndex++) {
    const chunk = pairChunks[chunkIndex];
    const chunkStart = chunkIndex * CHUNK_SIZE;
    const chunkLabel = `chunk ${chunkStart + 1}-${chunkStart + chunk.length}`;
    g.__presetInfoOpenProgress!.current = chunkStart;

    const phraseSets = new Map<string, Map<string, { is_excluded: 0 | 1 }>>();
    const bidsByPair = new Map<string, Map<string, number | null>>();
    const statsByPair = new Map<string, Map<string, StatItem>>();

    try {
      // 1) /list — каркас active + excluded (camelCase!)
      const listRes = await fetch(`${BASE}/adv/v0/normquery/list`, {
        method: "POST",
        headers: { "Authorization": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ items: chunk.map((p) => ({ advertId: p.advert_id, nmId: p.nm_id })) }),
      });
      if (listRes.status === 429) {
        errors.push(`${chunkLabel} list 429`);
        g.__presetInfoOpenProgress!.err = errors.length;
        await sleep(60000);
        continue;
      }
      if (!listRes.ok) {
        errors.push(`${chunkLabel} list ${listRes.status}`);
        g.__presetInfoOpenProgress!.err = errors.length;
        await sleep(REQUEST_GAP_MS);
        continue;
      }
      const listData = await listRes.json() as ListResp;
      for (const item of listData.items || []) {
        const advert_id = Number(item.advertId ?? item.advert_id);
        const nm_id = Number(item.nmId ?? item.nm_id);
        if (!Number.isFinite(advert_id) || !Number.isFinite(nm_id)) continue;
        const normQueries = item.normQueries ?? item.norm_queries;
        const phraseSet = new Map<string, { is_excluded: 0 | 1 }>();
        for (const ph of normQueries?.active ?? []) phraseSet.set(ph, { is_excluded: 0 });
        for (const ph of normQueries?.excluded ?? []) phraseSet.set(ph, { is_excluded: 1 });
        phraseSets.set(pairKey({ advert_id, nm_id }), phraseSet);
      }

      await sleep(REQUEST_GAP_MS);

      // 2) /get-bids — actual_cpm (только для manual; для unified обычно пусто)
      try {
        const bidsRes = await fetch(`${BASE}/adv/v0/normquery/get-bids`, {
          method: "POST",
          headers: { "Authorization": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ items: chunk.map((p) => ({ advert_id: p.advert_id, nm_id: p.nm_id })) }),
        });
        if (bidsRes.ok) {
          const bidsData = await bidsRes.json() as BidsResp;
          for (const b of bidsData.bids || []) {
            const key = pairKey({ advert_id: b.advert_id, nm_id: b.nm_id });
            const byPhrase = bidsByPair.get(key) ?? new Map<string, number | null>();
            // bid_kopecks приоритетнее (точнее), иначе bid (рубли) × 100
            const cpm = b.bid_kopecks ?? (b.bid != null ? b.bid * 100 : null);
            byPhrase.set(b.norm_query, cpm);
            bidsByPair.set(key, byPhrase);
          }
        } else if (bidsRes.status === 429) {
          errors.push(`${chunkLabel} bids 429`);
          g.__presetInfoOpenProgress!.err = errors.length;
          await sleep(5000);
        } else {
          errors.push(`${chunkLabel} bids ${bidsRes.status}`);
          g.__presetInfoOpenProgress!.err = errors.length;
        }
      } catch (e) {
        errors.push(`${chunkLabel} bids: ${e instanceof Error ? e.message : String(e)}`);
        g.__presetInfoOpenProgress!.err = errors.length;
      }

      await sleep(REQUEST_GAP_MS);

      // 3) /stats — агрегат за период (from/to). Возвращает только фразы с views > 0.
      try {
        const statsRes = await fetch(`${BASE}/adv/v0/normquery/stats`, {
          method: "POST",
          headers: { "Authorization": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: fromParam,
            to: toParam,
            items: chunk.map((p) => ({ advert_id: p.advert_id, nm_id: p.nm_id })),
          }),
        });
        if (statsRes.ok) {
          const statsData = await statsRes.json() as StatsResp;
          for (const g of statsData.stats || []) {
            const key = pairKey({ advert_id: g.advert_id, nm_id: g.nm_id });
            const byPhrase = statsByPair.get(key) ?? new Map<string, StatItem>();
            for (const s of g.stats || []) byPhrase.set(s.norm_query, s);
            statsByPair.set(key, byPhrase);
          }
        } else if (statsRes.status === 429) {
          errors.push(`${chunkLabel} stats 429`);
          g.__presetInfoOpenProgress!.err = errors.length;
          await sleep(60000);
        } else {
          errors.push(`${chunkLabel} stats ${statsRes.status}`);
          g.__presetInfoOpenProgress!.err = errors.length;
        }
      } catch (e) {
        errors.push(`${chunkLabel} stats: ${e instanceof Error ? e.message : String(e)}`);
        g.__presetInfoOpenProgress!.err = errors.length;
      }

      // 4) UPSERT в campaign_preset_keywords с MAX-семантикой
      db.transaction(() => {
        for (const pair of chunk) {
          const key = pairKey(pair);
          const phraseSet = phraseSets.get(key) ?? new Map<string, { is_excluded: 0 | 1 }>();
          const bidsByPhrase = bidsByPair.get(key) ?? new Map<string, number | null>();
          const statsByPhrase = statsByPair.get(key) ?? new Map<string, StatItem>();
          for (const [name, meta] of phraseSet.entries()) {
            const stat = statsByPhrase.get(name);
            const cpm = bidsByPhrase.get(name) ?? null;
            const views = stat?.views ?? 0;
            const clicks = stat?.clicks ?? 0;
            const ctr = stat?.ctr ?? 0;
            const cpc = stat?.cpc ?? 0;
            const cpmM = stat?.cpm ?? 0;
            const avgPos = stat?.avg_pos ?? 0;
            const baskets = stat?.atbs ?? 0;
            const orders = stat?.orders ?? 0;
            // spend computed: clicks × cpc (open API не отдаёт spend отдельно)
            const spend = clicks * cpc;
            upsertStmt.run(
              pair.advert_id, pair.nm_id, name, meta.is_excluded,
              views, clicks, baskets, orders, 0 /* shks */,
              ctr, cpc, cpmM, avgPos, spend,
              cpm, "RUB", fromParam, toParam,
            );
            rowsTouched++;
          }
        }
      })();

      pairsOk += chunk.length;
      g.__presetInfoOpenProgress!.ok = pairsOk;
      g.__presetInfoOpenProgress!.current = chunkStart + chunk.length;
    } catch (e) {
      errors.push(`${chunkLabel}: ${e instanceof Error ? e.message : String(e)}`);
      g.__presetInfoOpenProgress!.err = errors.length;
    }

    if (chunkIndex < pairChunks.length - 1) await sleep(CHUNK_GAP_MS);
  }

  g.__presetInfoOpenProgress!.current = pairs.length;
  g.__presetInfoOpenProgress!.running = false;

  return NextResponse.json({ ok: true, pairs: pairsOk, rowsTouched, errors });
}
