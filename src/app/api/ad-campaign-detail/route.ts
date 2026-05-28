import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { localDateStr } from "@/lib/format";
import { hasPostgresUrl, pgAll, pgGet, type PgParam } from "@/lib/pg-direct";

export const dynamic = "force-dynamic";

export interface AdCampDay {
  date: string;
  views_total: number;
  views_search: number;
  views_catalog: number;
  views_reco: number;
  clicks_total: number;
  clicks_search: number;
  clicks_catalog: number;
  clicks_reco: number;
  sum_total: number;
  sum_search: number;
  sum_catalog: number;
  sum_reco: number;
  // Aggregated from campaign_stats_daily:
  spend: number;
  atbs: number;
  orders: number;
  sum_price: number;
  ctr: number;
  cpc: number;
  cr: number;
  drr: number;
  // From campaign_nm_daily (Sheet1) — position of product with max views that day
  avg_position: number;
  // Own vs associated split from campaign_stats_by_nm (views>0 → own, views=0 → associated):
  atbs_own: number;
  atbs_assoc: number;
  orders_own: number;
  orders_assoc: number;
  // Detail per associated source product (for tooltip)
  assoc_details: { nmId: number; name: string; carts: number; orders: number }[];
}

export interface AdCampKeyword {
  phrase: string;
  // type: "common" = управляемая, "excluded" = в исключениях, "unknown" = <100 показов (вне preset-info)
  type: "common" | "excluded" | "unknown";
  is_excluded: boolean;
  views: number;
  clicks: number;
  baskets: number;     // добавления в корзину (preset: baskets, stats_daily: atbs)
  orders: number;
  shks: number;        // выкупы (штуки) — только из preset-info
  ctr: number;
  spend: number;
  cpc: number;
  cpm: number;
  avg_pos: number;
  share: number;
  bid: number;         // ставка CPM в рублях (из actual_cpm/100 или campaign_keyword_bids)
  has_custom_bid: boolean; // true если actual_cpm задан (не null)
  min_cpm_search: number;  // базовая CPM по предмету (fallback когда bid=0)
  approx_views_wb: number; // WB premium search-analysis — суммарная частотность кластера за вчера
  approx_views_wb_updated_at: string | null; // когда последний раз синкали snapshot
  // Внутренние фразы кластера (после стемминг-нормализации): [{phrase, frequency}]
  cluster_inner: { phrase: string; frequency: number }[];
  // Иерархия: parent = master-кластер (has_custom_bid с raw_queries), child = фраза campaign,
  // которая входит в raw_queries некого parent.
  is_parent: boolean;                    // это мастер-кластер (можно развернуть)
  parent_phrase: string | null;          // если child — имя её материнского кластера
  children_phrases: string[];            // если parent — список child-фраз (lowercase не важен, raw)
  djem_phrases: string[];                // lc-фразы для lookup в phrase_djem_stats_daily
                                         // (cluster.phrasesLcSet для parent, [lc] для orphan/child)
  ad_pos: number;      // позиция в выдаче с рекламой (из search.wb.ru)
  organic_pos: number; // позиция без рекламы
  boost: number;       // organic - ad
  preset_id: string;   // preset=XXX — ожидаемый (из campaign_preset_keywords / manual_clusters)
  real_preset_id: number | null;         // Мета-2: фактический presetId из публичной search.wb.ru выдачи
  real_preset_checked_at: string | null; // когда последний раз сверяли Мета-2

  // Джем — per-phrase аналитика воронки за 90 дней (phrase_djem_stats). Все поля = 0 когда
  // строки в таблице нет (для этой фразы ещё не собирали данные).
  djem_views: number;              // viewCount — показы карточки по фразе
  djem_clicks: number;             // openCardCount — переходы в карточку
  djem_baskets: number;            // addToCartCount — добавления в корзину
  djem_orders: number;             // orderCount — заказы (шт)
  djem_order_sum: number;          // orderSum — сумма заказов ₽
  djem_ctr: number;                // ctr % (общий)
  djem_cart_conv: number;          // openToCartConversion — конверсия в корзину %
  djem_order_conv: number;         // cartToOrderConversion — конверсия корзины в заказ %
  djem_avg_price: number;          // средняя цена заказа
  djem_avg_pos: number;            // средняя позиция фразы
  djem_period_start: string | null;
  djem_period_end: string | null;
  djem_updated_at: string | null;

  /** Legacy alias кормит старый UI. Равен baskets. */
  atbs: number;
}

export interface AdCampCatalog {
  catalog_id: string;
  views: number;
  clicks: number;
  ctr: number;
  cpc: number;
  spend: number;
  share: number;
}

