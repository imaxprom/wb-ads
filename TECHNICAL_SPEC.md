# WB Ads — Техническое задание для создания архитектуры БД

> Этот документ описывает ВСЕ эндпоинты WB API Продвижение (Promotion),
> на основе которых нужно создать таблицы в SQLite для хранения и автоматического обновления данных.

---

## Стек технологий

- Next.js + TypeScript + Tailwind CSS
- SQLite (better-sqlite3) — БД: `data/ads.db`
- Порт: 3001 (MpHub = 3000)
- Отдельный проект, не зависит от MpHub

---

## WB API эндпоинты: Продвижение

Все запросы к `https://advert-api.wildberries.ru` с заголовком `Authorization: <API_KEY>`.

### 1. Кампании

| Метод | Путь | Описание | Rate Limit |
|-------|------|----------|------------|
| GET | /adv/v1/promotion/count | Список кампаний по типу/статусу | 5 req/s |
| GET | /api/advert/v2/adverts | Информация о кампаниях (до 50 ID) | 5 req/s |
| POST | /adv/v2/seacat/save-ad | Создать кампанию | 5 req/min |
| GET | /adv/v0/start | Запустить кампанию | 5 req/s |
| GET | /adv/v0/pause | Поставить на паузу | 5 req/s |
| GET | /adv/v0/stop | Остановить кампанию | 5 req/s |
| GET | /adv/v0/delete | Удалить кампанию | 5 req/s |
| POST | /adv/v0/rename | Переименовать кампанию | 5 req/s |

**Ответ /api/advert/v2/adverts:**
```json
{
  "advertId": 12345,
  "name": "Кампания 1",
  "type": 6,           // тип кампании
  "status": 9,         // 4=готова, 9=активна, 11=пауза
  "dailyBudget": 1000,
  "createTime": "2026-01-15T10:00:00",
  "changeTime": "2026-04-11T15:30:00",
  "startTime": "2026-01-15T10:00:00",
  "endTime": "2026-12-31T23:59:59",
  "paymentType": "cpm",
  "params": [{ "nms": [322000486, 165140159], "subjectId": 123 }]
}
```

**Таблица: `campaigns`**
```sql
CREATE TABLE campaigns (
    advert_id INTEGER PRIMARY KEY,
    name TEXT,
    type INTEGER,              -- тип кампании
    status INTEGER,            -- 4=готова, 9=активна, 11=пауза, 7=завершена
    daily_budget REAL,
    payment_type TEXT,         -- 'cpm' или 'cpc'
    create_time TEXT,
    change_time TEXT,
    start_time TEXT,
    end_time TEXT,
    nms_json TEXT,             -- JSON массив nm_id товаров
    subject_id INTEGER,
    updated_at TEXT DEFAULT (datetime('now'))
);
```

---

### 2. Ставки

| Метод | Путь | Описание | Rate Limit |
|-------|------|----------|------------|
| POST | /api/advert/v1/bids/min | Минимальные ставки по товарам | 20 req/min |
| PATCH | /api/advert/v1/bids | Изменить ставки | 5 req/s |
| GET | /api/advert/v0/bids/recommendations | Рекомендованные ставки | 5 req/min |

**Ответ /api/advert/v0/bids/recommendations:**
```json
{
  "competitiveBid": 350,    // конкурентная ставка (копейки)
  "leadersBid": 500,        // ставка лидеров (копейки)
  "top2": 450,
  "normQueries": [
    { "query": "трусы женские", "competitiveBid": 300, "leadersBid": 480 }
  ]
}
```

**Таблица: `bid_history`** (история изменений ставок)
```sql
CREATE TABLE bid_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    advert_id INTEGER,
    nm_id INTEGER,
    placement TEXT,            -- 'search', 'recommendations', 'combined'
    bid_kopecks INTEGER,       -- текущая ставка
    competitive_bid INTEGER,   -- рекомендованная конкурентная
    leaders_bid INTEGER,       -- рекомендованная лидеров
    recorded_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_bid_adv_nm ON bid_history(advert_id, nm_id, recorded_at);
```

