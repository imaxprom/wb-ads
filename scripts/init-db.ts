import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "ads.db");

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// 1. campaigns
db.exec(`
CREATE TABLE IF NOT EXISTS campaigns (
    advert_id INTEGER PRIMARY KEY,
    name TEXT,
    type INTEGER,
    status INTEGER,
    daily_budget REAL,
    payment_type TEXT,
    create_time TEXT,
    change_time TEXT,
    start_time TEXT,
    end_time TEXT,
    nms_json TEXT,
    subject_id INTEGER,
    bid_kopecks INTEGER,
    bid_type TEXT,
    placements_json TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);
`);

// 2. bid_history
db.exec(`
CREATE TABLE IF NOT EXISTS bid_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    advert_id INTEGER,
    nm_id INTEGER,
    placement TEXT,
    bid_kopecks INTEGER,
    competitive_bid INTEGER,
    leaders_bid INTEGER,
    recorded_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bid_adv_nm ON bid_history(advert_id, nm_id, recorded_at);
`);

// 3. search_cluster_stats
db.exec(`
CREATE TABLE IF NOT EXISTS search_cluster_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    advert_id INTEGER,
    nm_id INTEGER,
    norm_query TEXT,
    date TEXT,
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
CREATE INDEX IF NOT EXISTS idx_cluster_date ON search_cluster_stats(date);
CREATE INDEX IF NOT EXISTS idx_cluster_query ON search_cluster_stats(norm_query);
`);

// 4. search_cluster_bids
db.exec(`
CREATE TABLE IF NOT EXISTS search_cluster_bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    advert_id INTEGER,
    nm_id INTEGER,
    norm_query TEXT,
    bid_kopecks INTEGER,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(advert_id, nm_id, norm_query)
);
`);

// 5. minus_phrases
db.exec(`
CREATE TABLE IF NOT EXISTS minus_phrases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    advert_id INTEGER,
    nm_id INTEGER,
    norm_query TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(advert_id, nm_id, norm_query)
);
`);

// 6. campaign_stats_daily
db.exec(`
CREATE TABLE IF NOT EXISTS campaign_stats_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    advert_id INTEGER,
    date TEXT,
    views INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    ctr REAL DEFAULT 0,
    cpc REAL DEFAULT 0,
    cpm REAL DEFAULT 0,
    sum REAL DEFAULT 0,
    atbs INTEGER DEFAULT 0,
    orders INTEGER DEFAULT 0,
    shks INTEGER DEFAULT 0,
    sum_price REAL DEFAULT 0,
    cr REAL DEFAULT 0,
    canceled INTEGER DEFAULT 0,
    UNIQUE(advert_id, date)
);
CREATE INDEX IF NOT EXISTS idx_stats_date ON campaign_stats_daily(date);
CREATE INDEX IF NOT EXISTS idx_stats_adv ON campaign_stats_daily(advert_id);
`);

// 7. campaign_stats_by_nm
db.exec(`
CREATE TABLE IF NOT EXISTS campaign_stats_by_nm (
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
CREATE INDEX IF NOT EXISTS idx_stats_nm ON campaign_stats_by_nm(nm_id, date);
`);

// 8. balance_history
db.exec(`
CREATE TABLE IF NOT EXISTS balance_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    balance REAL,
    net REAL,
    bonus REAL,
    recorded_at TEXT DEFAULT (datetime('now'))
);
`);

// 9. expense_history
db.exec(`
CREATE TABLE IF NOT EXISTS expense_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    advert_id INTEGER,
    campaign_name TEXT,
    date TEXT,
    amount REAL,
    type TEXT,
    payment_source TEXT,
    status TEXT,
    UNIQUE(advert_id, date, amount)
);
CREATE INDEX IF NOT EXISTS idx_expense_date ON expense_history(date);
`);

// 10. payment_history
db.exec(`
CREATE TABLE IF NOT EXISTS payment_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id INTEGER,
    date TEXT,
    amount REAL,
    type INTEGER,
    status TEXT,
    UNIQUE(payment_id)
);
`);

// 11. campaign_budgets
db.exec(`
CREATE TABLE IF NOT EXISTS campaign_budgets (
    advert_id INTEGER PRIMARY KEY,
    cash REAL DEFAULT 0,
    netting REAL DEFAULT 0,
    total REAL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
);
`);