export async function GET(request: NextRequest) {
  const usePg = hasPostgresUrl();
  const db = usePg ? null : getDb();
  const all = async <T,>(sql: string, ...params: PgParam[]): Promise<T[]> => {
    return usePg ? pgAll<T>(sql, params) : (db!.prepare(sql).all(...params) as T[]);
  };
  const get = async <T,>(sql: string, ...params: PgParam[]): Promise<T | undefined> => {
    return usePg ? pgGet<T>(sql, params) : (db!.prepare(sql).get(...params) as T | undefined);
  };
  const sp = request.nextUrl.searchParams;
  const advertId = Number(sp.get("advertID") || "0");
  if (!advertId) return NextResponse.json({ ok: false, error: "advertID required" }, { status: 400 });

  // Два способа задать период:
  //   1) startDate=YYYY-MM-DD & endDate=YYYY-MM-DD — явный диапазон (новый формат, dateSidebar)
  //   2) days=N & offset=N — старый формат (панель сверху)
  // Если заданы явные даты — используем их.
  const explicitStart = sp.get("startDate");
  const explicitEnd = sp.get("endDate");
  let startDate: string;
  let endDate: string;
  if (explicitStart && explicitEnd && /^\d{4}-\d{2}-\d{2}$/.test(explicitStart) && /^\d{4}-\d{2}-\d{2}$/.test(explicitEnd)) {
    startDate = explicitStart <= explicitEnd ? explicitStart : explicitEnd;
    endDate = explicitStart <= explicitEnd ? explicitEnd : explicitStart;
  } else {
    const days = Math.max(1, Math.min(90, Number(sp.get("days") || "30")));
    const offset = Math.max(0, Number(sp.get("offset") || "0"));
    endDate = localDateStr(new Date(Date.now() - offset * 86400000));
    startDate = localDateStr(new Date(Date.now() - (days - 1 + offset) * 86400000));
  }

  const dayRows = await all<Omit<AdCampDay, "spend" | "atbs" | "orders" | "sum_price" | "ctr" | "cpc" | "cr" | "drr">>(`
    SELECT date,
           views_total, views_search, views_catalog, views_reco,
           clicks_total, clicks_search, clicks_catalog, clicks_reco,
           sum_total, sum_search, sum_catalog, sum_reco
    FROM campaign_days
    WHERE advert_id = ? AND date >= ? AND date <= ?
    ORDER BY date DESC
  `, advertId, startDate, endDate);

  const statRows = await all<{ date: string; views: number; clicks: number; spend: number; atbs: number; orders: number; sum_price: number }>(`
    SELECT date, views, clicks, sum spend, atbs, orders, sum_price
    FROM campaign_stats_daily
    WHERE advert_id = ? AND date >= ? AND date <= ?
  `, advertId, startDate, endDate);
  const statMap = new Map(statRows.map((r) => [r.date, r]));

  // Per-day avg_position: take position of the product with max views on that day
  // (matches what Bider displays — main product dominates visually).
  const posRows = await all<{ date: string; avg_position: number }>(`
    SELECT date, avg_position
    FROM (
      SELECT date, avg_position,
             ROW_NUMBER() OVER (PARTITION BY date ORDER BY views DESC, nm_id ASC) rn
      FROM campaign_nm_daily
      WHERE advert_id = ? AND date >= ? AND date <= ?
        AND views > 0 AND avg_position > 0
    ) ranked
    WHERE rn = 1
  `, advertId, startDate, endDate);
  const posMap = new Map(posRows.map((r) => [r.date, r.avg_position]));

  // Per-day own vs associated from campaign_stats_by_nm:
  //   own      = SUM(atbs/orders) where views > 0 (this nmId actually had impressions)
  //   assoc    = SUM(atbs/orders) where views = 0 AND atbs/orders > 0 (spillover credited to campaign)
  const nmRows = await all<{ date: string; nm_id: number; views: number; atbs: number; orders: number }>(`
    SELECT date, nm_id, views, atbs, orders
    FROM campaign_stats_by_nm
    WHERE advert_id = ? AND date >= ? AND date <= ?
  `, advertId, startDate, endDate);
  const productsMap = new Map(
    (await all<{ nm_id: number; title: string | null }>("SELECT nm_id, title FROM products"))
      .map((p) => [p.nm_id, p.title || ""])
  );
  interface SplitAgg { own_atbs: number; own_orders: number; assoc_atbs: number; assoc_orders: number; assoc_details: Map<number, { name: string; carts: number; orders: number }> }
  const splitByDate = new Map<string, SplitAgg>();
  for (const r of nmRows) {
    let s = splitByDate.get(r.date);
    if (!s) { s = { own_atbs: 0, own_orders: 0, assoc_atbs: 0, assoc_orders: 0, assoc_details: new Map() }; splitByDate.set(r.date, s); }
    if (r.views > 0) {
      s.own_atbs += r.atbs;
      s.own_orders += r.orders;
    } else if (r.atbs > 0 || r.orders > 0) {
      s.assoc_atbs += r.atbs;
      s.assoc_orders += r.orders;
      const name = productsMap.get(r.nm_id) || "";
      const ex = s.assoc_details.get(r.nm_id);
      if (ex) { ex.carts += r.atbs; ex.orders += r.orders; }
      else s.assoc_details.set(r.nm_id, { name, carts: r.atbs, orders: r.orders });
    }
  }

  // Hybrid merge: для каждой даты берём строку из обоих источников (xlsx и open-API)
  // и складываем максимумы — оба источника накопительные, бо́льшее значение = свежее.
  //   views/clicks/spend: есть в обоих → MAX
  //   zones (search/catalog/reco): только xlsx
  //   atbs/orders/sum_price: только open-API
  // Дата может существовать только в одном из источников (типично: сегодня — только api,
  // т.к. xlsx отстаёт на 24-48ч). Собираем UNION дат.
  const dayMapXlsx = new Map(dayRows.map((d) => [d.date, d]));
  const allDates = new Set<string>();
  for (const d of dayRows) allDates.add(d.date);
  for (const s of statRows) allDates.add(s.date);

  const days_: AdCampDay[] = Array.from(allDates).sort((a, b) => (a < b ? 1 : -1)).map((date) => {
    const x = dayMapXlsx.get(date); // xlsx row (может отсутствовать)
    const s = statMap.get(date);     // open-API row (может отсутствовать)

    const views_total = Math.max(x?.views_total ?? 0, s?.views ?? 0);
    const clicks_total = Math.max(x?.clicks_total ?? 0, s?.clicks ?? 0);
    const spend = Math.max(x?.sum_total ?? 0, s?.spend ?? 0);

    // Zones — search/reco из xlsx. Catalog views считаем остатком от свежего total:
    // WB для поисковых РК не всегда отдаёт отдельный лист каталога в fullstat-v3.
    const views_search = x?.views_search ?? 0;
    const views_reco = x?.views_reco ?? 0;
    const views_catalog = x ? Math.max(0, views_total - views_search - views_reco) : 0;
    const clicks_search = x?.clicks_search ?? 0;
    const clicks_catalog = x?.clicks_catalog ?? 0;
    const clicks_reco = x?.clicks_reco ?? 0;
    const sum_search = x?.sum_search ?? 0;
    const sum_catalog = x?.sum_catalog ?? 0;
    const sum_reco = x?.sum_reco ?? 0;

    // atbs/orders/sum_price — только из open-API.
    const atbs = s?.atbs ?? 0;
    const orders = s?.orders ?? 0;
    const sum_price = s?.sum_price ?? 0;

    const ctr = views_total > 0 ? (clicks_total / views_total) * 100 : 0;
    const cpc = clicks_total > 0 ? spend / clicks_total : 0;
    const cr = clicks_total > 0 ? (orders / clicks_total) * 100 : 0;
    const drr = sum_price > 0 ? (spend / sum_price) * 100 : 0;
    const avg_position = posMap.get(date) || 0;
    const sp = splitByDate.get(date);
    const atbs_own = sp?.own_atbs ?? 0;
    const atbs_assoc = sp?.assoc_atbs ?? 0;
    const orders_own = sp?.own_orders ?? 0;
    const orders_assoc = sp?.assoc_orders ?? 0;
    const assoc_details = sp
      ? Array.from(sp.assoc_details.entries()).map(([nmId, v]) => ({ nmId, ...v }))
      : [];
    return {
      date,
      views_total, views_search, views_catalog, views_reco,
      clicks_total, clicks_search, clicks_catalog, clicks_reco,
      sum_total: spend, sum_search, sum_catalog, sum_reco,
      spend, atbs, orders, sum_price, ctr, cpc, cr, drr,
      avg_position,
      atbs_own, atbs_assoc, orders_own, orders_assoc, assoc_details,
    };
  });

  // 1) preset-info: полный список фраз (управляемые + исключения) и флаг is_excluded.
  //    Агрегируем по advert_id, склеивая stats за всех nm_id этой кампании.
  const presetRows = await all<{
    phrase: string; is_excluded: number;
    views: number; clicks: number;
    baskets: number; orders: number; shks: number;
    spend: number; weighted_cpm: number; weighted_pos: number;
    actual_cpm: number | null;
  }>(`
    SELECT name phrase,
           MAX(is_excluded) is_excluded,
           SUM(views) views, SUM(clicks) clicks,
           SUM(baskets) baskets, SUM(orders) orders, SUM(shks) shks,
           SUM(spend) spend,
           SUM(views * cpm) weighted_cpm,
           SUM(views * avg_pos) weighted_pos,
           MAX(actual_cpm) actual_cpm
    FROM campaign_preset_keywords
    WHERE advert_id = ?
    GROUP BY name
  `, advertId);
  const presetMap = new Map(presetRows.map((r) => [r.phrase.toLowerCase(), r]));

  // 2) xlsx fullstat Sheet2 — daily per-phrase views/clicks/spend за period панели.
  const kwRowsRaw = await all<{ phrase: string; views: number; clicks: number; spend: number }>(`
    SELECT phrase, SUM(views) views, SUM(clicks) clicks, SUM(spend) spend
    FROM campaign_keywords
    WHERE advert_id = ? AND date >= ? AND date <= ?
    GROUP BY phrase
  `, advertId, startDate, endDate);
  const kwMap = new Map(kwRowsRaw.map((r) => [r.phrase.toLowerCase(), r]));

  // 3) campaign_keyword_bids (API ставок). Fallback к preset.actual_cpm.
  const bidRows = await all<{ norm_query: string; bid: number }>(`
    SELECT norm_query, MAX(bid) bid FROM campaign_keyword_bids
    WHERE advert_id = ?
    GROUP BY norm_query
  `, advertId);
  const bidMap = new Map(bidRows.map((r) => [r.norm_query.toLowerCase(), r.bid]));

  // 4) normquery/stats — per-phrase avg_pos/cpm/atbs/orders за period.
  const statsRows = await all<{
    norm_query: string; views: number; clicks: number;
    weighted_pos: number; weighted_cpm: number;
    atbs: number; orders: number;
  }>(`
    SELECT norm_query,
           SUM(views) views, SUM(clicks) clicks,
           SUM(avg_pos * views) weighted_pos, SUM(views * cpm) weighted_cpm,
           SUM(atbs) atbs, SUM(orders) orders
    FROM campaign_keyword_stats_daily
    WHERE advert_id = ? AND date >= ? AND date <= ?
    GROUP BY norm_query
  `, advertId, startDate, endDate);
  const statsMap = new Map(statsRows.map((r) => [
    r.norm_query.toLowerCase(),
    {
      views: r.views,
      clicks: r.clicks,
      avg_pos: r.views > 0 ? r.weighted_pos / r.views : 0,
      cpm: r.views > 0 ? r.weighted_cpm / r.views : 0,
      atbs: r.atbs,
      orders: r.orders,
    },
  ]));

  // 5a) Минимальная CPM по предмету кампании (fallback для common без actual_cpm в ручном аукционе).
  const subjectRow = await get<{ min_cpm_search: number | null }>(`
    SELECT s.min_cpm_search
    FROM campaigns c
    LEFT JOIN subject_min_cpm s ON s.subject_id = c.subject_id
    WHERE c.advert_id = ?
  `, advertId);
  const minCpmSearch = subjectRow?.min_cpm_search ?? 0;

  // 5b) Кластеризация через ручную базу manual_clusters.
  // Пользователь сам создаёт кластеры (имя + список фраз). Для каждой preset-фразы:
  //   - если phrase.name === cluster.name → phrase становится PARENT (master кластера)
  //   - иначе если phrase in cluster.phrases → phrase становится CHILD (parent_phrase = cluster.name)
  // Частотность = сумма frequency всех фраз кластера из search_texts_wb.
  const manualClusters = await all<{ id: number; name: string; phrases_json: string; preset_id: number | null }>(`
    SELECT id, name, phrases_json, preset_id FROM manual_clusters ORDER BY id
  `);

  // Snapshot частотностей WB premium search-analysis — карта lower(text) → {raw, freq}.
  // Фильтр по snapshot_date: показываем только те даты, на которые реально есть снимок.
  // Для одиночной даты — строгое совпадение; для range — сумма frequency по дням.
  // Сегодняшней даты снимков нет (WB отдаёт только за «вчера» на момент запроса).
  const wbFreqRows = await all<{ phrase_lc: string; phrase_raw: string; frequency: number; updated_at: string }>(`
    SELECT phrase_lc,
           MAX(phrase_raw) phrase_raw,
           SUM(frequency) frequency,
           MAX(updated_at) updated_at
    FROM search_texts_wb
    WHERE snapshot_date >= ? AND snapshot_date <= ?
    GROUP BY phrase_lc
  `, startDate, endDate);
  const wbFreqByPhraseLc = new Map<string, { phrase: string; frequency: number }>();
  for (const r of wbFreqRows) {
    wbFreqByPhraseLc.set(r.phrase_lc, { phrase: r.phrase_raw, frequency: r.frequency });
  }
  let wbFreqUpdatedAt: string | null = wbFreqRows.length > 0
    ? wbFreqRows.reduce((acc, r) => (r.updated_at > acc ? r.updated_at : acc), wbFreqRows[0].updated_at)
    : null;

  // Fallback частотности из Джема (phrase_djem_stats_daily) для дней, которые НЕ покрыты
  // snapshot'ом search_texts_wb. Типичный кейс: сегодня (WB premium snapshot заливается в 06:00
  // МСК и фиксирует частотность за вчера; today всегда «дырка»). Джем-heal-тик каждый час
  // обновляет phrase_djem_stats_daily включая текущую дату — поэтому он адекватный источник
  // именно для today/range, включающего today.
  const wbDatesSet = new Set<string>(
    (await all<{ d: string }>(`SELECT DISTINCT snapshot_date d FROM search_texts_wb WHERE snapshot_date >= ? AND snapshot_date <= ?`, startDate, endDate)).map((r) => r.d)
  );
  const freqDateRange: string[] = [];
  {
    const s = new Date(startDate + "T00:00:00Z");
    const e = new Date(endDate + "T00:00:00Z");
    for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
      freqDateRange.push(d.toISOString().slice(0, 10));
    }
  }
  const djemFallbackDates = freqDateRange.filter((d) => !wbDatesSet.has(d));
  const campaignNmsRow = await get<{ nms_json: string | null }>(`SELECT nms_json FROM campaigns WHERE advert_id = ?`, advertId);
  const allCampaignNmIdsResolved: number[] = (() => {
    try {
      const arr = JSON.parse(campaignNmsRow?.nms_json || "[]");
      if (!Array.isArray(arr)) return [];
      return arr.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
    } catch { return []; }
  })();
  if (djemFallbackDates.length > 0 && allCampaignNmIdsResolved.length > 0) {
    const nmPh = allCampaignNmIdsResolved.map(() => "?").join(",");
    const dPh = djemFallbackDates.map(() => "?").join(",");
    // MAX(frequency) per (phrase, date) — value одинаковый по всем nm_id (это глобальная
    // частотность WB, Джем просто отдаёт её per-nmId endpoint'ом). Затем SUM по дням → агрегат
    // частотности фразы за даты-«дырки».
    const djemFreqRows = await all<{ phrase_lc: string; phrase_raw: string; total: number; latest: string | null }>(`
      SELECT phrase_lc, MAX(phrase_raw) phrase_raw, SUM(max_freq) total, MAX(updated_at) latest
      FROM (
        SELECT lower(phrase) phrase_lc, MAX(phrase) phrase_raw, date,
               MAX(frequency) max_freq, MAX(updated_at) updated_at
        FROM phrase_djem_stats_daily
        WHERE nm_id IN (${nmPh}) AND date IN (${dPh}) AND frequency > 0
        GROUP BY lower(phrase), date
      )
      GROUP BY phrase_lc
    `, ...allCampaignNmIdsResolved, ...djemFallbackDates);
    for (const r of djemFreqRows) {
      const existing = wbFreqByPhraseLc.get(r.phrase_lc);
      if (existing) {
        wbFreqByPhraseLc.set(r.phrase_lc, { phrase: existing.phrase, frequency: existing.frequency + r.total });
      } else {
        wbFreqByPhraseLc.set(r.phrase_lc, { phrase: r.phrase_raw || r.phrase_lc, frequency: r.total });
      }
      if (r.latest && (!wbFreqUpdatedAt || r.latest > wbFreqUpdatedAt)) wbFreqUpdatedAt = r.latest;
    }
  }

  // Предрассчитаем для каждого кластера его список фраз (lc) + total frequency + inner
  interface ClusterInfo { name: string; nameLc: string; phrases: string[]; phrasesLcSet: Set<string>; totalFreq: number; inner: { phrase: string; frequency: number }[]; presetId: number | null }
  const clustersList: ClusterInfo[] = [];
  for (const c of manualClusters) {
    let phrases: string[] = [];
    try { const arr = JSON.parse(c.phrases_json); if (Array.isArray(arr)) phrases = arr.map(String); } catch { /* */ }
    const phrasesLcSet = new Set(phrases.map((p) => p.trim().toLowerCase()));
    // Имя кластера тоже считаем частью кластера для matching (parent = name)
    phrasesLcSet.add(c.name.trim().toLowerCase());
    const inner: { phrase: string; frequency: number }[] = [];
    let totalFreq = 0;
    const seen = new Set<string>();
    for (const lc of phrasesLcSet) {
      if (seen.has(lc)) continue;
      seen.add(lc);
      const hit = wbFreqByPhraseLc.get(lc);
      if (hit) {
        inner.push({ phrase: hit.phrase, frequency: hit.frequency });
        totalFreq += hit.frequency;
      }
    }
    inner.sort((a, b) => b.frequency - a.frequency);
    clustersList.push({ name: c.name, nameLc: c.name.trim().toLowerCase(), phrases, phrasesLcSet, totalFreq, inner, presetId: c.preset_id });
  }

  // Matching: exact parent name wins across all clusters, then child membership.
  // This prevents an older broad cluster from stealing a phrase that is the
  // canonical name of a newer/manual cluster.
  function findClusterFor(phraseLc: string): { cluster: ClusterInfo; role: "parent" | "child" } | null {
    for (const c of clustersList) {
      if (c.nameLc === phraseLc) return { cluster: c, role: "parent" };
    }
    for (const c of clustersList) {
      if (c.phrasesLcSet.has(phraseLc)) return { cluster: c, role: "child" };
    }
    return null;
  }

  // 5) Позиции из open search endpoint (wb-parser SSH)
  const posRows2 = await all<{
    norm_query: string;
    ad_pos: number;
    organic_pos: number;
    boost: number;
    preset_id: string | null;
  }>(`
    SELECT norm_query, ad_pos, organic_pos, boost, preset_id
    FROM campaign_phrase_positions
    WHERE advert_id = ?
  `, advertId);
  const posMap2 = new Map(posRows2.map((r) => [r.norm_query.toLowerCase(), r]));

  // Мета-2 — глобальная по фразе (не зависит от nm_id/advert_id). Загружаем все фразы
  // сразу одним запросом и мапим по lowercase.
  const metaRows = await all<{ phrase: string; preset_id: number | null; last_verified_at: string | null }>(
    `SELECT phrase, preset_id, last_verified_at FROM search_phrase_meta`,
  );
  const metaMap = new Map<string, { preset_id: number | null; last_verified_at: string | null }>();
  for (const r of metaRows) metaMap.set(r.phrase, { preset_id: r.preset_id, last_verified_at: r.last_verified_at });

  // Джем — per-phrase за 90 дней, ключ (nm_id, lower(phrase)). Берём по firstNmId кампании.
  const campRow = campaignNmsRow;
  let firstNmId: number | null = null;
  try {
    const nms = JSON.parse(campRow?.nms_json || "[]") as number[];
    if (Array.isArray(nms) && nms.length > 0) firstNmId = Number(nms[0]) || null;
  } catch { /* */ }

  const djemRows = firstNmId
    ? await all<{
        phrase: string;
        period_start: string; period_end: string; updated_at: string | null;
        view_count: number; open_card_count: number; add_to_cart_count: number;
        order_count: number; order_sum: number;
        avg_position: number; ctr: number;
        open_to_cart_conversion: number; cart_to_order_conversion: number; avg_price: number;
      }>(
        `SELECT phrase, period_start, period_end, updated_at,
                view_count, open_card_count, add_to_cart_count, order_count, order_sum,
                avg_position, ctr, open_to_cart_conversion, cart_to_order_conversion, avg_price
           FROM phrase_djem_stats WHERE nm_id = ?`,
        firstNmId,
      )
    : [];
  const djemMap = new Map(djemRows.map((r) => [r.phrase.toLowerCase(), r]));

  // Агрегация Джем-статистики по кластеру. Нужно, потому что WB в разных API нормализует
  // фразу по-разному: cmp preset-info отдаёт «трусы женский» (название кластера у нас),
  // а seller-content Djem возвращает «трусы женские». JOIN по lower(phrase) даёт miss,
  // поэтому для parent-строк суммируем данные Джема ПО ВСЕМ фразам кластера.
  interface DjemAgg {
    view_count: number;
    open_card_count: number;
    add_to_cart_count: number;
    order_count: number;
    order_sum: number;
    ctr: number;
    open_to_cart_conversion: number;
    cart_to_order_conversion: number;
    avg_position: number;
    avg_price: number;
    period_start: string | null;
    period_end: string | null;
    updated_at: string | null;
  }
  const clusterDjemAgg = new Map<string, DjemAgg>();
  for (const c of clustersList) {
    let views = 0, clicks = 0, baskets = 0, orders = 0, orderSum = 0;
    let weightedPosSum = 0;  // sum(avg_pos × views) — для взвешенной средней позиции
    let period_start: string | null = null, period_end: string | null = null, updated_at: string | null = null;
    for (const lc of c.phrasesLcSet) {
      const d = djemMap.get(lc);
      if (!d) continue;
      views += d.view_count;
      clicks += d.open_card_count;
      baskets += d.add_to_cart_count;
      orders += d.order_count;
      orderSum += d.order_sum;
      if (d.view_count > 0 && d.avg_position > 0) weightedPosSum += d.avg_position * d.view_count;
      period_start = period_start ?? d.period_start;
      period_end = period_end ?? d.period_end;
      if (!updated_at || (d.updated_at && d.updated_at > updated_at)) updated_at = d.updated_at;
    }
    if (views === 0 && clicks === 0 && baskets === 0 && orders === 0) continue;  // пустой кластер — пропуск
    clusterDjemAgg.set(c.nameLc, {
      view_count: views,
      open_card_count: clicks,
      add_to_cart_count: baskets,
      order_count: orders,
      order_sum: orderSum,
      // Конверсии — пересчитаны из сумм (взвешенное среднее % по фразам даст мусор)
      ctr: views > 0 ? (clicks / views) * 100 : 0,
      open_to_cart_conversion: clicks > 0 ? (baskets / clicks) * 100 : 0,
      cart_to_order_conversion: baskets > 0 ? (orders / baskets) * 100 : 0,
      avg_position: views > 0 ? weightedPosSum / views : 0,
      avg_price: 0,
      period_start, period_end, updated_at,
    });
  }

  // UNION всех ключей — список ФРАЗ стабилен: зависит только от текущего состояния кампании,
  // а не от выбранного startDate/endDate (меняется только статистика в колонках).
  // - preset: управляемые + исключения (текущий снимок, актуален после последнего sync)
  // - xlsx keywords: фразы, которые реально получали показы (>0) — это и есть unknown/«неуправляемые»
  // - bids: фразы с явно заданной ставкой
  // Фильтруем мусор: в xlsx keywords WB пишет и nm_id других товаров ("161894132"),
  // и ID каталогов ("#668171878"). Это не поисковые фразы. Оставляем только записи,
  // содержащие хотя бы одну букву.
  const allKwPhrases = await all<{ phrase: string }>(
    "SELECT DISTINCT phrase FROM campaign_keywords WHERE advert_id = ? AND views > 0 AND phrase GLOB '*[А-Яа-яA-Za-z]*'",
    advertId,
  );

  const phraseSet = new Set<string>();
  for (const r of presetRows) phraseSet.add(r.phrase);
  for (const r of allKwPhrases) phraseSet.add(r.phrase);
  for (const r of bidRows) phraseSet.add(r.norm_query);

  // Для share используем суммарные views по преим. источнику (xlsx → preset → stats).
  let totalViews = 0;
  const phraseViews = new Map<string, number>();
  for (const phrase of phraseSet) {
    const lc = phrase.toLowerCase();
    const kw = kwMap.get(lc);
    const pr = presetMap.get(lc);
    const st = statsMap.get(lc);
    const v = kw?.views ?? pr?.views ?? st?.views ?? 0;
    phraseViews.set(lc, v);
    totalViews += v;
  }

  // Иерархия строится из ручной базы manual_clusters.
  // Для каждой фразы определяем её кластер (exact parent first, затем child membership).
  //   - phrase.lc === cluster.nameLc → parent (master кластера)
  //   - phrase.lc ∈ cluster.phrasesLcSet → child (parent_phrase = cluster.nameLc)
  //   - иначе — orphan (не в кластере)
  const parentOf = new Map<string, string>();     // child_lc → cluster.nameLc
  const childrenOf = new Map<string, string[]>(); // cluster.nameLc → [child phrases (raw case)]
  const parentSet = new Set<string>();            // cluster.nameLc у которых есть phrase в campaign
  for (const phrase of phraseSet) {
    const lc = phrase.toLowerCase();
    const m = findClusterFor(lc);
    if (!m) continue;
    if (m.role === "parent") {
      parentSet.add(lc);
    } else {
      parentOf.set(lc, m.cluster.nameLc);
      const arr = childrenOf.get(m.cluster.nameLc);
      if (arr) arr.push(phrase); else childrenOf.set(m.cluster.nameLc, [phrase]);
    }
  }

  const keywords: AdCampKeyword[] = Array.from(phraseSet).map((phrase) => {
    const lc = phrase.toLowerCase();
    const preset = presetMap.get(lc);
    const kw = kwMap.get(lc);
    const st = statsMap.get(lc);
    const pos = posMap2.get(lc);

    const type: "common" | "excluded" | "unknown" = preset
      ? (preset.is_excluded ? "excluded" : "common")
      : "unknown";

    // СТАТИСТИКА ЗА ВЫБРАННЫЙ ПЕРИОД — только из xlsx (campaign_keywords) и normquery/stats.
    // preset-info хранит stats за period последнего sync (~неделя по умолчанию) — fallback
    // на него даст недельные цифры при выборе «сегодня». Поэтому его НЕ используем для views/etc.
    const views = kw?.views ?? st?.views ?? 0;
    const clicks = kw?.clicks ?? st?.clicks ?? 0;
    const spend = kw?.spend ?? 0;

    // CPM считаем сами по формуле spend/views × 1000 — это фактически уплаченная
    // стоимость за 1000 показов за период. WB-рассчитанная st.cpm неконсистентна с
    // отображаемыми views (разные источники агрегации), плюс не отражает изменение
    // ставки внутри дня. Fallback на st.cpm только когда у нас нет spend (xlsx ещё
    // не пришёл за сегодня).
    const cpm = views > 0 && spend > 0
      ? (spend / views) * 1000
      : (st?.cpm ?? 0);
    const avg_pos = st?.avg_pos ?? 0;

    const baskets = st?.atbs ?? 0;
    const orders = st?.orders ?? 0;
    // shks — только из preset, нет в stats_daily. Стоит понимать как «за период sync preset».
    const shks = preset?.shks ?? 0;

    const ctr = views > 0 ? (clicks / views) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const share = totalViews > 0 ? (views / totalViews) * 100 : 0;

    // actual_cpm — самый свежий локальный источник после ручного/авто изменения ставки.
    // campaign_keyword_bids может отставать до следующего normquery-bids sync.
    const bid = preset?.actual_cpm != null ? preset.actual_cpm / 100 : (bidMap.get(lc) ?? 0);
    const has_custom_bid = preset?.actual_cpm != null || (bidMap.get(lc) ?? 0) > 0;

    // Кластер: если фраза в ручной базе manual_clusters — берём суммарный total.
    // Иначе — прямой text-match в search_texts_wb без агрегации.
    let innerList: { phrase: string; frequency: number }[] = [];
    let clusterFreq = 0;
    const m = findClusterFor(lc);
    if (m) {
      clusterFreq = m.cluster.totalFreq;
      innerList = m.cluster.inner;
    } else {
      const hit = wbFreqByPhraseLc.get(lc);
      if (hit) {
        clusterFreq = hit.frequency;
        innerList = [{ phrase: hit.phrase, frequency: hit.frequency }];
      }
    }

    // djem_phrases: список lc-фраз, по которым клиент должен итерировать в per-day
    // tooltip'е Джема. Для parent-row — все фразы manual-кластера (cluster.phrasesLcSet),
    // т.к. WB Djem возвращает фразу в иной нормализации, чем cmp (пример:
    // «трусы женский» cmp ↔ «трусы женские» djem). Для orphan/child — сама фраза.
    const djemPhrasesLc: string[] = m
      ? Array.from(m.cluster.phrasesLcSet)
      : [lc];

    return {
      phrase,
      type,
      is_excluded: type === "excluded",
      views, clicks, baskets, orders, shks,
      ctr, spend, cpc, cpm, avg_pos,
      share,
      bid, has_custom_bid,
      min_cpm_search: minCpmSearch,
      approx_views_wb: clusterFreq,
      approx_views_wb_updated_at: wbFreqUpdatedAt,
      cluster_inner: innerList,
      is_parent: parentSet.has(lc) && (childrenOf.get(lc)?.length ?? 0) > 0,
      parent_phrase: parentOf.get(lc) ?? null,
      children_phrases: childrenOf.get(lc) ?? [],
      djem_phrases: djemPhrasesLc,
      ad_pos: pos?.ad_pos ?? 0,
      organic_pos: pos?.organic_pos ?? 0,
      boost: pos?.boost ?? 0,
      // preset_id: 1) из campaign_phrase_positions (wb-parser, исторически пустой),
      //            2) fallback — preset_id кластера, в который входит фраза (реальный WB cluster ID).
      preset_id: pos?.preset_id || (m?.cluster.presetId != null ? String(m.cluster.presetId) : ""),
      real_preset_id: metaMap.get(lc)?.preset_id ?? null,
      real_preset_checked_at: metaMap.get(lc)?.last_verified_at ?? null,
      ...(() => {
        // Если фраза = имя manual-кластера → берём aggregated (суммарно по всем phrases_json
        // этого кластера). Даже если у неё нет детей в ЭТОЙ кампании — в кластере могут быть
        // другие формы с данными в Джеме (разные нормализаторы WB). Per-phrase fallback — если
        // aggregation пустой (например кластер есть, но в Джеме по всем его фразам — 0).
        const src = clusterDjemAgg.get(lc) ?? djemMap.get(lc);
        return {
          djem_views: src?.view_count ?? 0,
          djem_clicks: src?.open_card_count ?? 0,
          djem_baskets: src?.add_to_cart_count ?? 0,
          djem_orders: src?.order_count ?? 0,
          djem_order_sum: src?.order_sum ?? 0,
          djem_ctr: src?.ctr ?? 0,
          djem_cart_conv: src?.open_to_cart_conversion ?? 0,
          djem_order_conv: src?.cart_to_order_conversion ?? 0,
          djem_avg_price: src?.avg_price ?? 0,
          djem_avg_pos: src?.avg_position ?? 0,
          djem_period_start: src?.period_start ?? null,
          djem_period_end: src?.period_end ?? null,
          djem_updated_at: src?.updated_at ?? null,
        };
      })(),
      atbs: baskets, // legacy alias
    };
  });

  // WB исключает canonical norm-query кластера, а в preset-info children этого же
  // manual-кластера могут оставаться type=common с actual_cpm. Для UI это всё равно
  // один исключённый кластер: иначе child с сохранённой ставкой возвращается в
  // «Нашу ставку», хотя parent уже в минусах.
  const keywordByLc = new Map(keywords.map((k) => [k.phrase.toLowerCase(), k]));
  for (const k of keywords) {
    if (!k.parent_phrase) continue;
    const parent = keywordByLc.get(k.parent_phrase);
    if (!parent?.is_excluded) continue;
    k.type = "excluded";
    k.is_excluded = true;
  }

  keywords.sort((a, b) => b.views - a.views);

  const catRowsRaw = await all<{ catalog_id: string; views: number; clicks: number; spend: number }>(`
    SELECT catalog_id, SUM(views) views, SUM(clicks) clicks, SUM(spend) spend
    FROM campaign_catalogs
    WHERE advert_id = ? AND date >= ? AND date <= ?
    GROUP BY catalog_id
  `, advertId, startDate, endDate);
  const catTotalV = catRowsRaw.reduce((s, r) => s + r.views, 0);
  const catalogs: AdCampCatalog[] = catRowsRaw
    .map((r) => ({
      catalog_id: r.catalog_id,
      views: r.views,
      clicks: r.clicks,
      ctr: r.views > 0 ? (r.clicks / r.views) * 100 : 0,
      cpc: r.clicks > 0 ? r.spend / r.clicks : 0,
      spend: r.spend,
      share: catTotalV > 0 ? (r.views / catTotalV) * 100 : 0,
    }))
    .sort((a, b) => b.views - a.views);

  return NextResponse.json({ ok: true, advertID: advertId, period: { startDate, endDate }, days: days_, keywords, catalogs });
}
