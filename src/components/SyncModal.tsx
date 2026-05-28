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
  // Временно выключенные шаги — не выполняются, но показываются в списке
  // зачёркнутыми (чтобы не забыть их потом вернуть).
  disabled?: boolean;
}

const API_STEPS: Omit<SyncStep, "status" | "time" | "error">[] = [
  { key: "campaigns", label: "Кампании", endpoint: "/api/sync/campaigns" },
  { key: "products", label: "Карточки товаров", endpoint: "/api/sync/products" },
  { key: "stocks", label: "Остатки", endpoint: "/api/sync/stocks" },
  { key: "supplier-orders", label: "Заказы WB / СПП (3 дня)", endpoint: "/api/sync/supplier-orders?days=3" },
  { key: "stats", label: "Статистика кампаний", endpoint: "/api/sync/stats" },
  { key: "balance", label: "Баланс и бюджеты", endpoint: "/api/sync/balance" },
  { key: "expense-history", label: "Списания WB по кампаниям (7 дней)", endpoint: "/api/sync/expense-history" },
  { key: "preset-info-open", label: "Фразы кампаний (open API)", endpoint: "/api/sync/preset-info-open" },
  { key: "clusters", label: "Кластеры", endpoint: "/api/sync/clusters" },
  { key: "normquery-bids", label: "Ставки по фразам (CPM)", endpoint: "/api/sync/normquery-bids" },
  { key: "normquery-stats", label: "Статистика по фразам (сегодня)", endpoint: "/api/sync/normquery-stats?days=1" },
  { key: "funnel", label: "Воронка продаж", endpoint: "/api/sync/funnel?days=1" },
];

// Закрытый API делится на 2 параллельные группы — они используют РАЗНЫЕ Puppeteer-вкладки:
//   CMP_STEPS    → __wbSniffCmpPage (cmp.wildberries.ru)
//   SELLER_STEPS → __wbSniffPage    (seller.wildberries.ru / seller-content)
// Поэтому их можно гонять параллельно друг с другом.
const CMP_STEPS: Omit<SyncStep, "status" | "time" | "error">[] = [
  // Временно отключены — гоняются только в Test-panel для подбора задержек против 429.
  // После нахождения рабочей схемы — вернуть (снять disabled).
  { key: "fullstat-v3", label: "Статистика РК xlsx (30 дней, зоны)", endpoint: "/api/sync/fullstat-v3", disabled: true },
  { key: "fullstat-v3-daily", label: "Позиции товаров РК (2 дня)", endpoint: "/api/sync/fullstat-v3-daily?days=2", disabled: true },
  { key: "preset-info", label: "Фразы кампаний + исключения", endpoint: "/api/sync/preset-info" },
  { key: "supplier-subjects", label: "Мин. CPM по предметам", endpoint: "/api/sync/supplier-subjects" },
];

const SELLER_STEPS: Omit<SyncStep, "status" | "time" | "error">[] = [
  { key: "search-texts-all", label: "Частотность WB (premium)", endpoint: "/api/sync/search-texts-all" },
  { key: "auth-funnel", label: "Воронка Джем (сегодня)", endpoint: "/api/sync/auth-wb-funnel?days=1" },
  { key: "buyer-profile", label: "Портрет покупателя (сегодня)", endpoint: "/api/sync/buyer-profile?days=1" },
];

// Endpoints отдающие прогресс (GET на тот же URL без query-params).
const PROGRESS_URLS: Record<string, string> = {
  "fullstat-v3": "/api/sync/fullstat-v3",
  "fullstat-v3-daily": "/api/sync/fullstat-v3-daily",
  "preset-info": "/api/sync/preset-info",
  "search-texts-all": "/api/sync/search-texts-all",
  "auth-funnel": "/api/sync/auth-wb-funnel",
  "buyer-profile": "/api/sync/buyer-profile",
};

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

