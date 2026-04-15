# WB Ads — Дашборд управления рекламой

> **РЕЖИМ РАБОТЫ:** Перед каждым действием используй extended thinking.
> Рассмотри варианты, проверь предположения, читай существующий код перед изменением.
> НЕ ВЫДУМЫВАЙ данные — читай из БД и API.

---

## Что уже есть

### Проект
- Next.js 16 + TypeScript + Tailwind CSS 4 + recharts
- Порт: 3001
- БД: `data/ads.db` (SQLite, 18 таблиц — схема в TECHNICAL_SPEC.md)
- API-ключ: `data/wb-api-key.txt`
- Подключение к БД: `src/lib/db.ts` → `getDb()`

### Существующие файлы (НЕ ТРОГАТЬ)
- `src/lib/db.ts` — подключение к БД (использовать как есть)
- `scripts/init-db.ts` — инициализация БД
- `TECHNICAL_SPEC.md` — описание WB API и схема всех 18 таблиц
- `CLAUDE.md` — правила проекта

### Реальные данные в БД (проверено)

| Таблица | Записей | Описание |
|---|---|---|
| `campaigns` | 332 | 7 активных (status=9), 17 на паузе (status=11), 308 завершённых (status=7) |
| `campaign_stats_daily` | 56 | Дневная статистика кампаний (2026-04-05 — 2026-04-12) |
| `campaign_stats_by_nm` | 671 | Статистика по товарам в кампаниях (13 уникальных nm_id) |
| `sales_funnel_daily` | 56 | Воронка продаж по товарам (2026-03-30 — 2026-04-12) |
| `search_cluster_stats` | 187 | Поисковые кластеры (запросы) |
| `bid_history` | 14 | История ставок |
| `balance_history` | 2 | Баланс рекламного кабинета |
| `campaign_budgets` | 0 | Пусто |
| `expense_history` | 0 | Пусто |

### 13 уникальных товаров (nm_id) в системе:
`163785912, 165140159, 178439058, 322000486, 333768802, 386566779, 388156471, 398657691, 399612115, 431925632, 431926725, 431927756, 580062620`

### Связь кампаний → товары:
- Поле `campaigns.nms_json` — JSON-массив nm_id. Пример: `[322000486]` или `[163258677, 156125974]`
- Один товар может иметь несколько кампаний (АВТО + ПОИСК)

### ⚠️ Поле `campaigns.type` = NULL для всех записей!
Тип кампании (АВТО/ПОИСК/CPC) сейчас НЕ сохранён в БД. Определять по:
1. Полю `payment_type`: `'cpm'` = показы, `'cpc'` = клики
2. Названию кампании: содержит "АВТО" = единая ставка, "ПОИСК" = аукцион
3. В будущем: исправить sync для сохранения `type` из WB API

---

## Что нужно создать

### Общая архитектура

Одна страница-дашборд (`src/app/page.tsx`) с:
1. Верхние табы навигации
2. Панель фильтров
3. Горизонтально-скроллируемая таблица товаров (14 столбцов)

### Цветовая гамма (тёмная тема)

Создать `src/app/globals.css`:
```css
@import "tailwindcss";

:root {
  --bg: #0a0a1a;
  --bg-card: #12122b;
  --bg-card-hover: #1a1a3e;
  --border: #1e1e3a;
  --accent: #6c5ce7;
  --accent-hover: #7c6cf7;
  --success: #00b894;
  --warning: #fdcb6e;
  --danger: #ff6b6b;
  --text: #e4e4ef;
  --text-muted: #8888a8;
}

body {
  background: var(--bg);
  color: var(--text);
}
```

---

## Новые утилиты (создать)

### `src/lib/wb-image.ts` — URL фото товара

