import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBrowser } from "@/lib/ensure-browser";
import { localDateStr } from "@/lib/format";
import { fetchDjemForDay } from "@/lib/wb-djem-stats";
import type { SellerSession } from "@/lib/wb-search-texts-xlsx";
import { loadSavedSellerSession } from "@/lib/wb-seller-session";
import { dbTimestampAgeMs, parseDbTimestampMs } from "@/lib/db-time";

export const dynamic = "force-dynamic";
export const maxDuration = 900; // до 15 мин: heal может хилить 90 дней + retry-пасс

// Дневная разбивка Джема: 3 запроса (orders/addToCart/openCard) на каждый день,
// мёрж по фразе, upsert в phrase_djem_stats_daily.
//
// Режимы:
//   mode=auto (default) — HEAL. Собирает target=[today-89..today], находит missing дни,
//     синкает каждый missing + today (today всегда обновляется). Если что-то упало в Pass 1 —
//     делает Pass 2 через 5с. Остаток попадёт в errors, следующий auto-вызов попробует снова.
//   mode=today — только today, без heal. Для частых триггеров.
//   force=1   — стирает историю и перезаливает все 90 дней (для «жёсткой пересборки»).
//
// Cache: в today-mode — не чаще 1ч между запусками (force обходит).

const TODAY_CACHE_MS = 60 * 60 * 1000;
const GAP_MS = 600; // пауза между днями
const RETRY_PASS_DELAY_MS = 5000; // пауза перед Pass 2 для still-missing

const g = globalThis as unknown as {
  __djemDailyProgress?: { nmId: number; current: number; total: number; running: boolean; mode: string };
  __djemDailyLocks?: Set<number>;
};
if (!g.__djemDailyLocks) g.__djemDailyLocks = new Set<number>();

export async function GET() {
  return NextResponse.json(g.__djemDailyProgress ?? { running: false });
}

export async function POST(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const nmId = Number(sp.get("nmId") || "0");
  const force = sp.get("force") === "1";
  const modeParam = (sp.get("mode") || "auto") as "today" | "auto";
  const limit = Number(sp.get("limit") || "100");

  if (!nmId) return NextResponse.json({ ok: false, error: "nmId required" }, { status: 400 });

  if (g.__djemDailyLocks!.has(nmId)) {
    return NextResponse.json({ ok: true, skipped: true, note: "already syncing" });
  }
  g.__djemDailyLocks!.add(nmId);
  try {
    return await runSync(nmId, modeParam, limit, force);
  } finally {
    g.__djemDailyLocks!.delete(nmId);
  }
}

function range90(today: Date): string[] {
  const out: string[] = [];
  for (let i = 89; i >= 0; i--) out.push(localDateStr(new Date(today.getTime() - i * 86400000)));
  return out;
}

