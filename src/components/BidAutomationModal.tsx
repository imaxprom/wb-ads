"use client";

import { useEffect, useState } from "react";
import type { BidAutomationLog, BidAutomationRule } from "@/lib/bid-automation";
import type { AiDiaryEntry } from "@/lib/ai-diary";

const MAX_AUTO_BID_RUB = 1500;

interface Props {
  open: boolean;
  advertId: number;
  nmId: number;
  campaignName: string;
  phrase: string;
  currentBidRub: number;
  minBidRub: number;
  rule?: BidAutomationRule | null;
  lastLog?: BidAutomationLog | null;
  logs?: BidAutomationLog[];
  onClose: () => void;
  onSaved: () => void;
}

function boolFromInt(v: number | undefined, fallback: boolean) {
  if (v == null) return fallback;
  return v === 1;
}

function n(v: number | undefined, fallback: number) {
  return Number.isFinite(Number(v)) ? Number(v) : fallback;
}

function formatCheckTime(value: string | null | undefined): string {
  if (!value) return "-";
  // SQLite datetime('now') stores UTC. Convert to browser local time before showing.
  const d = new Date(`${value.replace(" ", "T")}Z`);
  if (!Number.isFinite(d.getTime())) return value.replace("T", " ").slice(11, 16) || value;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDiaryTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(`${value.replace(" ", "T")}Z`);
  if (!Number.isFinite(d.getTime())) {
    const raw = value.replace("T", " ");
    const [date = "", time = ""] = raw.split(" ");
    return `${date.slice(5)} ${time.slice(0, 5)}`.trim();
  }
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function parseRecommendations(entry: AiDiaryEntry): { title: string; text: string; confidence?: string }[] {
  try {
    const arr = JSON.parse(entry.recommendations_json || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function actionDescription(action: string | null | undefined): string {
  switch (action) {
    case "hold":
      return "Удержание: позиция находится в целевом диапазоне, ставку менять не нужно.";
    case "raise":
      return "Повышение: позиция ниже целевого диапазона, система увеличивает ставку на шаг вверх.";
    case "lower":
      return "Снижение: позиция лучше целевого диапазона, система уменьшает ставку на обычный шаг вниз.";
    case "lower_probe":
      return "Пробное снижение: позиция держится в цели, включена экономия, система пробует снизить ставку и проверить, удержится ли позиция.";
    case "keep_lowered":
      return "Проба успешна: сниженная ставка удержала позицию в цели, система считает её новой рабочей ставкой.";
    case "rollback":
      return "Откат: после пробного снижения позиция просела, система возвращает последнюю рабочую ставку.";
    case "rollback_ineffective":
      return "Откат неэффективного повышения: ставка росла, но позиция не улучшалась. Система возвращает дешёвую ставку, на которой позиция была такой же, и временно не повышает её снова.";
    case "raise_paused":
      return "Повышение на паузе: ранее рост ставки не дал улучшения позиции. Пока позиция не стала хуже, система не тратит деньги на повторный подъём.";
    case "cooldown":
      return "Пауза после смены: менять ставку ещё рано, система ждёт окончания cooldown.";
    case "max_reached":
      return "Достигнут максимум: позиция всё ещё ниже цели, но выше максимальной ставки поднимать нельзя.";
    case "min_reached":
      return "Достигнут минимум: позиция лучше цели, но ниже минимальной ставки опускать нельзя.";
    case "position_unavailable":
      return "Позиция не определена: проверка не дала надёжный результат, ставка не меняется до следующего запуска.";
    case "error":
      return "Ошибка проверки или изменения ставки. Ставка не считается успешно изменённой.";
    default:
      return action ? `Действие ${action}: отдельное описание пока не задано.` : "Действия ещё не было.";
  }
}

function actionTitle(action: string | null | undefined, reason?: string | null): string {
  const desc = actionDescription(action);
  return reason ? `${desc}\nПричина: ${reason}` : desc;
}

export default function BidAutomationModal({
  open,
  advertId,
  nmId,
  campaignName,
  phrase,
  currentBidRub,
  minBidRub,
  rule,
  lastLog,
  logs = [],
  onClose,
  onSaved,
}: Props) {
  const defaultMin = Math.max(1, minBidRub || currentBidRub || 1);
  const defaultMax = Math.min(MAX_AUTO_BID_RUB, Math.max(defaultMin, currentBidRub || defaultMin) + 200);
  const [enabled, setEnabled] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [targetFrom, setTargetFrom] = useState(1);
  const [targetTo, setTargetTo] = useState(5);
  const [minBid, setMinBid] = useState(defaultMin);
  const [maxBid, setMaxBid] = useState(defaultMax);
  const [stepUp, setStepUp] = useState(20);
  const [stepDown, setStepDown] = useState(10);
  const [economyEnabled, setEconomyEnabled] = useState(false);
  const [economySuccessRequired, setEconomySuccessRequired] = useState(2);
  const [economyStepDown, setEconomyStepDown] = useState(10);
  const [economyFailureCooldown, setEconomyFailureCooldown] = useState(60);
  const [intervalMin, setIntervalMin] = useState(15);
  const [cooldownMin, setCooldownMin] = useState(30);
  const [maxBidFlash, setMaxBidFlash] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [diaryEntries, setDiaryEntries] = useState<AiDiaryEntry[]>([]);
  const [diaryLoading, setDiaryLoading] = useState(false);
  const [diaryError, setDiaryError] = useState("");

  useEffect(() => {
    if (!open) return;
    setEnabled(boolFromInt(rule?.enabled, false));
    setDryRun(boolFromInt(rule?.dry_run, true));
    setTargetFrom(n(rule?.target_pos_from, 1));
    setTargetTo(n(rule?.target_pos_to, 5));
    setMinBid(n(rule?.min_bid_rub, defaultMin));
    setMaxBid(n(rule?.max_bid_rub, defaultMax));
    setStepUp(n(rule?.step_up_rub, 20));
    setStepDown(n(rule?.step_down_rub, 10));
    setEconomyEnabled(boolFromInt(rule?.economy_enabled, false));
    setEconomySuccessRequired(n(rule?.economy_success_required, 2));
    setEconomyStepDown(n(rule?.economy_step_down_rub, 10));
    setEconomyFailureCooldown(n(rule?.economy_failure_cooldown_min, 60));
    setIntervalMin(n(rule?.interval_min, 15));
    setCooldownMin(n(rule?.cooldown_min, 30));
    setError("");
  }, [open, rule, defaultMin, defaultMax]);

  async function loadDiary() {
    if (!open || !advertId || !nmId || !phrase) return;
    setDiaryError("");
    try {
      const res = await fetch(`/api/ai-diary?advertId=${advertId}&nmId=${nmId}&phrase=${encodeURIComponent(phrase)}&limit=10`);
      const data = await res.json();
      if (data?.ok) setDiaryEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (e) {
      setDiaryError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    loadDiary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, advertId, nmId, phrase]);

  if (!open) return null;

  async function refreshDiary() {
    setDiaryLoading(true);
    setDiaryError("");
    try {
      const res = await fetch("/api/ai-diary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ advertId, nmId, phrase }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setDiaryError(data?.error || `HTTP ${res.status}`);
        return;
      }
      await loadDiary();
    } catch (e) {
      setDiaryError(e instanceof Error ? e.message : String(e));
    } finally {
      setDiaryLoading(false);
    }
  }

  async function save() {
    setError("");
    if (targetFrom < 1 || targetTo < targetFrom) {
      setError("Проверь диапазон позиций");
      return;
    }
    if (minBid < defaultMin || maxBid < minBid) {
      setError(`Диапазон ставки должен начинаться от ${defaultMin} ₽`);
      return;
    }
    if (minBid > MAX_AUTO_BID_RUB || maxBid > MAX_AUTO_BID_RUB) {
      setError(`Максимальная ставка не может быть выше ${MAX_AUTO_BID_RUB} ₽`);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/bid-automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advertId,
          nmId,
          phrase,
          enabled,
          dryRun,
          targetPosFrom: targetFrom,
          targetPosTo: targetTo,
          minBidRub: minBid,
          maxBidRub: maxBid,
          stepUpRub: stepUp,
          stepDownRub: stepDown,
          economyEnabled,
          economySuccessRequired,
          economyStepDownRub: economyStepDown,
          economyFailureCooldownMin: economyFailureCooldown,
          intervalMin,
          cooldownMin,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error || `HTTP ${res.status}`);
        return;
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const field = (
    label: string,
    value: number,
    setter: (v: number) => void,
    min = 1,
    max?: number,
    options?: { flash?: boolean; onOverflow?: () => void },
  ) => (
    <label className="min-w-0">
      <span className="mb-1 block truncate text-[10px] uppercase text-[var(--text-muted)]">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value > 0 ? value : ""}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            setter(0);
            return;
          }
          const next = Math.round(Number(raw));
          if (!Number.isFinite(next)) return;
          if (max != null && next > max) {
            setter(max);
            options?.onOverflow?.();
            return;
          }
          setter(next);
        }}
        onBlur={() => {
          const next = Math.round(Number(value));
          const lowerBound = Math.max(min, Number.isFinite(next) ? next : min);
          setter(max == null ? lowerBound : Math.min(max, lowerBound));
        }}
        className={
          "h-8 w-full rounded border bg-[var(--bg)] px-2 text-sm font-semibold text-[var(--text)] outline-none transition-colors " +
          (options?.flash
            ? "border-[var(--danger)] focus:border-[var(--danger)]"
            : "border-[var(--border)] focus:border-[var(--accent)]")
        }
      />
    </label>
  );

  function flashMaxBidLimit() {
    setMaxBidFlash(true);
    window.setTimeout(() => setMaxBidFlash(false), 900);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onMouseDown={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-[980px] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3 border-b border-[var(--border)] pb-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[var(--text)]">Автоставка</div>
            <div className="truncate text-xs text-[var(--text-muted)]" title={campaignName}>{campaignName}</div>
            <div className="mt-1 truncate text-sm font-mono text-[var(--accent)]" title={phrase}>{phrase}</div>
          </div>
          <div className="flex shrink-0 items-start gap-3">
            <div className="text-right">
              <div className="text-[10px] uppercase text-[var(--text-muted)]">Текущая ставка</div>
              <div className="font-mono text-lg font-semibold text-[var(--text)]">{currentBidRub || defaultMin} ₽</div>
            </div>
            <button onClick={onClose} className="rounded px-2 py-1 text-xl leading-none text-[var(--text-muted)] hover:text-[var(--text)]">x</button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(300px,0.9fr)_minmax(360px,1.1fr)]">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="flex h-8 items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg)] px-2">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                <span className="truncate">Включить</span>
              </label>
              <label className="flex h-8 items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg)] px-2">
                <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
                <span className="truncate">Dry-run</span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {field("Поз. от", targetFrom, setTargetFrom)}
              {field("Поз. до", targetTo, setTargetTo)}
              {field("Мин., ₽", minBid, setMinBid, defaultMin, MAX_AUTO_BID_RUB)}
              {field("Макс., ₽", maxBid, setMaxBid, defaultMin, MAX_AUTO_BID_RUB, {
                flash: maxBidFlash,
                onOverflow: flashMaxBidLimit,
              })}
              {field("Вверх, ₽", stepUp, setStepUp)}
              {field("Вниз, ₽", stepDown, setStepDown)}
              {field("Интервал", intervalMin, setIntervalMin, 5)}
              {field("Пауза", cooldownMin, setCooldownMin, 2)}
            </div>

            <div className="rounded border border-[var(--border)] bg-[var(--bg)] p-3">
              <label className="mb-3 flex h-8 items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg-card)] px-2 text-sm">
                <input type="checkbox" checked={economyEnabled} onChange={(e) => setEconomyEnabled(e.target.checked)} />
                <span className="truncate text-[var(--text)]">Экономить внутри диапазона</span>
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {field("Успешных", economySuccessRequired, setEconomySuccessRequired, 1)}
                {field("Экономия, ₽", economyStepDown, setEconomyStepDown)}
                {field("После провала", economyFailureCooldown, setEconomyFailureCooldown, 5)}
              </div>
              <div className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">
                Если позиция держится в цели, система пробует снизить ставку. Если позиция просела, вернёт последнюю рабочую.
              </div>
            </div>

            {rule?.economy_enabled === 1 && (
              <div className="rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
                Экономия: стабильных проверок <span className="font-mono">{rule.stable_in_range_count || 0}</span>,
                {" "}рабочая ставка <span className="font-mono">{rule.last_good_bid_rub || "-"} ₽</span>,
                {" "}проба <span className="font-mono">{rule.probe_bid_rub || "-"}</span>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5">
                <div className="text-[10px] uppercase text-[var(--text-muted)]">Позиция</div>
                <div className="font-mono text-[var(--text)]">{lastLog?.ad_pos || "-"}</div>
              </div>
              <div className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5">
                <div className="text-[10px] uppercase text-[var(--text-muted)]">Действие</div>
                <div className="truncate font-mono text-[var(--text)]" title={actionTitle(lastLog?.action, lastLog?.reason)}>{lastLog?.action || "-"}</div>
              </div>
              <div className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5">
                <div className="text-[10px] uppercase text-[var(--text-muted)]">Проверка</div>
                <div className="font-mono text-[var(--text)]">{formatCheckTime(lastLog?.checked_at)}</div>
              </div>
            </div>

            <div className="rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
              <div className="mb-2 text-xs font-semibold uppercase text-[var(--text-muted)]">Последние 20 проверок</div>
              {logs.length === 0 ? (
                <div className="py-2 text-xs text-[var(--text-muted)]">Истории пока нет</div>
              ) : (
                <div className="max-h-44 overflow-y-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead className="sticky top-0 bg-[var(--bg)] text-[10px] uppercase text-[var(--text-muted)]">
                      <tr>
                        <th className="py-1 pr-2 text-left font-semibold">Время</th>
                        <th className="py-1 px-2 text-right font-semibold">Поз</th>
                        <th className="py-1 px-2 text-right font-semibold">Было</th>
                        <th className="py-1 px-2 text-right font-semibold">Стало</th>
                        <th className="py-1 pl-2 text-left font-semibold">Действие</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log) => (
                        <tr key={log.id} className="border-t border-[var(--border)]/70">
                          <td className="py-1 pr-2 font-mono text-[var(--text-muted)]">{formatCheckTime(log.checked_at)}</td>
                          <td className="py-1 px-2 text-right font-mono text-[var(--text)]">{log.ad_pos || "-"}</td>
                          <td className="py-1 px-2 text-right font-mono text-[var(--text)]">{log.old_bid_rub} ₽</td>
                          <td className="py-1 px-2 text-right font-mono text-[var(--text)]">{log.new_bid_rub} ₽</td>
                          <td className="py-1 pl-2">
                            <span
                              className={
                                "font-mono " +
                                (log.status === "error" ? "text-[var(--danger)]" :
                                  log.action === "raise" || log.action === "rollback" ? "text-[var(--warning)]" :
                                  log.action === "lower" || log.action === "lower_probe" || log.action === "keep_lowered" ? "text-[var(--success)]" :
                                  "text-[var(--text-muted)]")
                              }
                              title={actionTitle(log.action, log.reason)}
                            >
                              {log.action}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase text-[var(--text-muted)]">ИИ-дневник</div>
                  <div className="text-[11px] text-[var(--text-muted)]">Только анализ и рекомендации</div>
                </div>
                <button
                  onClick={refreshDiary}
                  disabled={diaryLoading}
                  className="rounded border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text)] hover:bg-[var(--bg-card-hover)] disabled:opacity-60"
                >
                  {diaryLoading ? "Анализ..." : "Обновить"}
                </button>
              </div>
              {diaryError && <div className="mb-2 rounded bg-[var(--danger)] px-2 py-1.5 text-xs text-white">{diaryError}</div>}
              {diaryEntries.length === 0 ? (
                <div className="py-2 text-xs text-[var(--text-muted)]">
                  Выводов пока нет. Нажмите «Обновить», чтобы собрать факты по ставке, позиции и воронке.
                </div>
              ) : (
                <div className="max-h-44 space-y-2 overflow-y-auto">
                  {diaryEntries.map((entry) => {
                    const recs = parseRecommendations(entry);
                    return (
                      <div key={entry.id} className="rounded border border-[var(--border)] bg-[var(--bg-card)] p-2 text-xs">
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <div className="font-semibold text-[var(--text)]">{entry.title}</div>
                          <div
                            className={
                              "shrink-0 font-mono " +
                              (entry.severity === "warning" ? "text-[var(--warning)]" :
                                entry.severity === "success" ? "text-[var(--success)]" :
                                "text-[var(--text-muted)]")
                            }
                          >
                            {formatDiaryTime(entry.created_at)}
                          </div>
                        </div>
                        <div className="whitespace-pre-line leading-relaxed text-[var(--text-muted)]">{entry.summary}</div>
                        {recs.length > 0 && (
                          <div className="mt-2 space-y-1.5">
                            {recs.slice(0, 2).map((rec, idx) => (
                              <div key={`${entry.id}-${idx}`} className="rounded bg-[var(--bg)] px-2 py-1.5">
                                <div className="font-semibold text-[var(--text)]">{rec.title}</div>
                                <div className="mt-0.5 leading-relaxed text-[var(--text-muted)]">{rec.text}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {lastLog && (
          <div className="mt-3 rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
            Последняя проверка: <span className="font-mono">{formatCheckTime(lastLog.checked_at)}</span>,
            {" "}<span className="font-mono">{lastLog.ad_pos || "-"}</span> позиция,
            {" "}<span className="font-mono">{lastLog.action}</span>,
            {" "}<span className="font-mono">{lastLog.old_bid_rub} {"->"} {lastLog.new_bid_rub} ₽</span>
          </div>
        )}

        {error && <div className="mt-3 rounded bg-[var(--danger)] px-3 py-2 text-sm text-white">{error}</div>}

        <div className="mt-4 flex justify-end gap-2 border-t border-[var(--border)] pt-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded border border-[var(--border)] px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-card-hover)] disabled:opacity-60"
          >
            Отмена
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "Сохраняю..." : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}
