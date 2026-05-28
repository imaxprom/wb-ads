import { NextRequest, NextResponse } from "next/server";
import { ensureBidAutomationTables, type BidAutomationRule } from "@/lib/bid-automation";
import { createAiDiaryEntryIfDue } from "@/lib/ai-diary";
import { readBidLimitRub } from "@/lib/bid-limits";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const BASE = process.env.WB_ADS_INTERNAL_BASE_URL || "http://127.0.0.1:3001";
const POSITION_CHECK_ATTEMPTS = 3;
const INEFFECTIVE_RAISE_LOOKBACK_MIN = 90;
const DIARY_ACTIONS = new Set(["raise", "lower", "lower_probe", "keep_lowered", "rollback", "rollback_ineffective", "raise_paused", "max_reached", "min_reached", "position_unavailable", "error"]);

interface PositionResult {
  phrase: string;
  ad_pos: number;
  organic_pos: number;
  boost: number;
  error: boolean;
  status?: string;
}

interface RuleState {
  stableCount: number;
  lastGoodBid: number;
  probeBid: number;
  noEconomyUntil: string | null;
  noRaiseUntil: string | null;
  raisePausePos: number;
}

interface Decision {
  action: string;
  newBid: number;
  reason: string;
  requiresBidChange: boolean;
  state: RuleState;
}

function minutesSinceSql(ts: string | null): number {
  if (!ts) return Number.POSITIVE_INFINITY;
  const t = new Date(`${ts.replace(" ", "T")}Z`).getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 60000;
}

function sqlAfterMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString().slice(0, 19).replace("T", " ");
}

function sqlInFuture(ts: string | null): boolean {
  if (!ts) return false;
  const t = new Date(`${ts.replace(" ", "T")}Z`).getTime();
  return Number.isFinite(t) && t > Date.now();
}

function currentState(rule: BidAutomationRule): RuleState {
  return {
    stableCount: Math.max(0, Math.round(Number(rule.stable_in_range_count || 0))),
    lastGoodBid: Math.max(0, Math.round(Number(rule.last_good_bid_rub || 0))),
    probeBid: Math.max(0, Math.round(Number(rule.probe_bid_rub || 0))),
    noEconomyUntil: rule.no_economy_until || null,
    noRaiseUntil: rule.no_raise_until || null,
    raisePausePos: Math.max(0, Math.round(Number(rule.raise_pause_pos || 0))),
  };
}

function withState(action: string, newBid: number, reason: string, requiresBidChange: boolean, state: RuleState): Decision {
  return { action, newBid, reason, requiresBidChange, state };
}

function clearRaisePause(state: RuleState): RuleState {
  return { ...state, noRaiseUntil: null, raisePausePos: 0 };
}

