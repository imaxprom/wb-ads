# WB Ads — Задачи и план

> Обновляется в конце каждой сессии. Читай в начале новой.

---

## В работе / ближайшие задачи

### Текущий старт после сохранения 29 мая 2026
- [ ] Разобрать post-midnight `test-auto`: последние строки #1688-#1690 дают `12/13 ok`, `errors=1`, `429=0`, тогда как #1686-#1687 были `24/24 ok`. Сначала смотреть `sync_test_log.timeline_json`, не делать вывод по агрегату.
- [ ] Закрыть warnings `/api/audit/service`: сегодня нет Djem daily rows для nmId `1012324217` и `165140159`; `fullstat-v3-daily` за `2026-05-28` помечен stale/incomplete до следующего корректного yesterday-close.
- [ ] Привести `scripts/save-session-state.ts` к prod-first режиму или явно держать ручную prod-сверку после генерации: сейчас скрипт может брать локальный SQLite snapshot, поэтому финальный `SESSION_STATE.md` правится вручную после проверки VM108/VM107.

### Критичное
- [x] ~~API-токен без scope «Статистика»~~ — **сделано 20 апр 2026**: пользователь перевыпустил токен с **Реклама + Статистика**, файл `data/wb-api-key.txt` обновлён
- [x] ~~MPSTATS-кластеры с общими фразами~~ — **НЕ актуально**: пользователь пересоздал кластеры чисто. Сейчас 4 кластера (id=7, 11, 12, 13), **0 общих фраз между любыми парами**. Все 5 фраз «Наша ставка» корректно matched: 4 parent + 1 child
- [x] СПП в Карточках → Воронка продаж: `supplier_orders` из WB Statistics `/api/v1/supplier/orders`, sync endpoint поддерживает `days=90`, auto-sync обновляет последние 3 дня, нижняя таблица показывает дневную среднюю СПП и тултип с 24 почасовыми средними.

### Реклама — следующий этап: управление ставками

**Уже готово (инфраструктура):**
- [x] Endpoint `/api/advert/preset-minus` — dual-path exclude (open → cmp fallback)
- [x] `min_cpm_search` подтягивается в `AdCampKeyword` из `subject_min_cpm` (можно использовать для валидации)
- [x] `has_custom_bid` в preset-info — флаг ручной ставки
- [x] ПКМ-меню с кластерным исключением
- [x] Batch-выделение с чекбоксами

**Уже реализовано (доделано в пропущенной сессии):**
- [x] `POST /api/advert/set-bid` → WB `/adv/v0/normquery/bids` (open API, рубли, не копейки; лимит 29999₽). Clamp-to-min по `subject_min_cpm`, валидация status∈(4,9,11) + payment_type=cpm + bid_type=manual. Лог в `bid_changes_log`
- [x] UI: `BidEditCell` в колонке 🔍×₽ — клик по ставке, Enter/Escape, карандаш-курсор, min-warning, `pendingBid`-оптимистика
- [x] **Джем** — колонка «Джем» в таблице «Запросы», per-phrase воронка WB Аналитики за 90 дней (today-89..today MSK). В ячейке: `корзин → заказов` (SVG-стрелка), **числа без пробелов** (`{r.djem_baskets}` напрямую, не `fmtNum`). При наведении — таблица: Запросов, Переходов, CTR, Корзин, Конв. в корзину, Заказов, Конв. в заказ, Средняя позиция (в тултипе `fmtNum` с пробелами — по явной просьбе пользователя). Проценты `.toFixed(2)`, позиция `.toFixed(1)`. Источник: `POST seller-content.../v2/search-report/product/search-texts` (3 запроса с `topOrderBy = orders|addToCart|openCard`, `limit=50` каждый, мёрдж по `text`). **Обязательно**: в body `prevPeriod` (иначе HTTP 400 `invalidRequestBody`). Auth — Authorizev3 из Puppeteer seller-tab. Реальная shape ответа: `{text, frequency:{current}, avgPosition:{current}, openCard:{current,percentile}, addToCart, openToCart, orders, cartToOrder, weekFrequency, visibility}`. CTR вычисляем локально: `openCard/frequency × 100`. `orderSum`/`avgPrice`/`viewCount` API **не отдаёт** — в UI не показываем; в БД колонка `view_count` переиспользована под `frequency`. Таблица `phrase_djem_stats (nm_id PK, phrase PK, period_start, period_end, ...)`. Кэш 1ч, авто-синк при открытии кампании (параллельно preset-info). Расширил `Tooltip.tsx` — теперь принимает ReactNode и опциональный `maxWidth`.
  - **Cluster-агрегация для parent/orphan-строк** (`/api/ad-campaign-detail`): WB нормализует фразу в разных API по-разному (cmp preset-info → «трусы женский», seller-content Djem → «трусы женские»). Прямой LEFT JOIN по `lower(phrase)` промахивается, поэтому для строки, чьё lc-имя совпадает с именем manual-кластера, суммируем views/clicks/baskets/orders **по всем `cluster.phrasesLcSet`** (parent-фраза + все `phrases_json`). Конверсии пересчитаны из сумм (`ctr = clicks/views × 100`, `cart_conv = baskets/clicks × 100`, `order_conv = orders/baskets × 100`), средняя позиция — взвешенная по views: `sum(avg_pos × views) / sum(views)`. Child-строка и orphan-фраза вне кластеров — остаются per-phrase. Приоритет в коде: `clusterDjemAgg.get(lc) ?? djemMap.get(lc)`.

- [x] **Мета-2** — колонка `Meta 2` в таблице «Запросы». Фактический `presetId` из публичной `search.wb.ru/exactmatch`, без обрезки. Источник — **wb-parser SSH бот** (`proxy_positions._fetch_keyword_sync` извлекает `products[i].meta.presetId` и `tokens` в том же цикле поиска nmId); отдельного хопа из Next.js в WB нет — обходим WAF через уже рабочий прокси-пул RU-сервера. **Phrase-centric** (не per-article): глобальная таблица `search_phrase_meta(phrase PK, preset_id, tokens, first_seen, last_verified, last_changed, checks_count)` — presetId зависит от фразы, не от nmId, поэтому при открытии другой кампании с теми же фразами Meta-2 сразу доступна. Апдейт-семантика: preset не изменился → бамп `last_verified` + `checks_count`; изменился → переписываем + `last_changed_at`. Журнал per-scan сверки в `search_meta_log` (expected ← `manual_clusters.mpstats_preset_id`). Подсветка `warning` в UI, если фактический ≠ ожидаемый. Колонки `real_preset_id/_tokens/_checked_at` в `campaign_phrase_positions` — рудимент от первой версии, больше не пишутся.

