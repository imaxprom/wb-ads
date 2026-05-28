"use client";

import { useEffect, useRef, useState } from "react";
import { fmtRub } from "@/lib/format";

// Источник пополнения: 0=Счёт, 1=Баланс кабинета, 3=Бонусы. Совпадает с WB enum.
type Source = 0 | 1 | 3;

// Лимиты пополнения. WB-минимум — 1000 ₽ (явно сказано в 400-ответе deposit).
// Максимум 30 000 ₽ за операцию — наш лимит для защиты от опечаток
// (введёшь 100000 вместо 10000 — несколько дней рекламы спишутся враз).
const MIN_DEPOSIT_RUB = 1000;
const MAX_DEPOSIT_RUB = 30000;

// Быстрые суммы для дропдауна рядом с инпутом.
const QUICK_SUMS = [1000, 2000, 3000, 4000, 5000, 10000, 15000, 20000, 30000];

interface BalanceSnapshot {
  ok: boolean;
  account: number;        // net (счёт продавца)
  ad_balance: number;     // balance (баланс кабинета по взаиморасчёту)
  bonuses: number;        // total bonus
  bonus_percent_max: number; // max percent из cashbacks[].percent (0 если нет акций)
}

interface BudgetDepositModalProps {
  advertId: number;
  campaignName: string;
  currentBudgetRub: number;
  onClose: () => void;
  onSuccess: (newTotalRub: number) => void;
}

const SOURCE_LABELS: Record<Source, { label: string; muted?: string }> = {
  0: { label: "Счёт продавца", muted: "личный счёт магазина" },
  1: { label: "Баланс кабинета", muted: "WB Продвижение" },
  3: { label: "Промо-бонусы", muted: "только полностью бонусами" },
};