// 12. sales_funnel_daily
db.exec(`
CREATE TABLE IF NOT EXISTS sales_funnel_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nm_id INTEGER,
    date TEXT,
    open_card_count INTEGER DEFAULT 0,
    add_to_cart_count INTEGER DEFAULT 0,
    orders_count INTEGER DEFAULT 0,
    orders_sum REAL DEFAULT 0,
    buyouts_count INTEGER DEFAULT 0,
    buyouts_sum REAL DEFAULT 0,
    cancel_count INTEGER DEFAULT 0,
    add_to_cart_conversion REAL DEFAULT 0,
    cart_to_order_conversion REAL DEFAULT 0,
    buyout_percent REAL DEFAULT 0,
    UNIQUE(nm_id, date)
);
CREATE INDEX IF NOT EXISTS idx_funnel_nm_date ON sales_funnel_daily(nm_id, date);
`);

// 13. positions
db.exec(`
CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nm_id INTEGER,
    keyword TEXT,
    position INTEGER,
    page INTEGER,
    cpm REAL,
    timestamp TEXT DEFAULT (datetime('now')),
    source TEXT DEFAULT 'wb-parser'
);
CREATE INDEX IF NOT EXISTS idx_pos_nm_kw ON positions(nm_id, keyword, timestamp);
CREATE INDEX IF NOT EXISTS idx_pos_ts ON positions(timestamp);
`);

// 14. competitors
db.exec(`
CREATE TABLE IF NOT EXISTS competitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nm_id INTEGER,
    competitor_nm_id INTEGER,
    keyword TEXT,
    added_at TEXT DEFAULT (datetime('now')),
    UNIQUE(nm_id, competitor_nm_id, keyword)
);
`);

// 15. competitor_positions
db.exec(`
CREATE TABLE IF NOT EXISTS competitor_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    competitor_nm_id INTEGER,
    keyword TEXT,
    position INTEGER,
    page INTEGER,
    timestamp TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comp_pos ON competitor_positions(competitor_nm_id, keyword, timestamp);
`);

// 16. automation_rules
db.exec(`
CREATE TABLE IF NOT EXISTS automation_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    advert_id INTEGER,
    nm_id INTEGER,
    rule_type TEXT,
    condition_json TEXT,
    action_json TEXT,
    is_active INTEGER DEFAULT 1,
    last_triggered TEXT,
    trigger_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
`);

// 17. automation_log
db.exec(`
CREATE TABLE IF NOT EXISTS automation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER REFERENCES automation_rules(id),
    advert_id INTEGER,
    nm_id INTEGER,
    action TEXT,
    old_value TEXT,
    new_value TEXT,
    reason TEXT,
    timestamp TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_auto_log_ts ON automation_log(timestamp);
`);

// 17b. bid_automation_rules — автопилот ставок по поисковым фразам.
db.exec(`
CREATE TABLE IF NOT EXISTS bid_automation_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    advert_id INTEGER NOT NULL,
    nm_id INTEGER NOT NULL,
    phrase TEXT NOT NULL,
    enabled INTEGER DEFAULT 0,
    dry_run INTEGER DEFAULT 1,
    target_pos_from INTEGER DEFAULT 1,
    target_pos_to INTEGER DEFAULT 5,
    min_bid_rub INTEGER DEFAULT 0,
    max_bid_rub INTEGER DEFAULT 0,
    step_up_rub INTEGER DEFAULT 20,
    step_down_rub INTEGER DEFAULT 10,
    economy_enabled INTEGER DEFAULT 0,
    economy_success_required INTEGER DEFAULT 2,
    economy_step_down_rub INTEGER DEFAULT 10,
    economy_failure_cooldown_min INTEGER DEFAULT 60,
    stable_in_range_count INTEGER DEFAULT 0,
    last_good_bid_rub INTEGER DEFAULT 0,
    probe_bid_rub INTEGER DEFAULT 0,
    no_economy_until TEXT,
    no_raise_until TEXT,
    raise_pause_pos INTEGER DEFAULT 0,
    interval_min INTEGER DEFAULT 15,
    cooldown_min INTEGER DEFAULT 30,
    last_checked_at TEXT,
    last_changed_at TEXT,
    last_status TEXT,
    last_error TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(advert_id, nm_id, phrase)
);
CREATE INDEX IF NOT EXISTS idx_bid_auto_due ON bid_automation_rules(enabled, last_checked_at);
CREATE INDEX IF NOT EXISTS idx_bid_auto_campaign ON bid_automation_rules(advert_id, nm_id);
`);