**Осталось сделать:**
- [ ] `POST /v1/advert/{id}/preset/reset` — сбросить ставку на фразу (вернуть к min_cpm)
- [ ] Fallback cmp `PUT /v1/advert/{id}/preset` — пока не нужен (open API работает), но держать в уме на случай отзыва scope
- [ ] Batch-установка ставки: контекст-меню «Установить ставку...» → modal с input → одним запросом для всего выделения (сейчас set-bid шлёт массив `phrases[]`, API готов, осталось только UI)
- [ ] «Отложенные исключения» — полный функционал. Таблица `deferred_exclusions (phrase, advert_id, nm_id, created_at, status)`. Бот-скан по impressions через /adv/v2/fullstats per phrase; если >=100 показов → auto preset-minus
- [x] **Защита от дабл-сабмита в `BudgetDepositModal`** — сделано 23 мая 2026: добавлен синхронный `useRef`-guard поверх React `submitting`, чтобы два быстрых Enter не отправили два пополнения.
- [x] **Авторазлокировка `/api/sync/balance` для status=11** — сделано 23 мая 2026: бюджеты синкаются для `status IN (9, 11)`, архив (7) не трогаем.
- [ ] **Расхождение `requested_kopecks` имени и единиц** в `bid_changes_log` — поле названо «копейки», но фактически содержит рубли (наследие set-bid). Переименовать в `requested_rub` либо явно конвертить в копейки, чтобы при просмотре лога не путаться.

### Кластеры — улучшения
- [ ] Импорт кластеров из MPSTATS через CSV (`POST /api/clusters/bulk-import`)
- [ ] UI-подсказка в `ManualClustersModal`: autocomplete из preset-фраз кампании для быстрого add

### Auto-sync — недоработки
- [ ] Решить финальную схему для `fullstat-v3` в основном auto-sync. Сейчас он не в `SYNC_STEPS`, но идёт через отдельный `test-auto` каждые 20 мин по настройкам TestSyncModal. `fullstat-v3-daily` в test-auto работает через smart-даты: сегодня каждый запуск, вчера после 09:00 МСК до первого успешного закрытия. При 429/ошибке по вчера сохраняется cursor и следующий smart/yesterday прогон продолжает с остановившегося advert_id. Если возвращать в основной auto-sync — не дублировать с test-auto и учитывать WB 429.
- [x] ~~Разобрать старый `fullstat-v3-daily` err=1 / нет строк за сегодня~~ — неактуально на 26 мая 2026: последние прогоны #1558-#1565 успешные `24/24 ok`, `campaign_nm_daily` есть за 2026-05-25 и 2026-05-26.
- [x] ~~Пустые `OK 0` в test-auto~~ — исправлено 26 мая 2026: внутренний BASE переведён с `localhost:3001` на `WB_ADS_INTERNAL_BASE_URL || 127.0.0.1:3001`, добавлен `phase_error` в timeline и явная метка «нет запросов» в журналах.

### Реклама — аналитика ДРР
- [ ] В верхней таблице «Реклама» рассмотреть новый формат для «Доля затрат»: `ДРР товара / ДРР РК`, где первое число считается только по рекламируемым `nms_json` из `campaign_stats_by_nm`, второе — текущий общий DRR кампании по `campaign_stats_daily` с ассоциированными заказами.
- [ ] Для tooltip/деталки «Доля затрат» показать прямую выручку рекламируемого товара, ассоциированную выручку и список топ ассоциированных `nm_id`. Пример 2026-05-26 для РК `28810638`: расход 9 156 ₽, прямой товар `322000486` 99 заказов / 112 462 ₽, всего РК 125 заказов / 140 000 ₽; DRR товара 8,1%, DRR РК 6,5%.

---

## Следующие задачи

### Высокий приоритет
- [x] **Cascade exclude по preset_id** — сделано 23 мая 2026: `/api/advert/preset-minus` умеет `cascadeByPreset`, расширяет фразы через `search_phrase_meta`/`manual_clusters` по `preset_id`, а при 400 на общем списке пробует добавлять aliases по одному и возвращает partial-result. UI показывает confirm с числом видимых фраз WB-кластера.
- [x] **Last-known-good для `nm_settings` в `/api/sync/campaigns`** — сделано 23 мая 2026: если WB отдаёт пустые `nm_settings` для status 9/11, сохраняем прежние `nms_json/subject_id/bid_kopecks` и возвращаем warning. Архивы пишутся как пришли.
- [ ] Дозагрузить buyer_entry_points за недостающие дни (45 из 90 загружено, остальные — rate limit)
- [ ] Дозагрузить campaign_stats_daily за старые периоды (если fullstats отдаёт > 7 дней)
- [ ] Вкладка "Остатки" — реализовать (данные в таблице stocks уже есть)

## Завершено (сессия 27-29 мая 2026 — prod migration, PostgreSQL, domain, auth, prices, wb-parser scan)

- [x] Проект перенесён на prod stack: VM108 `wb-ads` для приложения и worker, VM107 PostgreSQL `wb_ads_prod` для основной БД, домен `https://ads.imaxprom.site`.
- [x] Добавлена публичная защита через Basic Auth; сайт больше не доступен без авторизации.
- [x] БД перенесена в PostgreSQL, критичные SQLite/PostgreSQL несовместимости исправлялись по факту проверки: прямые PostgreSQL reads для тяжёлых мест, исправления `GROUP BY`, уход от лишних прокладок там, где приложение и БД уже на сервере.
- [x] `data/` добавлен в `.gitignore` целиком: БД, env, токены, ключи, Chrome-профиль и backup-файлы не попадают в GitHub.
- [x] Добавлен отдельный read-only ключ WB Prices API (`data/wb-prices-api-key.txt`) и `getPricesApiKey()`. `/api/sync/products` обновляет цены через `discounts-prices-api`, fallback на старые источники только при явной ошибке Prices API.
- [x] Контрольные цены после Prices API fix проверены в prod: `165140159` max 2280 / discount 51 / min 490 / discounted 1117; `322000486` max 1900 / discount 43 / min 570 / discounted 1243; `854839957` max 1900 / discount 45 / min 1045.
- [x] `wb-parser` на VM108 починен: создан отдельный SSH key VM108 -> wb-parser, alias `wb-parser` работает, `positions_rpc.py` доступен.
- [x] SSH/RPC вызовы вынесены в `src/lib/wb-parser-rpc.ts`; endpoints позиций и `scan-campaign` используют общий helper и `WB_PARSER_SSH_HOST` override.
- [x] `/api/clusters/scan-campaign` больше не маскирует полный провал как success. Старый симптом был `scanned=0 failed=907 success`; после фикса prod-run по `25141382` прошёл `488/488`, `failed=0`, `passesUsed=2`, создал 280 кластеров, обновил 6, удалил 3, переместил 8 фраз.
- [x] PostgreSQL fallback query в `scan-campaign` исправлен: `cpk.name` агрегируется через `MIN`, чтобы не падать на `GROUP BY`.
- [x] GitHub обновлён коммитом `74c7614 Migrate WB Ads to production PostgreSQL stack`.