---

### 3. Поисковые кластеры (Search Clusters)

| Метод | Путь | Описание | Rate Limit |
|-------|------|----------|------------|
| POST | /adv/v0/normquery/stats | Статистика по поисковым кластерам | 10 req/min |
| POST | /adv/v0/normquery/get-bids | Текущие ставки по кластерам | 5 req/s |
| POST | /adv/v0/normquery/bids | Установить ставки по кластерам | 2 req/s |
| DELETE | /adv/v0/normquery/bids | Удалить ставки кластеров | 5 req/s |
| POST | /adv/v0/normquery/get-minus | Минус-фразы | 5 req/s |
| POST | /adv/v0/normquery/set-minus | Установить минус-фразы | 5 req/s |
| POST | /adv/v1/normquery/stats | Дневная статистика кластеров (новый, v1) | 10 req/min |

> **Примечание:** v1 методы кластеров — новые (с 2025). Не показывают кластеры с < 100 показов. Для полных данных использовать v0.

**Ответ /adv/v0/normquery/stats:**
```json
{
  "norm_query": "трусы женские набор",
  "views": 15000,
  "clicks": 450,
  "ctr": 3.0,
  "cpc": 5.2,
  "cpm": 156,
  "orders": 12,
  "avg_pos": 3.5,
  "atbs": 85
}
```

**Таблица: `search_cluster_stats`**
```sql
CREATE TABLE search_cluster_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    advert_id INTEGER,
    nm_id INTEGER,
    norm_query TEXT,            -- поисковый кластер (фраза)
    date TEXT,                 -- дата статистики
    views INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    ctr REAL DEFAULT 0,
    cpc REAL DEFAULT 0,
    cpm REAL DEFAULT 0,
    orders INTEGER DEFAULT 0,
    avg_pos REAL DEFAULT 0,
    atbs INTEGER DEFAULT 0,
    UNIQUE(advert_id, nm_id, norm_query, date)
);
CREATE INDEX idx_cluster_date ON search_cluster_stats(date);
CREATE INDEX idx_cluster_query ON search_cluster_stats(norm_query);
```

**Таблица: `search_cluster_bids`** (текущие ставки по кластерам)
```sql
CREATE TABLE search_cluster_bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    advert_id INTEGER,
    nm_id INTEGER,
    norm_query TEXT,
    bid_kopecks INTEGER,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(advert_id, nm_id, norm_query)
);
```

**Таблица: `minus_phrases`** (минус-фразы)
```sql
CREATE TABLE minus_phrases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    advert_id INTEGER,
    nm_id INTEGER,
    norm_query TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(advert_id, nm_id, norm_query)
);
```

---

### 4. Статистика кампаний

| Метод | Путь | Описание | Rate Limit |
|-------|------|----------|------------|
| GET | /adv/v3/fullstats | Полная статистика кампаний по дням и товарам | - |
| POST | /adv/v1/normquery/stats | Дневная статистика по поисковым кластерам (новый) | 10 req/min |

> **Важно:** `/adv/v3/fullstats` — имел баги (возвращал нули). Проверять данные при первом подключении.

**Запрос:** `?ids=123,456&beginDate=2026-04-01&endDate=2026-04-11`

**Ответ /adv/v3/fullstats:**
```json
{
  "advertId": 12345,
  "days": [
    {
      "date": "2026-04-11",
      "views": 5000,
      "clicks": 150,
      "ctr": 3.0,
      "cpc": 5.5,
      "cpm": 165,
      "sum": 825.0,
      "atbs": 120,
      "orders": 8,
      "shks": 10,
      "sum_price": 12000,
      "cr": 5.3,
      "canceled": 1
    }
  ],
  "nms": [
    {
      "nmId": 322000486,
      "name": "Трусы женские",
      "views": 3000,
      "clicks": 90,
      "orders": 5,
      "sum": 500.0
    }
  ]
}
```

