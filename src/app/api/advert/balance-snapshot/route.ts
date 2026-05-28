import { NextResponse } from "next/server";
import { getApiKey } from "@/lib/api-key";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

// GET /api/advert/balance-snapshot
// Дёргает WB /adv/v1/balance и возвращает сводку для UI пополнения бюджета:
// - account: net (счёт продавца, его пополняет продавец)
// - ad_balance: balance (баланс кабинета, по взаиморасчёту, нельзя пополнять)
// - bonuses: bonus (всего промо-бонусов)
// - bonus_percent_max: max(cashbacks[].percent) — кэп на смешивание бонусов с пополнением
//
// Read-only, безопасно вызывать в любой момент. Лимит WB на /balance: 2 req/h baseline.

const WB_URL = "https://advert-api.wildberries.ru/adv/v1/balance";

interface CashbackRow { sum: number; percent: number; expiration_date?: string }

export async function GET() {
  const apiKey = getApiKey();
  try {
    const res = await fetch(WB_URL, { headers: { Authorization: apiKey } });
    if (!res.ok) {
      return NextResponse.json({ ok: false, status: res.status, account: 0, ad_balance: 0, bonuses: 0, bonus_percent_max: 0 }, { status: 502 });
    }
    const data = await res.json() as { balance?: number; net?: number; bonus?: number; cashbacks?: CashbackRow[] };
    const cashbacks = Array.isArray(data.cashbacks) ? data.cashbacks : [];
    // Берём максимальный percent из всех акций — пользователь сможет покрыть бонусами столько, сколько разрешает самая щедрая акция.
    const bonusPercentMax = cashbacks.length > 0 ? Math.max(...cashbacks.map((c) => c.percent || 0)) : 0;
    // Маппинг WB → UI:
    //   data.balance → «Счёт продавца» (то, что продавец сам пополняет; type=0)
    //   data.net     → «Баланс кабинета» (WB Продвижение, взаиморасчёт; type=1)
    //   data.bonus   → «Промо-бонусы» (type=3)
    return NextResponse.json({
      ok: true,
      account: data.balance ?? 0,
      ad_balance: data.net ?? 0,
      bonuses: data.bonus ?? 0,
      bonus_percent_max: bonusPercentMax,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e), account: 0, ad_balance: 0, bonuses: 0, bonus_percent_max: 0 }, { status: 500 });
  }
}
