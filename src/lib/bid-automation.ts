import { getDb } from "@/lib/db";

export interface BidAutomationRule {
  id: number;
  advert_id: number;
  nm_id: number;
  phrase: string;
  enabled: number;
  dry_run: number;
  target_pos_from: number;
  target_pos_to: number;
  min_bid_rub: number;
  max_bid_rub: number;
  step_up_rub: number;
  step_down_rub: number;
  economy_enabled: number;
  economy_success_required: number;
  economy_step_down_rub: number;
  economy_failure_cooldown_min: number;
  stable_in_range_count: number;
  last_good_bid_rub: number;
  probe_bid_rub: number;
  no_economy_until: string | null;
  no_raise_until: string | null;
  raise_pause_pos: number;
  interval_min: number;
  cooldown_min: number;
  last_checked_at: string | null;
  last_changed_at: string | null;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface BidAutomationLog {
  id: number;
  rule_id: number | null;
  advert_id: number;
  nm_id: number;
  phrase: string;
  checked_at: string;
  ad_pos: number;
  organic_pos: number;
  old_bid_rub: number;
  new_bid_rub: number;
  target_pos_from: number;
  target_pos_to: number;
  min_bid_rub: number;
  max_bid_rub: number;
  action: string;
  status: string;
  reason: string | null;
  dry_run: number;
  details_json: string | null;
}

export function ensureBidAutomationTables() {
  const db = getDb();
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
  addColumnIfMissing(db, "bid_automation_rules", "economy_enabled", "economy_enabled INTEGER DEFAULT 0");
  addColumnIfMissing(db, "bid_automation_rules", "economy_success_required", "economy_success_required INTEGER DEFAULT 2");
  addColumnIfMissing(db, "bid_automation_rules", "economy_step_down_rub", "economy_step_down_rub INTEGER DEFAULT 10");
  addColumnIfMissing(db, "bid_automation_rules", "economy_failure_cooldown_min", "economy_failure_cooldown_min INTEGER DEFAULT 60");
  addColumnIfMissing(db, "bid_automation_rules", "stable_in_range_count", "stable_in_range_count INTEGER DEFAULT 0");
  addColumnIfMissing(db, "bid_automation_rules", "last_good_bid_rub", "last_good_bid_rub INTEGER DEFAULT 0");
  addColumnIfMissing(db, "bid_automation_rules", "probe_bid_rub", "probe_bid_rub INTEGER DEFAULT 0");
  addColumnIfMissing(db, "bid_automation_rules", "no_economy_until", "no_economy_until TEXT");
  addColumnIfMissing(db, "bid_automation_rules", "no_raise_until", "no_raise_until TEXT");
  addColumnIfMissing(db, "bid_automation_rules", "raise_pause_pos", "raise_pause_pos INTEGER DEFAULT 0");
  return db;
}

function addColumnIfMissing(db: ReturnType<typeof getDb>, table: string, col: string, ddl: string) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!info.some((r) => r.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function normalizePhrase(phrase: unknown): string {
  return String(phrase ?? "").trim();
}
