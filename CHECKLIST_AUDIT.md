# Чек-лист аудита Базы знаний (KnowledgeBase.tsx)

> Этот чек-лист используется для полной верификации и обновления Базы знаний.
> LLM должен пройти каждый пункт, прочитать РЕАЛЬНЫЙ код/БД, сравнить с KnowledgeBase.tsx и исправить расхождения.
> ЗАПРЕЩЕНО использовать память или кэш — только свежее чтение файлов.

---

## 1. База данных

### 1.1 Количество таблиц
```bash
sqlite3 data/ads.db "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence'"
```
→ Сравнить с разделом `tables` в KnowledgeBase.tsx. Число должно совпадать в заголовке раздела.

### 1.2 Список таблиц
```bash
sqlite3 data/ads.db "SELECT name FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence' ORDER BY name"
```
→ Убедиться что ВСЕ таблицы перечислены в разделе `tables`. Если появились новые — добавить с описанием. Если удалены — убрать.

### 1.3 Кампании по статусам
```bash
sqlite3 data/ads.db "SELECT status, COUNT(*) FROM campaigns GROUP BY status"
```
→ Обновить раздел `store` → "Кампании". Формат: "X активных + Y на паузе + Z завершённых".
- status 9 = активные
- status 11 = на паузе
- status 7 = завершённые

### 1.4 Количество товаров
```bash
sqlite3 data/ads.db "SELECT COUNT(*) FROM products"
```
→ Обновить раздел `store` → "Товаров".

### 1.5 Settings ключи
```bash
sqlite3 data/ads.db "SELECT key FROM settings ORDER BY key"
```
→ Обновить раздел `architecture` → "Настройки в БД". Число ключей + перечисление.

---

## 2. Верхняя таблица

### 2.1 Столбцы
Прочитать файл: `src/components/AdsTableHeader.tsx`
Найти массив `COLUMNS` и посчитать элементы.
Для каждого столбца записать: key, label (текст или описание иконки), tooltip (первая строка).
→ Сравнить с разделом `upper-cols`. Количество и описания должны совпадать.

### 2.2 Иконки в заголовках
Прочитать файл: `src/components/AdsTableHeader.tsx`
Какие иконки импортируются и где используются.
→ Убедиться что раздел `upper-cols` правильно описывает иконки (глаз, корзина, коробка).

---

## 3. Нижняя таблица (DetailPanel)

### 3.1 Столбцы
Прочитать файл: `src/components/DetailPanel.tsx`
Найти массив `COLS` и посчитать элементы.
Для каждого записать: key, label (текст или иконка), tooltip.
→ Сравнить с разделом `lower-cols`. Количество и описания должны совпадать.

### 3.2 Вкладки
В том же файле найти массив `tabs`.
→ Сравнить с разделом `detail-panel` → "Вкладки".

### 3.3 Подвкладки портрета покупателя
Найти в `BuyerEntryPoints` компоненте массив с source-табами (wb/traffic/entry).
→ Сравнить с разделом `detail-panel` → "Портрет покупателя".

### 3.4 Группы трафика
Найти `GROUP_MAP` и `GROUP_COLORS` и `GROUP_ORDER`.
→ Сравнить с разделом `detail-panel` → "Группы трафика". Проверить порядок.

### 3.5 Дефолтные ширины столбцов
Найти объект `DEFAULT_W`.
→ Не нужно в КБ, но убедиться что все ключи из COLS есть в DEFAULT_W.

---

## 4. Синхронизация

### 4.1 SyncModal шаги
Прочитать файл: `src/components/SyncModal.tsx`
Найти массивы `API_STEPS` и `DJEM_STEPS`.
→ Сравнить с разделом `sync`. Количество и названия шагов.

### 4.2 Ретрай
В том же файле найти `RETRY_DELAY` и `MAX_RETRIES`.
→ Сравнить с разделом `sync` → "Ретрай".

### 4.3 Серверный авто-синк
Прочитать файл: `src/lib/auto-sync-server.ts`
Найти массив `SYNC_STEPS`, переменную `BASE`.
→ Сравнить с разделом `sync`. Убедиться что шаги совпадают с SyncModal.

### 4.4 ControlPanel авто-синк
Прочитать файл: `src/components/ControlPanel.tsx`
Найти: INTERVALS, THEMES, как вызывается `/api/auto-sync`.
→ Проверить что раздел `architecture` корректно описывает авто-синк.

### 4.5 Buyer-profile скорости
Прочитать файл: `src/app/api/sync/buyer-profile/route.ts`
Найти: `PARALLEL_FAST`, `PARALLEL_SLOW`, `PAUSE_FAST`, `PAUSE_SLOW`.
→ Сравнить с разделом `sync` → buyer-profile.

### 4.6 Auth-wb-funnel параллельность
Прочитать файл: `src/app/api/sync/auth-wb-funnel/route.ts`
Найти: `PARALLEL`, паузу `sleep(...)`.
→ Сравнить с разделом `sync` → auth-wb-funnel и `djem`.

