import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiKey } from "@/lib/api-key";
import { auditMutation, checkRateLimit, rateLimitKey } from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/advert/budget-deposit
// Body: { advertId, sum (rub), type (0|1|3), useBonuses }
//
// WB endpoint:
//   POST https://advert-api.wildberries.ru/adv/v1/budget/deposit?id={advertId}
//   Body: { sum, type, cashback_sum?, cashback_percent?, return: true }
//     type: 0=Счёт, 1=Баланс кабинета, 3=Бонусы
//     cashback_sum/percent — только при type 0/1; percent берётся из /adv/v1/balance.cashbacks[].percent
//
// Если useBonuses=true:
//   - дёргаем /adv/v1/balance, берём bonus и max(cashbacks[].percent)
//   - cashback_sum = min(bonus, sum * percent / 100) — максимум, что позволено
//   - cashback_percent = тот самый percent (как требует WB)
//
// Лимит WB: 1 req/s, базовый — 5 req/h.
// Лог в bid_changes_log (с пометкой our_status="budget_deposit:...").

const WB_DEPOSIT_URL = "https://advert-api.wildberries.ru/adv/v1/budget/deposit";
const WB_BALANCE_URL = "https://advert-api.wildberries.ru/adv/v1/balance";
const TIMEOUT_MS = 15000;

// Лимиты пополнения. Дублируют клиентскую валидацию в BudgetDepositModal.tsx —
// серверный кэп критичен (UI обходится через DevTools).
// Минимум 1000 ₽ — лимит самого WB (явно сказано в 400-ответе deposit).
// Максимум 30 000 ₽ — наш кэп для защиты от опечаток (введённые лишние нули).
const MIN_DEPOSIT_RUB = 1000;
const MAX_DEPOSIT_RUB = 30000;

interface Body {
  advertId?: number;
  sum?: number;
  type?: 0 | 1 | 3;
  useBonuses?: boolean;
}

interface CashbackRow { sum: number; percent: number; expiration_date?: string }