// 17c. bid_automation_log — журнал решений автопилота.
db.exec(`
CREATE TABLE IF NOT EXISTS bid_automation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER,
    advert_id INTEGER NOT NULL,
    nm_id INTEGER NOT NULL,
    phrase TEXT NOT NULL,
    checked_at TEXT DEFAULT (datetime('now')),
    ad_pos INTEGER DEFAULT 0,
    organic_pos INTEGER DEFAULT 0,
    old_bid_rub INTEGER DEFAULT 0,
    new_bid_rub INTEGER DEFAULT 0,
    target_pos_from INTEGER DEFAULT 1,
    target_pos_to INTEGER DEFAULT 5,
    min_bid_rub INTEGER DEFAULT 0,
    max_bid_rub INTEGER DEFAULT 0,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    reason TEXT,
    dry_run INTEGER DEFAULT 1,
    details_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_bid_auto_log_rule ON bid_automation_log(rule_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_bid_auto_log_campaign ON bid_automation_log(advert_id, nm_id, checked_at DESC);
`);

// 17d. ai_diary_entries — read-only аналитический дневник по карточкам/фразам.
// ИИ-слой не меняет ставки и бюджеты: он только сохраняет выводы, факты и рекомендации.
db.exec(`
CREATE TABLE IF NOT EXISTS ai_diary_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    advert_id INTEGER NOT NULL,
    nm_id INTEGER NOT NULL,
    phrase TEXT,
    scope TEXT DEFAULT 'phrase',
    period_start TEXT,
    period_end TEXT,
    severity TEXT DEFAULT 'info',
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    evidence_json TEXT,
    recommendations_json TEXT,
    model TEXT DEFAULT 'local-analyst-v1',
    source TEXT DEFAULT 'manual',
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_diary_campaign ON ai_diary_entries(advert_id, nm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_diary_phrase ON ai_diary_entries(advert_id, nm_id, phrase, created_at DESC);
`);

// 18. auth_wb_funnel_daily (данные воронки из закрытого API seller-content)
db.exec(`
CREATE TABLE IF NOT EXISTS auth_wb_funnel_daily (
    nm_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    view_count INTEGER DEFAULT 0,
    open_card_count INTEGER DEFAULT 0,
    add_to_cart_count INTEGER DEFAULT 0,
    add_to_wishlist_count INTEGER DEFAULT 0,
    orders_count INTEGER DEFAULT 0,
    orders_sum REAL DEFAULT 0,
    buyouts_count INTEGER DEFAULT 0,
    buyouts_sum REAL DEFAULT 0,
    cancel_count INTEGER DEFAULT 0,
    cancel_sum REAL DEFAULT 0,
    view_to_open_conversion REAL DEFAULT 0,
    open_to_cart_conversion REAL DEFAULT 0,
    cart_to_order_conversion REAL DEFAULT 0,
    buyout_percent REAL DEFAULT 0,
    PRIMARY KEY (nm_id, date)
);
CREATE INDEX IF NOT EXISTS idx_auth_funnel_date ON auth_wb_funnel_daily(date);
`);

// 19. buyer_entry_points (портрет покупателя — источники трафика из закрытого API)
db.exec(`
-- placement_type values (cmp.wildberries.ru /api/v5/fullstat):
--   0 = агрегат всех зон (итог по кампании)
--   1 = Поиск
--   2 = Каталог
--   3 = Рекомендации
CREATE TABLE IF NOT EXISTS campaign_zones_daily (
    advert_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    placement_type INTEGER NOT NULL,
    views INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    sum REAL DEFAULT 0,
    orders INTEGER DEFAULT 0,
    atbs INTEGER DEFAULT 0,
    sum_price REAL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (advert_id, date, placement_type)
);
CREATE INDEX IF NOT EXISTS idx_zones_date ON campaign_zones_daily(date);
CREATE INDEX IF NOT EXISTS idx_zones_adv ON campaign_zones_daily(advert_id);

CREATE TABLE IF NOT EXISTS buyer_entry_points (
    nm_id INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    total_json TEXT,
    entry_points_json TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (nm_id, start_date, end_date)
);
CREATE INDEX IF NOT EXISTS idx_buyer_ep_dates ON buyer_entry_points(start_date, end_date);
`);