```typescript
function getBasketNumber(vol: number): string {
  if (vol <= 143) return "01";
  if (vol <= 287) return "02";
  if (vol <= 431) return "03";
  if (vol <= 719) return "04";
  if (vol <= 1007) return "05";
  if (vol <= 1061) return "06";
  if (vol <= 1115) return "07";
  if (vol <= 1169) return "08";
  if (vol <= 1313) return "09";
  if (vol <= 1601) return "10";
  if (vol <= 1655) return "11";
  if (vol <= 1919) return "12";
  if (vol <= 2045) return "13";
  if (vol <= 2189) return "14";
  if (vol <= 2405) return "15";
  if (vol <= 2621) return "16";
  if (vol <= 2837) return "17";
  if (vol <= 3053) return "18";
  if (vol <= 3269) return "19";
  if (vol <= 3485) return "20";
  if (vol <= 3701) return "21";
  if (vol <= 3917) return "22";
  if (vol <= 4133) return "23";
  if (vol <= 4349) return "24";
  const basket = 25 + Math.floor((vol - 4350) / 324);
  return String(Math.min(99, basket)).padStart(2, "0");
}

export function getWbImageUrl(nmId: number, size: "small" | "medium" = "small"): string {
  if (!nmId || nmId <= 0) return "";
  const vol = Math.floor(nmId / 100000);
  const part = Math.floor(nmId / 1000);
  const basket = getBasketNumber(vol);
  const dim = size === "small" ? "c246x328" : "c516x688";
  return `https://basket-${basket}.wbbasket.ru/vol${vol}/part${part}/${nmId}/images/${dim}/1.webp`;
}
```

URL строится детерминистически из nmId — **НЕТ API-запроса**. Компонент `ProductThumb`:

```tsx
function ProductThumb({ nmId }: { nmId: number }) {
  const [failed, setFailed] = useState(false);
  const url = getWbImageUrl(nmId, "small");
  if (!url || failed) return <div className="w-8 h-8 rounded bg-[var(--border)] flex-shrink-0" />;
  return <img src={url} alt="" width={32} height={32} className="w-8 h-8 rounded object-cover flex-shrink-0" onError={() => setFailed(true)} />;
}
```

### `src/lib/api-key.ts` — чтение API-ключа

```typescript
import fs from "fs";
import path from "path";

export function getApiKey(): string {
  const p = path.join(process.cwd(), "data", "wb-api-key.txt");
  return fs.readFileSync(p, "utf-8").trim();
}
```

---

## Новая таблица: `products` (информация о товарах)

Добавить в `scripts/init-db.ts` и выполнить миграцию:

```sql
CREATE TABLE IF NOT EXISTS products (
    nm_id INTEGER PRIMARY KEY,
    vendor_code TEXT,           -- артикул продавца
    title TEXT,                 -- название товара
    subject TEXT,               -- категория (Трусы, Носки...)
    brand TEXT,
    colors TEXT,                -- цвета через запятую
    rating REAL,                -- средний рейтинг (1-5)
    feedbacks INTEGER DEFAULT 0, -- количество отзывов
    price INTEGER DEFAULT 0,    -- полная цена (руб, без скидок)
    discount INTEGER DEFAULT 0, -- скидка поставщика %
    sale_price INTEGER DEFAULT 0, -- цена покупателю (руб, из card.wb.ru salePriceU/100)
    spp REAL DEFAULT 0,         -- скидка WB "СПП" в % (рассчитывается)
    updated_at TEXT DEFAULT (datetime('now'))
);
```

**Sync для заполнения products:**

Создать API route `POST /api/sync/products` — забирает данные из WB Content API:

```
POST https://content-api.wildberries.ru/content/v2/get/cards/list
Authorization: {apiKey}
Body: { "settings": { "sort": { "ascending": false }, "cursor": { "limit": 100 }, "filter": { "withPhoto": -1 } } }
```

Ответ:
```json
{
  "cards": [
    {
      "nmID": 322000486,
      "vendorCode": "SL-8369*6605-MC-9",
      "title": "Трусы женские набор 9 штук",
      "subjectName": "Трусы",
      "brand": "IMSI",
      "characteristics": [{ "name": "Цвет", "value": ["чёрный", "белый", "серый"] }],
      "sizes": [...],
      "updatedAt": "2026-04-10T12:34:56Z"
    }
  ],
  "cursor": { "updatedAt": "...", "nmID": 123, "total": 50 }
}
```

Парсинг:
- `title` = `card.title`
- `vendor_code` = `card.vendorCode`
- `subject` = `card.subjectName`
- `brand` = `card.brand`
- `colors` = из `characteristics` найти элемент с `name` = "Цвет", взять `value` (массив), объединить через `, `

**Рейтинг и цены** — дополнительный sync через публичный WB API (без авторизации):
```
GET https://card.wb.ru/cards/v2/detail?appType=1&curr=rub&dest=-1257786&nm=322000486;165140159;398657691
```

Ответ (ключевые поля):
```json
{
  "data": {
    "products": [
      {
        "id": 322000486,
        "name": "Трусы женские набор 9 штук",
        "rating": 4.8,
        "feedbacks": 13255,
        "salePriceU": 39600,
        "priceU": 60000
      }
    ]
  }
}
```
- `rating` = рейтинг → сохранить в `products.rating`
- `feedbacks` = количество отзывов → сохранить в `products.feedbacks`
- `salePriceU / 100` = цена покупателю в рублях → сохранить в `products.sale_price`
- `priceU / 100` = полная цена в рублях → сохранить в `products.price`

**Расчёт СПП при sync:**
```
delivery_price = price * (100 - discount) / 100
spp = delivery_price > 0 ? Math.round((1 - sale_price / delivery_price) * 100) : 0
```
Сохранить в `products.spp`.

Пачка: до 100 nmId через `;` в параметре `nm`.

---

## Новая таблица: `stocks` (остатки)

```sql
CREATE TABLE IF NOT EXISTS stocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nm_id INTEGER,
    warehouse TEXT,
    quantity INTEGER DEFAULT 0,
    quantity_full INTEGER DEFAULT 0,
    price REAL DEFAULT 0,
    discount INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stocks_nm ON stocks(nm_id);
