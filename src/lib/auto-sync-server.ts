/**
 * Server-side auto-sync manager.
 * Runs setInterval on Node.js — works even when browser tab is inactive.
 * Settings (enabled, interval) read from DB.
 */
import * as http from "node:http";
import * as https from "node:https";
import { getDb } from "./db";

const BASE = process.env.WB_ADS_INTERNAL_BASE_URL || "http://127.0.0.1:3001";
const BACKGROUND_JOBS_DISABLE_ENV = "WB_ADS_DISABLE_BACKGROUND_JOBS";
const MAIN_AUTO_SYNC_ENV = "WB_ADS_ENABLE_MAIN_AUTO_SYNC";
const TEST_AUTO_SYNC_ENV = "WB_ADS_ENABLE_TEST_AUTO_SYNC";
const SESSION_CHECK_ENV = "WB_ADS_ENABLE_SESSION_CHECK";
const DAILY_SEARCH_TEXTS_ENV = "WB_ADS_ENABLE_DAILY_SEARCH_TEXTS";
const DAILY_BUYOUT_ENV = "WB_ADS_ENABLE_DAILY_BUYOUT";
const DJEM_DAILY_ENV = "WB_ADS_ENABLE_DJEM_DAILY";
const BID_AUTOMATION_ENV = "WB_ADS_ENABLE_BID_AUTOMATION";

const SYNC_STEPS = [
  "/api/sync/campaigns",
  "/api/sync/products",
  "/api/sync/stocks",
  "/api/sync/supplier-orders?days=3",   // заказы Statistics API для СПП в нижней воронке карточек
  "/api/sync/stats",
  "/api/sync/balance",
  "/api/sync/expense-history",          // фактические списания WB по кампаниям (/adv/v1/upd, последние 7 дней)
  "/api/sync/clusters",
  // ─── ВРЕМЕННО ОТКЛЮЧЕНО ───
  // fullstat-v3 и fullstat-v3-daily гоняются в Test-panel для подбора параметров под WB 429.
  // Чтобы тесты не конфликтовали с auto-sync — отключаем здесь. Вернуть когда найдём рабочую
  // схему задержек. Не удалять, закомментировать.
  // "/api/sync/fullstat-v3",
  // "/api/sync/fullstat-v3-daily?days=2",
  "/api/sync/normquery-bids",           // ставки CPM по фразам (open API)
  "/api/sync/normquery-stats?days=1",   // per-phrase avg_pos/CPM/atbs (open API)
  "/api/sync/preset-info-open",         // фразы через open API (list + get-bids + stats), быстрее, без Puppeteer
  "/api/sync/preset-info",              // полный срез фраз (управляемые + исключения) через cmp
  "/api/sync/supplier-subjects",        // минимальные CPM по предметам (кэш 24ч, fallback ставка)
  "/api/sync/funnel?days=1",
];

const g = globalThis as unknown as {
  __autoSyncTimer?: ReturnType<typeof setInterval> | null;
  __autoSyncRunning?: boolean;
  __autoSyncLastRun?: number;
  __autoSyncNextRun?: number;
  __autoSyncEnabled?: boolean;
  __autoSyncInterval?: number; // minutes
  __autoSyncStarted?: boolean;
  __sessionCheckTimer?: ReturnType<typeof setTimeout> | null;
  __sessionCheckStarted?: boolean;
  __searchTextsTimer?: ReturnType<typeof setTimeout> | null;
  __searchTextsStarted?: boolean;
  __buyoutTimer?: ReturnType<typeof setTimeout> | null;
  __buyoutStarted?: boolean;
  __djemDailyTimer?: ReturnType<typeof setInterval> | null;
  __djemDailyStarted?: boolean;
  __djemDailyRunning?: boolean;
  __bidAutomationTimer?: ReturnType<typeof setInterval> | null;
  __bidAutomationStarted?: boolean;
  __bidAutomationRunning?: boolean;
  __testSyncTimer?: ReturnType<typeof setTimeout> | null;
  __testSyncStarted?: boolean;
  __testSyncRunning?: boolean;
  __testSyncLastRun?: number;
  __testSyncNextRun?: number;
  __testSyncEnabled?: boolean;
  __testSyncInterval?: number;
  __syncTestActive?: boolean;
  __fullstatV3Progress?: { running: boolean };
  __fullstatV3DailyProgress?: { running: boolean };
};

