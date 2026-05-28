# WB Ads — Контекст проекта

> Этот файл — память между сессиями. Перечитывай его в начале каждой новой сессии.
> Быстрый старт текущей точки остановки — `SESSION_STATE.md`; обновляется командой `npm run save-session-state`. Этот файл остаётся подробной энциклопедией проекта.
> Также есть База знаний в дашборде (иконка книги, `src/components/KnowledgeBase.tsx`).

---

## Что это

Дашборд управления рекламой Wildberries. Самостоятельный проект.

- **Стек:** Next.js 16 + TypeScript + Tailwind CSS 4 + PostgreSQL prod + SQLite compatibility/migration scripts + Puppeteer
- **Порт:** 3001
- **Prod:** `https://ads.imaxprom.site`, приложение на VM108 (`wb-ads`, `wb-ads-worker`)
- **БД prod:** VM107 PostgreSQL `wb_ads_prod` (50 таблиц, 374 MB, проверено 29 мая 2026)
- **Локально:** `data/ads.db` может существовать как legacy/dev snapshot, но после переезда не является главным источником истины
- **Chrome профиль:** `data/chrome-profile/` (персистентный, сессия WB сохраняется)
- **API-ключ WB:** `data/wb-api-key.txt`
- **API-ключ WB Prices:** `data/wb-prices-api-key.txt` (read-only prices scope; используется `/api/sync/products` для цен)
- **Токены авторизации WB:** `data/wb-tokens.json`
- **Сборка:** `next.config.ts` исключает `./next.config.ts` из output file tracing для `/api/ai-diary`. Это фикс постоянного Turbopack/NFT warning, где CLI-обвязка ai-diary подтягивала конфиг в runtime trace.

---

## Архитектура

### Верхняя таблица вкладки «Карточки» (14 столбцов)
Товар (sticky) | Предмет | Цвета | Акции | ★ Рейтинг | Цена | Остаток | Воронка (глаз+корзина+коробка) | ДРРз | Затраты рекл. | Авто | Аукцион | CPC | Видимость

### Нижняя панель Карточек (SplitPane)
- Карточка товара (фото+инфо, resize) + табы справа
- **5 вкладок:** Воронка продаж | Портрет покупателя | Остатки | Каталоги | Запросы
- Воронка: drag/resize/hide столбцов, настройки в БД, выделение строки кликом
- Выходные (Сб/Вс): жёлтая дата + полоска слева
- Стартовая высота нижней панели на вкладке «Карточки» зафиксирована под 11 последних дней, чтобы нижняя таблица не делилась пополам посередине экрана.

### Верхняя таблица вкладки «Реклама» (16 столбцов на 26 апр 2026)
Товар (sticky) | Камп. | Зоны | Ставка/Бюджет | **Показы** | **Клики** | **Заказы** | **Воронка** | **Доля затрат** | CTR | Затраты | День | Конверсии | Корз./Заказы | ДРРк/Выручка | Счет/Опл

- **Товар** (3 строки): название кампании, артикул+предмет, «создана {дата}»
- **Камп.** (4 строки): тип (Uni/Аук./Q/Рек), advert_id, статус («активна»/«пауза»/«архив»), `fmtChangeTime(changeTime)` — последнее изменение
  - Запуск/пауза подтверждаются локальным popover рядом с кнопкой статуса в стиле проекта; `window.confirm()` не используется.
- **Зоны** — Поиск/Каталог/Полки в виде CSS Grid (число → лейбл, друг под другом). Источник — `campaign_days` (через `views_search/views_catalog/views_reco`). Уметь показывать «—», если зона неактивна и без данных
- **Ставка/Бюджет** (2-колоночный grid):
  - Ставка (для Uni/CPC — клик-редактор `BidEditCell` в `displayMode="pill"`, без изменения размера/шрифта ячейки; для прочих — read-only) + тултип «История изменений ставки» слева
  - Бюджет (клик → `BudgetDepositModal`) + тултип «История пополнений» слева
  - Подчёркивание hover **accent-цветом** (фиолет под фиолетом)
- **Показы / Клики / Заказы / Доля затрат** (новые 26 апр 2026, центр-выравнивание, 3-строчная вёрстка):
  - 1-я строка — основное число (показы / клики / заказы / DRR%);
  - 2-я строка серым — лейбл (CPM / CTR · CPC / CR · CPO / Заказы · Расход);
  - 3-я строка серым — расчётное значение (CPM ₽ / % · ₽ / % · ₽ / ₽ · ₽).
  - У «Доля затрат» 1-я строка цветная: ≤10 зелёный, ≤15 жёлтый, иначе красный; «## %» — расход без заказов. Текущая формула берёт `campaign_stats_daily.sum_price`, то есть общий DRR кампании с ассоциированными заказами. Если нужен DRR только рекламируемого товара, считать отдельно из `campaign_stats_by_nm` по `campaigns.nms_json`.
- **Воронка** — две колонки внутри ячейки: Корзины (сверху % клик→корзина, посередине лейбл, снизу `N шт`) и Заказы (% корзина→заказ, лейбл, `N шт`).
- **CTR / Конверсии / ДРРк/Выручка** — оставлены, дублируют новые колонки. Можно скрыть через шестерёнку.
- Клик по строке → подсветка `bg-accent/25` + панель снизу (SplitPane fitParent)
- Шестерёнка в шапке — скрытие/показ столбцов
- **Мердж сохранённого `ads_col_order`** (с 26 апр 2026): новые столбцы вставляются на свою дефолтную позицию относительно существующих соседей, удалённые — отбрасываются. Раньше при разнице длин просто сбрасывалось на дефолт