### 4.7 Funnel — какие товары
Прочитать файл: `src/app/api/sync/funnel/route.ts`
Строка с запросом nmIds — из `products` или из `campaigns`?
→ Сравнить с разделом `sync` → funnel.

---

## 5. Формулы

### 5.1 Гибрид воронки
Прочитать файл: `src/app/api/dashboard/route.ts`
Найти SQL с `FULL OUTER JOIN` и `MAX()`.
→ Сравнить с разделом `hybrid`.

### 5.2 xP себестоимость
Прочитать файл: `src/app/api/product-detail/route.ts`
Найти `cartCostAd` и `orderCostAd` — для одиночного товара и для isAll.
→ Сравнить с разделом `assoc` → "xP корзины" и "xP заказы".

### 5.3 adClickToCart
В том же файле найти `adClickToCart` — для одиночного товара и для isAll.
→ Сравнить с разделом `assoc` → "adClickToCart".

### 5.4 "Весь магазин" агрегация
В том же файле проверить isAll ветку — сначала MAX по товару, потом SUM?
→ Сравнить с разделом `hybrid` → "Весь магазин".

---

## 6. Puppeteer

### 6.1 Sniffer
Прочитать файл: `src/lib/wb-sniffer.ts`
- CDP включён или отключён? (искать "Network.enable" или "CDP")
- userDataDir — какой путь?
- Anti-detect args — какие?
- evaluateOnNewDocument — что делает?
→ Сравнить с разделом `browser`.

### 6.2 ensureBrowser
Прочитать файл: `src/lib/ensure-browser.ts`
- Что экспортирует?
- Как предотвращает дублирование?
→ Сравнить с разделом `browser` → "Автозапуск".

### 6.3 Auto-sync route
Прочитать файл: `src/app/api/auto-sync/route.ts`
- Что импортирует?
- GET/POST — что делают?
→ Убедиться что раздел `sync` описывает серверный авто-синк.

---

## 7. Иконки

### 7.1 Список иконок
Прочитать файл: `src/components/icons.tsx`
Посчитать все экспортируемые функции.
→ Сравнить с разделом `architecture` → "Иконки". Количество и названия.

---

## 8. Типы и периоды

### 8.1 PERIOD_OPTIONS
Прочитать файл: `src/types/index.ts`
Найти массив `PERIOD_OPTIONS`.
→ Проверить что раздел `architecture` → "Период 'Вчера'" корректно описывает offset.

### 8.2 DashboardProduct
В том же файле проверить интерфейс `DashboardProduct`.
→ Убедиться что поля viewCount, openCardCount, buyoutsCount, buyoutsSum присутствуют.

---

## 9. Контекстные файлы

### 9.1 Проверить наличие
```bash
ls -la PROJECT_CONTEXT.md TODO.md CLAUDE.md TECHNICAL_SPEC.md
```
→ Убедиться что раздел `architecture` упоминает все контекстные файлы.

### 9.2 Git
```bash
git remote -v
git log --oneline -1
```
→ Проверить что раздел `architecture` содержит ссылку на GitHub.

---

## 10. CSS и темы

### 10.1 Темы
Прочитать файл: `src/app/globals.css`
Посчитать data-theme варианты.
→ Сравнить с разделом `architecture` → "Темы".

### 10.2 Скролбары
В том же файле — есть ли стили для скролбаров?
→ Убедиться что это отражено в КБ (раздел `decisions` или `architecture`).

---

## 11. WB API серверы

### 11.1 Все используемые хосты
```bash
grep -rh "wildberries.ru" src/app/api/sync/ src/lib/ | grep -oE 'https://[a-z-]+\.wildberries\.ru' | sort -u
```
→ Сравнить с разделом `api`. Все серверы должны быть перечислены.

---

## 12. API routes

### 12.1 Список всех route-файлов
```bash
find src/app/api -name "route.ts" | sort
```
Для каждого файла: какие методы экспортирует (GET/POST/PUT/DELETE)?
→ Убедиться что ВСЕ API routes упомянуты в КБ (разделы `sync`, `architecture` или др.)

### 12.2 buyer-profile GET
Прочитать файл: `src/app/api/buyer-profile/route.ts`
- Читает из БД или live-запрос?
- Как кэширует однодневные запросы?
- Как обрабатывает offset?
→ Убедиться что раздел `djem` или `detail-panel` корректно описывает логику.

### 12.3 sync-log POST
Прочитать файл: `src/app/api/sync-log/route.ts`
- Используется `??` (nullish) или `||` (logical or) для body.errors/body.success?
- Если `||` — это баг (0 считается falsy).
→ Убедиться что используется `??`.

---

## 13. Ассоциированные конверсии