## Завершено (сессия 23-24 мая 2026 — cascade/audit, test-auto log, browser reconnect, UI ставки)

- [x] `preset-minus` получил audit-лог в `security_audit_log`: accepted/success/failed/blocked, operation exclude/restore, cascade summary, attempts summary. Для кампании 25141382 / nm 165140159 проверено: restore `трусы женский` прошёл open-api 200 и снял 768 aliases; следующий exclude дал partial 207, WB принял 4 canonical/видимых фразы и отклонил 764 aliases.
- [x] В `AdCampaignDetailPanel` раскрытие parent-кластера теперь показывает всех children из `allChildrenByParent`, даже если текущий фильтр «Наша ставка» отобрал только одного child. Это исправляет случай `трусы женский (4)`, где при раскрытии был виден только `трус женские`.
- [x] `BidEditCell` разделён на `displayMode="text"` для нижней таблицы и `displayMode="pill"` для верхней рекламы. Инпут больше не растягивает строку в «Запросах» и не уменьшает поле/шрифт ставки в верхней таблице.
- [x] `test-auto` больше не пишет ложные `OK 0` при быстрых ошибках дочерних endpoints: итоговые счётчики берутся из `timeline_json`, а top-level `result.error` считается ошибкой.
- [x] `wb-sniffer` умеет подключаться к уже открытому Chrome через `data/chrome-profile/DevToolsActivePort`; `startSniffer()` стал idempotent. Проверено: `/api/wb/sniff` running=true, `/api/accounts/check-session` ok=true, seller/cmp HTTP 200.

### Средний приоритет
- [ ] Вкладка "Каталоги" — реализовать
- [ ] Вкладка "Запросы" в карточке товара — реализовать (рекламная вкладка «Реклама → Запросы» уже реализована в `AdCampaignDetailPanel`)
- [ ] Таб "Выдача WB" — позиции в поиске (интеграция с wb-parser)
- [ ] Таб "Реклама" — оставшиеся действия по ставкам: reset ставки, batch UI установки ставки, будущая автоматизация
- [ ] Группировка "по склейке" в верхней таблице
- [ ] Галочка "вся склейка" в нижней таблице

### Низкий приоритет
- [ ] Feedbacks count (нужен API с scope "Отзывы и вопросы")
- [ ] Цена покупателю (card.wb.ru отключён; СПП уже берётся из supplier_orders)
- [ ] Мультиаккаунт (переключение между магазинами)
- [ ] Автоматизация ставок (automation_rules/automation_log)
- [ ] Графики (recharts установлен, не используется)

---

## Известные проблемы

- [x] ~~MPSTATS может класть общие фразы во все кластеры~~ — текущий импорт/ручные кластеры пересобраны, конфликт общих фраз неактуален; при новых импортах всё равно проверять preset_id/пересечения
- [ ] WB rate limit на buyer-profile при массовой загрузке (>50 запросов/мин → 429)
- [ ] statistics-api обновляется раз в 30 мин (не real-time)
- [ ] campaigns.type = NULL — определяется по имени
- [ ] card.wb.ru отключён — нет buyer price и feedbacks count; СПП теперь берётся из WB Statistics supplier/orders
- [ ] WB-кластеризаторы в разных endpoints возвращают разные canonical имена (cmp: «трусы женский», premium: «трусы женские») — не совпадают по text-match, поэтому используем ручную базу

---

## Завершено (сессия 21-22 мая 2026 — Карточки, позиции рекламы, test-auto ack)

- [x] В «Реклама → Запросы» колонка «Доля» переведена на формулу купленные рекламные показы / общая частотность фразы. Значение не обрезается до 100%, потому что источники обновляются несинхронно.
- [x] Для обновления позиции фразы добавлены 5 попыток. После финального неуспеха остаются прочерки, чтобы старая позиция не выглядела актуальной.
- [x] Автообновление позиций сделано batch-first: active manual открывает «Запросы → Наша ставка» и обновляет `has_custom_bid`, active Uni открывает «Запросы → Управляемые» и обновляет `common` фразы; после batch одиночный endpoint ретраит только фейлы.
- [x] Исправлено повторное появление excluded children в «Наша ставка»: `/api/ad-campaign-detail` учитывает эффективное исключение от parent-кластера.
- [x] В ControlPanel восстановлена ack-семантика красного индикатора test-auto: новая ошибка за последние 24 часа горит до открытия/обновления журнала, успешный последующий прогон сам её не гасит.
- [x] В «Карточки» нижняя таблица стартует с высотой под 11 последних дней.
- [x] СПП в нижней таблице расширен: тултип показывает почасовые значения и средние по ФО, колонки СПП/заказы выровнены, popup подстраивается по высоте и оставляет нижний отступ.
- [x] Верхняя таблица «Карточки», столбец «Цена»: добавлена явная строка `СПП N,N %` из `supplier_orders`, синхронная с нижней таблицей.
- [x] Фото товаров переведены на набор WB basket-кандидатов `±1..±8` и retry cache-buster, чтобы новые/смещённые basket-URL не оставляли карточки без изображения.
- [x] Запуск/пауза рекламной кампании теперь подтверждается локальным popover рядом с кнопкой статуса, без нативного `window.confirm()`.

---

## Завершено (сессия 18-19 мая 2026 — СПП, зоны рекламы, фото, журналы)