### Нижняя панель Реклама (AdCampaignDetailPanel, SplitPane fitParent)
- Карточка кампании + две вкладки справа (шестерёнка настроек на каждой)
- Tab persistence: `settings.ad_panel_tab`, state в AdsCampaignsTable родителе (переживает key-remount)
- `key={advertId}` на AdCampaignDetailPanel — full remount при смене кампании

**Вкладка «По дням»:** Ср.поз, Все/Поиск/Полки/Кат. (зоны), CTR, Клики×CPC, CPM, Счёт, Корзины (own+assoc), Заказы (own+assoc), ДРРк, Выручка
  - Summary сверху «Сегодня: все зоны / поиск / полки / каталоги»
  - Всегда грузит 90 дней, независимо от фильтра сверху

**Вкладка «Запросы»:** Позиция, Буст, 🔍×₽ (ставка), Ср.поз, **Кластер**, ~👁 (частотность WB), Доля, 👁, CTR, 👆, Р/клик, Счёт, CPM, 🔍/нед, ⚡, 🛒, 📦, 🛒×₽, 📦×₽, **Джем** (воронка), Meta, Meta 2 (**20+ столбцов** + master-checkbox)
  - **DateSidebar** слева (90 дней): single-click = день, dblclick+dblclick = range. Выходные оранжевые.
  - **Кнопки-фильтров:** Наша ставка (default) / Управляемые / Активные / Исключения / Все / Отложенные искл. (disabled).
    - Для **Uni-кампаний** (placements.search && recommendations, bidType !== "manual") кнопка «Наша ставка» **скрывается**, дефолт переключается на «Управляемые» — у Uni нет ручных ставок, WB сам рулит по кластерам.
    - Фильтр «Наша ставка» исключает excluded (`has_custom_bid && effType !== "excluded"`); fallback через children пропускается, если сам parent уже excluded (иначе исключённый кластер прилипал к «Управляемые»/«Активные»).
    - Счётчики считают **кластеры**, не плоские фразы.
  - Тултипы на кнопках через React Portal (обход overflow-hidden)
  - Поле поиска (без разделителей)
  - Кнопки ↻ (refresh force), 📄 (журнал позиций), 🗂 (наши кластеры)
  - **Tree-view кластеров**: parent ▸ child, отступ child `2.5rem`. У child скрыты Позиция/Буст/Ставка/Ср.поз — только у parent можно править. При раскрытии parent показываются все его children из `allChildrenByParent`, даже если текущий фильтр («Наша ставка») матчится только по одному child.
  - Частотность WB в колонке `~👁` — из таблицы `search_texts_wb`. Для parent — сумма по всем phrases кластера, с тултипом inner-фраз.
  - Ставка в `actual_cpm/100` (accent) или `min_cpm_search` (серый fallback) или `—`
  - **ПКМ меню**: Исключить запрос / Вернуть из исключений. Кластерное действие шлёт `cascadeByPreset`/`cascadePresetId`: сервер расширяет parent до aliases того же `preset_id`; UI показывает confirm с числом видимых фраз WB-кластера.
  - **Batch-выделение** через чекбоксы (только у top-level), master-checkbox в заголовке, toolbar при ≥1 выбранной
  - Колонка «Доля» считается как купленные рекламные показы / общая частотность фразы (`views / ~👁 × 100`) и не обрезается до 100%, потому что источники могут обновляться несинхронно.
  - Автообновление позиций при открытии активной кампании:
    - manual/Аукцион: автооткрывается «Запросы → Наша ставка», в очередь идут `has_custom_bid` фразы;
    - Uni: автооткрывается «Запросы → Управляемые», в очередь идут `common` фразы.
  - Очередь позиций работает batch-first: сначала `/api/sync/phrase-positions-batch` одним SSH, затем `/api/sync/phrase-position-one` с 5 попытками только для фраз без результата. После финального неуспеха UI оставляет прочерки, чтобы не показывать старую позицию как актуальную.
  - pendingExcluded Map → оптимистичный UI, снимается когда qKeywords подтвердили

### ControlPanel (правый верхний угол)
- Кнопка ручной синхронизации → SyncModal
- Кнопка «Тест» → TestSyncModal: ручной прогон `fullstat-v3`/`fullstat-v3-daily` с настройками пауз, дней, режима и журналом детальных событий
- «тест авто»: отдельное расписание автотеста. Берёт сохранённые endpoints/паузы из TestSyncModal, но для `v3-daily` включает smart-дату: сегодня каждый запуск, вчера только после 09:00 МСК до первого успешного закрытия
- Журнал тестов в ControlPanel показывает время в МСК, раскрывает timeline, карточки, 429/ошибки и running-статус
- Иконки журналов — загораются красным только при новой непросмотренной ошибке за последние 24 часа. После открытия/обновления журнала последний проблемный `id` сохраняется в `settings.test_log_ack_error_id` или `settings.sync_log_ack_error_id`, и иконка гаснет до следующей новой ошибки. Последующий успешный прогон сам не гасит непросмотренную ошибку.
- Авто-синк: чекбокс + интервал + обратный отсчёт
- База знаний, темы, "X мин. с последнего синка"

---

## Синхронизация

