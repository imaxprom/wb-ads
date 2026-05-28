import { getDb } from "@/lib/db";
import { localDateStr } from "@/lib/format";

export const dynamic = "force-dynamic";

// Тестовая страница: откуда берутся все поля UI. Читает живые данные из БД.
// Цель — видеть что отдаёт каждый endpoint и куда оно мапится в «По дням» / «Запросы».

const ADVERT = 25141382;
const NM = 165140159;

interface Row {
  tech: string;        // технический ключ в JSON/БД
  desc: string;        // что означает
  uiName: string;      // как подписан столбец в UI
  v3Range: string;     // /api/v3/fullstat 30-day range
  v3Daily: string;     // /api/v3/fullstat один день
  normqueryStats: string; // /adv/v0/normquery/stats
  statsApi: string;    // /api/advert/v2/fullstats (другой open API)
  inDaily: string;     // какое поле в «По дням»
  inQueries: string;   // какое поле в «Запросы»
}

// Справочная таблица — где какое поле живёт в каждом источнике и в каждой вкладке
const METRICS: Row[] = [
  { tech: "views",       desc: "Показы рекламы",                    uiName: "👁 Показы",        v3Range: "Sheet4 per-day total+зоны → campaign_days.views_total/search/catalog/reco",  v3Daily: "Sheet1 per-nm → campaign_nm_daily.views",      normqueryStats: "JSON .views → campaign_keyword_stats_daily.views",   statsApi: "days[].views + days[].apps[].nms[].views → campaign_stats_daily + campaign_stats_by_nm",  inDaily: "views_total + разбивка по зонам (Поиск/Полки/Реко)",  inQueries: "per-phrase: сначала campaign_keywords.views, fallback stats_daily.views" },
  { tech: "clicks",      desc: "Клики по рекламе",                   uiName: "👆 Клики",        v3Range: "Sheet4 → campaign_days.clicks_total/search/catalog/reco",                  v3Daily: "Sheet1 → campaign_nm_daily.clicks",            normqueryStats: "JSON .clicks → campaign_keyword_stats_daily.clicks", statsApi: "days[].clicks + days[].apps[].nms[].clicks",                                          inDaily: "clicks_total + разбивка по зонам",                  inQueries: "per-phrase: campaign_keywords.clicks → fallback stats_daily.clicks" },
  { tech: "spend",       desc: "Расход на рекламу, ₽",              uiName: "Затраты ∑",        v3Range: "Sheet4 → campaign_days.sum_total/search/catalog/reco",                      v3Daily: "Sheet1 → campaign_nm_daily.spend",             normqueryStats: "JSON .spend → campaign_keyword_stats_daily (нет колонки — игнор)",  statsApi: "days[].sum → campaign_stats_daily.sum",                                                inDaily: "MAX(campaign_days.sum_total, stats_daily.sum) гибрид",  inQueries: "per-phrase: campaign_keywords.spend" },
  { tech: "atbs",        desc: "Корзины (add-to-basket)",            uiName: "🛒 Корзины",       v3Range: "— (нет в Sheet4)",                                                         v3Daily: "Sheet1 → campaign_nm_daily.atbs",              normqueryStats: "JSON .atbs → campaign_keyword_stats_daily.atbs",     statsApi: "days[].atbs + apps[].nms[].atbs → campaign_stats_daily.atbs",                         inDaily: "campaign_stats_daily.atbs",                         inQueries: "per-phrase: stats_daily.atbs (нет в xlsx)" },
  { tech: "orders",      desc: "Заказы",                             uiName: "📦 Заказы",        v3Range: "— (нет в Sheet4)",                                                         v3Daily: "Sheet1 → campaign_nm_daily.orders",            normqueryStats: "JSON .orders → campaign_keyword_stats_daily.orders", statsApi: "days[].orders + apps[].nms[].orders → campaign_stats_daily.orders",                     inDaily: "campaign_stats_daily.orders",                       inQueries: "per-phrase: stats_daily.orders" },
  { tech: "sum_price",   desc: "Выручка с заказов, ₽",              uiName: "Выручка",          v3Range: "— (нет)",                                                                   v3Daily: "Sheet1 → campaign_nm_daily.order_sum",         normqueryStats: "— (нет)",                                            statsApi: "days[].sum_price → campaign_stats_daily.sum_price",                                     inDaily: "campaign_stats_daily.sum_price (для ДРРк)",         inQueries: "— (не показывается)" },
  { tech: "ctr",         desc: "CTR = clicks/views × 100%",         uiName: "CTR",              v3Range: "Sheet2 per-phrase (для запросов)",                                          v3Daily: "Sheet1 → campaign_nm_daily.ctr",              normqueryStats: "JSON .ctr → (не сохраняем, пересчитываем)",         statsApi: "— (пересчитываем)",                                                                      inDaily: "пересчитывается на клиенте: clicks/views × 100",    inQueries: "пересчитывается на клиенте" },
  { tech: "cpc",         desc: "Р/клик = spend/clicks",              uiName: "Р/клик",           v3Range: "Sheet3 catalogs only → campaign_catalogs.cpc",                              v3Daily: "Sheet1 → campaign_nm_daily.cpc",              normqueryStats: "JSON .cpc",                                          statsApi: "— (пересчитываем)",                                                                      inDaily: "пересчитывается: spend/clicks",                     inQueries: "пересчитывается на клиенте" },
  { tech: "cpm",         desc: "Цена за 1000 показов, ₽",            uiName: "CPM",              v3Range: "— (нет)",                                                                   v3Daily: "Sheet1 → campaign_nm_daily.cpm",              normqueryStats: "JSON .cpm → campaign_keyword_stats_daily.cpm",       statsApi: "— (нет)",                                                                                inDaily: "— (не показывается)",                              inQueries: "per-phrase: stats_daily.cpm" },
  { tech: "cpo",         desc: "Цена заказа = spend/orders",          uiName: "—",                v3Range: "— (нет)",                                                                   v3Daily: "Sheet1 → campaign_nm_daily.cpo",              normqueryStats: "— (нет)",                                            statsApi: "— (нет)",                                                                                inDaily: "— (не показывается)",                              inQueries: "— (не показывается)" },
  { tech: "avg_position",desc: "Средняя позиция товара в выдаче",    uiName: "Ср.поз",           v3Range: "— (агрегат 30 дней, не доступно per-day)",                                  v3Daily: "Sheet1 → campaign_nm_daily.avg_position ← ЕДИНСТВЕННЫЙ источник",  normqueryStats: "JSON .avg_pos → campaign_keyword_stats_daily.avg_pos (per-phrase)", statsApi: "— (нет)",                                                                  inDaily: "campaign_nm_daily.avg_position (товар с MAX views)",  inQueries: "per-phrase: stats_daily.avg_pos" },
  { tech: "cancels",     desc: "Отмены заказов",                      uiName: "—",                v3Range: "— (нет)",                                                                   v3Daily: "Sheet1 → campaign_nm_daily.cancels",          normqueryStats: "— (нет)",                                            statsApi: "— (нет)",                                                                                inDaily: "— (не используется)",                               inQueries: "— (не используется)" },
  { tech: "product_name",desc: "Название товара",                     uiName: "Товар (fallback)", v3Range: "— (нет)",                                                                   v3Daily: "Sheet1 → campaign_nm_daily.product_name",     normqueryStats: "— (нет)",                                            statsApi: "— (идёт через products)",                                                                 inDaily: "— (из таблицы products)",                           inQueries: "— (не используется)" },
  { tech: "multi_card_id",desc: "ID склейки (мастер-карточка)",      uiName: "—",                v3Range: "— (нет)",                                                                   v3Daily: "Sheet1 → campaign_nm_daily.multi_card_id",    normqueryStats: "— (нет)",                                            statsApi: "— (нет)",                                                                                inDaily: "— (для группировки склейки, в разработке)",          inQueries: "— (не используется)" },
  { tech: "conversion_type",desc: "Тип трафика: Прямая/Ассоц.",      uiName: "—",                v3Range: "— (нет)",                                                                   v3Daily: "Sheet1 → campaign_nm_daily.conversion_type",  normqueryStats: "— (нет)",                                            statsApi: "— (нет, считаем по views>0)",                                                             inDaily: "— (используется в ассоц. конверсиях по-другому)",    inQueries: "— (не используется)" },
  { tech: "phrase/norm_query",desc: "Поисковая фраза",                 uiName: "Фраза",            v3Range: "Sheet2 per-phrase per-day → campaign_keywords.phrase",                       v3Daily: "— (нет Sheet2 в daily-режиме)",               normqueryStats: "JSON .norm_query → campaign_keyword_stats_daily.norm_query",  statsApi: "— (нет)",                                                                                inDaily: "— (не используется)",                               inQueries: "главный столбец" },
  { tech: "catalog_id",  desc: "ID каталога, куда показывается рекл.",uiName: "Каталог",          v3Range: "Sheet3 → campaign_catalogs.catalog_id",                                      v3Daily: "— (нет)",                                      normqueryStats: "— (нет)",                                            statsApi: "— (нет)",                                                                                inDaily: "— (на отдельной вкладке Каталоги — в разработке)",   inQueries: "— (в отдельной вкладке Каталоги)" },
  { tech: "actual_cpm",  desc: "Ваша ручная ставка CPM, копейки",    uiName: "🔍×₽ Ставка",      v3Range: "— (нет)",                                                                   v3Daily: "— (нет)",                                      normqueryStats: "— (не возвращает ставку)",                          statsApi: "— (нет)",                                                                                inDaily: "— (не показывается)",                               inQueries: "preset-info → campaign_preset_keywords.actual_cpm/100" },
  { tech: "is_excluded", desc: "Фраза в минусах",                     uiName: "(⊘)",              v3Range: "— (нет)",                                                                   v3Daily: "— (нет)",                                      normqueryStats: "— (не возвращает)",                                 statsApi: "— (нет)",                                                                                inDaily: "— (не показывается)",                               inQueries: "preset-info → campaign_preset_keywords.is_excluded" },
  { tech: "frequency_wb",desc: "Частотность фразы в WB поиске",       uiName: "~👁 Частота WB",  v3Range: "— (нет)",                                                                   v3Daily: "— (нет)",                                      normqueryStats: "— (нет)",                                            statsApi: "— (нет)",                                                                                inDaily: "— (не показывается)",                               inQueries: "premium search-analysis xlsx → search_texts_wb.frequency" },
  { tech: "ad_pos/boost",desc: "Позиция в выдаче / буст от рекламы", uiName: "Позиция / Буст",   v3Range: "— (нет)",                                                                   v3Daily: "— (нет)",                                      normqueryStats: "— (нет)",                                            statsApi: "— (нет)",                                                                                inDaily: "— (не показывается)",                               inQueries: "SSH wb-parser → campaign_phrase_positions" },
];

