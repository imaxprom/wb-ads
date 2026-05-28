import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hasPostgresUrl, pgAll } from "@/lib/pg-direct";

export const dynamic = "force-dynamic";

// Читает дневную разбивку Джема для одного nmId. Возвращает map по фразе:
// { "трусы женские": [{date, freq, oc, atc, o, pos}, ...90 элементов], ... }
// UI при ховере на ячейку «Джем» берёт массив по фразе (для child), либо
// агрегирует по списку фраз кластера (для parent).

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const nmId = Number(sp.get("nmId") || "0");
  if (!nmId) return NextResponse.json({ ok: false, error: "nmId required" }, { status: 400 });

  const sql = `SELECT phrase, date, frequency, open_card_count, add_to_cart_count, order_count, avg_position
       FROM phrase_djem_stats_daily
      WHERE nm_id = ?
      ORDER BY phrase, date DESC`;
  const rows = hasPostgresUrl()
    ? await pgAll<{
        phrase: string; date: string;
        frequency: number; open_card_count: number; add_to_cart_count: number;
        order_count: number; avg_position: number;
      }>(sql, [nmId])
    : getDb().prepare(sql).all(nmId) as {
    phrase: string; date: string;
    frequency: number; open_card_count: number; add_to_cart_count: number;
    order_count: number; avg_position: number;
  }[];

  const byPhrase: Record<string, Array<{ date: string; freq: number; oc: number; atc: number; o: number; pos: number }>> = {};
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  for (const r of rows) {
    const lc = r.phrase.toLowerCase();
    if (!byPhrase[lc]) byPhrase[lc] = [];
    byPhrase[lc].push({
      date: r.date,
      freq: r.frequency,
      oc: r.open_card_count,
      atc: r.add_to_cart_count,
      o: r.order_count,
      pos: r.avg_position,
    });
    if (!firstDate || r.date < firstDate) firstDate = r.date;
    if (!lastDate || r.date > lastDate) lastDate = r.date;
  }

  return NextResponse.json({
    ok: true,
    nmId,
    phrases: Object.keys(byPhrase).length,
    rows: rows.length,
    period: firstDate && lastDate ? { from: firstDate, to: lastDate } : null,
    byPhrase,
  });
}
