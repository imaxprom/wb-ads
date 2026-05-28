import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureCmpPage } from "@/lib/ensure-browser";
import { getHotCampaignAdvertIds } from "@/lib/campaign-queue";
import { CMP_USER_AGENT, loadSavedCmpSession } from "@/lib/wb-cmp-session";
import { dbTimestampAgeMs, parseDbTimestampMs } from "@/lib/db-time";
import JSZip from "jszip";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const g = globalThis as unknown as {
  __wbSniffCmpPage?: import("puppeteer").Page | null;
  __wbSniffRunning?: boolean;
  __fullstatV3DailyProgress?: { current: number; total: number; running: boolean; ok: number; err: number; runId?: string };
  __syncCancelled?: boolean;
  __syncTestRunId?: string;
};

export async function GET() {
  const p = g.__fullstatV3DailyProgress || { current: 0, total: 0, running: false, ok: 0, err: 0 };
  return NextResponse.json(p);
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

const MOSCOW_TZ = "Europe/Moscow";
const YESTERDAY_SYNC_DATE_KEY = "fullstat_v3_daily_yesterday_synced_date";
const YESTERDAY_SYNC_AT_KEY = "fullstat_v3_daily_yesterday_synced_at";
const YESTERDAY_CURSOR_DATE_KEY = "fullstat_v3_daily_yesterday_cursor_date";
const YESTERDAY_CURSOR_ADVERT_ID_KEY = "fullstat_v3_daily_yesterday_cursor_advert_id";

function moscowParts(d = new Date()): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MOSCOW_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")) || 0,
  };
}

function moscowDateOffset(daysBack: number): string {
  return moscowParts(new Date(Date.now() - daysBack * 86400000)).date;
}

function getSetting(db: ReturnType<typeof getDb>, key: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value || "";
}