### 13.1 Компоненты
Прочитать файл: `src/components/DetailPanel.tsx`
Найти функции `AssocCell` и `AssocOutCell`.
- Что показывают?
- Какой формат? (1207+154)
- Есть ли тултип? Какие поля в нём?
→ Сравнить с разделом `assoc` и `detail-panel`.

### 13.2 Данные для ассоциированных
Прочитать файл: `src/app/api/product-detail/route.ts`
- Как определяются direct vs associated? (views>0 = direct?)
- Откуда берутся assocIN и assocOUT?
- assocOutDetails — какие поля? (sourceNmId, vendorCode, carts, orders, sumPrice)
→ Сравнить с разделом `assoc`.

---

## 14. Форматирование и утилиты

### 14.1 format.ts
Прочитать файл: `src/lib/format.ts`
Список всех экспортируемых функций: localDateStr, fmtNum, fmtRub, fmtPct, fmtDrr.
→ Убедиться что `localDateStr` упомянут в разделе `architecture` (часовой пояс).

### 14.2 cellValue в DetailPanel
В `DetailPanel.tsx` найти функцию `cellValue`.
- Какие ключи используют `String()` (без пробелов) vs `fmtNum()` (с пробелами)?
- Формат adClicks: `{clicks} x {cpc} ₽`
- Формат adCarts/adOrders: `{direct}+{assocIN}`
→ Сравнить с разделом `lower-cols` и `decisions` → "Числа без пробелов".

---

## 15. Визуальные компоненты

### 15.1 Tooltip
Прочитать файл: `src/components/Tooltip.tsx`
- Задержка показа (setTimeout значение)?
- whitespace: nowrap или pre-line? (логика с `\n`)
- Стилизация: рамка акцентная? фон?
→ Убедиться что раздел `decisions` упоминает тултипы.

### 15.2 CampaignCell — StatusBadge
Прочитать файл: `src/components/columns/CampaignCell.tsx`
- Цвет для active (status=9)? → success/зелёный
- Цвет для paused (status=11)? → danger/красный
→ Сравнить с разделом `decisions` → "Пауза красная".

### 15.3 OrdersCell
Прочитать файл: `src/components/columns/OrdersCell.tsx`
- Какие поля принимает? (viewCount, carts, orders, ordersSum)
- Есть ли buyoutsCount? (должен быть УБРАН)
→ Сравнить с разделом `upper-cols` → "Воронка".

### 15.4 Подсветка выходных
В `DetailPanel.tsx` найти `isSaturday`, `isSunday`.
- Как определяется день недели? (`new Date(row.date + "T12:00:00").getDay()`)
- Что делается для Сб? (жёлтый цвет даты через inline style)
- Что делается для Вс? (жёлтая полоска слева через borderLeft)
→ Сравнить с разделом `decisions` → "Выходные".

### 15.5 Молния последнего синка
В `DetailPanel.tsx` найти `syncAgoText`, `syncTimeText`, `lastSyncTime`.
- Откуда берётся время? (`/api/settings` → `last_sync_time`)
- Как часто обновляется? (setInterval)
- Тултип — через Tooltip компонент?
→ Убедиться что раздел `detail-panel` описывает молнию.

---

## 16. Offset и периоды

### 16.1 PERIOD_OPTIONS
Прочитать файл: `src/types/index.ts`
Найти массив `PERIOD_OPTIONS`.
- Сколько периодов?
- Какие имеют offset > 0?
→ Сравнить с разделом `architecture` → "Период 'Вчера'".

### 16.2 Offset в dashboard
Прочитать файл: `src/app/api/dashboard/route.ts`
- Как читается offset из query string?
- Формула: `dateTo = localDateStr(new Date(Date.now() - offset * 86400000))`
→ Убедиться что раздел `decisions` описывает offset.

### 16.3 Offset в buyer-profile
Прочитать файл: `src/app/api/buyer-profile/route.ts`
- Читает offset?
- Передаёт в запрос к WB?
→ Проверить что offset прокинут через всю цепочку.

---

## 17. Глубокий синк

### 17.1 Условие срабатывания
Прочитать файл: `src/lib/auto-sync-server.ts`
Найти логику `isDeep` — как определяется?
- Час >= 9?
- deepSyncDate !== today?
- Что записывается после глубокого синка?
→ Сравнить с разделом `sync` → "Глубокий синк".

### 17.2 Что меняется при глубоком синке
- djemDays = 3 вместо 1
- Какие именно endpoints получают days=3?
→ Проверить что оба djem-шага (auth-wb-funnel И buyer-profile) получают days=3.

---

## Процедура обновления

1. Пройти ВСЕ пункты выше
2. Для каждого расхождения — исправить в `src/components/KnowledgeBase.tsx`
3. После всех исправлений — `npx tsc --noEmit` для проверки
4. Записать количество найденных расхождений и что исправлено

---

## Когда проводить аудит

- После каждой сессии длиннее 2 часов
- После добавления новых таблиц, столбцов, sync-роутов
- По запросу пользователя "проверь базу знаний"
- Перед коммитом в git
