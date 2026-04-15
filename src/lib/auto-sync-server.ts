/**
 * Server-side auto-sync manager.
 * Runs setInterval on Node.js — works even when browser tab is inactive.
 * Settings (enabled, interval) read from DB.
 */
import { getDb } from "./db";

const BASE = "http://localhost:3001";

const SYNC_STEPS = [
  "/api/sync/campaigns",
  "/api/sync/products",
  "/api/sync/stocks",
  "/api/sync/stats",
  "/api/sync/balance",
  "/api/sync/clusters",
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
};

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

function saveSetting(key: string, value: string) {
  try {
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
  } catch { /* ignore */ }
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function runSync() {
  if (g.__autoSyncRunning) return;
  g.__autoSyncRunning = true;
  g.__autoSyncLastRun = Date.now();

  console.log("[auto-sync-server] Starting sync...");

  // Check deep sync
  const settings = readSettings();
  const now = new Date();
  const today = localDateStr(now);
  const isDeep = now.getHours() >= 9 && settings.deepSyncDate !== today;
  const djemDays = isDeep ? 3 : 1;

  interface StepResult { name: string; ok: boolean; error?: string; duration: number }
  const stepResults: StepResult[] = [];
  const syncStart = Date.now();

  // Open API sequential
  for (const ep of SYNC_STEPS) {
    const name = ep.split("/api/sync/")[1]?.split("?")[0] || ep;
    const t = Date.now();
    try {
      const res = await fetch(`${BASE}${ep}`, { method: "POST" });
      const data = await res.json();
      const hasErrors = !res.ok || data.error || (data.errors && data.errors.length > 0);
      stepResults.push({ name, ok: !hasErrors, error: hasErrors ? (data.error || (data.errors?.length ? `${data.errors.length} ошибок` : `HTTP ${res.status}`)) : undefined, duration: Math.round((Date.now() - t) / 100) / 10 });
    } catch (e) {
      stepResults.push({ name, ok: false, error: e instanceof Error ? e.message : "Ошибка", duration: Math.round((Date.now() - t) / 100) / 10 });
    }
  }

  // Djem parallel
  const djemEndpoints = [
    { ep: `/api/sync/auth-wb-funnel?days=${djemDays}`, name: "auth-wb-funnel" },
    { ep: `/api/sync/buyer-profile?days=${djemDays}`, name: "buyer-profile" },
  ];
  await Promise.all(djemEndpoints.map(async ({ ep, name }) => {
    const t = Date.now();
    try {
      const res = await fetch(`${BASE}${ep}`, { method: "POST" });
      const data = await res.json();
      const ok = res.ok && !data.error && (!data.errors || data.errors.length === 0);
      stepResults.push({ name, ok, error: ok ? undefined : (data.error || `${data.errors?.length || 0} ошибок`), duration: Math.round((Date.now() - t) / 100) / 10 });
    } catch (e) {
      stepResults.push({ name, ok: false, error: e instanceof Error ? e.message : "Ошибка", duration: Math.round((Date.now() - t) / 100) / 10 });
    }
  }));

  // Write log
  const totalSteps = stepResults.length;
  const successSteps = stepResults.filter((s) => s.ok).length;
  const failedSteps = stepResults.filter((s) => !s.ok);
  try {
    await fetch(`${BASE}/api/sync-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "server-auto",
        total: totalSteps,
        success: successSteps,
        errors: failedSteps.length,
        error_details: JSON.stringify(stepResults.map((s) => ({ name: s.name, ok: s.ok, error: s.error, duration: s.duration }))),
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
  g.__autoSyncEnabled = settings.enabled;
  g.__autoSyncInterval = settings.interval;

  if (g.__autoSyncTimer) {
    clearInterval(g.__autoSyncTimer);
    g.__autoSyncTimer = null;
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

/** Get server sync status (called by API route) */
export function getAutoSyncStatus() {
  return {
    enabled: g.__autoSyncEnabled ?? false,
    interval: g.__autoSyncInterval ?? 15,
    running: g.__autoSyncRunning ?? false,
    lastRun: g.__autoSyncLastRun ?? 0,
    nextRun: g.__autoSyncNextRun ?? 0,
    secondsUntilNext: g.__autoSyncNextRun ? Math.max(0, Math.round((g.__autoSyncNextRun - Date.now()) / 1000)) : 0,
  };
}

/** Reload settings and reschedule (called when user changes settings) */
export function reloadAutoSync() {
  scheduleNext();
}

/** Start the server-side auto-sync (called once on startup) */
export function startAutoSyncServer() {
  if (g.__autoSyncStarted) return;
  g.__autoSyncStarted = true;
  console.log("[auto-sync-server] Initializing...");
  scheduleNext();
}