// Новые таблицы под детализацию рекламы из cmp.wildberries.ru/api/v3/fullstat (xlsx)
db.exec(`
CREATE TABLE IF NOT EXISTS campaign_days (
    advert_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    views_total INTEGER DEFAULT 0,
    views_search INTEGER DEFAULT 0,
    views_catalog INTEGER DEFAULT 0,
    views_reco INTEGER DEFAULT 0,
    clicks_total INTEGER DEFAULT 0,
    clicks_search INTEGER DEFAULT 0,
    clicks_catalog INTEGER DEFAULT 0,
    clicks_reco INTEGER DEFAULT 0,
    atbs_total INTEGER DEFAULT 0,
    orders_total INTEGER DEFAULT 0,
    sum_total REAL DEFAULT 0,
    sum_search REAL DEFAULT 0,
    sum_catalog REAL DEFAULT 0,
    sum_reco REAL DEFAULT 0,
    sum_price_total REAL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (advert_id, date)
);
CREATE INDEX IF NOT EXISTS idx_cday_date ON campaign_days(date);

CREATE TABLE IF NOT EXISTS campaign_keywords (
    advert_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    phrase TEXT NOT NULL,
    views INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    ctr REAL DEFAULT 0,
    spend REAL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (advert_id, date, phrase)
);
CREATE INDEX IF NOT EXISTS idx_ckw_date ON campaign_keywords(date);
CREATE INDEX IF NOT EXISTS idx_ckw_adv ON campaign_keywords(advert_id);

CREATE TABLE IF NOT EXISTS campaign_catalogs (
    advert_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    catalog_id TEXT NOT NULL,
    views INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    ctr REAL DEFAULT 0,
    cpc REAL DEFAULT 0,
    spend REAL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (advert_id, date, catalog_id)
);
CREATE INDEX IF NOT EXISTS idx_ccat_date ON campaign_catalogs(date);
CREATE INDEX IF NOT EXISTS idx_ccat_adv ON campaign_catalogs(advert_id);
`);

// Позиции товара в поисковой выдаче по фразе (открытый WB search endpoint)
// ad_pos — позиция с учётом рекламы (что видит покупатель)
// organic_pos — позиция без рекламы (ab_testid=no_promo)
// boost = organic_pos - ad_pos (на сколько реклама подняла)
db.exec(`
CREATE TABLE IF NOT EXISTS campaign_phrase_positions (
    advert_id INTEGER NOT NULL,
    nm_id INTEGER NOT NULL,
    norm_query TEXT NOT NULL,
    ad_pos INTEGER DEFAULT 0,
    organic_pos INTEGER DEFAULT 0,
    boost INTEGER DEFAULT 0,
    preset_id TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (advert_id, nm_id, norm_query)
);
CREATE INDEX IF NOT EXISTS idx_cpp_adv ON campaign_phrase_positions(advert_id);
`);

// Журнал проверок позиций — для отладки и анализа "прочерков"
// status: 'ok' | 'no_ad' | 'no_organic' | 'both_none' | 'parser_error' | 'ssh_error'
// via:    'batch' | 'single'
db.exec(`
CREATE TABLE IF NOT EXISTS position_sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    advert_id INTEGER NOT NULL,
    nm_id INTEGER NOT NULL,
    norm_query TEXT NOT NULL,
    ad_pos INTEGER,
    organic_pos INTEGER,
    boost INTEGER,
    is_advertised INTEGER DEFAULT 0,
    status TEXT NOT NULL,
    via TEXT,
    elapsed_sec REAL,
    raw_error TEXT,
    recorded_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pslog_adv_date ON position_sync_log(advert_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_pslog_phrase ON position_sync_log(norm_query, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_pslog_status ON position_sync_log(status, recorded_at DESC);
`);

// Per-phrase per-day статистика (POST /adv/v0/normquery/stats)
// Включает avg_pos, CPM, корзины, заказы — недоступные в xlsx-отчёте
db.exec(`
CREATE TABLE IF NOT EXISTS campaign_keyword_stats_daily (
    advert_id INTEGER NOT NULL,
    nm_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    norm_query TEXT NOT NULL,
    avg_pos REAL DEFAULT 0,
    views INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    ctr REAL DEFAULT 0,
    cpc REAL DEFAULT 0,
    cpm REAL DEFAULT 0,
    atbs INTEGER DEFAULT 0,
    orders INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (advert_id, nm_id, date, norm_query)
);
CREATE INDEX IF NOT EXISTS idx_cksd_adv_date ON campaign_keyword_stats_daily(advert_id, date);
CREATE INDEX IF NOT EXISTS idx_cksd_phrase ON campaign_keyword_stats_daily(norm_query);
`);