```

**Sync:** `POST /api/sync/stocks`:
```
GET https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=2019-01-01T00:00:00
Authorization: {apiKey}
```

Ответ — массив:
```json
{
  "nmId": 322000486,
  "warehouseName": "Коледино",
  "quantity": 150,
  "quantityFull": 157,
  "Price": 1500,
  "Discount": 60,
  "supplierArticle": "SL-8369*6605-MC-9"
}
```

Перед записью — `DELETE FROM stocks`, затем INSERT все записи (полная перезапись).

---

## API Routes (все нужно создать с нуля)

### `GET /api/dashboard` — главный endpoint

**Файл:** `src/app/api/dashboard/route.ts`

Агрегирует все данные для таблицы в один ответ.

**Query параметры:**
- `days` — количество дней (1, 2, 3, 5, 7, 10, 14, 30, 60, 90). По умолчанию: 1

**Логика:**

```typescript
const dateFrom = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const dateTo = new Date().toISOString().slice(0, 10);
```

**SQL-запросы:**

1. **Список товаров (products):**
```sql
SELECT nm_id, vendor_code, title, subject, brand, colors, rating, feedbacks, price, discount, sale_price, spp
FROM products
```

2. **Рекламная статистика по товарам (за период):**
```sql
SELECT
  nm_id,
  SUM(views) as ad_views,
  SUM(clicks) as ad_clicks,
  SUM(sum) as ad_spend,
  SUM(orders) as ad_orders,
  SUM(sum_price) as ad_orders_sum
FROM campaign_stats_by_nm
WHERE date >= ? AND date <= ?
GROUP BY nm_id
```

3. **Воронка (общие корзины/заказы за период):**
```sql
SELECT
  nm_id,
  SUM(add_to_cart_count) as carts_total,
  SUM(orders_count) as orders_total,
  SUM(orders_sum) as orders_sum,
  SUM(buyouts_count) as buyouts_total,
  SUM(buyouts_sum) as buyouts_sum
FROM sales_funnel_daily
WHERE date >= ? AND date <= ?
GROUP BY nm_id
```

4. **Остатки:**
```sql
SELECT nm_id, SUM(quantity) as stock_qty, SUM(quantity * price * (100 - discount) / 100) as stock_value
FROM stocks
GROUP BY nm_id
```

5. **Кампании с маппингом на товары:**
```sql
SELECT advert_id, name, type, status, daily_budget, payment_type, nms_json
FROM campaigns
WHERE status IN (9, 11)
```
Парсить `nms_json` → для каждого nm_id в массиве записать связь.

6. **Расходы кампаний за период:**
```sql
SELECT advert_id, SUM(sum) as spend
FROM campaign_stats_daily
WHERE date >= ? AND date <= ?
GROUP BY advert_id
```

7. **Последние ставки по кампаниям:**
```sql
SELECT DISTINCT advert_id, nm_id, bid_kopecks
FROM bid_history
WHERE (advert_id, nm_id, recorded_at) IN (
  SELECT advert_id, nm_id, MAX(recorded_at)
  FROM bid_history
  GROUP BY advert_id, nm_id
)
```

8. **Видимость (количество поисковых запросов по товару):**
```sql
SELECT nm_id, COUNT(DISTINCT norm_query) as queries_count
FROM search_cluster_stats
WHERE date >= ? AND date <= ?
GROUP BY nm_id
```

9. **Рекламные корзины по товарам (для столбца "Затраты рекл."):**
```sql
SELECT nm_id, SUM(atbs) as ad_carts
FROM search_cluster_stats
WHERE date >= ? AND date <= ?
GROUP BY nm_id
```

**Объединение:** на сервере по nm_id собрать все данные в один объект.

**Response type:**

```typescript
interface DashboardResponse {
  summary: {
    totalOrdersSum: number;
    totalAdsSpend: number;
    totalProducts: number;
  };
  products: DashboardProduct[];
}

