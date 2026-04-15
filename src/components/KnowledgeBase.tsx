"use client";

import { useState } from "react";

interface Section {
  id: string;
  title: string;
  items: { label: string; value: string }[];
}

const SECTIONS: Section[] = [
  {
    id: "architecture",
    title: "Архитектура",
    items: [
      { label: "Стек", value: "Next.js 16 + TypeScript + Tailwind CSS 4 + SQLite (better-sqlite3) + Puppeteer" },
      { label: "Порт", value: "3001 (MpHub = 3000)" },
      { label: "БД", value: "data/ads.db — 25 таблиц" },
      { label: "Фронтенд", value: "Одностраничник: табы Карточки / Настройки" },
      { label: "Верхняя таблица", value: "14 столбцов товаров: drag, resize, hide. Настройки в БД" },
      { label: "Нижняя панель", value: "SplitPane: карточка товара + 5 вкладок. 28 столбцов по дням (до 90 дней). Drag, resize, hide" },
      { label: "Темы", value: "3 варианта: Violet, Arctic, Neon" },
      { label: "Настройки в БД", value: "12 ключей: theme, dashboard_period/offset, auto_sync_enabled/interval, col_widths/order/hidden, detail_col_widths/order/hidden, deep_sync_date, active_tab" },
      { label: "Иконки (7)", value: "SVG line-style: EyeIcon, CartIcon, BoxIcon, ClickIcon (рука), CheckCircleIcon, PlayIcon, PauseIcon" },
      { label: "Часовой пояс", value: "Все даты через localDateStr() (Москва), НЕ UTC toISOString()" },
      { label: "Период 'Вчера'", value: "offset=1, days=1 → dateTo=вчера, dateFrom=вчера. Только один день" },
    ],
  },
  {
    id: "sync",
    title: "Синхронизация",
    items: [
      { label: "Модалка синка", value: "Две таблицы: открытый API (7 шагов) + закрытый Джем (2 шага). Запускаются параллельно" },
      { label: "Ретрай", value: "До 3 попыток на каждый шаг. Пауза 30 сек между попытками. Только ошибочные шаги повторяются" },
      { label: "Авто-синк", value: "Таймер 5-60 мин. Открытый API последовательно + Джем параллельно" },
      { label: "Глубокий синк", value: "Каждый день после 9:00 — days=3 вместо days=1 (вчера+позавчера). Дата в deep_sync_date" },
      { label: "Логирование", value: "Каждый шаг пишется в sync_log (тип, время, успех/ошибки, длительность). Иконка треугольника в ControlPanel" },
      { label: "Прогресс Джем", value: "Счётчик N/29 + прогресс-бар. Поллинг GET каждые 0.5 сек" },
      { label: "/api/sync/campaigns", value: "Кампании + ставки -> advert-api. Батч 50" },
      { label: "/api/sync/products", value: "Карточки + цены + рейтинг -> Content + Prices + sales-funnel API" },
      { label: "/api/sync/stocks", value: "Остатки -> Statistics API (полная перезапись)" },
      { label: "/api/sync/stats", value: "Дневная статистика -> fullstats v3. apps[].nms[] -> direct vs associated" },
      { label: "/api/sync/balance", value: "Баланс + бюджеты -> advert-api" },
      { label: "/api/sync/clusters", value: "Поисковые кластеры -> normquery/stats v0 + get-bids" },
      { label: "/api/sync/funnel?days=N", value: "Воронка открытая -> seller-analytics. Все товары из products (не только активные)" },
      { label: "/api/sync/auth-wb-funnel?days=N", value: "Воронка Джем (viewCount!) -> seller-content. 3 параллельно, 1 сек пауза" },
      { label: "/api/sync/buyer-profile?days=N", value: "Портрет покупателя -> seller-content. days=1: 3 парал./1сек. days>1: 2 парал./3сек" },
    ],
  },
  {
    id: "hybrid",
    title: "Гибридный метод воронки",
    items: [
      { label: "Принцип", value: "FULL OUTER JOIN двух таблиц по nm_id+date. MAX() для пересекающихся метрик" },
      { label: "Пересекающиеся", value: "carts, orders, orders_sum — берётся большее (более свежее)" },
      { label: "Только Джем", value: "viewCount, openCardCount, buyoutsCount/Sum, cancelCount/Sum, addToWishlistCount" },
      { label: "dashboard/route.ts", value: "Гибрид для верхней таблицы. Все поля DashboardProduct" },
      { label: "product-detail", value: "Гибрид по дням. isAll='all' — сначала MAX по товару, потом SUM" },
      { label: "Весь магазин", value: "Галочка в нижней панели. Агрегация всех товаров. adClickToCart из direct carts (by_nm)" },
    ],
  },
  {
    id: "assoc",
    title: "Прямые vs ассоциированные конверсии",
    items: [
      { label: "Источник", value: "fullstats v3 -> apps[].nms[]. views>0/clicks>0 = прямые, иначе = ассоциированные" },
      { label: "В товар (IN)", value: "adCarts/adOrders: 1207+154. Другие кампании принесли корзины В этот товар" },
      { label: "Из товара (OUT)", value: "+корзины/+заказы: +216/+71. Реклама этого товара принесла ДРУГИМ" },
      { label: "Тултипы", value: "При наведении — таблица с nm_id, корзинами, заказами, суммой, артикулом" },
      { label: "xP корзины", value: "adSpend / campaign_stats_daily.atbs (= direct + assocOUT, без assocIN)" },
      { label: "xP заказы", value: "adSpend / campaign_stats_daily.orders (та же логика)" },
      { label: "adClickToCart", value: "Одиночный товар: adCarts / adClicks. Весь магазин: direct_carts(by_nm) / adClicks" },
    ],
  },
  {
    id: "api",
    title: "WB API серверы (8)",
    items: [
      { label: "advert-api.wildberries.ru", value: "Кампании, fullstats (apps[].nms[]), баланс, бюджеты, кластеры" },
      { label: "seller-analytics-api.wildberries.ru", value: "Воронка открытая (sales-funnel/products), рейтинг" },
      { label: "seller-content.wildberries.ru", value: "Воронка Джем + портрет покупателя (через Puppeteer)" },
      { label: "content-api.wildberries.ru", value: "Карточки товаров (Content API v2)" },
      { label: "discounts-prices-api.wildberries.ru", value: "Цены (Prices API v2)" },
      { label: "statistics-api.wildberries.ru", value: "Остатки (Statistics API v1). Заказы v1 — обновляются раз в 30 мин" },
      { label: "dp-calendar-api.wildberries.ru", value: "Акции/промо (Calendar API)" },
      { label: "seller-auth.wildberries.ru", value: "Авторизация по телефону (через Puppeteer CDP)" },
    ],
  },
  {
    id: "tables",
    title: "Таблицы БД (25 таблиц)",
    items: [
      { label: "campaigns (332)", value: "Рекламные кампании. type=NULL, определяется по имени" },
      { label: "campaign_stats_daily", value: "Статистика по дням. Основной источник adSpend/xP" },
      { label: "campaign_stats_by_nm", value: "Статистика по товарам. Direct vs associated (views>0 = direct)" },
      { label: "sales_funnel_daily", value: "Воронка открытая: все товары из products (не только активные)" },
      { label: "auth_wb_funnel_daily", value: "Воронка Джем: viewCount, buyouts, cancels (Puppeteer). 90 дней" },
      { label: "buyer_entry_points", value: "Портрет покупателя: nm_id + start/end_date + total/entryPoints JSON" },
      { label: "sync_log", value: "Журнал синхронизации: тип, время, успех/ошибки, длительность" },
      { label: "products (29)", value: "Карточки: цены, рейтинг, цвета" },
      { label: "stocks", value: "Остатки по складам (полная перезапись)" },
      { label: "search_cluster_stats", value: "Поисковые кластеры (weekly snapshot)" },
      { label: "search_cluster_bids", value: "Ставки по кластерам" },
      { label: "balance_history", value: "Баланс кабинета" },
      { label: "campaign_budgets", value: "Бюджеты кампаний" },
      { label: "settings", value: "Настройки (12 key-value)" },
      { label: "accounts", value: "Авторизованные телефоны" },
      { label: "Пустые/будущие", value: "positions, competitors, competitor_positions, automation_rules/log, expense/payment_history, product_promotions, minus_phrases, bid_history" },
    ],
  },
  {
    id: "browser",
    title: "Puppeteer-браузер",
    items: [
      { label: "Профиль", value: "data/chrome-profile/ — персистентный. Сессия WB сохраняется между перезапусками" },
      { label: "Автозапуск", value: "ensureBrowser() — если не запущен, автоматически стартует при синке" },
      { label: "Анти-детект", value: "navigator.webdriver=false + disable-blink-features=AutomationControlled" },
      { label: "CDP сниффер", value: "ОТКЛЮЧЁН — не нужен для синка. page.evaluate(fetch) работает без него" },
      { label: "Авторизация", value: "Токен Authorizev3 из localStorage['wb-eu-passport-v2.access-token']. Долгоживущий JWT" },
      { label: "Закрытие", value: "browser.on('disconnected') сбрасывает state. При следующем синке — автоматический перезапуск" },
    ],
  },
  {
    id: "djem",
    title: "Воронка Джем — закрытый API",
    items: [
      { label: "Сервер", value: "seller-content.wildberries.ru" },
      { label: "Путь", value: "/ns/analytics-api/content-analytics/api/v1/sales-funnel" },
      { label: "Endpoint", value: "POST /report/product/history — воронка по дням для одного товара" },
      { label: "Другие endpoints", value: "/report, /report/details, /seasonality, /seller/comparisons/market" },
      { label: "Авторизация", value: "Authorizev3 + credentials:include. wb-seller-lk НЕ нужен" },
      { label: "Параллельность", value: "3 товара одновременно (Promise.all в page.evaluate), 1 сек между чанками" },
      { label: "Решение найдено", value: "Реверс-инжиниринг EVIRMA 2 (Chrome Web Store, ID: deonmlokidjdcbcihdjdoebmihbmnfdc)" },
    ],
  },
  {
    id: "detail-panel",
    title: "Нижняя панель (DetailPanel)",
    items: [
      { label: "Вкладки (5)", value: "Воронка продаж, Портрет покупателя, Остатки (заглушка), Каталоги (заглушка), Запросы (заглушка)" },
      { label: "Портрет покупателя", value: "3 подвкладки: WB (источники трафика), Тип трафика (по группам), Точки входа (детализация)" },
      { label: "Группы трафика (5)", value: "Полки (оранж), Поиск (жёлт), Каталог (синий), По ссылке (красн), Прочее (серый)" },
      { label: "Столбцов", value: "28 + пустой финальный. Drag-n-drop, resize, hide (шестерёнка)" },
      { label: "Данные", value: "До 90 дней. Сегодня всегда в списке. Выделение строки кликом" },
      { label: "Время обновления", value: "'X мин. назад' рядом с табами" },
      { label: "Весь магазин", value: "Галочка -> nmId=all -> агрегация. adClickToCart из direct carts" },
      { label: "Клики рекл.", value: "Формат: 259 x 4.3 руб (кол-во x CPC)" },
      { label: "Корзины/Заказы рекл.", value: "Формат: 1207+154 (прямые + assocIN). Тултип с детализацией" },
      { label: "+Корзины / +Заказы", value: "assocOUT: +216 / +71. Тултип с детализацией по товарам" },
      { label: "xP формула", value: "adSpend / campaign_daily.atbs (direct+assocOUT, без assocIN)" },
    ],
  },
  {
    id: "upper-cols",
    title: "Столбцы верхней таблицы (14)",
    items: [
      { label: "Товар (sticky)", value: "Фото + название + nmId + vendorCode. Сортировка по артикулу" },
      { label: "Предмет", value: "Категория товара (subject)" },
      { label: "Цвета", value: "Перечисление цветов" },
      { label: "Акции", value: "Название акции, если товар участвует" },
      { label: "★ Рейтинг", value: "Рейтинг товара (из sales-funnel/products feedbackRating)" },
      { label: "Цена", value: "Цена поставки (price * (100-discount) / 100)" },
      { label: "Остаток", value: "Остаток всего, шт. (SUM из stocks)" },
      { label: "Воронка (глаз+корзина+коробка)", value: "Показы (viewCount, Джем) + Корзины + Заказы шт. + Сумма заказов руб. Гибрид MAX" },
      { label: "ДРРз", value: "Доля рекламных расходов: adSpend / ordersSum * 100%" },
      { label: "Затраты рекл.", value: "Расход на рекламу (из campaign_stats_daily.sum)" },
      { label: "Авто", value: "Автокампании: ставка + статус (зелёный play/красный pause) + затраты + бюджет" },
      { label: "Аукцион", value: "Поисковые кампании (по 'ПОИСК' в названии). Ставка + статус + затраты" },
      { label: "CPC", value: "Кампании с payment_type=cpc" },
      { label: "Видимость", value: "Кол-во поисковых кластеров (из search_cluster_stats, weekly snapshot)" },
    ],
  },
  {
    id: "lower-cols",
    title: "Столбцы нижней таблицы (28)",
    items: [
      { label: "Дата", value: "Дата по Мск. Сегодня подсвечивается акцентом" },
      { label: "Коробка общ.", value: "Общее кол-во заказов, шт. (гибрид MAX open/djem)" },
      { label: "Глаз *общ.", value: "Показы карточки в выдаче (viewCount, только Джем). * = закрытый API" },
      { label: "CTR*", value: "Показы → Переходы %. (openCard / viewCount * 100)" },
      { label: "Клик общ.", value: "Общее кол-во переходов в карточку (openCardCount)" },
      { label: "Корзина %", value: "Переходы → Корзины %. (addToCart / openCard * 100)" },
      { label: "Корзина общ.", value: "Общее кол-во добавлений в корзину" },
      { label: "Коробка %", value: "Корзины → Заказы %. (orders / addToCart * 100)" },
      { label: "Ср. цена", value: "Средняя цена: ordersSum / ordersCount" },
      { label: "ДРРз", value: "adSpend / ordersSum * 100%" },
      { label: "Счет", value: "Расход на рекламу, руб." },
      { label: "Сум. заказы", value: "Сумма заказов по ценам поставки, руб." },
      { label: "Глаз рекл.", value: "Показы рекламы (adViews)" },
      { label: "CTR", value: "Рекламный CTR: adClicks / adViews * 100%" },
      { label: "Клик рекл.", value: "Клики с рекламы x CPC. Формат: 259 x 4.3 руб." },
      { label: "Клик→Корзина", value: "Конверсия рекл. кликов в корзины. Одиночный: adCarts/adClicks. Магазин: directCarts/adClicks" },
      { label: "CPM", value: "Цена 1000 рекл. показов: adSpend / adViews * 1000" },
      { label: "Корзина рекл.", value: "Прямые + ассоц.IN корзины. Формат: 1207+154. Тултип с детализацией" },
      { label: "Корзина xP", value: "Себестоимость корзины: adSpend / campaign_daily.atbs" },
      { label: "Коробка рекл.", value: "Прямые + ассоц.IN заказы. Формат: 240+38. Тултип с детализацией" },
      { label: "Коробка xP", value: "Себестоимость заказа: adSpend / campaign_daily.orders" },
      { label: "+Корзина", value: "Ассоц. OUT корзины: сколько ДРУГИЕ товары получили от рекламы ЭТОГО" },
      { label: "+Коробка", value: "Ассоц. OUT заказы: аналогично" },
      { label: "Куп", value: "Выкуплено заказов, шт." },
      { label: "Отм", value: "Отменено заказов, шт." },
      { label: "~?~", value: "В пути: orders - buyouts - cancels" },
      { label: "% вык", value: "Процент выкупа" },
    ],
  },
  {
    id: "decisions",
    title: "Ключевые решения",
    items: [
      { label: "Воронка", value: "Гибрид: MAX(open, djem) поштучно по товарам, потом SUM" },
      { label: "Funnel sync", value: "Все товары из products, не только из активных кампаний" },
      { label: "adClickToCart", value: "Одиночный: adCarts/adClicks. Весь магазин: direct_carts(by_nm)/adClicks" },
      { label: "xP (себестоимость)", value: "campaign_stats_daily.atbs/.orders — включает direct + assocOUT" },
      { label: "Паузированные", value: "Stats sync включает status 9+11 — fullstats отдаёт данные" },
      { label: "Период Сегодня/Вчера", value: "offset=0/1. localDateStr (Москва). Каждый день — отдельно" },
      { label: "Кластеры", value: "Weekly snapshot по MAX(date), не фильтруются по периоду" },
      { label: "campaigns.type", value: "Всегда NULL — определяется по имени: АВТО->auto, ПОИСК->search" },
      { label: "Числа без пробелов", value: "В нижней таблице числовые значения без разделителя тысяч. Рублёвые — с пробелом" },
      { label: "Пауза красная", value: "StatusBadge пауза — красный цвет иконки (var(--danger))" },
    ],
  },
  {
    id: "store",
    title: "Данные магазина",
    items: [
      { label: "Бренд", value: "IMSI" },
      { label: "Магазин", value: "IMSI Каталог" },
      { label: "Supplier ID", value: "262998 (auth) / 1166225 (API key oid)" },
      { label: "Телефон", value: "79992787246" },
      { label: "Товаров", value: "29 карточек" },
      { label: "Кампании", value: "6 активных + 18 на паузе + 308 завершённых" },
    ],
  },
];