// Ставки CPM по ключевым фразам (POST /adv/v0/normquery/get-bids)
db.exec(`
CREATE TABLE IF NOT EXISTS campaign_keyword_bids (
    advert_id INTEGER NOT NULL,
    nm_id INTEGER NOT NULL,
    norm_query TEXT NOT NULL,
    bid INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (advert_id, nm_id, norm_query)
);
CREATE INDEX IF NOT EXISTS idx_ckb_adv_phrase ON campaign_keyword_bids(advert_id, norm_query);
`);

// Детальная статистика по товару/дню из Sheet1 xlsx-отчёта (per-day запросы)
db.exec(`
CREATE TABLE IF NOT EXISTS campaign_nm_daily (
    advert_id INTEGER NOT NULL,
    nm_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    product_name TEXT,
    spend REAL DEFAULT 0,
    order_sum REAL DEFAULT 0,
    views INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    atbs INTEGER DEFAULT 0,
    orders INTEGER DEFAULT 0,
    ctr REAL DEFAULT 0,
    cr REAL DEFAULT 0,
    cpm REAL DEFAULT 0,
    cpc REAL DEFAULT 0,
    cpo REAL DEFAULT 0,
    cancels INTEGER DEFAULT 0,
    avg_position INTEGER DEFAULT 0,
    multi_card_id INTEGER,
    conversion_type TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (advert_id, nm_id, date)
);
CREATE INDEX IF NOT EXISTS idx_cnm_adv_date ON campaign_nm_daily(advert_id, date);
CREATE INDEX IF NOT EXISTS idx_cnm_nm_date ON campaign_nm_daily(nm_id, date);
`);

// campaign_preset_keywords — полный список фраз/кластеров кампании (per nm_id)
// из cmp.wildberries.ru/api/v1/advert/{advertID}/preset-info
// Включает и управляемые (is_excluded=0), и исключения (is_excluded=1).
// Хранится только АКТУАЛЬНЫЙ срез (на sync — DELETE по advert_id+nm_id, INSERT всех).
// actual_cpm — в копейках (45000 = 450 ₽), NULL если ставка не задана вручную.
db.exec(`
CREATE TABLE IF NOT EXISTS campaign_preset_keywords (
    advert_id INTEGER NOT NULL,
    nm_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    is_excluded INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    baskets INTEGER DEFAULT 0,
    orders INTEGER DEFAULT 0,
    shks INTEGER DEFAULT 0,
    ctr REAL DEFAULT 0,
    cpc REAL DEFAULT 0,
    cpm REAL DEFAULT 0,
    avg_pos REAL DEFAULT 0,
    spend REAL DEFAULT 0,
    actual_cpm INTEGER,
    currency TEXT,
    from_date TEXT,
    to_date TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (advert_id, nm_id, name)
);
CREATE INDEX IF NOT EXISTS idx_cpk_adv ON campaign_preset_keywords(advert_id);
CREATE INDEX IF NOT EXISTS idx_cpk_adv_nm ON campaign_preset_keywords(advert_id, nm_id);
CREATE INDEX IF NOT EXISTS idx_cpk_name ON campaign_preset_keywords(name);
`);

// manual_clusters — ручная база кластеров. Пользователь сам создаёт/загружает кластеры
// (с копированием из MPSTATS или ручной ввод). Имя кластера + массив фраз.
// Используется для matching в /api/ad-campaign-detail (parent/child + суммарная частотность).
db.exec(`
DROP TABLE IF EXISTS preset_cluster_words;
CREATE TABLE IF NOT EXISTS manual_clusters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    phrases_json TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mc_name ON manual_clusters(name);
`);

