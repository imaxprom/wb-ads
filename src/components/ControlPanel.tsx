"use client";

import { useState, useEffect, useRef } from "react";
import KnowledgeBase from "./KnowledgeBase";
import TestSyncModal from "./TestSyncModal";

const THEMES = [
  { key: "violet", label: "Violet", color: "#6c5ce7" },
  { key: "arctic", label: "Arctic", color: "#56d4c8" },
  { key: "neon", label: "Neon", color: "#a3e635" },
];

const INTERVALS = [
  { label: "5 мин", value: 5 },
  { label: "10 мин", value: 10 },
  { label: "15 мин", value: 15 },
  { label: "20 мин", value: 20 },
  { label: "30 мин", value: 30 },
  { label: "60 мин", value: 60 },
];

const TEST_LOG_ACK_KEY = "test_log_ack_error_id";
const SYNC_LOG_ACK_KEY = "sync_log_ack_error_id";
const TEST_LOG_WINDOW_HOURS = 24;

interface Settings {
  theme: string;
  auto_sync_enabled: boolean;
  auto_sync_interval: number;
  col_widths: string;
  col_order: string;
  test_log_ack_error_id?: string;
  sync_log_ack_error_id?: string;
}

interface TestLogRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  endpoints: string;
  mode: string;
  total_requests: number;
  total_ok: number;
  total_429: number;
  total_err: number;
  first_429_at_step: number | null;
  duration_ms: number | null;
  config_json: string;
  timeline_json?: string | null;
}

interface TestTimelineEvent {
  step?: number;
  ts_rel_ms?: number;
  advert_id?: number;
  endpoint?: string;
  status?: number | string;
  duration_ms?: number;
  error?: string;
  date?: string;
  nm_id?: number;
  product_name?: string;
  kind?: "request" | "card" | "phase";
}

interface SyncLogRow {
  id: number;
  type: string;
  started_at: string;
  total: number;
  success: number;
  errors: number;
  error_details: string | null;
  duration_sec: number;
}

async function loadSettings(): Promise<Settings> {
  const res = await fetch("/api/settings");
  const raw = await res.json();
  return {
    theme: raw.theme || "violet",
    auto_sync_enabled: raw.auto_sync_enabled === "true",
    auto_sync_interval: Number(raw.auto_sync_interval) || 15,
    col_widths: raw.col_widths || "{}",
    col_order: raw.col_order || "[]",
  };
}

async function saveSetting(key: string, value: string) {
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [key]: value }),
  });
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function testStatusClass(status: unknown): string {
  if (status === 200 || status === "ok") return "text-[var(--success)]";
  if (status === 429 || status === "missing") return "text-[var(--warning)]";
  if (status === "filtered") return "text-[var(--text-muted)]";
  return "text-[var(--danger)]";
}

function testStatusLabel(status: unknown): string {
  if (status === 200 || status === "ok") return "ok";
  if (status === "missing") return "нет данных";
  if (status === "filtered") return "отфильтр.";
  return String(status ?? "—");
}