const TEST_SYNC_TIME_KEYS = ["gap", "backoff429", "chunkCooldown", "jitter"];

function readSettings() {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('auto_sync_enabled', 'auto_sync_interval', 'deep_sync_date', 'last_sync_time')").all() as { key: string; value: string }[];
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    return {
      enabled: map.auto_sync_enabled === "true",
      interval: Number(map.auto_sync_interval) || 15,
      deepSyncDate: map.deep_sync_date || "",
      lastSyncTime: Number(map.last_sync_time) || 0,
    };
  } catch {
    return { enabled: false, interval: 15, deepSyncDate: "", lastSyncTime: 0 };
  }
}

function readTestSyncSettings() {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT key, value
      FROM settings
      WHERE key IN ('test_sync_auto_enabled', 'test_sync_auto_interval', 'test_sync_last_run', 'test_sync_config')
    `).all() as { key: string; value: string }[];
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    return {
      enabled: map.test_sync_auto_enabled === "true",
      interval: Number(map.test_sync_auto_interval) || 10,
      lastRunTime: Number(map.test_sync_last_run) || 0,
      config: map.test_sync_config || "",
    };
  } catch {
    return { enabled: false, interval: 10, lastRunTime: 0, config: "" };
  }
}

function backgroundJobsAllowed() {
  return process.env[BACKGROUND_JOBS_DISABLE_ENV] !== "1";
}

function backgroundFeatureAllowed(envName: string) {
  return backgroundJobsAllowed() && process.env[envName] === "1";
}

function saveSetting(key: string, value: string) {
  try {
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
  } catch { /* ignore */ }
}

function internalHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Origin: BASE,
    "Sec-Fetch-Site": "same-origin",
    ...(extra || {}),
  };
  if (process.env.WB_ADS_LOCAL_TOKEN) headers["x-local-token"] = process.env.WB_ADS_LOCAL_TOKEN;
  return headers;
}

function internalJsonHeaders(extra?: Record<string, string>): Record<string, string> {
  return internalHeaders({ "Content-Type": "application/json", ...(extra || {}) });
}

function postJsonLong(url: string, body: unknown, timeoutMs: number): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const transport = u.protocol === "https:" ? https : http;
    const req = transport.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port,
      path: `${u.pathname}${u.search}`,
      method: "POST",
      headers: internalJsonHeaders({ "Content-Length": String(Buffer.byteLength(data)) }),
      timeout: timeoutMs,
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode || 0, json: raw ? JSON.parse(raw) : null });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`request timeout after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function buildAutoTestBody(configRaw: string) {
  let cfg: Record<string, unknown> = {};
  try {
    cfg = configRaw ? JSON.parse(configRaw) as Record<string, unknown> : {};
  } catch {
    cfg = {};
  }
  const endpoints: ("v3" | "v3-daily")[] = [];
  if (cfg.wantV3 !== false) endpoints.push("v3");
  if (cfg.wantV3Daily !== false) endpoints.push("v3-daily");
  if (endpoints.length === 0) endpoints.push("v3-daily");

  const rawParams = (cfg.params && typeof cfg.params === "object" ? cfg.params : {}) as Record<string, unknown>;
  const params: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawParams)) {
    const n = Number(value);
    if (Number.isFinite(n)) params[key] = TEST_SYNC_TIME_KEYS.includes(key) ? n * 1000 : n;
  }

  return {
    endpoints,
    mode: cfg.mode === "parallel" ? "parallel" : "sequential",
    params,
    onlyActiveAdvertised: true,
    source: "auto",
    v3DailyDateMode: "smart",
  };
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function runSync() {
  if (g.__autoSyncRunning) return;
  g.__autoSyncRunning = true;
  g.__autoSyncLastRun = Date.now();

  // Сбрасываем флаг отмены на случай, если он «залип» от ручного /api/sync/cancel или
  // от прерванного теста. Иначе preset-info / search-texts-all / fullstat-v3, которые
  // проверяют этот флаг в цикле, будут мгновенно ломаться с "cancelled by user".
  (globalThis as unknown as { __syncCancelled?: boolean }).__syncCancelled = false;

  console.log("[auto-sync-server] Starting sync...");

  // Check deep sync
  const settings = readSettings();
  const now = new Date();
  const today = localDateStr(now);
  const isDeep = now.getHours() >= 9 && settings.deepSyncDate !== today;
  const djemDays = isDeep ? 3 : 1;

  interface StepResult { name: string; ep: string; ok: boolean; error?: string; duration: number; retries?: number; retryable?: boolean; warnings?: unknown[] }
  const stepResults: StepResult[] = [];
  const syncStart = Date.now();

  // Хелпер: один POST к sync-endpoint'у с парсингом ответа в флаг ok/error.
  async function runOnce(ep: string): Promise<{ ok: boolean; error?: string; duration: number; retryable?: boolean; warnings?: unknown[] }> {
    const t = Date.now();
    try {
      const res = await fetch(`${BASE}${ep}`, { method: "POST", headers: internalHeaders() });
      const data = await res.json();
      const hasErrors = !res.ok || data.error || (data.errors && data.errors.length > 0);
      const error = hasErrors
        ? (data.error || (data.errors?.length ? `${data.errors.length} ошибок` : `HTTP ${res.status}`))
        : undefined;
      return {
        ok: !hasErrors,
        error,
        duration: Math.round((Date.now() - t) / 100) / 10,
        retryable: data.retryable !== false,
        warnings: Array.isArray(data.warnings) ? data.warnings : undefined,
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Ошибка", duration: Math.round((Date.now() - t) / 100) / 10 };
    }
  }

  // Open API sequential
  for (const ep of SYNC_STEPS) {
    const name = ep.split("/api/sync/")[1]?.split("?")[0] || ep;
    const r = await runOnce(ep);
    stepResults.push({ name, ep, ...r });
  }

  // Seller-tab группа (закрытый API, через Puppeteer seller-вкладку, параллельно с Open API).
  // search-texts-all имеет внутренний 6-часовой кэш — при частом вызове не дёргает WB повторно.
  const djemEndpoints = [
    { ep: "/api/sync/search-texts-all", name: "search-texts-all" },
    { ep: `/api/sync/auth-wb-funnel?days=${djemDays}`, name: "auth-wb-funnel" },
    { ep: `/api/sync/buyer-profile?days=${djemDays}`, name: "buyer-profile" },
  ];
  const djemResults = await Promise.all(djemEndpoints.map(async ({ ep, name }) => ({ name, ep, ...(await runOnce(ep)) })));
  stepResults.push(...djemResults);

  // ═══ Retry-проход для зафейленных шагов ═══
  // WB часто отдаёт 429 на /adv/v3/fullstats при первом проходе (rate-limit бакета),
  // но на повторе через 30с обычно отдаёт уже 200. Поэтому после первого прохода
  // собираем все фейлы и до 5 раз пытаемся ещё с задержкой 30с между попытками.
  // На успех — помечаем шаг как ok, в error пишем «OK on retry N» для прозрачности.
  const RETRY_MAX = 5;
  const RETRY_DELAY_MS = 30_000;
  const failed = stepResults.filter((s) => !s.ok && s.retryable !== false);
  if (failed.length > 0) {
    console.log(`[auto-sync-server] First pass: ${failed.length} failed → retrying`);
    for (const step of failed) {
      for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        console.log(`[auto-sync-server] retry ${attempt}/${RETRY_MAX}: ${step.name}`);
        const r = await runOnce(step.ep);
        step.duration = Math.round((step.duration + r.duration) * 10) / 10;
        step.retries = attempt;
        if (r.ok) {
          step.ok = true;
          step.error = `OK on retry ${attempt}`;
          break;
        }
        step.error = `retry ${attempt}/${RETRY_MAX}: ${r.error || "fail"}`;
      }
    }
  }

  // Write log
  const totalSteps = stepResults.length;
  const successSteps = stepResults.filter((s) => s.ok).length;
  const failedSteps = stepResults.filter((s) => !s.ok);
  try {
    await fetch(`${BASE}/api/sync-log`, {
      method: "POST",
      headers: internalJsonHeaders(),
      body: JSON.stringify({
        type: "server-auto",
        total: totalSteps,
        success: successSteps,
        errors: failedSteps.length,
        error_details: JSON.stringify(stepResults.map((s) => ({ name: s.name, ok: s.ok, error: s.error, duration: s.duration, retries: s.retries }))),
        duration_sec: Math.round((Date.now() - syncStart) / 100) / 10,
      }),
    });
  } catch { /* ignore */ }

  // Save timestamps
  saveSetting("last_sync_time", String(Date.now()));
  if (isDeep) saveSetting("deep_sync_date", today);

  g.__autoSyncRunning = false;
  console.log(`[auto-sync-server] Done: ${successSteps}/${totalSteps} in ${Math.round((Date.now() - syncStart) / 1000)}s`);
}

