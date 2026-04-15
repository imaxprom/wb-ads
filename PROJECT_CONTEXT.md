# WB Ads — Контекст проекта

> Этот файл — память между сессиями. Перечитывай его в начале каждой новой сессии.
> Также есть База знаний в дашборде (иконка книги, KnowledgeBase.tsx — 13 разделов).

---

## Что это

Дашборд управления рекламой Wildberries. Самостоятельный проект.

- **Стек:** Next.js 16 + TypeScript + Tailwind CSS 4 + SQLite (better-sqlite3) + Puppeteer
- **Порт:** 3001
- **БД:** `data/ads.db` (25 таблиц)
- **Chrome профиль:** `data/chrome-profile/` (персистентный, сессия WB сохраняется)
- **API-ключ WB:** `data/wb-api-key.txt`
- **Токены авторизации WB:** `data/wb-tokens.json`

---

## Архитектура

### Верхняя таблица (14 столбцов)
Товар (sticky) | Предмет | Цвета | Акции | ★ Рейтинг | Цена | Остаток | Воронка (глаз+корзина+коробка) | ДРРз | Затраты рекл. | Авто | Аукцион | CPC | Видимость

### Нижняя панель (SplitPane)
- Карточка товара (фото+инфо, resize) + табы справа
- **5 вкладок:** Воронка продаж (28 столбцов) | Портрет покупателя | Остатки (заглушка) | Каталоги (заглушка) | Запросы (заглушка)
- **Портрет покупателя:** 3 подвкладки — WB | Тип трафика | Точки входа
- Воронка: drag/resize/hide столбцов, настройки в БД, выделение строки кликом
- Выходные (Сб/Вс): жёлтая дата + полоска слева

### ControlPanel (правый верхний угол)
- Кнопка ручной синхронизации → SyncModal
- Иконка журнала (треугольник) — загорается красным при ошибках
- Авто-синк: чекбокс + интервал + обратный отсчёт (данные от серверного синка)
- База знаний (иконка книги)
- Переключатель темы (Violet/Arctic/Neon)
- Молния ⚡ + "X мин." с последнего синка (тултип с точным временем)

---

## Синхронизация

### Серверный авто-синк (auto-sync-server.ts)
- Работает на Node.js, НЕ зависит от вкладки браузера
- Читает настройки из БД (auto_sync_enabled, auto_sync_interval)
- Глубокий синк в 9:00+ (days=3 вместо days=1)
- last_sync_time сохраняется, таймер продолжает после рефреша

### SyncModal (ручной синк)
- Две таблицы: Открытый API (7 шагов) + Закрытый API Джем (2 шага)
- Обе запускаются параллельно
- Ретрай: 3 попытки, 30 сек пауза между ними
- Прогресс-бар для Джем (N/29 + полоска)

### Открытый API (7 шагов, последовательно)
| Endpoint | Что делает |
|---|---|
| /api/sync/campaigns | Кампании + ставки → advert-api |
| /api/sync/products | Карточки + цены + рейтинг |
| /api/sync/stocks | Остатки (полная перезапись) |
| /api/sync/stats | Статистика → fullstats v3, apps[].nms[] → direct vs associated |
| /api/sync/balance | Баланс + бюджеты |
| /api/sync/clusters | Поисковые кластеры |
| /api/sync/funnel?days=N | Воронка открытая (ВСЕ товары из products) |

### Закрытый API Джем (2 шага, параллельно)
| Endpoint | Что делает |
|---|---|
| /api/sync/auth-wb-funnel?days=N | Воронка Джем (viewCount!) → Puppeteer + Authorizev3. 3 парал., 1 сек |
| /api/sync/buyer-profile?days=N | Портрет покупателя → Puppeteer. days=1: 3п/1с, days>1: 2п/3с |

### Журнал (sync_log)
- Одна запись на синк (не на шаг)
- Раскрывается по клику: Открытый API / Закрытый API (Джем)
- Иконка треугольника красная при ошибках за последний час

---

## Гибридный метод воронки

`FULL OUTER JOIN sales_funnel_daily + auth_wb_funnel_daily`
- Пересекающиеся метрики (carts, orders, orders_sum): `MAX()` поштучно по товарам
- Только Джем: viewCount, openCardCount, buyoutsCount/Sum, cancelCount/Sum
- "Весь магазин": сначала MAX по каждому товару, потом SUM

## Формулы

| Формула | Расчёт |
|---|---|
| xP корзины | adSpend / campaign_stats_daily.atbs (direct + assocOUT) |
| xP заказы | adSpend / campaign_stats_daily.orders |
| adClickToCart (товар) | adCarts / adClicks |
| adClickToCart (магазин) | SUM(direct carts by_nm) / SUM(adClicks) |
| ДРРз | adSpend / ordersSum * 100 |

## Ассоциированные конверсии

- **IN (в товар):** корзины/заказы от ЧУЖИХ кампаний → показаны как `1207+154`
- **OUT (из товара):** корзины/заказы ДРУГИХ товаров от НАШЕЙ рекламы → показаны как `+216`
- **Определение:** views>0 или clicks>0 в by_nm = прямые, иначе = ассоциированные
- **Тултипы:** при наведении — таблица с nm_id, корзинами, заказами, суммой, артикулом

---

## Puppeteer-браузер

- **Профиль:** `data/chrome-profile/` — персистентный, сессия сохраняется
- **Автозапуск:** `ensureBrowser()` — если не запущен, стартует автоматически при синке
- **Анти-детект:** `navigator.webdriver=false` + `--disable-blink-features=AutomationControlled`
- **CDP сниффер:** ОТКЛЮЧЁН — page.evaluate(fetch) достаточно для синка
- **Авторизация:** вручную через SMS в Puppeteer-браузере, потом сессия в chrome-profile

---

## БД (25 таблиц)

### Активные
campaigns (332) | campaign_stats_daily | campaign_stats_by_nm | sales_funnel_daily | auth_wb_funnel_daily | buyer_entry_points | sync_log | products (29) | stocks | search_cluster_stats | search_cluster_bids | balance_history | campaign_budgets | settings (12+ ключей) | accounts

### Пустые/будущие
positions | competitors | competitor_positions | automation_rules | automation_log | expense_history | payment_history | product_promotions | minus_phrases (3754) | bid_history

---

## Магазин

- Бренд: IMSI, Магазин: IMSI Каталог
- Supplier ID: 262998 (auth) / 1166225 (API key)
- 29 товаров, 6 активных + 18 на паузе + 308 завершённых кампаний

---

## Критичные файлы (НЕ УДАЛЯТЬ)

- `postcss.config.mjs` — обязателен для Tailwind CSS 4
- `next.config.ts` — `serverExternalPackages: ["better-sqlite3", "puppeteer"]`
- `data/chrome-profile/` — сессия WB, иначе нужна повторная SMS-авторизация