**Таблица: `campaign_stats_daily`** (статистика по дням)
```sql
CREATE TABLE campaign_stats_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    advert_id INTEGER,
    date TEXT,
    views INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    ctr REAL DEFAULT 0,
    cpc REAL DEFAULT 0,
    cpm REAL DEFAULT 0,
    sum REAL DEFAULT 0,          -- расход (руб)
    atbs INTEGER DEFAULT 0,      -- добавления в корзину
    orders INTEGER DEFAULT 0,
    shks INTEGER DEFAULT 0,      -- отгрузки
    sum_price REAL DEFAULT 0,    -- сумма заказов
    cr REAL DEFAULT 0,           -- конверсия
    canceled INTEGER DEFAULT 0,  -- технические отмены
    UNIQUE(advert_id, date)
);
CREATE INDEX idx_stats_date ON campaign_stats_daily(date);
CREATE INDEX idx_stats_adv ON campaign_stats_daily(advert_id);
```

**Таблица: `campaign_stats_by_nm`** (статистика по товарам)
```sql
CREATE TABLE campaign_stats_by_nm (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    advert_id INTEGER,
    nm_id INTEGER,
    date TEXT,
    views INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    ctr REAL DEFAULT 0,
    cpc REAL DEFAULT 0,
    cpm REAL DEFAULT 0,
    sum REAL DEFAULT 0,
    orders INTEGER DEFAULT 0,
    sum_price REAL DEFAULT 0,
    cr REAL DEFAULT 0,
    UNIQUE(advert_id, nm_id, date)
);
CREATE INDEX idx_stats_nm ON campaign_stats_by_nm(nm_id, date);
```

---

### 5. Финансы

| Метод | Путь | Описание | Rate Limit |
|-------|------|----------|------------|
| GET | /adv/v1/balance | Баланс рекламного кабинета | 1 req/s |
| GET | /adv/v1/budget | Бюджет кампании | 4 req/s |
| POST | /adv/v1/budget/deposit | Пополнить бюджет кампании | 1 req/s |
| GET | /adv/v1/upd | История списаний (до 31 дня) | 1 req/s |
| GET | /adv/v1/payments | История пополнений | 1 req/s |

**Таблица: `balance_history`** (история баланса)
```sql
CREATE TABLE balance_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    balance REAL,
    net REAL,
    bonus REAL,
    recorded_at TEXT DEFAULT (datetime('now'))
);
```

**Таблица: `expense_history`** (история списаний)
```sql
CREATE TABLE expense_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    advert_id INTEGER,
    campaign_name TEXT,
    date TEXT,
    amount REAL,
    type TEXT,               -- тип кампании
    payment_source TEXT,     -- источник оплаты
    status TEXT,
    UNIQUE(advert_id, date, amount)
);
CREATE INDEX idx_expense_date ON expense_history(date);
```

**Таблица: `payment_history`** (история пополнений)
```sql
CREATE TABLE payment_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id INTEGER,
    date TEXT,
    amount REAL,
    type INTEGER,            -- 0=счёт, 1=баланс, 3=карта
    status TEXT,
    UNIQUE(payment_id)
);
```

**Таблица: `campaign_budgets`** (текущие бюджеты кампаний)
```sql
CREATE TABLE campaign_budgets (
    advert_id INTEGER PRIMARY KEY,
    cash REAL DEFAULT 0,
    netting REAL DEFAULT 0,
    total REAL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
);
```

---

### 6. Воронка продаж (из WB Analytics API)

| Метод | Путь | Описание |
|-------|------|----------|
| POST | /api/analytics/v3/sales-funnel/grouped/history | Воронка по дням |
| POST | /api/analytics/v3/sales-funnel/products | Воронка по товарам |

Сервер: `https://seller-analytics-api.wildberries.ru`

