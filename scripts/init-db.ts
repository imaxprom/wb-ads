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

// 21. settings
db.exec(`
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
`);

// Verify
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
console.log(`\nCreated ${tables.length} tables:`);
tables.forEach((t, i) => console.log(`  ${i + 1}. ${t.name}`));

db.close();
console.log("\nDatabase initialized successfully at", DB_PATH);