export default function KnowledgeBase({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["architecture", "djem"]));

  if (!open) return null;

  function toggleSection(id: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setExpandedSections(new Set(SECTIONS.map((s) => s.id)));
  }

  function collapseAll() {
    setExpandedSections(new Set());
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-8 pb-8" onClick={onClose}>
      <div
        className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl w-[720px] max-h-[calc(100vh-4rem)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-2">
            <svg className="w-4.5 h-4.5 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
            </svg>
            <h2 className="text-sm font-semibold text-[var(--text)]">База знаний</h2>
            <span className="text-[10px] text-[var(--text-muted)]">{SECTIONS.length} разделов</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={expandAll} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
              Развернуть все
            </button>
            <span className="text-[var(--border)]">|</span>
            <button onClick={collapseAll} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
              Свернуть
            </button>
            <button
              onClick={onClose}
              className="ml-2 p-1 rounded-lg hover:bg-[var(--bg-card-hover)] transition-colors text-[var(--text-muted)]"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-1">
          {SECTIONS.map((section) => {
            const isExpanded = expandedSections.has(section.id);
            return (
              <div key={section.id} className="border border-[var(--border)] rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleSection(section.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-card-hover)] transition-colors"
                >
                  <svg
                    className={`w-3 h-3 text-[var(--text-muted)] transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                  <span className="text-xs font-medium text-[var(--text)]">{section.title}</span>
                  <span className="text-[10px] text-[var(--text-muted)] ml-auto">{section.items.length}</span>
                </button>
                {isExpanded && (
                  <div className="border-t border-[var(--border)]">
                    <table className="w-full text-xs">
                      <tbody>
                        {section.items.map((item, i) => (
                          <tr key={i} className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--bg-card-hover)] transition-colors">
                            <td className="px-3 py-1.5 text-[var(--accent)] font-mono whitespace-nowrap align-top w-[200px]">
                              {item.label}
                            </td>
                            <td className="px-3 py-1.5 text-[var(--text-muted)]">
                              {item.value}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