**Таблица: `sales_funnel_daily`**
```sql
CREATE TABLE sales_funnel_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nm_id INTEGER,
    date TEXT,
    open_card_count INTEGER DEFAULT 0,     -- просмотры карточки
    add_to_cart_count INTEGER DEFAULT 0,   -- добавления в корзину
    orders_count INTEGER DEFAULT 0,        -- заказы
    orders_sum REAL DEFAULT 0,             -- сумма заказов
    buyouts_count INTEGER DEFAULT 0,       -- выкупы
    buyouts_sum REAL DEFAULT 0,            -- сумма выкупов
    cancel_count INTEGER DEFAULT 0,        -- отмены
    add_to_cart_conversion REAL DEFAULT 0, -- конверсия в корзину %
    cart_to_order_conversion REAL DEFAULT 0, -- конверсия в заказ %
    buyout_percent REAL DEFAULT 0,         -- % выкупа
    UNIQUE(nm_id, date)
);
CREATE INDEX idx_funnel_nm_date ON sales_funnel_daily(nm_id, date);
```

---

### 6.1. Воронка продаж — закрытый API Джем (seller-content)

> **Источник данных, недоступный через открытый WB API.**
> Содержит `viewCount` (показы карточки в выдаче) — ключевая метрика верхней части воронки,
> которой НЕТ в открытом API (`seller-analytics-api`).

**Сервер:** `https://seller-content.wildberries.ru`
**Базовый путь:** `/ns/analytics-api/content-analytics/api/v1/sales-funnel`

| Метод | Путь | Описание |
|-------|------|----------|
| POST | /report/product/history | Воронка по дням для одного товара |
| POST | /report | Сводный отчёт с prev/current period |
| POST | /report/details | Детальный отчёт с пагинацией (limit/offset) |
| GET | /seasonality?subjectID=N | Сезонность по категории |
| POST | /seller/comparisons/market | Сравнение с рынком по категории |

**Авторизация (отличается от открытого API!):**
- НЕ используется обычный API-токен
- Требуется **Puppeteer-браузер**, авторизованный на `seller.wildberries.ru`
- Запросы выполняются через `page.evaluate(fetch(...))` из контекста страницы
- Обязательный заголовок: **`Authorizev3`** — JWT из `localStorage["wb-eu-passport-v2.access-token"]`
- Обязательно: `credentials: "include"` (передача cookies браузера)
- Заголовок `wb-seller-lk` НЕ нужен для этих endpoint'ов

**Как получить токен в коде:**
```js
const token = await page.evaluate(() =>
  localStorage.getItem("wb-eu-passport-v2.access-token")
);
```

**Запрос /report/product/history:**
```json
{
  "nmID": 322000486,
  "currentPeriod": { "start": "2026-04-07", "end": "2026-04-13" }
}
```

**Ответ (массив по дням):**
```json
{
  "data": [
    {
      "date": "2026-04-07",
      "viewCount": { "current": 312614, "previous": 290000 },
      "openCardCount": { "current": 20460, "previous": 18500 },
      "addToCartCount": { "current": 1985, "previous": 1800 },
      "addToWishlistCount": { "current": 50, "previous": 45 },
      "orderCount": { "current": 383, "previous": 350 },
      "orderSum": { "current": 439328.0, "previous": 400000.0 },
      "buyoutCount": { "current": 345, "previous": 315 },
      "buyoutSum": { "current": 395000.0, "previous": 360000.0 },
      "cancelCount": { "current": 5, "previous": 3 },
      "cancelSum": { "current": 5700.0, "previous": 3400.0 },
      "viewToOpenConversion": { "current": 6.54, "previous": 6.38 },
      "openToCartConversion": { "current": 9.7, "previous": 9.73 },
      "cartToOrderConversion": { "current": 19.3, "previous": 19.44 },
      "buyoutPercent": { "current": 90.0, "previous": 88.0 }
    }
  ]
}
```

**Метрики (полная воронка сверху вниз):**

| Поле | Описание | Есть в открытом API? |
|------|----------|---------------------|
| `viewCount` | Показы карточки в выдаче | **НЕТ** — уникально |
| `openCardCount` | Переходы (клик в карточку) | Да (`openCount`) |
| `addToCartCount` | Добавления в корзину | Да (`cartCount`) |
| `addToWishlistCount` | Добавления в избранное | Нет |
| `orderCount` | Заказы, шт. | Да |
| `orderSum` | Заказы, руб. | Да |
| `buyoutCount` | Выкупы, шт. | Нет |
| `buyoutSum` | Выкупы, руб. | Нет |
| `cancelCount` | Отмены, шт. | Нет |
| `cancelSum` | Отмены, руб. | Нет |
| `viewToOpenConversion` | CTR (показы → переходы), % | Нет |
| `openToCartConversion` | CR в корзину, % | Да |
| `cartToOrderConversion` | CR в заказ, % | Да |
| `buyoutPercent` | Процент выкупа, % | Да |