function saveSetting(db: ReturnType<typeof getDb>, key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

function deleteSetting(db: ReturnType<typeof getDb>, key: string): void {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
}

function uniqueDates(dates: string[]): string[] {
  return Array.from(new Set(dates.filter(Boolean)));
}

function checkYesterdayCoverage(
  db: ReturnType<typeof getDb>,
  advertIds: number[],
  yesterdayMsk: string,
  todayMsk: string,
): { complete: boolean; missingAdvertIds: number[]; staleAdvertIds: number[]; thresholdIso: string } {
  if (advertIds.length === 0) {
    return { complete: true, missingAdvertIds: [], staleAdvertIds: [], thresholdIso: "" };
  }
  const ph = advertIds.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT advert_id, MAX(updated_at) updated_at
    FROM campaign_nm_daily
    WHERE date = ? AND advert_id IN (${ph})
    GROUP BY advert_id
  `).all(yesterdayMsk, ...advertIds) as { advert_id: number; updated_at: string | null }[];
  const updatedByAdvert = new Map(rows.map((r) => [r.advert_id, parseDbTimestampMs(r.updated_at)]));
  const thresholdIso = `${todayMsk}T09:00:00+03:00`;
  const thresholdMs = Date.parse(thresholdIso);
  const missingAdvertIds: number[] = [];
  const staleAdvertIds: number[] = [];
  for (const advertId of advertIds) {
    const updatedMs = updatedByAdvert.get(advertId) || 0;
    if (!updatedMs) missingAdvertIds.push(advertId);
    else if (updatedMs < thresholdMs) staleAdvertIds.push(advertId);
  }
  return {
    complete: missingAdvertIds.length === 0 && staleAdvertIds.length === 0,
    missingAdvertIds,
    staleAdvertIds,
    thresholdIso,
  };
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const inner = m[1];
    const parts: string[] = [];
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(inner)) !== null) parts.push(tm[1]);
    out.push(parts.join("")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
  }
  return out;
}

function parseSheetRows(xml: string, strings: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml)) !== null) {
    const rowXml = rm[2];
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rowXml)) !== null) {
      const attrs = cm[1] || "";
      const inner = cm[2] || "";
      const tMatch = /\bt="([^"]*)"/.exec(attrs);
      const t = tMatch ? tMatch[1] : "";
      const vMatch = /<v>([\s\S]*?)<\/v>/.exec(inner);
      if (!vMatch) { cells.push(""); continue; }
      const v = vMatch[1];
      if (t === "s") cells.push(strings[parseInt(v, 10)] || "");
      else cells.push(v);
    }
    rows.push(cells);
  }
  return rows;
}

function numOr0(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseNmIds(raw: string | null | undefined): Set<number> {
  try {
    const arr = JSON.parse(raw || "[]");
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map(Number).filter((n) => Number.isFinite(n) && n > 0));
  } catch {
    return new Set();
  }
}

interface Sheet1Row {
  name: string;
  nmId: number;
  spend: number;
  orderSum: number;
  views: number;
  clicks: number;
  atbs: number;
  orders: number;
  ctr: number;
  cr: number;
  cpm: number;
  cpc: number;
  cpo: number;
  cancels: number;
  avgPos: number;
  multiCardId: number;
  convType: string;
}

async function parseSheet1(bytes: Uint8Array): Promise<Sheet1Row[]> {
  const zip = await JSZip.loadAsync(bytes);
  const ssFile = zip.file("xl/sharedStrings.xml");
  const strings = ssFile ? parseSharedStrings(await ssFile.async("string")) : [];
  const s1 = zip.file("xl/worksheets/sheet1.xml");
  if (!s1) return [];
  const rows = parseSheetRows(await s1.async("string"), strings);
  const out: Sheet1Row[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = r[0] || "";
    const nmStr = r[1] || "";
    if (!name || name === "Всего по кампании") continue;
    const nmId = Number(nmStr);
    if (!nmId) continue;
    out.push({
      name,
      nmId,
      spend: numOr0(r[2]),
      orderSum: numOr0(r[3]),
      views: numOr0(r[4]),
      clicks: numOr0(r[5]),
      atbs: numOr0(r[6]),
      orders: numOr0(r[7]),
      ctr: numOr0(r[8]),
      cr: numOr0(r[9]),
      cpm: numOr0(r[10]),
      cpc: numOr0(r[11]),
      cpo: numOr0(r[12]),
      cancels: numOr0(r[13]),
      avgPos: Math.round(numOr0(r[14])),
      multiCardId: Math.round(numOr0(r[15])) || 0,
      convType: r[16] || "",
    });
  }
  return out;
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const sp = request.nextUrl.searchParams;

  const idsParam = sp.get("advertIds");
  let advertIds: number[];
  if (idsParam) {
    advertIds = idsParam.split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
  } else {
    // Только «горячие» кампании. Остальные — через ?advertIds=... или test-panel.
    advertIds = getHotCampaignAdvertIds(db);
  }
  const dateMode = sp.get("dateMode") || "";
  const days = Math.max(1, Math.min(30, Number(sp.get("days") || "7")));
  const onlyAdvertisedNms = sp.get("onlyAdvertisedNms") === "1";

  if (advertIds.length === 0) return NextResponse.json({ ok: true, rowsWritten: 0, errors: ["no advertIds"] });

  const advertisedNmsByAdvert = new Map<number, Set<number>>();
  if (onlyAdvertisedNms) {
    const placeholders = advertIds.map(() => "?").join(",");
    const rows = placeholders
      ? db.prepare(`SELECT advert_id, nms_json FROM campaigns WHERE advert_id IN (${placeholders})`).all(...advertIds) as { advert_id: number; nms_json: string | null }[]
      : [];
    for (const row of rows) advertisedNmsByAdvert.set(row.advert_id, parseNmIds(row.nms_json));
  }

  const forceBrowserAuth = sp.get("authMode") === "browser";
  const savedSession = forceBrowserAuth ? null : loadSavedCmpSession();
  let page: import("puppeteer").Page | null = null;

  async function refreshAuth(): Promise<{ tok: string; sid: string }> {
    if (savedSession) return { tok: savedSession.authorizev3, sid: savedSession.supplierId };
    if (!page) {
      const auto = await ensureCmpPage();
      if (!auto.page) throw new Error(auto.error || "no browser");
      page = auto.page;
    }
    if (!page!.url().includes("cmp.wildberries.ru")) {
      await page!.goto("https://cmp.wildberries.ru/campaigns/list", { waitUntil: "domcontentloaded", timeout: 20000 });
      await sleep(300);
    }
    const t = await page!.evaluate(() => localStorage.getItem("access-token"));
    const cs = await page!.cookies("https://cmp.wildberries.ru", "https://seller.wildberries.ru");
    const s = cs.find((c) => c.name === "x-supplier-id")?.value || "";
    return { tok: t || "", sid: s };
  }

  let { tok, sid } = await refreshAuth().catch(() => ({ tok: "", sid: "" }));
  if (!tok) return NextResponse.json({ ok: false, error: "no access-token" }, { status: 401 });

  const todayMsk = moscowDateOffset(0);
  const yesterdayMsk = moscowDateOffset(1);
  const nowMsk = moscowParts();
  const syncedYesterdayDate = getSetting(db, YESTERDAY_SYNC_DATE_KEY);
  const yesterdayCoverageBefore = checkYesterdayCoverage(db, advertIds, yesterdayMsk, todayMsk);
  const smartYesterdayDue = nowMsk.hour >= 9 && (syncedYesterdayDate !== yesterdayMsk || !yesterdayCoverageBefore.complete);
  let cursorDate = getSetting(db, YESTERDAY_CURSOR_DATE_KEY);
  let cursorAdvertId = Number(getSetting(db, YESTERDAY_CURSOR_ADVERT_ID_KEY) || "0");
  if ((dateMode === "smart" || dateMode === "yesterday") && cursorDate === yesterdayMsk && yesterdayCoverageBefore.complete) {
    deleteSetting(db, YESTERDAY_CURSOR_DATE_KEY);
    deleteSetting(db, YESTERDAY_CURSOR_ADVERT_ID_KEY);
    cursorDate = "";
    cursorAdvertId = 0;
  }
  let dates: string[];
  if (dateMode === "today") {
    dates = [todayMsk];
  } else if (dateMode === "yesterday") {
    dates = [yesterdayMsk];
  } else if (dateMode === "smart") {
    dates = smartYesterdayDue ? [todayMsk, yesterdayMsk] : [todayMsk];
  } else {
    dates = [];
    for (let i = 0; i < days; i++) dates.push(moscowDateOffset(i));
  }
  dates = uniqueDates(dates);

  const yesterdayCursorActive = cursorDate === yesterdayMsk && cursorAdvertId > 0;
  const yesterdayCursorIndex = yesterdayCursorActive ? advertIds.indexOf(cursorAdvertId) : -1;
  const yesterdayAdvertIdsForRun = yesterdayCursorIndex >= 0 ? advertIds.slice(yesterdayCursorIndex) : advertIds;

  async function fetchDay(advertId: number, date: string): Promise<{ status: number | string; base64?: string }> {
    // WB expects from==to as date at 00:00:00Z (interpreted as that day in MSK).
    // Using a 24h range instead corrupts the "Средняя позиция" aggregation.
    const stamp = `${date}T00:00:00Z`;
    const url = `https://cmp.wildberries.ru/api/v3/fullstat?advertID=${advertId}&appType=0&from=${encodeURIComponent(stamp)}&to=${encodeURIComponent(stamp)}`;
    if (savedSession) {
      try {
        const ac = new AbortController();
        const tmr = setTimeout(() => ac.abort(), 20000);
        const res = await fetch(url, {
          method: "GET",
          signal: ac.signal,
          headers: {
            "X-Supplierid": sid,
            "Authorizev3": tok,
            "Lang": "ru",
            "Accept": "*/*",
            "Cookie": savedSession.cookieHeader,
            "Origin": "https://cmp.wildberries.ru",
            "Referer": "https://cmp.wildberries.ru/campaigns/list",
            "User-Agent": CMP_USER_AGENT,
          },
        });
        clearTimeout(tmr);
        if (res.status !== 200) return { status: res.status };
        const buf = Buffer.from(await res.arrayBuffer());
        return { status: 200, base64: buf.toString("base64") };
      } catch (e) { return { status: "error:" + String(e) }; }
    }
    return await page!.evaluate(
      async (u: string, s: string, t: string) => {
        try {
          const ac = new AbortController();
          const tmr = setTimeout(() => ac.abort(), 20000);
          const res = await fetch(u, {
            method: "GET", credentials: "include", signal: ac.signal,
            headers: { "X-Supplierid": s, "Authorizev3": t, "Lang": "ru", "Accept": "*/*" },
          });
          clearTimeout(tmr);
          if (res.status !== 200) return { status: res.status };
          const buf = await res.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let str = "";
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            str += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
          }
          return { status: 200, base64: btoa(str) };
        } catch (e) { return { status: "error:" + String(e) }; }
      },
      url, sid, tok,
    ) as { status: number | string; base64?: string };
  }

  const stmt = db.prepare(`
    INSERT INTO campaign_nm_daily
      (advert_id, nm_id, date, product_name, spend, order_sum, views, clicks,
       atbs, orders, ctr, cr, cpm, cpc, cpo, cancels, avg_position,
       multi_card_id, conversion_type, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(advert_id, nm_id, date) DO UPDATE SET
      product_name=excluded.product_name, spend=excluded.spend, order_sum=excluded.order_sum,
      views=excluded.views, clicks=excluded.clicks, atbs=excluded.atbs, orders=excluded.orders,
      ctr=excluded.ctr, cr=excluded.cr, cpm=excluded.cpm, cpc=excluded.cpc, cpo=excluded.cpo,
      cancels=excluded.cancels, avg_position=excluded.avg_position,
      multi_card_id=excluded.multi_card_id, conversion_type=excluded.conversion_type,
      updated_at=datetime('now')
  `);

  const errors: string[] = [];
  const skipped: string[] = [];
  let rowsWritten = 0;
  let rowsReceived = 0;
  let rowsFilteredOut = 0;
  let fetched = 0;
  // Test-panel tuning knobs через query-string (дефолты = текущие константы).
  const GAP_MS = Math.max(0, Number(sp.get("gap") || "3000"));
  const BACKOFF_429_MS = Math.max(0, Number(sp.get("backoff429") || "0"));
  const MAX_RETRIES_429 = Math.max(0, Number(sp.get("maxRetries") || "0"));
  const CHUNK_SIZE = Math.max(1, Number(sp.get("chunkSize") || "999"));
  const CHUNK_COOLDOWN_MS = Math.max(0, Number(sp.get("chunkCooldown") || "0"));
  const JITTER_MS = Math.max(0, Number(sp.get("jitter") || "0"));
  const TIMELINE = sp.get("timeline") === "1";
  const TEST_ID = sp.get("testId");
  const PHASE = sp.get("phase") || "";
  const RUN_ID = sp.get("runId") || "";
  const isCurrentRun = () => RUN_ID ? g.__syncTestRunId === RUN_ID : !g.__syncTestRunId;
  const setProgress = (p: { current: number; total: number; running: boolean; ok: number; err: number }) => {
    if (isCurrentRun()) g.__fullstatV3DailyProgress = { ...p, runId: RUN_ID || undefined };
  };
  const gapWithJitter = () => GAP_MS + (JITTER_MS > 0 ? Math.floor((Math.random() * 2 - 1) * JITTER_MS) : 0);

  interface Event {
    step: number;
    ts_rel_ms: number;
    advert_id: number;
    endpoint: string;
    status: number | string;
    duration_ms: number;
    error?: string;
    date?: string;
    nm_id?: number;
    product_name?: string;
    kind?: "request" | "card";
  }
  const timeline: Event[] = [];
  const t0 = Date.now();
  let step = 0;
  let total429 = 0;
  let first429AtStep: number | null = null;
  const requestedByDate = new Map<string, number>();
  const errorsByDate = new Map<string, number>();

  const CACHE_WINDOW_MS = 10 * 60 * 1000;
  const force = sp.get("force") === "1";

  // Для кэш-проверки по (advert,date) — последний updated_at в campaign_nm_daily.
  const cacheCheck = db.prepare(
    "SELECT MAX(updated_at) u FROM campaign_nm_daily WHERE advert_id=? AND date=?",
  );

  const workItems = dateMode === "smart"
    ? [
        ...(smartYesterdayDue ? yesterdayAdvertIdsForRun.map((advertId) => ({ advertId, date: yesterdayMsk })) : []),
        ...advertIds.map((advertId) => ({ advertId, date: todayMsk })),
      ]
    : dateMode === "yesterday"
      ? yesterdayAdvertIdsForRun.map((advertId) => ({ advertId, date: yesterdayMsk }))
      : advertIds.flatMap((advertId) => dates.map((date) => ({ advertId, date })));
  const totalUnits = workItems.length;
  let unit = 0;
  setProgress({ current: 0, total: totalUnits, running: true, ok: 0, err: 0 });
  if (!TEST_ID) g.__syncCancelled = false;
  const pushCardEvents = (
    advertId: number,
    date: string,
    status: number | string,
    durationMs: number,
    rows: Sheet1Row[] = [],
    error?: string,
  ) => {
    if (!TIMELINE || !onlyAdvertisedNms) return;
    const expected = advertisedNmsByAdvert.get(advertId) || new Set<number>();
    const byNm = new Map(rows.map((row) => [row.nmId, row]));
    for (const nmId of expected) {
      const row = byNm.get(nmId);
      timeline.push({
        step,
        ts_rel_ms: Date.now() - t0,
        advert_id: advertId,
        nm_id: nmId,
        product_name: row?.name,
        date,
        endpoint: PHASE ? `v3-daily-card [${PHASE}]` : "v3-daily-card",
        status: status === 200 ? (row ? "ok" : "missing") : status,
        duration_ms: durationMs,
        error: row || status === 200 ? undefined : error,
        kind: "card",
      });
    }
    for (const row of rows) {
      if (!expected.has(row.nmId)) {
        timeline.push({
          step,
          ts_rel_ms: Date.now() - t0,
          advert_id: advertId,
          nm_id: row.nmId,
          product_name: row.name,
          date,
          endpoint: PHASE ? `v3-daily-card [${PHASE}]` : "v3-daily-card",
          status: "filtered",
          duration_ms: durationMs,
          error: "Карточка пришла в XLSX, но не входит в nms_json этой рекламной кампании",
          kind: "card",
        });
      }
    }
  };
  const markUnitDone = () => {
    setProgress({ current: Math.min(unit, totalUnits), total: totalUnits, running: true, ok: fetched, err: errors.length });
  };
  const markDateError = (date: string) => {
    errorsByDate.set(date, (errorsByDate.get(date) || 0) + 1);
  };
  const shouldFastFailSmart = () => dateMode === "smart";
  const maybeSleepAfterUnit = async () => {
    if (unit < totalUnits) await sleep(gapWithJitter());
  };

  let stopSmartRun = false;
  for (const { advertId, date } of workItems) {
      if (stopSmartRun) break;
      if (!isCurrentRun()) { errors.push("obsolete run"); break; }
      if (g.__syncCancelled) { errors.push("cancelled by user"); break; }
      unit++;
      markUnitDone();
      if (!force) {
        const cr = cacheCheck.get(advertId, date) as { u: string | null } | undefined;
        if (cr?.u) {
          const ageMs = dbTimestampAgeMs(cr.u);
          if (ageMs != null && ageMs >= 0 && ageMs < CACHE_WINDOW_MS) {
            skipped.push(`${advertId}/${date}`);
            requestedByDate.set(date, (requestedByDate.get(date) || 0) + 1);
            markUnitDone();
            continue;
          }
        }
      }
      // Chunk cooldown между партиями
      if (CHUNK_COOLDOWN_MS > 0 && unit > 0 && unit % CHUNK_SIZE === 0) {
        await sleep(CHUNK_COOLDOWN_MS);
      }
      const reqStart = Date.now();
      let r = await fetchDay(advertId, date);
      // Retry-loop per-запрос на 429
      let retries = 0;
      while (r.status === 429 && retries < MAX_RETRIES_429) {
        retries++;
        if (BACKOFF_429_MS > 0) await sleep(BACKOFF_429_MS);
        r = await fetchDay(advertId, date);
      }
      const reqDuration = Date.now() - reqStart;
      step++;
      requestedByDate.set(date, (requestedByDate.get(date) || 0) + 1);
      if (r.status === 429) {
        total429++;
        if (first429AtStep === null) first429AtStep = step;
        if (TIMELINE) timeline.push({ step, ts_rel_ms: Date.now() - t0, advert_id: advertId, endpoint: PHASE ? `v3-daily [${PHASE}] /${date}` : `v3-daily/${date}`, status: 429, duration_ms: reqDuration, date, kind: "request" });
        pushCardEvents(advertId, date, 429, reqDuration, [], `429 after ${retries} retries`);
        errors.push(`${advertId}/${date}: 429 after ${retries} retries → skip`);
        markDateError(date);
        if ((dateMode === "smart" || dateMode === "yesterday") && date === yesterdayMsk) {
          saveSetting(db, YESTERDAY_CURSOR_DATE_KEY, yesterdayMsk);
          saveSetting(db, YESTERDAY_CURSOR_ADVERT_ID_KEY, String(advertId));
        }
        markUnitDone();
        if (shouldFastFailSmart()) {
          stopSmartRun = true;
          continue;
        }
        // После 429 выдерживаем backoff (не внутри retry loop, а перед след. кампанией) —
        // чтобы при maxRetries=0 пользовательская пауза не игнорировалась.
        if (unit < totalUnits) await sleep(Math.max(BACKOFF_429_MS, gapWithJitter()));
        continue;
      }
      if (typeof r.status === "string" && r.status.startsWith("error")) {
        errors.push(`${advertId}/${date}: net-err → re-auth + retry`);
        await sleep(3000);
        try { const f = await refreshAuth(); tok = f.tok || tok; sid = f.sid || sid; } catch { /* ignore */ }
        r = await fetchDay(advertId, date);
      }
      if (r.status !== 200 || !r.base64) {
        if (TIMELINE) timeline.push({ step, ts_rel_ms: Date.now() - t0, advert_id: advertId, endpoint: PHASE ? `v3-daily [${PHASE}] /${date}` : `v3-daily/${date}`, status: r.status, duration_ms: reqDuration, date, kind: "request" });
        pushCardEvents(advertId, date, r.status, reqDuration, [], String(r.status));
        errors.push(`${advertId}/${date}: ${r.status}`);
        markDateError(date);
        if ((dateMode === "smart" || dateMode === "yesterday") && date === yesterdayMsk) {
          saveSetting(db, YESTERDAY_CURSOR_DATE_KEY, yesterdayMsk);
          saveSetting(db, YESTERDAY_CURSOR_ADVERT_ID_KEY, String(advertId));
        }
        markUnitDone();
        if (shouldFastFailSmart()) {
          stopSmartRun = true;
          continue;
        }
        await maybeSleepAfterUnit();
        continue;
      }
      if (TIMELINE) timeline.push({ step, ts_rel_ms: Date.now() - t0, advert_id: advertId, endpoint: PHASE ? `v3-daily [${PHASE}] /${date}` : `v3-daily/${date}`, status: 200, duration_ms: reqDuration, date, kind: "request" });
      try {
        const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
        const parsedRows = await parseSheet1(bytes);
        let rows = parsedRows;
        rowsReceived += rows.length;
        if (onlyAdvertisedNms) {
          const allowed = advertisedNmsByAdvert.get(advertId) || new Set<number>();
          const before = rows.length;
          rows = rows.filter((row) => allowed.has(row.nmId));
          rowsFilteredOut += before - rows.length;
        }
        pushCardEvents(advertId, date, 200, reqDuration, parsedRows);
        db.transaction(() => {
          for (const row of rows) {
            stmt.run(
              advertId, row.nmId, date, row.name,
              row.spend, row.orderSum, row.views, row.clicks,
              row.atbs, row.orders, row.ctr, row.cr, row.cpm, row.cpc, row.cpo,
              row.cancels, row.avgPos, row.multiCardId, row.convType,
            );
            rowsWritten++;
          }
        })();
        fetched++;
      } catch (e) {
        pushCardEvents(advertId, date, "parse_error", reqDuration, [], e instanceof Error ? e.message : String(e));
        errors.push(`${advertId}/${date}: parse ${e instanceof Error ? e.message : String(e)}`);
        markDateError(date);
        if ((dateMode === "smart" || dateMode === "yesterday") && date === yesterdayMsk) {
          saveSetting(db, YESTERDAY_CURSOR_DATE_KEY, yesterdayMsk);
          saveSetting(db, YESTERDAY_CURSOR_ADVERT_ID_KEY, String(advertId));
        }
        if (shouldFastFailSmart()) stopSmartRun = true;
      }
      markUnitDone();
      await maybeSleepAfterUnit();
  }

  setProgress({ current: totalUnits, total: totalUnits, running: false, ok: fetched, err: errors.length });

  if (TEST_ID) {
    try {
      const row = db.prepare("SELECT timeline_json FROM sync_test_log WHERE id = ?").get(Number(TEST_ID)) as { timeline_json: string | null } | undefined;
      const prev = row?.timeline_json ? JSON.parse(row.timeline_json) : [];
      const combined = [...prev, ...timeline];
      db.prepare("UPDATE sync_test_log SET timeline_json = ? WHERE id = ?").run(JSON.stringify(combined), Number(TEST_ID));
    } catch { /* */ }
  }

  const yesterdayRequested = dates.includes(yesterdayMsk);
  const yesterdayExpectedRequests = dateMode === "smart" && smartYesterdayDue
    ? yesterdayAdvertIdsForRun.length
    : advertIds.length;
  const yesterdayRequestsDone = (requestedByDate.get(yesterdayMsk) || 0) >= yesterdayExpectedRequests;
  const yesterdayOk = yesterdayRequested && yesterdayRequestsDone && (errorsByDate.get(yesterdayMsk) || 0) === 0;
  const yesterdayCoverageAfter = checkYesterdayCoverage(db, advertIds, yesterdayMsk, todayMsk);
  if ((dateMode === "smart" || dateMode === "yesterday") && yesterdayCoverageAfter.complete && (yesterdayOk || !yesterdayRequested)) {
    saveSetting(db, YESTERDAY_SYNC_DATE_KEY, yesterdayMsk);
    saveSetting(db, YESTERDAY_SYNC_AT_KEY, new Date().toISOString());
    deleteSetting(db, YESTERDAY_CURSOR_DATE_KEY);
    deleteSetting(db, YESTERDAY_CURSOR_ADVERT_ID_KEY);
  }

  return NextResponse.json({
    ok: true,
    campaigns: advertIds.length,
    days: dates.length,
    dates,
    dateMode: dateMode || "days",
    smartYesterdayDue,
    yesterdayDate: yesterdayMsk,
    yesterdaySynced: getSetting(db, YESTERDAY_SYNC_DATE_KEY) === yesterdayMsk,
    yesterdayCoverageBefore,
    yesterdayCoverageAfter,
    yesterdayCursorAdvertId: yesterdayCursorIndex >= 0 ? cursorAdvertId : null,
    yesterdayCursorApplied: yesterdayRequested && yesterdayCursorIndex >= 0,
    fetched,
    rowsWritten,
    rowsReceived,
    rowsFilteredOut,
    onlyAdvertisedNms,
    skipped,
    errors,
    total_429: total429,
    first_429_at_step: first429AtStep,
    steps: step,
  });
}
