import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiKey } from "@/lib/api-key";

const BASE = "https://advert-api.wildberries.ru";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export async function POST() {
  const apiKey = getApiKey();
  const db = getDb();
  const errors: string[] = [];
  let balanceCount = 0, budgetCount = 0;

  // Balance
  try {
    const res = await fetch(`${BASE}/adv/v1/balance`, { headers: { Authorization: apiKey } });
    if (res.ok) {
      const data = await res.json();
      db.prepare("INSERT INTO balance_history (balance, net, bonus) VALUES (?, ?, NULL)").run(data.balance, data.net);
      balanceCount = 1;
    } else {
      errors.push(`balance: ${res.status}`);
    }
  } catch (e) {
    errors.push(`balance: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Budgets
  const actives = db.prepare("SELECT advert_id FROM campaigns WHERE status = 9").all() as { advert_id: number }[];
  const stmtBudget = db.prepare(`
    INSERT OR REPLACE INTO campaign_budgets (advert_id, cash, netting, total, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);

  for (const camp of actives) {
    try {
      const res = await fetch(`${BASE}/adv/v1/budget?id=${camp.advert_id}`, { headers: { Authorization: apiKey } });
      if (res.ok) {
        const data = await res.json();
        stmtBudget.run(camp.advert_id, data.cash, data.netting, data.total);
        budgetCount++;
      }
    } catch { /* skip */ }
    await sleep(250);
  }

  return NextResponse.json({ ok: true, balance: balanceCount, budgets: budgetCount, errors });
}