**Rate limit:** ~1 запрос/сек (по одному товару за раз)

**Таблица: `auth_wb_funnel_daily`**
```sql
CREATE TABLE auth_wb_funnel_daily (
    nm_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    view_count INTEGER DEFAULT 0,           -- показы в выдаче (УНИКАЛЬНО!)
    open_card_count INTEGER DEFAULT 0,      -- переходы в карточку
    add_to_cart_count INTEGER DEFAULT 0,    -- добавления в корзину
    add_to_wishlist_count INTEGER DEFAULT 0,-- добавления в избранное
    orders_count INTEGER DEFAULT 0,         -- заказы, шт.
    orders_sum REAL DEFAULT 0,              -- заказы, руб.
    buyouts_count INTEGER DEFAULT 0,        -- выкупы, шт.
    buyouts_sum REAL DEFAULT 0,             -- выкупы, руб.
    cancel_count INTEGER DEFAULT 0,         -- отмены, шт.
    cancel_sum REAL DEFAULT 0,              -- отмены, руб.
    view_to_open_conversion REAL DEFAULT 0, -- CTR, %
    open_to_cart_conversion REAL DEFAULT 0, -- CR в корзину, %
    cart_to_order_conversion REAL DEFAULT 0,-- CR в заказ, %
    buyout_percent REAL DEFAULT 0,          -- процент выкупа, %
    PRIMARY KEY (nm_id, date)
);
CREATE INDEX idx_auth_funnel_date ON auth_wb_funnel_daily(date);
```

**API route:** `POST /api/sync/auth-wb-funnel?days=N`
- Файл: `src/app/api/sync/auth-wb-funnel/route.ts`
- Требует запущенный снифер-браузер (`POST /api/wb/sniff`)
- Итерирует по всем товарам из таблицы `products`
- Вставляет/обновляет записи через `INSERT OR REPLACE`

**Отличие от `sales_funnel_daily` (раздел 6):**

| | `sales_funnel_daily` | `auth_wb_funnel_daily` |
|-|---------------------|----------------------|
| Источник | seller-analytics-api (открытый) | seller-content (закрытый) |
| Авторизация | API-токен (серверный) | Puppeteer + Authorizev3 |
| viewCount | Нет | **Есть** |
| buyoutCount/Sum | Нет | Есть |
| cancelCount/Sum | Нет | Есть |
| addToWishlistCount | Нет | Есть |
| Зависимость | Нет | Нужен запущенный браузер |

---

### 7. Позиции (из wb-parser бота)

Данные о позициях в поиске WB по ключевым словам. Приходят из Telegram-бота wb-parser.

**Таблица: `positions`**
```sql
CREATE TABLE positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nm_id INTEGER,
    keyword TEXT,              -- поисковый запрос
    position INTEGER,          -- позиция в выдаче (1-300+)
    page INTEGER,              -- страница
    cpm REAL,                  -- CPM на этой позиции
    timestamp TEXT DEFAULT (datetime('now')),
    source TEXT DEFAULT 'wb-parser'  -- откуда данные
);
CREATE INDEX idx_pos_nm_kw ON positions(nm_id, keyword, timestamp);
CREATE INDEX idx_pos_ts ON positions(timestamp);
```

---

### 8. Конкуренты

**Таблица: `competitors`**
```sql
CREATE TABLE competitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nm_id INTEGER,             -- наш артикул
    competitor_nm_id INTEGER,  -- артикул конкурента
    keyword TEXT,              -- по какому запросу конкурируем
    added_at TEXT DEFAULT (datetime('now')),
    UNIQUE(nm_id, competitor_nm_id, keyword)
);
```

