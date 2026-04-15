"use client";

import { useState, useEffect, useRef } from "react";

type StepStatus = "pending" | "running" | "done" | "warning" | "error" | "skipped";

interface SyncStep {
  key: string;
  label: string;
  endpoint: string;
  status: StepStatus;
  time: number | null;
  error: string | null;
  total?: number;
  success?: number;
  errors?: string[];
}

const API_STEPS: Omit<SyncStep, "status" | "time" | "error">[] = [
  { key: "campaigns", label: "Кампании", endpoint: "/api/sync/campaigns" },
  { key: "products", label: "Карточки товаров", endpoint: "/api/sync/products" },
  { key: "stocks", label: "Остатки", endpoint: "/api/sync/stocks" },
  { key: "stats", label: "Статистика", endpoint: "/api/sync/stats" },
  { key: "balance", label: "Баланс и бюджеты", endpoint: "/api/sync/balance" },
  { key: "clusters", label: "Кластеры", endpoint: "/api/sync/clusters" },
  { key: "funnel", label: "Воронка продаж", endpoint: "/api/sync/funnel?days=1" },
];

const DJEM_STEPS: Omit<SyncStep, "status" | "time" | "error">[] = [
  { key: "auth-funnel", label: "Воронка Джем (сегодня)", endpoint: "/api/sync/auth-wb-funnel?days=1" },
  { key: "buyer-profile", label: "Портрет покупателя (сегодня)", endpoint: "/api/sync/buyer-profile?days=1" },
];

function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "pending":
      return <span className="text-[var(--text-muted)]">○</span>;
    case "running":
      return (
        <svg className="w-4 h-4 animate-spin text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83" />
        </svg>
      );
    case "done":
      return <span className="text-[var(--success)]">✓</span>;
    case "warning":
      return <span className="text-[var(--warning)]">⚠</span>;
    case "error":
      return <span className="text-[var(--danger)]">✕</span>;
    case "skipped":
      return <span className="text-[var(--text-muted)]">—</span>;
  }
}

function makeSteps(defs: Omit<SyncStep, "status" | "time" | "error">[]): SyncStep[] {
  return defs.map((s) => ({ ...s, status: "pending" as StepStatus, time: null, error: null }));
}

async function runOneStep(step: SyncStep, steps: SyncStep[], onUpdate: (s: SyncStep[]) => void): Promise<boolean> {
  step.status = "running";
  step.error = null;
  onUpdate([...steps]);

  const start = Date.now();
  try {
    const res = await fetch(step.endpoint, { method: "POST" });
    const data = await res.json();
    step.time = (Date.now() - start) / 1000;

    if (!res.ok || data.error) {
      step.status = "error";
      step.error = data.error || `HTTP ${res.status}`;
      onUpdate([...steps]);
      return false;
    } else if (data.errors && data.errors.length > 0) {
      step.status = "warning";
      step.total = data.products || data.synced || 0;
      step.success = (data.products || 0) - data.errors.length;
      step.errors = data.errors;
      onUpdate([...steps]);
      return false;
    } else {
      step.status = "done";
      onUpdate([...steps]);
      return true;
    }
  } catch (e) {
    step.time = (Date.now() - start) / 1000;
    step.status = "error";
    step.error = e instanceof Error ? e.message : "Ошибка сети";
    onUpdate([...steps]);
    return false;
  }
}

const RETRY_DELAY = 30000; // 30 sec
const MAX_RETRIES = 2; // up to 3 total attempts

async function runStepsSequential(
  steps: SyncStep[],
  onUpdate: (steps: SyncStep[]) => void,
): Promise<void> {
  // First pass — all steps
  for (const step of steps) {
    await runOneStep(step, steps, onUpdate);
  }

  // Retry passes
  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    const failed = steps.filter((s) => s.status === "error" || s.status === "warning");
    if (failed.length === 0) break;

    // Wait before retry
    await new Promise((r) => setTimeout(r, RETRY_DELAY));

    for (const step of failed) {
      await runOneStep(step, steps, onUpdate);
    }
  }
}

