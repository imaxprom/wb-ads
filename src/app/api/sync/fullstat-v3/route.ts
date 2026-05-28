import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureCmpPage } from "@/lib/ensure-browser";
import { localDateStr } from "@/lib/format";
import { getHotCampaignAdvertIds } from "@/lib/campaign-queue";
import { CMP_USER_AGENT, loadSavedCmpSession } from "@/lib/wb-cmp-session";
import { dbTimestampAgeMs } from "@/lib/db-time";
import JSZip from "jszip";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const g = globalThis as unknown as {
  __wbSniffCmpPage?: import("puppeteer").Page | null;
  __wbSniffRunning?: boolean;
  __fullstatV3Progress?: { current: number; total: number; running: boolean; ok: number; err: number; runId?: string };
  __syncCancelled?: boolean;
  __syncTestRunId?: string;
};

// GET — прогресс для UI (polling из модалки).
export async function GET() {
  const p = g.__fullstatV3Progress || { current: 0, total: 0, running: false, ok: 0, err: 0 };
  return NextResponse.json(p);
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const inner = m[1];
    const texts: string[] = [];
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(inner)) !== null) texts.push(tm[1]);
    out.push(decodeXml(texts.join("")));
  }
  return out;
}

function parseAttrs(attrs: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs)) !== null) out[m[1]] = decodeXml(m[2]);
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
      if (t === "inlineStr") {
        const isMatch = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
        cells.push(isMatch ? isMatch[1] : "");
        continue;
      }
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

function dateFromStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

type SheetKind = "keywords" | "catalog" | "reco";
interface XlsxSheet { name: string; path: string; }

async function getWorkbookSheets(zip: JSZip): Promise<XlsxSheet[]> {
  const workbook = await zip.file("xl/workbook.xml")?.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!workbook || !rels) return [];

  const relMap = new Map<string, string>();
  const relRe = /<Relationship\b([^>]*)(?:\/>|>[\s\S]*?<\/Relationship>)/g;
  let relM: RegExpExecArray | null;
  while ((relM = relRe.exec(rels)) !== null) {
    const attrs = parseAttrs(relM[1]);
    if (attrs.Id && attrs.Target) {
      relMap.set(attrs.Id, attrs.Target.startsWith("/") ? attrs.Target.slice(1) : `xl/${attrs.Target}`);
    }
  }

  const out: XlsxSheet[] = [];
  const sheetRe = /<sheet\b([^>]*)(?:\/>|>[\s\S]*?<\/sheet>)/g;
  let sheetM: RegExpExecArray | null;
  while ((sheetM = sheetRe.exec(workbook)) !== null) {
    const attrs = parseAttrs(sheetM[1]);
    const path = relMap.get(attrs["r:id"]) || `xl/worksheets/sheet${attrs.sheetId}.xml`;
    out.push({ name: attrs.name || `sheet${attrs.sheetId}`, path });
  }
  return out;
}

function detectSheetKind(name: string, rows: string[][]): SheetKind | null {
  const haystack = `${name} ${(rows[0] || []).join(" ")}`.toLowerCase();
  if (haystack.includes("ключев")) return "keywords";
  if (haystack.includes("рекомендац")) return "reco";
  if (haystack.includes("каталог")) return "catalog";
  return null;
}

interface KeywordRow { date: string; phrase: string; views: number; clicks: number; ctr: number; spend: number; }
interface CatalogRow { date: string; catalog_id: string; views: number; clicks: number; ctr: number; cpc: number; spend: number; }
interface RecoRow { date: string; views: number; clicks: number; spend: number; }
interface ParsedXlsx { keywords: KeywordRow[]; catalogs: CatalogRow[]; reco: RecoRow[]; }