**Таблица: `competitor_positions`**
```sql
CREATE TABLE competitor_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    competitor_nm_id INTEGER,
    keyword TEXT,
    position INTEGER,
    page INTEGER,
    timestamp TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_comp_pos ON competitor_positions(competitor_nm_id, keyword, timestamp);
```

---

### 9. Правила автоматизации

**Таблица: `automation_rules`**
```sql
CREATE TABLE automation_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    advert_id INTEGER,
    nm_id INTEGER,
    rule_type TEXT,            -- 'bid_up', 'bid_down', 'pause', 'start'
    condition_json TEXT,       -- JSON: {"metric": "position", "operator": ">", "value": 10}
    action_json TEXT,          -- JSON: {"action": "bid_change", "amount": 50}
    is_active INTEGER DEFAULT 1,
    last_triggered TEXT,
    trigger_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
```

**Таблица: `automation_log`** (лог действий автоматики)
```sql
CREATE TABLE automation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER REFERENCES automation_rules(id),
    advert_id INTEGER,
    nm_id INTEGER,
    action TEXT,               -- что сделали
    old_value TEXT,            -- было
    new_value TEXT,            -- стало
    reason TEXT,               -- почему
    timestamp TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_auto_log_ts ON automation_log(timestamp);
```

---

### 10. Настройки

**Таблица: `settings`**
```sql
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
-- Ключи: wb_api_key, sync_interval, max_bid, min_bid, budget_limit
```

---

### 11. Медиа-кампании (advert-media-api.wildberries.ru)

| Метод | Путь | Описание | Rate Limit |
|-------|------|----------|------------|
| GET | /adv/v1/count | Количество медиа-кампаний по типу/статусу | 10 req/s |
| GET | /adv/v1/adverts | Список медиа-кампаний (пагинация) | 10 req/s |
| GET | /adv/v1/advert | Детали медиа-кампании | 10 req/s |

> **Сервер:** `https://advert-media-api.wildberries.ru` (отдельный от основного advert-api)

### 12. Вспомогательные (создание кампаний)

| Метод | Путь | Описание | Rate Limit |
|-------|------|----------|------------|
| GET | /adv/v1/supplier/subjects | Категории товаров для кампаний | 1 req/12s |
| POST | /adv/v2/supplier/nms | Товары по категориям для кампаний | 5 req/min |
| PUT | /adv/v0/auction/placements | Изменить плейсменты (поиск/рекомендации) | 1 req/s |
| PATCH | /adv/v0/auction/nms | Добавить/удалить товары из кампании | 1 req/s |

---

### Таймауты синхронизации WB (внутренние)

| Что | Задержка |
|-----|----------|
| Синхронизация БД WB | каждые 3 минуты |
| Изменение статусов | каждую 1 минуту |
| Изменение ставок | каждые 30 секунд |

---

## Синхронизация (крон)

| Данные | Частота | Эндпоинт |
|--------|---------|----------|
| Кампании (список, статус) | Каждые 5 мин | /api/advert/v2/adverts |
| Ставки (текущие + рекомендованные) | Каждые 10 мин | /api/advert/v0/bids/recommendations |
| Статистика дневная | Каждый час | /adv/v3/fullstats |
| Поисковые кластеры | Каждые 30 мин | /adv/v0/normquery/stats |
| Баланс | Каждые 15 мин | /adv/v1/balance |
| Воронка продаж (открытый) | Каждый час | /api/analytics/v3/sales-funnel |
| Воронка Джем (закрытый) | Каждые 5 часов | /api/sync/auth-wb-funnel (Puppeteer) |
| Позиции (из wb-parser) | По расписанию бота | Внутренний API |
| Списания | Каждые 6 часов | /adv/v1/upd |

---

## Структура проекта