function actionForPosition(rule: BidAutomationRule, adPos: number, oldBid: number): Decision {
  const minBid = Math.max(1, rule.min_bid_rub);
  const maxBid = Math.max(minBid, rule.max_bid_rub);
  const current = oldBid > 0 ? oldBid : minBid;
  const state = currentState(rule);
  const resetProbe = { ...state, stableCount: 0, probeBid: 0 };

  if (adPos <= 0) {
    if (rule.economy_enabled && state.probeBid > 0 && state.lastGoodBid > 0) {
      return withState("rollback", Math.min(maxBid, Math.max(minBid, state.lastGoodBid)), "probe lost advertising; rollback to last good bid", true, {
        stableCount: 0,
        lastGoodBid: state.lastGoodBid,
        probeBid: 0,
        noEconomyUntil: sqlAfterMinutes(rule.economy_failure_cooldown_min),
        noRaiseUntil: null,
        raisePausePos: 0,
      });
    }
    if (current >= maxBid) return withState("max_reached", maxBid, "not advertised and max bid reached", false, resetProbe);
    return withState("raise", Math.min(maxBid, Math.max(minBid, current + rule.step_up_rub)), "not advertised", true, resetProbe);
  }
  if (adPos > rule.target_pos_to) {
    if (rule.economy_enabled && state.probeBid > 0 && state.lastGoodBid > 0) {
      return withState("rollback", Math.min(maxBid, Math.max(minBid, state.lastGoodBid)), `probe moved position to ${adPos}; rollback to last good bid`, true, {
        stableCount: 0,
        lastGoodBid: state.lastGoodBid,
        probeBid: 0,
        noEconomyUntil: sqlAfterMinutes(rule.economy_failure_cooldown_min),
        noRaiseUntil: null,
        raisePausePos: 0,
      });
    }
    if (sqlInFuture(state.noRaiseUntil) && state.raisePausePos > 0 && adPos <= state.raisePausePos) {
      return withState(
        "raise_paused",
        current,
        `raises paused after ineffective max; position ${adPos} is not worse than rollback position ${state.raisePausePos}`,
        false,
        { ...resetProbe, noRaiseUntil: state.noRaiseUntil, raisePausePos: state.raisePausePos },
      );
    }
    if (current >= maxBid) return withState("max_reached", maxBid, `position ${adPos} below target ${rule.target_pos_from}-${rule.target_pos_to}`, false, resetProbe);
    return withState("raise", Math.min(maxBid, Math.max(minBid, current + rule.step_up_rub)), `position ${adPos} below target ${rule.target_pos_from}-${rule.target_pos_to}`, true, resetProbe);
  }
  if (adPos < rule.target_pos_from) {
    if (current <= minBid) return withState("min_reached", minBid, `position ${adPos} above target and min bid reached`, false, clearRaisePause(resetProbe));
    return withState("lower", Math.max(minBid, current - rule.step_down_rub), `position ${adPos} above target ${rule.target_pos_from}-${rule.target_pos_to}`, true, clearRaisePause(resetProbe));
  }

  if (!rule.economy_enabled) {
    return withState("hold", current, `position ${adPos} inside target ${rule.target_pos_from}-${rule.target_pos_to}`, false, {
      stableCount: state.stableCount + 1,
      lastGoodBid: current,
      probeBid: 0,
      noEconomyUntil: state.noEconomyUntil,
      noRaiseUntil: null,
      raisePausePos: 0,
    });
  }

  if (state.probeBid > 0) {
    return withState("keep_lowered", current, `probe bid kept position ${adPos} inside target`, false, {
      stableCount: 1,
      lastGoodBid: current,
      probeBid: 0,
      noEconomyUntil: state.noEconomyUntil,
      noRaiseUntil: null,
      raisePausePos: 0,
    });
  }

  const stableCount = state.stableCount + 1;
  if (sqlInFuture(state.noEconomyUntil)) {
    return withState("hold", current, `economy paused after failed probe; position ${adPos} inside target`, false, {
      stableCount,
      lastGoodBid: current,
      probeBid: 0,
      noEconomyUntil: state.noEconomyUntil,
      noRaiseUntil: null,
      raisePausePos: 0,
    });
  }

  if (stableCount >= rule.economy_success_required && current > minBid) {
    const newBid = Math.max(minBid, current - Math.max(1, rule.economy_step_down_rub));
    if (newBid < current) {
      return withState("lower_probe", newBid, `position ${adPos} stable; probing lower bid`, true, {
        stableCount: 0,
        lastGoodBid: current,
        probeBid: newBid,
        noEconomyUntil: null,
        noRaiseUntil: null,
        raisePausePos: 0,
      });
    }
  }

  return withState("hold", current, `position ${adPos} inside target ${rule.target_pos_from}-${rule.target_pos_to}`, false, {
    stableCount,
    lastGoodBid: current,
    probeBid: 0,
    noEconomyUntil: state.noEconomyUntil,
    noRaiseUntil: null,
    raisePausePos: 0,
  });
}

function positionIsUsable(pos: PositionResult | undefined): boolean {
  if (!pos) return false;
  if (pos.status === "ok") return true;
  if (pos.status === "no_organic" && pos.ad_pos > 0) return true;
  if (pos.error) return false;
  return pos.ad_pos > 0;
}