async function parseXlsx(bytes: Uint8Array): Promise<ParsedXlsx> {
  const zip = await JSZip.loadAsync(bytes);
  const sharedStringsFile = zip.file("xl/sharedStrings.xml");
  const strings = sharedStringsFile ? parseSharedStrings(await sharedStringsFile.async("string")) : [];

  const out: ParsedXlsx = { keywords: [], catalogs: [], reco: [] };

  const workbookSheets = await getWorkbookSheets(zip);
  const sheets = workbookSheets.length > 0
    ? workbookSheets
    : [
      { name: "Статистика по ключевым словам", path: "xl/worksheets/sheet2.xml" },
      { name: "Статистика по каталогу", path: "xl/worksheets/sheet3.xml" },
      { name: "Рекомендации", path: "xl/worksheets/sheet4.xml" },
    ];

  for (const sheet of sheets) {
    const file = zip.file(sheet.path);
    if (!file) continue;
    const rows = parseSheetRows(await file.async("string"), strings);
    const kind = detectSheetKind(sheet.name, rows);
    if (!kind) continue;

    if (kind === "keywords") {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const phrase = r[0] || "";
      if (!phrase) continue;
      out.keywords.push({
        phrase,
        views: numOr0(r[1]),
        clicks: numOr0(r[2]),
        ctr: numOr0(r[3]),
        spend: numOr0(r[4]),
        date: r[5] || "",
      });
    }
      continue;
    }

    if (kind === "catalog") {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const cid = r[0] || "";
      if (!cid && !r[6]) continue;
      out.catalogs.push({
        catalog_id: cid,
        views: numOr0(r[1]),
        clicks: numOr0(r[2]),
        ctr: numOr0(r[3]),
        cpc: numOr0(r[4]),
        spend: numOr0(r[5]),
        date: r[6] || "",
      });
    }
      continue;
    }

    if (kind === "reco") {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const label = r[0] || "";
      if (!label && !r[6]) continue;
      out.reco.push({
        date: r[6] || "",
        views: numOr0(r[1]),
        clicks: numOr0(r[2]),
        spend: numOr0(r[5]),
      });
    }
    }
  }

  return out;
}

// 10-минутный кэш как у ивирмы (expiredAt:+10m). WB считает v3/fullstat тяжёлым и
// быстро даёт 429 при частых запросах — кэш радикально снижает нагрузку.
const CACHE_WINDOW_MS = 10 * 60 * 1000;