function scheduleNext() {
  const settings = readSettings();
  const allowed = backgroundFeatureAllowed(MAIN_AUTO_SYNC_ENV);
  g.__autoSyncEnabled = allowed && settings.enabled;
  g.__autoSyncInterval = settings.interval;

  if (g.__autoSyncTimer) {
    clearInterval(g.__autoSyncTimer);
    g.__autoSyncTimer = null;
  }

  if (!allowed) {
    g.__autoSyncNextRun = 0;
    console.log(`[auto-sync-server] Main auto-sync disabled by env (${BACKGROUND_JOBS_DISABLE_ENV}/${MAIN_AUTO_SYNC_ENV})`);
    return;
  }

  if (!settings.enabled) {
    g.__autoSyncNextRun = 0;
    console.log("[auto-sync-server] Disabled");
    return;
  }

  const ms = settings.interval * 60 * 1000;
  const elapsed = settings.lastSyncTime > 0 ? Date.now() - settings.lastSyncTime : ms;
  const firstDelay = Math.max(0, ms - elapsed);

  g.__autoSyncNextRun = Date.now() + firstDelay;
  console.log(`[auto-sync-server] Next sync in ${Math.round(firstDelay / 1000)}s (interval: ${settings.interval}m)`);

  // First run after remaining time
  setTimeout(() => {
    runSync();
    g.__autoSyncNextRun = Date.now() + ms;

    // Then every interval
    g.__autoSyncTimer = setInterval(() => {
      // Re-read settings in case they changed
      const s = readSettings();
      if (!s.enabled) {
        if (g.__autoSyncTimer) clearInterval(g.__autoSyncTimer);
        g.__autoSyncTimer = null;
        g.__autoSyncNextRun = 0;
        return;
      }
      g.__autoSyncNextRun = Date.now() + s.interval * 60 * 1000;
      runSync();
    }, ms);
  }, firstDelay);
}