interface DashboardProduct {
  // Товар (столбец 1)
  nmId: number;
  vendorCode: string | null;
  title: string | null;
  updatedAt: string | null;

  // Предмет (столбец 2)
  subject: string | null;

  // Цвета (столбец 3)
  colors: string | null;        // "чёрный, белый, серый"

  // Ярлыки (столбец 4) — ЗАГЛУШКА
  labels: string[];             // [] пустой массив

  // Рейтинг (столбец 5)
  rating: number | null;
  feedbacks: number;

  // Цена (столбец 6)
  price: number | null;         // полная цена (руб, без скидок)
  discount: number | null;      // скидка поставщика %
  deliveryPrice: number | null; // цена поставки = price * (100 - discount) / 100
  spp: number | null;           // скидка WB СПП в %
  salePrice: number | null;     // цена покупателю (руб, из card.wb.ru)

  // Остаток (столбец 7)
  stockQty: number;
  stockValue: number;

  // Корзины и заказы общие (столбец 8)
  cartsTotal: number;           // из sales_funnel_daily.add_to_cart_count
  ordersTotal: number;          // из sales_funnel_daily.orders_count
  ordersSum: number;            // из sales_funnel_daily.orders_sum

  // ДРРз (столбец 9) — рассчитать на сервере
  drr: number | null;           // ad_spend / ordersSum * 100

  // Затраты на рекламу (столбец 10)
  adSpend: number;              // из campaign_stats_by_nm.sum
  adOrders: number;             // из campaign_stats_by_nm.orders
  adCarts: number;              // из search_cluster_stats.atbs (корзины с рекламы)
  adClicks: number;             // из campaign_stats_by_nm.clicks
  adViews: number;              // из campaign_stats_by_nm.views

  // Кампании (столбцы 11-13)
  campaigns: CampaignInfo[];

  // Видимость (столбец 14)
  queriesCount: number;         // из search_cluster_stats — COUNT(DISTINCT norm_query)
}

interface CampaignInfo {
  advertId: number;
  name: string;
  status: number;               // 9=активна, 11=пауза
  paymentType: string;          // 'cpm' | 'cpc'
  campaignKind: 'auto' | 'search' | 'cpc'; // определить по имени или type
  bid: number | null;           // последняя ставка (руб = bid_kopecks / 100)
  dailyBudget: number | null;
  spend: number;                // расход за период
}
```

### `POST /api/sync/products` — синхронизация карточек товаров

**Файл:** `src/app/api/sync/products/route.ts`

1. Прочитать API-ключ из `data/wb-api-key.txt`
2. Запросить все карточки от WB Content API (с пагинацией через cursor)
3. Для каждой карточки: UPSERT в таблицу `products`
4. Дополнительно запросить рейтинг/цены через публичный API `card.wb.ru`

### `POST /api/sync/stocks` — синхронизация остатков

**Файл:** `src/app/api/sync/stocks/route.ts`

1. Прочитать API-ключ
2. `GET https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=2019-01-01T00:00:00`
3. `DELETE FROM stocks` + INSERT все записи

### `POST /api/sync/all` — запуск всей синхронизации

**Файл:** `src/app/api/sync/all/route.ts`

Последовательно вызывает:
1. `POST /api/sync/products`
2. `POST /api/sync/stocks`

Возвращает: `{ ok: true, products: N, stocks: N }`

---

## Макет страницы (детальное описание)

### Верхняя навигация (табы)

Горизонтальная строка табов:

| Таб | Реализация |
|---|---|
| Выдача WB | **Заглушка** — неактивный, серый текст, `cursor: not-allowed` |
| Карточки | **Заглушка** — неактивный |
| **Реклама** | Активный таб — подчёркнут акцентным цветом (`var(--accent)`) |
| Настройки | **Заглушка** — неактивный |

Стиль активного: `border-b-2 border-[var(--accent)] text-white font-semibold`
Стиль неактивного: `text-[var(--text-muted)] cursor-not-allowed`

### Панель фильтров (одна строка под табами)

Элементы слева направо:

**1. Кнопка обновления (🔄)**
- SVG-иконка (не эмодзи)
- При клике → `POST /api/sync/all`, затем перезагрузить данные таблицы
- Во время загрузки: `animate-spin` на иконке

**2. Поле поиска**
- `<input>` с placeholder `Артикул`
- Фильтрует на клиенте по `nmId` (число) или `vendorCode` (строка)
- Рядом счётчик: `N (TOTAL)` — показано / всего

**3. Группировка**
- `<select>`: `по склейке` | `по баркоду`
- По умолчанию: `по склейке`
- **Заглушка:** на первом этапе оба варианта показывают одинаково (каждый nmId = строка)

**4. Чекбокс "Архив"**
- `☐ Архив`
- Выкл (по умолчанию): скрыть товары где `stockQty === 0 AND ordersTotal === 0`
- Вкл: показать все товары

**5. Период**
- `<select>` со значениями:

| Label | Значение (дни) |
|---|---|
| Сегодня | 1 |
| 2 дня | 2 |
| 3 дня | 3 |
| 5 дней | 5 |
| Неделя | 7 |
| 10 дней | 10 |
| 2 недели | 14 |
| Месяц | 30 |
| 2 месяца | 60 |
| 3 месяца | 90 |

По умолчанию: **Сегодня**. При смене → перезапросить `GET /api/dashboard?days=N`.

**6. Сводка**
- Текст: `За сегодня* XXX XXX ₽ (-XX XXX ₽)`
- Первое число = `summary.totalOrdersSum` из ответа `/api/dashboard`
- Второе = `summary.totalAdsSpend` (со знаком минус, красным)
- Формат: разделители тысяч пробелами

---

## Столбцы таблицы (14 штук)

### Столбец 1: Товар

**Ширина:** ~300px. **Фиксирован слева** (`position: sticky; left: 0; z-index: 10`).

**Содержимое ячейки:**
- Слева: `<ProductThumb nmId={product.nmId} />` — фото 32×32, rounded
- Справа от фото (вертикальный стек):
  - **Строка 1:** `title` (обрезать с `truncate`/`text-overflow: ellipsis`, max 1 строка)
  - **Строка 2:** `nmId` (серый, мелкий) + `vendorCode` (серый, мелкий, через пробел)
  - Если `title === null` → показать только nmId

**Тултип заголовка:**
```
Наименование товара
Код товара WB    Артикул продавца
Время последнего редактирования карточки
✏ время последнего изменения описания на сайте WB

