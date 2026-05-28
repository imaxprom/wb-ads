"use client";

import { useEffect, useRef, useState } from "react";

// Тестовая страница: превью UI для пополнения бюджета рекламной кампании.
// Реального WB-запроса не делает — на «Пополнить» показывает alert с body,
// который УШЁЛ БЫ в /api/advert/budget-deposit (и далее в WB).

interface DemoCampaign {
  advertId: number;
  name: string;
  bidRub: number;
  budgetRub: number;
  bidUpdatedHoursAgo: number;
  budgetUpdatedHoursAgo: number;
}

const DEMO_CAMPAIGNS: DemoCampaign[] = [
  { advertId: 19494001, name: "Стринги Авто", bidRub: 121, budgetRub: 4072, bidUpdatedHoursAgo: 288, budgetUpdatedHoursAgo: 3 },
  { advertId: 25141382, name: "Майки летние", bidRub: 350, budgetRub: 12500, bidUpdatedHoursAgo: 12, budgetUpdatedHoursAgo: 26 },
  { advertId: 23290966, name: "Носки набор 5шт", bidRub: 85, budgetRub: 890, bidUpdatedHoursAgo: 168, budgetUpdatedHoursAgo: 1 },
];

// Демо-баланс. Реально берётся из /api/sync/balance.
const DEMO_BALANCE = {
  account: 8420,    // счёт продавца
  ad_balance: 2566672, // баланс рекламного кабинета
  bonuses: 1850,    // промо-бонусы
  bonus_percent_max: 25, // % от пополнения, который можно покрыть бонусами
};

type Source = 0 | 1 | 3; // 0=Счёт, 1=Баланс, 3=Бонусы

const SOURCE_LABELS: Record<Source, { label: string; available: number; muted?: string }> = {
  0: { label: "Счёт продавца", available: DEMO_BALANCE.account, muted: "личный счёт магазина" },
  1: { label: "Баланс кабинета", available: DEMO_BALANCE.ad_balance, muted: "WB Продвижение" },
  3: { label: "Промо-бонусы", available: DEMO_BALANCE.bonuses, muted: `только полностью бонусами` },
};

function fmtRub(n: number): string {
  return n.toLocaleString("ru-RU") + " ₽";
}
function fmtRel(hours: number): string {
  if (hours < 1) return "только что";
  if (hours < 24) return `${Math.round(hours)} ч. назад`;
  return `${Math.round(hours / 24)} дн. назад`;
}