async function runStepsSequentialWithCancel(
  steps: SyncStep[],
  onUpdate: (steps: SyncStep[]) => void,
  cancelRef: { current: boolean },
): Promise<void> {
  for (const step of steps) {
    if (step.disabled) { step.status = "skipped"; onUpdate([...steps]); continue; }
    if (cancelRef.current) { step.status = "skipped"; onUpdate([...steps]); continue; }
    await runOneStep(step, steps, onUpdate);
  }

  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    if (cancelRef.current) break;
    const failed = steps.filter((s) => !s.disabled && (s.status === "error" || s.status === "warning"));
    if (failed.length === 0) break;
    await new Promise((r) => setTimeout(r, RETRY_DELAY));
    for (const step of failed) {
      if (cancelRef.current) break;
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
  const [cmpSteps, setCmpSteps] = useState<SyncStep[]>([]);
  const [sellerSteps, setSellerSteps] = useState<SyncStep[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, { current: number; total: number; ok: number; err: number }>>({});
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  const [showLog, setShowLog] = useState(false);
  const [logEntries, setLogEntries] = useState<{ id: number; type: string; started_at: string; total: number; success: number; errors: number; error_details: string | null; duration_sec: number }[]>([]);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const cancelledRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  async function runSync() {
    if (running) return;
    setRunning(true);
    setStarted(true);
    cancelledRef.current = false;

    // Сброс серверного флага отмены от предыдущего запуска
    try { await fetch("/api/sync/cancel", { method: "DELETE" }); } catch { /* */ }

    const freshApi = makeSteps(API_STEPS);
    const freshCmp = makeSteps(CMP_STEPS);
    const freshSeller = makeSteps(SELLER_STEPS);
    setApiSteps([...freshApi]);
    setCmpSteps([...freshCmp]);
    setSellerSteps([...freshSeller]);

    // Polling прогресса для всех шагов, у которых есть backend-счётчик.
    pollRef.current = setInterval(async () => {
      const updates: Record<string, { current: number; total: number; ok: number; err: number }> = {};
      for (const [key, url] of Object.entries(PROGRESS_URLS)) {
        try {
          const res = await fetch(url);
          const data = await res.json();
          if (data.running || data.total > 0) {
            updates[key] = { current: data.current ?? 0, total: data.total ?? 0, ok: data.ok ?? 0, err: data.err ?? 0 };
          }
        } catch { /* ignore */ }
      }
      if (Object.keys(updates).length > 0) {
        setProgressMap((prev) => ({ ...prev, ...updates }));
      }
    }, 800);

    // 3 группы параллельно: open API + cmp (closed) + seller (closed)
    // cmp и seller используют РАЗНЫЕ Puppeteer-вкладки → safe.
    const syncStart = Date.now();
    const apiPromise = runStepsSequentialWithCancel(freshApi, setApiSteps, cancelledRef);
    const cmpPromise = runStepsSequentialWithCancel(freshCmp, setCmpSteps, cancelledRef);
    const sellerPromise = runStepsSequentialWithCancel(freshSeller, setSellerSteps, cancelledRef);

    await Promise.all([apiPromise, cmpPromise, sellerPromise]);

    if (pollRef.current) clearInterval(pollRef.current);

    // Запись одной сводной строки в sync_log (как у auto-sync — server-auto).
    // error_details содержит per-step JSON, который ControlPanel журнал раскрывает стрелкой.
    try {
      const allSteps = [...freshApi, ...freshCmp, ...freshSeller];
      const stepDetails = allSteps
        .filter((s) => !s.disabled)
        .map((s) => ({ name: s.key, ok: s.status === "done", error: s.error || undefined, duration: s.time ?? 0 }));
      const successCount = stepDetails.filter((s) => s.ok).length;
      const errorCount = stepDetails.length - successCount;
      await fetch("/api/sync-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "manual",
          total: stepDetails.length,
          success: successCount,
          errors: errorCount,
          error_details: JSON.stringify(stepDetails),
          duration_sec: Math.round((Date.now() - syncStart) / 100) / 10,
        }),
      });
    } catch { /* */ }

    setRunning(false);
    onComplete();
  }

  async function cancelSync() {
    cancelledRef.current = true;
    try { await fetch("/api/sync/cancel", { method: "POST" }); } catch { /* */ }
  }

  // Модалка НЕ стартует sync автоматически — пользователь нажимает «Проверить» внизу.
  // Reset состояния при закрытии.
  if (!open && started) {
    setStarted(false);
    setApiSteps([]);
    setCmpSteps([]);
    setSellerSteps([]);
    setProgressMap({});
    if (pollRef.current) clearInterval(pollRef.current);
  }

  if (!open) return null;

  const displayApi = apiSteps.length > 0 ? apiSteps : makeSteps(API_STEPS);
  const displayCmp = cmpSteps.length > 0 ? cmpSteps : makeSteps(CMP_STEPS);
  const displaySeller = sellerSteps.length > 0 ? sellerSteps : makeSteps(SELLER_STEPS);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="rounded-xl border p-6 min-w-[420px] max-w-[500px]"
        style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
      >
        <h3 className="text-lg font-semibold mb-4">Синхронизация</h3>

        {/* Универсальный рендер группы шагов. Прогресс-бар показывается для всех шагов,
            у которых есть запись в progressMap (backend отдаёт current/total). */}
        {([
          { title: "Открытый API", steps: displayApi },
          { title: "Закрытый API — cmp (статистика, preset-info)", steps: displayCmp },
          { title: "Закрытый API — seller / Джем", steps: displaySeller },
        ] as const).map((group, gi) => (
          <div key={gi} className={gi > 0 ? "border-t border-[var(--border)] pt-3 mt-3" : ""}>
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] font-semibold mb-1.5">
              {group.title}
            </div>
            <div className="space-y-2 mb-4">
              {group.steps.map((step) => {
                const prog = progressMap[step.key];
                const showProg = prog && prog.total > 0 && step.status === "running";
                const isDisabled = step.disabled;
                return (
                  <div key={step.key}>
                    <div className={"flex items-center gap-3" + (isDisabled ? " opacity-50" : "")}>
                      <div className="w-5 text-center text-sm">{isDisabled ? <span className="text-[var(--text-muted)]">⊘</span> : <StatusIcon status={step.status} />}</div>
                      <div className={"flex-1 text-sm" + (isDisabled ? " line-through text-[var(--text-muted)]" : "")}>{step.label}</div>
                      <div className="text-xs text-[var(--text-muted)] w-28 text-right">
                        {isDisabled && <span className="italic">тест-режим</span>}
                        {!isDisabled && step.status === "running" && prog && prog.total > 0 && (
                          <span className="text-[var(--accent)]">
                            {prog.current}/{prog.total}
                            {prog.err > 0 && <span className="text-[var(--danger)] ml-1">({prog.err}ош)</span>}
                          </span>
                        )}
                        {!isDisabled && step.status === "running" && (!prog || prog.total === 0) && "..."}
                        {!isDisabled && step.status === "done" && step.time != null && `${step.time.toFixed(1)} сек`}
                        {!isDisabled && step.status === "warning" && (
                          <span
                            className="text-[var(--warning)] cursor-pointer"
                            onClick={() => setExpandedErrors((prev) => {
                              const next = new Set(prev);
                              if (next.has(step.key)) next.delete(step.key); else next.add(step.key);
                              return next;
                            })}
                          >
                            {step.success}/{step.total} ({step.errors?.length}ош)
                          </span>
                        )}
                        {!isDisabled && step.status === "error" && (
                          <span className="text-[var(--danger)]" title={step.error || ""}>ошибка</span>
                        )}
                        {!isDisabled && step.status === "skipped" && "пропущен"}
                      </div>
                    </div>
                    {showProg && (
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
        ))}

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
          <div className="flex items-center gap-2">
            {running ? (
              <button
                onClick={cancelSync}
                disabled={cancelledRef.current}
                className="px-4 py-2 rounded-lg text-sm border transition-colors hover:bg-[var(--danger)]/20"
                style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
              >
                {cancelledRef.current ? "Отменяется..." : "Отменить"}
              </button>
            ) : (
              <button
                onClick={runSync}
                className="px-4 py-2 rounded-lg text-sm border transition-colors hover:bg-[var(--accent)]/20"
                style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
              >
                Проверить
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm border transition-colors"
              style={{
                borderColor: "var(--border)",
                color: "var(--text-muted)",
              }}
            >
              {running ? "Выполняется..." : "Закрыть"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
