import { getDb } from "@/lib/db";
import { localDateStr } from "@/lib/format";

export interface AiDiaryEntry {
  id: number;
  advert_id: number;
  nm_id: number;
  phrase: string | null;
  scope: string;
  period_start: string | null;
  period_end: string | null;
  severity: "info" | "success" | "warning";
  title: string;
  summary: string;
  evidence_json: string | null;
  recommendations_json: string | null;
  model: string;
  source: string;
  created_at: string;
}

interface BidLogRow {
  id: number;
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
}

interface KeywordStats {
  views: number;
  clicks: number;
  atbs: number;
  orders: number;
  avg_pos: number;
  cpm: number;
  cpc: number;
}

interface DailyKeywordStats extends KeywordStats {
  date: string;
  ctr: number;
}

interface DailyCampaignStats {
  date: string;
  spend: number;
  order_sum: number;
  views: number;
  clicks: number;
  atbs: number;
  orders: number;
  ctr: number;
  cr: number;
  cpm: number;
  cpc: number;
  cpo: number;
  avg_position: number;
}

interface DjemStats {
  view_count: number;
  open_card_count: number;
  add_to_cart_count: number;
  order_count: number;
  order_sum: number;
  ctr: number;
  open_to_cart_conversion: number;
  cart_to_order_conversion: number;
  avg_position: number;
  period_start: string | null;
  period_end: string | null;
}

interface DailyDjemStats {
  date: string;
  frequency: number;
  open_card_count: number;
  add_to_cart_count: number;
  order_count: number;
  avg_position: number;
}

interface PositionLogRow {
  recorded_at: string;
  ad_pos: number | null;
  organic_pos: number | null;
  status: string;
}

interface Recommendation {
  type: string;
  title: string;
  text: string;
  confidence: "low" | "medium" | "high";
}

export function ensureAiDiaryTables() {
  const db = getDb();
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
  return db;
}

