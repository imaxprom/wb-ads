import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { localDateStr } from "@/lib/format";

export const dynamic = "force-dynamic";

export interface AdsCampaign {
  advertId: number;
  name: string;
  type: number | null;
  status: number;
  bidType: string | null;
  bidKopecks: number | null;
  paymentType: string | null;
  placements: { search: boolean; recommendations: boolean; catalog?: boolean } | null;
  startTime: string | null;
  changeTime: string | null;
  subjectId: number | null;
  subject: string | null;
  nmIds: number[];
  historicalNmIds: number[];
  firstNmId: number | null;
  firstProductTitle: string | null;
  firstProductUpdatedAt: string | null;
  startedDaysAgo: number | null;
  lastActiveDate: string | null;
  budgetTotal: number;
  budgetCash: number;
  phrasesCount: number;
  // Period aggregates
  views: number;
  clicks: number;
  ctr: number;
  cpc: number;
  spend: number;
  atbs: number;
  orders: number;
  sumPrice: number;
  cr: number;
  drr: number;
  // Today / yesterday
  spendToday: number;
  spendYesterday: number;
  // Фактически списано WB за период (из expense_history / /adv/v1/upd).
  // Может отличаться от `spend` (начислено) при автопополнении/смешивании с бонусами.
  paidPeriod: number;
  // Zones (approximate)
  zoneSearchShare: number;
  zoneRecoShare: number;
  zoneCatalogShare: number;
  zoneSearchActive: boolean;
  zoneRecoActive: boolean;
  minCpmUnified: number;
  zoneCatalogActive: boolean;
  // История успешных пополнений бюджета (последние 10), DESC.
  // Источник — bid_changes_log с our_status LIKE 'budget_deposit%' AND wb_status=200.
  depositHistory: { at: string; sum: number; type: number }[];
  // История успешных смен единой ставки Uni (последние 10), DESC.
  // Источник — bid_changes_log с our_status IN ('ok:campaign_level', 'ok:cpc_campaign_level') AND wb_status=200.
  bidHistory: { at: string; rub: number }[];
}

