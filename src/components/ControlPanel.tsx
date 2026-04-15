"use client";

import { useState, useEffect, useRef } from "react";
import KnowledgeBase from "./KnowledgeBase";

const THEMES = [
  { key: "violet", label: "Violet", color: "#6c5ce7" },
  { key: "arctic", label: "Arctic", color: "#56d4c8" },
  { key: "neon", label: "Neon", color: "#a3e635" },
];

const INTERVALS = [
  { label: "5 мин", value: 5 },
  { label: "10 мин", value: 10 },
  { label: "15 мин", value: 15 },
  { label: "30 мин", value: 30 },
  { label: "60 мин", value: 60 },
];

interface Settings {
  theme: string;
  auto_sync_enabled: boolean;
  auto_sync_interval: number;
  col_widths: string;
  col_order: string;
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


export default function ControlPanel({
  onSyncComplete,
  onSyncManual,
}: {
  onSyncComplete: () => void;
  onSyncManual: () => void;
}) {
  const [theme, setTheme] = useState("violet");
  const [themeOpen, setThemeOpen] = useState(false);
  const [kbOpen, setKbOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logEntries, setLogEntries] = useState<{ id: number; type: string; started_at: string; total: number; success: number; errors: number; error_details: string | null; duration_sec: number }[]>([]);
  const [expandedLog, setExpandedLog] = useState<Set<number>>(new Set());
  const [hasErrors, setHasErrors] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [interval, setInterval_] = useState(15);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [nextIn, setNextIn] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Load settings + init server auto-sync on mount
  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((raw) => {
      const t = raw.theme || "violet";
      setTheme(t);
      document.documentElement.setAttribute("data-theme", t);
      setInterval_(Number(raw.auto_sync_interval) || 15);
      setAutoEnabled(raw.auto_sync_enabled === "true");
    }).catch(() => {});

    // Initialize server-side auto-sync
    fetch("/api/auto-sync").catch(() => {});

    // Check for recent errors
    fetch("/api/sync-log").then((r) => r.json()).then((d) => {
      setHasErrors(d.hasRecentErrors);
    }).catch(() => {});
  }, []);

  // Poll server auto-sync status every 2 seconds for countdown
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/auto-sync");
        const data = await res.json();
        setAutoSyncing(data.running);
        if (data.enabled) {
          setNextIn(data.secondsUntilNext);
        } else {
          setNextIn(null);
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
    setAutoEnabled(enabled);
    saveSetting("auto_sync_enabled", String(enabled));
    // Notify server to reload settings
    fetch("/api/auto-sync", { method: "POST" }).catch(() => {});
  }

  function handleIntervalChange(val: number) {
    setInterval_(val);
    saveSetting("auto_sync_interval", String(val));
    // Notify server to reload settings
    fetch("/api/auto-sync", { method: "POST" }).catch(() => {});
  }

  function formatCountdown(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
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

      {/* Sync log button */}
      <button
        onClick={async () => {
          if (logOpen) { setLogOpen(false); return; }
          try {
            const res = await fetch("/api/sync-log");
            const data = await res.json();
            setLogEntries(data.logs || []);
            setHasErrors(data.hasRecentErrors);
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
              const failedNames = steps.filter((s) => !s.ok).map((s) => s.name);

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
                            <span className="w-[100px] shrink-0 text-[var(--text)]">{s.name}</span>
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
                            <span className="w-[100px] shrink-0 text-[var(--text)]">{s.name}</span>
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
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-xs">
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={autoEnabled}
            onChange={(e) => handleAutoToggle(e.target.checked)}
            className="accent-[var(--accent)] w-3 h-3"
          />
          <span className="text-[var(--text-muted)]">авто</span>
        </label>
        <select
          value={interval}
          onChange={(e) => handleIntervalChange(Number(e.target.value))}
          className="bg-transparent text-[var(--text)] text-xs outline-none cursor-pointer"
        >
          {INTERVALS.map((i) => (
            <option key={i.value} value={i.value} className="bg-[var(--bg-card)]">
              {i.label}
            </option>
          ))}
        </select>
        {autoEnabled && nextIn != null && (
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