Клик по заголовку столбца — вкл/выкл сортировка по артикулу
```

**Сортировка:** по `vendorCode` (лексикографическая).

**Данные:** поля `nmId`, `vendorCode`, `title` из ответа `/api/dashboard`.

---

### Столбец 2: Предмет

**Содержимое:** `subject` (например: "Трусы"). Если null → `—`.

**Данные:** `products.subject` из БД.

**Сортировка:** нет.

---

### Столбец 3: Цвета

**Содержимое:** `colors` (например: "чёрный, белый, серый"). Если null → `—`.

**Данные:** `products.colors` из БД.

**Сортировка:** нет.

---

### Столбец 4: Ярлыки

**ЗАГЛУШКА.** Показывать `—`. Тултип заголовка:

```
Ярлыки на карточке
Текущая акция
если пустой красный маркер
— значит товар числится в какой-то акции,
но сама акция не найдена, или уже закончилась
```

---

### Столбец 5: Рейтинг (★)

**Содержимое (2 строки):**
1. `★ 4.8` — звезда (символ `★`, жёлтый/золотой `text-yellow-400`) + рейтинг (1 десятичный знак)
2. `13 255` — количество отзывов (серый, мелкий, с разделителями тысяч)

Если `rating === null` → показать `—`.

**Тултип заголовка:**
```
★ — Рейтинг и кол-во оценок товара

Клик по заголовку столбца — вкл/выкл сортировка по кол-ву оценок
```

**Сортировка:** по `feedbacks` (количество отзывов).

**Данные:** `products.rating`, `products.feedbacks` из БД.

---

### Столбец 6: Цена

**Содержимое (3 строки):**
1. `~600 ₽` — **цена поставки** (цена продавца после его скидки). Формула: `price * (100 - discount) / 100`. Тильда `~` перед числом.
2. `33 %` — **скидка WB "СПП"** (Special Pricing Program — скидка, которую WB даёт покупателю сверх скидки поставщика). Это НЕ скидка поставщика! СПП определяется WB автоматически.
3. `~396 ₽` — **цена покупателю** (`salePrice`). Формула: `цена_поставки × (1 - spp/100)`. С учётом WB-кошелька 2% если применимо.

Откуда брать СПП: из публичного API `card.wb.ru` → рассчитать: `spp = (1 - salePriceU / (priceU * (100 - discount) / 100)) × 100`. Или приблизительно: `salePrice = salePriceU / 100`, а `spp` — разница между ценой поставки и ценой покупателю в %.

Если `price === null` → весь столбец `—`.

**Тултип заголовка:**
```
Цена поставки
(либо базовая, если нет доступа к ценам)