function q(db: ReturnType<typeof getDb>, sql: string, ...params: unknown[]): unknown {
  try { return db.prepare(sql).get(...(params as [])); } catch { return null; }
}

export default function DataSourcesPage() {
  const db = getDb();
  const today = localDateStr(new Date());

  // Реальные данные для примера: advert=25141382, nm=165140159 — только за сегодня
  const nmDaily = q(db, "SELECT * FROM campaign_nm_daily WHERE advert_id=? AND nm_id=? AND date=?", ADVERT, NM, today) as Record<string, unknown> | null;
  const days = q(db, "SELECT * FROM campaign_days WHERE advert_id=? AND date=?", ADVERT, today) as Record<string, unknown> | null;
  const statsDaily = q(db, "SELECT * FROM campaign_stats_daily WHERE advert_id=? AND date=?", ADVERT, today) as Record<string, unknown> | null;
  const topPhrase = q(db, "SELECT norm_query, views, clicks, cpm, atbs, orders, avg_pos FROM campaign_keyword_stats_daily WHERE advert_id=? AND nm_id=? AND date=? ORDER BY views DESC LIMIT 1", ADVERT, NM, today) as Record<string, unknown> | null;
  const topPhraseXlsx = q(db, "SELECT phrase, views, clicks, ctr, spend FROM campaign_keywords WHERE advert_id=? AND date=? ORDER BY views DESC LIMIT 1", ADVERT, today) as Record<string, unknown> | null;

  const formatCell = (v: unknown): string => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "number") return v.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
    return String(v);
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] p-6">
      <div className="max-w-full">
        <h1 className="text-2xl font-bold mb-2">Откуда берутся данные</h1>
        <p className="text-[var(--text-muted)] mb-6 text-sm">
          Справочная карта: для каждой метрики UI показано, какой endpoint WB её отдаёт и в какую таблицу БД записывается.
          Пример внизу — живые данные для кампании <b>{ADVERT}</b>, артикула <b>{NM}</b>.
        </p>

        {/* Живые данные per-source */}
        <h2 className="text-xl font-bold mt-8 mb-3">Реальные значения за {today} — advert={ADVERT}, nm={NM}</h2>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead>
              <tr className="bg-[var(--bg-card)]">
                <th className="p-2 border border-[var(--border)] text-left">Поле</th>
                <th className="p-2 border border-[var(--border)]">campaign_nm_daily<br/>(v3-daily, Sheet1)</th>
                <th className="p-2 border border-[var(--border)]">campaign_days<br/>(v3-30d, Sheet4)</th>
                <th className="p-2 border border-[var(--border)]">campaign_stats_daily<br/>(open API /stats)</th>
              </tr>
            </thead>
            <tbody>
              {[
                { k: "views", label: "👁 Показы" },
                { k: "clicks", label: "👆 Клики" },
                { k: "spend", label: "Затраты ₽", altDays: "sum_total" },
                { k: "atbs", label: "🛒 Корзины" },
                { k: "orders", label: "📦 Заказы" },
                { k: "avg_position", label: "Ср.поз" },
                { k: "cpm", label: "CPM" },
                { k: "cpc", label: "CPC" },
                { k: "ctr", label: "CTR" },
                { k: "cpo", label: "CPO" },
                { k: "order_sum", label: "Выручка" },
                { k: "cancels", label: "Отмены" },
                { k: "product_name", label: "Товар" },
                { k: "conversion_type", label: "Тип трафика" },
                { k: "views_search", label: "Показы Поиск (зона)" },
                { k: "views_catalog", label: "Показы Каталог (зона)" },
                { k: "views_reco", label: "Показы Реко (зона)" },
                { k: "sum_price", label: "sum_price (stats)" },
              ].map((f) => (
                <tr key={f.k} className="hover:bg-[var(--bg-card-hover)]">
                  <td className="p-1.5 border border-[var(--border)] font-mono text-[var(--text-muted)]">{f.label}<div className="text-[9px] opacity-60">{f.k}</div></td>
                  <td className="p-1.5 border border-[var(--border)] text-right font-mono">{formatCell(nmDaily?.[f.k])}</td>
                  <td className="p-1.5 border border-[var(--border)] text-right font-mono">{formatCell(days?.[f.altDays ?? f.k])}</td>
                  <td className="p-1.5 border border-[var(--border)] text-right font-mono">{formatCell(statsDaily?.[f.k === "spend" ? "sum" : f.k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="text-lg font-semibold mt-6 mb-2">Верхняя фраза кампании за сегодня</h3>
        <div className="overflow-x-auto text-xs">
          <table className="border-collapse">
            <thead>
              <tr className="bg-[var(--bg-card)]">
                <th className="p-2 border border-[var(--border)] text-left">Источник</th>
                <th className="p-2 border border-[var(--border)]">Фраза</th>
                <th className="p-2 border border-[var(--border)]">views</th>
                <th className="p-2 border border-[var(--border)]">clicks</th>
                <th className="p-2 border border-[var(--border)]">ctr</th>
                <th className="p-2 border border-[var(--border)]">spend</th>
                <th className="p-2 border border-[var(--border)]">cpm</th>
                <th className="p-2 border border-[var(--border)]">atbs</th>
                <th className="p-2 border border-[var(--border)]">orders</th>
                <th className="p-2 border border-[var(--border)]">avg_pos</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-1.5 border border-[var(--border)] font-mono">campaign_keywords<br/>(v3, Sheet2)</td>
                <td className="p-1.5 border border-[var(--border)]">{formatCell(topPhraseXlsx?.phrase)}</td>
                <td className="p-1.5 border border-[var(--border)] text-right font-mono">{formatCell(topPhraseXlsx?.views)}</td>
                <td className="p-1.5 border border-[var(--border)] text-right font-mono">{formatCell(topPhraseXlsx?.clicks)}</td>
                <td className="p-1.5 border border-[var(--border)] text-right font-mono">{formatCell(topPhraseXlsx?.ctr)}</td>
                <td className="p-1.5 border border-[var(--border)] text-right font-mono">{formatCell(topPhraseXlsx?.spend)}</td>
                <td className="p-1.5 border border-[var(--border)] text-right font-mono text-[var(--text-muted)]">—</td>
                <td className="p-1.5 border border-[var(--border)] text-right font-mono text-[var(--text-muted)]">—</td>
                <td className="p-1.5 border border-[var(--border)] text-right font-mono text-[var(--text-muted)]">—</td>
                <td className="p-1.5 border border-[var(--border)] text-right font-mono text-[var(--text-muted)]">—</td>
              </tr>
              <tr>
                <td className="p-1.5 border border-[var(--border)] font-mono">campaign_keyword_stats_daily<br/>(open API /normquery/stats)</td>
                <td className="p-1.5 border border-[var(--border)]">{formatCell(topPhrase?.norm_query)}</td>
                <td className="p-1.5 border border-[var(--border)] text-right font-mono">{formatCell(topPhrase?.views)}</td>
                <td className="p-1.5 border border-[var(--border)] text-right font-mono">{formatCell(topPhrase?.clicks)}</td>
                <td className="p-1.5 border border-[var(--border)] text-right font-mono text-[var(--text-muted)]">—</td>
                <td className="p-1.5 border border-[var(--border)] text-right font-mono text-[var(--text-muted)]">—</td>
                <td className="p-1.5 border border-[var(--border)] text-right font-mono">{formatCell(topPhrase?.cpm)}</td>
                <td className="p-1.5 border border-[var(--border)] text-right font-mono">{formatCell(topPhrase?.atbs)}</td>
                <td className="p-1.5 border border-[var(--border)] text-right font-mono">{formatCell(topPhrase?.orders)}</td>
                <td className="p-1.5 border border-[var(--border)] text-right font-mono">{formatCell(topPhrase?.avg_pos)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Справочная матрица */}
        <h2 className="text-xl font-bold mt-10 mb-3">Карта: метрика → источники → куда в UI</h2>
        <div className="overflow-x-auto">
          <table className="text-[11px] border-collapse min-w-full">
            <thead>
              <tr className="bg-[var(--bg-card)] sticky top-0">
                <th className="p-2 border border-[var(--border)] text-left w-40">Метрика (UI / tech)</th>
                <th className="p-2 border border-[var(--border)] text-left w-64">Назначение</th>
                <th className="p-2 border border-[var(--border)] text-left w-80">WB /api/v3/fullstat<br/>30 дней (fullstat-v3)</th>
                <th className="p-2 border border-[var(--border)] text-left w-80">WB /api/v3/fullstat<br/>1 день (fullstat-v3-daily)</th>
                <th className="p-2 border border-[var(--border)] text-left w-80">WB /adv/v0/normquery/stats<br/>(open API)</th>
                <th className="p-2 border border-[var(--border)] text-left w-80">WB /api/advert/v2/fullstats<br/>(open API, общий)</th>
                <th className="p-2 border border-[var(--border)] text-left w-72">Вкладка «По дням»</th>
                <th className="p-2 border border-[var(--border)] text-left w-72">Вкладка «Запросы»</th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => (
                <tr key={m.tech} className="hover:bg-[var(--bg-card-hover)]">
                  <td className="p-1.5 border border-[var(--border)] align-top">
                    <div className="font-semibold">{m.uiName}</div>
                    <div className="text-[9px] font-mono text-[var(--text-muted)]">{m.tech}</div>
                  </td>
                  <td className="p-1.5 border border-[var(--border)] align-top text-[var(--text-muted)]">{m.desc}</td>
                  <td className="p-1.5 border border-[var(--border)] align-top font-mono text-[10px]">{m.v3Range}</td>
                  <td className="p-1.5 border border-[var(--border)] align-top font-mono text-[10px]">{m.v3Daily}</td>
                  <td className="p-1.5 border border-[var(--border)] align-top font-mono text-[10px]">{m.normqueryStats}</td>
                  <td className="p-1.5 border border-[var(--border)] align-top font-mono text-[10px]">{m.statsApi}</td>
                  <td className="p-1.5 border border-[var(--border)] align-top font-mono text-[10px]">{m.inDaily}</td>
                  <td className="p-1.5 border border-[var(--border)] align-top font-mono text-[10px]">{m.inQueries}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Легенда endpoints */}
        <h2 className="text-xl font-bold mt-10 mb-3">Endpoints — как WB отдаёт</h2>
        <div className="space-y-3 text-sm">
          <div className="p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
            <div className="font-semibold">1. <span className="font-mono">cmp /api/v3/fullstat</span> — 30-дневный xlsx (sync: <code>/api/sync/fullstat-v3</code>)</div>
            <ul className="ml-5 mt-1 text-xs list-disc text-[var(--text-muted)]">
              <li><b>Sheet1</b> (агрегат 30 дней по nm): мы НЕ сохраняем — перекрывается daily-вариантом с точностью per-day.</li>
              <li><b>Sheet2</b> (per-фраза, per-день): сохраняем в <code>campaign_keywords</code> — используем для «Запросы» (views/clicks/spend/ctr).</li>
              <li><b>Sheet3</b> (каталоги): сохраняем в <code>campaign_catalogs</code>.</li>
              <li><b>Sheet4</b> (per-день × зоны): сохраняем в <code>campaign_days</code> — используем для «По дням» (разбивка Поиск/Каталог/Реко).</li>
              <li>Лаг: ~24 ч (xlsx за сегодня обычно неполон).</li>
            </ul>
          </div>
          <div className="p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
            <div className="font-semibold">2. <span className="font-mono">cmp /api/v3/fullstat</span> с <code>from==to</code> — однодневный xlsx (sync: <code>/api/sync/fullstat-v3-daily</code>)</div>
            <ul className="ml-5 mt-1 text-xs list-disc text-[var(--text-muted)]">
              <li><b>Sheet1</b> (per-nm за один день): сохраняем в <code>campaign_nm_daily</code>.</li>
              <li>Единственный источник <b>avg_position</b>, orders_per_nm, cpo, order_sum, cancels, multi_card_id.</li>
              <li>Лаг: ~24 ч.</li>
            </ul>
          </div>
          <div className="p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
            <div className="font-semibold">3. <span className="font-mono">/adv/v0/normquery/stats</span> — open API, JSON (sync: <code>/api/sync/normquery-stats</code>)</div>
            <ul className="ml-5 mt-1 text-xs list-disc text-[var(--text-muted)]">
              <li>Per-phrase stats за указанный день. Сохраняем в <code>campaign_keyword_stats_daily</code>.</li>
              <li>Поля: views, clicks, atbs, orders, cpc, cpm, ctr, avg_pos.</li>
              <li>Real-time (~30 мин лаг). Отдаёт данные за <b>сегодня</b>.</li>
              <li>Rate limit: 10 req/min.</li>
            </ul>
          </div>
          <div className="p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
            <div className="font-semibold">4. <span className="font-mono">/api/advert/v2/fullstats</span> — open API, JSON (sync: <code>/api/sync/stats</code>)</div>
            <ul className="ml-5 mt-1 text-xs list-disc text-[var(--text-muted)]">
              <li>Общий агрегат по кампании per-день + разбивка по nm (для ассоциированных конверсий).</li>
              <li>Сохраняем в <code>campaign_stats_daily</code> (per-кампания) + <code>campaign_stats_by_nm</code> (per-nm).</li>
              <li>Поля: views, clicks, sum (spend), atbs, orders, sum_price (выручка).</li>
              <li>НЕ даёт per-phrase и per-zone breakdown.</li>
              <li>Лаг: ~30 мин.</li>
            </ul>
          </div>
        </div>

        <div className="mt-10 text-xs text-[var(--text-muted)]">
          Страница читает БД напрямую на сервере при каждой загрузке. Обновите для свежих цифр.
        </div>
      </div>
    </div>
  );
}
