import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { DashboardResponse, DashboardProduct, CampaignInfo } from "@/types";
import { localDateStr } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const db = getDb();
  const days = Math.min(90, Math.max(1, Number(request.nextUrl.searchParams.get("days") || "7")));
  const offset = Math.max(0, Number(request.nextUrl.searchParams.get("offset") || "0"));

  // Use local (Moscow) date, not UTC — WB data uses Moscow timezone
  // offset=0: dateTo=today. offset=1 (Вчера): dateTo=yesterday
  const dateTo = localDateStr(new Date(Date.now() - offset * 86400000));
  const dateFrom = localDateStr(new Date(Date.now() - (days - 1 + offset) * 86400000));

  // 1. Products
  const products = db.prepare(`
    SELECT nm_id, vendor_code, title, subject, brand, colors, rating, feedbacks,
           price, discount, sale_price, spp
    FROM products
  `).all() as {
    nm_id: number; vendor_code: string | null; title: string | null;
    subject: string | null; brand: string | null; colors: string | null;
    rating: number | null; feedbacks: number; price: number | null;
    discount: number | null; sale_price: number | null; spp: number | null;
  }[];

  // 2. Ad stats — use campaign_stats_daily (more complete) mapped to nm_id via nms_json
  const campaignsForMapping = db.prepare(`
    SELECT advert_id, nms_json FROM campaigns WHERE nms_json IS NOT NULL
  `).all() as { advert_id: number; nms_json: string }[];

  // Map: advert_id → nm_ids
  const campToNms = new Map<number, number[]>();
  for (const c of campaignsForMapping) {
    campToNms.set(c.advert_id, JSON.parse(c.nms_json || "[]"));
  }

  const campDailyStats = db.prepare(`
    SELECT advert_id, SUM(views) as views, SUM(clicks) as clicks,
           SUM(sum) as spend, SUM(orders) as orders, SUM(atbs) as carts,
           SUM(sum_price) as orders_sum
    FROM campaign_stats_daily
    WHERE date >= ? AND date <= ?
    GROUP BY advert_id
  `).all(dateFrom, dateTo) as {
    advert_id: number; views: number; clicks: number;
    spend: number; orders: number; carts: number; orders_sum: number;
  }[];

  // Aggregate by nm_id
  const adMap = new Map<number, {
    ad_views: number; ad_clicks: number; ad_spend: number;
    ad_orders: number; ad_carts: number; ad_orders_sum: number;
  }>();

  for (const cs of campDailyStats) {
    const nmIds = campToNms.get(cs.advert_id);
    if (!nmIds || nmIds.length === 0) continue;
    // For single-nm campaigns (majority): full attribution
    // For multi-nm: distribute evenly (approximation)
    const share = nmIds.length;
    for (const nmId of nmIds) {
      const existing = adMap.get(nmId);
      const portion = {
        ad_views: Math.round(cs.views / share),
        ad_clicks: Math.round(cs.clicks / share),
        ad_spend: cs.spend / share,
        ad_orders: Math.round(cs.orders / share),
        ad_carts: Math.round(cs.carts / share),
        ad_orders_sum: cs.orders_sum / share,
      };
      if (existing) {
        existing.ad_views += portion.ad_views;
        existing.ad_clicks += portion.ad_clicks;
        existing.ad_spend += portion.ad_spend;
        existing.ad_orders += portion.ad_orders;
        existing.ad_carts += portion.ad_carts;
        existing.ad_orders_sum += portion.ad_orders_sum;
      } else {
        adMap.set(nmId, { ...portion });
      }
    }
  }

  // 3. Funnel — hybrid: MAX(open API, closed Djem API) for overlapping metrics
  const funnel = db.prepare(`
    SELECT
      COALESCE(o.nm_id, d.nm_id) as nm_id,
      COALESCE(d.view_count, 0) as view_count,
      COALESCE(d.open_card_count, 0) as open_card_count,
      MAX(COALESCE(o.carts, 0), COALESCE(d.carts, 0)) as carts,
      MAX(COALESCE(o.orders, 0), COALESCE(d.orders, 0)) as orders,
      MAX(COALESCE(o.orders_sum, 0), COALESCE(d.orders_sum, 0)) as orders_sum,
      COALESCE(d.buyouts_count, 0) as buyouts_count,
      COALESCE(d.buyouts_sum, 0) as buyouts_sum
    FROM (
      SELECT nm_id,
        SUM(add_to_cart_count) as carts,
        SUM(orders_count) as orders,
        SUM(orders_sum) as orders_sum
      FROM sales_funnel_daily
      WHERE date >= ? AND date <= ?
      GROUP BY nm_id
    ) o
    FULL OUTER JOIN (
      SELECT nm_id,
        SUM(view_count) as view_count,
        SUM(open_card_count) as open_card_count,
        SUM(add_to_cart_count) as carts,
        SUM(orders_count) as orders,
        SUM(orders_sum) as orders_sum,
        SUM(buyouts_count) as buyouts_count,
        SUM(buyouts_sum) as buyouts_sum
      FROM auth_wb_funnel_daily
      WHERE date >= ? AND date <= ?
      GROUP BY nm_id
    ) d ON o.nm_id = d.nm_id
  `).all(dateFrom, dateTo, dateFrom, dateTo) as {
    nm_id: number; view_count: number; open_card_count: number;
    carts: number; orders: number; orders_sum: number;
    buyouts_count: number; buyouts_sum: number;
  }[];
  const funnelMap = new Map(funnel.map((r) => [r.nm_id, r]));

  // 4. Stocks (quantity only — value calculated using products.price)
  const stocks = db.prepare(`
    SELECT nm_id, SUM(quantity) as stock_qty
    FROM stocks GROUP BY nm_id
  `).all() as { nm_id: number; stock_qty: number }[];
  const stockMap = new Map(stocks.map((r) => [r.nm_id, r]));

  // 5. Campaigns: active/paused + any with spend in period
  const campaigns = db.prepare(`
    SELECT advert_id, name, type, status, daily_budget, payment_type, nms_json, bid_kopecks
    FROM campaigns
    WHERE status IN (9, 11)
       OR advert_id IN (SELECT DISTINCT advert_id FROM campaign_stats_daily WHERE date >= ? AND date <= ? AND sum > 0)
  `).all(dateFrom, dateTo) as {
    advert_id: number; name: string; type: number | null;
    status: number; daily_budget: number | null;
    payment_type: string; nms_json: string; bid_kopecks: number | null;
  }[];

  // 6. Campaign spend for period
  const campSpend = db.prepare(`
    SELECT advert_id, SUM(sum) as spend
    FROM campaign_stats_daily
    WHERE date >= ? AND date <= ?
    GROUP BY advert_id
  `).all(dateFrom, dateTo) as { advert_id: number; spend: number }[];
  const spendMap = new Map(campSpend.map((r) => [r.advert_id, r.spend]));

  // 6b. Campaign budgets
  const budgets = db.prepare(`
    SELECT advert_id, total FROM campaign_budgets
  `).all() as { advert_id: number; total: number }[];
  const budgetMap = new Map(budgets.map((r) => [r.advert_id, r.total]));

  // 7. Latest bids
  const bids = db.prepare(`
    SELECT advert_id, nm_id, bid_kopecks FROM bid_history
    WHERE (advert_id, nm_id, recorded_at) IN (
      SELECT advert_id, nm_id, MAX(recorded_at) FROM bid_history GROUP BY advert_id, nm_id
    )
  `).all() as { advert_id: number; nm_id: number; bid_kopecks: number | null }[];
  const bidMap = new Map(bids.map((r) => [`${r.advert_id}-${r.nm_id}`, r.bid_kopecks]));

  // 8. Visibility — cluster data is aggregated (weekly snapshot), use latest date always
  const clusterDate = (db.prepare("SELECT MAX(date) as d FROM search_cluster_stats").get() as { d: string | null })?.d;

  const visibility = clusterDate ? db.prepare(`
    SELECT nm_id, COUNT(DISTINCT norm_query) as queries_count
    FROM search_cluster_stats WHERE date = ?
    GROUP BY nm_id
  `).all(clusterDate) as { nm_id: number; queries_count: number }[] : [];
  const visMap = new Map(visibility.map((r) => [r.nm_id, r.queries_count]));

  // 9. Ad carts from search_cluster_stats (same snapshot)
  const adCarts = clusterDate ? db.prepare(`
    SELECT nm_id, SUM(atbs) as ad_carts
    FROM search_cluster_stats WHERE date = ?
    GROUP BY nm_id
  `).all(clusterDate) as { nm_id: number; ad_carts: number }[] : [];
  const adCartsMap = new Map(adCarts.map((r) => [r.nm_id, r.ad_carts]));

  // 10. Promotions (акции)
  const promos = db.prepare(`
    SELECT nm_id, promo_name FROM product_promotions
  `).all() as { nm_id: number; promo_name: string }[];
  const promoMap = new Map<number, string[]>();
  for (const p of promos) {
    const existing = promoMap.get(p.nm_id);
    if (existing) existing.push(p.promo_name);
    else promoMap.set(p.nm_id, [p.promo_name]);
  }

  // Build campaign map: nm_id -> CampaignInfo[]
  const campByNm = new Map<number, CampaignInfo[]>();
  for (const c of campaigns) {
    const nmIds: number[] = JSON.parse(c.nms_json || "[]");
    const nameUpper = (c.name || "").toUpperCase();
    let kind: "auto" | "search" | "cpc" = "auto";
    if (c.payment_type === "cpc") kind = "cpc";
    else if (nameUpper.includes("ПОИСК")) kind = "search";

    const spend = spendMap.get(c.advert_id) || 0;

    for (const nmId of nmIds) {
      // Prefer bid from campaigns table, fallback to bid_history
      const bidKey = `${c.advert_id}-${nmId}`;
      const bidKopecks = c.bid_kopecks ?? bidMap.get(bidKey) ?? null;
      const info: CampaignInfo = {
        advertId: c.advert_id,
        name: c.name,
        status: c.status,
        paymentType: c.payment_type,
        campaignKind: kind,
        bid: bidKopecks != null ? bidKopecks / 100 : null,
        dailyBudget: budgetMap.get(c.advert_id) ?? c.daily_budget,
        spend,
      };

      const existing = campByNm.get(nmId);
      if (existing) existing.push(info);
      else campByNm.set(nmId, [info]);
    }
  }

  // Collect all known nm_ids
  const allNmIds = new Set<number>();
  products.forEach((p) => allNmIds.add(p.nm_id));
  adMap.forEach((_, nmId) => allNmIds.add(nmId));
  funnel.forEach((r) => allNmIds.add(r.nm_id));
  stocks.forEach((r) => allNmIds.add(r.nm_id));
  campByNm.forEach((_, nmId) => allNmIds.add(nmId));

  const productMap = new Map(products.map((p) => [p.nm_id, p]));

  let totalOrdersSum = 0;
  let totalAdsSpend = 0;

  const result: DashboardProduct[] = [];

  for (const nmId of allNmIds) {
    const p = productMap.get(nmId);
    const ad = adMap.get(nmId);
    const f = funnelMap.get(nmId);
    const s = stockMap.get(nmId);

    const adSpend = ad?.ad_spend || 0;
    const ordersSum = f?.orders_sum || 0;
    totalOrdersSum += ordersSum;
    totalAdsSpend += adSpend;

    const deliveryPrice =
      p?.price && p?.discount != null
        ? Math.round(p.price * (100 - p.discount) / 100)
        : null;

    const drr =
      adSpend > 0 && ordersSum > 0
        ? (adSpend / ordersSum) * 100
        : adSpend > 0
          ? -1 // flag: has spend, no orders
          : null;

    result.push({
      nmId,
      vendorCode: p?.vendor_code || null,
      title: p?.title || null,
      updatedAt: null,
      subject: p?.subject || null,
      colors: p?.colors || null,
      labels: [],
      rating: p?.rating || null,
      feedbacks: p?.feedbacks || 0,
      price: p?.price || null,
      discount: p?.discount ?? null,
      deliveryPrice,
      spp: p?.spp || null,
      salePrice: p?.sale_price || null,
      stockQty: s?.stock_qty || 0,
      stockValue: deliveryPrice && s ? Math.round(s.stock_qty * deliveryPrice) : 0,
      viewCount: f?.view_count || 0,
      openCardCount: f?.open_card_count || 0,
      cartsTotal: f?.carts || 0,
      ordersTotal: f?.orders || 0,
      ordersSum: Math.round(ordersSum),
      buyoutsCount: f?.buyouts_count || 0,
      buyoutsSum: Math.round(f?.buyouts_sum || 0),
      drr,
      adSpend: Math.round(adSpend),
      adOrders: ad?.ad_orders || 0,
      adCarts: ad?.ad_carts || adCartsMap.get(nmId) || 0,
      adClicks: ad?.ad_clicks || 0,
      adViews: ad?.ad_views || 0,
      campaigns: campByNm.get(nmId) || [],
      queriesCount: visMap.get(nmId) || 0,
    });
  }

  result.sort((a, b) => b.ordersSum - a.ordersSum);

  const response: DashboardResponse = {
    summary: {
      totalOrdersSum: Math.round(totalOrdersSum),
      totalAdsSpend: Math.round(totalAdsSpend),
      totalProducts: result.length,
    },
    products: result,
  };

  return NextResponse.json(response);
}
