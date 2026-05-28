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
      { label: "Порт", value: "3001" },
      { label: "БД", value: "data/ads.db — 50 таблиц" },
      { label: "Фронтенд", value: "Одностраничник: табы Карточки / Реклама / Настройки (Выдача WB — disabled)" },
      { label: "Верхняя Карточки", value: "14 столбцов товаров: drag, resize, hide. Настройки в БД" },
      { label: "Верхняя Реклама", value: "16 столбцов кампаний (Товар/Камп/Зоны/Ставка-Бюджет/Показы/Клики/Заказы/Воронка/Доля затрат/CTR/Затраты/День/Конверсии/Корз-Заказы/ДРРк-Выручка/Счёт-Опл). Шестерёнка для скрытия, drag/resize" },
      { label: "Нижняя Карточки", value: "SplitPane: карточка товара + 5 вкладок. 31 столбец по дням (до 90 дней), стартовая высота под 11 последних дней. Drag, resize, hide" },
      { label: "Нижняя Реклама", value: "SplitPane fitParent: карточка кампании + 2 вкладки («По дням» 16 кол. + «Запросы» 20 кол. + master-checkbox)" },
      { label: "Темы", value: "3 варианта: Violet (default), Arctic, Neon — через data-theme в globals.css" },
      { label: "Настройки в БД", value: "Хранятся в settings (key/value): theme, periods/tabs/columns, auto/test-auto intervals, deep_sync_date, mpstats token, caps ставок max_bid_manual_auction_rub/max_bid_uni_rub/max_bid_cpc_rub и др." },
      { label: "Иконки (9)", value: "SVG line-style: EyeIcon, CartIcon, BoxIcon, ClickIcon (рука), CheckCircleIcon, PlayIcon, PauseIcon, ArrowRightIcon, PencilIcon" },
      { label: "Часовой пояс", value: "Все даты через localDateStr() (Москва), НЕ UTC toISOString()" },
      { label: "Период 'Вчера'", value: "offset=1, days=1 → dateTo=вчера, dateFrom=вчера. Только один день" },
      { label: "Git", value: "GitHub: imaxprom/wb-ads. Ветка main" },
      { label: "Контекст", value: "SESSION_STATE.md (быстрый старт, обновляется npm run save-session-state) + PROJECT_CONTEXT.md + TODO.md + CLAUDE.md + KnowledgeBase (этот файл) + ~/.codex/memories/" },
    ],
  },
  {
    id: "sync",
    title: "Синхронизация",
    items: [
      { label: "Модалка синка", value: "3 группы: открытый API (API_STEPS), cmp (CMP_STEPS) и seller-content (SELLER_STEPS). cmp+seller параллельны (разные Puppeteer-вкладки), open-API последовательно" },
      { label: "Ретрай auto-sync", value: "До 5 попыток на ошибочный шаг с паузой 30с (raised от 3). Только фейлы повторяются. Поле retries пишется в sync_log.error_details" },
      { label: "Авто-синк интервал", value: "Таймер настраивается из UI 5-60 мин. Все шаги последовательно (open API), потом параллельно cmp + seller. Можно отменить через /api/sync/cancel (флаг __syncCancelled)" },
      { label: "Test-auto", value: "Отдельное расписание автотеста: endpoints/паузы берёт из модалки «Тест», но v3-daily запускает в smart-режиме дат. Ручной тест использует days буквально. Интервал поддерживает 20 мин. Итоговые OK/429/errors считаются из timeline request-events; top-level error дочернего endpoint считается ошибкой. Падение до первого WB-запроса пишется как phase_error и в UI видно как «нет запросов»" },
      { label: "v3-daily smart", value: "Сегодня тянется каждый запуск. Вчера — после 09:00 МСК до первого успешного закрытия. При 429/ошибке по вчера сохраняется cursor advert_id, следующий smart/yesterday стартует с него; backoff 20 мин не ждём" },
      { label: "Глубокий синк", value: "Каждый день после 9:00 — days=3 вместо days=1 (вчера+позавчера). Дата в deep_sync_date" },
      { label: "Логирование", value: "Каждый прогон пишется в sync_log (тип, время, errors, длительность, retries). Иконки журналов в ControlPanel краснеют только при новой непросмотренной ошибке за последние 24 часа; просмотренный error-id хранится в settings. Поздний успешный прогон сам не гасит непросмотренную ошибку" },
      { label: "Отдельные расписания", value: "search-texts-all 06:00 МСК, buyout-percent 06:30 МСК, phrase-djem-daily каждые 60 мин (heal по active nmIds), session-check 22:00 МСК" },
      { label: "/api/sync/campaigns", value: "Кампании + ставки → advert-api /api/advert/v2/adverts. nms_json, bid_kopecks, status. Last-known-good: если status 9/11 вернул пустой nm_settings, сохраняем прежние nms_json/subject_id/bid_kopecks и отдаём warning" },
      { label: "/api/sync/products", value: "Карточки + цены + рейтинг → Content + Prices + sales-funnel API" },
      { label: "/api/sync/stocks", value: "Остатки → Statistics API (полная перезапись)" },
      { label: "/api/sync/supplier-orders?days=N", value: "Заказы WB Statistics API /api/v1/supplier/orders → supplier_orders. Источник СПП в Карточки → Воронка продаж. Auto-sync и ручной SyncModal тянут последние 3 дня; первичная загрузка поддерживает days=90 с автодогрузкой чанков" },
      { label: "/api/sync/stats", value: "Дневная статистика → /adv/v3/fullstats GET. apps[].nms[] → direct vs associated. Иногда 429/502 от WB — retry на уровне auto-sync" },
      { label: "/api/sync/balance", value: "Баланс + бюджеты → advert-api /adv/v1/balance + /budget?id=X для active+paused кампаний (status 9/11), архив не трогаем" },
      { label: "/api/sync/expense-history", value: "Списания WB по кампаниям → /adv/v1/upd за 7 дней. Full-refresh окна (DELETE+INSERT в транзакции). Заполняет paidPeriod в AdsCampaign" },
      { label: "/api/sync/clusters", value: "Поисковые кластеры (старое) → normquery v0 stats + get-bids" },
      { label: "/api/sync/normquery-bids", value: "Per-phrase bids → /adv/v0/normquery/get-bids. body snake_case" },
      { label: "/api/sync/normquery-stats?days=N", value: "Per-phrase stats → /adv/v0/normquery/stats. body snake_case с from/to" },
      { label: "/api/sync/preset-info-open", value: "Гибрид open API: list (camelCase!) + get-bids + stats → campaign_preset_keywords. Без Puppeteer. Идёт ПЕРЕД closed" },
      { label: "/api/sync/preset-info", value: "Closed cmp /api/v1/advert/{id}/preset-info через Puppeteer cmp-tab. Дополняет open: views=0 фразы + shks. Default 7 дней" },
      { label: "/api/sync/supplier-subjects", value: "cmp /v6/supplier-subjects ×2 (bid_type=2 manual + bid_type=1 unified). Заполняет subject_min_cpm. Кэш 24ч" },
      { label: "/api/sync/funnel?days=N", value: "Воронка открытая → seller-analytics. Все товары из products (не только активные)" },
      { label: "/api/sync/auth-wb-funnel?days=N", value: "Воронка Джем (viewCount) → seller-content через Puppeteer. 3 параллельно, 1 сек пауза" },
      { label: "/api/sync/buyer-profile?days=N", value: "Портрет покупателя → seller-content. days=1: 3 парал./1сек, days>1: 2 парал./3сек" },
      { label: "/api/sync/search-texts-all", value: "Snapshot WB premium частотности по всем subject_id активных кампаний. Через Puppeteer seller-tab. 06:00 МСК + ручной" },
      { label: "/api/sync/buyout-percent", value: "% выкупа артикула за 30 дней → products.buyout_percent_30d. 06:30 МСК" },
      { label: "/api/sync/phrase-djem-daily?nmId=X&mode=auto|today", value: "Heal-стратегия дневной разбивки Джема (90 дней). 60 мин тик по active nmIds. /v2/search-report/product/search-texts с per-day periodCurrent" },
      { label: "/api/sync/phrase-djem-stats?nmId=X", value: "Агрегат Джема за 90 дней per phrase (orders/cart/openCard 3 запроса с topOrderBy). Кэш 1ч" },
      { label: "/api/sync/phrase-positions-batch", value: "SSH wb-parser batch positions для одной кампании+nmId. Автообновление позиций сначала бьёт batch, затем ретраит одиночным endpoint только фейлы. Возвращает promo_pos/organic_pos/preset_id/tokens" },
      { label: "/api/sync/mpstats-clusters", value: "MPSTATS /api/seo/keywords/cluster → UPSERT в manual_clusters. source='mpstats', preset_id+mpstats_preset_id заполнены" },
      { label: "/api/clusters/scan-campaign", value: "Авто-кластеризация: scan фраз через wb-parser SSH → group by real preset_id → restructure manual_clusters. Кнопка ↻ в Запросах" },
      { label: "fullstat-v3 в test-auto", value: "xlsx через cmp /api/v3/fullstat — не в основном SYNC_STEPS. Гоняется отдельным test-auto; v3-daily там работает через smart-даты против лишнего запроса вчера. Внутренние вызовы только через WB_ADS_INTERNAL_BASE_URL или 127.0.0.1:3001, не localhost" },
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
    title: "WB API серверы (9)",
    items: [
      { label: "advert-api.wildberries.ru", value: "Open API: кампании, fullstats v3, баланс, бюджеты, normquery (list/get-bids/stats/set-minus/bids/preset-minus), upd (списания), PATCH /api/advert/v1/bids (новая смена ставки)" },
      { label: "cmp.wildberries.ru", value: "Closed API через Puppeteer cmp-вкладку: /v1/advert/{id}/preset-info (фразы), /v6/supplier-subjects (мин. CPM), /v3/fullstat (xlsx), /v1/advert/{id}/preset/minus" },
      { label: "seller-analytics-api.wildberries.ru", value: "Воронка открытая (sales-funnel/products), рейтинг" },
      { label: "seller-content.wildberries.ru", value: "Через Puppeteer seller-вкладку: воронка Джем (sales-funnel/report/product/history), портрет (customer-profile/entry-points), премиум-частотность (search-analysis/premium/search-texts), Джем search-texts (v2/search-report/product/search-texts)" },
      { label: "content-api.wildberries.ru", value: "Карточки товаров (Content API v2)" },
      { label: "discounts-prices-api.wildberries.ru", value: "Цены (Prices API v2)" },
      { label: "statistics-api.wildberries.ru", value: "Остатки (Statistics API v1). Обновляются раз в 30 мин" },
      { label: "dp-calendar-api.wildberries.ru", value: "Акции/промо (Calendar API)" },
      { label: "search.wb.ru", value: "Публичная выдача через RU-сервер SSH (proxy_positions.py) — позиции товара + preset_id (Meta-2). Mac-IP блокируется" },
    ],
  },
  {
    id: "tables",
    title: "Таблицы БД (50 таблиц)",
    items: [
      { label: "campaigns (336)", value: "Рекламные кампании. status (9 active / 11 paused / 7 archive). bid_type (manual/unified). placements_json. nms_json. bid_kopecks. type=NULL — определяется по имени" },
      { label: "campaign_stats_daily", value: "Статистика по дням per advert. Основной источник adSpend/xP. Источник /adv/v3/fullstats" },
      { label: "campaign_stats_by_nm", value: "Статистика по товарам per (advert, nm_id, date). views>0 = direct, иначе associated" },
      { label: "campaign_days", value: "Per-day зоны (views_search/catalog/reco) из xlsx по именам листов: ключевые фразы / каталог / рекомендации. Источник зон в /api/ads" },
      { label: "campaign_zones_daily", value: "Deprecated. Существует, не пишется. Оставлена для исторических данных до 19 апр 2026" },
      { label: "campaign_keywords", value: "xlsx Sheet2: фразы+date+views/clicks/spend per advert" },
      { label: "campaign_catalogs", value: "xlsx лист каталога: каталоги (категории) per advert. Лист Рекомендации сюда не пишется" },
      { label: "campaign_nm_daily", value: "xlsx Sheet1 per-day: avg_position per (advert, nm_id, date)" },
      { label: "campaign_keyword_bids", value: "Per-phrase ставки CPM из /adv/v0/normquery/get-bids" },
      { label: "campaign_keyword_stats_daily", value: "Per-phrase per-day stats из /adv/v0/normquery/stats: avg_pos/views/clicks/atbs/orders/ctr/cpc/cpm" },
      { label: "campaign_phrase_positions", value: "SSH-парсер: ad_pos, organic_pos, boost, preset_id per (advert, nm_id, norm_query)" },
      { label: "campaign_preset_keywords", value: "Полный срез фраз per (advert, nm_id, name). is_excluded, views/clicks/baskets/orders/shks, ctr/cpc/cpm/avg_pos/spend, actual_cpm (копейки), currency, from_date/to_date. Источники: cmp /preset-info + open API list/get-bids/stats (UPSERT MAX)" },
      { label: "campaign_budgets", value: "Бюджеты кампаний (advert_id, cash, total, updated_at)" },
      { label: "balance_history", value: "Баланс кабинета (history insert per /api/sync/balance)" },
      { label: "expense_history", value: "Списания WB по кампаниям из /adv/v1/upd. PK (advert_id, date, amount). Используется в paidPeriod" },
      { label: "payment_history", value: "Старая таблица пополнений (до дек 2025). Не синкается" },
      { label: "bid_changes_log", value: "Журнал смен ставок и пополнений бюджета. Поля advert_id, at, our_status, requested_kopecks, final_kopecks, wb_status. Used для тултипов истории на ставке/бюджете" },
      { label: "bid_history", value: "Старый журнал ставок (рудимент)" },
      { label: "subject_min_cpm", value: "Мин. CPM по предмету: min_cpm_search (manual fallback), min_cpm_unified (Uni clamp), min_cpm_recom, min_cpm. cmp /v6/supplier-subjects ×2 запроса" },
      { label: "search_cluster_stats", value: "Поисковые кластеры (weekly snapshot)" },
      { label: "search_cluster_bids", value: "Ставки по кластерам" },
      { label: "search_texts_wb", value: "WB premium snapshot частотности (premium/search-texts). PK (phrase_lc, snapshot_date). 06:00 МСК" },
      { label: "search_phrase_meta", value: "Глобальная phrase-centric: фактический preset_id + tokens из search.wb.ru (Meta-2). PK phrase. Заполняется wb-parser SSH" },
      { label: "search_meta_log", value: "Журнал per-scan сверки expected vs actual preset_id" },
      { label: "position_sync_log", value: "Журнал проверок позиций для отладки (status: ok / no_ad / both_none / ssh_error / parser_error)" },
      { label: "manual_clusters", value: "Ручная база кластеров. (id, name UNIQUE, phrases_json, source='manual'|'mpstats', mpstats_preset_id, preset_id (UNIQUE INDEX), imported_at, timestamps). С 26 апр 2026 preset_id — основное поле, mpstats_preset_id — метка происхождения" },
      { label: "phrase_djem_stats", value: "Агрегат Джема за 90 дней (PK nm_id, phrase). view_count переиспользована под frequency" },
      { label: "phrase_djem_stats_daily", value: "Дневная разбивка Джема (PK nm_id, phrase, date). frequency, open_card_count, add_to_cart_count, order_count, avg_position. Heal-тик каждые 60 мин" },
      { label: "sales_funnel_daily", value: "Воронка открытая: все товары из products (не только активные)" },
      { label: "auth_wb_funnel_daily", value: "Воронка Джем: viewCount, buyouts, cancels (Puppeteer). 90 дней" },
      { label: "buyer_entry_points", value: "Портрет покупателя: nm_id + start/end_date + total/entryPoints JSON" },
      { label: "products (30)", value: "Карточки: цены, рейтинг, цвета, buyout_percent_30d" },
      { label: "stocks", value: "Остатки по складам (полная перезапись)" },
      { label: "product_promotions", value: "Акции (Calendar API)" },
      { label: "settings", value: "Настройки (key/value)" },
      { label: "accounts", value: "Авторизованные телефоны + connection status" },
      { label: "sync_log", value: "Журнал синхронизации: тип, время, errors, длительность, retries" },
      { label: "sync_test_log", value: "Журнал Test-panel запусков (отдельный лог). Totals считаются из timeline_json, чтобы не получать ложное OK 0 при раннем падении endpoint" },
      { label: "security_audit_log", value: "Audit mutating endpoints. Сейчас preset-minus пишет accepted/success/failed/blocked с operation, cascade summary и attempts summary" },
      { label: "Пустые/будущие", value: "positions, competitors, competitor_positions, automation_rules/log, minus_phrases" },
    ],
  },
  {
    id: "browser",
    title: "Puppeteer-браузер",
    items: [
      { label: "Профиль", value: "data/chrome-profile/ — персистентный. Сессия WB сохраняется между перезапусками" },
      { label: "2 вкладки", value: "__wbSniffPage (seller.wildberries.ru — Джем, портрет, premium-частотность) + __wbSniffCmpPage (cmp.wildberries.ru — preset-info, supplier-subjects, fullstat-v3). Разные tab'ы чтобы не конфликтовали при auto-sync" },
      { label: "Автозапуск", value: "ensureBrowser() / ensureCmpPage() — если не запущен, стартует при синке. startSniffer idempotent: если браузер уже есть, возвращает ok" },
      { label: "Reconnect", value: "При потере globalThis после restart/hot reload startSniffer читает data/chrome-profile/DevToolsActivePort и подключается к уже открытому Chrome for Testing вместо ошибки про занятый профиль" },
      { label: "Анти-детект", value: "navigator.webdriver=false + disable-blink-features=AutomationControlled" },
      { label: "CDP сниффер", value: "ОТКЛЮЧЁН — не нужен для синка. page.evaluate(fetch) работает без него" },
      { label: "Auth seller", value: "Authorizev3 из localStorage['wb-eu-passport-v2.access-token']. Долгоживущий JWT" },
      { label: "Auth cmp", value: "Authorizev3 из localStorage['access-token'] (другое имя в cmp-вкладке)" },
      { label: "wb-tokens.json", value: "data/wb-tokens.json — старый sniffer-state. НЕ re-seedить при рестарте если профиль есть (иначе выкидывает живую сессию)" },
      { label: "Закрытие", value: "browser.on('disconnected') сбрасывает state. При следующем синке — автоматический перезапуск" },
      { label: "Phone-auth токены", value: "Живут ~5 минут (refresh). Для seller — длинная сессия в chrome-profile" },
    ],
  },
  {
    id: "djem",
    title: "Воронка Джем — закрытый API",
    items: [
      { label: "Сервер", value: "seller-content.wildberries.ru" },
      { label: "Путь воронки", value: "/ns/analytics-api/content-analytics/api/v1/sales-funnel" },
      { label: "Endpoint воронки", value: "POST /report/product/history — воронка по дням для одного товара (заполняет auth_wb_funnel_daily)" },
      { label: "Другие endpoints", value: "/report, /report/details, /seasonality, /seller/comparisons/market" },
      { label: "Customer profile", value: "POST /v2/customer-profile/entry-points — портрет покупателя (точки входа). Заполняет buyer_entry_points" },
      { label: "Search-texts (per-phrase)", value: "POST /v2/search-report/product/search-texts — Джем per-nmId воронка фразы. 3 запроса с topOrderBy=orders|addToCart|openCard, мёрж по text. limit 100. prevPeriod ОБЯЗАТЕЛЕН" },
      { label: "Premium частотность", value: "POST /v1/search-analysis/premium/search-texts — частотность WB-поиска snapshot. 06:00 МСК, заполняет search_texts_wb. Premium-подписка обязательна" },
      { label: "Авторизация", value: "Authorizev3 (JWT из localStorage 'wb-eu-passport-v2.access-token') + credentials:include. wb-seller-lk НЕ нужен" },
      { label: "Параллельность", value: "Воронка: 3 товара одновременно (Promise.all в page.evaluate), 1 сек между чанками. Customer profile: 3 парал./1сек (days=1) или 2/3сек (days>1)" },
      { label: "Heal Джема daily", value: "scheduleDjemDaily в auto-sync — каждые 60 мин по active nmIds (status IN 9,11). Закрывает дыры в phrase_djem_stats_daily. Pass 2 через 5с. yesterday-refresh после 09:00 МСК" },
      { label: "Решение найдено", value: "Реверс-инжиниринг EVIRMA 2 (Chrome Web Store, ID: deonmlokidjdcbcihdjdoebmihbmnfdc)" },
    ],
  },
  {
    id: "detail-panel",
    title: "Нижняя панель Карточек (DetailPanel)",
    items: [
      { label: "Вкладки (5)", value: "Воронка продаж (enabled), Портрет покупателя (enabled), Остатки (disabled), Каталоги (disabled), Запросы (disabled — на странице товара. На странице рекламы Запросы реализованы — см. AdCampaignDetailPanel)" },
      { label: "Портрет покупателя", value: "3 подвкладки: WB (источники трафика), Тип трафика (по группам), Точки входа (детализация)" },
      { label: "Группы трафика", value: "Поиск, Полки, Каталог, По ссылке, Прочее. Фиксированный порядок" },
      { label: "Столбцов", value: "31 (см. раздел «Столбцы нижней таблицы»). Drag-n-drop, resize, hide (шестерёнка). Мердж сохранённого detail_col_order: новые ключи на дефолтную позицию" },
      { label: "Данные", value: "До 90 дней. Сегодня всегда в списке. Выделение строки кликом" },
      { label: "Время обновления", value: "'X мин. назад' рядом с табами" },
      { label: "Весь магазин", value: "Галочка → nmId=all → агрегация. adClickToCart из direct carts (by_nm)" },
      { label: "Клики рекл.", value: "Формат: 259 × 4.3 ₽ (кол-во × CPC)" },
      { label: "Корзины/Заказы рекл.", value: "Формат: 1207+154 (прямые + assocIN). Тултип с детализацией по nm_id" },
      { label: "+Корзины / +Заказы", value: "assocOUT: +216 / +71. Тултип с детализацией по товарам" },
      { label: "xP формула", value: "adSpend / campaign_stats_daily.atbs или .orders (direct + assocOUT, без assocIN)" },
    ],
  },
  {
    id: "ad-detail-panel",
    title: "Нижняя панель Рекламы (AdCampaignDetailPanel)",
    items: [
      { label: "Архитектура", value: "SplitPane fitParent: карточка кампании слева + 2 вкладки справа («По дням» / «Запросы»). key={advertId} — full remount при смене кампании. ad_panel_tab сохраняется через settings, переживает remount" },
      { label: "По дням (16 кол.)", value: "Ср.поз, Все/Поиск/Полки/Кат. (зоны), CTR, Клики×CPC, CPM, Счёт, Корзины (own+assoc), Заказы (own+assoc), ДРРк, Выручка. Summary сверху. Всегда грузит 90 дней независимо от верхнего фильтра" },
      { label: "Запросы (20 кол. + master-checkbox)", value: "Позиция, Буст, 🔍×₽ (ставка), Ср.поз, Кластер, ~👁 (Частота WB), Доля, 👁, CTR, 👆 Клики, Р/клик, Счёт, CPM, 🔍/нед, ⚡, 🛒, 📦, 🛒×₽, 📦×₽, Джем, Meta, Meta 2" },
      { label: "DateSidebar", value: "90 дней слева. single-click = день, dblclick+dblclick = range. Выходные оранжевые" },
      { label: "Фильтры", value: "5 кнопок: Наша ставка (default для manual) / Управляемые (default для Uni) / Активные / Исключения / Все. У Uni «Наша ставка» скрыта" },
      { label: "Tree-view кластеров", value: "parent ▸ child. У child скрыты Позиция/Буст/Ставка/Ср.поз. Bucketing children: только если parent проходит текущий тип-фильтр; при раскрытии parent показываются все его children, даже если фильтр матчился по одному" },
      { label: "Стили", value: "Excluded: ⊘ маркер, opacity-50, БЕЗ line-through. Unknown: ? маркер, opacity-50. Common (управляемые): белый. Excluded children НЕ наследуют стиль parent'а" },
      { label: "DblClick", value: "По excluded-фразе из любой не-«Исключения» вкладки → переключение фильтра + scrollIntoView + 2.5с highlight. Если child — раскрывает parent" },
      { label: "ПКМ меню", value: "Исключить запрос / Вернуть из исключений. Кластерное шлёт cascadeByPreset/cascadePresetId; сервер расширяет parent до aliases того же preset_id" },
      { label: "Batch", value: "Чекбоксы у top-level + master в шапке. Toolbar при ≥1 выделенной: массовое исключение/возврат" },
      { label: "Кнопка ↻", value: "Сканировать все фразы (см. раздел Авто-кластеризация). Прогресс <scanned>/<total>. Поллинг GET. Re-attach на mount" },
      { label: "Доля", value: "Доля купленных рекламных показов в общей частотности фразы: рекламные показы / ~👁 × 100. Значение не обрезается до 100%, потому что источники обновляются несинхронно" },
      { label: "Авто-скан позиций", value: "При открытии активной manual-кампании автооткрывается «Запросы → Наша ставка» и обновляются has_custom_bid фразы. При открытии активной Uni автооткрывается «Запросы → Управляемые» и обновляются common-фразы. Сначала batch SSH, затем single с 5 попытками только для фейлов; если позиция так и не найдена — остаются прочерки" },
      { label: "pendingExcluded/Bid", value: "Map → оптимистичный UI. Снимается через useEffect когда qKeywords подтвердили серверное состояние" },
    ],
  },
  {
    id: "upper-cols",
    title: "Столбцы верхней таблицы (14)",
    items: [
      { label: "Товар (sticky)", value: "Фото + название + nmId + vendorCode. Фото строятся через WB basket-кандидаты с offset ±1..±8 и retry cache-buster. Сортировка по артикулу" },
      { label: "Предмет", value: "Категория товара (subject)" },
      { label: "Цвета", value: "Перечисление цветов" },
      { label: "Акции", value: "Название акции, если товар участвует" },
      { label: "★ Рейтинг", value: "Рейтинг товара (из sales-funnel/products feedbackRating)" },
      { label: "Цена", value: "Цена поставки (price * (100-discount) / 100) + строка «СПП N,N %» из supplier_orders за выбранный период/день. Источник СПП синхронен с нижней таблицей" },
      { label: "Остаток", value: "Остаток всего, шт. (SUM из stocks)" },
      { label: "Воронка (глаз+корзина+коробка)", value: "Показы (viewCount, Джем) + Корзины + Заказы шт. + Сумма заказов руб. Гибрид MAX" },
      { label: "ДРРз", value: "Доля рекламных расходов: adSpend / ordersSum * 100%" },
      { label: "Затраты рекл.", value: "Расход на рекламу (из campaign_stats_daily.sum)" },
      { label: "Авто", value: "Автокампании: ставка + статус (зелёный play/красный pause) + затраты + бюджет" },
      { label: "Аукцион", value: "Поисковые кампании (по 'ПОИСК' в названии). Ставка + статус + затраты" },
      { label: "CPC", value: "Кампании с payment_type=cpc. Ставку можно менять через /api/advert/set-cpc-bid, сервер ограничивает max_bid_cpc_rub" },
      { label: "Видимость", value: "Кол-во поисковых кластеров (из search_cluster_stats, weekly snapshot)" },
    ],
  },
  {
    id: "ads-upper-cols",
    title: "Столбцы верхней таблицы Рекламы (16)",
    items: [
      { label: "Товар (sticky)", value: "Фото + название кампании, артикул+предмет, «создана {дата}». Фото используют те же WB basket-кандидаты и version по updated_at" },
      { label: "Камп.", value: "Тип (Аук./Uni/Q/Рек) + advert_id + статус (активна/пауза) + время последнего изменения" },
      { label: "Зоны", value: "Поиск/Каталог/Полки — доли показов по зонам. Источник: campaign_days (views_search/views_catalog/views_reco). «—» если зона неактивна" },
      { label: "Ставка / Бюджет", value: "Текущая ставка ₽ (клик-редактор для Uni/manual) + остаток бюджета ₽ (клик → BudgetDepositModal). Тултипы истории слева" },
      { label: "Показы", value: "Кол-во рекламных показов за период. Снизу серым: лейбл «CPM» и значение (затраты / показы × 1000)" },
      { label: "Клики", value: "Кол-во рекламных кликов за период. Снизу серым две метрики: CTR (клики / показы × 100%) и CPC (затраты / клики, ₽)" },
      { label: "Заказы", value: "Кол-во рекламных заказов за период. Снизу серым: CR (заказы / клики × 100%) и CPO (затраты / заказы, ₽)" },
      { label: "Воронка", value: "Две части: Корзины и Заказы. У каждой сверху % конверсии (клик→корзина / корзина→заказ), снизу серым лейбл и количество в шт" },
      { label: "Доля затрат", value: "DRR % сверху (расход / сумма заказов × 100, цвет: ≤10 зелёный, ≤15 жёлтый, иначе красный). Сейчас сумма заказов берётся из campaign_stats_daily, то есть это общий DRR кампании с ассоциированными заказами. Для DRR только рекламируемого товара нужно считать сумму отдельно из campaign_stats_by_nm по campaigns.nms_json" },
      { label: "CTR", value: "Дублирующая колонка: CTR % сверху, ниже 👁 показы и 👆 клики. Можно скрыть через шестерёнку" },
      { label: "Затраты", value: "Р/клик (CPC) + Σ (общая сумма расхода за период)" },
      { label: "День", value: "Расход на рекламу сегодня и вчера" },
      { label: "Конверсии", value: "🛒 клик→корзина, ✓ корзина→заказ, 📦 клик→заказ. Дублирует «Воронка» — можно скрыть" },
      { label: "Корз. / Заказы", value: "Кол-во корзин × себестоимость корзины (spend/atbs), кол-во заказов × себестоимость заказа (spend/orders)" },
      { label: "ДРРк / Выручка", value: "Дублирует «Доля затрат». ДРРк% + сумма заказов ₽. ## % если расход без заказов" },
      { label: "Счет / Опл.", value: "Всего списано на рекламу + оплачено за период" },
    ],
  },
  {
    id: "lower-cols",
    title: "Столбцы нижней таблицы Карточек (31)",
    items: [
      { label: "Дата", value: "Дата по Мск. Сегодня подсвечивается акцентом" },
      { label: "Заказы (общ.)", value: "Общее кол-во заказанных товаров, шт. (гибрид MAX open/djem)" },
      { label: "Глаз *общ.", value: "Показы карточки в выдаче (viewCount, только Джем). * = закрытый API" },
      { label: "CTR", value: "Конверсия общих показов в переходы. (openCard / viewCount × 100). ~ — слишком мало показов" },
      { label: "Клик общ.", value: "Общее кол-во переходов в карточку (openCardCount)" },
      { label: "Корзина %", value: "Конверсия общих переходов в корзины. (addToCart / openCard × 100)" },
      { label: "Корзина общ.", value: "Общее кол-во товаров в корзину" },
      { label: "Заказы %", value: "Конверсия корзин в заказы. ## — сбой статистики корзин" },
      { label: "Ср. цена", value: "Средняя цена: ordersSum / ordersCount (по ценам поставки)" },
      { label: "СПП", value: "Средняя СПП по заказам WB за день. Источник: statistics-api /api/v1/supplier/orders → supplier_orders. Тултип: 24 строки по часам + средняя СПП по ФО за день; колонки СПП/заказы выровнены, popup подстраивает высоту и оставляет нижний отступ" },
      { label: "ДРРз", value: "adSpend / ordersSum × 100%. # % — расход без заказов. ~ — сильно меньше 0,1%" },
      { label: "CPO (новое 26 апр 2026)", value: "Cost Per Order: adSpend / ordersCount. Без поправки на выкуп. — расхода нет либо нет заказов" },
      { label: "CPS", value: "Cost Per Sale — себестоимость продажи: adSpend / (ordersCount × buyoutPct30/100). С учётом возвратов/отмен" },
      { label: "ДРРп", value: "Полный ДРР с выкупом: adSpend / (ordersSum × buyoutPct30/100) × 100%. buyoutPct30 — синк 06:30 МСК → products.buyout_percent_30d. # % — расход без выкупов" },
      { label: "Счет", value: "Сумма затрат (начислений) на рекламу. ~ — менее 1 руб." },
      { label: "Сум. заказы", value: "Сумма всех заказов покупателями (по ценам поставки, без СПП)" },
      { label: "Глаз рекл.", value: "Показы рекламы (adViews)" },
      { label: "CTR", value: "Рекламный CTR: adClicks / adViews × 100%" },
      { label: "Клик рекл.", value: "Клики с рекламы × CPC. Формат: 259 × 4.3 ₽" },
      { label: "Клик→Корзина", value: "Конверсия рекл. кликов в корзины. Одиночный: adCarts/adClicks. Магазин: direct_carts(by_nm)/adClicks" },
      { label: "CPM", value: "Цена 1000 рекл. показов: adSpend / adViews × 1000" },
      { label: "Корзина рекл.", value: "Прямые + ассоц.IN корзины. Формат: 1207+154. Тултип с детализацией" },
      { label: "Корзина xP", value: "Рекл. себестоимость корзины: adSpend / campaign_stats_daily.atbs (direct + assocOUT)" },
      { label: "Заказы рекл.", value: "Прямые + ассоц.IN заказы. Формат: 240+38. Тултип с детализацией" },
      { label: "Заказы xP", value: "Рекл. себестоимость заказа: adSpend / campaign_stats_daily.orders" },
      { label: "+Корзина", value: "Ассоц. OUT корзины: сколько ДРУГИЕ товары получили от рекламы ЭТОГО" },
      { label: "+Заказы", value: "Ассоц. OUT заказы: аналогично" },
      { label: "Куп", value: "Выкуплено заказов, шт. (из заказанных в этот день)" },
      { label: "Отм", value: "Отменено заказов, шт." },
      { label: "~?~", value: "В пути: orders − buyouts − cancels" },
      { label: "% вык", value: "Процент выкупа. ~?~ — данных недостаточно" },
    ],
  },
  {
    id: "campaign-types",
    title: "Типы рекламных кампаний",
    items: [
      { label: "Классификация", value: "campaignTypeLabel в AdsCampaignsTable.tsx по bidType + placements" },
      { label: "Аук. (manual)", value: "bidType='manual' → ручной аукцион. Ставки ставятся per-фраза через /adv/v0/normquery/bids (рубли, лимит 29999₽)" },
      { label: "Uni (unified)", value: "placements.search && placements.recommendations && bidType≠'manual' → объединённый аукцион. WB сам распределяет показы по кластерам. Единая ставка кампании через PATCH /api/advert/v1/bids (bid_kopecks, placement='combined')" },
      { label: "Q (search-only)", value: "placements.search only → аукцион Поиск" },
      { label: "Рек (reco-only)", value: "placements.recommendations only → аукцион Рекомендации" },
      { label: "UX-разница для Uni", value: "В «Запросах» кнопка «Наша ставка» скрыта (у Uni нет ручных per-phrase ставок). Default фильтр — «Управляемые». В верхней таблице ставка редактируется через TargetCell на campaign-level" },
      { label: "min_cpm разные", value: "subject_min_cpm: min_cpm_search (для manual фраз без actual_cpm), min_cpm_unified (для Uni clamp в set-campaign-bid). Source: cmp /v6/supplier-subjects ×2 запроса (bid_type=2 + bid_type=1)" },
    ],
  },
  {
    id: "campaign-actions",
    title: "Управление кампанией (mutating endpoints)",
    items: [
      { label: "Запрет авто-теста", value: "ВСЕ mutating WB endpoints запрещены без явного «да, тестируй» от пользователя. Включает curl, dev-сервер, debug. Только READ endpoints свободны" },
      { label: "Смена ставки Uni", value: "PATCH /api/advert/v1/bids body {bids:[{advert_id, nm_bids:[{nm_id, bid_kopecks, placement:'combined'}]}]}. bid_kopecks — копейки. Шлём на ВСЕ nmIds кампании (clamp по min_cpm_unified)" },
      { label: "Смена ставки manual", value: "POST /adv/v0/normquery/bids body {bids:[{advert_id, nm_id, norm_query, bid}]}. bid в РУБЛЯХ. Сервер режет по max_bid_manual_auction_rub. HTTP 200 ≠ успех; ставку ставим только на canonical parent фразу" },
      { label: "Исключение фразы", value: "/api/advert/preset-minus dual-path: open /adv/v0/normquery/set-minus → cmp /preset/minus fallback. Поддерживает cascadeByPreset: расширяет parent до aliases того же preset_id; неcanonical aliases добавляются tolerant-по одному; audit пишется в security_audit_log" },
      { label: "Возврат из исключений", value: "Тот же /preset-minus с is_excluded=false. Кластерный restore шлёт cascade aliases; по audit видно currentCount/nextCount/partial/rejected" },
      { label: "Пополнение бюджета", value: "POST /adv/v1/budget/deposit?id=X body {sum (₽), type, cashback_sum?, cashback_percent?, return:true}. Минимум 1000₽ (WB hard-cap). Наш кэп 30000₽. type: 0=Счёт продавца / 1=Баланс / 3=Бонусы. Можно домешать бонусы при type 0/1" },
      { label: "Запуск/пауза кампании", value: "Подтверждение сделано локальным popover рядом с кнопкой статуса, в едином стиле UI. Закрывается по Отмена/outside/Esc; window.confirm не используется" },
      { label: "Old endpoint (404)", value: "/adv/v0/cpm — отдаёт 404 'path not found'. Заменён в октябре 2025 на PATCH /api/advert/v1/bids (унификация)" },
      { label: "Автопополнение в кабинете", value: "WB кабинет умеет авто-пополнять Uni-бюджет по графику. Не видно в нашем bid_changes_log. При расхождении «запросил N, пополнилось больше» — проверять автопополнение в кабинете" },
      { label: "Логирование", value: "Все mutating-вызовы пишутся в bid_changes_log: at, our_status (ok:campaign_level / budget_deposit / ok:phrase / etc.), wb_status, requested_kopecks, final_kopecks. Используется для тултипов истории на ставке/бюджете" },
    ],
  },
  {
    id: "wb-parser-ssh",
    title: "wb-parser SSH (RU-сервер)",
    items: [
      { label: "Зачем", value: "search.wb.ru блокирует Mac-IP. Через ssh wb-parser → RU-сервер с прокси-пулом → получаем позиции, буст, real_preset_id" },
      { label: "Доступ", value: "ssh wb-parser. User makson, Ubuntu 24.04, RU IP. Рабочая директория ~/wb-parser/" },
      { label: "RPC", value: "~/wb-parser/positions_rpc.py — JSON stdin → JSON stdout. spawn('ssh', [...]) с stdin=payload" },
      { label: "Скорость", value: "1 фраза ~2.5с (с SSH overhead). 10 фраз batch ~10с. Параллельные SSH работают (разные соединения)" },
      { label: "Алгоритм positions", value: "1. Fetch 4 страниц (нормальная page=1+2 + ab_testid=no_promo page=1+2). 2. orgMap: товары без logs[] = органика. 3. promo_pos = индекс в normal, is_advertised = есть logs. 4. organic_pos = orgMap[nopromo_pos]. 5. boost = organic - promo" },
      { label: "Meta-2 fallback", value: "preset_id из meta.presetId (одинаковый для всей выдачи). Если nmId не нашёлся — fallback из metadata.catalog_value (preset=12345). Покрывает хвостовые фразы где наш товар не в SERP" },
      { label: "Endpoints в проекте", value: "/api/sync/phrase-positions-batch (batch для одной кампании+nmId), /api/sync/phrase-position-one (одна фраза при клике, до 5 попыток и прочерки после финального неуспеха), /api/clusters/scan-campaign (auto-cluster через batch SSH multi-pass)" },
      { label: "Telegram бот", value: "На том же сервере сервис wb-parser.service — Telegram бот. Использует positions_rpc.py для своих задач. preset_id ему не нужен — изменения preset_id не задевают бота" },
    ],
  },
  {
    id: "wb-api-nuances",
    title: "WB API нюансы (грабли)",
    items: [
      { label: "/adv/v3/fullstats — только GET", value: "POST → 405 'allowed methods are GET, HEAD'. ?ids=...&beginDate=...&endDate=. Иногда 429/502 от Angie-прокси WB — не наш баг" },
      { label: "/adv/v0/normquery/list camelCase", value: "Body {items:[{advertId, nmId}]} — единственный normquery-endpoint с camelCase. Остальные snake_case. Без этого {items: null} HTTP 200 без ошибки. Маркер баги — «зову, не возвращает данные»" },
      { label: "/adv/v0/normquery/bids — рубли не копейки", value: "Swagger врёт. bid: 549 = 549 ₽. Лимит 29999₽. HTTP 200 ≠ успех — проверять success[]/failed[]" },
      { label: "/adv/v0/normquery/list — порог 100", value: "По доке возвращает только фразы ≥100 показов. На практике порог почти не срабатывает. Для свежих кампаний — может" },
      { label: "/adv/v1/budget/deposit — минимум 1000₽", value: "В доке не указан. На 100₽: 400 'minimum deposit amount is 1000p Sum'. Найден тестом" },
      { label: "actual_cpm в копейках, bid в рублях", value: "Разные единицы у разных endpoint'ов. preset-info actual_cpm=45000 = 450₽. /normquery/bids bid=450 = 450₽. PATCH /api/advert/v1/bids bid_kopecks=12100 = 121₽" },
      { label: "search-texts prevPeriod обязателен", value: "Без prevPeriod в Джем v2/search-report — 400 invalidRequestBody. Сдвигаем currentPeriod на (end-start+1) дней назад. nmId singular!" },
      { label: "preset-info from=to=YYYY-MM-DDT00:00:00Z", value: "cmp /v3/fullstat (xlsx): from и to с одинаковыми timestamps. НЕ диапазон 24ч — иначе криво считает позицию/CPM" },
      { label: "fullstat-v3/v3-daily — test-auto", value: "Не входят в основной SYNC_STEPS. Отдельный test-auto гоняет их по расписанию; v3-daily smart не трогает вчера после успешного закрытия, а при 429 продолжает вчера с cursor advert_id" },
    ],
  },
  {
    id: "auto-cluster",
    title: "Авто-кластеризация фраз (scan-campaign)",
    items: [
      { label: "Триггер", value: "Кнопка ↻ в шапке вкладки «Запросы» → POST /api/clusters/scan-campaign?advertId=X с body {phrases:[...]} (текущий фильтр + дети)" },
      { label: "Что делает", value: "Дёргает wb-parser SSH multi-pass до 10 попыток, получает real_preset_id для каждой фразы, группирует по preset_id, реструктурирует manual_clusters: создаёт новые кластеры, перемещает фразы между, удаляет опустевшие. Закрывает баг split (MPSTATS неправильно объединил) и merge (WB обратно объединил)" },
      { label: "Поле preset_id", value: "Новая колонка в manual_clusters (мигрирована из mpstats_preset_id, UNIQUE INDEX). Один preset = один кластер. Чтения теперь по этому полю; mpstats_preset_id оставлен как метка происхождения" },
      { label: "Имя нового кластера", value: "Материнская фраза = с максимальной frequency в search_texts_wb. UNIQUE(name) → суффикс #1/#2 при коллизии" },
      { label: "Прогресс", value: "Счётчик <scanned>/<total> рядом с кнопкой, polling каждые 1.5с через GET" },
      { label: "Re-attach", value: "На маунте панели — useEffect пингует прогресс. Если scan running (юзер ушёл и вернулся) — подцепляется автоматом. На размонтаже interval гасится" },
      { label: "Stale-lock", value: "Если progress.running=true и startedAt > 15 мин (Next.js dev hot-reload убил handler) — auto-cleanup, новый scan стартует без 409" },
    ],
  },
  {
    id: "preset-info-hybrid",
    title: "Preset-info: гибрид open + closed",
    items: [
      { label: "Open API", value: "POST /api/sync/preset-info-open: list (camelCase!) + get-bids + stats. Без Puppeteer. Подключён в auto-sync ПЕРЕД closed" },
      { label: "Closed cmp", value: "POST /api/sync/preset-info: через Puppeteer cmp-tab. Дополняет open: бьёт хвост views=0 + поле shks" },
      { label: "UPSERT", value: "ON CONFLICT(advert_id,nm_id,name) DO UPDATE: числовые поля → MAX(старое, новое) — бóльшее = истина. is_excluded last-write-wins. spend = clicks×cpc у open" },
      { label: "Что покрывает только open", value: "Быстро, без Puppeteer-зависимости. Фразы с views ≥ 100 (порог list)" },
      { label: "Что покрывает только closed", value: "Полный список включая views=0. Поле shks. Actual_cpm для unified" },
      { label: "Если closed упал", value: "Open даёт ≥80% картины. Управление (set-bid/preset-minus) работает независимо от preset-info" },
    ],
  },
  {
    id: "expense-history",
    title: "Expense-history (фактические списания WB)",
    items: [
      { label: "Endpoint", value: "POST /api/sync/expense-history?from=...&to=... (default 7 дней) → WB GET /adv/v1/upd. Open API, без Puppeteer" },
      { label: "Стратегия", value: "Full-refresh окна: внутри транзакции DELETE+INSERT WHERE substr(date,1,10) BETWEEN. Защита от пустого ответа: НЕ удаляем при empty/error" },
      { label: "Mapping", value: "paymentType: 0=Счёт продавца, 1=Баланс, 3=Бонусы. Тип 9 — обычное списание" },
      { label: "Использование", value: "AdsCampaign.paidPeriod = SUM(amount) GROUP BY advert_id за период. AccountCell в верхней таблице рекламы: 4 строки всего/spend/оплачено/paidPeriod" },
      { label: "Spend vs paid", value: "spend (campaign_stats_daily.sum) — начислено WB. paidPeriod (expense_history) — фактически списано. Расхождения: автопополнения, бонусы" },
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
      { label: "CRO (рекл. по дням)", value: "Конверсия переходов в заказы на уровне кампании: orders / clicks × 100%. Столбец во вкладке «Реклама» → деталка → «По дням», после «Заказ ×₽»" },
      { label: "Паузированные", value: "Stats sync включает status 9+11 — fullstats отдаёт данные" },
      { label: "Период Сегодня/Вчера", value: "offset=0/1. localDateStr (Москва). Каждый день — отдельно" },
      { label: "Ручной тест vs test-auto", value: "В модалке «Тест» days=2 значит ручной v3-daily тянет сегодня+вчера. Test-auto переопределяет дату smart-логикой: после закрытия вчера берёт только сегодня; незакрытый вчерашний хвост возобновляется с cursor" },
      { label: "Кластеры", value: "Weekly snapshot по MAX(date), не фильтруются по периоду" },
      { label: "MPSTATS импорт", value: "POST /api/sync/mpstats-clusters → MPSTATS /api/seo/keywords/cluster → UPSERT в manual_clusters (source='mpstats', обе колонки: mpstats_preset_id + preset_id заполнены). Токен в settings.mpstats_api_token. «Сделать своим» обнуляет mpstats_preset_id (оторвать от ре-импорта); preset_id остаётся" },
      { label: "Auto-cluster scan", value: "Кнопка ↻ в «Запросы» → /api/clusters/scan-campaign → wb-parser SSH → group by real preset_id → restructure manual_clusters. Авто-резолюция split/merge без вмешательства пользователя" },
      { label: "Гибрид preset-info", value: "Open API (list+get-bids+stats) + Closed cmp (preset-info) сосуществуют. UPSERT MAX-семантика: бóльшее число выигрывает. Если closed упал — open даёт ≥80% картины" },
      { label: "Expense-history", value: "/adv/v1/upd за 7 дней. Full-refresh окна. paidPeriod — фактически списанная WB сумма (≠ spend, расходятся при автопополнениях)" },
      { label: "campaigns.type", value: "Колонка в БД всегда NULL (рудимент). Тип кампании в UI определяется через campaignTypeLabel(c) по bidType + placements: manual→Аук., search&recommendations→Uni, search→Q, recommendations→Рек" },
      { label: "Frequency Джем-fallback", value: "В /api/ad-campaign-detail для дней без snapshot в search_texts_wb (включая «сегодня») берётся frequency из phrase_djem_stats_daily. Per-date merge MAX. Cluster-агрегация автоматически подхватывает через cluster.phrasesLcSet" },
      { label: "Bucketing children по фильтру", value: "В queryRows children группируются под parent'ом только если parent проходит фильтр; иначе child top-level. Для expanded parent берём allChildrenByParent, поэтому «трусы женский (4)» раскрывается всеми 4 видимыми children даже на «Наша ставка»" },
      { label: "BidEditCell displayMode", value: "Нижняя таблица использует compact text-инпут, верхняя Реклама — fixed pill 76px/text-sm. При редактировании ставка не растягивает строку и не уменьшает поле/шрифт" },
      { label: "DblClick excluded → переход", value: "Двойной клик по excluded-фразе из любой не-«Исключения» вкладки → setQTypeFilter('excluded') + scrollIntoView + 2.5с highlight. Если child — раскрывает parent. Полезно когда нужно быстро отредактировать исключение, видя его в кластере" },
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
      { label: "Supplier ID", value: "262998 (auth) / 1166225 (API key oid) / UUID e0334427-4f82-4bc3-a0ab-43394e58b6ac" },
      { label: "Телефон", value: "79992787246" },
      { label: "Товаров", value: "30 карточек" },
      { label: "Кампании (на 24 мая 2026)", value: "15 активных (status=9) + 13 на паузе (11) + 308 архив (7) = 336 всего" },
      { label: "Manual clusters", value: "1697 кластеров в БД после массовой кластеризации/импорта. Каждый имеет UNIQUE preset_id, если preset_id заполнен" },
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
