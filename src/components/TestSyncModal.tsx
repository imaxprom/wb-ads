"use client";

import { useState, useEffect, useRef } from "react";

// Модалка «Тест» для подбора параметров закрытых cmp-endpoints без 429.
// Работает с РЕАЛЬНЫМИ данными (пишет в БД), но имеет собственный журнал.

interface TestRow {
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
  duration_ms: number;
  config_json: string;
  timeline_json?: string;
}

// В UI все задержки в СЕКУНДАХ. В backend уходят в миллисекундах (×1000).
interface Params {
  gap: number;          // sec
  backoff429: number;   // sec
  maxRetries: number;   // count
  chunkSize: number;    // count
  chunkCooldown: number; // sec
  jitter: number;       // sec
  days: number;         // count
}

const DEFAULT_PARAMS: Params = {
  gap: 10,
  backoff429: 60,
  maxRetries: 0,
  chunkSize: 8,
  chunkCooldown: 0,
  jitter: 0,
  days: 2,
};

// Какие поля — время (нужно конвертировать в ms перед отправкой на backend)
const TIME_KEYS: (keyof Params)[] = ["gap", "backoff429", "chunkCooldown", "jitter"];

function parseUtcSqliteTimestamp(value: string): Date | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(`${normalized.endsWith("Z") ? normalized.slice(0, -1) : normalized}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatMoscowDateTime(value: string): string {
  const date = parseUtcSqliteTimestamp(value);
  if (!date) return value.slice(5, 16).replace("T", " ") || value;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date).replace(",", "");
}

export default function TestSyncModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"config" | "log">("config");
  const [minimized, setMinimized] = useState(false);
  const [wantV3, setWantV3] = useState(true);
  const [wantV3Daily, setWantV3Daily] = useState(true);
  const [mode, setMode] = useState<"sequential" | "parallel">("sequential");
  const [loop, setLoop] = useState(false);
  const loopRef = useRef(false);
  const cancelRef = useRef(false);
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [currentTestId, setCurrentTestId] = useState<number | null>(null);
  const [currentProgress, setCurrentProgress] = useState<{ v3?: { current: number; total: number; ok: number; err: number }; v3Daily?: { current: number; total: number; ok: number; err: number } }>({});

  function resetCumulative() {
    setCurrentProgress({});
  }

  function applyRawProgress(key: "v3" | "v3Daily", raw: { current: number; total: number; err: number; running: boolean } | null) {
    if (!raw) return;
    if (!raw.running && raw.total === 0) return;
    setCurrentProgress((prev) => ({
      ...prev,
      [key]: {
        current: raw.current,
        total: raw.total,
        ok: 0,
        err: raw.err || 0,
      },
    }));
  }
  const [log, setLog] = useState<TestRow[]>([]);
  const [expandedTest, setExpandedTest] = useState<number | null>(null);
  const [expandedTestData, setExpandedTestData] = useState<TestRow | null>(null);
  const [hintKey, setHintKey] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const runAbortRef = useRef<AbortController | null>(null);

  async function loadLog() {
    try {
      const res = await fetch("/api/sync/test?limit=20");
      const d = await res.json();
      setLog(d.tests || []);
    } catch { /* */ }
  }

  useEffect(() => {
    if (open && tab === "log") loadLog();
  }, [open, tab]);

  // Загрузка сохранённых настроек при первом открытии модалки.
  useEffect(() => {
    if (!open || settingsLoaded) return;
    (async () => {
      try {
        const res = await fetch("/api/settings");
        const s = await res.json();
        if (s.test_sync_config) {
          try {
            const cfg = JSON.parse(s.test_sync_config);
            if (cfg.params) setParams({ ...DEFAULT_PARAMS, ...cfg.params });
            if (typeof cfg.wantV3 === "boolean") setWantV3(cfg.wantV3);
            if (typeof cfg.wantV3Daily === "boolean") setWantV3Daily(cfg.wantV3Daily);
            if (cfg.mode === "sequential" || cfg.mode === "parallel") setMode(cfg.mode);
            if (typeof cfg.loop === "boolean") setLoop(cfg.loop);
          } catch { /* */ }
        }
      } catch { /* */ }
      setSettingsLoaded(true);
    })();
  }, [open, settingsLoaded]);

  // Сохранение настроек при каждом изменении (после первой загрузки).
  useEffect(() => {
    if (!settingsLoaded) return;
    const cfg = { wantV3, wantV3Daily, mode, params, loop };
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test_sync_config: JSON.stringify(cfg) }),
    }).catch(() => {});
  }, [wantV3, wantV3Daily, mode, params, loop, settingsLoaded]);

  // Ref-зеркала для актуального доступа внутри async/loop (state замыкается на момент вызова).
  useEffect(() => { loopRef.current = loop; }, [loop]);

  async function runTest(isFirstRun = true) {
    if (running || (!wantV3 && !wantV3Daily)) return;
    setRunning(true);
    setCancelling(false);
    cancelRef.current = false;
    // Каждый запуск показывает только текущий проход без накопления старых фаз.
    if (isFirstRun) resetCumulative();

    // Polling прогресса. Показываем прямое состояние текущего endpoint'а без накопления фаз.
    pollRef.current = setInterval(async () => {
      try {
        if (wantV3) {
          const r = await fetch("/api/sync/fullstat-v3").then((r) => r.json()).catch(() => null);
          applyRawProgress("v3", r);
        }
        if (wantV3Daily) {
          const r = await fetch("/api/sync/fullstat-v3-daily").then((r) => r.json()).catch(() => null);
          applyRawProgress("v3Daily", r);
        }
      } catch { /* */ }
    }, 800);

    try {
      const ac = new AbortController();
      runAbortRef.current = ac;
      const endpoints: string[] = [];
      if (wantV3) endpoints.push("v3");
      if (wantV3Daily) endpoints.push("v3-daily");
      // Конвертируем секунды в миллисекунды для backend.
      const msParams: Record<string, number> = { ...params };
      for (const k of TIME_KEYS) msParams[k] = (params[k] || 0) * 1000;
      const res = await fetch("/api/sync/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({ endpoints, mode, params: msParams, onlyActiveAdvertised: true, source: "manual" }),
      });
      const d = await res.json();
      if (d.ok && d.testId) setCurrentTestId(d.testId);
      if (!d.ok) alert(d.error || "Тест не запущен");
    } catch (e) {
      if (!cancelRef.current) alert("Ошибка: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      runAbortRef.current = null;
    }

    if (pollRef.current) clearInterval(pollRef.current);
    setCancelling(false);
    setRunning(false);
    if (tab === "log") loadLog();

    // Loop mode: если «Гонять по кругу» включён и пользователь не отменил — запускаем снова.
    // Даём маленькую паузу (1 сек) чтобы UI успел обновиться и polling завершился.
    if (loopRef.current && !cancelRef.current) {
      await new Promise((r) => setTimeout(r, 1000));
      if (loopRef.current && !cancelRef.current) {
        runTest(false);
      }
    }
  }

  async function cancelTest() {
    cancelRef.current = true;
    setCancelling(true);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = undefined;
    }
    runAbortRef.current?.abort();
    resetCumulative();
    setRunning(false);
    try { await fetch("/api/sync/cancel", { method: "POST" }); } catch { /* */ }
    setCancelling(false);
  }

  async function expandTest(id: number) {
    if (expandedTest === id) { setExpandedTest(null); setExpandedTestData(null); return; }
    setExpandedTest(id);
    try {
      const res = await fetch(`/api/sync/test?id=${id}`);
      const d = await res.json();
      if (d.ok) setExpandedTestData(d.test);
    } catch { /* */ }
  }

  if (!open) return null;

  // Свёрнутый режим: маленький floating-виджет в правом нижнем углу, не блокирует страницу.
  if (minimized) {
    const v3 = currentProgress.v3;
    const v3d = currentProgress.v3Daily;
    const anyRunning = (v3 && v3.current < v3.total) || (v3d && v3d.current < v3d.total);
    return (
      <div className="fixed bottom-4 right-4 z-50 rounded-xl border shadow-2xl p-3 w-[320px]" style={{ background: "var(--bg-card)", borderColor: "var(--accent)" }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {running && anyRunning ? (
              <svg className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83" />
              </svg>
            ) : (
              <span className="text-[var(--success)] text-sm">✓</span>
            )}
            <span className="text-xs font-semibold">Тест {loop ? "(по кругу)" : ""}</span>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setMinimized(false)}
              title="Развернуть"
              className="px-2 py-0.5 text-[10px] rounded border border-[var(--border)] hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)]"
            >
              ↑ развернуть
            </button>
            {!running && (
              <button
                onClick={() => { setMinimized(false); onClose(); }}
                title="Закрыть"
                className="px-2 py-0.5 text-[10px] rounded border border-[var(--border)] hover:bg-[var(--danger)]/20 hover:border-[var(--danger)] text-[var(--text-muted)] hover:text-[var(--danger)]"
              >
                ×
              </button>
            )}
          </div>
        </div>
        {v3 && (
          <div className="mb-1.5">
            <div className="flex justify-between text-[10px] mb-0.5">
              <span className="text-[var(--text-muted)]">fullstat-v3</span>
              <span className="font-mono text-[var(--accent)]">
                {v3.current}/{v3.total}
                {v3.err > 0 && <span className="text-[var(--danger)] ml-1">({v3.err}ош)</span>}
              </span>
            </div>
            <div className="h-1 rounded-full bg-[var(--border)] overflow-hidden">
              <div className="h-full bg-[var(--accent)]" style={{ width: `${(v3.current / Math.max(1, v3.total)) * 100}%` }} />
            </div>
          </div>
        )}
        {v3d && (
          <div>
            <div className="flex justify-between text-[10px] mb-0.5">
              <span className="text-[var(--text-muted)]">fullstat-v3-daily</span>
              <span className="font-mono text-[var(--accent)]">
                {v3d.current}/{v3d.total}
                {v3d.err > 0 && <span className="text-[var(--danger)] ml-1">({v3d.err}ош)</span>}
              </span>
            </div>
            <div className="h-1 rounded-full bg-[var(--border)] overflow-hidden">
              <div className="h-full bg-[var(--accent)]" style={{ width: `${(v3d.current / Math.max(1, v3d.total)) * 100}%` }} />
            </div>
          </div>
        )}
      </div>
    );
  }

  const numInput = (label: string, key: keyof Params, unit: string, desc: string) => (
    <label className="flex items-center gap-3 text-sm">
      <span className="flex-1 flex items-center gap-1.5">
        <span
          className="relative inline-flex"
          onMouseEnter={() => setHintKey(key as string)}
          onMouseLeave={() => setHintKey((k) => (k === key ? null : k))}
        >
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-[var(--border)] text-[9px] text-[var(--text-muted)] cursor-help select-none hover:text-[var(--accent)] hover:border-[var(--accent)]">
            ?
          </span>
          {hintKey === key && (
            <span
              className="absolute z-50 top-full left-0 mt-1.5 px-3 py-2 rounded-lg bg-[#2a2a3e] border border-[var(--accent)] shadow-[0_0_16px_rgba(108,92,231,0.25)] text-[10px] text-white font-normal normal-case tracking-normal text-left leading-snug pointer-events-none"
              style={{ width: "360px", whiteSpace: "normal", display: "block" }}
            >
              {desc}
            </span>
          )}
        </span>
        <span className="text-[var(--text)]">{label}</span>
        <span className="text-[10px] text-[var(--text-muted)]">({unit})</span>
      </span>
      <input
        type="number"
        value={params[key]}
        onChange={(e) => setParams((p) => ({ ...p, [key]: Math.max(0, Number(e.target.value) || 0) }))}
        disabled={running}
        className="w-24 px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg)] text-right font-mono text-xs outline-none focus:border-[var(--accent)]"
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-8">
      <div
        className="rounded-xl border flex flex-col w-full"
        style={{
          background: "var(--bg-card)",
          borderColor: "var(--border)",
          width: tab === "log" ? "900px" : "680px",
          maxWidth: "100%",
          maxHeight: "100%",
        }}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0">
          <h3 className="text-lg font-semibold">Тест cmp-endpoints</h3>
          <div className="flex gap-1 items-center">
            <button onClick={() => setTab("config")} className={"px-3 py-1 rounded text-xs " + (tab === "config" ? "bg-[var(--accent)]/20 text-[var(--accent)]" : "text-[var(--text-muted)]")}>Конфиг</button>
            <button onClick={() => setTab("log")} className={"px-3 py-1 rounded text-xs " + (tab === "log" ? "bg-[var(--accent)]/20 text-[var(--accent)]" : "text-[var(--text-muted)]")}>Журнал</button>
            <button
              onClick={() => setMinimized(true)}
              title="Свернуть (тест продолжит работать в фоне)"
              className="ml-2 px-2 py-1 text-xs rounded border border-[var(--border)] hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              — свернуть
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-6" style={{ scrollbarGutter: "stable", minHeight: 0 }}>

        {tab === "config" && (
          <>
            {/* Endpoints */}
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] font-semibold mb-2">Endpoints</div>
            <div className="space-y-1.5 mb-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={wantV3} onChange={(e) => setWantV3(e.target.checked)} disabled={running} className="accent-[var(--accent)]" />
                <span>fullstat-v3 (30-дней xlsx, только активные рекламные кампании)</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={wantV3Daily} onChange={(e) => setWantV3Daily(e.target.checked)} disabled={running} className="accent-[var(--accent)]" />
                <span>fullstat-v3-daily (xlsx per-day, активные кампании × N дней, только рекламируемые карточки)</span>
              </label>
            </div>

            {/* Mode */}
            {wantV3 && wantV3Daily && (
              <>
                <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] font-semibold mb-2">Режим</div>
                <div className="flex gap-3 mb-4 text-sm">
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={mode === "sequential"} onChange={() => setMode("sequential")} disabled={running} className="accent-[var(--accent)]" />
                    Последовательно (v3 → v3-daily)
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={mode === "parallel"} onChange={() => setMode("parallel")} disabled={running} className="accent-[var(--accent)]" />
                    Параллельно
                  </label>
                </div>
              </>
            )}

            {/* Loop */}
            <div className="flex items-center gap-2 mb-4 text-sm p-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]/30">
              <input
                type="checkbox"
                checked={loop}
                onChange={(e) => setLoop(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              <span className="flex-1">Гонять по кругу</span>
              <span className="text-[10px] text-[var(--text-muted)]">после завершения автоматически запускается снова (пока не нажать «Отменить»)</span>
            </div>

            {/* Params */}
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] font-semibold mb-2">Параметры</div>
            <div className="space-y-2.5">
              {numInput(
                "Пауза между запросами",
                "gap",
                "сек",
                "После каждой успешно синканной кампании ждём указанное время перед следующей. Снижает частоту запросов, WB меньше даёт 429. Дефолт 10 сек.",
              )}
              {numInput(
                "Пауза после 429",
                "backoff429",
                "сек",
                "Если WB ответил 429 (лимит превышен) — ждём это время, потом пробуем ту же кампанию заново (см. «Повторов при 429»). Работает только если повторов > 0. Дефолт 60 сек.",
              )}
              {numInput(
                "Повторов при 429",
                "maxRetries",
                "раз",
                "Сколько раз переспросить одну и ту же кампанию после 429. 0 = не повторяем, сразу пропускаем кампанию. 1-2 обычно достаточно.",
              )}
              {numInput(
                "Размер пачки",
                "chunkSize",
                "запросов",
                "После каждых N успешных запросов делается большая пауза (см. «Пауза между пачками»). Помогает «остудить» сессию WB. 999 = один сплошной поток без пачек.",
              )}
              {numInput(
                "Пауза между пачками",
                "chunkCooldown",
                "сек",
                "Длинная пауза после каждой пачки. Даёт серверу WB сбросить внутренний счётчик. 0 = без паузы (пачки не работают). Рекомендуется 60-120 сек.",
              )}
              {numInput(
                "Случайная добавка",
                "jitter",
                "± сек",
                "К каждой «Паузе между запросами» добавляется случайное значение ±N. Запросы не выглядят как ритмичный бот, WB реже триггерит защиту. 0 = без добавки.",
              )}
              {wantV3Daily && numInput(
                "Дней для v3-daily",
                "days",
                "шт",
                "Сколько последних дней тянуть в v3-daily при ручном запуске. В режиме «тест авто» вчерашний день тянется отдельно: после 09:00 МСК и до первого успешного обновления за этот день.",
              )}
            </div>

            {/* Live progress */}
            {running && (
              <div className="border-t border-[var(--border)] pt-3 mb-3">
                <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] font-semibold mb-2">Выполнение</div>
                {currentProgress.v3 && (
                  <div className="mb-2">
                    <div className="flex justify-between text-xs mb-1">
                      <span>fullstat-v3</span>
                      <span className="font-mono text-[var(--accent)]">{currentProgress.v3.current}/{currentProgress.v3.total} {currentProgress.v3.err > 0 && <span className="text-[var(--danger)]">({currentProgress.v3.err}ош)</span>}</span>
                    </div>
                    <div className="h-1 rounded-full bg-[var(--border)] overflow-hidden">
                      <div className="h-full bg-[var(--accent)]" style={{ width: `${(currentProgress.v3.current / Math.max(1, currentProgress.v3.total)) * 100}%` }} />
                    </div>
                  </div>
                )}
                {currentProgress.v3Daily && (
                  <div className="mb-2">
                    <div className="flex justify-between text-xs mb-1">
                      <span>fullstat-v3-daily</span>
                      <span className="font-mono text-[var(--accent)]">{currentProgress.v3Daily.current}/{currentProgress.v3Daily.total} {currentProgress.v3Daily.err > 0 && <span className="text-[var(--danger)]">({currentProgress.v3Daily.err}ош)</span>}</span>
                    </div>
                    <div className="h-1 rounded-full bg-[var(--border)] overflow-hidden">
                      <div className="h-full bg-[var(--accent)]" style={{ width: `${(currentProgress.v3Daily.current / Math.max(1, currentProgress.v3Daily.total)) * 100}%` }} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {currentTestId && !running && (
              <div className="text-xs text-[var(--text-muted)] mb-3">Тест #{currentTestId} завершён. <button className="text-[var(--accent)] underline" onClick={() => { setTab("log"); loadLog(); }}>Открыть журнал</button></div>
            )}
          </>
        )}

        {tab === "log" && (
          <div>
            {log.length === 0 && <div className="text-xs text-[var(--text-muted)]">Нет тестов</div>}
            <table className="w-full text-xs border-collapse" style={{ tableLayout: "auto" }}>
              <thead className="sticky top-0 bg-[var(--bg-card)] z-10">
                <tr className="text-[9px] uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--border)]">
                  <th className="py-2 px-2 text-left font-semibold whitespace-nowrap">Время МСК</th>
                  <th className="py-2 px-2 text-left font-semibold whitespace-nowrap">Endpoints</th>
                  <th className="py-2 px-2 text-left font-semibold whitespace-nowrap">Режим</th>
                  <th className="py-2 px-2 text-right font-semibold whitespace-nowrap">Запр.</th>
                  <th className="py-2 px-2 text-right font-semibold whitespace-nowrap">Ок</th>
                  <th className="py-2 px-2 text-right font-semibold whitespace-nowrap">429</th>
                  <th className="py-2 px-2 text-right font-semibold whitespace-nowrap">Err</th>
                  <th className="py-2 px-2 text-right font-semibold whitespace-nowrap">1-й 429</th>
                  <th className="py-2 px-2 text-right font-semibold whitespace-nowrap">Длит.</th>
                </tr>
              </thead>
              <tbody>
                {log.map((t) => {
                  const noRequestsFailure = Boolean(t.finished_at) && t.total_requests === 0 && t.total_err > 0;
                  return (
                  <>
                    <tr key={t.id} className={`border-b border-[var(--border)] hover:bg-[var(--bg-card-hover)] cursor-pointer ${noRequestsFailure ? "bg-[var(--danger)]/5" : ""}`} onClick={() => expandTest(t.id)}>
                      <td className="py-1.5 px-2 font-mono whitespace-nowrap">{formatMoscowDateTime(t.started_at)}</td>
                      <td className="py-1.5 px-2 whitespace-nowrap">{t.endpoints}</td>
                      <td className="py-1.5 px-2 whitespace-nowrap">{t.mode}</td>
                      <td className={`py-1.5 px-2 text-right font-mono whitespace-nowrap ${noRequestsFailure ? "text-[var(--danger)]" : ""}`}>{noRequestsFailure ? "нет" : t.total_requests}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-[var(--success)] whitespace-nowrap">{t.total_ok}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-[var(--warning)] whitespace-nowrap">{t.total_429}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-[var(--danger)] whitespace-nowrap">{t.total_err}</td>
                      <td className="py-1.5 px-2 text-right font-mono whitespace-nowrap">{noRequestsFailure ? "до старта" : t.first_429_at_step ?? "—"}</td>
                      <td className="py-1.5 px-2 text-right font-mono whitespace-nowrap">{t.duration_ms ? `${(t.duration_ms / 1000).toFixed(1)}с` : "—"}</td>
                    </tr>
                    {expandedTest === t.id && expandedTestData?.id === t.id && (
                      <tr>
                        <td colSpan={9} className="py-3 px-3 bg-[var(--bg)]">
                          <div className="text-[10px] text-[var(--text-muted)] mb-2 font-mono break-all">
                            config: {expandedTestData.config_json}
                          </div>
                          {expandedTestData.timeline_json && (() => {
                            try {
                              const tl = JSON.parse(expandedTestData.timeline_json) as Array<{ step: number; ts_rel_ms: number; advert_id: number; endpoint: string; status: number | string; duration_ms: number }>;
                              return (
                                <div className="max-h-[250px] overflow-y-auto border border-[var(--border)] rounded bg-[var(--bg-card)]">
                                  <table className="w-full text-[10px] font-mono">
                                    <thead className="sticky top-0 bg-[var(--bg-card)]">
                                      <tr className="text-[var(--text-muted)]">
                                        <td className="px-2 py-0.5">#</td>
                                        <td className="px-2 py-0.5">t (s)</td>
                                        <td className="px-2 py-0.5">advert</td>
                                        <td className="px-2 py-0.5">endpoint</td>
                                        <td className="px-2 py-0.5">status</td>
                                        <td className="px-2 py-0.5 text-right">dur (ms)</td>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {tl.map((e, i) => (
                                        <tr key={i} className={e.status === 429 ? "text-[var(--warning)]" : e.status !== 200 ? "text-[var(--danger)]" : ""}>
                                          <td className="px-2 py-0.5">{e.step}</td>
                                          <td className="px-2 py-0.5">{(e.ts_rel_ms / 1000).toFixed(1)}</td>
                                          <td className="px-2 py-0.5">{e.advert_id}</td>
                                          <td className="px-2 py-0.5">{e.endpoint}</td>
                                          <td className="px-2 py-0.5">{e.status}</td>
                                          <td className="px-2 py-0.5 text-right">{e.duration_ms}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              );
                            } catch { return <div className="text-xs text-[var(--danger)]">Ошибка timeline</div>; }
                          })()}
                        </td>
                      </tr>
                    )}
                  </>
                );
                })}
              </tbody>
            </table>
          </div>
        )}

        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-[var(--border)] shrink-0" style={{ background: "var(--bg)" }}>
          <button onClick={loadLog} className="px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)]">↻ Обновить журнал</button>
          <div className="flex gap-2">
            {running ? (
              <button
                onClick={cancelTest}
                className="px-4 py-2 rounded-lg text-sm border border-[var(--danger)] text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/20 hover:text-white disabled:opacity-60 disabled:cursor-wait"
                disabled={cancelling}
              >
                {cancelling ? "Отменяется..." : "Отменить"}
              </button>
            ) : tab === "config" ? (
              <button onClick={() => runTest(true)} disabled={!wantV3 && !wantV3Daily} className="px-4 py-2 rounded-lg text-sm border hover:bg-[var(--accent)]/20 disabled:opacity-50 disabled:cursor-not-allowed" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                Запустить
              </button>
            ) : null}
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm border border-[var(--border)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card-hover)] hover:border-[var(--accent)] hover:text-[var(--text)]"
            >
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