async function runAutoTestSync(): Promise<"ran" | "busy" | "disabled"> {
  const settings = readTestSyncSettings();
  if (!backgroundFeatureAllowed(TEST_AUTO_SYNC_ENV) || !settings.enabled) return "disabled";
  if (g.__testSyncRunning || g.__autoSyncRunning || (globalThis as unknown as { __syncTestActive?: boolean }).__syncTestActive) {
    return "busy";
  }

  g.__testSyncRunning = true;
  g.__testSyncLastRun = Date.now();
  saveSetting("test_sync_last_run", String(g.__testSyncLastRun));
  try {
    const body = buildAutoTestBody(settings.config);
    console.log(`[test-sync-auto] Starting: endpoints=${body.endpoints.join(",")} interval=${settings.interval}m`);
    const res = await postJsonLong(`${BASE}/api/sync/test`, body, 30 * 60 * 1000);
    const d = res.json as { ok?: boolean; error?: string; testId?: number } | null;
    if (res.status < 200 || res.status >= 300 || !d?.ok) {
      console.warn(`[test-sync-auto] failed: ${d?.error || `HTTP ${res.status}`}`);
    } else {
      console.log(`[test-sync-auto] done: testId=${d.testId}`);
    }
  } catch (e) {
    console.warn("[test-sync-auto] failed:", e);
  } finally {
    g.__testSyncRunning = false;
  }
  return "ran";
}