### Серверный авто-синк (auto-sync-server.ts)
- Работает на Node.js, не зависит от вкладки браузера
- Глубокий синк в 9:00+ (days=3 вместо days=1)
- Ежедневная проверка сессии в 22:00 МСК (`/api/accounts/check-session`)
- **06:00 МСК** — `scheduleSearchTextsSync` — snapshot WB premium частотности по всем subject_id активных кампаний
- **Каждые 60 мин** — `scheduleDjemDaily` — heal-тик по всем active nmIds (`campaigns.status IN (9,11)`), серийно вызывает `/api/sync/phrase-djem-daily?mode=auto` для каждого. Новый кабинет → bootstrap 90 дней × N артикулов. Существующий → только missing + today (несколько секунд на артикул). После 09:00 МСК yesterday пересинкается, если `updated_at` старше сегодняшних 09:00 (ловит поздние апдейты WB).
- `scheduleTestSync` — отдельный автотест `fullstat-v3`/`fullstat-v3-daily` по настройкам TestSyncModal. Статус `test-auto` считает running=true, если активен wrapper, orchestrator или дочерний `fullstat` endpoint.

### Открытый API в auto-sync (sequential, `SYNC_STEPS`)
`src/lib/auto-sync-server.ts:10`:
| Endpoint | Что делает |
|---|---|
| /api/sync/campaigns | Кампании + ставки |
| /api/sync/products | Карточки + цены |
| /api/sync/stocks | Остатки |
| /api/sync/supplier-orders?days=3 | Заказы WB Statistics API `/api/v1/supplier/orders` → `supplier_orders`; источник СПП в нижней воронке карточек. Endpoint поддерживает `days=90` одним запросом для первичной загрузки |
| /api/sync/stats | `/adv/v3/fullstats` (GET), apps[].nms[] → direct vs associated. Иногда 429/502 от WB — retry не делаем |
| /api/sync/balance | Баланс + бюджеты. Бюджеты запрашиваются для активных и паузных кампаний (`status IN (9,11)`), архив не трогаем |
| /api/sync/expense-history | **Фактические списания WB** через `/adv/v1/upd` за последние 7 дней. Full-refresh окна (DELETE+INSERT в транзакции). Пишет в `expense_history`. Используется для `paidPeriod` в `/api/ads`/`AccountCell`. Добавлен 26 апр 2026 |
| /api/sync/clusters | Поисковые кластеры (старое) |
| /api/sync/normquery-bids | Ставки CPM (`/adv/v0/normquery/get-bids`) |
| /api/sync/normquery-stats?days=1 | per-phrase avg_pos/cpm/atbs/orders (`/adv/v0/normquery/stats`) |
| /api/sync/preset-info-open | **Гибрид open API списка фраз** — `/adv/v0/normquery/list` (camelCase!) + `get-bids` + `stats`. Без Puppeteer. UPSERT с MAX-семантикой в `campaign_preset_keywords`. Идёт перед closed `preset-info`. Добавлен 26 апр 2026 |
| /api/sync/preset-info | Полный срез фраз per (advert × nm_id) — управляемые + исключения (закрытый cmp API, кэш 10м). Дополняет open: бьёт «хвост» фраз с views=0 + поле shks |
| /api/sync/supplier-subjects | Минимальные CPM по предметам — **2 запроса**: `bid_type=2` (ручной аукцион) + `bid_type=1` (Uni). Сохраняет в `subject_min_cpm.min_cpm_search` и `min_cpm_unified` соответственно. Кэш 24ч |
| /api/sync/funnel?days=1 | Воронка открытая (все товары) |

### Auto-sync retry (с 26 апр 2026)
После первого прохода всех 17 шагов — собираем фейлы и до **5 раз** ретраим каждый с **30-секундной паузой**. На успех помечаем `ok:true` с `error="OK on retry N"`. В `sync_log.error_details` добавлено поле `retries`. Lifesaver для `/adv/v3/fullstats` 429.

### СПП / supplier-orders (с 18 мая 2026)
- `supplier_orders` заполняется из WB Statistics API `/api/v1/supplier/orders`.
- В основном `SYNC_STEPS` есть `/api/sync/supplier-orders?days=3`; ручная модалка синка также содержит шаг «Заказы WB / СПП (3 дня)».
- Первичная загрузка поддерживает `days=90`, но для регулярного auto-sync достаточно 3 дней.
- В нижней таблице «Карточки → Воронка продаж» столбец «СПП» показывает среднюю СПП по заказам за день. Для всего магазина считается средняя по всем товарам.
- Тултип СПП показывает 24 почасовые строки и отдельный блок по федеральным округам (`ФО`): средняя СПП и количество заказов. Колонки «СПП» и «заказы» выровнены между блоками, popup подстраивает высоту и оставляет нижний отступ, чтобы не упираться в край экрана.
- Верхняя таблица «Карточки», столбец «Цена»: вторая строка теперь явно подписана как `СПП N,N %` и берётся из `supplier_orders` за выбранный период/день, то есть синхронна с нижней таблицей.

### Зоны рекламы: каталог как остаток (с 18 мая 2026)
- `fullstat-v3` определяет листы xlsx по именам, а не по номеру: ключевые фразы → поиск, рекомендации → полки, каталог → каталог.
- Лист `Рекомендации` не пишется в `campaign_catalogs` и не считается каталогом.
- `views_catalog` в `campaign_days` считается остатком: `max(0, views_total - views_search - views_reco)`, где `views_total` берётся из xlsx и/или `campaign_stats_daily.views`.
- `/api/sync/stats` при обновлении totals также патчит `campaign_days.views_total/views_catalog`, чтобы UI и БД не расходились.
- `/api/ad-campaign-detail` пересчитывает каталог той же формулой при отдаче дней.
- Проценты зон в верхней и нижней рекламной таблицах округляются общим helper'ом `roundedZonePercents`: целые проценты, сумма 100%, ненулевая зона получает минимум 1%.