export async function GET(request: NextRequest) {
  const db = getDb();
  const sp = request.nextUrl.searchParams;
  const days = Math.max(1, Math.min(90, Number(sp.get("days") || "7")));
  const offset = Math.max(0, Number(sp.get("offset") || "0"));
  const today = localDateStr(new Date());
  const yesterday = localDateStr(new Date(Date.now() - 86400000));
  const endDate = localDateStr(new Date(Date.now() - offset * 86400000));
  const startDate = localDateStr(new Date(Date.now() - (days - 1 + offset) * 86400000));

  const rows = db.prepare(`
    SELECT c.advert_id, c.name, c.type, c.status, c.bid_type, c.bid_kopecks,
           c.payment_type, c.placements_json,
           c.create_time, c.start_time, c.change_time, c.subject_id, c.nms_json,
           s.min_cpm_unified
    FROM campaigns c
    LEFT JOIN subject_min_cpm s ON s.subject_id = c.subject_id
  `).all() as {
    advert_id: number; name: string; type: number | null; status: number;
    bid_type: string | null; bid_kopecks: number | null; payment_type: string | null;
    placements_json: string | null;
    create_time: string | null; start_time: string | null; change_time: string | null;
    subject_id: number | null; nms_json: string | null;
    min_cpm_unified: number | null;
  }[];

  // Budgets
  const budgets = db.prepare("SELECT advert_id, cash, total, updated_at FROM campaign_budgets").all() as { advert_id: number; cash: number; total: number; updated_at: string }[];
  const budgetMap = new Map(budgets.map((b) => [b.advert_id, b]));

  // Period stats
  const statsRows = db.prepare(`
    SELECT advert_id,
           SUM(views) views, SUM(clicks) clicks, SUM(sum) sum,
           SUM(atbs) atbs, SUM(orders) orders, SUM(sum_price) sum_price
    FROM campaign_stats_daily
    WHERE date >= ? AND date <= ?
    GROUP BY advert_id
  `).all(startDate, endDate) as { advert_id: number; views: number; clicks: number; sum: number; atbs: number; orders: number; sum_price: number }[];
  const statsMap = new Map(statsRows.map((r) => [r.advert_id, r]));

  // Today / yesterday spend
  const todayRows = db.prepare("SELECT advert_id, sum FROM campaign_stats_daily WHERE date = ?").all(today) as { advert_id: number; sum: number }[];
  const todayMap = new Map(todayRows.map((r) => [r.advert_id, r.sum]));
  const yestRows = db.prepare("SELECT advert_id, sum FROM campaign_stats_daily WHERE date = ?").all(yesterday) as { advert_id: number; sum: number }[];
  const yestMap = new Map(yestRows.map((r) => [r.advert_id, r.sum]));

  // Last active date
  const lastActRows = db.prepare("SELECT advert_id, MAX(date) last_date FROM campaign_stats_daily WHERE views > 0 OR clicks > 0 OR sum > 0 GROUP BY advert_id").all() as { advert_id: number; last_date: string }[];
  const lastActMap = new Map(lastActRows.map((r) => [r.advert_id, r.last_date]));

  // Search cluster views per campaign (for phrases count)
  const clusterRows = db.prepare(`
    SELECT advert_id, SUM(views) v, SUM(clicks) c, COUNT(DISTINCT norm_query) q
    FROM search_cluster_stats
    WHERE date >= ? AND date <= ?
    GROUP BY advert_id
  `).all(startDate, endDate) as { advert_id: number; v: number; c: number; q: number }[];
  const clusterMap = new Map(clusterRows.map((r) => [r.advert_id, r]));

  // Real zone distribution. Источник — campaign_days (закрытый cmp API через fullstat-v3),
  // там WB сама агрегирует views по зонам в полях views_search/views_catalog/views_reco.
  // Раньше тут читали из campaign_zones_daily — но в этой таблице давно нет writer'а
  // (последняя запись 19 апр), поэтому колонка «Зоны» была пустой. campaign_days
  // обновляется вместе с per-campaign daily stats и содержит свежие зоны до вчера.
  const zoneRows = db.prepare(`
    SELECT advert_id,
           SUM(views_search) search,
           SUM(views_catalog) catalog,
           SUM(views_reco) reco
    FROM campaign_days
    WHERE date >= ? AND date <= ?
    GROUP BY advert_id
  `).all(startDate, endDate) as { advert_id: number; search: number; catalog: number; reco: number }[];
  const zoneMap = new Map<number, { search: number; catalog: number; reco: number }>();
  for (const z of zoneRows) {
    zoneMap.set(z.advert_id, { search: z.search || 0, catalog: z.catalog || 0, reco: z.reco || 0 });
  }

  // Фактические списания WB по кампании за период. Источник — `expense_history`,
  // наполняется sync'ом /api/sync/expense-history (WB endpoint /adv/v1/upd). Колонка
  // `date` — ISO timestamp с секундами и таймзоной, поэтому фильтр по началу строки
  // (substr 1..10 = YYYY-MM-DD).
  const paidRows = db.prepare(`
    SELECT advert_id, SUM(amount) paid
    FROM expense_history
    WHERE advert_id IS NOT NULL
      AND substr(date, 1, 10) >= ?
      AND substr(date, 1, 10) <= ?
    GROUP BY advert_id
  `).all(startDate, endDate) as { advert_id: number; paid: number }[];
  const paidMap = new Map(paidRows.map((r) => [r.advert_id, r.paid]));

  // История успешных пополнений бюджета (для тултипа на колонке «бюджет»).
  // bid_changes_log используется и для ставок, и для бюджета — фильтруем по our_status и
  // wb_status=200, чтобы показывать только применившиеся пополнения. Парсим type из строки
  // our_status формата "budget_deposit:type=N,cb=...". Лимит 10 последних per advert.
  const depositRowsRaw = db.prepare(`
    SELECT advert_id, at, requested_kopecks, our_status
    FROM bid_changes_log
    WHERE our_status LIKE 'budget_deposit%' AND wb_status = 200
    ORDER BY id DESC
  `).all() as { advert_id: number; at: string; requested_kopecks: number | null; our_status: string }[];
  const depositMap = new Map<number, { at: string; sum: number; type: number }[]>();
  for (const r of depositRowsRaw) {
    const arr = depositMap.get(r.advert_id) ?? [];
    if (arr.length >= 10) continue;
    const m = r.our_status.match(/type=(\d+)/);
    const type = m ? parseInt(m[1], 10) : 0;
    arr.push({ at: r.at, sum: r.requested_kopecks ?? 0, type });
    depositMap.set(r.advert_id, arr);
  }

  // История успешных смен единой ставки Uni-кампании (для тултипа на колонке «ставка»).
  // Источник тот же bid_changes_log, our_status='ok:campaign_level' (см. set-campaign-bid).
  // final_kopecks → рубли. Лимит 10 последних per advert.
  const bidRowsRaw = db.prepare(`
    SELECT advert_id, at, final_kopecks
    FROM bid_changes_log
    WHERE our_status IN ('ok:campaign_level', 'ok:cpc_campaign_level') AND wb_status = 200
    ORDER BY id DESC
  `).all() as { advert_id: number; at: string; final_kopecks: number | null }[];
  const bidHistoryMap = new Map<number, { at: string; rub: number }[]>();
  for (const r of bidRowsRaw) {
    const arr = bidHistoryMap.get(r.advert_id) ?? [];
    if (arr.length >= 10) continue;
    arr.push({ at: r.at, rub: Math.round((r.final_kopecks ?? 0) / 100) });
    bidHistoryMap.set(r.advert_id, arr);
  }

  // Products for first-nm title/subject
  const productsRows = db.prepare("SELECT nm_id, title, subject, updated_at FROM products").all() as { nm_id: number; title: string | null; subject: string | null; updated_at: string | null }[];
  const productsMap = new Map(productsRows.map((p) => [p.nm_id, p]));

  // Historical nm_id associations per advert — для фильтра «Артикул / ID».
  // Считаем «принадлежит артикулу» только когда артикул реально получал по этой
  // кампании ПРЯМЫЕ показы (views>0). Ассоциированные корзины/заказы (spillover
  // с других товаров кампании) не делают артикул рекламирующимся в этой кампании.
  const histRows = db.prepare(`
    SELECT DISTINCT advert_id, nm_id
    FROM campaign_stats_by_nm
    WHERE views > 0
  `).all() as { advert_id: number; nm_id: number }[];
  const histByAdvert = new Map<number, number[]>();
  for (const r of histRows) {
    const arr = histByAdvert.get(r.advert_id) ?? [];
    arr.push(r.nm_id);
    histByAdvert.set(r.advert_id, arr);
  }

  const campaigns: AdsCampaign[] = rows.map((r) => {
    const nmIds: number[] = r.nms_json ? JSON.parse(r.nms_json) : [];
    const firstNmId = nmIds[0] ?? null;
    const product = firstNmId ? productsMap.get(firstNmId) : null;
    const budget = budgetMap.get(r.advert_id);
    const s = statsMap.get(r.advert_id);
    const cluster = clusterMap.get(r.advert_id);
    const placements = r.placements_json ? JSON.parse(r.placements_json) : null;

    const views = s?.views || 0;
    const clicks = s?.clicks || 0;
    const spend = s?.sum || 0;
    const ordersN = s?.orders || 0;
    const sumPrice = s?.sum_price || 0;
    const atbs = s?.atbs || 0;
    const ctr = views > 0 ? (clicks / views) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const cr = clicks > 0 ? (ordersN / clicks) * 100 : 0;
    const drr = sumPrice > 0 ? (spend / sumPrice) * 100 : 0;

    // Real zones from campaign_days (заполняется fullstat-v3 из cmp.wildberries.ru).
    const z = zoneMap.get(r.advert_id);
    // Only compute shares when zone totals cover at least 70% of campaign views
    // (otherwise we have partial sync data — one placementType missing → wrong shares).
    const zTotal = z ? z.search + z.catalog + z.reco : 0;
    const complete = zTotal > 0 && (views === 0 || zTotal >= views * 0.7);
    const searchShare = complete ? (z!.search / zTotal) * 100 : 0;
    const catalogShare = complete ? (z!.catalog / zTotal) * 100 : 0;
    const recoShare = complete ? (z!.reco / zTotal) * 100 : 0;
    const recoActive = placements?.recommendations === true;
    const catalogActive = placements?.catalog === true;
    const searchActive = placements?.search === true;

    // Phrases count — approximate: for manual campaigns it's search_cluster_bids, for unified it's cluster distinct queries
    const phrasesCount = cluster?.q || 0;

    // Campaign age = days since it was CREATED (matches common marketing tools).
    // `start_time` is the last start-after-pause, which understates age — don't use here.
    const startTime = r.create_time;
    let startedDaysAgo: number | null = null;
    if (startTime) {
      const d = new Date(startTime);
      startedDaysAgo = Math.floor((Date.now() - d.getTime()) / 86400000);
    }

    return {
      advertId: r.advert_id,
      name: r.name,
      type: r.type,
      status: r.status,
      bidType: r.bid_type,
      bidKopecks: r.bid_kopecks,
      paymentType: r.payment_type,
      placements,
      startTime,
      changeTime: r.change_time,
      subjectId: r.subject_id,
      subject: product?.subject || null,
      nmIds,
      historicalNmIds: histByAdvert.get(r.advert_id) ?? [],
      firstNmId,
      firstProductTitle: product?.title || null,
      firstProductUpdatedAt: product?.updated_at || null,
      startedDaysAgo,
      lastActiveDate: lastActMap.get(r.advert_id) || null,
      budgetTotal: budget?.total || 0,
      budgetCash: budget?.cash || 0,
      phrasesCount,
      views, clicks, ctr, cpc, spend, atbs, orders: ordersN, sumPrice, cr, drr,
      spendToday: todayMap.get(r.advert_id) || 0,
      spendYesterday: yestMap.get(r.advert_id) || 0,
      paidPeriod: paidMap.get(r.advert_id) || 0,
      zoneSearchShare: searchShare,
      zoneRecoShare: recoShare,
      zoneCatalogShare: catalogShare,
      zoneSearchActive: searchActive,
      zoneRecoActive: recoActive,
      zoneCatalogActive: catalogActive,
      minCpmUnified: r.min_cpm_unified || 0,
      depositHistory: depositMap.get(r.advert_id) ?? [],
      bidHistory: bidHistoryMap.get(r.advert_id) ?? [],
    };
  });

  // Totals for top panel
  const spendTodayTotal = campaigns.reduce((s, c) => s + c.spendToday, 0);
  const balanceRow = db.prepare("SELECT balance, net FROM balance_history ORDER BY id DESC LIMIT 1").get() as { balance: number; net: number } | undefined;
  const balance = balanceRow ? (balanceRow.balance || 0) + (balanceRow.net || 0) : 0;

  // Expense "paid today" — `date` stores an ISO timestamp, so match by YYYY-MM-DD.
  const paidToday = db.prepare(`
    SELECT SUM(amount) s
    FROM expense_history
    WHERE advert_id IS NOT NULL
      AND substr(date, 1, 10) = ?
  `).get(today) as { s: number | null } | undefined;

  return NextResponse.json({
    ok: true,
    period: { startDate, endDate, days, offset },
    totals: {
      spendTodayTotal,
      paidToday: paidToday?.s || 0,
      balance,
    },
    campaigns,
  });
}