function scheduleTestSync(delayOverrideMs?: number) {
  const settings = readTestSyncSettings();
  const allowed = backgroundFeatureAllowed(TEST_AUTO_SYNC_ENV);
  g.__testSyncEnabled = allowed && settings.enabled;
  g.__testSyncInterval = settings.interval;

  if (g.__testSyncTimer) {
    clearTimeout(g.__testSyncTimer);
    g.__testSyncTimer = null;
  }

  if (!allowed || !settings.enabled) {
    g.__testSyncNextRun = 0;
    return;
  }

  const ms = Math.max(1, settings.interval) * 60 * 1000;
  const elapsed = settings.lastRunTime > 0 ? Date.now() - settings.lastRunTime : ms;
  const firstDelay = delayOverrideMs ?? Math.max(0, ms - elapsed);
  g.__testSyncNextRun = Date.now() + firstDelay;
  console.log(`[test-sync-auto] Next run in ${Math.round(firstDelay / 1000)}s (interval: ${settings.interval}m)`);

  g.__testSyncTimer = setTimeout(async () => {
    const result = await runAutoTestSync();
    scheduleTestSync(result === "busy" ? 60_000 : undefined);
  }, firstDelay);
}

export function getTestSyncStatus() {
  const running = Boolean(
    g.__testSyncRunning ||
    g.__syncTestActive ||
    g.__fullstatV3Progress?.running ||
    g.__fullstatV3DailyProgress?.running,
  );
  return {
    enabled: g.__testSyncEnabled ?? false,
    backgroundJobsAllowed: backgroundJobsAllowed(),
    featureEnabled: backgroundFeatureAllowed(TEST_AUTO_SYNC_ENV),
    schedulerStarted: g.__testSyncStarted ?? false,
    interval: g.__testSyncInterval ?? 10,
    running,
    lastRun: g.__testSyncLastRun ?? readTestSyncSettings().lastRunTime,
    nextRun: g.__testSyncNextRun ?? 0,
    secondsUntilNext: g.__testSyncNextRun ? Math.max(0, Math.round((g.__testSyncNextRun - Date.now()) / 1000)) : 0,
  };
}

export function reloadTestSync() {
  if (!backgroundFeatureAllowed(TEST_AUTO_SYNC_ENV)) {
    g.__testSyncEnabled = false;
    g.__testSyncNextRun = 0;
    return;
  }
  scheduleTestSync();
}

/** Get server sync status (called by API route) */
export function getAutoSyncStatus() {
  return {
    enabled: g.__autoSyncEnabled ?? false,
    backgroundJobsAllowed: backgroundJobsAllowed(),
    featureEnabled: backgroundFeatureAllowed(MAIN_AUTO_SYNC_ENV),
    schedulerStarted: g.__autoSyncStarted ?? false,
    interval: g.__autoSyncInterval ?? 15,
    running: g.__autoSyncRunning ?? false,
    lastRun: g.__autoSyncLastRun ?? 0,
    nextRun: g.__autoSyncNextRun ?? 0,
    secondsUntilNext: g.__autoSyncNextRun ? Math.max(0, Math.round((g.__autoSyncNextRun - Date.now()) / 1000)) : 0,
  };
}

/** Reload settings and reschedule (called when user changes settings) */
export function reloadAutoSync() {
  if (!backgroundFeatureAllowed(MAIN_AUTO_SYNC_ENV)) {
    g.__autoSyncEnabled = false;
    g.__autoSyncNextRun = 0;
    return;
  }
  scheduleNext();
}

// ═══ Daily session check at 22:00 MSK ═══
// Pings WB via Puppeteer, updates accounts.connection. If session is dead,
// users see "Нет соединения" in the Settings panel next morning.

