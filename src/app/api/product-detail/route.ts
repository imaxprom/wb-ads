import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { localDateStr } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const db = getDb();
  const nmIdParam = request.nextUrl.searchParams.get("nmId") || "";
  const isAll = nmIdParam === "all";
  const nmId = isAll ? 0 : Number(nmIdParam);
  const days = Math.min(90, Math.max(1, Number(request.nextUrl.searchParams.get("days") || "14")));

  if (!isAll && !nmId) return NextResponse.json({ error: "nmId required" }, { status: 400 });

  const today = localDateStr(new Date());
  const maxRange = 90;
  const dateFrom = localDateStr(new Date(Date.now() - (maxRange - 1) * 86400000));

  // "Весь магазин" mode: aggregate all products
  if (isAll) {
    // First MAX per product per date, then SUM across products
    const funnel = db.prepare(`
      SELECT date,
        SUM(view_count) as view_count,
        SUM(open_card_count) as open_card_count,
        SUM(add_to_cart_count) as add_to_cart_count,
        SUM(orders_count) as orders_count,
        SUM(orders_sum) as orders_sum,
        SUM(buyouts_count) as buyouts_count,
        SUM(cancel_count) as cancel_count,
        AVG(buyout_percent) as buyout_percent
      FROM (
        SELECT
          COALESCE(o.date, d.date) as date,
          COALESCE(d.view_count, 0) as view_count,
          MAX(COALESCE(o.open_card_count, 0), COALESCE(d.open_card_count, 0)) as open_card_count,
          MAX(COALESCE(o.add_to_cart_count, 0), COALESCE(d.add_to_cart_count, 0)) as add_to_cart_count,
          MAX(COALESCE(o.orders_count, 0), COALESCE(d.orders_count, 0)) as orders_count,
          MAX(COALESCE(o.orders_sum, 0), COALESCE(d.orders_sum, 0)) as orders_sum,
          COALESCE(d.buyouts_count, o.buyouts_count, 0) as buyouts_count,
          COALESCE(d.cancel_count, o.cancel_count, 0) as cancel_count,
          MAX(COALESCE(o.buyout_percent, 0), COALESCE(d.buyout_percent, 0)) as buyout_percent
        FROM (
          SELECT nm_id, date, open_card_count, add_to_cart_count, orders_count, orders_sum,
                 buyouts_count, cancel_count, buyout_percent
          FROM sales_funnel_daily WHERE date >= ? AND date <= ?
        ) o
        FULL OUTER JOIN (
          SELECT nm_id, date, view_count, open_card_count, add_to_cart_count, orders_count, orders_sum,
                 buyouts_count, cancel_count, buyout_percent
          FROM auth_wb_funnel_daily WHERE date >= ? AND date <= ?
        ) d ON o.nm_id = d.nm_id AND o.date = d.date
      )
      GROUP BY date
      ORDER BY date DESC
    `).all(dateFrom, today, dateFrom, today) as {
      date: string; view_count: number; open_card_count: number;
      add_to_cart_count: number; orders_count: number; orders_sum: number;
      buyouts_count: number; cancel_count: number; buyout_percent: number;
    }[];

    const adDaily = db.prepare(`
      SELECT date, SUM(views) as ad_views, SUM(clicks) as ad_clicks,
             SUM(sum) as ad_spend, SUM(orders) as ad_orders, SUM(atbs) as ad_carts
      FROM campaign_stats_daily WHERE date >= ? AND date <= ? GROUP BY date
    `).all(dateFrom, today) as { date: string; ad_views: number; ad_clicks: number; ad_spend: number; ad_orders: number; ad_carts: number }[];
    const adMap = new Map(adDaily.map((r) => [r.date, r]));

    // Direct carts from by_nm (for click-to-cart conversion)
    const directCartsDaily = db.prepare(`
      SELECT date, SUM(atbs) as direct_carts
      FROM campaign_stats_by_nm
      WHERE date >= ? AND date <= ? AND (views > 0 OR clicks > 0)
      GROUP BY date
    `).all(dateFrom, today) as { date: string; direct_carts: number }[];
    const directCartsMap = new Map(directCartsDaily.map((r) => [r.date, r.direct_carts]));

    const allDates = new Set<string>();
    allDates.add(today);
    for (const r of funnel) allDates.add(r.date);
    for (const [d] of adMap) allDates.add(d);
    const fMap = new Map(funnel.map((r) => [r.date, r]));

    const rows = [...allDates].sort((a, b) => b.localeCompare(a)).map((date) => {
      const f = fMap.get(date);
      const ad = adMap.get(date);
      const adSpend = ad?.ad_spend || 0;
      const adViews = ad?.ad_views || 0;
      const adClicks = ad?.ad_clicks || 0;
      const adOrders = ad?.ad_orders || 0;
      const adCarts = ad?.ad_carts || 0;
      const ordersCount = f?.orders_count || 0;
      const ordersSum = f?.orders_sum || 0;
      const openCard = f?.open_card_count || 0;
      const addToCart = f?.add_to_cart_count || 0;
      const viewCount = f?.view_count || 0;
      const ctrGeneral = viewCount > 0 ? Math.round((openCard / viewCount) * 1000) / 10 : 0;
      const cartConversion = openCard > 0 ? Math.round((addToCart / openCard) * 1000) / 10 : 0;
      const orderConversion = addToCart > 0 ? Math.round((ordersCount / addToCart) * 1000) / 10 : 0;
      const avgPrice = ordersCount > 0 ? Math.round(ordersSum / ordersCount) : 0;
      const ctr = adViews > 0 ? Math.round((adClicks / adViews) * 1000) / 10 : 0;
      const cpc = adClicks > 0 ? Math.round((adSpend / adClicks) * 10) / 10 : 0;
      const cpm = adViews > 0 ? Math.round((adSpend / adViews) * 100000) / 100 : 0;
      const drr = ordersSum > 0 ? Math.round((adSpend / ordersSum) * 1000) / 10 : (adSpend > 0 ? -1 : 0);
      const cartCostAd = adCarts > 0 ? Math.round(adSpend / adCarts) : 0;
      const orderCostAd = adOrders > 0 ? Math.round(adSpend / adOrders) : 0;
      const buyoutsCount = f?.buyouts_count || 0;
      const cancelCount = f?.cancel_count || 0;
      const inTransit = Math.max(0, ordersCount - buyoutsCount - cancelCount);

      return {
        date, ordersCount, views: viewCount, ctrGeneral, clicks: openCard,
        cartConversion, cartsTotal: addToCart, orderConversion, avgPrice, drr,
        adSpend: Math.round(adSpend), ordersSum: Math.round(ordersSum),
        adViews, adCtr: ctr, adClicks, adCpc: cpc,
        adClickToCart: adClicks > 0 ? Math.round(((directCartsMap.get(date) || 0) / adClicks) * 1000) / 10 : 0,
        cpm, adCarts, cartCostAd,
        adOrders, orderCostAd,
        assocCarts: 0, assocOrders: 0, assocDetails: [],
        assocOutCarts: 0, assocOutOrders: 0, assocOutDetails: [],
        buyouts: buyoutsCount, cancels: cancelCount, inTransit,
        buyoutPercent: f?.buyout_percent || 0,
      };
    });

    return NextResponse.json({ nmId: "all", rows });
  }

  // 1. Hybrid funnel: merge open API + Djem, take MAX for overlapping metrics
  const funnel = db.prepare(`
    SELECT
      COALESCE(o.date, d.date) as date,
      COALESCE(d.view_count, 0) as view_count,
      MAX(COALESCE(o.open_card_count, 0), COALESCE(d.open_card_count, 0)) as open_card_count,
      MAX(COALESCE(o.add_to_cart_count, 0), COALESCE(d.add_to_cart_count, 0)) as add_to_cart_count,
      MAX(COALESCE(o.orders_count, 0), COALESCE(d.orders_count, 0)) as orders_count,
      MAX(COALESCE(o.orders_sum, 0), COALESCE(d.orders_sum, 0)) as orders_sum,
      COALESCE(d.buyouts_count, o.buyouts_count, 0) as buyouts_count,
      COALESCE(d.buyouts_sum, o.buyouts_sum, 0) as buyouts_sum,
      COALESCE(d.cancel_count, o.cancel_count, 0) as cancel_count,
      MAX(COALESCE(o.add_to_cart_conversion, 0), COALESCE(d.open_to_cart_conversion, 0)) as add_to_cart_conversion,
      MAX(COALESCE(o.cart_to_order_conversion, 0), COALESCE(d.cart_to_order_conversion, 0)) as cart_to_order_conversion,
      MAX(COALESCE(o.buyout_percent, 0), COALESCE(d.buyout_percent, 0)) as buyout_percent,
      COALESCE(d.view_to_open_conversion, 0) as view_to_open_conversion
    FROM (
      SELECT date, open_card_count, add_to_cart_count, orders_count, orders_sum,
             buyouts_count, buyouts_sum, cancel_count,
             add_to_cart_conversion, cart_to_order_conversion, buyout_percent
      FROM sales_funnel_daily
      WHERE nm_id = ? AND date >= ? AND date <= ?
    ) o
    FULL OUTER JOIN (
      SELECT date, view_count, open_card_count, add_to_cart_count, orders_count, orders_sum,
             buyouts_count, buyouts_sum, cancel_count,
             open_to_cart_conversion, cart_to_order_conversion, buyout_percent,
             view_to_open_conversion
      FROM auth_wb_funnel_daily
      WHERE nm_id = ? AND date >= ? AND date <= ?
    ) d ON o.date = d.date
    ORDER BY date DESC
  `).all(nmId, dateFrom, today, nmId, dateFrom, today) as {
    date: string; view_count: number; open_card_count: number;
    add_to_cart_count: number; orders_count: number; orders_sum: number;
    buyouts_count: number; buyouts_sum: number; cancel_count: number;
    add_to_cart_conversion: number; cart_to_order_conversion: number;
    buyout_percent: number; view_to_open_conversion: number;
  }[];

  const funnelByDate = new Map(funnel.map((r) => [r.date, r]));

  // 2. Ad stats per day (aggregate across all campaigns for this nm_id)
  const campaigns = db.prepare(
    "SELECT advert_id, nms_json FROM campaigns WHERE nms_json LIKE ?"
  ).all(`%${nmId}%`) as { advert_id: number; nms_json: string }[];

  const campIds = campaigns
    .filter((c) => { try { return JSON.parse(c.nms_json).includes(nmId); } catch { return false; } })
    .map((c) => c.advert_id);

  // Campaign-level daily stats (more complete than by_nm)
  const adByDate = new Map<string, { ad_views: number; ad_clicks: number; ad_spend: number; ad_orders: number; ad_carts: number }>();
  if (campIds.length > 0) {
    const placeholders = campIds.map(() => "?").join(",");
    const campDaily = db.prepare(`
      SELECT date, SUM(views) as ad_views, SUM(clicks) as ad_clicks,
             SUM(sum) as ad_spend, SUM(orders) as ad_orders, SUM(atbs) as ad_carts
      FROM campaign_stats_daily
      WHERE advert_id IN (${placeholders}) AND date >= ? AND date <= ?
      GROUP BY date
    `).all(...campIds, dateFrom, today) as { date: string; ad_views: number; ad_clicks: number; ad_spend: number; ad_orders: number; ad_carts: number }[];
    for (const r of campDaily) adByDate.set(r.date, r);
  }

  // by_nm: split direct (views>0) vs associated (views=0) for this nmId across ALL campaigns
  const byNmAll = db.prepare(`
    SELECT b.advert_id, b.date, b.views, b.clicks, b.atbs, b.orders, b.sum as spend, b.sum_price
    FROM campaign_stats_by_nm b
    WHERE b.nm_id = ? AND b.date >= ? AND b.date <= ?
  `).all(nmId, dateFrom, today) as { advert_id: number; date: string; views: number; clicks: number; atbs: number; orders: number; spend: number; sum_price: number }[];

  // Load all campaigns to find source product for associated conversions
  const allCampaigns = db.prepare("SELECT advert_id, nms_json FROM campaigns").all() as { advert_id: number; nms_json: string }[];
  const campToSourceNm = new Map<number, number>();
  for (const c of allCampaigns) {
    try {
      const nms = JSON.parse(c.nms_json || "[]");
      if (nms.length > 0) campToSourceNm.set(c.advert_id, nms[0]);
    } catch { /* skip */ }
  }

  // Load vendor codes for tooltip
  const allProducts = db.prepare("SELECT nm_id, vendor_code FROM products").all() as { nm_id: number; vendor_code: string | null }[];
  const nmToVendor = new Map(allProducts.map((p) => [p.nm_id, p.vendor_code || ""]));

  interface AssocDetail { sourceNmId: number; vendorCode: string; carts: number; orders: number; sumPrice: number }

  const directByDate = new Map<string, { carts: number; orders: number }>();
  const assocByDate = new Map<string, { carts: number; orders: number }>();
  const assocDetailByDate = new Map<string, AssocDetail[]>();

  for (const r of byNmAll) {
    const isDirect = r.views > 0 || r.clicks > 0;
    if (isDirect) {
      const existing = directByDate.get(r.date);
      if (existing) { existing.carts += r.atbs; existing.orders += r.orders; }
      else directByDate.set(r.date, { carts: r.atbs, orders: r.orders });
    } else if (r.atbs > 0 || r.orders > 0) {
      // Associated
      const existing = assocByDate.get(r.date);
      if (existing) { existing.carts += r.atbs; existing.orders += r.orders; }
      else assocByDate.set(r.date, { carts: r.atbs, orders: r.orders });

      // Detail: which product's ad generated this
      const sourceNmId = campToSourceNm.get(r.advert_id) || 0;
      if (sourceNmId && sourceNmId !== nmId) {
        const details = assocDetailByDate.get(r.date) || [];
        const ex = details.find((d) => d.sourceNmId === sourceNmId);
        if (ex) { ex.carts += r.atbs; ex.orders += r.orders; ex.sumPrice += r.sum_price; }
        else details.push({ sourceNmId, vendorCode: nmToVendor.get(sourceNmId) || "", carts: r.atbs, orders: r.orders, sumPrice: r.sum_price });
        assocDetailByDate.set(r.date, details);
      }
    }
  }

  // Associated OUT: other products that got conversions FROM this product's ads
  // Find campaigns where this nmId is the primary (advertised) product
  const primaryCampIds = campIds; // already computed above — campaigns containing this nmId

  const assocOutByDate = new Map<string, { carts: number; orders: number }>();
  const assocOutDetailByDate = new Map<string, AssocDetail[]>();

  if (primaryCampIds.length > 0) {
    const ph = primaryCampIds.map(() => "?").join(",");
    const outRows = db.prepare(`
      SELECT advert_id, date, nm_id, views, clicks, atbs, orders, sum_price
      FROM campaign_stats_by_nm
      WHERE advert_id IN (${ph}) AND date >= ? AND date <= ?
        AND nm_id != ? AND views = 0 AND clicks = 0 AND (atbs > 0 OR orders > 0)
    `).all(...primaryCampIds, dateFrom, today, nmId) as {
      advert_id: number; date: string; nm_id: number; views: number; clicks: number;
      atbs: number; orders: number; sum_price: number;
    }[];

    for (const r of outRows) {
      // Totals
      const existing = assocOutByDate.get(r.date);
      if (existing) { existing.carts += r.atbs; existing.orders += r.orders; }
      else assocOutByDate.set(r.date, { carts: r.atbs, orders: r.orders });

      // Details per target product
      const details = assocOutDetailByDate.get(r.date) || [];
      const ex = details.find((d) => d.sourceNmId === r.nm_id);
      if (ex) { ex.carts += r.atbs; ex.orders += r.orders; ex.sumPrice += r.sum_price; }
      else details.push({ sourceNmId: r.nm_id, vendorCode: nmToVendor.get(r.nm_id) || "", carts: r.atbs, orders: r.orders, sumPrice: r.sum_price });
      assocOutDetailByDate.set(r.date, details);
    }
  }

  // 3. Build all dates: today + all dates with data
  const allDates = new Set<string>();
  allDates.add(today); // always include today
  for (const r of funnel) allDates.add(r.date);
  for (const [d] of adByDate) allDates.add(d);
  for (const [d] of directByDate) allDates.add(d);
  for (const [d] of assocByDate) allDates.add(d);
  for (const [d] of assocOutByDate) allDates.add(d);

  // Sort descending, limit to requested `days` from today (but show all data dates beyond that)
  const sortedDates = [...allDates].sort((a, b) => b.localeCompare(a));

  // 4. Build rows for each date
  const rows = sortedDates.map((date) => {
    const f = funnelByDate.get(date);
    const ad = adByDate.get(date);
    const direct = directByDate.get(date);
    const assoc = assocByDate.get(date);
    const assocOut = assocOutByDate.get(date);
    const adSpend = ad?.ad_spend || 0;
    const adViews = ad?.ad_views || 0;
    const adClicks = ad?.ad_clicks || 0;
    // Use direct from by_nm if available, fallback to campaign-level
    const adCarts = direct?.carts ?? ad?.ad_carts ?? 0;
    const adOrders = direct?.orders ?? ad?.ad_orders ?? 0;
    const ordersCount = f?.orders_count || 0;
    const ordersSum = f?.orders_sum || 0;
    const openCard = f?.open_card_count || 0;
    const addToCart = f?.add_to_cart_count || 0;
    const buyoutsCount = f?.buyouts_count || 0;
    const cancelCount = f?.cancel_count || 0;
    const avgPrice = ordersCount > 0 ? Math.round(ordersSum / ordersCount) : 0;
    const ctr = adViews > 0 ? Math.round((adClicks / adViews) * 1000) / 10 : 0;
    const cpc = adClicks > 0 ? Math.round((adSpend / adClicks) * 10) / 10 : 0;
    const cpm = adViews > 0 ? Math.round((adSpend / adViews) * 100000) / 100 : 0;
    const drr = ordersSum > 0 ? Math.round((adSpend / ordersSum) * 1000) / 10 : (adSpend > 0 ? -1 : 0);
    // xP = adSpend / campaign_daily totals (direct + assocOUT, without assocIN)
    const campAdCarts = ad?.ad_carts || 0;
    const campAdOrders = ad?.ad_orders || 0;
    const cartCostAd = campAdCarts > 0 ? Math.round(adSpend / campAdCarts) : 0;
    const orderCostAd = campAdOrders > 0 ? Math.round(adSpend / campAdOrders) : 0;
    const inTransit = Math.max(0, ordersCount - buyoutsCount - cancelCount);

    // CTR general: viewCount → openCard
    const viewCount = f?.view_count || 0;
    const ctrGeneral = viewCount > 0 ? Math.round((openCard / viewCount) * 1000) / 10 : 0;
    // Cart conversion: openCard → addToCart
    const cartConversion = openCard > 0 ? Math.round((addToCart / openCard) * 1000) / 10 : 0;
    // Order conversion: addToCart → orders
    const orderConversion = addToCart > 0 ? Math.round((ordersCount / addToCart) * 1000) / 10 : 0;

    return {
      date,
      ordersCount,
      views: viewCount,
      ctrGeneral,
      clicks: openCard,
      cartConversion,
      cartsTotal: addToCart,
      orderConversion,
      avgPrice,
      drr,
      adSpend: Math.round(adSpend),
      ordersSum: Math.round(ordersSum),
      adViews,
      adCtr: ctr,
      adClicks,
      adCpc: cpc,
      adClickToCart: adClicks > 0 ? Math.round((adCarts / adClicks) * 1000) / 10 : 0,
      cpm,
      adCarts,
      cartCostAd,
      adOrders,
      orderCostAd,
      assocCarts: assoc?.carts || 0,
      assocOrders: assoc?.orders || 0,
      assocDetails: assocDetailByDate.get(date) || [],
      assocOutCarts: assocOut?.carts || 0,
      assocOutOrders: assocOut?.orders || 0,
      assocOutDetails: assocOutDetailByDate.get(date) || [],
      buyouts: buyoutsCount,
      cancels: cancelCount,
      inTransit,
      buyoutPercent: f?.buyout_percent || 0,
    };
  });

  return NextResponse.json({ nmId, rows });
}