```
wb-ads/
  data/
    ads.db                    ← Основная БД (19 таблиц)
    wb-api-key.txt            ← API ключ WB
  src/
    app/                      ← Next.js страницы
    lib/
      db.ts                   ← Подключение к ads.db
      sync/                   ← Модули синхронизации
        campaigns.ts
        stats.ts
        bids.ts
        clusters.ts
        balance.ts
        funnel.ts
      automation/             ← Автоматика ставок
        engine.ts
        rules.ts
    types/                    ← TypeScript типы
  scripts/
    init-db.ts                ← Инициализация БД
  CLAUDE.md                   ← Правила проекта
```

---

## Задание агенту

### Что сделать:

1. **Инициализировать Next.js проект** в текущей папке `/Users/octopus/Projects/wb-ads/`:
   - `npm init -y && npm install next@latest react react-dom typescript @types/react @types/react-dom better-sqlite3 @types/better-sqlite3 tailwindcss`
   - Создать `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`
   - Порт: 3001 (в `package.json` scripts: `"dev": "next dev -p 3001"`)

2. **Создать директории:**
   ```
   mkdir -p data src/app src/lib/sync src/lib/automation src/types scripts
   ```

3. **Создать `scripts/init-db.ts`** — скрипт инициализации БД:
   - Открывает `data/ads.db`
   - Создаёт ВСЕ 18 таблиц из этого документа (скопировать SQL дословно)
   - Создаёт ВСЕ индексы
   - `db.pragma("journal_mode = WAL")`

4. **Создать `src/lib/db.ts`** — подключение к БД:
   ```typescript
   import Database from "better-sqlite3";
   import path from "path";
   const DB_PATH = path.join(process.cwd(), "data", "ads.db");
   let db: Database.Database | null = null;
   export function getDb(): Database.Database {
     if (!db) {
       db = new Database(DB_PATH);
       db.pragma("journal_mode = WAL");
       db.pragma("cache_size = -64000");
       db.pragma("busy_timeout = 5000");
     }
     return db;
   }
   ```

5. **Создать `CLAUDE.md`** с правилами:
   - Рабочая директория: `/Users/octopus/Projects/wb-ads`
   - Стек: Next.js + TypeScript + Tailwind CSS + SQLite
   - Порт: 3001
   - БД: `data/ads.db`
   - ЗАПРЕЩЕНО: обращаться к `/Users/octopus/Projects/website/` или другим проектам
   - Все зависимости локальные (`npm install` без `-g`)

6. **Создать стартовую страницу** `src/app/page.tsx`:
   - Показывает "WB Ads — Рекламный автопилот"
   - Показывает количество таблиц в БД (проверка что БД работает)

7. **Запустить `init-db.ts`** и убедиться что все 18 таблиц созданы:
   ```bash
   npx tsx scripts/init-db.ts
   sqlite3 data/ads.db ".tables"
   ```

### Чего НЕ делать:
- НЕ создавать синхронизацию (будет на следующем этапе)
- НЕ создавать API роуты (будет на следующем этапе)
- НЕ подключать MpHub, НЕ использовать его код
- НЕ выдумывать свои таблицы — только из этого документа

### Список всех 19 таблиц (для проверки):
1. campaigns
2. bid_history
3. search_cluster_stats
4. search_cluster_bids
5. minus_phrases
6. campaign_stats_daily
7. campaign_stats_by_nm
8. balance_history
9. expense_history
10. payment_history
11. campaign_budgets
12. sales_funnel_daily — воронка из открытого API (без viewCount)
13. **auth_wb_funnel_daily** — воронка из закрытого API Джем (с viewCount, через Puppeteer)
14. positions
15. competitors
16. competitor_positions
17. automation_rules
18. automation_log
19. settings

---

## Источники API

- [WB API Promotion Documentation](https://dev.wildberries.ru/en/docs/openapi/promotion)
- [WB API Promotion Swagger](https://dev.wildberries.ru/en/swagger/promotion)
- [WB API Analytics](https://dev.wildberries.ru/en/docs/openapi/analytics)
- [WB API Reports](https://dev.wildberries.ru/en/docs/openapi/reports)
- [OpenAPI YAML — Promotion](https://dev.wildberries.ru/api/swagger/yaml/en/08-promotion.yaml)