export default function TestBudgetPage() {
  const [openFor, setOpenFor] = useState<DemoCampaign | null>(null);

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", color: "var(--text)" }} className="p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-xl font-semibold mb-2">Тестовая страница: пополнение бюджета</h1>
        <p className="text-sm text-[var(--text-muted)] mb-6">
          Кликни по «Бюджет» в любой карточке. Реального запроса в WB не будет —
          на «Пополнить» откроется alert с body, который УШЁЛ БЫ в endpoint.
          <br />
          Демо-балансы: счёт <b>{fmtRub(DEMO_BALANCE.account)}</b>, кабинет <b>{fmtRub(DEMO_BALANCE.ad_balance)}</b>, бонусы <b>{fmtRub(DEMO_BALANCE.bonuses)}</b> (макс. {DEMO_BALANCE.bonus_percent_max}% от пополнения).
        </p>

        <div className="space-y-3">
          {DEMO_CAMPAIGNS.map((c) => (
            <div
              key={c.advertId}
              className="border border-[var(--border)] rounded-lg p-4"
              style={{ background: "var(--bg-card)" }}
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-xs text-[var(--text-muted)]">ID {c.advertId}</div>
                </div>
                <div className="text-xs text-[var(--text-muted)]">верхняя таблица — превью</div>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <div className="text-[var(--accent)] font-semibold">{fmtRub(c.bidRub)}</div>
                  <div className="text-xs text-[var(--text-muted)]">ставка</div>
                  <div className="text-xs text-[var(--text-muted)]">↻ {fmtRel(c.bidUpdatedHoursAgo)}</div>
                </div>
                <div>
                  <button
                    onClick={() => setOpenFor(c)}
                    className="text-[var(--accent)] font-semibold hover:underline cursor-pointer"
                    title="Клик — пополнить бюджет"
                  >
                    {fmtRub(c.budgetRub)}
                  </button>
                  <div className="text-xs text-[var(--text-muted)]">бюджет</div>
                  <div className="text-xs text-[var(--text-muted)]">↗ {fmtRel(c.budgetUpdatedHoursAgo)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {openFor && <BudgetDepositModal campaign={openFor} onClose={() => setOpenFor(null)} />}
    </div>
  );
}

function BudgetDepositModal({ campaign, onClose }: { campaign: DemoCampaign; onClose: () => void }) {
  const [source, setSource] = useState<Source>(1); // дефолт — Баланс кабинета
  const [sumStr, setSumStr] = useState("1000");
  const [useBonuses, setUseBonuses] = useState(false);
  const sumRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => {
      sumRef.current?.focus();
      sumRef.current?.select();
    });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sumNum = parseInt(sumStr.replace(/\D/g, ""), 10);
  const valid = Number.isFinite(sumNum) && sumNum > 0;

  // Бонусы можно домешать только при Счёт/Баланс. На Бонусы (type=3) cashback_* запрещены.
  const bonusAllowed = source !== 3;
  // Используем максимально доступное количество бонусов:
  //   - если бонусов больше, чем сумма — бонусами оплачивается всё (sumNum),
  //   - если меньше — бонусами оплачивается остаток (DEMO_BALANCE.bonuses), доплата с источника.
  const cashbackSum = bonusAllowed && useBonuses && valid
    ? Math.min(DEMO_BALANCE.bonuses, sumNum)
    : 0;
  const fromSource = sumNum - cashbackSum;
  // cashback_percent в WB — обязательный параметр при mix. Считаем фактический процент.
  const cashbackPercent = valid && cashbackSum > 0 ? Math.ceil((cashbackSum / sumNum) * 100) : 0;

  // Превью body запроса в WB — то, что уйдёт при настоящей отправке.
  const wbBody: Record<string, unknown> = {
    sum: sumNum,
    type: source,
    return: true,
  };
  if (cashbackSum > 0) {
    wbBody.cashback_sum = cashbackSum;
    wbBody.cashback_percent = cashbackPercent;
  }

  const submit = () => {
    if (!valid) return;
    const wbUrl = `https://advert-api.wildberries.ru/adv/v1/budget/deposit?id=${campaign.advertId}`;
    const sourceLabel = SOURCE_LABELS[source].label;
    alert(
      `Демо: реального запроса не было.\n\n` +
      `Кампания: ${campaign.name} (${campaign.advertId})\n` +
      `Источник: ${sourceLabel}\n` +
      `Сумма: ${fmtRub(sumNum)}\n` +
      (cashbackSum > 0 ? `  из них бонусами: ${fmtRub(cashbackSum)} (${cashbackPercent}%)\n  с ${sourceLabel}: ${fmtRub(fromSource)}\n` : "") +
      `\nWB endpoint: POST ${wbUrl}\n` +
      `Body:\n${JSON.stringify(wbBody, null, 2)}`,
    );
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="rounded-lg border border-[var(--border)]"
        style={{ background: "var(--bg-card)", width: "100%", maxWidth: 380, padding: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between" style={{ marginBottom: 18, gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="text-xs text-[var(--text-muted)]" style={{ marginBottom: 2 }}>Пополнить бюджет</div>
            <div className="font-semibold" style={{ marginBottom: 2 }}>{campaign.name}</div>
            <div className="text-xs text-[var(--text-muted)]">текущий бюджет: {fmtRub(campaign.budgetRub)}</div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)]"
            style={{ fontSize: 20, lineHeight: 1, padding: "0 4px" }}
          >×</button>
        </div>

        {/* Сумма */}
        <label className="block text-xs text-[var(--text-muted)]" style={{ marginBottom: 6 }}>Сумма пополнения</label>
        <div className="flex items-center" style={{ marginBottom: 18, gap: 8 }}>
          <input
            ref={sumRef}
            type="text"
            inputMode="numeric"
            value={sumStr}
            onChange={(e) => setSumStr(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded text-right text-base font-mono focus:outline-none focus:border-[var(--accent)]"
            style={{ padding: "8px 12px", minWidth: 0 }}
          />
          <span className="text-[var(--text-muted)]">₽</span>
        </div>

        {/* Источник */}
        <div className="text-xs text-[var(--text-muted)]" style={{ marginBottom: 8 }}>Источник пополнения</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
          {([0, 1, 3] as Source[]).map((s) => {
            const meta = SOURCE_LABELS[s];
            const insufficient = valid && (s === source ? fromSource : sumNum) > meta.available;
            return (
              <label
                key={s}
                className={
                  "flex items-center rounded border cursor-pointer transition-colors " +
                  (source === s
                    ? "border-[var(--accent)] bg-[var(--accent)]/10"
                    : "border-[var(--border)] hover:border-[var(--text-muted)]")
                }
                style={{ gap: 10, padding: "8px 12px" }}
              >
                <input
                  type="radio"
                  checked={source === s}
                  onChange={() => setSource(s)}
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
                  {fmtRub(meta.available)}
                </div>
              </label>
            );
          })}
        </div>

        {/* Опционально домешать бонусы — только для type 0/1 */}
        {bonusAllowed && (
          <label
            className="flex items-center text-sm cursor-pointer"
            style={{ gap: 8, marginBottom: 8 }}
          >
            <input
              type="checkbox"
              checked={useBonuses}
              onChange={(e) => setUseBonuses(e.target.checked)}
              className="accent-[var(--accent)]"
              style={{ flexShrink: 0 }}
            />
            <span>Использовать промо-бонусы</span>
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
            {" "}<b className="text-[var(--text)]">{fmtRub(DEMO_BALANCE.bonuses)}</b>.
            Остаток суммы спишется со «{SOURCE_LABELS[source].label}».
          </div>
        )}

        {/* Кнопки */}
        <div className="flex items-center" style={{ gap: 10, marginTop: 6 }}>
          <button
            onClick={onClose}
            className="flex-1 rounded border border-[var(--border)] text-sm hover:bg-[var(--bg-card-hover)]"
            style={{ padding: "10px 14px" }}
          >
            Отмена
          </button>
          <button
            disabled={!valid}
            onClick={submit}
            className={
              "flex-1 rounded text-sm font-semibold " +
              (valid
                ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                : "bg-[var(--border)] text-[var(--text-muted)] cursor-not-allowed")
            }
            style={{ padding: "10px 14px" }}
          >
            Пополнить
          </button>
        </div>
      </div>
    </div>
  );
}