### Фотографии товаров (обновлено 21 мая 2026)
- `ProductThumb` поддерживает `version`, а `/api/ads` отдаёт `firstProductUpdatedAt`.
- WB меняет/смещает номера `basket-NN` для новых nmId: жёсткая формула давала 404 на части артикулов. `getWbImageCandidateUrls` теперь строит основной URL и fallback-кандидаты basket offset `±1..±8`.
- `ProductThumb` перебирает кандидаты и дополнительно делает cache-buster retry через 3/10/30 секунд после неудачи.
- Верхняя таблица рекламы, карточка кампании и крупные изображения используют кандидаты + `withImageVersion(..., updated_at)`, чтобы WB/CDN/браузер не держали старое фото после обновления карточки.

**ЗАКОММЕНТИРОВАНЫ в основном auto-sync** (не входят в `SYNC_STEPS`; гоняются через Test-panel / отдельный test-auto):
- `/api/sync/fullstat-v3` — xlsx 30 дней: зоны, фразы, каталоги, реко
- `/api/sync/fullstat-v3-daily` — xlsx per-day: avg_position per product

### Test-auto и `fullstat-v3-daily` smart-режим (обновлено 26 мая 2026)
- Ручной запуск из TestSyncModal использует настройку `days` буквально: если стоит 2 дня, тянет сегодня+вчера.
- Авто-тест передаёт `v3DailyDateMode="smart"`. В smart-режиме `fullstat-v3-daily` считает даты по МСК: сегодня всегда, вчера только если сейчас >= 09:00 МСК и `settings.fullstat_v3_daily_yesterday_synced_date` ещё не равен вчерашней дате.
- При успешном проходе вчера по всем кампаниям сохраняются `fullstat_v3_daily_yesterday_synced_date` и `fullstat_v3_daily_yesterday_synced_at`. Если по вчера есть 429/ошибка/parse error или проход оборван — отметка не ставится, а в settings сохраняется cursor: `fullstat_v3_daily_yesterday_cursor_date` + `fullstat_v3_daily_yesterday_cursor_advert_id`. Следующий smart/yesterday запуск начинает вчерашний хвост с этого advert_id, а не с начала списка.
- В smart-режиме при 429/ошибке endpoint быстро завершает проход без 20-минутного `backoff429`, чтобы не блокировать расписание. Когда вчера успешно добит с cursor-позиции, cursor очищается. Обычный ручной `days=N` режим сохраняет прежнее поведение с пользовательскими паузами.
- Журнал test-auto считает итоговые OK/429/ошибки из `timeline_json` request-events; top-level `error` дочернего endpoint считается ошибкой. Если дочерний endpoint падает до первого WB-запроса, в timeline пишется `phase_error`, а UI помечает строку как «нет запросов».
- Причина старых пустых `OK 0` 26 мая 2026: orchestrator ходил на `http://localhost:3001`, а dev-сервер слушает `127.0.0.1:3001`; `localhost` мог отдавать редирект `/login`. Все внутренние server-to-server BASE теперь должны идти через `WB_ADS_INTERNAL_BASE_URL || http://127.0.0.1:3001`.
- Фактическое состояние 26 мая 2026 15:26 МСК: `test_sync_auto_interval=20`, `fullstat_v3_daily_yesterday_synced_date=2026-05-25`, cursor пустой. Последние авто-прогоны `#1558-#1565` успешные: `24/24 ok`, 429=0, errors=0, длительность около 10м 40с. `campaign_nm_daily` имеет 12 строк за 2026-05-25 и 12 строк за 2026-05-26.