function findIneffectiveRollbackBid(
  db: ReturnType<typeof ensureBidAutomationTables>,
  rule: BidAutomationRule,
  adPos: number,
  oldBid: number,
): number | null {
  if (adPos <= 0 || oldBid <= rule.min_bid_rub) return null;
  const rows = db.prepare(`
    SELECT ad_pos, old_bid_rub, new_bid_rub, action, status
    FROM bid_automation_log
    WHERE rule_id = ?
      AND checked_at >= datetime('now', ?)
    ORDER BY checked_at DESC, id DESC
    LIMIT 20
  `).all(rule.id, `-${INEFFECTIVE_RAISE_LOOKBACK_MIN} minutes`) as {
    ad_pos: number;
    old_bid_rub: number;
    new_bid_rub: number;
    action: string;
    status: string;
  }[];

  const chain: typeof rows = [];
  for (const row of rows) {
    if (row.status !== "ok") break;
    if (row.ad_pos !== adPos) break;
    if (!["raise", "max_reached", "cooldown"].includes(row.action)) break;
    chain.push(row);
  }
  const raiseRows = chain.filter((row) => row.action === "raise" && row.new_bid_rub > row.old_bid_rub);
  if (raiseRows.length < 2) return null;

  let rollbackBid = oldBid;
  for (const row of raiseRows) {
    if (row.old_bid_rub > 0) rollbackBid = Math.min(rollbackBid, row.old_bid_rub);
    if (row.new_bid_rub > 0) rollbackBid = Math.min(rollbackBid, row.new_bid_rub);
  }
  rollbackBid = Math.max(rule.min_bid_rub, Math.min(rule.max_bid_rub, rollbackBid));
  return rollbackBid < oldBid ? rollbackBid : null;
}

