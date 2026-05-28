import { NextRequest, NextResponse } from "next/server";
import { clampInt, ensureBidAutomationTables, normalizePhrase, type BidAutomationRule } from "@/lib/bid-automation";
import { auditMutation } from "@/lib/security";
import { readBidLimitRub } from "@/lib/bid-limits";

export const dynamic = "force-dynamic";

const MAX_AUTO_BID_RUB = 1500;

function readMinBid(advertId: number): number {
  const db = ensureBidAutomationTables();
  const row = db.prepare(`
    SELECT s.min_cpm_search
    FROM campaigns c
    LEFT JOIN subject_min_cpm s ON s.subject_id = c.subject_id
    WHERE c.advert_id = ?
  `).get(advertId) as { min_cpm_search: number | null } | undefined;
  return Math.max(0, Math.round(row?.min_cpm_search ?? 0));
}

function validateCampaign(advertId: number) {
  const db = ensureBidAutomationTables();
  return db.prepare(`
    SELECT advert_id, status, bid_type, payment_type, subject_id
    FROM campaigns
    WHERE advert_id = ?
  `).get(advertId) as {
    advert_id: number;
    status: number;
    bid_type: string | null;
    payment_type: string | null;
    subject_id: number | null;
  } | undefined;
}

export async function GET(request: NextRequest) {
  const db = ensureBidAutomationTables();
  const sp = request.nextUrl.searchParams;
  const advertId = Number(sp.get("advertId") || "0");
  const nmId = Number(sp.get("nmId") || "0");
  const phrase = normalizePhrase(sp.get("phrase"));

  const where: string[] = [];
  const args: Array<number | string> = [];
  if (advertId > 0) { where.push("advert_id = ?"); args.push(advertId); }
  if (nmId > 0) { where.push("nm_id = ?"); args.push(nmId); }
  if (phrase) { where.push("lower(phrase) = lower(?)"); args.push(phrase); }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const rules = db.prepare(`
    SELECT *
    FROM bid_automation_rules
    ${whereSql}
    ORDER BY enabled DESC, updated_at DESC, id DESC
  `).all(...args) as BidAutomationRule[];

  const logs = db.prepare(`
    SELECT *
    FROM bid_automation_log
    ${whereSql}
    ORDER BY checked_at DESC, id DESC
    LIMIT 100
  `).all(...args);

  return NextResponse.json({ ok: true, rules, logs, minBidRub: advertId > 0 ? readMinBid(advertId) : 0 });
}

export async function POST(request: NextRequest) {
  const db = ensureBidAutomationTables();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "json body required" }, { status: 400 });

  const advertId = Number(body.advertId || 0);
  const nmId = Number(body.nmId || 0);
  const phrase = normalizePhrase(body.phrase);
  if (!advertId || !nmId || !phrase) {
    return NextResponse.json({ ok: false, error: "advertId, nmId, phrase required" }, { status: 400 });
  }

  const camp = validateCampaign(advertId);
  if (!camp) return NextResponse.json({ ok: false, error: "campaign not found" }, { status: 404 });
  if (camp.payment_type !== "cpm" || camp.bid_type !== "manual") {
    return NextResponse.json({ ok: false, error: "autopilot supports only manual CPM campaigns" }, { status: 400 });
  }

  const maxAutoBidRub = Math.min(MAX_AUTO_BID_RUB, readBidLimitRub(db, "manualAuction"));
  const minFromWb = readMinBid(advertId);
  const enabled = body.enabled === true || body.enabled === 1 || body.enabled === "1" ? 1 : 0;
  const dryRun = body.dryRun === false || body.dryRun === 0 || body.dryRun === "0" ? 0 : 1;
  const targetFrom = clampInt(body.targetPosFrom, 1, 100, 1);
  const targetTo = clampInt(body.targetPosTo, targetFrom, 100, Math.max(targetFrom, 5));
  const minAllowedBid = Math.max(1, minFromWb);
  if (minAllowedBid > maxAutoBidRub) {
    return NextResponse.json({ ok: false, error: `minimum WB bid is above ${maxAutoBidRub} rub` }, { status: 400 });
  }
  const minBidRub = clampInt(body.minBidRub, minAllowedBid, maxAutoBidRub, minAllowedBid);
  const maxBidRub = clampInt(body.maxBidRub, minBidRub, maxAutoBidRub, Math.max(minBidRub, minFromWb));
  const stepUpRub = clampInt(body.stepUpRub, 1, 5000, 20);
  const stepDownRub = clampInt(body.stepDownRub, 1, 5000, 10);
  const economyEnabled = body.economyEnabled === true || body.economyEnabled === 1 || body.economyEnabled === "1" ? 1 : 0;
  const economySuccessRequired = clampInt(body.economySuccessRequired, 1, 20, 2);
  const economyStepDownRub = clampInt(body.economyStepDownRub, 1, 5000, Math.min(10, stepDownRub));
  const economyFailureCooldownMin = clampInt(body.economyFailureCooldownMin, 5, 24 * 60, 60);
  const intervalMin = clampInt(body.intervalMin, 5, 24 * 60, 15);
  const cooldownMin = clampInt(body.cooldownMin, 2, 24 * 60, 30);

  if (enabled && maxBidRub <= 0) {
    return NextResponse.json({ ok: false, error: "maxBidRub required when enabled" }, { status: 400 });
  }

  const stmt = db.prepare(`
    INSERT INTO bid_automation_rules
      (advert_id, nm_id, phrase, enabled, dry_run, target_pos_from, target_pos_to,
       min_bid_rub, max_bid_rub, step_up_rub, step_down_rub,
       economy_enabled, economy_success_required, economy_step_down_rub, economy_failure_cooldown_min,
       interval_min, cooldown_min,
       updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(advert_id, nm_id, phrase) DO UPDATE SET
      enabled = excluded.enabled,
      dry_run = excluded.dry_run,
      target_pos_from = excluded.target_pos_from,
      target_pos_to = excluded.target_pos_to,
      min_bid_rub = excluded.min_bid_rub,
      max_bid_rub = excluded.max_bid_rub,
      step_up_rub = excluded.step_up_rub,
      step_down_rub = excluded.step_down_rub,
      economy_enabled = excluded.economy_enabled,
      economy_success_required = excluded.economy_success_required,
      economy_step_down_rub = excluded.economy_step_down_rub,
      economy_failure_cooldown_min = excluded.economy_failure_cooldown_min,
      interval_min = excluded.interval_min,
      cooldown_min = excluded.cooldown_min,
      updated_at = datetime('now')
  `);
  stmt.run(
    advertId, nmId, phrase, enabled, dryRun, targetFrom, targetTo,
    minBidRub, maxBidRub, stepUpRub, stepDownRub,
    economyEnabled, economySuccessRequired, economyStepDownRub, economyFailureCooldownMin,
    intervalMin, cooldownMin,
  );

  const rule = db.prepare(`
    SELECT *
    FROM bid_automation_rules
    WHERE advert_id = ? AND nm_id = ? AND lower(phrase) = lower(?)
  `).get(advertId, nmId, phrase) as BidAutomationRule;

  auditMutation(request, {
    action: "bid-automation-rule",
    targetType: "advert",
    targetId: advertId,
    status: "success",
    details: {
      nmId, phrase, enabled, dryRun, targetFrom, targetTo, minBidRub, maxBidRub,
      economyEnabled, economySuccessRequired, economyStepDownRub, economyFailureCooldownMin,
    },
  });

  return NextResponse.json({ ok: true, rule, minBidRub: minFromWb });
}