- [x] Добавлен синк СПП: `/api/sync/supplier-orders?days=3` в основном `SYNC_STEPS`, ручной SyncModal и журнал. Источник — WB Statistics API `/api/v1/supplier/orders`, таблица `supplier_orders`. Endpoint поддерживает `days=90` для первичной загрузки.
- [x] В «Карточки → Воронка продаж» добавлен столбец «СПП»: дневная средняя по заказам артикула, для всего магазина — средняя по всем товарам. Тултип показывает 24 почасовые строки со средней СПП и количеством заказов.
- [x] Поправлено позиционирование тултипов нижних таблиц: СПП и ассоциированные конверсии открываются слева/центрировано относительно ячейки и помещаются в экран, а не уходят вниз за край.
- [x] Исправлена классификация листов `fullstat-v3`: xlsx листы определяются по имени, `Рекомендации` считаются «Полки», не «Каталог». `campaign_catalogs` не заполняется рекомендациями.
- [x] Добавлена формула каталога как остатка: `views_catalog = max(0, views_total - views_search - views_reco)`. Формула применяется при `fullstat-v3`, при `/api/sync/stats` и при отдаче `/api/ad-campaign-detail`.
- [x] Проценты зон в верхней и нижней рекламной таблицах переведены на общий `roundedZonePercents`: целые проценты, сумма 100%, ненулевые зоны не пропадают из-за округления.
- [x] Фото товаров в рекламе теперь обновляются через cache-busting: `/api/ads` отдаёт `firstProductUpdatedAt`, UI передаёт его в `ProductThumb`/`withImageVersion`.
- [x] Иконки журналов в ControlPanel теперь краснеют только при новой непросмотренной ошибке. После открытия журнала последний просмотренный проблемный `id` сохраняется в `settings.test_log_ack_error_id` или `settings.sync_log_ack_error_id`.
- [x] Убраны лишние звёздочки из CTR/зон и переименован столбец нижней рекламы «Каталог» полным названием.

---

## Завершено (сессия 23 мая 2026 — test-auto cursor, ставки, CPC, кластеры)

- [x] В TestSyncModal добавлен интервал авто-теста 20 минут; текущая настройка БД: `test_sync_auto_interval=20`.
- [x] В `fullstat-v3-daily` smart/yesterday добавлен cursor для вчерашнего дня: `fullstat_v3_daily_yesterday_cursor_date` + `fullstat_v3_daily_yesterday_cursor_advert_id`. При 429/ошибке/parse error по вчера endpoint сохраняет advert_id, fast-fail без 20-мин backoff, следующий smart/yesterday прогон начинает вчера с cursor-позиции. После успешного закрытия вчера cursor очищается и ставится `fullstat_v3_daily_yesterday_synced_date`.
- [x] На 2026-05-23 10:44 МСК фактический cursor: `2026-05-22 -> 36813654`; `fullstat_v3_daily_yesterday_synced_date` пока `2026-05-21`, значит 2026-05-22 ещё догоняется.
- [x] Скрипт `npm run save-session-state` обновлён: теперь пишет вчерашний cursor в `SESSION_STATE.md` и описывает resume-логику.
- [x] Реализованы настройки максимальной ставки: `max_bid_manual_auction_rub`, `max_bid_uni_rub`, `max_bid_cpc_rub`; текущие значения БД: 1000 / 300 / 20 ₽. Лимиты применяются в set-bid, set-campaign-bid, set-cpc-bid и автоставке manual.
- [x] Добавлен endpoint и UI для изменения CPC-ставки: `/api/advert/set-cpc-bid`, колонка/фильтр CPC в рекламной таблице.
- [x] Исправлено повторное появление child-фраз в «Запросы -> Наша ставка»: exact parent cluster имеет приоритет над child membership в старых широких кластерах; сервер set-bid не считает название другого кластера child-фразой; счетчики вкладок считают top-level тем же правилом, что и список.
- [x] Убрано моргание рекламной таблицы при обновлении и лишний tooltip с названием кампании.

---

## Завершено (сессия 17 мая 2026 — Test-auto, v3-daily smart, время МСК)

- [x] Добавлен `SESSION_STATE.md` — короткая стартовая карта новой сессии. Добавлен скрипт `npm run save-session-state`, который обновляет файл из `data/ads.db` и локальных status endpoints (`test-auto`, `fullstat-v3`, `fullstat-v3-daily`). `CLAUDE.md`, `PROJECT_CONTEXT.md`, `KnowledgeBase.tsx` и `~/.codex/memories/wb-ads-current-context.md` теперь указывают читать этот файл при старте.
- [x] Убран постоянный Turbopack/NFT warning по `ai-diary`: в `next.config.ts` добавлен `outputFileTracingExcludes` для `/api/ai-diary`, исключающий `./next.config.ts` из runtime trace. `npm run build` проходит без этого warning.
- [x] Журнал тестов и модалка TestSyncModal показывают время в МСК. В `~/.codex/memories/moscow-time.md` записано правило: в этом проекте везде использовать `Europe/Moscow`, если пользователь явно не попросил иначе.
- [x] Найдена причина старого паттерна «2 успешных теста, 1 жёлтый треугольник»: WB отдавал 429 на `fullstat-v3-daily`, а сохранённый `backoff429=1200s` растягивал прогон примерно на 29 минут и сбивал следующий слот.
- [x] Добавлен `dateMode` в `/api/sync/fullstat-v3-daily`: `today`, `yesterday`, `smart`, плюс прежний `days=N`.
- [x] Smart-режим: сегодня тянется каждый запуск; вчера тянется после 09:00 МСК, пока `settings.fullstat_v3_daily_yesterday_synced_date` не равен вчерашней дате. Успех фиксируется только если вчера прошёл по всем кампаниям без ошибок.
- [x] В smart-режиме при 429/ошибке endpoint быстро завершает проход без 20-минутного backoff, не ставит отметку успеха и даёт следующему автотесту догнать.
- [x] `test-auto` передаёт `v3DailyDateMode:"smart"`, ручной запуск в модалке продолжает использовать настройку `days` буквально.
- [x] Статус `/api/sync/test-auto` теперь учитывает активные дочерние `fullstat` endpoints, чтобы UI не показывал idle, пока внутри ещё идёт работа.
- [x] Фактическое состояние на конец сессии: вчера `2026-05-16` закрыт прогоном `#819` без 429/ошибок; отметка `fullstat_v3_daily_yesterday_synced_at=2026-05-17T16:33:02.802Z` (19:33:02 МСК); последние завершённые прогоны `#828-#832` успешные, после закрытия вчера тянули только сегодня.

---

## Завершено (сессия 26-27 апреля 2026 — большая работа над фразами, кластерами, гибрид API)