Скидка WB "СПП"
(если есть доступ к инф. о ценах)

Цена покупателю
(с WB кошельком 2%, если применимо)
```

**Сортировка:** нет.

**Данные:** `products.price`, `products.discount` из БД. `salePrice` из публичного API (card.wb.ru), сохранять в products.

---

### Столбец 7: Остаток

**Содержимое (2 строки):**
1. `6 430 шт.` — общий остаток (`stockQty`)
2. `3 858 000 ₽` — стоимость остатков (`stockValue`)

Если `stockQty === 0` → показать `0 шт.` серым.

**Тултип заголовка:**
```
Остаток всего, шт.
Стоимость остатков по ценам поставки (без скидки WB "СПП")
(т.е. сумма своей выручки, если все продать)
(~ если нет данных о СПП, используется цена покупателя)

Клик по заголовку столбца — вкл/выкл сортировка по Стоимости остатков
```

**Сортировка:** по `stockValue`.

**Данные:** из таблицы `stocks` (агрегация по nm_id).

---

### Столбец 8: 🛒 и 🛒 общ. (Корзины и Заказы)

**Содержимое (3 строки):**
1. 🛒 `803` — корзины за период
2. 🛒 `180` — заказы за период (жирный)
3. `205 013 ₽` — сумма заказов

Иконка 🛒 (корзина) перед числами — использовать Unicode или SVG.

**Тултип заголовка:**
```
Корзины и Заказы общие (орг. и рекл.)
Сумма Заказов по ценам поставки (без скидки WB "СПП")

Клик по заголовку столбца — вкл/выкл сортировка по Сумме Заказов
```

**Сортировка:** по `ordersSum`.

**Данные (из `sales_funnel_daily`):**
- `cartsTotal` = SUM(`add_to_cart_count`) за период по nm_id
- `ordersTotal` = SUM(`orders_count`) за период по nm_id
- `ordersSum` = SUM(`orders_sum`) за период по nm_id

---

### Столбец 9: ДРРз

**Содержимое:** один процент.

**Формула:** `ДРРз = (adSpend / ordersSum) × 100`

**Особые случаи:**

| Ситуация | Отображение | Цвет |
|---|---|---|
| ДРРз >= 1% | `8.3 %` (1 десятичный) | зелёный <10%, жёлтый 10-15%, красный >15% |
| 0 < ДРРз < 1% | `.X %` (БЕЗ ведущего нуля! Например: `.5 %`, `.8 %`) | зелёный |
| 0 < ДРРз < 0.1% | `~ %` | зелёный |
| adSpend > 0, ordersSum = 0 | `# %` | красный |
| adSpend = 0, ordersSum = 0 | `—` | серый |
| adSpend = 0, ordersSum > 0 | `0 %` | зелёный |

**Тултип заголовка:**
```
Доля рекламных расходов по отношению к сумме всех заказов
для значений меньше 1% ведущий 0 'целых' не показывается
# % — нет заказов, хотя есть расход по рекламе
~ — сильно меньше 0,1 %
```

**Данные:** расчёт на сервере из `adSpend` и `ordersSum`.

---

### Столбец 10: Затраты рекл.

**Содержимое (3 строки — строго как на скриншоте):**
1. 🛒 `643` × `27 ₽` — **корзины с рекламы** × себестоимость корзины
2. 🛒 `148` × `116 ₽` — **заказы с рекламы** × себестоимость заказа
3. `17 113 ₽` — **общая сумма затрат на рекламу** (жирный шрифт)

Иконки 🛒 на строках 1 и 2 — одинаковые корзины, но строка 1 = корзины, строка 2 = заказы.

**Формулы:**
- Корзины с рекламы = `adCarts` (из `search_cluster_stats.atbs`)
- Заказы с рекламы = `adOrders` (из `campaign_stats_by_nm.orders`)
- Себестоимость корзины = `adSpend / adCarts` (если adCarts > 0, иначе `—`)
- Себестоимость заказа = `adSpend / adOrders` (если adOrders > 0, иначе `—`)
- Общие затраты = `adSpend`

Формат строк 1-2: `{count} 🛒 × {cost} ₽` — число, потом иконка корзины, потом ×, потом стоимость.

Если `adSpend === 0` → показать `—`.