function msUntilNext22() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(22, 0, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

async function runSessionCheck() {
  try {
    const res = await fetch(`${BASE}/api/accounts/check-session`, { method: "POST", headers: internalHeaders() });
    const d = await res.json();
    console.log(`[session-check] alive=${d.alive} status=${d.status} connection=${d.connection}`);
  } catch (e) {
    console.warn("[session-check] failed:", e);
  }
}

function scheduleSessionCheck() {
  if (!backgroundFeatureAllowed(SESSION_CHECK_ENV)) return;
  if (g.__sessionCheckTimer) clearTimeout(g.__sessionCheckTimer);
  const delay = msUntilNext22();
  const fireAt = new Date(Date.now() + delay).toLocaleString("ru-RU");
  console.log(`[session-check] next run at ${fireAt} (in ${Math.round(delay / 60000)} min)`);
  g.__sessionCheckTimer = setTimeout(() => {
    runSessionCheck().finally(() => scheduleSessionCheck());
  }, delay);
}

// ═══ Daily WB search-texts snapshot at 06:00 MSK ═══
// Собираем частотность поисковых запросов WB за вчера для всех subject_id активных кампаний.
// Полученный snapshot используется в UI (колонка ~👁 во вкладке «Запросы») для всех кампаний
// и всех типов фраз — глобальный text-match по lower(phrase).

function msUntilNext6() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(6, 0, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

async function runSearchTextsSync() {
  try {
    const res = await fetch(`${BASE}/api/sync/search-texts-all?interval=yesterday&force=1`, { method: "POST", headers: internalHeaders() });
    const d = await res.json();
    console.log(`[search-texts-sync] subjects=${d.subjects} totalCollected=${d.totalCollected} ok=${d.ok}`);
  } catch (e) {
    console.warn("[search-texts-sync] failed:", e);
  }
}

function scheduleSearchTextsSync() {
  if (!backgroundFeatureAllowed(DAILY_SEARCH_TEXTS_ENV)) return;
  if (g.__searchTextsTimer) clearTimeout(g.__searchTextsTimer);
  const delay = msUntilNext6();
  const fireAt = new Date(Date.now() + delay).toLocaleString("ru-RU");
  console.log(`[search-texts-sync] next run at ${fireAt} (in ${Math.round(delay / 60000)} min)`);
  g.__searchTextsTimer = setTimeout(() => {
    runSearchTextsSync().finally(() => scheduleSearchTextsSync());
  }, delay);
}

// ═══ Daily buyout-percent snapshot at 06:30 MSK ═══
// 30-дневный % выкупа по всем активным nm_id. Используется для расчёта ДРРп и CPS
// во вкладке «Карточки» → «Воронка продаж» (DetailPanel). Окно 30д почти не меняется
// за сутки, поэтому в общем SYNC_STEPS не нужен — отдельный тик раз в день.

function msUntilNext630() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(6, 30, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

async function runBuyoutSync() {
  try {
    const res = await fetch(`${BASE}/api/sync/buyout-percent`, { method: "POST", headers: internalHeaders() });
    const d = await res.json();
    console.log(`[buyout-sync] requested=${d.requested} updated=${d.updated} 429=${d.total_429}`);
  } catch (e) {
    console.warn("[buyout-sync] failed:", e);
  }
}

function scheduleBuyoutSync() {
  if (!backgroundFeatureAllowed(DAILY_BUYOUT_ENV)) return;
  if (g.__buyoutTimer) clearTimeout(g.__buyoutTimer);
  const delay = msUntilNext630();
  const fireAt = new Date(Date.now() + delay).toLocaleString("ru-RU");
  console.log(`[buyout-sync] next run at ${fireAt} (in ${Math.round(delay / 60000)} min)`);
  g.__buyoutTimer = setTimeout(() => {
    runBuyoutSync().finally(() => scheduleBuyoutSync());
  }, delay);
}

// ═══ Djem-daily heal — каждые 60 минут ═══
// Серийно проходит по всем активным nmId кабинета, вызывает phrase-djem-daily?mode=auto.
// Endpoint сам знает: если данных нет — bootstrap 90 дней; если есть, но с дырами —
// догружает недостающие; today всегда обновляется; yesterday пересинкается после 09:00 MSK,
// если его updated_at — до сегодняшних 09:00 (чтобы подхватить поздние апдейты WB).

const DJEM_DAILY_INTERVAL_MS = 60 * 60 * 1000; // 60 мин

function getActiveNmIds(): number[] {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT nms_json FROM campaigns WHERE status IN (9, 11) AND nms_json IS NOT NULL AND nms_json != '[]'",
    ).all() as { nms_json: string }[];
    const set = new Set<number>();
    for (const r of rows) {
      try {
        const arr = JSON.parse(r.nms_json);
        if (Array.isArray(arr)) for (const n of arr) {
          const nm = Number(n);
          if (nm > 0) set.add(nm);
        }
      } catch { /* */ }
    }
    return Array.from(set);
  } catch {
    return [];
  }
}

async function runDjemDailyTick() {
  if (g.__djemDailyRunning) return;
  g.__djemDailyRunning = true;
  const t0 = Date.now();
  try {
    const nmIds = getActiveNmIds();
    console.log(`[djem-daily] tick: ${nmIds.length} active nmIds`);
    let ok = 0, skipped = 0, err = 0;
    for (const nmId of nmIds) {
      try {
        const res = await fetch(`${BASE}/api/sync/phrase-djem-daily?nmId=${nmId}&mode=auto`, { method: "POST", headers: internalHeaders() });
        const d = await res.json();
        if (d?.ok) {
          if (d.skipped) skipped++; else ok++;
        } else {
          err++;
        }
      } catch {
        err++;
      }
      // serial — Puppeteer page one per process
    }
    console.log(`[djem-daily] done in ${Math.round((Date.now() - t0) / 1000)}s: ok=${ok} skipped=${skipped} err=${err}`);
  } finally {
    g.__djemDailyRunning = false;
  }
}

function scheduleDjemDaily() {
  if (!backgroundFeatureAllowed(DJEM_DAILY_ENV)) return;
  // Первый запуск — через 30с после старта (даёт сессии WB подняться), потом каждые 30 мин.
  setTimeout(() => {
    runDjemDailyTick();
    g.__djemDailyTimer = setInterval(() => { runDjemDailyTick(); }, DJEM_DAILY_INTERVAL_MS);
  }, 30_000);
}

// ═══ Bid automation dispatcher — каждую минуту берёт due-правила ═══

const BID_AUTOMATION_TICK_MS = 60 * 1000;

async function runBidAutomationTick() {
  if (g.__bidAutomationRunning) return;
  g.__bidAutomationRunning = true;
  try {
    const res = await fetch(`${BASE}/api/bid-automation/run`, {
      method: "POST",
      headers: internalJsonHeaders(),
      body: JSON.stringify({ limit: 25 }),
    });
    const d = await res.json().catch(() => null) as { ok?: boolean; checked?: number; error?: string } | null;
    if (!res.ok || !d?.ok) {
      console.warn(`[bid-auto] failed: ${d?.error || `HTTP ${res.status}`}`);
    } else if (d.checked && d.checked > 0) {
      console.log(`[bid-auto] checked=${d.checked}`);
    }
  } catch (e) {
    console.warn("[bid-auto] failed:", e);
  } finally {
    g.__bidAutomationRunning = false;
  }
}

function scheduleBidAutomation() {
  if (!backgroundFeatureAllowed(BID_AUTOMATION_ENV)) return;
  if (g.__bidAutomationTimer) clearInterval(g.__bidAutomationTimer);
  setTimeout(() => { runBidAutomationTick(); }, 45_000);
  g.__bidAutomationTimer = setInterval(() => { runBidAutomationTick(); }, BID_AUTOMATION_TICK_MS);
}

/** Start the server-side auto-sync (called once on startup) */
export function startAutoSyncServer() {
  if (!g.__autoSyncStarted) {
    g.__autoSyncStarted = true;
    console.log("[auto-sync-server] Initializing...");
    scheduleNext();
  }

  if (!g.__sessionCheckStarted) {
    g.__sessionCheckStarted = true;
    scheduleSessionCheck();
  }

  if (!g.__searchTextsStarted) {
    g.__searchTextsStarted = true;
    scheduleSearchTextsSync();
  }

  if (!g.__buyoutStarted) {
    g.__buyoutStarted = true;
    scheduleBuyoutSync();
  }

  if (!g.__djemDailyStarted) {
    g.__djemDailyStarted = true;
    scheduleDjemDaily();
  }

  if (!g.__bidAutomationStarted) {
    g.__bidAutomationStarted = true;
    scheduleBidAutomation();
  }

  if (!g.__testSyncStarted) {
    g.__testSyncStarted = true;
    scheduleTestSync();
  }
}