function parseUtcSqliteTimestamp(value: string): Date | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(`${normalized.endsWith("Z") ? normalized.slice(0, -1) : normalized}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatMoscowTime(value: string): string {
  const date = parseUtcSqliteTimestamp(value);
  if (!date) return value.slice(11, 16) || value.slice(-8, -3) || value;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function latestTestProblemId(rows: TestLogRow[]): number {
  return rows.reduce((latest, row) => {
    const hasProblem = Boolean(row.finished_at) && (row.total_err > 0 || row.total_429 > 0);
    return hasProblem ? Math.max(latest, row.id) : latest;
  }, 0);
}

function latestSyncProblemId(rows: SyncLogRow[]): number {
  return rows.reduce((latest, row) => (
    row.errors > 0 ? Math.max(latest, row.id) : latest
  ), 0);
}

export default function ControlPanel({
  onSyncComplete,
  onSyncManual,
}: {
  onSyncComplete: () => void;
  onSyncManual: () => void;
}) {
  const [testOpen, setTestOpen] = useState(false);
  const [theme, setTheme] = useState("violet");
  const [themeOpen, setThemeOpen] = useState(false);
  const [kbOpen, setKbOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logEntries, setLogEntries] = useState<SyncLogRow[]>([]);
  const [expandedLog, setExpandedLog] = useState<Set<number>>(new Set());
  const [hasErrors, setHasErrors] = useState(false);
  const [testLogOpen, setTestLogOpen] = useState(false);
  const [testLogEntries, setTestLogEntries] = useState<TestLogRow[]>([]);
  const [expandedTestLog, setExpandedTestLog] = useState<number | null>(null);
  const [expandedTestData, setExpandedTestData] = useState<TestLogRow | null>(null);
  const [hasTestErrors, setHasTestErrors] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoJobsAllowed, setAutoJobsAllowed] = useState(true);
  const [interval, setInterval_] = useState(15);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [nextIn, setNextIn] = useState<number | null>(null);
  const [testAutoEnabled, setTestAutoEnabled] = useState(false);
  const [testAutoInterval, setTestAutoInterval] = useState(10);
  const [testAutoRunning, setTestAutoRunning] = useState(false);
  const [testNextIn, setTestNextIn] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const lastRunRef = useRef<number>(0);
  const testLastRunRef = useRef<number>(0);
  const testAckedErrorIdRef = useRef<number>(0);
  const syncAckedErrorIdRef = useRef<number>(0);

  // Load settings and status on mount.
  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((raw) => {
      const t = raw.theme || "violet";
      setTheme(t);
      document.documentElement.setAttribute("data-theme", t);
      setInterval_(Number(raw.auto_sync_interval) || 15);
      setAutoEnabled(raw.auto_sync_enabled === "true");
      setTestAutoInterval(Number(raw.test_sync_auto_interval) || 10);
      setTestAutoEnabled(raw.test_sync_auto_enabled === "true");
      testAckedErrorIdRef.current = Number(raw[TEST_LOG_ACK_KEY] || "0") || 0;
      syncAckedErrorIdRef.current = Number(raw[SYNC_LOG_ACK_KEY] || "0") || 0;
      fetch("/api/sync-log").then((r) => r.json()).then((d) => {
        updateSyncErrorState((d.logs || []) as SyncLogRow[]);
      }).catch(() => {});
      loadTestLogs(false).catch(() => {});
    }).catch(() => {});

    fetch("/api/auto-sync").then((r) => r.json()).then((data) => {
      setAutoJobsAllowed(data.backgroundJobsAllowed !== false);
    }).catch(() => {});
    fetch("/api/sync/test-auto").then((r) => r.json()).then((data) => {
      setTestAutoRunning(data.running);
      setTestNextIn(data.enabled ? data.secondsUntilNext : null);
    }).catch(() => {});

  }, []);

  // Poll server auto-sync status every 2 seconds for countdown
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/auto-sync");
        const data = await res.json();
        const jobsAllowed = data.backgroundJobsAllowed !== false;
        setAutoJobsAllowed(jobsAllowed);
        if (!jobsAllowed) {
          setAutoSyncing(false);
          setNextIn(null);
          return;
        }
        setAutoSyncing(data.running);
        if (data.enabled) {
          setNextIn(data.secondsUntilNext);
        } else {
          setNextIn(null);
        }
        // Detect when server sync completes — refresh data silently
        if (data.lastRun > 0 && data.lastRun !== lastRunRef.current && !data.running) {
          if (lastRunRef.current > 0) {
            // Sync just finished — refresh dashboard data
            onSyncComplete();
            fetch("/api/sync-log").then((r) => r.json()).then((d) => {
              updateSyncErrorState((d.logs || []) as SyncLogRow[]);
            }).catch(() => {});
          }
          lastRunRef.current = data.lastRun;
        }
        const testRes = await fetch("/api/sync/test-auto");
        const testData = await testRes.json();
        setTestAutoRunning(testData.running);
        setTestNextIn(testData.enabled ? testData.secondsUntilNext : null);
        if (testData.lastRun > 0 && testData.lastRun !== testLastRunRef.current && !testData.running) {
          if (testLastRunRef.current > 0) {
            loadTestLogs(false).catch(() => {});
          }
          testLastRunRef.current = testData.lastRun;
        }
      } catch { /* ignore */ }
    }, 2000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleTheme(key: string) {
    setTheme(key);
    document.documentElement.setAttribute("data-theme", key);
    saveSetting("theme", key);
    setThemeOpen(false);
  }

  function handleAutoToggle(enabled: boolean) {
    if (!autoJobsAllowed) return;
    setAutoEnabled(enabled);
    saveSetting("auto_sync_enabled", String(enabled));
    // Notify server to reload settings
    fetch("/api/auto-sync", { method: "POST" }).catch(() => {});
  }

  function handleIntervalChange(val: number) {
    if (!autoJobsAllowed) return;
    setInterval_(val);
    saveSetting("auto_sync_interval", String(val));
    // Notify server to reload settings
    fetch("/api/auto-sync", { method: "POST" }).catch(() => {});
  }

  async function handleTestAutoToggle(enabled: boolean) {
    if (!autoJobsAllowed) return;
    setTestAutoEnabled(enabled);
    await saveSetting("test_sync_auto_enabled", String(enabled)).catch(() => {});
    fetch("/api/sync/test-auto", { method: "POST" }).catch(() => {});
  }

  async function handleTestIntervalChange(val: number) {
    if (!autoJobsAllowed) return;
    setTestAutoInterval(val);
    await saveSetting("test_sync_auto_interval", String(val)).catch(() => {});
    fetch("/api/sync/test-auto", { method: "POST" }).catch(() => {});
  }

  function formatCountdown(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function updateTestErrorState(rows: TestLogRow[], acknowledge = false) {
    const latestProblem = latestTestProblemId(rows);
    if (acknowledge && latestProblem > 0) {
      testAckedErrorIdRef.current = latestProblem;
      saveSetting(TEST_LOG_ACK_KEY, String(latestProblem)).catch(() => {});
      setHasTestErrors(false);
      return;
    }
    setHasTestErrors(latestProblem > testAckedErrorIdRef.current);
  }

  function updateSyncErrorState(rows: SyncLogRow[], acknowledge = false) {
    const latestProblem = latestSyncProblemId(rows);
    if (acknowledge && latestProblem > 0) {
      syncAckedErrorIdRef.current = latestProblem;
      saveSetting(SYNC_LOG_ACK_KEY, String(latestProblem)).catch(() => {});
      setHasErrors(false);
      return;
    }
    setHasErrors(latestProblem > syncAckedErrorIdRef.current);
  }

  async function loadTestLogs(openPanel = true, acknowledge = false) {
    const res = await fetch(`/api/sync/test?hours=${TEST_LOG_WINDOW_HOURS}&limit=200`);
    const d = await res.json();
    const rows = (d.tests || []) as TestLogRow[];
    setTestLogEntries(rows);
    updateTestErrorState(rows, acknowledge);
    if (openPanel) setTestLogOpen(true);
  }

  async function toggleTestLog(id: number) {
    if (expandedTestLog === id) {
      setExpandedTestLog(null);
      setExpandedTestData(null);
      return;
    }
    setExpandedTestLog(id);
    try {
      const res = await fetch(`/api/sync/test?id=${id}`);
      const d = await res.json();
      if (d.ok) setExpandedTestData(d.test);
    } catch {
      setExpandedTestData(null);
    }
  }

  return (
    <div className="fixed top-3 right-3 z-50 flex items-center gap-2">
      {/* Sync button */}
      <button
        onClick={onSyncManual}
        className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] transition-colors"
        title="Синхронизация"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
          <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
        </svg>
      </button>

      {/* Test button — для подбора параметров под WB 429 */}
      <button
        onClick={() => setTestOpen(true)}
        className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] transition-colors text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text)]"
        title="Тест cmp-endpoints с настраиваемыми паузами"
      >
        Тест
      </button>

      {/* Auto test controls — отдельное расписание, параметры берутся из модалки «Тест». */}
      <div
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-xs ${autoJobsAllowed ? "" : "opacity-60"}`}
        title={autoJobsAllowed ? "Автотест использует сохранённые настройки модалки «Тест»: сегодня тянет каждый запуск, вчера — после 09:00 МСК до первого успешного обновления" : "Фоновые задания отключены через WB_ADS_DISABLE_BACKGROUND_JOBS=1"}
      >
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={autoJobsAllowed && testAutoEnabled}
            disabled={!autoJobsAllowed}
            onChange={(e) => handleTestAutoToggle(e.target.checked)}
            className="accent-[var(--accent)] w-3 h-3"
          />
          <span className="text-[var(--text-muted)]">тест авто</span>
        </label>
        <select
          value={testAutoInterval}
          disabled={!autoJobsAllowed}
          onChange={(e) => handleTestIntervalChange(Number(e.target.value))}
          className="bg-transparent text-[var(--text)] text-xs outline-none cursor-pointer disabled:cursor-not-allowed"
        >
          {INTERVALS.map((i) => (
            <option key={i.value} value={i.value} className="bg-[var(--bg-card)]">
              {i.label}
            </option>
          ))}
        </select>
        {autoJobsAllowed && testAutoEnabled && testNextIn != null && (
          <span className={`text-[10px] min-w-[2.5rem] text-right ${testAutoRunning ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}>
            {testAutoRunning ? "test..." : formatCountdown(testNextIn)}
          </span>
        )}
      </div>

      {/* Test log button */}
      <button
        onClick={async () => {
          if (testLogOpen) { setTestLogOpen(false); return; }
          try { await loadTestLogs(true, true); } catch { setTestLogOpen(true); }
        }}
        className={
          "p-1.5 rounded-lg border transition-colors " +
          (hasTestErrors
            ? "border-[var(--danger)] bg-[var(--danger)]/10 hover:bg-[var(--danger)]/20"
            : "border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)]")
        }
        title="Журнал тестов"
      >
        <svg className={"w-4 h-4 " + (hasTestErrors ? "text-[var(--danger)]" : "")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        </svg>
      </button>

      {/* Test log panel */}
      {testLogOpen && (
        <div className="absolute top-full right-0 mt-2 w-[760px] max-h-[520px] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl p-3 z-50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--text)]">Журнал тестов</span>
            <div className="flex items-center gap-2">
              <button onClick={() => loadTestLogs(true, true).catch(() => {})} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)]">обновить</button>
              <button onClick={() => setTestLogOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text)]">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          <div className="space-y-0.5">
            {testLogEntries.length === 0 && (
              <div className="text-xs text-[var(--text-muted)] py-2">Нет тестов</div>
            )}
            {testLogEntries.map((row) => {
              const isOpen = expandedTestLog === row.id;
              const cfg = parseJson<Record<string, unknown>>(row.config_json, {});
              const source = cfg.source === "auto" ? "авто" : "ручн.";
              const time = formatMoscowTime(row.started_at);
              const ok = row.finished_at && row.total_err === 0 && row.total_429 === 0;
              const noRequestsFailure = Boolean(row.finished_at) && row.total_requests === 0 && row.total_err > 0;
              const tl = expandedTestData?.id === row.id
                ? parseJson<TestTimelineEvent[]>(expandedTestData.timeline_json, [])
                : [];
              const cardEvents = tl.filter((e) => e.kind === "card");
              const badCards = cardEvents.filter((e) => e.status !== "ok" && e.status !== 200 && e.status !== "filtered");
              return (
                <div key={row.id}>
                  <div
                    className="flex items-center gap-1.5 text-[10px] font-mono py-1 border-b border-[var(--border)]/50 cursor-pointer hover:bg-[var(--bg-card-hover)] rounded px-1 -mx-1 transition-colors"
                    onClick={() => toggleTestLog(row.id)}
                  >
                    <svg className={`w-2.5 h-2.5 text-[var(--text-muted)] transition-transform shrink-0 ${isOpen ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                    <span className="text-[var(--text-muted)] w-[38px] shrink-0">{time}</span>
                    <span className={ok ? "text-[var(--success)]" : noRequestsFailure ? "text-[var(--danger)]" : "text-[var(--warning)]"}>{ok ? "✓" : "⚠"}</span>
                    <span className="text-[var(--text)] w-[48px] shrink-0">{source}</span>
                    <span className="text-[var(--text-muted)] w-[90px] shrink-0">{row.endpoints}</span>
                    {noRequestsFailure && <span className="text-[var(--danger)]">нет запросов</span>}
                    <span className="text-[var(--text)]">ok {row.total_ok}</span>
                    <span className="text-[var(--warning)]">429 {row.total_429}</span>
                    <span className="text-[var(--danger)]">err {row.total_err}</span>
                    {!row.finished_at && <span className="text-[var(--accent)]">running</span>}
                    <span className="text-[var(--text-muted)] ml-auto shrink-0">{row.duration_ms ? `${(row.duration_ms / 1000).toFixed(1)}с` : "—"}</span>
                  </div>
                  {isOpen && expandedTestData?.id === row.id && (
                    <div className="ml-4 py-2 space-y-2">
                      <div className="grid grid-cols-4 gap-2 text-[10px] text-[var(--text-muted)]">
                        <div>кампаний: {String(cfg.hotCount ?? "—")}</div>
                        <div>дней: {String(cfg.days ?? "—")}</div>
                        <div>карточек ok: {cardEvents.filter((e) => e.status === "ok" || e.status === 200).length}</div>
                        <div>проблем: {badCards.length}</div>
                      </div>
                      {tl.length === 0 ? (
                        <div className="text-[10px] text-[var(--text-muted)]">Детальных событий нет</div>
                      ) : (
                        <div className="max-h-[320px] overflow-y-auto border border-[var(--border)] rounded bg-[var(--bg)]">
                          <table className="w-full text-[10px] font-mono">
                            <thead className="sticky top-0 bg-[var(--bg-card)] text-[var(--text-muted)]">
                              <tr>
                                <td className="px-2 py-1">t</td>
                                <td className="px-2 py-1">камп.</td>
                                <td className="px-2 py-1">арт.</td>
                                <td className="px-2 py-1">дата</td>
                                <td className="px-2 py-1">тип</td>
                                <td className="px-2 py-1">статус</td>
                                <td className="px-2 py-1">деталь</td>
                              </tr>
                            </thead>
                            <tbody>
                              {tl.map((e, i) => (
                                <tr key={i} className={"border-t border-[var(--border)]/40 " + testStatusClass(e.status)}>
                                  <td className="px-2 py-0.5 text-[var(--text-muted)]">{e.ts_rel_ms != null ? (e.ts_rel_ms / 1000).toFixed(1) : "—"}</td>
                                  <td className="px-2 py-0.5">{e.advert_id || "—"}</td>
                                  <td className="px-2 py-0.5">{e.nm_id || "—"}</td>
                                  <td className="px-2 py-0.5">{e.date || "—"}</td>
                                  <td className="px-2 py-0.5">{e.kind === "card" ? "карточка" : e.kind === "phase" ? "фаза" : "запрос"}</td>
                                  <td className="px-2 py-0.5">{testStatusLabel(e.status)}</td>
                                  <td className="px-2 py-0.5 text-[var(--text-muted)] truncate max-w-[260px]" title={e.error || e.product_name || e.endpoint || ""}>
                                    {e.error || e.product_name || e.endpoint || "—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sync log button */}
      <button
        onClick={async () => {
          if (logOpen) { setLogOpen(false); return; }
          try {
            const res = await fetch("/api/sync-log");
            const data = await res.json();
            const rows = (data.logs || []) as SyncLogRow[];
            setLogEntries(rows);
            updateSyncErrorState(rows, true);
          } catch { /* ignore */ }
          setLogOpen(true);
        }}
        className={
          "p-1.5 rounded-lg border transition-colors " +
          (hasErrors
            ? "border-[var(--danger)] bg-[var(--danger)]/10 hover:bg-[var(--danger)]/20"
            : "border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)]")
        }
        title="Журнал синхронизации"
      >
        <svg className={"w-4 h-4 " + (hasErrors ? "text-[var(--danger)]" : "")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        </svg>
      </button>

      {/* Sync log panel */}
      {logOpen && (
        <div className="absolute top-full right-0 mt-2 w-[480px] max-h-[400px] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl p-3 z-50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--text)]">Журнал синхронизации</span>
            <button onClick={() => setLogOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text)]">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="space-y-0.5">
            {logEntries.length === 0 && (
              <div className="text-xs text-[var(--text-muted)] py-2">Нет записей</div>
            )}
            {logEntries.map((log) => {
              const isOpen = expandedLog.has(log.id);
              const time = log.started_at.slice(11, 16) || log.started_at.slice(-8, -3);
              let steps: { name: string; ok: boolean; error?: string; duration: number }[] = [];
              try { steps = JSON.parse(log.error_details || "[]"); } catch { /* ignore */ }
              const syncStepLabel = (name: string) => ({
                "supplier-orders": "orders/SPP",
              }[name] || name);
              const failedNames = steps.filter((s) => !s.ok).map((s) => syncStepLabel(s.name));

              return (
                <div key={log.id}>
                  <div
                    className="flex items-center gap-1.5 text-[10px] font-mono py-1 border-b border-[var(--border)]/50 cursor-pointer hover:bg-[var(--bg-card-hover)] rounded px-1 -mx-1 transition-colors"
                    onClick={() => setExpandedLog((prev) => {
                      const next = new Set(prev);
                      if (next.has(log.id)) next.delete(log.id); else next.add(log.id);
                      return next;
                    })}
                  >
                    <svg className={`w-2.5 h-2.5 text-[var(--text-muted)] transition-transform shrink-0 ${isOpen ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                    <span className="text-[var(--text-muted)] w-[38px] shrink-0">{time}</span>
                    <span className={log.errors > 0 ? "text-[var(--warning)]" : "text-[var(--success)]"}>
                      {log.errors > 0 ? "⚠" : "✓"}
                    </span>
                    <span className="text-[var(--text)]">{log.success}/{log.total}</span>
                    {log.errors > 0 && (
                      <span className="text-[var(--text-muted)] truncate">({failedNames.join(", ")})</span>
                    )}
                    <span className="text-[var(--text-muted)] ml-auto shrink-0">{log.duration_sec}с</span>
                  </div>
                  {isOpen && steps.length > 0 && (() => {
                    const DJEM_NAMES = ["auth-wb-funnel", "buyer-profile"];
                    const openSteps = steps.filter((s) => !DJEM_NAMES.includes(s.name));
                    const djemSteps = steps.filter((s) => DJEM_NAMES.includes(s.name));
                    return (
                      <div className="ml-4 py-1 space-y-0.5">
                        {openSteps.length > 0 && (
                          <div className="text-[8px] uppercase tracking-wide text-[var(--text-muted)] pt-0.5">Открытый API</div>
                        )}
                        {openSteps.map((s, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-[10px] font-mono">
                            <span className={s.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}>
                              {s.ok ? "✓" : "✕"}
                            </span>
                            <span className="w-[112px] shrink-0 text-[var(--text)]">{syncStepLabel(s.name)}</span>
                            {s.ok ? (
                              <span className="text-[var(--text-muted)]">{s.duration}с</span>
                            ) : (
                              <span className="text-[var(--danger)] truncate">{s.error}</span>
                            )}
                          </div>
                        ))}
                        {djemSteps.length > 0 && (
                          <div className="text-[8px] uppercase tracking-wide text-[var(--text-muted)] pt-1 border-t border-[var(--border)]/30 mt-1">Закрытый API (Джем)</div>
                        )}
                        {djemSteps.map((s, i) => (
                          <div key={`d${i}`} className="flex items-center gap-1.5 text-[10px] font-mono">
                            <span className={s.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}>
                              {s.ok ? "✓" : "✕"}
                            </span>
                            <span className="w-[112px] shrink-0 text-[var(--text)]">{syncStepLabel(s.name)}</span>
                            {s.ok ? (
                              <span className="text-[var(--text-muted)]">{s.duration}с</span>
                            ) : (
                              <span className="text-[var(--danger)] truncate">{s.error}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Auto-sync controls */}
      <div
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-xs ${autoJobsAllowed ? "" : "opacity-60"}`}
        title={autoJobsAllowed ? undefined : "Автосинхронизация отключена через WB_ADS_DISABLE_BACKGROUND_JOBS=1"}
      >
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={autoJobsAllowed && autoEnabled}
            disabled={!autoJobsAllowed}
            onChange={(e) => handleAutoToggle(e.target.checked)}
            className="accent-[var(--accent)] w-3 h-3"
          />
          <span className="text-[var(--text-muted)]">авто</span>
        </label>
        <select
          value={interval}
          disabled={!autoJobsAllowed}
          onChange={(e) => handleIntervalChange(Number(e.target.value))}
          className="bg-transparent text-[var(--text)] text-xs outline-none cursor-pointer disabled:cursor-not-allowed"
        >
          {INTERVALS.map((i) => (
            <option key={i.value} value={i.value} className="bg-[var(--bg-card)]">
              {i.label}
            </option>
          ))}
        </select>
        {autoJobsAllowed && autoEnabled && nextIn != null && (
          <span className={`text-[10px] min-w-[2.5rem] text-right ${autoSyncing ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}>
            {autoSyncing ? "sync..." : formatCountdown(nextIn)}
          </span>
        )}
      </div>

      {/* Knowledge Base */}
      <button
        onClick={() => setKbOpen(true)}
        className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] transition-colors"
        title="База знаний"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
        </svg>
      </button>
      <KnowledgeBase open={kbOpen} onClose={() => setKbOpen(false)} />
      <TestSyncModal open={testOpen} onClose={() => setTestOpen(false)} />

      {/* Theme switcher */}
      <div className="relative">
        <button
          onClick={() => setThemeOpen(!themeOpen)}
          className="w-6 h-6 rounded-full border border-[var(--border)] shadow"
          style={{ background: THEMES.find((t) => t.key === theme)?.color }}
          title="Тема"
        />
        {themeOpen && (
          <div className="absolute right-0 mt-2 p-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl flex flex-col gap-1 min-w-[120px]">
            {THEMES.map((t) => (
              <button
                key={t.key}
                onClick={() => handleTheme(t.key)}
                className={
                  "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors " +
                  (theme === t.key
                    ? "bg-[var(--bg-card-hover)] text-white"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]")
                }
              >
                <span className="w-3 h-3 rounded-full" style={{ background: t.color }} />
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Export helpers for loading/saving column settings
export async function loadColumnWidths(): Promise<Record<string, number>> {
  try {
    const res = await fetch("/api/settings");
    const raw = await res.json();
    return raw.col_widths ? JSON.parse(raw.col_widths) : {};
  } catch { return {}; }
}

export async function saveColumnWidths(w: Record<string, number>) {
  await saveSetting("col_widths", JSON.stringify(w));
}

export async function loadColumnOrder(): Promise<string[] | null> {
  try {
    const res = await fetch("/api/settings");
    const raw = await res.json();
    const order = raw.col_order ? JSON.parse(raw.col_order) : null;
    return Array.isArray(order) && order.length > 0 ? order : null;
  } catch { return null; }
}

export async function saveColumnOrder(o: string[]) {
  await saveSetting("col_order", JSON.stringify(o));
}