function ensureLogTable(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bid_changes_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT DEFAULT (datetime('now')),
      advert_id INTEGER,
      nm_id INTEGER,
      phrases_json TEXT,
      phrases_count INTEGER,
      requested_kopecks INTEGER,
      final_kopecks INTEGER,
      clamped INTEGER,
      wb_status INTEGER,
      wb_response TEXT,
      our_status TEXT,
      error TEXT,
      duration_ms INTEGER
    );
  `);
}

function logEntry(db: ReturnType<typeof getDb>, row: {
  advert_id: number | null;
  requested_kopecks: number | null;
  wb_status: number | null;
  wb_response: string | null;
  our_status: string;
  error: string | null;
  duration_ms: number;
}) {
  try {
    ensureLogTable(db);
    db.prepare(`
      INSERT INTO bid_changes_log
        (advert_id, nm_id, phrases_json, phrases_count, requested_kopecks, final_kopecks,
         clamped, wb_status, wb_response, our_status, error, duration_ms)
      VALUES (?, NULL, NULL, 0, ?, NULL, 0, ?, ?, ?, ?, ?)
    `).run(
      row.advert_id, row.requested_kopecks,
      row.wb_status, row.wb_response, row.our_status, row.error, row.duration_ms,
    );
  } catch (e) {
    console.error("[budget-deposit] failed to log:", e);
  }
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const t0 = Date.now();
  let body: Body;
  try { body = await request.json(); }
  catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const { advertId, sum, type, useBonuses } = body;
  console.log(`[budget-deposit] → advert=${advertId} sum=${sum} type=${type} useBonuses=${useBonuses}`);

  if (!advertId || !Number.isFinite(sum) || (sum as number) <= 0) {
    const err = "advertId and sum > 0 are required";
    logEntry(db, { advert_id: advertId ?? null, requested_kopecks: null, wb_status: null, wb_response: null, our_status: "validation_fail", error: err, duration_ms: Date.now() - t0 });
    return NextResponse.json({ ok: false, error: err }, { status: 400 });
  }
  if ((sum as number) < MIN_DEPOSIT_RUB) {
    const err = `минимум ${MIN_DEPOSIT_RUB.toLocaleString("ru-RU")} ₽ за операцию`;
    logEntry(db, { advert_id: advertId, requested_kopecks: sum ?? null, wb_status: null, wb_response: null, our_status: "validation_fail", error: err, duration_ms: Date.now() - t0 });
    return NextResponse.json({ ok: false, error: err }, { status: 400 });
  }
  if ((sum as number) > MAX_DEPOSIT_RUB) {
    const err = `максимум ${MAX_DEPOSIT_RUB.toLocaleString("ru-RU")} ₽ за одну операцию (защита от опечаток)`;
    logEntry(db, { advert_id: advertId, requested_kopecks: sum ?? null, wb_status: null, wb_response: null, our_status: "validation_fail", error: err, duration_ms: Date.now() - t0 });
    return NextResponse.json({ ok: false, error: err }, { status: 400 });
  }
  if (type !== 0 && type !== 1 && type !== 3) {
    const err = `type must be 0 (счёт), 1 (баланс) or 3 (бонусы), got ${type}`;
    logEntry(db, { advert_id: advertId, requested_kopecks: sum ?? null, wb_status: null, wb_response: null, our_status: "validation_fail", error: err, duration_ms: Date.now() - t0 });
    return NextResponse.json({ ok: false, error: err }, { status: 400 });
  }

  const sumInt = Math.round(sum as number);
  const rl = checkRateLimit(rateLimitKey(request, "budget-deposit", advertId), 5, 60 * 60 * 1000);
  if (!rl.ok) {
    auditMutation(request, {
      action: "budget-deposit",
      targetType: "advert",
      targetId: advertId,
      status: "blocked",
      details: { reason: "rate_limit", retryAfterSec: rl.retryAfterSec },
    });
    return NextResponse.json({ ok: false, error: "rate limit", retryAfterSec: rl.retryAfterSec }, { status: 429 });
  }
  auditMutation(request, {
    action: "budget-deposit",
    targetType: "advert",
    targetId: advertId,
    status: "accepted",
    details: { sum: sumInt, type, useBonuses: Boolean(useBonuses) },
  });

  const apiKey = getApiKey();
  const beforeBudget = db.prepare("SELECT cash, netting, total FROM campaign_budgets WHERE advert_id = ?").get(advertId) as { cash: number; netting: number; total: number } | undefined;
  const beforeTotal = Number(beforeBudget?.total ?? 0);

  // Если просили домешать бонусы и type ∈ {0,1} — ходим за балансом.
  let cashbackSum = 0;
  let cashbackPercent = 0;
  if (useBonuses && (type === 0 || type === 1)) {
    try {
      const bRes = await fetch(WB_BALANCE_URL, { headers: { Authorization: apiKey } });
      if (bRes.ok) {
        const bData = await bRes.json() as { bonus?: number; cashbacks?: CashbackRow[] };
        const bonus = bData.bonus ?? 0;
        const cashbacks = Array.isArray(bData.cashbacks) ? bData.cashbacks : [];
        cashbackPercent = cashbacks.length > 0 ? Math.max(...cashbacks.map((c) => c.percent || 0)) : 0;
        if (bonus > 0 && cashbackPercent > 0) {
          const maxByPct = Math.floor(sumInt * (cashbackPercent / 100));
          cashbackSum = Math.min(bonus, maxByPct);
        }
      }
    } catch {
      // если balance недоступен — просто не используем бонусы
    }
  }

  // Тело запроса для WB.
  const wbBody: Record<string, unknown> = {
    sum: sumInt,
    type,
    return: true,
  };
  if (cashbackSum > 0) {
    wbBody.cashback_sum = cashbackSum;
    wbBody.cashback_percent = cashbackPercent;
  }

  console.log(`[budget-deposit] → WB POST ${WB_DEPOSIT_URL}?id=${advertId} body:`, JSON.stringify(wbBody));

  const ac = new AbortController();
  const tmr = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let wbRes: Response;
  try {
    wbRes = await fetch(`${WB_DEPOSIT_URL}?id=${advertId}`, {
      method: "POST",
      signal: ac.signal,
      headers: { "Authorization": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(wbBody),
    });
  } catch (e) {
    clearTimeout(tmr);
    const err = `wb network: ${e instanceof Error ? e.message : String(e)}`;
    logEntry(db, { advert_id: advertId, requested_kopecks: sumInt, wb_status: null, wb_response: null, our_status: "network_error", error: err, duration_ms: Date.now() - t0 });
    return NextResponse.json({ ok: false, error: err }, { status: 502 });
  }
  clearTimeout(tmr);

  let wbText = "";
  try { wbText = await wbRes.text(); } catch { /* */ }
  console.log(`[budget-deposit] ← WB status=${wbRes.status} body="${wbText.slice(0, 500)}"`);

  if (!wbRes.ok) {
    const err = `wb http ${wbRes.status}`;
    logEntry(db, { advert_id: advertId, requested_kopecks: sumInt, wb_status: wbRes.status, wb_response: wbText.slice(0, 2000), our_status: "wb_error", error: err, duration_ms: Date.now() - t0 });
    auditMutation(request, {
      action: "budget-deposit",
      targetType: "advert",
      targetId: advertId,
      status: "failed",
      details: { sum: sumInt, wbStatus: wbRes.status },
    });
    let detail: unknown = wbText;
    try { detail = JSON.parse(wbText); } catch { /* */ }
    return NextResponse.json({ ok: false, status: wbRes.status, error: err, detail }, { status: 502 });
  }

  // Успех — WB может вернуть старый `total` даже при применённом пополнении.
  // Для UI сразу показываем ожидаемый локальный итог: текущий бюджет + сумма.
  // Следующий auto-sync `/api/sync/balance` перезапишет значение фактом из WB,
  // если WB позже отдаст другой остаток.
  let depositTotal: number | null = null;
  try {
    const j = wbText ? JSON.parse(wbText) : {};
    if (typeof j.total === "number") depositTotal = j.total;
  } catch { /* */ }
  const optimisticTotal = beforeTotal + sumInt;

  try {
    db.prepare(`
      INSERT INTO campaign_budgets (advert_id, cash, netting, total, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(advert_id) DO UPDATE SET
        cash = excluded.cash,
        netting = excluded.netting,
        total = excluded.total,
        updated_at = datetime('now')
    `).run(advertId, beforeBudget?.cash ?? 0, beforeBudget?.netting ?? 0, optimisticTotal);
  } catch (e) {
    console.error("[budget-deposit] failed to update campaign_budgets:", e);
  }

  logEntry(db, {
    advert_id: advertId,
    requested_kopecks: sumInt,
    wb_status: wbRes.status,
    wb_response: wbText.slice(0, 2000),
    our_status: `budget_deposit:type=${type},optimistic=${beforeTotal}+${sumInt}${depositTotal != null ? `,wb_total=${depositTotal}` : ""}${cashbackSum > 0 ? `,cb=${cashbackSum}/${cashbackPercent}%` : ""}`,
    error: null,
    duration_ms: Date.now() - t0,
  });

  auditMutation(request, {
    action: "budget-deposit",
    targetType: "advert",
    targetId: advertId,
    status: "success",
    details: { sum: sumInt, type, total: optimisticTotal, depositTotal, optimistic: true },
  });

  return NextResponse.json({
    ok: true,
    total: optimisticTotal,
    depositTotal,
    optimistic: true,
    cashbackSum,
    cashbackPercent,
  });
}