### Auto-cluster scan (фразы → реальный WB-preset)
- [x] Миграция: `manual_clusters.preset_id INTEGER` + `UNIQUE INDEX idx_mc_preset_id ON (preset_id) WHERE preset_id IS NOT NULL`. Скопировано из `mpstats_preset_id` для всех 42 существующих MPSTATS-кластеров. `mpstats_preset_id` оставлен как метка источника
- [x] Новый endpoint `POST /api/clusters/scan-campaign?advertId=X` body `{phrases?: string[]}` — multi-pass до 10 попыток через batch SSH wb-parser, group by real_preset_id, реструктуризация manual_clusters в одной транзакции (find target → add missing phrases → remove from others → delete empty)
- [x] `GET /api/clusters/scan-campaign?advertId=X` — прогресс для polling (total/scanned/failed/pass/running/summary)
- [x] Lock `globalThis.__scanCampaignLocks: Set<advertId>` + auto-cleanup залипшего lock'а (если progress.startedAt > 15 мин и running=true)
- [x] UI: кнопка ↻ в шапке вкладки «Запросы» переделана на «Сканировать все фразы». Список фраз для скана = top-level (depth=0) + ВСЕ их children из manual_clusters.phrases_json (даже свёрнутые)
- [x] Прогресс-счётчик `<scanned>/<total>` рядом с кнопкой, polling каждые 1.5с
- [x] На маунте панели — `useEffect` пингует GET и подцепляется к running scan (через `startScanPolling`). На размонтаже interval гасится. Click ↻ во время running → POST 409, UI не алертит, просто attach
- [x] После завершения — авто-refresh данных (preset-info?force=1 + qRefreshTick++), счётчик прячется через 3с
- [x] Чтения переключены на `preset_id` в: `/api/ad-campaign-detail`, `/api/sync/phrase-positions-batch`, `/api/sync/phrase-position-one`. mpstats sync пишет в обе колонки
- [x] **Баг с info.error: true** — scan раньше отбраковывал ответы wb-parser с error=true даже когда preset_id корректно заполнен. preset_id в parser имеет fallback через `metadata.catalog_value` (одинаковый для всей выдачи WB), независим от позиций. Поправили: принимаем preset_id если он не null, флаг error игнорируем. Закрыло 15 «потерянных» хвостовых фраз
- [x] memory: `auto_cluster_scan.md`, `wb_parser_ssh.md` (existed)

### Гибрид open + closed для preset-info
- [x] Новый endpoint `POST /api/sync/preset-info-open?advertID=X[&nmId=Y][&from=...&to=...]` — гибрид через 3 open API: `normquery/list` (camelCase!) + `get-bids` + `stats`. Без Puppeteer
- [x] `GET` тот же путь — прогресс
- [x] UPSERT в `campaign_preset_keywords` с **MAX-семантикой** (бóльшее = истина) для числовых полей; `is_excluded` last-write-wins; spend = clicks × cpc (open API не отдаёт)
- [x] Подключён в `auto-sync-server.ts` SYNC_STEPS **перед** closed `preset-info`
- [x] Подключён в `SyncModal.API_STEPS` как «Фразы кампаний (open API)»
- [x] memory: `preset_info_hybrid.md`, `wb_normquery_list_api.md`

### Expense-history sync (фактические списания WB)
- [x] Новый endpoint `POST /api/sync/expense-history?from=...&to=...` дёргает open API `/adv/v1/upd` (default 7 дней)
- [x] Full-refresh окна: DELETE+INSERT в одной транзакции, защита от пустого ответа (не удаляем при empty)
- [x] Mapping `paymentType` (0=Счёт продавца, 1=Баланс, 3=Бонусы)
- [x] `paidPeriod: number` добавлен в `AdsCampaign` interface (`SUM(amount) GROUP BY advert_id` за период)
- [x] `AccountCell` теперь 4 строки: «всего» / spend / «оплачено» / paidPeriod
- [x] Тултип столбца «Счет / Опл.» обновлён, defaultW 100→110
- [x] Подключён в auto-sync (после balance) и SyncModal как «Списания WB по кампаниям (7 дней)»
- [x] memory: `wb_expense_upd_api.md`

### Frequency fallback из Джема
- [x] В `/api/ad-campaign-detail` для дней без snapshot в `search_texts_wb` (включая «сегодня») берётся frequency из `phrase_djem_stats_daily`. Per-date merge с MAX(frequency) per (phrase, date). Cluster-агрегация автоматически подхватывает
- [x] Тултип колонки `~👁` обновлён — упомянут двойной источник
- [x] `wbFreqUpdatedAt` теперь обновляется до позднейшего timestamp'а среди WB и Djem

### Новая колонка CPO в Карточках → Воронка продаж
- [x] `cpo` ключ в `DEFAULT_W` (70px), `colLabelText` (label "CPO"), `COLS` (после CPS, align right)
- [x] Формула `adSpend / ordersCount` (без поправки на выкуп). Округление до целого рубля через `fmtRub`
- [x] Тултип «Cost Per Order — себестоимость заказа. CPO = расход на рекламу / общее кол-во заказов (включая органические заказы, без учёта выкупа)»
- [x] Мердж `detail_col_order` поправлен: новые ключи вставляются на свою дефолтную позицию, не сбрасывает на дефолт целиком

### UI-фиксы
- [x] **Excluded фразы — убран line-through**, остаётся только ⊘ маркер (по просьбе пользователя)
- [x] **Excluded children НЕ наследуют** opacity-50 от parent'а. Логика «всё управляемое — белое» (даже если родительский кластер исключён, child может быть отдельно управляемым в WB)
- [x] **Unknown фразы** (`type === "unknown"`) теперь `opacity-50` — они неуправляемые WB (`set-bid`/`set-minus` отвергнут с 400). Маркер ? остаётся
- [x] **DblClick по excluded-фразе** из не-«Исключения» вкладки → переключение `qTypeFilter="excluded"` + scrollIntoView + temp-highlight 2.5с (через `setHighlightedPhrase`). Если фраза — child и parent свёрнут, parent раскрывается автоматически
- [x] **Bucketing children в queryRows** — теперь bucket-руется только если parent проходит текущий тип-фильтр. Иначе child становится top-level. Фикс счётчика «Управляемые: 6 → 11» для 19494001 (5 children excluded-кластеров стали видны)
- [x] Зоны (Поиск/Каталог/Полки) — активные значения теперь белые `var(--text)` вместо зелёных `var(--success)`
- [x] `BudgetDepositModal` — убран `requestAnimationFrame(focus + select())` при открытии. Поле «1000» без выделения и без курсора
- [x] `PositionSyncLogsModal` — фикс flex max-height overflow: inline `style={{maxHeight:"85vh", minHeight:0}}` + `min-height:0` на `flex-1 overflow-auto`. OK count: явный `marginLeft: 0.5rem`
- [x] `ManualClustersModal` — бейдж preset показывается на любом кластере (не только MPSTATS), отображает `c.presetId`

---

## Завершено (сессия 26 апреля 2026 (вечер) — расширение верхней таблицы Рекламы)