async function runSync(
  nmId: number,
  modeParam: "today" | "auto",
  limit: number,
  force: boolean,
): Promise<NextResponse> {
  const db = getDb();
  const now = new Date();
  const today = localDateStr(now);
  const targetDates = range90(now);

  // force=1 — стереть всё и перезалить все 90 дней
  if (force) {
    db.prepare("DELETE FROM phrase_djem_stats_daily WHERE nm_id = ?").run(nmId);
  }

  // Определить список дат под синк
  let datesToSync: string[];
  let mode: "today" | "heal";
  if (modeParam === "today") {
    mode = "today";
    datesToSync = [today];
  } else {
    mode = "heal";
    const hadRows = db.prepare(
      "SELECT DISTINCT date FROM phrase_djem_stats_daily WHERE nm_id = ? AND date >= ?",
    ).all(nmId, targetDates[0]) as { date: string }[];
    const had = new Set(hadRows.map((r) => r.date));
    const missing = targetDates.filter((d) => !had.has(d));
    const set = new Set(missing);
    // today всегда включаем — даже если есть, он растёт в течение дня
    set.add(today);
    // yesterday-refresh: после 09:00 MSK проверяем — если yesterday уже был синкнут,
    // но updated_at до сегодняшних 09:00, делаем перезапись. WB докидывает поздние
    // заказы и клики на yesterday, мы их должны подхватить.
    const yesterday = localDateStr(new Date(now.getTime() - 86400000));
    if (now.getHours() >= 9 && had.has(yesterday)) {
      const yRow = db.prepare(
        "SELECT updated_at FROM phrase_djem_stats_daily WHERE nm_id = ? AND date = ? LIMIT 1",
      ).get(nmId, yesterday) as { updated_at: string | null } | undefined;
      if (yRow?.updated_at) {
        const nineTodayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0).getTime();
        const updatedAtMs = parseDbTimestampMs(yRow.updated_at);
        if (updatedAtMs < nineTodayMs) set.add(yesterday);
      }
    }
    datesToSync = Array.from(set).sort();
  }

  // Cache today: если это единственная дата и свежие строки <1ч — skip
  if (mode === "today" && !force) {
    const row = db.prepare(
      "SELECT MAX(updated_at) u FROM phrase_djem_stats_daily WHERE nm_id = ? AND date = ?",
    ).get(nmId, today) as { u: string | null } | undefined;
    if (row?.u) {
      const ageMs = dbTimestampAgeMs(row.u);
      if (ageMs != null && ageMs >= 0 && ageMs < TODAY_CACHE_MS) {
        return NextResponse.json({ ok: true, skipped: true, mode, cached: { ageMs } });
      }
    }
  }

  // Если heal и нечего делать — today уже свежий, пропуск
  if (mode === "heal" && datesToSync.length === 1 && datesToSync[0] === today && !force) {
    const row = db.prepare(
      "SELECT MAX(updated_at) u FROM phrase_djem_stats_daily WHERE nm_id = ? AND date = ?",
    ).get(nmId, today) as { u: string | null } | undefined;
    if (row?.u) {
      const ageMs = dbTimestampAgeMs(row.u);
      if (ageMs != null && ageMs >= 0 && ageMs < TODAY_CACHE_MS) {
        return NextResponse.json({ ok: true, skipped: true, mode, note: "history complete, today fresh" });
      }
    }
  }

  // Auth
  let session: SellerSession | null = loadSavedSellerSession();
  if (!session) {
    const auto = await ensureBrowser();
    if (!auto.page) return NextResponse.json({ ok: false, error: auto.error || "no browser" }, { status: 400 });
    const page = auto.page;
    const tok = await page.evaluate(() => localStorage.getItem("wb-eu-passport-v2.access-token"));
    const cookies = await page.cookies("https://seller.wildberries.ru", "https://seller-content.wildberries.ru");
    const sid = cookies.find((c) => c.name === "x-supplier-id")?.value || "";
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    if (!tok) return NextResponse.json({ ok: false, error: "no access-token in puppeteer profile" }, { status: 401 });
    session = { authorizev3: tok, supplierId: sid, cookieHeader };
  }

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO phrase_djem_stats_daily
      (nm_id, phrase, date, frequency, open_card_count, add_to_cart_count, order_count, avg_position, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const delDay = db.prepare("DELETE FROM phrase_djem_stats_daily WHERE nm_id = ? AND date = ?");

  g.__djemDailyProgress = { nmId, current: 0, total: datesToSync.length, running: true, mode };

  let currentLimit = limit;
  let totalRows = 0;
  const errors: string[] = [];
  const partial: string[] = []; // дни, где часть orderBy упала (фразы сохранены частично)

  // Синкает один день с fallback limit-уменьшения. Возвращает "ok" | "all-failed".
  const syncOneDay = async (date: string, progressIdx: number, total: number): Promise<"ok" | "all-failed"> => {
    g.__djemDailyProgress = { nmId, current: progressIdx, total, running: true, mode };
    try {
      const { stats, failedOrderBys } = await fetchDjemForDay(session, nmId, date, currentLimit);
      db.transaction(() => {
        delDay.run(nmId, date);
        for (const s of stats.values()) {
          upsert.run(nmId, s.phrase, date, s.frequency, s.openCardCount, s.addToCartCount, s.orderCount, s.avgPosition);
          totalRows++;
        }
      })();
      if (failedOrderBys.length > 0) partial.push(`${date}: ${failedOrderBys.join("+")}`);
      return "ok";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Авто-fallback на limit=30 если WB ругается на лимит
      if (currentLimit > 30 && /limit|invalid/i.test(msg)) {
        currentLimit = 30;
        return await syncOneDay(date, progressIdx, total); // повтор того же дня с 30
      }
      errors.push(`${date}: ${msg.slice(0, 200)}`);
      return "all-failed";
    }
  };

  // Pass 1 — основной проход
  const stillMissing: string[] = [];
  for (let i = 0; i < datesToSync.length; i++) {
    const res = await syncOneDay(datesToSync[i], i, datesToSync.length);
    if (res === "all-failed") stillMissing.push(datesToSync[i]);
    if (i < datesToSync.length - 1) await new Promise((r) => setTimeout(r, GAP_MS));
  }

  // Pass 2 — повтор только упавших, с большей паузой в начале
  const recoveredInPass2: string[] = [];
  if (stillMissing.length > 0) {
    await new Promise((r) => setTimeout(r, RETRY_PASS_DELAY_MS));
    for (let i = 0; i < stillMissing.length; i++) {
      g.__djemDailyProgress = {
        nmId,
        current: datesToSync.length + i,
        total: datesToSync.length + stillMissing.length,
        running: true,
        mode,
      };
      const res = await syncOneDay(stillMissing[i], datesToSync.length + i, datesToSync.length + stillMissing.length);
      if (res === "ok") recoveredInPass2.push(stillMissing[i]);
      if (i < stillMissing.length - 1) await new Promise((r) => setTimeout(r, GAP_MS));
    }
  }

  const finalMissing = stillMissing.filter((d) => !recoveredInPass2.includes(d));

  g.__djemDailyProgress = {
    nmId,
    current: datesToSync.length + stillMissing.length,
    total: datesToSync.length + stillMissing.length,
    running: false,
    mode,
  };

  // Проверяем итог: сколько дней из target покрыто реально в БД
  const coverRow = db.prepare(
    "SELECT COUNT(DISTINCT date) n FROM phrase_djem_stats_daily WHERE nm_id = ? AND date >= ?",
  ).get(nmId, targetDates[0]) as { n: number };

  return NextResponse.json({
    ok: true,
    nmId,
    mode,
    force,
    synced: datesToSync.length,
    rows: totalRows,
    coverage: { have: coverRow.n, need: 90, missing: 90 - coverRow.n },
    partialDays: partial.length ? partial : undefined,  // частичные (ок, но неполный мёрж)
    missingAfterRetry: finalMissing.length ? finalMissing : undefined,  // не покрыты даже после Pass 2
    errors: errors.length ? errors : undefined,
    limitUsed: currentLimit,
  });
}