**Тултип заголовка:**
```
Корзины и заказы с рекламы и их "рекламная" себестоимость
Затраты на рекламу
(расчёт по сумме 💰 начислений за рекламу)

Тут учитываются и ассоциированные корзины/заказы,
т.к. они "оплачены" рекламой основного товара

В расшифровке-всплывашке у ячейки справочно указано:
+? — есть ещё корзины/заказы этого товара,
от исходной рекламы других товаров

Клик по заголовку столбца — вкл/выкл сортировка по сумме Затрат
```

**Сортировка:** по `adSpend`.

**Данные:**

Заказы и расход — из `campaign_stats_by_nm`:
```sql
SELECT nm_id, SUM(sum) as ad_spend, SUM(orders) as ad_orders
FROM campaign_stats_by_nm
WHERE date >= ? AND date <= ?
GROUP BY nm_id
```

Корзины с рекламы — из `search_cluster_stats` (поле `atbs` = add to basket):
```sql
SELECT nm_id, SUM(atbs) as ad_carts
FROM search_cluster_stats
WHERE date >= ? AND date <= ?
GROUP BY nm_id
```

---

### Столбец 11: Аук.Uni (единая ставка / автокампания)

**Содержимое:**
- Строка 1: `Uni` + иконка статуса (🟢 активна / ⏸ пауза)
- Строка 2: `141 ₽` — ставка (мелким: "ставка")
- Строка 3: `38 318 ₽` — расход за период

Если нет автокампании у товара → пустая ячейка.

**Определение "автокампания":** кампания из `campaigns` где:
- `nms_json` содержит данный nm_id
- `status IN (9, 11)` (активна или пауза)
- Название содержит "АВТО" или "авто" (регистронезависимо)
- ИЛИ (в будущем) `type` определённого значения

**Тултип заголовка:**
```
Наличие кампании 🎯 Аук.Uni
(единая ставка)

Клик по заголовку столбца — вкл/выкл сортировка
(по статусу и расходу кампании)
```

**Сортировка:** сначала активные (status=9), потом по расходу (spend desc).

**Данные:**
- Кампания: из `campaigns` (через nms_json + фильтр по имени)
- Ставка: из `bid_history` (последняя запись для данного advert_id + nm_id)
- Расход: из `campaign_stats_daily` за период (SUM(sum) WHERE advert_id = ?)

---

### Столбец 12: Аукцион (поиск, ручная ставка)

Аналогично столбцу 11, но для поисковых кампаний.

**Определение:** название содержит "ПОИСК" или "поиск".

**Тултип заголовка:**
```
Наличие кампании 🎯 Аукцион
(ручная ставка, кроме CPC)

Клик по заголовку столбца — вкл/выкл сортировка
(по статусу и расходу кампании)
```

---

### Столбец 13: Аук. 🖱 CPC

Аналогично, для CPC-кампаний.

**Определение:** `payment_type = 'cpc'`.

**Тултип заголовка:**
```
Наличие кампании 🎯 Аукцион 🖱 CPC (оплата за клик)

Клик по заголовку столбца — вкл/выкл сортировка
(по статусу и расходу кампании)
```

**⚠️ В текущей БД все 332 кампании — `payment_type = 'cpm'`. CPC-кампаний нет. Столбец будет пустым — это нормально.**

---

### Столбец 14: Видимость

**Содержимое (2 строки):**
1. `7` + `каталог` — **заглушка** (показать `—`)
2. `650` + `запрос` — количество поисковых запросов

**Данные для запросов:**
```sql
SELECT nm_id, COUNT(DISTINCT norm_query) as queries_count
FROM search_cluster_stats
WHERE date >= ? AND date <= ?
GROUP BY nm_id
```

"Каталог" — **заглушка**, показывать `—`.

**Тултип заголовка:**
```
Каталоги и запросы (кластеры) "зацепившие" карточку
(количество активных запросов абсолютно всё не посчитать,
это оценка относительно других товаров в категории)

Клик по заголовку столбца — вкл/выкл сортировка
(по кол-ву активных запросов на карточке)
```

**Сортировка:** по `queriesCount`.

---

## Поведение таблицы

### Сортировка
- Клик по заголовку: `нет → ↓ убывание → ↑ возрастание → нет`
- Стрелка `↓`/`↑` рядом с текстом заголовка
- Только одна сортировка одновременно

### Тултипы
- Появляются при наведении на **заголовок** столбца
- Задержка: 300ms
- Позиция: под заголовком
- Стиль: `bg-gray-900 text-white text-xs p-3 rounded-lg shadow-xl max-w-xs`

### Sticky столбец
- "Товар" — `sticky left-0 z-10 bg-[var(--bg)]` (фон обязателен, иначе текст просвечивает при скролле)