export default function SyncModal({
  open,
  onClose,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [apiSteps, setApiSteps] = useState<SyncStep[]>([]);
  const [djemSteps, setDjemSteps] = useState<SyncStep[]>([]);
  const [djemProgressMap, setDjemProgressMap] = useState<Record<string, { current: number; total: number }>>({});
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  const [showLog, setShowLog] = useState(false);
  const [logEntries, setLogEntries] = useState<{ id: number; type: string; started_at: string; total: number; success: number; errors: number; error_details: string | null; duration_sec: number }[]>([]);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  async function runSync() {
    if (running) return;
    setRunning(true);
    setStarted(true);

    const freshApi = makeSteps(API_STEPS);
    const freshDjem = makeSteps(DJEM_STEPS);
    setApiSteps([...freshApi]);
    setDjemSteps([...freshDjem]);

    // Poll progress for both djem steps
    const progressEndpoints: Record<string, string> = {
      "auth-funnel": "/api/sync/auth-wb-funnel",
      "buyer-profile": "/api/sync/buyer-profile",
    };
    pollRef.current = setInterval(async () => {
      const updates: Record<string, { current: number; total: number }> = {};
      for (const [key, url] of Object.entries(progressEndpoints)) {
        try {
          const res = await fetch(url);
          const data = await res.json();
          if (data.running) updates[key] = { current: data.current, total: data.total };
        } catch { /* ignore */ }
      }
      if (Object.keys(updates).length > 0) {
        setDjemProgressMap((prev) => ({ ...prev, ...updates }));
      }
    }, 500);

    // Run both in parallel
    const apiPromise = runStepsSequential(freshApi, setApiSteps);
    const djemPromise = runStepsSequential(freshDjem, setDjemSteps);

    await Promise.all([apiPromise, djemPromise]);

    // Stop polling
    if (pollRef.current) clearInterval(pollRef.current);
    setDjemProgressMap({});

    setRunning(false);
    onComplete();
  }

  // Start automatically when modal opens
  if (open && !started) {
    runSync();
  }

  // Reset when closed
  if (!open && started) {
    setStarted(false);
    setApiSteps([]);
    setDjemSteps([]);
    setDjemProgressMap({});
    if (pollRef.current) clearInterval(pollRef.current);
  }

  if (!open) return null;

  const displayApi = apiSteps.length > 0 ? apiSteps : makeSteps(API_STEPS);
  const displayDjem = djemSteps.length > 0 ? djemSteps : makeSteps(DJEM_STEPS);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="rounded-xl border p-6 min-w-[420px] max-w-[500px]"
        style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
      >
        <h3 className="text-lg font-semibold mb-4">Синхронизация</h3>

        {/* Open API */}
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] font-semibold mb-1.5">
          Открытый API
        </div>
        <div className="space-y-2 mb-4">
          {displayApi.map((step) => (
            <div key={step.key} className="flex items-center gap-3">
              <div className="w-5 text-center text-sm">
                <StatusIcon status={step.status} />
              </div>
              <div className="flex-1 text-sm">{step.label}</div>
              <div className="text-xs text-[var(--text-muted)] w-16 text-right">
                {step.status === "running" && "..."}
                {step.status === "done" && step.time != null && `${step.time.toFixed(1)} сек`}
                {step.status === "error" && (
                  <span className="text-[var(--danger)]" title={step.error || ""}>ошибка</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Closed API (Djem) */}
        <div className="border-t border-[var(--border)] pt-3 mt-3">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] font-semibold mb-1.5">
            Закрытый API (Джем)
          </div>
          <div className="space-y-2 mb-4">
            {displayDjem.map((step) => {
              const prog = djemProgressMap[step.key];
              return (
                <div key={step.key}>
                  <div className="flex items-center gap-3">
                    <div className="w-5 text-center text-sm">
                      <StatusIcon status={step.status} />
                    </div>
                    <div className="flex-1 text-sm">{step.label}</div>
                    <div className="text-xs text-[var(--text-muted)] w-24 text-right">
                      {step.status === "running" && prog && (
                        <span className="text-[var(--accent)]">{prog.current}/{prog.total}</span>
                      )}
                      {step.status === "running" && !prog && "..."}
                      {step.status === "done" && step.time != null && `${step.time.toFixed(1)} сек`}
                      {step.status === "warning" && (
                        <span
                          className="text-[var(--warning)] cursor-pointer"
                          onClick={() => setExpandedErrors((prev) => {
                            const next = new Set(prev);
                            if (next.has(step.key)) next.delete(step.key); else next.add(step.key);
                            return next;
                          })}
                        >
                          {step.success}/{step.total} ({step.errors?.length} ош.)
                        </span>
                      )}
                      {step.status === "error" && (
                        <span className="text-[var(--danger)]" title={step.error || ""}>ошибка</span>
                      )}
                      {step.status === "skipped" && "пропущен"}
                    </div>
                  </div>
                  {step.status === "running" && prog && prog.total > 0 && (
                    <div className="ml-8 mt-1.5 mr-1">
                      <div className="h-1 rounded-full bg-[var(--border)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                          style={{ width: `${(prog.current / prog.total) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {step.status === "warning" && expandedErrors.has(step.key) && step.errors && (
                    <div className="ml-8 mt-1.5 mr-1 max-h-[120px] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2">
                      {step.errors.map((err, i) => (
                        <div key={i} className="text-[10px] text-[var(--danger)] font-mono truncate">{err}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Log section */}
        {showLog && (
          <div className="border-t border-[var(--border)] pt-3 mt-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] font-semibold mb-1.5">
              Журнал синхронизации
            </div>
            <div className="max-h-[200px] overflow-y-auto space-y-1">
              {logEntries.length === 0 && (
                <div className="text-xs text-[var(--text-muted)]">Нет записей</div>
              )}
              {logEntries.map((log) => (
                <div key={log.id} className="flex items-center gap-2 text-[10px] font-mono">
                  <span className="text-[var(--text-muted)] w-[110px] shrink-0">{log.started_at}</span>
                  <span className="w-[100px] shrink-0 truncate">{log.type}</span>
                  <span className={log.errors > 0 ? "text-[var(--warning)]" : "text-[var(--success)]"}>
                    {log.success}/{log.total}
                  </span>
                  {log.errors > 0 && (
                    <span className="text-[var(--danger)]">({log.errors} ош.)</span>
                  )}
                  <span className="text-[var(--text-muted)] ml-auto">{log.duration_sec}с</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-between mt-4">
          <button
            onClick={async () => {
              if (showLog) { setShowLog(false); return; }
              try {
                const res = await fetch("/api/sync-log");
                const data = await res.json();
                setLogEntries(data.logs || []);
              } catch { /* ignore */ }
              setShowLog(true);
            }}
            className="px-3 py-2 rounded-lg text-xs border transition-colors"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            {showLog ? "Скрыть журнал" : "Журнал"}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm border transition-colors"
            style={{
              borderColor: running ? "var(--border)" : "var(--accent)",
              color: running ? "var(--text-muted)" : "var(--accent)",
            }}
          >
            {running ? "Выполняется..." : "Закрыть"}
          </button>
        </div>
      </div>
    </div>
  );
}