// search_texts_wb — snapshot частотностей WB premium search-analysis (один снимок в сутки).
// Источник: POST seller-content.wildberries.ru/ns/analytics-api/content-analytics/api/v1/search-analysis/premium/search-texts
// (premium seller-analytics). Cron 06:00 МСК по всем subject_id активных кампаний.
// WB отдаёт interval='yesterday' → snapshot_date = МСК-«вчера» на момент sync. PK (phrase_lc, snapshot_date)
// — каждый день новая строка, история накапливается. Matcher к campaign_preset_keywords — по lower(name).
db.exec(`
CREATE TABLE IF NOT EXISTS search_texts_wb (
    phrase_lc TEXT NOT NULL,
    snapshot_date TEXT NOT NULL,
    phrase_raw TEXT,
    subject_id INTEGER,
    subject_name TEXT,
    frequency INTEGER DEFAULT 0,
    frequency_dynamic INTEGER DEFAULT 0,
    open_card INTEGER DEFAULT 0,
    open_card_dyn INTEGER DEFAULT 0,
    add_to_cart INTEGER DEFAULT 0,
    add_to_cart_dyn INTEGER DEFAULT 0,
    open_to_cart REAL DEFAULT 0,
    orders INTEGER DEFAULT 0,
    orders_dyn INTEGER DEFAULT 0,
    cart_to_order REAL DEFAULT 0,
    items_with_orders INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (phrase_lc, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_stwb_subj ON search_texts_wb(subject_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_stwb_date_freq ON search_texts_wb(snapshot_date, frequency DESC);
`);

// subject_min_cpm — минимальные CPM по предмету из cmp /v6/supplier-subjects
// Значения в РУБЛЯХ (minCPMSearch=263 = 263₽). Fallback ставка для управляемых
// фраз без actual_cpm — WB применяет эту базовую CPM автоматически.
db.exec(`
CREATE TABLE IF NOT EXISTS subject_min_cpm (
    subject_id INTEGER PRIMARY KEY,
    name TEXT,
    nms_count INTEGER DEFAULT 0,
    min_cpm INTEGER DEFAULT 0,
    min_cpm_search INTEGER DEFAULT 0,
    min_cpm_recom INTEGER DEFAULT 0,
    min_cpm_unified INTEGER DEFAULT 0,
    discount INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
);
`);

// 20. sync_log (журнал синхронизации)
db.exec(`
CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    total INTEGER DEFAULT 0,
    success INTEGER DEFAULT 0,
    errors INTEGER DEFAULT 0,
    error_details TEXT,
    duration_sec REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sync_log_type ON sync_log(type, started_at);
`);

// 20b. sync_test_log — журнал тестов из Test panel (Фаза 2).
// Пишем полный timeline каждого теста: конфиг, длительность, 429-счётчик, момент первого 429.
db.exec(`
CREATE TABLE IF NOT EXISTS sync_test_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT DEFAULT (datetime('now')),
    finished_at TEXT,
    endpoints TEXT,              -- 'v3' | 'v3-daily' | 'both'
    mode TEXT,                   -- 'sequential' | 'parallel'
    config_json TEXT,            -- params: {gap, backoff429, maxRetries, chunkSize, ...}
    total_requests INTEGER DEFAULT 0,
    total_ok INTEGER DEFAULT 0,
    total_429 INTEGER DEFAULT 0,
    total_err INTEGER DEFAULT 0,
    first_429_at_step INTEGER,   -- номер запроса, когда словили первый 429 (NULL если не было)
    duration_ms INTEGER,
    timeline_json TEXT           -- [{step, ts_rel_ms, advert_id, endpoint, status, duration_ms, error?}]
);
CREATE INDEX IF NOT EXISTS idx_stl_date ON sync_test_log(started_at DESC);
`);

// 21. supplier_orders — заказы WB Statistics API с СПП для дневной/почасовой аналитики карточек.
db.exec(`
CREATE TABLE IF NOT EXISTS supplier_orders (
    order_uid TEXT PRIMARY KEY,
    srid TEXT,
    g_number TEXT,
    sticker TEXT,
    date TEXT,
    date_day TEXT,
    date_hour INTEGER,
    last_change_date TEXT,
    nm_id INTEGER,
    supplier_article TEXT,
    barcode TEXT,
    category TEXT,
    subject TEXT,
    brand TEXT,
    tech_size TEXT,
    warehouse_name TEXT,
    warehouse_type TEXT,
    country_name TEXT,
    oblast_okrug_name TEXT,
    region_name TEXT,
    spp REAL,
    finished_price REAL,
    price_with_disc REAL,
    total_price REAL,
    discount_percent REAL,
    is_cancel INTEGER DEFAULT 0,
    cancel_date TEXT,
    raw_json TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_nm_day ON supplier_orders(nm_id, date_day);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_day ON supplier_orders(date_day);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_last_change ON supplier_orders(last_change_date);
`);