export function listAiDiaryEntries(params: {
  advertId: number;
  nmId: number;
  phrase?: string;
  limit?: number;
}): AiDiaryEntry[] {
  const db = ensureAiDiaryTables();
  const limit = Math.max(1, Math.min(100, Math.round(Number(params.limit || 20))));
  const args: Array<number | string> = [params.advertId, params.nmId];
  let phraseSql = "";
  if (params.phrase?.trim()) {
    phraseSql = "AND lower(COALESCE(phrase, '')) = lower(?)";
    args.push(params.phrase.trim());
  }
  return db.prepare(`
    SELECT *
    FROM ai_diary_entries
    WHERE advert_id = ? AND nm_id = ? ${phraseSql}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(...args, limit) as AiDiaryEntry[];
}

function round(n: number, digits = 1): number {
  const m = 10 ** digits;
  return Math.round((Number(n) || 0) * m) / m;
}

function pct(part: number, total: number): number {
  if (!total) return 0;
  return round((part / total) * 100, 2);
}

function diaryPeriod(daysBack = 7): { period_start: string; period_end: string; days: string[]; day_count: number } {
  const today = new Date();
  const days: string[] = [];
  for (let offset = daysBack; offset >= 0; offset -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - offset);
    days.push(localDateStr(d));
  }
  return {
    period_start: days[0],
    period_end: days[days.length - 1],
    days,
    day_count: days.length,
  };
}

function formatBidChange(log: BidLogRow): string {
  if (log.old_bid_rub === log.new_bid_rub) return `${log.new_bid_rub} ₽`;
  return `${log.old_bid_rub} -> ${log.new_bid_rub} ₽`;
}

function findExpensivePositionGain(logs: BidLogRow[]): Recommendation | null {
  const points = logs
    .map((l) => ({ bid: l.new_bid_rub || l.old_bid_rub, pos: l.ad_pos }))
    .filter((p) => p.bid > 0 && p.pos > 0);
  if (points.length < 2) return null;

  const byBid = new Map<number, { bid: number; positions: number[] }>();
  for (const p of points) {
    const item = byBid.get(p.bid) || { bid: p.bid, positions: [] };
    item.positions.push(p.pos);
    byBid.set(p.bid, item);
  }
  const averaged = [...byBid.values()]
    .map((p) => ({ bid: p.bid, pos: p.positions.reduce((a, b) => a + b, 0) / p.positions.length }))
    .sort((a, b) => a.bid - b.bid);

  for (let i = 0; i < averaged.length - 1; i += 1) {
    for (let j = i + 1; j < averaged.length; j += 1) {
      const cheap = averaged[i];
      const costly = averaged[j];
      const bidDelta = costly.bid - cheap.bid;
      const posGain = cheap.pos - costly.pos;
      if (bidDelta >= 100 && posGain > 0 && posGain <= 1.2) {
        return {
          type: "expensive_position_gain",
          title: "Проверить цену улучшения позиции",
          text: `Ставка ${cheap.bid} ₽ давала около ${round(cheap.pos)} позиции, а ${costly.bid} ₽ - около ${round(costly.pos)}. Доплата ${bidDelta} ₽ улучшила выдачу примерно на ${round(posGain)} позицию. Если клики и заказы не выросли, такую переплату лучше не закреплять.`,
          confidence: "medium",
        };
      }
    }
  }
  return null;
}

export function createAiDiaryEntry(params: {
  advertId: number;
  nmId: number;
  phrase: string;
  source?: string;
}): AiDiaryEntry {
  const db = ensureAiDiaryTables();
  const phrase = params.phrase.trim();
  const period = diaryPeriod(7);

  const logs = db.prepare(`
    SELECT id, checked_at, ad_pos, organic_pos, old_bid_rub, new_bid_rub,
           target_pos_from, target_pos_to, min_bid_rub, max_bid_rub,
           action, status, reason, dry_run
    FROM bid_automation_log
    WHERE advert_id = ? AND nm_id = ? AND lower(phrase) = lower(?)
    ORDER BY checked_at DESC, id DESC
    LIMIT 30
  `).all(params.advertId, params.nmId, phrase) as BidLogRow[];

  const rule = db.prepare(`
    SELECT enabled, dry_run, target_pos_from, target_pos_to, min_bid_rub, max_bid_rub,
           step_up_rub, step_down_rub, economy_enabled, economy_step_down_rub,
           economy_success_required, stable_in_range_count, last_good_bid_rub, probe_bid_rub,
           interval_min, cooldown_min, last_checked_at, last_changed_at, last_status, last_error
    FROM bid_automation_rules
    WHERE advert_id = ? AND nm_id = ? AND lower(phrase) = lower(?)
  `).get(params.advertId, params.nmId, phrase) as Record<string, unknown> | undefined;

  const keyword = db.prepare(`
    SELECT SUM(views) views,
           SUM(clicks) clicks,
           SUM(atbs) atbs,
           SUM(orders) orders,
           SUM(avg_pos * views) weighted_pos,
           SUM(views * cpm) weighted_cpm,
           SUM(clicks * cpc) weighted_cpc
    FROM campaign_keyword_stats_daily
    WHERE advert_id = ? AND nm_id = ? AND lower(norm_query) = lower(?)
      AND date >= ? AND date <= ?
  `).get(params.advertId, params.nmId, phrase, period.period_start, period.period_end) as {
    views: number | null;
    clicks: number | null;
    atbs: number | null;
    orders: number | null;
    weighted_pos: number | null;
    weighted_cpm: number | null;
    weighted_cpc: number | null;
  };
  const keywordStats: KeywordStats = {
    views: Number(keyword?.views || 0),
    clicks: Number(keyword?.clicks || 0),
    atbs: Number(keyword?.atbs || 0),
    orders: Number(keyword?.orders || 0),
    avg_pos: Number(keyword?.views || 0) > 0 ? Number(keyword?.weighted_pos || 0) / Number(keyword.views) : 0,
    cpm: Number(keyword?.views || 0) > 0 ? Number(keyword?.weighted_cpm || 0) / Number(keyword.views) : 0,
    cpc: Number(keyword?.clicks || 0) > 0 ? Number(keyword?.weighted_cpc || 0) / Number(keyword.clicks) : 0,
  };

  const keywordDailyRows = db.prepare(`
    SELECT date, avg_pos, views, clicks, cpm, cpc, atbs, orders
    FROM campaign_keyword_stats_daily
    WHERE advert_id = ? AND nm_id = ? AND lower(norm_query) = lower(?)
      AND date >= ? AND date <= ?
    ORDER BY date
  `).all(params.advertId, params.nmId, phrase, period.period_start, period.period_end) as Array<Partial<DailyKeywordStats>>;
  const keywordDailyByDate = new Map(keywordDailyRows.map((row) => [String(row.date), row]));
  const dailyKeywordStats: DailyKeywordStats[] = period.days.map((date) => {
    const row = keywordDailyByDate.get(date);
    const views = Number(row?.views || 0);
    const clicks = Number(row?.clicks || 0);
    return {
      date,
      views,
      clicks,
      atbs: Number(row?.atbs || 0),
      orders: Number(row?.orders || 0),
      avg_pos: Number(row?.avg_pos || 0),
      cpm: Number(row?.cpm || 0),
      cpc: Number(row?.cpc || 0),
      ctr: pct(clicks, views),
    };
  });

  const campaignDailyRows = db.prepare(`
    SELECT date, spend, order_sum, views, clicks, atbs, orders,
           ctr, cr, cpm, cpc, cpo, avg_position
    FROM campaign_nm_daily
    WHERE advert_id = ? AND nm_id = ? AND date >= ? AND date <= ?
    ORDER BY date
  `).all(params.advertId, params.nmId, period.period_start, period.period_end) as Array<Partial<DailyCampaignStats>>;
  const campaignDailyByDate = new Map(campaignDailyRows.map((row) => [String(row.date), row]));
  const dailyCampaignStats: DailyCampaignStats[] = period.days.map((date) => {
    const row = campaignDailyByDate.get(date);
    const views = Number(row?.views || 0);
    const clicks = Number(row?.clicks || 0);
    const orders = Number(row?.orders || 0);
    const spend = Number(row?.spend || 0);
    return {
      date,
      spend,
      order_sum: Number(row?.order_sum || 0),
      views,
      clicks,
      atbs: Number(row?.atbs || 0),
      orders,
      ctr: views > 0 ? pct(clicks, views) : Number(row?.ctr || 0),
      cr: clicks > 0 ? pct(orders, clicks) : Number(row?.cr || 0),
      cpm: Number(row?.cpm || 0),
      cpc: clicks > 0 ? round(spend / clicks, 2) : Number(row?.cpc || 0),
      cpo: orders > 0 ? round(spend / orders, 2) : Number(row?.cpo || 0),
      avg_position: Number(row?.avg_position || 0),
    };
  });

  const djem = db.prepare(`
    SELECT view_count, open_card_count, add_to_cart_count, order_count, order_sum,
           ctr, open_to_cart_conversion, cart_to_order_conversion, avg_position,
           period_start, period_end
    FROM phrase_djem_stats
    WHERE nm_id = ? AND lower(phrase) = lower(?)
  `).get(params.nmId, phrase) as DjemStats | undefined;

  const djemDailyRows = db.prepare(`
    SELECT date, frequency, open_card_count, add_to_cart_count, order_count, avg_position
    FROM phrase_djem_stats_daily
    WHERE nm_id = ? AND lower(phrase) = lower(?)
      AND date >= ? AND date <= ?
    ORDER BY date
  `).all(params.nmId, phrase, period.period_start, period.period_end) as Array<Partial<DailyDjemStats>>;
  const djemDailyByDate = new Map(djemDailyRows.map((row) => [String(row.date), row]));
  const dailyDjemStats: DailyDjemStats[] = period.days.map((date) => {
    const row = djemDailyByDate.get(date);
    return {
      date,
      frequency: Number(row?.frequency || 0),
      open_card_count: Number(row?.open_card_count || 0),
      add_to_cart_count: Number(row?.add_to_cart_count || 0),
      order_count: Number(row?.order_count || 0),
      avg_position: Number(row?.avg_position || 0),
    };
  });

  const currentPosition = db.prepare(`
    SELECT ad_pos, organic_pos, boost, updated_at
    FROM campaign_phrase_positions
    WHERE advert_id = ? AND nm_id = ? AND lower(norm_query) = lower(?)
  `).get(params.advertId, params.nmId, phrase) as Record<string, unknown> | undefined;

  const currentBid = db.prepare(`
    SELECT
      COALESCE(
        (SELECT MAX(actual_cpm) / 100 FROM campaign_preset_keywords WHERE advert_id = ? AND nm_id = ? AND lower(name) = lower(?)),
        (SELECT MAX(bid) FROM campaign_keyword_bids WHERE advert_id = ? AND nm_id = ? AND lower(norm_query) = lower(?)),
        0
      ) AS bid
  `).get(params.advertId, params.nmId, phrase, params.advertId, params.nmId, phrase) as { bid: number | null };

  const positionLogs = db.prepare(`
    SELECT recorded_at, ad_pos, organic_pos, status
    FROM position_sync_log
    WHERE advert_id = ? AND nm_id = ? AND lower(norm_query) = lower(?)
    ORDER BY recorded_at DESC, id DESC
    LIMIT 20
  `).all(params.advertId, params.nmId, phrase) as PositionLogRow[];

  const recommendations: Recommendation[] = [];
  const latest = logs[0];
  const unavailableCount = logs.filter((l) => l.action === "position_unavailable" || l.status === "error").length;
  const rollbackCount = logs.filter((l) => l.action === "rollback").length;
  const lowerProbeCount = logs.filter((l) => l.action === "lower_probe" || l.action === "keep_lowered").length;

  const expensiveGain = findExpensivePositionGain(logs);
  if (expensiveGain) recommendations.push(expensiveGain);

  if (unavailableCount >= 3) {
    recommendations.push({
      type: "position_checks_unstable",
      title: "Не менять ставку при нестабильных проверках",
      text: `В последних проверках ${unavailableCount} раз позиция не была надёжно определена. В такой ситуации лучше ждать следующий запуск, а не повышать ставку на пустых данных.`,
      confidence: "high",
    });
  }
  if (latest?.action === "max_reached" && latest.ad_pos > latest.target_pos_to) {
    recommendations.push({
      type: "target_too_aggressive",
      title: "Цель может быть слишком дорогой",
      text: `Даже на лимите ${latest.max_bid_rub} ₽ позиция ${latest.ad_pos} ниже цели ${latest.target_pos_from}-${latest.target_pos_to}. Стоит проверить экономику запроса или расширить допустимый диапазон позиций.`,
      confidence: "medium",
    });
  }
  if (lowerProbeCount >= 2 && rollbackCount === 0) {
    recommendations.push({
      type: "economy_works",
      title: "Экономия выглядит полезной",
      text: `Система уже ${lowerProbeCount} раз пробовала или удерживала сниженную ставку без отката. Можно продолжать экономить внутри диапазона и смотреть, не падают ли клики и заказы.`,
      confidence: "medium",
    });
  }
  if (keywordStats.views >= 300 && pct(keywordStats.clicks, keywordStats.views) < 0.5) {
    recommendations.push({
      type: "low_ctr",
      title: "Низкий CTR по запросу",
      text: `За сегодня и 7 дней было ${keywordStats.views} показов и ${keywordStats.clicks} кликов. CTR ${pct(keywordStats.clicks, keywordStats.views)}%. Перед ростом ставки стоит проверить фото, цену и релевантность запроса.`,
      confidence: "medium",
    });
  }
  if (keywordStats.clicks >= 10 && keywordStats.orders === 0) {
    recommendations.push({
      type: "clicks_without_orders",
      title: "Клики не превращаются в заказы",
      text: `За сегодня и 7 дней есть ${keywordStats.clicks} кликов, но заказов по запросу нет. Повышать ставку рискованно, пока карточка или запрос не дают конверсию.`,
      confidence: "medium",
    });
  }
  if (recommendations.length === 0) {
    recommendations.push({
      type: "keep_observing",
      title: "Продолжать наблюдение",
      text: "Явной проблемы по последним данным не видно. Для более уверенного вывода нужно больше проверок ставки, позиции и заказов.",
      confidence: logs.length >= 5 ? "medium" : "low",
    });
  }

  let severity: AiDiaryEntry["severity"] = "info";
  if (recommendations.some((r) => ["position_checks_unstable", "target_too_aggressive", "low_ctr", "clicks_without_orders", "expensive_position_gain"].includes(r.type))) {
    severity = "warning";
  }
  if (recommendations.some((r) => r.type === "economy_works") && !recommendations.some((r) => r.type === "position_checks_unstable")) {
    severity = "success";
  }

  const title = latest
    ? `Разбор последней проверки: ${latest.action}`
    : "Первичный разбор запроса";

  const summaryParts = [
    latest
      ? `Последняя проверка: позиция ${latest.ad_pos || "-"}, ставка ${formatBidChange(latest)}, действие ${latest.action}. Причина: ${latest.reason || "не указана"}.`
      : "Автоставка ещё не оставляла проверок по этому запросу.",
    `За сегодня и 7 дней: показы ${keywordStats.views}, клики ${keywordStats.clicks}, корзины ${keywordStats.atbs}, заказы ${keywordStats.orders}, CTR ${pct(keywordStats.clicks, keywordStats.views)}%.`,
  ];
  if (djem) {
    summaryParts.push(`Джем: показы ${djem.view_count}, переходы ${djem.open_card_count}, корзины ${djem.add_to_cart_count}, заказы ${djem.order_count}, средняя позиция ${round(djem.avg_position)}.`);
  }
  if (rollbackCount > 0) {
    summaryParts.push(`Было ${rollbackCount} откатов после просадки позиции, поэтому снижать ставку нужно осторожно.`);
  }

  const evidence = {
    advertId: params.advertId,
    nmId: params.nmId,
    phrase,
    period,
    rule: rule || null,
    currentBidRub: Math.round(Number(currentBid?.bid || 0)),
    currentPosition: currentPosition || null,
    keywordStats: { ...keywordStats, ctr: pct(keywordStats.clicks, keywordStats.views) },
    dailyKeywordStats,
    dailyCampaignStats,
    djemStats: djem || null,
    dailyDjemStats,
    recentBidLogs: logs,
    recentPositionChecks: positionLogs,
  };

  const inserted = db.prepare(`
    INSERT INTO ai_diary_entries
      (advert_id, nm_id, phrase, scope, period_start, period_end, severity, title, summary,
       evidence_json, recommendations_json, model, source)
    VALUES (?, ?, ?, 'phrase', ?, ?, ?, ?, ?, ?, ?, 'local-analyst-v1', ?)
  `).run(
    params.advertId,
    params.nmId,
    phrase,
    period.period_start,
    period.period_end,
    severity,
    title,
    summaryParts.join("\n"),
    JSON.stringify(evidence),
    JSON.stringify(recommendations),
    params.source || "manual",
  );

  return db.prepare(`SELECT * FROM ai_diary_entries WHERE id = ?`).get(inserted.lastInsertRowid) as AiDiaryEntry;
}

export function createAiDiaryEntryIfDue(params: {
  advertId: number;
  nmId: number;
  phrase: string;
  source: string;
  minMinutesBetween?: number;
}): AiDiaryEntry | null {
  const db = ensureAiDiaryTables();
  const minMinutesBetween = Math.max(1, Math.round(Number(params.minMinutesBetween || 15)));
  const recent = db.prepare(`
    SELECT created_at
    FROM ai_diary_entries
    WHERE advert_id = ? AND nm_id = ? AND lower(COALESCE(phrase, '')) = lower(?)
      AND source = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(params.advertId, params.nmId, params.phrase, params.source) as { created_at: string } | undefined;

  if (recent?.created_at) {
    const t = new Date(`${recent.created_at.replace(" ", "T")}Z`).getTime();
    if (Number.isFinite(t) && (Date.now() - t) / 60000 < minMinutesBetween) return null;
  }

  return createAiDiaryEntry({
    advertId: params.advertId,
    nmId: params.nmId,
    phrase: params.phrase,
    source: params.source,
  });
}