**Вне auto-sync (точечные вызовы или отдельные тики):**
| Endpoint | Что делает |
|---|---|
| /api/sync/search-texts-wb?subjectId=X | Частотность WB premium (seller-content `/search-analysis/premium/search-texts`) — кэш 6ч |
| /api/sync/search-texts-all | Обёртка: snapshot по всем subject_id активных кампаний. Тик **06:00 МСК** (`scheduleSearchTextsSync`) |
| /api/sync/buyout-percent | 30-дневный % выкупа по nm_id. Тик **06:30 МСК** (`scheduleBuyoutSync`) |
| /api/sync/phrase-positions-batch | Batch SSH 1:1 как Telegram-бот wb-parser (session reuse, retry). Используется первым шагом автообновления позиций в «Запросах» |
| /api/sync/phrase-positions?advertID=X | Топ-20 фраз одной кампании (по views) через SSH |
| /api/sync/phrase-position-one?advertID=X&nmId=Y&phrase=Z | Одна фраза (клик по строке или fallback после batch), до 5 попыток; после финального неуспеха пишет/показывает прочерки |
| /api/sync/mpstats-clusters | Импорт кластеров из MPSTATS (вручную) |
| /api/sync/promotions | Акции товаров |
| /api/clusters (CRUD) | Ручная база кластеров (`manual_clusters`) — пользователь создаёт через UI |
| /api/clusters/scan-campaign?advertId=X | **Авто-кластеризация фраз по реальному WB-preset** через wb-parser SSH. Multi-pass до 10 попыток. Группирует фразы по preset_id, реструктурирует manual_clusters. Поле `preset_id INTEGER` (мигрировано из `mpstats_preset_id`, UNIQUE INDEX). Триггер — кнопка ↻ в шапке «Запросы». UI шлёт {phrases:[]} текущего фильтра + детей. Добавлен 26 апр 2026 |
| /api/advert/preset-minus | Dual-path exclude: open `/adv/v0/normquery/set-minus` → fallback cmp `/preset/minus`. Поддерживает `cascadeByPreset`: расширяет canonical-фразу до всех известных aliases того же `preset_id` из `search_phrase_meta`/`manual_clusters`. Если WB отвергает общий список из-за неcanonical alias, open-branch пробует добавлять aliases по одному и возвращает partial-result. Все попытки логируются в `security_audit_log` со статусами accepted/success/failed/blocked и summary cascade/attempts |
| /api/advert/set-bid | `/adv/v0/normquery/bids` — ставка CPM в **рублях**. Только для **manual-аукционов**. Дополнительно ограничивается настройкой `max_bid_manual_auction_rub`; HTTP 200 ≠ успех, проверять `success[]/failed[]` |
| /api/advert/set-campaign-bid | **Единая ставка Uni-кампании**. WB endpoint: **PATCH `/api/advert/v1/bids`**. Body: `{bids:[{advert_id, nm_bids:[{nm_id, bid_kopecks, placement:"combined"}]}]}`. **`bid_kopecks` — копейки**. Шлём ставку на ВСЕ nmIds кампании. Clamp по `min_cpm_unified` и настройке `max_bid_uni_rub` |
| /api/advert/set-cpc-bid | Ставка CPC-кампании. Серверная защита по `max_bid_cpc_rub`; логирует в `bid_changes_log`; UI есть в рекламной таблице для CPC |
| /api/advert/balance-snapshot (GET) | Read-only `/adv/v1/balance`. Маппинг: `data.balance` → «Счёт продавца» (type=0), `data.net` → «Баланс кабинета» (type=1, основной WB-кошелёк), `data.bonus` → «Промо-бонусы» (type=3). `bonus_percent_max` = `Math.max(...cashbacks[].percent)` |
| /api/advert/budget-deposit | WB `POST /adv/v1/budget/deposit?id=X`. Body: `{sum (рубли), type, cashback_sum?, cashback_percent?, return:true}`. **Минимум — 1000 ₽** (явный лимит WB, в доке не указан, найден тестом). **Наш кэп — 30 000 ₽** (защита от опечаток). Если `useBonuses=true` и `type∈{0,1}` — внутри дёргаем balance, считаем `cashback_sum = min(bonus, sum × percent / 100)` |

### Закрытый API Джем (parallel)
| /api/sync/auth-wb-funnel?days=N | Воронка viewCount → Puppeteer |
| /api/sync/buyer-profile?days=N | Портрет покупателя → Puppeteer |
| /api/sync/phrase-djem-stats?nmId=X | Per-phrase воронка **агрегат за 90 дней** → seller-content `/v2/search-report/product/search-texts`. Кэш 1ч |
| /api/sync/phrase-djem-daily?nmId=X&mode=auto\|today&force=0\|1 | **Дневная разбивка Джема** (heal-стратегия): `mode=auto` — считает `target=[today-89..today]`, синкает missing+today, после 09:00 МСК пересинкает yesterday если `updated_at` до сегодняшних 09:00. `force=1` — удаляет всё и перезаливает. Pass 2 для упавших дней через 5с. Guard от параллельных запусков (`__djemDailyLocks`). Используется в `auto-sync-server` как `scheduleDjemDaily` (60-мин тик, серийно по всем active nmIds). |
| /api/phrase-djem-daily?nmId=X | (GET) читает `phrase_djem_stats_daily`, возвращает `{byPhrase: {phrase_lc: [{date, freq, oc, atc, o, pos}, …]}}`. UI использует для 90-дневного tooltip'а. |

### Позиции в поиске — через SSH
WB блокирует Mac-IP для `search.wb.ru`. Обход — `ssh wb-parser` (RU-сервер пользователя) + `proxy_positions.py` + `positions_rpc.py`. Endpoints `/api/sync/phrase-positions*` указаны выше в таблице «Вне auto-sync».

Текущая UX-логика в «Реклама → Запросы»: при клике по строке одиночный endpoint делает до 5 попыток. При автообновлении активной кампании сначала идёт batch по всем фразам очереди, затем одиночный endpoint с 5 попытками только для неудачных фраз. Старую позицию после неуспешного обновления не сохраняем как актуальную: после финального неуспеха остаются прочерки.

---

## Важные нюансы WB API (открытия этой сессии)

### Формат времени для xlsx endpoint
`cmp.wildberries.ru/api/v3/fullstat`: обязательно `from=YYYY-MM-DDT00:00:00Z&to=YYYY-MM-DDT00:00:00Z` (одинаковые timestamps!), НЕ 24-часовой диапазон — иначе WB считает данные криво (позиция/CPM показывают не то).