// 22. settings
db.exec(`
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
`);

// 23. accounts — учётные записи WB продавца, статус сессии проверяется раз в сутки
db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE,
    name TEXT,
    connection TEXT DEFAULT 'Активен',
    access TEXT,
    supplier_id TEXT,
    supplier_name TEXT,
    store_name TEXT,
    last_check_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
`);

// Миграции: добавление столбцов в уже существующие таблицы (идемпотентно).
// products: 30-дневный % выкупа и время обновления — для расчёта ДРРп/CPS во вкладке «Воронка продаж».
function addColumnIfMissing(table: string, col: string, ddl: string): void {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!info.some((r) => r.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    console.log(`  + ${table}.${col} добавлен`);
  }
}
try {
  addColumnIfMissing("bid_automation_rules", "no_raise_until", "no_raise_until TEXT");
  addColumnIfMissing("bid_automation_rules", "raise_pause_pos", "raise_pause_pos INTEGER DEFAULT 0");
} catch (e) {
  console.warn("bid_automation_rules migration skipped:", e);
}

try {
  addColumnIfMissing("products", "buyout_percent_30d", "buyout_percent_30d REAL DEFAULT 0");
  addColumnIfMissing("products", "buyout_updated_at", "buyout_updated_at TEXT");
} catch (e) {
  console.warn("products migration skipped:", e);
}

// manual_clusters: расширение для автоимпорта из MPSTATS.
// source='manual' — ручной ввод (дефолт), source='mpstats' — автоимпорт, перезаписываемый при ре-импорте.
// mpstats_preset_id — WB preset ID (совпадает с campaign_preset_keywords.preset_id).
try {
  addColumnIfMissing("manual_clusters", "source", "source TEXT DEFAULT 'manual'");
  addColumnIfMissing("manual_clusters", "mpstats_preset_id", "mpstats_preset_id INTEGER");
  addColumnIfMissing("manual_clusters", "imported_at", "imported_at TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_mc_preset ON manual_clusters(mpstats_preset_id) WHERE mpstats_preset_id IS NOT NULL");

  // Унифицированный preset_id (реальный WB-preset, любого источника). Раньше использовали
  // mpstats_preset_id — оставляем как метку «откуда пришёл», но логика теперь читает preset_id.
  addColumnIfMissing("manual_clusters", "preset_id", "preset_id INTEGER");
  db.exec("UPDATE manual_clusters SET preset_id = mpstats_preset_id WHERE preset_id IS NULL AND mpstats_preset_id IS NOT NULL");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_mc_preset_id ON manual_clusters(preset_id) WHERE preset_id IS NOT NULL");
} catch (e) {
  console.warn("manual_clusters migration skipped:", e);
}

// campaign_phrase_positions: «Мета-2» — фактический presetId из публичной выдачи search.wb.ru.
// ИСТОРИЧЕСКИЕ колонки от первой версии Meta-2 (когда писали per-article). Источником сейчас
// является глобальная таблица search_phrase_meta (phrase-centric), эти поля рудимент — оставлены
// для обратной совместимости БД. Можно будет удалить отдельным ALTER после стабилизации.
try {
  addColumnIfMissing("campaign_phrase_positions", "real_preset_id", "real_preset_id INTEGER");
  addColumnIfMissing("campaign_phrase_positions", "real_preset_checked_at", "real_preset_checked_at TEXT");
  addColumnIfMissing("campaign_phrase_positions", "real_preset_tokens", "real_preset_tokens TEXT");
} catch (e) {
  console.warn("campaign_phrase_positions meta-2 migration skipped:", e);
}

// WB Джем — per-nmId, per-phrase аналитика воронки (показы карточки / переходы / корзины / заказы)
// за скользящее окно 90 дней (today-89..today MSK). Источник: seller-content analytics API,
// endpoint POST /v2/search-report/product/search-texts (тот же, что использует EVIRMA).
// Upsert: одна строка на пару (nm_id, phrase). Period хранится для информации (по сути всегда 90d).
db.exec(`
CREATE TABLE IF NOT EXISTS phrase_djem_stats (
    nm_id INTEGER NOT NULL,
    phrase TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    view_count INTEGER DEFAULT 0,
    open_card_count INTEGER DEFAULT 0,
    add_to_cart_count INTEGER DEFAULT 0,
    order_count INTEGER DEFAULT 0,
    order_sum REAL DEFAULT 0,
    avg_position REAL DEFAULT 0,
    ctr REAL DEFAULT 0,
    open_to_cart_conversion REAL DEFAULT 0,
    cart_to_order_conversion REAL DEFAULT 0,
    avg_price REAL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (nm_id, phrase)
);
CREATE INDEX IF NOT EXISTS idx_pdjem_nm ON phrase_djem_stats(nm_id);
CREATE INDEX IF NOT EXISTS idx_pdjem_updated ON phrase_djem_stats(updated_at DESC);
`);

// Дневная разбивка того же Джема — по дню даёт тултип «90 строк». Bootstrap 90 запросов ×
// 3 topOrderBy = ~270 req/nmId один раз, потом только today инкрементально. PK (nm_id, phrase, date).
db.exec(`
CREATE TABLE IF NOT EXISTS phrase_djem_stats_daily (
    nm_id INTEGER NOT NULL,
    phrase TEXT NOT NULL,
    date TEXT NOT NULL,
    frequency INTEGER DEFAULT 0,
    open_card_count INTEGER DEFAULT 0,
    add_to_cart_count INTEGER DEFAULT 0,
    order_count INTEGER DEFAULT 0,
    avg_position REAL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (nm_id, phrase, date)
);
CREATE INDEX IF NOT EXISTS idx_pdjem_daily_nm_date ON phrase_djem_stats_daily(nm_id, date);
CREATE INDEX IF NOT EXISTS idx_pdjem_daily_nm_phrase ON phrase_djem_stats_daily(nm_id, phrase);
`);

// ГЛОБАЛЬНАЯ Meta-2: phrase → presetId. WB-кластер (presetId) по запросу не зависит от nmId —
// это свойство самой фразы (canonical cluster WB-поисковика). Поэтому храним phrase-centric:
// любой артикул при своём скане обновляет общую запись; при открытии другой кампании данные
// уже есть, переписывать не нужно если preset не изменился.
//
// При каждом SSH-скане:
//   - нет записи → INSERT (first_seen=last_verified=last_changed=now, checks=1)
//   - есть и preset_id такой же → UPDATE last_verified, checks_count++
//   - есть и preset_id иной → UPDATE preset_id/tokens + last_verified + last_changed, checks_count++
//
// phrase храним в lowercase; UI-фраза матчится через lower(phrase).
db.exec(`
CREATE TABLE IF NOT EXISTS search_phrase_meta (
    phrase TEXT PRIMARY KEY,
    preset_id INTEGER,
    tokens_json TEXT,
    first_seen_at TEXT DEFAULT (datetime('now')),
    last_verified_at TEXT DEFAULT (datetime('now')),
    last_changed_at TEXT DEFAULT (datetime('now')),
    checks_count INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_spm_verified ON search_phrase_meta(last_verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_spm_changed ON search_phrase_meta(last_changed_at DESC);
`);

// Журнал проверок Мета-2 (search.wb.ru meta.presetId). Независим от position_sync_log:
// позиции и presetId иногда расходятся во времени (cache, retry), поэтому отдельная таблица.
db.exec(`
CREATE TABLE IF NOT EXISTS search_meta_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT DEFAULT (datetime('now')),
    advert_id INTEGER,
    nm_id INTEGER NOT NULL,
    phrase TEXT NOT NULL,
    page INTEGER,
    found INTEGER DEFAULT 0,
    real_preset_id INTEGER,
    tokens_json TEXT,
    expected_preset_id INTEGER,
    match INTEGER,
    http_status INTEGER,
    duration_ms INTEGER,
    error TEXT
);
CREATE INDEX IF NOT EXISTS idx_search_meta_log_at ON search_meta_log(at DESC);
CREATE INDEX IF NOT EXISTS idx_search_meta_log_nm_phrase ON search_meta_log(nm_id, phrase, at DESC);
CREATE INDEX IF NOT EXISTS idx_search_meta_log_advert ON search_meta_log(advert_id, at DESC);
`);

// Verify
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
console.log(`\nCreated ${tables.length} tables:`);
tables.forEach((t, i) => console.log(`  ${i + 1}. ${t.name}`));

db.close();
console.log("\nDatabase initialized successfully at", DB_PATH);