### Hover строк
- При наведении: `bg-[var(--bg-card-hover)]` на всю строку

### Форматирование чисел
- Разделители тысяч: пробелы. Использовать `toLocaleString('ru-RU')`
- Рубли: `₽` через пробел после числа
- Проценты: `%` через пробел
- Пустые значения: прочерк `—` (em-dash, не минус)

---

## Файловая структура

```
src/
  app/
    page.tsx                         — главная страница (дашборд)
    layout.tsx                       — layout (уже есть, доработать — подключить globals.css)
    globals.css                      — CSS переменные и стили
    api/
      dashboard/route.ts             — GET /api/dashboard?days=N
      sync/
        products/route.ts            — POST /api/sync/products
        stocks/route.ts              — POST /api/sync/stocks
        all/route.ts                 — POST /api/sync/all

  components/
    AdsNavigation.tsx                — табы (Выдача WB / Карточки / Реклама / Настройки)
    AdsFilters.tsx                   — панель фильтров
    AdsTable.tsx                     — обёртка таблицы (скролл, загрузка данных)
    AdsTableHeader.tsx               — строка заголовков с тултипами и сортировкой
    AdsTableRow.tsx                  — одна строка товара
    ProductThumb.tsx                 — миниатюра товара (32×32)
    Tooltip.tsx                      — переиспользуемый тултип
    columns/
      ProductCell.tsx
      SubjectCell.tsx
      ColorsCell.tsx
      LabelsCell.tsx
      RatingCell.tsx
      PriceCell.tsx
      StockCell.tsx
      OrdersCell.tsx
      DrrCell.tsx
      AdsSpendCell.tsx
      CampaignCell.tsx               — универсальный (для Uni / Аукцион / CPC)
      VisibilityCell.tsx

  lib/
    db.ts                            — уже есть
    wb-image.ts                      — URL фото товара (создать)
    api-key.ts                       — чтение API-ключа (создать)
    format.ts                        — форматирование чисел/рублей (создать)

  types/
    index.ts                         — все типы (DashboardProduct, CampaignInfo, etc.)
```

---

## Заглушки (что НЕ реализуем)

| Что | Показывать | Почему |
|---|---|---|
| Ярлыки / Акции (столбец 4) | `—` | Нет WB API для акций |
| Каталоги (в столбце 14) | `—` | Нет данных |
| Группировка "по склейке" | Каждый nmId = строка | Нет parent nmId |
| Селектор аккаунта | Не показывать | Один аккаунт |
| Табы навигации (кроме "Реклама") | Неактивные | Будущая функциональность |
| CPC-кампании (столбец 13) | Пустая ячейка | В БД нет CPC-кампаний |

---

## Порядок реализации

### Шаг 1: Инфраструктура
1. `src/app/globals.css` — стили
2. Обновить `src/app/layout.tsx` — подключить globals.css
3. `src/lib/wb-image.ts` — утилита фото
4. `src/lib/api-key.ts` — чтение ключа
5. `src/lib/format.ts` — форматирование чисел
6. `src/types/index.ts` — все типы
7. Миграция БД: добавить таблицы `products` и `stocks` (в init-db.ts)

### Шаг 2: API
1. `POST /api/sync/products` — синхронизация карточек
2. `POST /api/sync/stocks` — синхронизация остатков
3. `POST /api/sync/all` — общая синхронизация
4. `GET /api/dashboard?days=N` — главный endpoint
5. Запустить синхронизацию для заполнения данных

### Шаг 3: UI — каркас
1. `src/components/AdsNavigation.tsx`
2. `src/components/AdsFilters.tsx`
3. `src/components/Tooltip.tsx`
4. `src/app/page.tsx` — собрать каркас

### Шаг 4: UI — таблица
1. `src/components/AdsTable.tsx` + `AdsTableHeader.tsx`
2. `src/components/AdsTableRow.tsx`
3. Все `columns/*.tsx` (14 ячеек)
4. `src/components/ProductThumb.tsx`

### Шаг 5: Интерактивность
1. Сортировка (state в AdsTable)
2. Фильтрация по артикулу
3. Переключение периода
4. Чекбокс "Архив"
5. Кнопка обновления (sync)

### Проверка:
```bash
npm run dev
# Открыть http://localhost:3001
# 1. Видны табы навигации, "Реклама" активна
# 2. Панель фильтров с периодом, поиском
# 3. Таблица с 14 столбцами
# 4. Данные загружены (если sync выполнен)
# 5. Сортировка работает
# 6. Скролл горизонтальный, "Товар" фиксирован
```
