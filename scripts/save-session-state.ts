import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, "data", "ads.db");
const OUT_PATH = path.join(ROOT, "SESSION_STATE.md");
const BASE_URL = process.env.WB_ADS_INTERNAL_BASE_URL || "http://127.0.0.1:3001";

type SettingRow = { key: string; value: string };
type TestRow = {
  id: number;
  started_at: string;
  finished_at: string | null;
  endpoints: string;
  total_requests: number;
  total_ok: number;
  total_429: number;
  total_err: number;
  duration_ms: number | null;
  config_json: string | null;
};
type DailyRows = { date: string; rows: number; campaigns: number; last_updated: string | null };

function moscowParts(d = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

function mskDateOffset(daysBack: number): string {
  return moscowParts(new Date(Date.now() - daysBack * 86400000)).date;
}

function sqliteUtcToMsk(value: string | null | undefined): string {
  if (!value) return "-";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(`${normalized.endsWith("Z") ? normalized.slice(0, -1) : normalized}Z`);
  if (Number.isNaN(date.getTime())) return value;
  const parts = moscowParts(date);
  return `${parts.date} ${parts.time} MSK`;
}

function isoToMsk(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = moscowParts(date);
  return `${parts.date} ${parts.time} MSK`;
}

function duration(ms: number | null): string {
  if (!ms) return "-";
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${String(sec).padStart(2, "0")}s`;
}

function safeJson(raw: string | null | undefined): Record<string, unknown> {
  try {
    return raw ? JSON.parse(raw) as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function fetchJson(pathname: string): Promise<Record<string, unknown> | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 1500);
  try {
    const res = await fetch(`${BASE_URL}${pathname}`, { signal: ac.signal });
    if (!res.ok) return null;
    return await res.json() as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function setting(map: Map<string, string>, key: string): string {
  return map.get(key) || "";
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`DB not found: ${DB_PATH}`);
  }

  const db = new Database(DB_PATH, { readonly: true });
  db.pragma("busy_timeout = 5000");

  const settingsRows = db.prepare(`
    SELECT key, value
    FROM settings
    WHERE key LIKE 'fullstat_v3_daily%'
       OR key LIKE 'test_sync_auto%'
       OR key LIKE 'test_sync_last_run'
    ORDER BY key
  `).all() as SettingRow[];
  const settings = new Map(settingsRows.map((row) => [row.key, row.value]));

  const latestTests = db.prepare(`
    SELECT id, started_at, finished_at, endpoints, total_requests, total_ok, total_429, total_err, duration_ms, config_json
    FROM sync_test_log
    ORDER BY id DESC
    LIMIT 5
  `).all() as TestRow[];

  const today = mskDateOffset(0);
  const yesterday = mskDateOffset(1);
  const dailyRows = db.prepare(`
    SELECT date, COUNT(*) rows, COUNT(DISTINCT advert_id) campaigns, MAX(updated_at) last_updated
    FROM campaign_nm_daily
    WHERE date IN (?, ?)
    GROUP BY date
    ORDER BY date
  `).all(yesterday, today) as DailyRows[];

  const testAuto = await fetchJson("/api/sync/test-auto");
  const v3 = await fetchJson("/api/sync/fullstat-v3");
  const v3Daily = await fetchJson("/api/sync/fullstat-v3-daily");

  const now = moscowParts();
  const latest = latestTests[0];
  const latestCfg = safeJson(latest?.config_json);
  const yesterdaySyncedDate = setting(settings, "fullstat_v3_daily_yesterday_synced_date") || "-";
  const yesterdaySyncedAt = setting(settings, "fullstat_v3_daily_yesterday_synced_at");
  const yesterdayCursorDate = setting(settings, "fullstat_v3_daily_yesterday_cursor_date") || "-";
  const yesterdayCursorAdvertId = setting(settings, "fullstat_v3_daily_yesterday_cursor_advert_id") || "-";
  const autoEnabled = setting(settings, "test_sync_auto_enabled") || "false";
  const autoInterval = setting(settings, "test_sync_auto_interval") || "-";
  const dailyByDate = new Map(dailyRows.map((row) => [row.date, row]));

  const runtimeLines = testAuto
    ? [
        `- Test-auto status: enabled=${String(testAuto.enabled)}, running=${String(testAuto.running)}, interval=${String(testAuto.interval)} min, next in ${String(testAuto.secondsUntilNext)} sec.`,
        `- fullstat-v3 progress: running=${String(v3?.running ?? "unknown")}, current=${String(v3?.current ?? "-")}/${String(v3?.total ?? "-")}, ok=${String(v3?.ok ?? "-")}, err=${String(v3?.err ?? "-")}.`,
        `- fullstat-v3-daily progress: running=${String(v3Daily?.running ?? "unknown")}, current=${String(v3Daily?.current ?? "-")}/${String(v3Daily?.total ?? "-")}, ok=${String(v3Daily?.ok ?? "-")}, err=${String(v3Daily?.err ?? "-")}.`,
      ]
    : [
        `- Dev server status endpoints were not reachable at ${BASE_URL}; verify runtime after starting dev server.`,
      ];

  const testLines = latestTests.map((test) => {
    const cfg = safeJson(test.config_json);
    const mode = cfg.v3DailyDateMode ? `, v3DailyDateMode=${String(cfg.v3DailyDateMode)}` : "";
    return `- #${test.id}: ${sqliteUtcToMsk(test.started_at)} -> ${sqliteUtcToMsk(test.finished_at)}, ${test.endpoints}, ok=${test.total_ok}/${test.total_requests}, 429=${test.total_429}, errors=${test.total_err}, duration=${duration(test.duration_ms)}${mode}`;
  });

  const campaignRows = [yesterday, today].map((date) => {
    const row = dailyByDate.get(date);
    if (!row) return `- ${date}: no rows in campaign_nm_daily.`;
    return `- ${date}: ${row.rows} rows, ${row.campaigns} campaigns, last_updated=${sqliteUtcToMsk(row.last_updated)}.`;
  });

  const contents = `# WB Ads — Session State

Updated: ${now.date} ${now.time} MSK

Purpose: short starting map for a new session. This file is generated by \`npm run save-session-state\`. It is not the source of truth. Always verify with code and \`data/ads.db\`, then use detailed context files for explanations.

## Read First

1. \`CLAUDE.md\` — project rules, safety rules, memory workflow.
2. \`SESSION_STATE.md\` — current state and where to continue.
3. \`PROJECT_CONTEXT.md\` — detailed architecture and WB API notes.
4. \`TODO.md\` — backlog and completed session notes.
5. \`src/components/KnowledgeBase.tsx\` — UI knowledge base.
6. \`~/.codex/memories/\` — long-term Codex notes, especially \`moscow-time.md\` and \`wb-ads-current-context.md\`.

## Project

- Workspace: \`/Users/octopus/Projects/wb-ads\`
- Stack: Next.js 16, TypeScript, Tailwind CSS 4, SQLite (\`better-sqlite3\`), Puppeteer.
- Dev URL: \`http://127.0.0.1:3001\`
- DB: \`data/ads.db\`
- Chrome profile: \`data/chrome-profile/\`
- Main domain: Wildberries ads dashboard and automation.

## Hard Rules

- Use Moscow time (\`Europe/Moscow\`) in user-facing explanations and logs unless explicitly asked otherwise.
- Do not call mutating WB/cmp APIs without explicit user permission. Writing code for them is allowed; testing mutations needs a separate "yes".
- Do not rely on memory alone. Read files and verify DB/code before conclusions.
- Do not touch other projects, especially \`/Users/octopus/Projects/website/\`, without explicit permission.

## Current Focus

Latest implemented logic: Test-auto and \`fullstat-v3-daily\` smart dates.

- Manual TestSyncModal uses the visible \`days\` setting literally. If \`days=2\`, manual \`v3-daily\` pulls today + yesterday.
- Test-auto uses endpoints and delay settings from TestSyncModal, but passes \`v3DailyDateMode:"smart"\` for \`v3-daily\`.
- Smart \`v3-daily\` pulls today every run.
- Smart \`v3-daily\` pulls yesterday only after 09:00 MSK until yesterday is successfully closed.
- Success marker: \`settings.fullstat_v3_daily_yesterday_synced_date\`.
- On 429/error in smart mode, the endpoint fast-fails without waiting through the 20-minute \`backoff429\`, leaves the success marker unset, stores a yesterday cursor, and the next scheduled run resumes yesterday from that advert_id.

## Verified DB State

As of ${now.date} ${now.time} MSK:

- \`test_sync_auto_enabled = ${autoEnabled}\`
- \`test_sync_auto_interval = ${autoInterval}\`
- \`fullstat_v3_daily_yesterday_synced_date = ${yesterdaySyncedDate}\`
- \`fullstat_v3_daily_yesterday_synced_at = ${yesterdaySyncedAt || "-"}\` (${isoToMsk(yesterdaySyncedAt)})
- \`fullstat_v3_daily_yesterday_cursor_date = ${yesterdayCursorDate}\`
- \`fullstat_v3_daily_yesterday_cursor_advert_id = ${yesterdayCursorAdvertId}\`
- Latest test log: #${latest?.id ?? "-"} ${latest ? `${sqliteUtcToMsk(latest.started_at)} -> ${sqliteUtcToMsk(latest.finished_at)}, ${latest.total_ok}/${latest.total_requests} ok, 429=${latest.total_429}, errors=${latest.total_err}, duration=${duration(latest.duration_ms)}` : "none"}.
- Latest test config: source=${String(latestCfg.source ?? "-")}, v3DailyDateMode=${String(latestCfg.v3DailyDateMode ?? "-")}, hotCount=${String(latestCfg.hotCount ?? "-")}, days=${String(latestCfg.days ?? "-")}.

## Daily Data Snapshot

${campaignRows.join("\n")}

## Current Runtime

${runtimeLines.join("\n")}

## Recent Test Logs

${testLines.join("\n")}

## Continue From Here

- Normal next task: decide final long-term placement of \`fullstat-v3\` and \`fullstat-v3-daily\`: keep them only in separate \`test-auto\`, or return part of them to main \`SYNC_STEPS\` without duplicate WB calls and with 429-safe scheduling.
- If investigating sync status, first check \`/api/sync/test-auto\`, \`/api/sync/fullstat-v3\`, \`/api/sync/fullstat-v3-daily\`, then \`sync_test_log\` and \`settings\`.
- Service rows \`#816-#818\` were interrupted diagnostic rows during implementation; do not treat them as normal production failures.
`;

  fs.writeFileSync(OUT_PATH, contents);
  db.close();
  console.log(`Updated ${path.relative(ROOT, OUT_PATH)} at ${now.date} ${now.time} MSK`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