### Единицы измерения (противоречат docs)
В API `/adv/v0/normquery/stats` и `/get-bids` — **значения в рублях, не копейках**. Ставка 450₽ = `bid: 450`, не 45000.
В `/v1/advert/{id}/preset-info` же поле `actual_cpm` — **в копейках** (45000 = 450₽).
В новом `PATCH /api/advert/v1/bids` (для смены ставки Uni/manual через open API) — поле `bid_kopecks` тоже **в копейках** (12100 = 121₽).
В `/adv/v1/budget` и `/adv/v1/budget/deposit` — **в рублях** (`{total: 7289}` = 7 289 ₽).
То есть единицы зависят от endpoint'а, не от категории операции.

### Новый endpoint смены ставки (с октября 2025 unification)
WB перевёл смену ставок Uni и ручного аукциона на единый endpoint **PATCH `/api/advert/v1/bids`** (NOT POST, NOT `/adv/v1/bids`). Старый `/adv/v0/cpm` отдаёт 404 «path not found». Тело: `{bids:[{advert_id, nm_bids:[{nm_id, bid_kopecks, placement}]}]}`. Placement: `"combined"` для Uni, `"search"|"recommendations"` для ручного. Лимит — 50 объектов в `bids[]`.

### Минимум пополнения бюджета
WB hard-кэп **1000 ₽** на одну операцию `POST /adv/v1/budget/deposit`. В официальной доке не указан, обнаружен тестом — на 100 ₽ возвращает `400 {"error":"Invalid Params: [{minimum deposit amount is 1000p Sum}]"}`. У нас в UI и в backend дублирующая проверка `1000 ≤ sum ≤ 30000`, верхняя граница — наша, защита от опечаток.

### Автопополнение бюджета в кабинете WB
В seller-кабинете на уровне Uni-кампании можно включить «график пополнения» / «автопополнение из баланса». WB сама регулярно переводит средства с «Баланс кабинета» на бюджет — наш `bid_changes_log` это **не видит**. При расхождении «запросил N₽, бюджет вырос на больше» прежде чем искать баг в коде, проверять автопополнение в кабинете.

### Djem search-texts — per-nmId воронка
`seller-content.wildberries.ru/ns/analytics-api/content-analytics/api/v2/search-report/product/search-texts` (POST)

- **Body обязательно с `prevPeriod`** (сдвинутый назад на длину периода), иначе HTTP 400 `invalidRequestBody`. В body также шлём `includeSearchTexts:true`, `includeSubstitutedSKUs:true` (как делает UI WB Джема).
- **Без `nmId` endpoint отвечает 404 `content.analytics.nmIdNotFound`.** Общий endpoint `v3/search-report/report` с `nmIds:[]` работает, но возвращает только агрегат по артикулам (в `groups[0].items[]`), без фраз — для per-фразы не подходит.
- **Lim.: 100 при тарифе Джем 100 фраз** (по умолчанию), fallback 30 при WB-ругани. Три запроса с `topOrderBy = orders | addToCart | openCard`, мёрж items[] по `text` — ловим максимум уникальных фраз.
- **Для дневной разбивки** (`phrase_djem_stats_daily`): `currentPeriod={start:d,end:d}`, `prevPeriod={d-1,d-1}`. Паузы 600мс между запросами и между днями. Retry на 429: exponential backoff 2→4→8с на каждый из 3 запросов. Tolerant: если 2 из 3 топов прошли — сохраняем partial (в ответе `partialDays`), throw только если **все 3** упали.
- **Response shape**: `{data:{items:[{text, frequency:{current}, avgPosition:{current}, openCard:{current,percentile}, addToCart, openToCart, orders, cartToOrder, weekFrequency, visibility}]}}`. Поля вложены как `{current, percentile}`.
- **Не отдаёт**: `orderSum`, `avgPrice`, `viewCount`, `ctr`. CTR вычисляем локально.
- В БД 2 таблицы:
  - `phrase_djem_stats` — агрегат за 90 дней (PK `(nm_id, phrase)`); колонка `view_count` переиспользована под `frequency`.
  - `phrase_djem_stats_daily` — дневная разбивка (PK `(nm_id, phrase, date)`), поля `frequency, open_card_count, add_to_cart_count, order_count, avg_position`.
- **Расхождение нормализаторов WB**: cmp `/preset-info` отдаёт «трусы женский», этот endpoint — «трусы женские». LEFT JOIN по `lower(phrase)` промахивается. В `/api/ad-campaign-detail` в каждый keyword возвращается поле **`djem_phrases: string[]`** — `cluster.phrasesLcSet` для parent, `[lc(phrase)]` для orphan/child. UI итерирует по нему при per-day агрегации в tooltip'е. Для 90-дневного агрегата остаётся `clusterDjemAgg` (sum по тем же phrasesLcSet), конверсии пересчитываются из сумм, позиция — взвешенная по views.

### preset-info — единственный способ получить полный список фраз
`cmp.wildberries.ru/api/v1/advert/{advertID}/preset-info?nm_id=X&page_size=300&page_number=N&from=YYYY-MM-DD&to=YYYY-MM-DD&calc_pages=true&calc_total=true`

- Response: `{items:[{name, is_excluded, views, clicks, baskets, orders, shks, ctr, cpc, cpm, avg_pos, spend, actual_cpm, currency}], total:{...}, count}`
- Возвращает **ВСЕ фразы** (управляемые + исключения) — xlsx и normquery-stats возвращают только тех, что с показами.
- `actual_cpm` есть только если ставка задана вручную (т.е. управляемая + CPM установлен).
- Категории по is_excluded + наличию в других источниках:
  - `is_excluded=true` → **Исключения** (подсвечены ⊘ + line-through)
  - `is_excluded=false` + есть в preset → **Управляемые** (common)
  - Нет в preset (только в xlsx/stats_daily/bids) → **unknown** / «Неуправляемые» (<100 показов, WB не даёт править)