### 5 новых колонок верхней таблицы Рекламы
- [x] **Показы** (`views`): сверху число показов, ниже серым лейбл «CPM» и значение `затраты / показы × 1000` ₽
- [x] **Клики** (`clicks`): сверху число кликов, ниже серым две метрики — CTR (`клики / показы × 100%`) и CPC (`затраты / клики` ₽)
- [x] **Заказы** (`orders`): сверху число заказов, ниже серым CR (`заказы / клики × 100%`) и CPO (`затраты / заказы` ₽)
- [x] **Воронка** (`funnel`): две подколонки. Корзины: сверху % `atbs/clicks`, посередине лейбл, снизу `N шт`. Заказы: сверху % `orders/atbs`, посередине лейбл, снизу `N шт`
- [x] **Доля затрат** (`costShare`): сверху DRR% (зелёный ≤10, жёлтый ≤15, красный иначе; «## %» если spend>0 и sumPrice=0), ниже серым «Заказы» (sumPrice ₽) и «Расход» (spend ₽)
- [x] Все 5 колонок: `align: "center"`, 3-строчная вёрстка (значение / лейбл серым / значение серым), `defaultW` 90–150
- [x] Иконки в CtrCell/ConversionCell/CartOrderCell подняты с `w-3 h-3` до `w-3.5 h-3.5` (12px → 14px)
- [x] **Мердж `ads_col_order`** в `loadAdsColOrder().then`: если в сохранённом порядке нет нового ключа — он вставляется на свою дефолтную позицию относительно соседей (раньше при разнице длин сбрасывалось на дефолт целиком). Удалённые ключи отбрасываются
- [x] Старые колонки CTR / Конверсии / ДРРк-Выручка оставлены как дублирующие — скрываются через шестерёнку настроек столбцов
- [x] Обновил KB: новый раздел «Столбцы верхней таблицы Рекламы (16)» в KnowledgeBase.tsx

---

## Завершено (сессия 25-26 апреля 2026 — Uni-bid редактор, Бюджет-депозит, Зоны, Auto-sync retry)

### Uni-bid editor (перенос из «Запросов» в верхнюю таблицу)
- [x] **Зондировали WB**: `cmp /v6/supplier-subjects?bid_type=1` отдаёт **Uni-минимум CPM** (101 ₽ для «Трусы» вместо 405 ₽ для ручного аукциона). Добавил колонку `min_cpm_unified` в `subject_min_cpm`. `sync/supplier-subjects` теперь дёргает endpoint **двумя запросами** (bid_type=2 + bid_type=1), мёрджит в одну строку.
- [x] **Старый WB endpoint `/adv/v0/cpm` отдаёт 404** (`path not found`). Через Puppeteer-fetch доки `dev.wildberries.ru/openapi/promotion` нашли актуальный: **PATCH `/api/advert/v1/bids`** (NOT POST, NOT `/adv/v1/bids`) с body `{bids:[{advert_id, nm_bids:[{nm_id, bid_kopecks, placement}]}]}`. Для Uni `placement: "combined"`, для ручного `"search"|"recommendations"`. **`bid_kopecks` — копейки** (отличие от старого `/adv/v0/cpm` где были рубли). Шлём ставку на ВСЕ nmIds кампании (одинаковую = единая).
- [x] `POST /api/advert/set-campaign-bid` — обёртка для Uni: парсит `nms_json`, clamp по `min_cpm_unified`, вызывает PATCH WB, обновляет `campaigns.bid_kopecks` оптимистично.
- [x] **Перенос редактора**: убрал инлайн-редактор из «Запросов» (там Uni-строки теперь read-only «зеркало» с тултипом «Меняется в верхней таблице»). Редактирование Uni-ставки теперь в `TargetCell` верхней таблицы — клик по «121 ₽» → инпут → Enter.
- [x] Вынесено в общий компонент `src/components/BidEditCell.tsx` (PENCIL_CURSOR + props), чтобы переиспользовать в обеих таблицах.
- [x] Тултип ставки: «История изменений ставки» — последние 10 успешных смен из `bid_changes_log` с `our_status='ok:campaign_level'` (placement=`"left"` — компактный слева от элемента).

### Budget deposit (пополнение бюджета кампании)
- [x] `GET /api/advert/balance-snapshot` — read-only обёртка над `/adv/v1/balance`. Возвращает `{account, ad_balance, bonuses, bonus_percent_max}`. **Маппинг полей WB**: `data.balance` → «Счёт продавца» (type=0), `data.net` → «Баланс кабинета» (type=1), `data.bonus` → «Промо-бонусы» (type=3). `bonus_percent_max` = `Math.max(...cashbacks[].percent)`.
- [x] `POST /api/advert/budget-deposit` — обёртка над WB `POST /adv/v1/budget/deposit?id=X` с body `{sum (рубли), type, cashback_sum?, cashback_percent?, return:true}`. **Минимум WB — 1000 ₽** (явно сказано в 400-ответе deposit, в доке не указан — нашли тестом на 100 ₽). **Наш кэп — 30 000 ₽** за операцию, защита от опечаток (нули). Если `useBonuses=true` и `type∈{0,1}`: дёргаем balance, считаем `cashback_sum = min(bonus, sum × percent / 100)` и шлём вместе с deposit. Серверная валидация дублирует UI (1000 ≤ sum ≤ 30000).
- [x] Компонент `src/components/BudgetDepositModal.tsx` — модалка 380px, поле суммы 130px + дропдаун быстрых сумм (1k/2k/3k/4k/5k/10k/15k/20k/30k), радио-источник (баланс/счёт/бонусы), галка «Использовать промо-бонусы» (только при type 0/1, disabled если бонусов 0), live-fetch баланса при открытии, авто-выбор первого непустого источника, hard-валидация. В шапке: «текущий бюджет: X ₽ → Y ₽» (preview). Источники с 0 — серые/disabled.
- [x] **Подключено к UI**: клик по сумме бюджета в `TargetCell` верхней таблицы → модалка. На успех — `reload()` списка кампаний.
- [x] Тултип бюджета: «История пополнений» — последние 10 успешных из `bid_changes_log` с `our_status LIKE 'budget_deposit%'` (дата + сумма + источник).
- [x] **Тестовая страница** `/test-budget` (можно удалить позже) — для итерации над дизайном модалки до интеграции.
- [x] **Урок**: WB сама автопополняет бюджет (настройка «график пополнения» в кабинете) — если пользователь видит «запросил N, пополнилось больше», прежде чем искать баг в коде, проверять автопополнение в кабинете WB. Сохранил в memory `wb_budget_autorefill.md`.

### Auto-sync retry на 429
- [x] В `auto-sync-server.ts:runSync()` после первого прохода шагов — собираем фейлы и до **5 раз** ретраим каждый с **30-секундной паузой** между попытками (последовательно, не параллельно). При успехе → помечаем шаг `ok:true` с `error="OK on retry N"`. В sync_log добавили поле `retries`. Lifesaver для `/adv/v3/fullstats` 429 (один проход обычно фейлится, второй уже проходит). На 19 мая 2026 в основном auto-sync 17 шагов.

### Зоны (Поиск/Каталог/Полки) — починили
- [x] **Найдена дыра**: таблица `campaign_zones_daily` нигде не пишется (writer удалён в одной из чисток), читается только в `/api/ads`. С 19 апр данные пустые. **Фикс**: переключили `/api/ads` на `campaign_days` (поля `views_search/views_catalog/views_reco`, заполняется `fullstat-v3`). Старая таблица оставлена (не удаляли — может быть исторические данные).
- [x] `ZoneCell.tsx`: переделал layout с `flex-col` на `grid-cols-[auto_auto]` (через inline-style — Tailwind v4 не подхватывал `grid-cols-[auto_auto]`). Цифры right-aligned в одной колонке, лейблы left-aligned в другой → друг под другом.
- [x] Переименовал «Реко» → **«Полки»**.
- [x] Всегда показываем все 3 строки (Поиск/Каталог/Полки), даже если у зоны нет данных — ставим «—».

### Реструктуризация колонок верхней таблицы рекламы
- [x] Колонка «Период» **удалена полностью** (вместе с `PeriodCell`, `fmtLastActive`, sort-case `period`).
- [x] Колонка «Товар»: убраны статус и время изменения. Добавлена третья строка **«создана {дата}»**.
- [x] Колонка «Камп.»: добавлены **статус** («активна» зелёным) и **время последнего изменения** (`fmtChangeTime(c.changeTime)`). Удалена статичная подпись «API».
- [x] **Цветные счёт/бюджет с тултипами**: ставка и бюджет в `TargetCell` обёрнуты в `Tooltip` с историей. Hover-подчёркивание accent-цветом (фиолетовое подчёркивание под фиолетовым числом — раньше серое было багом).
- [x] **Удалены индикаторы «12 дн назад / 3 ч назад»** под ставкой и бюджетом (поля `bidUpdatedAt`/`budgetUpdatedAt` из `/api/ads`, функция `fmtRel`, выборка из `bid_history` — всё вырезано). Они показывали не реальные изменения, а время последнего синка / последней записи в архивную табличку.
- [x] **2-колоночный CSS Grid** в TargetCell для симметрии «132 ₽ / 5 938 ₽» + «ставка / бюджет».

### Сортировка по столбцу «Джем» в «Запросах»
- [x] Клик по заголовку «Джем» → DESC по `djem_orders` (на повторный клик — сброс к дефолтной сортировке `approx_views_wb DESC`). Сохраняется в `settings.ad_queries_djem_sort`. Применяется и к top-level, и к children. Маркер `▼` в шапке колонки. Реализовано через опциональные `onHeaderClick`/`sortIndicator` в `HeaderCell`.

### Tooltip placement="left"
- [x] В `Tooltip.tsx` добавил третий placement — компактный тултип слева от элемента, по вертикали по центру (`top: r.top + r.height/2`, `transform: translateY(-50%)`). Используется для тултипов ставки/бюджета.

### Колонка «Кластер» — пояснение маркеров
- [x] В шапке тултипа теперь блок «Маркеры перед фразой»: ⊘ — в исключениях (красный), ? — неуправляемая (<100 показов), без маркера — управляемая.

### OrdersCell (₽-иконка)
- [x] В `OrdersCell.tsx` (колонка «Воронка» вкладки «Карточки») добавил ₽ как «иконку» в начале строки суммы (вместо суффикса). Число теперь выровнено с предыдущими (`min-w-[3.5rem] text-right font-mono`). В шапке колонки — добавлен ₽ после 👁🛒📦.

### Бонус: тестовая страница
- [x] `/test-budget` (`src/app/test-budget/page.tsx`) — превью UI для пополнения бюджета без mutating-вызовов в WB. Используется для дизайна перед интеграцией. Можно удалить, когда уверены в финальном виде.

---

## Завершено (сессия 22-24 апреля 2026 — Джем per-day + устойчивость + Uni)

### Джем: дневная разбивка за 90 дней
- [x] Таблица `phrase_djem_stats_daily (nm_id, phrase, date PK, frequency, open_card_count, add_to_cart_count, order_count, avg_position, updated_at)` + 2 индекса
- [x] `fetchDjemForDay(session, nmId, date, limit)` в `wb-djem-stats.ts` — 3 запроса (`orders`/`addToCart`/`openCard`) с мёржем items[], retry на 429 (2→4→8с), tolerant (throw только если ВСЕ 3 упали)
- [x] `POST /api/sync/phrase-djem-daily?nmId=X&mode=auto|today&force=0|1` — heal-стратегия: target=[today-89..today], missing+today, Pass 2 для упавших через 5с, yesterday-refresh после 09:00 МСК если `updated_at < today@09:00`. Lock `__djemDailyLocks` от параллельных запусков на один nmId
- [x] `GET /api/phrase-djem-daily?nmId=X` → `{byPhrase: {phrase_lc: [{date, freq, oc, atc, o, pos}, …]}}`
- [x] `scheduleDjemDaily` в `auto-sync-server.ts` — каждые 60 мин серийно по всем active nmIds (`status IN (9,11)`)
- [x] UI колонка «Джем»: per-day значение за выбранную дату в DateSidebar (было 90-дневный агрегат). Tooltip на ховер — таблица 90 дней, sticky заголовок фразы + шапка, скроллится тело. Фиксированные ширины колонок (CSS Grid). Placement `"left-full"` — тултип слева от курсора, от top:60 до низа viewport, `interactive` (можно скроллить мышью)
- [x] Серверное поле `djem_phrases: string[]` в `AdCampKeyword` — `cluster.phrasesLcSet` для parent, `[lc]` для orphan/child. Решает расхождение нормализаторов WB (cmp «трусы женский» ≠ Djem «трусы женские») — клиент итерирует по нему для per-day агрегации кластера
- [x] Иконки 🛒/📦 в шапке тултипа заменены на `<CartIcon/>`/`<BoxIcon/>` (как в основной таблице)

### UX фильтров и исключений
- [x] Uni-кампании (`placements.search && recommendations && bidType !== "manual"`): скрыта кнопка «Наша ставка», дефолт — «Управляемые». Обычные (Аук./Q/Рек) — без изменений
- [x] Фильтр «Наша ставка» — исключаем `excluded` (как из счётчика, так и из отображения). Fallback parent→children не применяется если parent уже `excluded`
- [x] `handlePresetMinus` / `handleBatchPresetMinus` — в WB шлём только **canonical (parent)** фразу кластера (children раскрываются на стороне WB). Фикс 400 `norm_query 'X' is not valid for nm Y` на фразах нестандартной нормализации в children_phrases
- [x] `/api/advert/preset-minus` — в `reason` теперь включает body от WB (для прозрачной диагностики 400/403/502)

### Tooltip.tsx
- [x] Добавлен prop `interactive?: boolean` — pointer-events на контенте + 150мс delay при уходе курсора (нужно для скролла 90 дней)
- [x] Добавлен prop `placement?: "auto" | "left-full"` — для Джем-тултипа, слева от элемента во всю высоту viewport

### Observability
- [x] Ручной probe `/adv/v3/fullstats`: WB требует **GET** (POST возвращает 405 с «allowed methods are GET, HEAD»). Наш `sync/stats` корректный. Периодические 429/502 — проблемы WB-инфраструктуры, retry не добавляли по решению пользователя
- [x] Debug endpoint `/api/debug/djem-no-nmid` (GET без nmId = 404 `nmIdNotFound`) и `/api/debug/djem-v3-report` (v3 endpoint выдаёт артикулы, но без фраз)

---

## Завершено (сессия 20 апреля 2026 — ручные кластеры + WB premium)

- [x] Реверс-инжиниринг MPSTATS (Intestats, `pjbepnginjokklnhdgladnmlghcchbeb`) — их бэкенд `plugin.mpstats.io/pluginapi`, кластеризация на сервере
- [x] Endpoint WB premium `/search-analysis/premium/search-texts` — реальная частотность WB поиска за день + orders + addToCart
- [x] Таблица `search_texts_wb` + sync в 06:00 МСК (snapshot per subject_id)
- [x] Таблица `subject_min_cpm` + sync (min CPM per предмет, fallback bid)
- [x] Таблица `position_sync_log` + `PositionSyncLogsModal` (отладка SSH-парсера позиций)
- [x] Batch SSH для позиций `/api/sync/phrase-positions-batch` (1:1 как Telegram-бот, без 3 параллельных SSH)
- [x] Dual-path preset-minus: open `/adv/v0/normquery/set-minus` → fallback cmp `/preset/minus`
- [x] Endpoint удалён: `preset-words`, стемминг `normalize-phrase.ts`, debug endpoints (preset-info, search-texts, supplier-subjects, v3-fullstat, preset-no-nm)
- [x] Таблица `manual_clusters` + CRUD `/api/clusters` + `ManualClustersModal` (ручная база)
- [x] Контекстное меню ПКМ: Исключить / Вернуть — **кластерное** (parent + все children одним PUT)
- [x] Batch-выделение через чекбоксы + master-checkbox + toolbar массовых действий
- [x] Tree-view кластеров: parent ▸ child, expand/collapse, отступ child 2.5rem, у child скрыты управленческие колонки
- [x] DateSidebar 90 дней (single / range через dblclick+dblclick), выходные оранжевые, стиль как в Карточках→Портрет покупателя
- [x] 6 кнопок-фильтров с тултипами через Portal, счётчики считают кластеры (не фразы)
- [x] Поиск фраз (клиентский)
- [x] Сортировка по `approx_views_wb` DESC — стабильна между датами
- [x] 10-мин / 24ч кэши для всех тяжёлых WB-sync + 429-skip + AbortSignal timeout 15-20s
- [x] Автоскан позиций по has_custom_bid при открытии кампании
- [x] pendingExcluded → оптимистичный UI без «лага возврата фразы»
- [x] `key={advertId}` на AdCampaignDetailPanel + tab state в родителе (AdsCampaignsTable)

## Завершено (сессия 19-20 апреля 2026 — preset-info)

- [x] Реверс-инжиниринг расширения eWirma (сетевые запросы + декомпиляция JS bundles)
- [x] Найден endpoint `/api/v1/advert/{advertID}/preset-info?nm_id=X&page_size=300` → полный список фраз (управляемые + исключения) с флагом `is_excluded`
- [x] Таблица `campaign_preset_keywords` (+ индексы)
- [x] `/api/sync/preset-info` — sync через Puppeteer cmp-tab, pagination по 300, rate-limit 4 rps
- [x] `/api/test/preset-info` — debug endpoint для инспекции shape
- [x] UNION в `/api/ad-campaign-detail`: preset ∪ keywords ∪ stats_daily ∪ bids; поле `type: common|excluded|unknown`
- [x] Удалена старая xlsx-based вкладка «Запросы», «Запросы В-2» → «Запросы»
- [x] 5 кнопок-фильтров: Все / Управляемые / Активные / Исключения / Отложенные искл.(disabled) с бейджами
- [x] Визуал для excluded: `line-through + opacity + ⊘`, для unknown: `?`
- [x] Ставка `bid` в UI теперь реальная (из `actual_cpm/100`), подкрашена для `has_custom_bid`
- [x] `preset-info` добавлен в SYNC_STEPS auto-sync

## Завершено (последняя сессия 13-16 апреля 2026)

- [x] Закрытый API Джем — Puppeteer + Authorizev3 (viewCount)
- [x] Гибридный метод воронки — MAX(open, djem)
- [x] 90 дней воронки загружено
- [x] Портрет покупателя: WB / Тип трафика / Точки входа
- [x] Прямые vs ассоциированные конверсии (IN/OUT) с тултипами
- [x] Формулы xP = campaign_daily (direct+assocOUT)
- [x] adClickToCart: direct carts для "весь магазин"
- [x] Серверный авто-синк (auto-sync-server.ts)
- [x] Глубокий синк в 9:00 (days=3)
- [x] Персистентный Chrome профиль + автозапуск ensureBrowser()
- [x] CDP сниффер отключён (снижена нагрузка)
- [x] Анти-детект (webdriver=false)
- [x] Журнал синхронизации (sync_log, раскрывающийся)
- [x] Ретрай auto-sync до 5 попыток, 30 сек пауза
- [x] База знаний (`src/components/KnowledgeBase.tsx`)
- [x] Фильтр "Вчера" (offset)
- [x] Часовой пояс: localDateStr (Москва)
- [x] Funnel sync: все товары (не только активные кампании)
- [x] SVG иконки: EyeIcon, CartIcon, BoxIcon, ClickIcon, CheckCircleIcon
- [x] Подсветка выходных (Сб/Вс)
- [x] Тёмные скролбары
- [x] Пауза кампании — красная иконка
- [x] Git + GitHub (imaxprom/wb-ads)
- [x] Тихое обновление UI после серверного авто-синка (refreshKey + silent loadData)
- [x] Funnel sync: все товары из products (не только активные кампании)
- [x] Баг sync-log: || → ?? (0 считался falsy)
- [x] CHECKLIST_AUDIT.md (17 разделов, 51 проверка)
- [x] Таймер авто-синка: сохранение last_sync_time, продолжение после рефреша