export async function POST(request: NextRequest) {
  const db = getDb();
  const errors: string[] = [];
  const skipped: number[] = [];
  const qp = request.nextUrl.searchParams;
  const force = qp.get("force") === "1";

  const idsParam = qp.get("advertIds");
  let actives: { advert_id: number }[];
  if (idsParam) {
    actives = idsParam.split(",").map((s) => Number(s.trim())).filter((n) => n > 0).map((advert_id) => ({ advert_id }));
  } else {
    // Только «горячие» кампании (active + paused с hot-nm). Холодные paused
    // не синкаются здесь — уменьшает нагрузку на WB, избегает 429.
    // Для полного прогона по всем 24 — использовать `?advertIds=...` или test-panel.
    actives = getHotCampaignAdvertIds(db).map((advert_id) => ({ advert_id }));
  }
  if (actives.length === 0) return NextResponse.json({ ok: true, synced: 0, errors: [] });

  // Фильтруем кампании, по которым свежие данные уже в БД.
  if (!force) {
    const cacheCheck = db.prepare(
      "SELECT MAX(updated_at) u FROM campaign_days WHERE advert_id = ?",
    );
    const fresh: typeof actives = [];
    for (const a of actives) {
      const r = cacheCheck.get(a.advert_id) as { u: string | null } | undefined;
      if (r?.u) {
        const ageMs = dbTimestampAgeMs(r.u);
        if (ageMs != null && ageMs >= 0 && ageMs < CACHE_WINDOW_MS) { skipped.push(a.advert_id); continue; }
      }
      fresh.push(a);
    }
    actives = fresh;
    if (actives.length === 0) {
      return NextResponse.json({ ok: true, skipped, note: "all fresh in cache", campaigns: 0 });
    }
  }

  const forceBrowserAuth = qp.get("authMode") === "browser";
  const savedSession = forceBrowserAuth ? null : loadSavedCmpSession();
  let page: import("puppeteer").Page | null = null;

  async function refreshAuth(): Promise<{ accessToken: string; supplierId: string }> {
    if (savedSession) return { accessToken: savedSession.authorizev3, supplierId: savedSession.supplierId };
    if (!page) {
      const auto = await ensureCmpPage();
      if (!auto.page) throw new Error(auto.error || "Браузер не запущен");
      page = auto.page;
    }
    // The cmp page is dedicated to cmp.wildberries.ru — reload it only if it
    // drifted (e.g. auth redirect). Never touch the seller tab.
    if (!page!.url().includes("cmp.wildberries.ru")) {
      await page!.goto("https://cmp.wildberries.ru/campaigns/list", { waitUntil: "domcontentloaded", timeout: 20000 });
      await sleep(300);
    }
    const tok = await page!.evaluate(() => localStorage.getItem("access-token"));
    const cs = await page!.cookies("https://cmp.wildberries.ru", "https://seller.wildberries.ru");
    const sid = cs.find((c) => c.name === "x-supplier-id")?.value || "";
    return { accessToken: tok || "", supplierId: sid };
  }

  let { accessToken, supplierId } = await refreshAuth().catch(() => ({ accessToken: "", supplierId: "" }));
  if (!accessToken) return NextResponse.json({ ok: false, error: "Не найден access-token" }, { status: 401 });

  // WB API expects from/to as MSK dates with T00:00:00Z format — mixing UTC/local
  // shifts the boundaries and corrupts per-day aggregation inside the xlsx.
  const today = localDateStr(new Date());
  const days = Math.max(1, Math.min(90, Number(qp.get("days") || "30")));
  const startDate = localDateStr(new Date(Date.now() - (days - 1) * 86400000));
  const dateChunks: { fromDate: string; toDate: string }[] = [];
  for (let cursor = dateFromStr(startDate), end = dateFromStr(today); cursor <= end;) {
    const chunkEnd = addDays(cursor, 29) > end ? end : addDays(cursor, 29);
    dateChunks.push({ fromDate: localDateStr(cursor), toDate: localDateStr(chunkEnd) });
    cursor = addDays(chunkEnd, 1);
  }

  const stmtDay = db.prepare(`
    INSERT INTO campaign_days
      (advert_id, date, views_total, views_search, views_catalog, views_reco,
       clicks_total, clicks_search, clicks_catalog, clicks_reco,
       sum_total, sum_search, sum_catalog, sum_reco, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(advert_id, date) DO UPDATE SET
      views_total=excluded.views_total,
      views_search=excluded.views_search,
      views_catalog=excluded.views_catalog,
      views_reco=excluded.views_reco,
      clicks_total=excluded.clicks_total,
      clicks_search=excluded.clicks_search,
      clicks_catalog=excluded.clicks_catalog,
      clicks_reco=excluded.clicks_reco,
      sum_total=excluded.sum_total,
      sum_search=excluded.sum_search,
      sum_catalog=excluded.sum_catalog,
      sum_reco=excluded.sum_reco,
      updated_at=datetime('now')
  `);

  const stmtKw = db.prepare(`
    INSERT OR REPLACE INTO campaign_keywords
      (advert_id, date, phrase, views, clicks, ctr, spend, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const stmtCat = db.prepare(`
    INSERT OR REPLACE INTO campaign_catalogs
      (advert_id, date, catalog_id, views, clicks, ctr, cpc, spend, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const statViewsStmt = db.prepare("SELECT views FROM campaign_stats_daily WHERE advert_id = ? AND date = ?");
  const delKw = db.prepare("DELETE FROM campaign_keywords WHERE advert_id=? AND date >= ? AND date <= ?");
  const delCat = db.prepare("DELETE FROM campaign_catalogs WHERE advert_id=? AND date >= ? AND date <= ?");
  const delDays = db.prepare("DELETE FROM campaign_days WHERE advert_id=? AND date >= ? AND date <= ?");

  async function fetchXlsx(advertId: number, fromDate: string, toDate: string): Promise<{ status: number | string; base64?: string; size?: number }> {
    const from = `${fromDate}T00:00:00Z`;
    const to = `${toDate}T00:00:00Z`;
    const url = `https://cmp.wildberries.ru/api/v3/fullstat?advertID=${advertId}&appType=0&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    if (savedSession) {
      try {
        const ac = new AbortController();
        const tmr = setTimeout(() => ac.abort(), 20000);
        const res = await fetch(url, {
          method: "GET",
          signal: ac.signal,
          headers: {
            "X-Supplierid": supplierId,
            "Authorizev3": accessToken,
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
        return { status: 200, base64: buf.toString("base64"), size: buf.length };
      } catch (e) { return { status: "error:" + String(e) }; }
    }
    return await page!.evaluate(
      async (u: string, sid: string, tok: string | null) => {
        try {
          // AbortSignal 20с — WB может тупить под throttle, не зависаем на минуты.
          const ac = new AbortController();
          const tmr = setTimeout(() => ac.abort(), 20000);
          const res = await fetch(u, {
            method: "GET", credentials: "include", signal: ac.signal,
            headers: { "X-Supplierid": sid, "Authorizev3": tok || "", "Lang": "ru", "Accept": "*/*" },
          });
          clearTimeout(tmr);
          if (res.status !== 200) return { status: res.status };
          const buf = await res.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let s = "";
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
          }
          return { status: 200, base64: btoa(s), size: bytes.length };
        } catch (e) { return { status: "error:" + String(e) }; }
      },
      url, supplierId, accessToken,
    ) as { status: number | string; base64?: string; size?: number };
  }

  // Test-panel параметры — все query-string, если нет → используются дефолты (не ломая ничего).
  const GAP_MS = Math.max(0, Number(qp.get("gap") || "10000"));
  const BACKOFF_429_MS = Math.max(0, Number(qp.get("backoff429") || "0"));
  const MAX_RETRIES_429 = Math.max(0, Number(qp.get("maxRetries") || "0"));
  const CHUNK_SIZE = Math.max(1, Number(qp.get("chunkSize") || "999"));
  const CHUNK_COOLDOWN_MS = Math.max(0, Number(qp.get("chunkCooldown") || "0"));
  const JITTER_MS = Math.max(0, Number(qp.get("jitter") || "0"));
  const TIMELINE = qp.get("timeline") === "1";
  const TEST_ID = qp.get("testId");
  const PHASE = qp.get("phase") || ""; // 'hot'/'cold' — для test-panel journal labels
  const RUN_ID = qp.get("runId") || "";
  const isCurrentRun = () => RUN_ID ? g.__syncTestRunId === RUN_ID : !g.__syncTestRunId;
  const setProgress = (p: { current: number; total: number; running: boolean; ok: number; err: number }) => {
    if (isCurrentRun()) g.__fullstatV3Progress = { ...p, runId: RUN_ID || undefined };
  };
  const gapWithJitter = () => GAP_MS + (JITTER_MS > 0 ? Math.floor((Math.random() * 2 - 1) * JITTER_MS) : 0);

  // Timeline-коллектор для тест-панели.
  interface Event { step: number; ts_rel_ms: number; advert_id: number; endpoint: string; status: number | string; duration_ms: number; error?: string }
  const timeline: Event[] = [];
  const t0 = Date.now();
  let step = 0;
  let total429 = 0;
  let first429AtStep: number | null = null;

  let campsOk = 0;
  let kwRows = 0, catRows = 0, dayRows = 0;

  setProgress({ current: 0, total: actives.length, running: true, ok: 0, err: 0 });
  if (!TEST_ID) g.__syncCancelled = false;
  const markCampaignDone = (current: number) => {
    setProgress({ current: Math.min(current, actives.length), total: actives.length, running: true, ok: campsOk, err: errors.length });
  };
  const maybeSleepAfterCampaign = async (current: number) => {
    if (current < actives.length) await sleep(gapWithJitter());
  };

  for (let idx = 0; idx < actives.length; idx++) {
    if (!isCurrentRun()) { errors.push("obsolete run"); break; }
    if (g.__syncCancelled) { errors.push("cancelled by user"); break; }
    const { advert_id } = actives[idx];
    const current = idx + 1;
    markCampaignDone(current);

    // Chunk cooldown между партиями
    if (CHUNK_COOLDOWN_MS > 0 && idx > 0 && idx % CHUNK_SIZE === 0) {
      await sleep(CHUNK_COOLDOWN_MS);
    }

    try {
      const parsed: ParsedXlsx = { keywords: [], catalogs: [], reco: [] };
      let failed = false;

      for (const chunk of dateChunks) {
        const reqStart = Date.now();
        let r = await fetchXlsx(advert_id, chunk.fromDate, chunk.toDate);
        let retries = 0;
        while (r.status === 429 && retries < MAX_RETRIES_429) {
          retries++;
          if (BACKOFF_429_MS > 0) await sleep(BACKOFF_429_MS);
          r = await fetchXlsx(advert_id, chunk.fromDate, chunk.toDate);
        }
        const reqDuration = Date.now() - reqStart;
        step++;
        const endpointLabel = PHASE
          ? `fullstat-v3 [${PHASE}] ${chunk.fromDate}..${chunk.toDate}`
          : `fullstat-v3 ${chunk.fromDate}..${chunk.toDate}`;

        if (r.status === 429) {
          total429++;
          if (first429AtStep === null) first429AtStep = step;
          if (TIMELINE) timeline.push({ step, ts_rel_ms: Date.now() - t0, advert_id, endpoint: endpointLabel, status: 429, duration_ms: reqDuration });
          errors.push(`${advert_id} ${chunk.fromDate}..${chunk.toDate}: 429 after ${retries} retries → skip`);
          failed = true;
          if (current < actives.length) await sleep(Math.max(BACKOFF_429_MS, gapWithJitter()));
          break;
        }

        if (typeof r.status === "string" && r.status.startsWith("error")) {
          errors.push(`${advert_id} ${chunk.fromDate}..${chunk.toDate}: net-err → re-auth + retry`);
          await sleep(5000);
          try {
            const fresh = await refreshAuth();
            accessToken = fresh.accessToken || accessToken;
            supplierId = fresh.supplierId || supplierId;
          } catch (e) { errors.push(`${advert_id}: refreshAuth ${e}`); }
          r = await fetchXlsx(advert_id, chunk.fromDate, chunk.toDate);
        }

        if (r.status !== 200 || !r.base64) {
          if (TIMELINE) timeline.push({ step, ts_rel_ms: Date.now() - t0, advert_id, endpoint: endpointLabel, status: r.status, duration_ms: reqDuration });
          errors.push(`${advert_id} ${chunk.fromDate}..${chunk.toDate}: ${r.status}`);
          failed = true;
          break;
        }

        if (TIMELINE) timeline.push({ step, ts_rel_ms: Date.now() - t0, advert_id, endpoint: endpointLabel, status: 200, duration_ms: reqDuration });
        const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
        const chunkParsed = await parseXlsx(bytes);
        parsed.keywords.push(...chunkParsed.keywords);
        parsed.catalogs.push(...chunkParsed.catalogs);
        parsed.reco.push(...chunkParsed.reco);
      }

      if (failed) {
        markCampaignDone(current);
        await maybeSleepAfterCampaign(current);
        continue;
      }

      type Agg = { views: number; clicks: number; spend: number };
      const perDay = new Map<string, { search: Agg; catalog: Agg; reco: Agg }>();
      const ensure = (d: string) => {
        let v = perDay.get(d);
        if (!v) { v = { search: { views: 0, clicks: 0, spend: 0 }, catalog: { views: 0, clicks: 0, spend: 0 }, reco: { views: 0, clicks: 0, spend: 0 } }; perDay.set(d, v); }
        return v;
      };
      for (const k of parsed.keywords) {
        if (!k.date) continue;
        const a = ensure(k.date).search;
        a.views += k.views; a.clicks += k.clicks; a.spend += k.spend;
      }
      for (const c of parsed.catalogs) {
        if (!c.date) continue;
        const a = ensure(c.date).catalog;
        a.views += c.views; a.clicks += c.clicks; a.spend += c.spend;
      }
      for (const rr of parsed.reco) {
        if (!rr.date) continue;
        const a = ensure(rr.date).reco;
        a.views += rr.views; a.clicks += rr.clicks; a.spend += rr.spend;
      }

      db.transaction(() => {
        delKw.run(advert_id, startDate, today);
        delCat.run(advert_id, startDate, today);
        delDays.run(advert_id, startDate, today);
        for (const k of parsed.keywords) {
          stmtKw.run(advert_id, k.date, k.phrase, k.views, k.clicks, k.ctr, k.spend);
          kwRows++;
        }
        for (const c of parsed.catalogs) {
          stmtCat.run(advert_id, c.date, c.catalog_id, c.views, c.clicks, c.ctr, c.cpc, c.spend);
          catRows++;
        }
        for (const [date, z] of perDay) {
          const sheetTotalV = z.search.views + z.catalog.views + z.reco.views;
          const stat = statViewsStmt.get(advert_id, date) as { views: number } | undefined;
          const totalV = Math.max(sheetTotalV, stat?.views ?? 0);
          const catalogViews = Math.max(0, totalV - z.search.views - z.reco.views);
          const totalC = z.search.clicks + z.catalog.clicks + z.reco.clicks;
          const totalS = z.search.spend + z.catalog.spend + z.reco.spend;
          stmtDay.run(
            advert_id, date,
            totalV, z.search.views, catalogViews, z.reco.views,
            totalC, z.search.clicks, z.catalog.clicks, z.reco.clicks,
            totalS, z.search.spend, z.catalog.spend, z.reco.spend,
          );
          dayRows++;
        }
      })();

      campsOk++;
    } catch (e) {
      errors.push(`${advert_id}: parse ${e instanceof Error ? e.message : String(e)}`);
    }
    markCampaignDone(current);
    await maybeSleepAfterCampaign(current);
  }

  setProgress({ current: actives.length, total: actives.length, running: false, ok: campsOk, err: errors.length });

  // Test-panel: обновить timeline в sync_test_log (при наличии testId).
  if (TEST_ID) {
    try {
      const row = db.prepare("SELECT timeline_json FROM sync_test_log WHERE id = ?").get(Number(TEST_ID)) as { timeline_json: string | null } | undefined;
      const prev = row?.timeline_json ? JSON.parse(row.timeline_json) : [];
      const combined = [...prev, ...timeline];
      db.prepare("UPDATE sync_test_log SET timeline_json = ? WHERE id = ?").run(JSON.stringify(combined), Number(TEST_ID));
    } catch { /* */ }
  }

  return NextResponse.json({
    ok: true, campaigns: campsOk, days: dayRows, keywords: kwRows, catalogs: catRows, skipped, errors,
    total_429: total429, first_429_at_step: first429AtStep, steps: step,
  });
}