- Rate-limit: 4 rps (по аналогии с ивирмой `limit:1, period:250`), pageSize=300.

### Puppeteer — 2 отдельные вкладки
- `__wbSniffPage` — seller.wildberries.ru (для Джем, воронки, портрета, open API авторизации)
- `__wbSniffCmpPage` — cmp.wildberries.ru (для xlsx/v3/fullstat, v5/configvalues)
- Иначе во время авто-синка возникают race conditions при переключении URL

### WB auth в localStorage (не cookies)
- `wb-eu-passport-v2.access-token` — seller
- `access-token` — cmp
- В заголовок запроса кладём как `Authorizev3: <token>`

### Токены от phone-auth
Живут ~5 минут (refresh), НЕ длинная сессия. `wb-tokens.json` НЕ re-seedить в sniffer при каждом рестарте (иначе выкидывает живую сессию). Re-seed только при первом запуске или если wb-tokens.json моложе 10 минут.

### WB блокирует заграничные IP
Для `www.wildberries.ru/__internal/search/...` и `search.wb.ru/exactmatch/...`. Решение — SSH на RU-сервер (`ssh wb-parser`, user `makson`, Ubuntu 24.04).

### Типы рекламных кампаний (AdsCampaignsTable.tsx:96 `campaignTypeLabel`)
- `bidType === "manual"` → **Аук.** (ручная ставка).
- `placements.search && placements.recommendations` → **Uni** (объединённый аукцион) — WB сам ставит ставки по кластерам, у пользователя **нет** «нашей ставки».
- только `placements.search` → **Q** (аукцион Поиск).
- только `placements.recommendations` → **Рек** (аукцион Рекомендации).

### /adv/v3/fullstats — WB требует GET
Наш `/api/sync/stats` вызывает `GET https://advert-api.wildberries.ru/adv/v3/fullstats?ids=...&beginDate=...&endDate=...`. WB прямо пишет в 405-ответе на POST: «allowed methods are GET, HEAD». Иногда endpoint отдаёт 429/502 — это временные проблемы WB, не наш код. Retry не добавляем: «нет данных от WB → честно пишем ошибку в sync_log, следующий тик попробует снова» (решение пользователя).

---

## БД (50 таблиц, prod PostgreSQL проверено 29 мая 2026)

Prod database: VM107 PostgreSQL `wb_ads_prod`, размер `374 MB`. На 29 мая 2026: `products=30`, `campaigns=336`, `manual_clusters=1974`, `search_phrase_meta=1659`.

### Основные
campaigns | campaign_stats_daily | campaign_stats_by_nm | campaign_zones_daily | sales_funnel_daily | auth_wb_funnel_daily | buyer_entry_points | products | supplier_orders | stocks | product_promotions | search_cluster_stats | search_cluster_bids | balance_history | payment_history | expense_history | campaign_budgets | settings | accounts | sync_log | sync_test_log | security_audit_log | bid_history | bid_changes_log | minus_phrases | automation_rules | automation_log | positions | competitors | competitor_positions