async function fetchPositions(advertId: number, nmId: number, phrases: string[]): Promise<Map<string, PositionResult>> {
  const res = await fetch(`${BASE}/api/sync/phrase-positions-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, "Sec-Fetch-Site": "same-origin" },
    body: JSON.stringify({ advertID: advertId, nmId, phrases }),
  });
  const data = await res.json().catch(() => null) as { ok?: boolean; results?: PositionResult[]; error?: string } | null;
  if (!res.ok || !data?.ok || !Array.isArray(data.results)) {
    throw new Error(data?.error || `position check failed: HTTP ${res.status}`);
  }
  return new Map(data.results.map((r) => [r.phrase.toLowerCase(), r]));
}

async function fetchPositionsWithRetry(advertId: number, nmId: number, phrases: string[]): Promise<Map<string, PositionResult>> {
  const pending = new Set(phrases.map((p) => p.toLowerCase()));
  const best = new Map<string, PositionResult>();
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= POSITION_CHECK_ATTEMPTS && pending.size > 0; attempt++) {
    const attemptPhrases = phrases.filter((p) => pending.has(p.toLowerCase()));
    try {
      const attemptMap = await fetchPositions(advertId, nmId, attemptPhrases);
      for (const phrase of attemptPhrases) {
        const key = phrase.toLowerCase();
        const pos = attemptMap.get(key);
        if (pos) best.set(key, pos);
        if (positionIsUsable(pos)) pending.delete(key);
      }
    } catch (e) {
      lastError = e;
    }
  }

  if (best.size === 0 && lastError) throw lastError;
  return best;
}

async function applyBid(advertId: number, nmId: number, phrase: string, bidRub: number) {
  const res = await fetch(`${BASE}/api/advert/set-bid`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, "Sec-Fetch-Site": "same-origin" },
    body: JSON.stringify({ advertId, nmId, phrases: [phrase], bidRub }),
  });
  const data = await res.json().catch(() => null) as { ok?: boolean; error?: string; bidRub?: number } | null;
  if (!res.ok || !data?.ok) throw new Error(data?.error || `set-bid failed: HTTP ${res.status}`);
  return data;
}

export async function POST(request: NextRequest) {
  const db = ensureBidAutomationTables();
  const manualBidCapRub = readBidLimitRub(db, "manualAuction");
  const body = await request.json().catch(() => ({})) as { advertId?: number; nmId?: number; force?: boolean; limit?: number };
  const force = body.force === true;
  const limit = Math.max(1, Math.min(100, Math.round(Number(body.limit || 25))));
  const args: Array<number | string> = [];
  const filters = ["enabled = 1"];
  if (body.advertId) { filters.push("advert_id = ?"); args.push(Number(body.advertId)); }
  if (body.nmId) { filters.push("nm_id = ?"); args.push(Number(body.nmId)); }

  const candidates = db.prepare(`
    SELECT *
    FROM bid_automation_rules
    WHERE ${filters.join(" AND ")}
    ORDER BY COALESCE(last_checked_at, '1970-01-01') ASC, id ASC
    LIMIT ?
  `).all(...args, limit) as BidAutomationRule[];

  const due = force
    ? candidates
    : candidates.filter((r) => minutesSinceSql(r.last_checked_at) >= r.interval_min);

  const byGroup = new Map<string, BidAutomationRule[]>();
  for (const rule of due) {
    const key = `${rule.advert_id}:${rule.nm_id}`;
    const arr = byGroup.get(key) ?? [];
    arr.push(rule);
    byGroup.set(key, arr);
  }

  const logStmt = db.prepare(`
    INSERT INTO bid_automation_log
      (rule_id, advert_id, nm_id, phrase, ad_pos, organic_pos, old_bid_rub, new_bid_rub,
       target_pos_from, target_pos_to, min_bid_rub, max_bid_rub, action, status, reason,
       dry_run, details_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateRuleStmt = db.prepare(`
    UPDATE bid_automation_rules
       SET last_checked_at = datetime('now'),
           last_changed_at = CASE WHEN ? THEN datetime('now') ELSE last_changed_at END,
           last_status = ?,
           last_error = ?,
           stable_in_range_count = ?,
           last_good_bid_rub = ?,
           probe_bid_rub = ?,
           no_economy_until = ?,
           no_raise_until = ?,
           raise_pause_pos = ?,
           updated_at = datetime('now')
     WHERE id = ?
  `);

  const results: unknown[] = [];
  for (const rules of byGroup.values()) {
    const { advert_id: advertId, nm_id: nmId } = rules[0];
    let posMap: Map<string, PositionResult>;
    try {
      posMap = await fetchPositionsWithRetry(advertId, nmId, rules.map((r) => r.phrase));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      for (const rule of rules) {
        const state = currentState(rule);
        logStmt.run(rule.id, rule.advert_id, rule.nm_id, rule.phrase, 0, 0, 0, 0,
          rule.target_pos_from, rule.target_pos_to, rule.min_bid_rub, Math.min(rule.max_bid_rub, manualBidCapRub),
          "error", "error", "position check failed", rule.dry_run, JSON.stringify({ error }));
        try {
          createAiDiaryEntryIfDue({
            advertId: rule.advert_id,
            nmId: rule.nm_id,
            phrase: rule.phrase,
            source: "bid_automation",
            minMinutesBetween: 15,
          });
        } catch { /* diary must never block bid automation */ }
        updateRuleStmt.run(0, "error", error, state.stableCount, state.lastGoodBid, state.probeBid, state.noEconomyUntil, state.noRaiseUntil, state.raisePausePos, rule.id);
        results.push({ ruleId: rule.id, phrase: rule.phrase, ok: false, error });
      }
      continue;
    }

    for (const rule of rules) {
      const effectiveRule = { ...rule, max_bid_rub: Math.min(rule.max_bid_rub, manualBidCapRub) };
      const phraseLc = rule.phrase.toLowerCase();
      const pos = posMap.get(phraseLc);
      const bidRow = db.prepare(`
        SELECT
          COALESCE(
            (SELECT MAX(actual_cpm) / 100 FROM campaign_preset_keywords WHERE advert_id = ? AND nm_id = ? AND lower(name) = lower(?)),
            (SELECT MAX(bid) FROM campaign_keyword_bids WHERE advert_id = ? AND nm_id = ? AND lower(norm_query) = lower(?)),
            0
          ) AS bid
      `).get(rule.advert_id, rule.nm_id, rule.phrase, rule.advert_id, rule.nm_id, rule.phrase) as { bid: number | null };
      const oldBid = Math.round(Number(bidRow?.bid ?? 0));
      let decision = positionIsUsable(pos)
        ? actionForPosition(effectiveRule, pos?.ad_pos ?? 0, oldBid)
        : withState(
            "position_unavailable",
            oldBid,
            `position check unavailable${pos?.status ? `: ${pos.status}` : ""}`,
            false,
            currentState(rule),
          );
      if (decision.action === "max_reached" && positionIsUsable(pos)) {
        const rollbackBid = findIneffectiveRollbackBid(db, effectiveRule, pos?.ad_pos ?? 0, oldBid);
        if (rollbackBid != null) {
          const state = currentState(rule);
          const pauseMin = Math.max(rule.interval_min, rule.economy_failure_cooldown_min || 60);
          decision = withState(
            "rollback_ineffective",
            rollbackBid,
            `bid reached ${oldBid} ₽ but position stayed ${pos?.ad_pos}; rollback to cheapest recent bid with same position and pause raises for ${pauseMin}m`,
            true,
            {
              stableCount: 0,
              lastGoodBid: rollbackBid,
              probeBid: 0,
              noEconomyUntil: state.noEconomyUntil,
              noRaiseUntil: sqlAfterMinutes(pauseMin),
              raisePausePos: pos?.ad_pos ?? 0,
            },
          );
        }
      }
      let status = "ok";
      let error: string | null = null;
      let changed = false;

      if (
        decision.requiresBidChange &&
        decision.action !== "rollback" &&
        decision.action !== "rollback_ineffective" &&
        minutesSinceSql(rule.last_changed_at) < rule.cooldown_min
      ) {
        decision = withState("cooldown", oldBid, `cooldown ${rule.cooldown_min}m after last change`, false, currentState(rule));
      }

      if (!rule.dry_run && decision.requiresBidChange && decision.newBid !== oldBid) {
        try {
          await applyBid(rule.advert_id, rule.nm_id, rule.phrase, decision.newBid);
          changed = true;
        } catch (e) {
          status = "error";
          error = e instanceof Error ? e.message : String(e);
        }
      }

      const stateToWrite = decision.requiresBidChange && !changed ? currentState(rule) : decision.state;

      logStmt.run(rule.id, rule.advert_id, rule.nm_id, rule.phrase,
        pos?.ad_pos ?? 0, pos?.organic_pos ?? 0, oldBid, decision.newBid,
        rule.target_pos_from, rule.target_pos_to, rule.min_bid_rub, rule.max_bid_rub,
        decision.action, status, decision.reason, rule.dry_run,
        JSON.stringify({ pos, dryRun: Boolean(rule.dry_run), error, state: stateToWrite }));
      if (DIARY_ACTIONS.has(status === "error" ? "error" : decision.action)) {
        try {
          createAiDiaryEntryIfDue({
            advertId: rule.advert_id,
            nmId: rule.nm_id,
            phrase: rule.phrase,
            source: "bid_automation",
            minMinutesBetween: 15,
          });
        } catch { /* diary must never block bid automation */ }
      }
      updateRuleStmt.run(
        changed ? 1 : 0, status, error,
        stateToWrite.stableCount, stateToWrite.lastGoodBid, stateToWrite.probeBid, stateToWrite.noEconomyUntil,
        stateToWrite.noRaiseUntil, stateToWrite.raisePausePos,
        rule.id,
      );
      results.push({
        ruleId: rule.id,
        phrase: rule.phrase,
        adPos: pos?.ad_pos ?? 0,
        oldBid,
        newBid: decision.newBid,
        action: decision.action,
        dryRun: Boolean(rule.dry_run),
        ok: status === "ok",
        error,
      });
    }
  }

  return NextResponse.json({ ok: true, checked: results.length, results });
}