export default function BudgetDepositModal({ advertId, campaignName, currentBudgetRub, onClose, onSuccess }: BudgetDepositModalProps) {
  const [source, setSource] = useState<Source>(1);
  const [sumStr, setSumStr] = useState("1000");
  const [useBonuses, setUseBonuses] = useState(false);
  const [balance, setBalance] = useState<BalanceSnapshot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const sumRef = useRef<HTMLInputElement>(null);
  const pickerWrapRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(false);

  // Закрытие выпадашки быстрых сумм по клику вне.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = pickerWrapRef.current;
      if (el && !el.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  // Live-fetch актуальных балансов при открытии. Заодно — переключаемся на первый
  // непустой источник, если выбранный по умолчанию (Баланс) пуст.
  useEffect(() => {
    fetch("/api/advert/balance-snapshot")
      .then((r) => r.json())
      .then((d: BalanceSnapshot) => {
        setBalance(d);
        const order: Source[] = [1, 0, 3]; // приоритет: Баланс → Счёт → Бонусы
        const availOf: Record<Source, number> = { 0: d.account, 1: d.ad_balance, 3: d.bonuses };
        if (availOf[source] === 0) {
          const firstNonZero = order.find((s) => availOf[s] > 0);
          if (firstNonZero != null) setSource(firstNonZero);
        }
      })
      .catch(() => setBalance({ ok: false, account: 0, ad_balance: 0, bonuses: 0, bonus_percent_max: 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Раньше тут был auto-focus + select() — пользователь жаловался на выделенный 1000
  // при открытии модалки. Убираем и focus, и select: модалка стартует со значением «1000»
  // в поле, без подсветки и без курсора. Пользователь кликает по полю когда нужно править.

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !submitting) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const sumNum = parseInt(sumStr.replace(/\D/g, ""), 10);
  const positive = Number.isFinite(sumNum) && sumNum > 0;
  const tooLow = positive && sumNum < MIN_DEPOSIT_RUB;
  const tooHigh = positive && sumNum > MAX_DEPOSIT_RUB;
  const valid = positive && !tooLow && !tooHigh;

  // Mix бонусов разрешён только при источнике Счёт/Баланс.
  const bonusAllowed = source !== 3;
  const bonusesAvail = balance?.bonuses ?? 0;
  // Используем максимально доступное количество бонусов:
  //   - кэп от WB: sum * percent / 100 (cap из cashbacks[].percent)
  //   - кэп от своих средств: bonusesAvail
  // Берём min из двух → максимум, что можно списать бонусами.
  const maxByPercent = balance && balance.bonus_percent_max > 0 && valid
    ? Math.floor(sumNum * (balance.bonus_percent_max / 100))
    : (valid ? sumNum : 0);
  const cashbackSum = bonusAllowed && useBonuses && valid
    ? Math.min(bonusesAvail, maxByPercent)
    : 0;
  const fromSource = sumNum - cashbackSum;

  async function submit() {
    if (!valid || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/advert/budget-deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ advertId, sum: sumNum, type: source, useBonuses }),
      });
      const d = await res.json();
      if (!d.ok) {
        setErrorMsg(d.error || `HTTP ${res.status}`);
        submittingRef.current = false;
        setSubmitting(false);
        return;
      }
      onSuccess(d.total ?? (currentBudgetRub + sumNum));
      onClose();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  // Доступные суммы по источникам (для tooltip/insufficient-warning).
  const availableBy = (s: Source): number => {
    if (!balance) return 0;
    if (s === 0) return balance.account;
    if (s === 1) return balance.ad_balance;
    if (s === 3) return balance.bonuses;
    return 0;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)", padding: 16 }}
      onClick={() => { if (!submitting) onClose(); }}
    >
      <div
        className="rounded-lg border border-[var(--border)]"
        style={{ background: "var(--bg-card)", width: "100%", maxWidth: 380, padding: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between" style={{ marginBottom: 18, gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="text-xs text-[var(--text-muted)]" style={{ marginBottom: 2 }}>Пополнить бюджет</div>
            <div className="font-semibold" style={{ marginBottom: 2 }}>{campaignName}</div>
            <div className="text-xs text-[var(--text-muted)]">
              текущий бюджет: {fmtRub(currentBudgetRub)}
              {valid && (
                <>
                  {" → "}
                  <span className="text-[var(--accent)] font-semibold">{fmtRub(currentBudgetRub + sumNum)}</span>
                </>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-[var(--text-muted)] hover:text-[var(--text)]"
            style={{ fontSize: 20, lineHeight: 1, padding: "0 4px" }}
          >×</button>
        </div>

        <label className="block text-xs text-[var(--text-muted)]" style={{ marginBottom: 6 }}>Сумма пополнения</label>
        <div className="flex items-center" style={{ gap: 10 }}>
          <div ref={pickerWrapRef} style={{ position: "relative", flexShrink: 0 }}>
            <input
              ref={sumRef}
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={sumStr}
              disabled={submitting}
              onChange={(e) => setSumStr(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              className="bg-[var(--bg)] border rounded text-right text-base font-mono focus:outline-none"
              style={{
                padding: "8px 26px 8px 12px",
                width: 130,
                borderColor: tooLow || tooHigh ? "var(--danger)" : "var(--border)",
              }}
            />
            {/* Кнопка-стрелка внутри инпута справа */}
            <button
              type="button"
              disabled={submitting}
              onClick={() => setPickerOpen((v) => !v)}
              title="Выбрать сумму"
              style={{
                position: "absolute",
                right: 4,
                top: "50%",
                transform: "translateY(-50%)",
                padding: "2px 4px",
                background: "transparent",
                border: "none",
                cursor: submitting ? "default" : "pointer",
                color: "var(--text-muted)",
                fontSize: 10,
                lineHeight: 1,
              }}
              className="hover:text-[var(--text)]"
            >
              ▼
            </button>
            {pickerOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  zIndex: 60,
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
                  width: 130,
                  padding: 4,
                }}
              >
                {QUICK_SUMS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => { setSumStr(String(q)); setPickerOpen(false); requestAnimationFrame(() => sumRef.current?.focus()); }}
                    className="hover:bg-[var(--bg-card-hover)]"
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "right",
                      padding: "6px 12px",
                      background: "transparent",
                      border: "none",
                      color: "var(--text)",
                      fontFamily: "monospace",
                      fontSize: 13,
                      cursor: "pointer",
                      borderRadius: 4,
                    }}
                  >
                    {q.toLocaleString("ru-RU")} ₽
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="text-[var(--text-muted)]" style={{ flexShrink: 0 }}>₽</span>
          <span
            className="text-xs text-[var(--text-muted)]"
            style={{ lineHeight: 1.3, whiteSpace: "nowrap" }}
            title={`Защита от опечатки: разрешённый диапазон одного пополнения — от ${MIN_DEPOSIT_RUB.toLocaleString("ru-RU")} до ${MAX_DEPOSIT_RUB.toLocaleString("ru-RU")} ₽`}
          >
            Max {MAX_DEPOSIT_RUB.toLocaleString("ru-RU")} ₽ за операцию
          </span>
        </div>
        {(tooLow || tooHigh) && (
          <div className="text-xs" style={{ color: "var(--danger)", marginTop: 4 }}>
            {tooLow && `минимум ${MIN_DEPOSIT_RUB.toLocaleString("ru-RU")} ₽`}
            {tooHigh && `максимум ${MAX_DEPOSIT_RUB.toLocaleString("ru-RU")} ₽ за одну операцию`}
          </div>
        )}
        <div style={{ marginBottom: 18 }} />

        <div className="text-xs text-[var(--text-muted)]" style={{ marginBottom: 8 }}>Источник пополнения</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
          {([1, 0, 3] as Source[]).map((s) => {
            const meta = SOURCE_LABELS[s];
            const avail = availableBy(s);
            // Источник недоступен, если на нём 0 (после загрузки балансов) — disable + grey.
            const disabled = balance != null && avail === 0;
            const insufficient = balance && valid && !disabled && (s === source ? fromSource : sumNum) > avail;
            return (
              <label
                key={s}
                className={
                  "flex items-center rounded border transition-colors " +
                  (disabled
                    ? "border-[var(--border)] cursor-not-allowed"
                    : source === s
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 cursor-pointer"
                      : "border-[var(--border)] hover:border-[var(--text-muted)] cursor-pointer")
                }
                style={{ gap: 10, padding: "8px 12px", opacity: disabled ? 0.45 : 1 }}
              >
                <input
                  type="radio"
                  checked={source === s}
                  disabled={submitting || disabled}
                  onChange={() => { if (!disabled) setSource(s); }}
                  className="accent-[var(--accent)]"
                  style={{ flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="text-sm font-semibold">{meta.label}</div>
                  {meta.muted && <div className="text-xs text-[var(--text-muted)]" style={{ marginTop: 1 }}>{meta.muted}</div>}
                </div>
                <div
                  className={"text-xs font-mono " + (insufficient ? "text-[var(--danger)]" : "text-[var(--text-muted)]")}
                  style={{ flexShrink: 0 }}
                >
                  {balance ? fmtRub(avail) : "…"}
                </div>
              </label>
            );
          })}
        </div>

        {bonusAllowed && (
          <label
            className="flex items-center text-sm cursor-pointer"
            style={{ gap: 8, marginBottom: 8 }}
          >
            <input
              type="checkbox"
              checked={useBonuses}
              disabled={submitting || bonusesAvail === 0}
              onChange={(e) => setUseBonuses(e.target.checked)}
              className="accent-[var(--accent)]"
              style={{ flexShrink: 0 }}
            />
            <span className={bonusesAvail === 0 ? "text-[var(--text-muted)]" : ""}>
              Использовать промо-бонусы
              {bonusesAvail === 0 && balance && <span className="text-xs"> (нет доступных)</span>}
            </span>
          </label>
        )}
        {bonusAllowed && useBonuses && (
          <div
            className="rounded text-xs leading-snug"
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
              marginLeft: 24,
              marginBottom: 18,
              padding: "8px 12px",
            }}
          >
            Будет использовано максимально возможное количество промо-бонусов из доступных
            {" "}<b className="text-[var(--text)]">{fmtRub(bonusesAvail)}</b>.
            Остаток суммы спишется со «{SOURCE_LABELS[source].label}».
          </div>
        )}

        {errorMsg && (
          <div
            className="rounded text-xs"
            style={{ background: "var(--danger)", color: "white", padding: "8px 12px", marginBottom: 12 }}
          >
            {errorMsg}
          </div>
        )}

        <div className="flex items-center" style={{ gap: 10, marginTop: 6 }}>
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded border border-[var(--border)] text-sm hover:bg-[var(--bg-card-hover)]"
            style={{ padding: "10px 14px" }}
          >
            Отмена
          </button>
          <button
            disabled={!valid || submitting}
            onClick={submit}
            className={
              "flex-1 rounded text-sm font-semibold " +
              (valid && !submitting
                ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                : "bg-[var(--border)] text-[var(--text-muted)] cursor-not-allowed")
            }
            style={{ padding: "10px 14px" }}
          >
            {submitting ? "Отправляем…" : "Пополнить"}
          </button>
        </div>
      </div>
    </div>
  );
}
