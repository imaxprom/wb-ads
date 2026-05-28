import fs from "fs";
import path from "path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDb } from "./db";
import { getActiveCampaignAdvertIds } from "./campaign-queue";
import { parseDbTimestampMs } from "./db-time";
import { getPricesApiKey } from "./api-key";

export type AuditSeverity = "info" | "warning" | "error";

export interface AuditIssue {
  id: string;
  severity: AuditSeverity;
  area: string;
  title: string;
  details: string;
  evidence?: Record<string, unknown>;
}

export interface AuditOptions {
  includeExternal?: boolean;
  externalLimit?: number;
}

export interface AuditReport {
  ok: boolean;
  generatedAt: string;
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
  issues: AuditIssue[];
  checks: Record<string, unknown>;
}

type Db = ReturnType<typeof getDb>;

const execFileAsync = promisify(execFile);

function moscowDateOffset(daysBack: number): string {
  const d = new Date(Date.now() - daysBack * 86400000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function ageHours(raw: string | null | undefined): number | null {
  const ms = parseDbTimestampMs(raw);
  if (!ms) return null;
  return Math.round(((Date.now() - ms) / 36_000) / 10);
}

function addIssue(issues: AuditIssue[], issue: AuditIssue) {
  issues.push(issue);
}

function safeGet<T>(db: Db, sql: string, ...params: unknown[]): T | null {
  try {
    return db.prepare(sql).get(...params) as T | undefined || null;
  } catch {
    return null;
  }
}

function safeAll<T>(db: Db, sql: string, ...params: unknown[]): T[] {
  try {
    return db.prepare(sql).all(...params) as T[];
  } catch {
    return [];
  }
}

function getApiKeyStatus(): { exists: boolean; length: number } {
  const p = path.join(process.cwd(), "data", "wb-prices-api-key.txt");
  try {
    const value = fs.readFileSync(p, "utf8").trim();
    return { exists: value.length > 0, length: value.length };
  } catch {
    return { exists: false, length: 0 };
  }
}

async function checkPricesApiScope(): Promise<{ ok: boolean; status?: number; error?: string }> {
  let key = "";
  try {
    key = getPricesApiKey();
  } catch {
    return { ok: false, error: "wb-prices-api-key.txt and wb-api-key.txt are missing" };
  }
  if (!key) return { ok: false, error: "prices api key is empty" };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch("https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1&offset=0", {
      headers: { Authorization: key },
      signal: ac.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: body.slice(0, 240) };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPublicWbPrice(nmId: number): Promise<{ minBase: number | null; maxBase: number | null; basePrices: number[]; error?: string }> {
  const url = `https://card.wb.ru/cards/v4/detail?appType=1&curr=rub&dest=-1257786&spp=30&nm=${nmId}`;
  try {
    const { stdout } = await execFileAsync("curl", [
      "-sS",
      "-L",
      "--max-time",
      "10",
      "-A",
      "Mozilla/5.0",
      url,
    ], { maxBuffer: 1024 * 1024, timeout: 12000 });
    const data = JSON.parse(stdout) as { products?: Array<{ sizes?: Array<{ price?: { basic?: number } }> }> };
    const basePrices = (data.products?.[0]?.sizes || [])
      .map((s) => typeof s.price?.basic === "number" ? Math.round(s.price.basic / 100) : 0)
      .filter((n) => n > 0);
    if (basePrices.length === 0) return { minBase: null, maxBase: null, basePrices: [], error: "no public base prices" };
    return { minBase: Math.min(...basePrices), maxBase: Math.max(...basePrices), basePrices };
  } catch (e) {
    return { minBase: null, maxBase: null, basePrices: [], error: e instanceof Error ? e.message : String(e) };
  }
}

function relativeDiff(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / denom;
}

function checkProducts(db: Db, issues: AuditIssue[], checks: Record<string, unknown>) {
  const stats = safeGet<{
    rows: number;
    with_min: number;
    with_max: number;
    with_sale: number;
    zero_price: number;
    invalid_range: number;
    min_updated: string | null;
    max_updated: string | null;
  }>(db, `
    SELECT COUNT(*) rows,
           SUM(CASE WHEN min_price IS NOT NULL AND min_price > 0 THEN 1 ELSE 0 END) with_min,
           SUM(CASE WHEN max_price IS NOT NULL AND max_price > 0 THEN 1 ELSE 0 END) with_max,
           SUM(CASE WHEN sale_price IS NOT NULL AND sale_price > 0 THEN 1 ELSE 0 END) with_sale,
           SUM(CASE WHEN COALESCE(price, 0) <= 0 THEN 1 ELSE 0 END) zero_price,
           SUM(CASE WHEN COALESCE(min_price, 0) > COALESCE(max_price, 0) AND COALESCE(max_price, 0) > 0 THEN 1 ELSE 0 END) invalid_range,
           MIN(updated_at) min_updated,
           MAX(updated_at) max_updated
    FROM products
  `);
  checks.products = stats;
  if (!stats || stats.rows === 0) {
    addIssue(issues, {
      id: "products.empty",
      severity: "error",
      area: "products",
      title: "products is empty",
      details: "Карточки не могут быть корректными без строк в products.",
    });
    return;
  }
  if (stats.with_min < stats.rows || stats.with_max < stats.rows) {
    addIssue(issues, {
      id: "products.missing-price-range",
      severity: "warning",
      area: "products",
      title: "Some products have no min/max price",
      details: "Часть карточек не имеет min_price/max_price; UI будет показывать fallback или пустую цену.",
      evidence: { rows: stats.rows, withMin: stats.with_min, withMax: stats.with_max },
    });
  }
  if (stats.zero_price > 0) {
    addIssue(issues, {
      id: "products.zero-base-price",
      severity: "warning",
      area: "products",
      title: "Some products have zero base price",
      details: "Есть карточки с price=0; это обычно означает, что price sync не нашёл или не обновил товар.",
      evidence: { zeroPrice: stats.zero_price },
    });
  }
  if (stats.invalid_range > 0) {
    addIssue(issues, {
      id: "products.invalid-price-range",
      severity: "error",
      area: "products",
      title: "Invalid price ranges",
      details: "Найдены строки, где min_price больше max_price.",
      evidence: { invalidRange: stats.invalid_range },
    });
  }
}

function checkDjemDaily(db: Db, issues: AuditIssue[], checks: Record<string, unknown>) {
  const today = moscowDateOffset(0);
  const activeNmJsonRows = safeAll<{ nms_json: string | null }>(db, `
    SELECT nms_json
    FROM campaigns
    WHERE status = 9
      AND nms_json IS NOT NULL
      AND nms_json != '[]'
  `);
  const activeNmSet = new Set<number>();
  for (const row of activeNmJsonRows) {
    try {
      const arr = JSON.parse(row.nms_json || "[]");
      if (Array.isArray(arr)) {
        for (const value of arr) {
          const nmId = Number(value);
          if (Number.isFinite(nmId) && nmId > 0) activeNmSet.add(nmId);
        }
      }
    } catch {
      /* ignore bad campaign nms_json; separate data-quality checks can flag it later */
    }
  }
  const activeNm = Array.from(activeNmSet).map((nm_id) => ({ nm_id }));
  const rows = safeAll<{ nm_id: number; rows: number; updated_at: string | null }>(db, `
    SELECT nm_id, COUNT(*) rows, MAX(updated_at) updated_at
    FROM phrase_djem_stats_daily
    WHERE date = ?
    GROUP BY nm_id
  `, today);
  const byNm = new Map(rows.map((r) => [Number(r.nm_id), r]));
  const missing = activeNm.map((r) => Number(r.nm_id)).filter((nmId) => !byNm.has(nmId));
  checks.djemDaily = { today, activeNmIds: activeNm.length, withTodayRows: rows.length, missingToday: missing };
  if (activeNm.length > 0 && missing.length > 0) {
    addIssue(issues, {
      id: "djem-daily.missing-today",
      severity: "warning",
      area: "djem",
      title: "Djem daily has no rows for today on some active nmIds",
      details: "Для этих nmId вкладка рекламы может показывать пустой Джем при выборе сегодняшнего периода.",
      evidence: { today, missingNmIds: missing.slice(0, 30), missingCount: missing.length },
    });
  }
}

function checkFullstatDaily(db: Db, issues: AuditIssue[], checks: Record<string, unknown>) {
  const yesterday = moscowDateOffset(1);
  const today = moscowDateOffset(0);
  const activeAdvertIds = getActiveCampaignAdvertIds(db);
  const rows = safeAll<{ advert_id: number; updated_at: string | null; rows: number }>(db, `
    SELECT advert_id, MAX(updated_at) updated_at, COUNT(*) rows
    FROM campaign_nm_daily
    WHERE date = ?
    GROUP BY advert_id
  `, yesterday);
  const byAdvert = new Map(rows.map((r) => [Number(r.advert_id), r]));
  const thresholdMs = Date.parse(`${today}T09:00:00+03:00`);
  const missing: number[] = [];
  const stale: number[] = [];
  for (const advertId of activeAdvertIds) {
    const d = byAdvert.get(advertId);
    if (!d) missing.push(advertId);
    else if (parseDbTimestampMs(d.updated_at) < thresholdMs) stale.push(advertId);
  }
  checks.fullstatV3Daily = { yesterday, activeCampaigns: activeAdvertIds.length, expectedAdvertIds: activeAdvertIds, missing, stale };
  if (missing.length > 0 || stale.length > 0) {
    addIssue(issues, {
      id: "fullstat-v3-daily.yesterday-coverage",
      severity: "warning",
      area: "ads",
      title: "Yesterday fullstat-v3-daily coverage is incomplete or stale",
      details: "Вчерашняя детализация рекламы должна быть обновлена после 09:00 МСК; иначе нижние таблицы и позиции могут быть старыми.",
      evidence: { yesterday, missingAdvertIds: missing, staleAdvertIds: stale },
    });
  }
}

function checkSyncLog(db: Db, issues: AuditIssue[], checks: Record<string, unknown>) {
  const rows = safeAll<{ id: number; type: string; started_at: string; errors: number; error_details: string | null }>(db, `
    SELECT id, type, started_at, errors, error_details
    FROM sync_log
    ORDER BY id DESC
    LIMIT 10
  `);
  checks.recentSyncLog = rows;
  const hardFailures = rows.filter((r) => Number(r.errors) > 0);
  if (hardFailures.length > 0) {
    addIssue(issues, {
      id: "sync-log.recent-errors",
      severity: "warning",
      area: "sync",
      title: "Recent sync_log rows contain errors",
      details: "Последние sync_log содержат ошибки; проверь error_details, даже если UI выглядит рабочим.",
      evidence: { rows: hardFailures.slice(0, 5) },
    });
  }
}

function checkSettings(db: Db, issues: AuditIssue[], checks: Record<string, unknown>) {
  const cursorRows = safeAll<{ key: string; value: string }>(db, `
    SELECT key, value
    FROM settings
    WHERE key LIKE 'fullstat_v3_daily_%cursor%'
    ORDER BY key
  `);
  checks.staleCursorSettings = cursorRows;
  if (cursorRows.length > 0) {
    addIssue(issues, {
      id: "settings.fullstat-cursor-present",
      severity: "info",
      area: "settings",
      title: "fullstat-v3-daily cursor keys are present",
      details: "Cursor может быть нормальным маркером продолжения после 429, но после полного покрытия он должен очищаться.",
      evidence: { cursorRows },
    });
  }
}

async function checkExternalPrices(db: Db, issues: AuditIssue[], checks: Record<string, unknown>, limit: number) {
  const apiKey = getApiKeyStatus();
  const scope = await checkPricesApiScope();
  checks.pricesApiScope = { apiKeyExists: apiKey.exists, keyLength: apiKey.length, ...scope };
  if (!scope.ok) {
    addIssue(issues, {
      id: "external.prices-api-scope",
      severity: "error",
      area: "products",
      title: "WB Prices API is not usable with current key",
      details: "Цены из discounts-prices-api не могут обновляться; products sync должен явно подсвечивать это, а не скрывать.",
      evidence: scope,
    });
  }

  const sample = safeAll<{ nm_id: number; discount: number | null; min_price: number | null; max_price: number | null }>(db, `
    SELECT DISTINCT p.nm_id, p.discount, p.min_price, p.max_price
    FROM products p
    JOIN campaigns c ON c.nms_json LIKE '%' || CAST(p.nm_id AS TEXT) || '%'
    WHERE c.status IN (9, 11)
    ORDER BY nm_id
    LIMIT ?
  `, limit);
  const comparisons: Array<Record<string, unknown>> = [];
  for (const row of sample) {
    const publicPrice = await fetchPublicWbPrice(Number(row.nm_id));
    const localMin = Number(row.min_price || 0);
    const localMax = Number(row.max_price || 0);
    const sellerDiscount = Math.max(0, Math.min(99, Number(row.discount || 0)));
    const expectedMin = publicPrice.minBase != null ? Math.round(publicPrice.minBase * (100 - sellerDiscount) / 100) : null;
    const expectedMax = publicPrice.maxBase != null ? Math.round(publicPrice.maxBase * (100 - sellerDiscount) / 100) : null;
    const minDiff = expectedMin != null && localMin > 0 ? relativeDiff(localMin, expectedMin) : null;
    const maxDiff = expectedMax != null && localMax > 0 ? relativeDiff(localMax, expectedMax) : null;
    const mismatch = (minDiff != null && minDiff > 0.05) || (maxDiff != null && maxDiff > 0.05);
    comparisons.push({
      nmId: row.nm_id,
      discount: sellerDiscount,
      localMin,
      localMax,
      publicMinBase: publicPrice.minBase,
      publicMaxBase: publicPrice.maxBase,
      expectedSellerMin: expectedMin,
      expectedSellerMax: expectedMax,
      publicError: publicPrice.error,
      mismatch,
    });
  }
  checks.publicPriceCompare = comparisons;
  const mismatches = comparisons.filter((r) => r.mismatch);
  if (mismatches.length > 0) {
    addIssue(issues, {
      id: "external.public-price-mismatch",
      severity: "warning",
      area: "products",
      title: "Local product price range differs from seller-discounted public base price",
      details: "Диапазон products.min_price/max_price отличается от public basic × products.discount больше чем на 5%.",
      evidence: { mismatches },
    });
  }
}

export async function runServiceAudit(options: AuditOptions = {}): Promise<AuditReport> {
  const db = getDb();
  const issues: AuditIssue[] = [];
  const checks: Record<string, unknown> = {};

  checkProducts(db, issues, checks);
  checkDjemDaily(db, issues, checks);
  checkFullstatDaily(db, issues, checks);
  checkSyncLog(db, issues, checks);
  checkSettings(db, issues, checks);

  if (options.includeExternal) {
    await checkExternalPrices(db, issues, checks, Math.max(1, Math.min(50, options.externalLimit || 10)));
  }

  const summary = {
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
    info: issues.filter((i) => i.severity === "info").length,
  };

  return {
    ok: summary.errors === 0,
    generatedAt: new Date().toISOString(),
    summary,
    issues,
    checks,
  };
}

export function formatAuditReport(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(`Service audit: ${report.ok ? "OK" : "FAIL"}`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Summary: errors=${report.summary.errors}, warnings=${report.summary.warnings}, info=${report.summary.info}`);
  lines.push("");
  if (report.issues.length === 0) {
    lines.push("No issues found.");
    return lines.join("\n");
  }
  for (const issue of report.issues) {
    lines.push(`[${issue.severity.toUpperCase()}] ${issue.area}: ${issue.title}`);
    lines.push(`  id: ${issue.id}`);
    lines.push(`  ${issue.details}`);
    if (issue.evidence) lines.push(`  evidence: ${JSON.stringify(issue.evidence)}`);
    lines.push("");
  }
  return lines.join("\n");
}