### Фразы / Джем / поиск
| Таблица | Источник |
|---|---|
| `campaign_days` | xlsx по именам листов: per-day зоны (поиск/каталог/рекомендации). **С 26 апр 2026** — основной источник зон в `/api/ads` (после того как `campaign_zones_daily` оказалась без writer'а с 19 апр). |
| `campaign_zones_daily` | **Deprecated** — таблица существует, но никто не пишет (writer удалён в одной из чисток). Оставлена для исторических данных до 19 апр 2026. Не используется ни в каком коде — `/api/ads` читает зоны из `campaign_days`. |
| `campaign_keywords` | xlsx Sheet2: фразы+дата+views/clicks/spend |
| `campaign_catalogs` | xlsx лист каталога: каталоги. Лист `Рекомендации` сюда не пишется. |
| `campaign_nm_daily` | xlsx Sheet1 per-day: avg_position per product |
| `campaign_keyword_bids` | `/adv/v0/normquery/get-bids`: ставки CPM |
| `campaign_keyword_stats_daily` | `/adv/v0/normquery/stats`: per-phrase avg_pos/cpm/atbs/orders |
| `campaign_phrase_positions` | SSH-парсер: ad_pos, organic_pos, boost, preset_id |
| `campaign_preset_keywords` | cmp `/v1/advert/{id}/preset-info`: ВСЕ фразы per (advert,nm_id) с флагом `is_excluded`, полями views/clicks/baskets/orders/ctr/cpc/cpm/avg_pos/spend/shks и `actual_cpm` (в копейках) |
| `subject_min_cpm` | cmp `/v6/supplier-subjects`: минимальная CPM по предмету кампании (в РУБЛЯХ). Колонки: `min_cpm_search` (ручной аукцион в поиске, fallback для common-фраз без `actual_cpm`), `min_cpm_unified` (Uni-минимум, для clamp в `set-campaign-bid`), `min_cpm_recom`, `min_cpm`. Sync дёргает endpoint **двумя запросами** — `bid_type=2` (manual) и `bid_type=1` (Uni) |
| `search_texts_wb` | seller-content `/search-analysis/premium/search-texts`: snapshot частотности WB поиска за вчера (premium подписка). PK `(phrase_lc, interval)` |
| `search_phrase_meta` | Глобальная phrase-centric: фактический `presetId` + `tokens` из `search.wb.ru/exactmatch` (Meta-2). PK `phrase` |
| `search_meta_log` | Журнал per-scan сверки expected vs actual `presetId` |
| `position_sync_log` | Журнал проверок позиций для отладки (status: ok / no_ad / both_none / ssh_error...) |
| `manual_clusters` | **Ручная база кластеров** — `(id, name UNIQUE, phrases_json, source, mpstats_preset_id, preset_id, imported_at, timestamps)`. Пользователь создаёт через UI или авто-сканом. **С 26 апр 2026** — поле `preset_id INTEGER` (унифицированное, любой источник; UNIQUE INDEX). Все reads теперь по нему (mpstats_preset_id оставлен как метка происхождения). `scan-campaign` создаёт новые кластеры с source='manual' и preset_id из wb-parser |
| `phrase_djem_stats` | Агрегат воронки Джема за 90 дней (PK `nm_id, phrase`). Колонка `view_count` переиспользована под `frequency` |
| `phrase_djem_stats_daily` | **Дневная разбивка Джема** (PK `nm_id, phrase, date`) — добавлена 23 апр 2026. Поля `frequency, open_card_count, add_to_cart_count, order_count, avg_position, updated_at`. Наполняется `scheduleDjemDaily` (60 мин, серийно). Используется для 90-дневного tooltip'а в колонке «Джем» |
| `security_audit_log` | Журнал mutating endpoints. Сейчас используется `preset-minus`: accepted/success/failed/blocked, target advert_id, operation exclude/restore, cascade summary и попытки WB/open/cmp. |

---

## Формулы

| Формула | Расчёт |
|---|---|
| xP корзины | adSpend / campaign_stats_daily.atbs (direct + assocOUT) |
| xP заказы | adSpend / campaign_stats_daily.orders |
| adClickToCart (товар) | adCarts / adClicks |
| ДРРз / ДРРк | adSpend / ordersSum × 100 |
| Буст фразы | organic_pos − ad_pos |

## Ассоциированные конверсии (как в Карточках и Рекламе)
- **IN:** корзины/заказы от ЧУЖИХ кампаний → `1207+154`
- **OUT:** корзины/заказы ДРУГИХ товаров от НАШЕЙ рекламы → `+216`
- **Определение:** views>0 или clicks>0 в by_nm = прямые, иначе = ассоциированные
- Тултипы с детализацией per nm_id

---

## SSH-доступ к RU-серверу wb-parser
- `ssh wb-parser` → user `makson`, Ubuntu 24.04, RU IP
- `~/wb-parser/positions_rpc.py` — JSON stdin → JSON stdout
- На VM108 alias `wb-parser` настроен отдельным ключом; проверено 29 мая 2026: `positions_rpc.py` доступен, Python 3.12.3.
- В коде вызовы централизованы в `src/lib/wb-parser-rpc.ts`; host можно переопределить через `WB_PARSER_SSH_HOST`.
- Endpoints: `/api/sync/phrase-positions-batch`, `/api/sync/phrase-position-one`, `/api/sync/phrase-positions`, `/api/clusters/scan-campaign`.
- `/api/clusters/scan-campaign` больше не пишет полный провал (`scanned=0`, `failed=total`) как success. Проверенный prod-run 29 мая 2026 для `25141382`: `488/488`, `failed=0`, `passesUsed=2`.
- Скорость: batch идёт чанками через SSH/RPC; большие кампании могут идти несколько минут.

---

## Puppeteer-браузер

- **2 вкладки:** seller.wildberries.ru + cmp.wildberries.ru
- **Профиль:** `data/chrome-profile/` — персистентный
- **Автозапуск:** `ensureBrowser()` / `ensureCmpPage()` — стартует при sync
- **Reconnect:** `startSniffer()` сначала читает `data/chrome-profile/DevToolsActivePort` и подключается к уже открытому Chrome for Testing через CDP. Это закрывает случай, когда Next перезапустился и потерял `globalThis`, а браузер ещё держит профиль. Повторный `startSniffer()` idempotent и возвращает ok, если браузер уже запущен.
- **Авторизация:** вручную SMS в Puppeteer-окне, сессия в chrome-profile
- При рестарте sniffer НЕ re-seedить токены если profile существует (иначе выкидывает)

---

## Магазин (актуально на 29 мая 2026)

- Бренд: IMSI, Магазин: IMSI Каталог
- Supplier ID: 262998 (прежний auth) / 1166225 (API key numeric oid) / UUID `e0334427-4f82-4bc3-a0ab-43394e58b6ac`
- **30 товаров**, **336 кампаний** всего
- **1974 manual-кластера** в prod БД после массовой кластеризации/импорта и успешного `scan-campaign`

---

## Критичные файлы (НЕ УДАЛЯТЬ)

- `postcss.config.mjs` — обязателен для Tailwind CSS 4
- `next.config.ts` — `serverExternalPackages: ["better-sqlite3", "puppeteer", "jszip"]`
- `data/chrome-profile/` — сессия WB
- `data/wb-tokens.json` — только для FIRST launch sniffer
- `data/wb-api-key.txt` — WB open API
- `data/wb-prices-api-key.txt` — WB Prices API read-only key для цен
- `data/wb-ads-prod-db.env` — prod DB env на сервере/локально, не коммитить и не раскрывать
- `~/wb-parser/positions_rpc.py` на RU-сервере — RPC для позиций/буста
