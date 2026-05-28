"use client";

import { useState, useEffect, useRef } from "react";

interface Account {
  id: number;
  phone: string;
  name: string | null;
  connection: string;
  access: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  store_name: string | null;
  last_check_at: string | null;
}

interface StoreInfo {
  hasKey: boolean;
  masked: string;
  supplierName: string;
}

const WB_MAX_BID_RUB = 29999;

type BidLimitKey = "max_bid_manual_auction_rub" | "max_bid_uni_rub" | "max_bid_cpc_rub";

const BID_LIMIT_FIELDS: { key: BidLimitKey; label: string; description: string }[] = [
  { key: "max_bid_manual_auction_rub", label: "Аукцион", description: "Ручные ставки по фразам" },
  { key: "max_bid_uni_rub", label: "Uni", description: "Единая ставка кампании" },
  { key: "max_bid_cpc_rub", label: "CPC", description: "Кампании с оплатой за клик" },
];

function normalizeLimit(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return WB_MAX_BID_RUB;
  return Math.max(1, Math.min(WB_MAX_BID_RUB, n));
}

// ═══════════════════════════════════════════
// Top bar: phone input + API token button
// ═══════════════════════════════════════════

function TopActions({ onAccountAdded }: { onAccountAdded: () => void }) {
  const [phone, setPhone] = useState("+7");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiInput, setShowApiInput] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (step === "code") codeRef.current?.focus(); }, [step]);

  async function handleSendPhone() {
    const cleaned = phone.replace(/[^\d+]/g, "");
    if (cleaned.length < 11) { setError("Введите номер"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/wb/auth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cleaned }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error || "Ошибка"); }
      else if (data.step === "code") { setCode(""); setStep("code"); }
      else { setError(data.error || "Неожиданный ответ"); }
    } catch { setError("Ошибка соединения"); }
    finally { setLoading(false); }
  }

  async function handleSubmitCode() {
    const cleaned = code.replace(/\D/g, "");
    if (cleaned.length < 4) { setError("Введите код"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/wb/auth/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: cleaned }),
      });
      const data = await res.json();
      if (data.step === "authenticated") {
        // Save account info from tokens
        const tokensRes = await fetch("/api/wb/auth");
        const session = await tokensRes.json();

        // Read supplier info from saved tokens
        let supplierInfo = { supplier_id: "", supplier_name: "", store_name: "" };
        try {
          const infoRes = await fetch("/api/accounts/info");
          if (infoRes.ok) supplierInfo = await infoRes.json();
        } catch { /* skip */ }

        await fetch("/api/accounts", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: phone.replace(/[^\d+]/g, ""),
            connection: "Активен",
            supplier_id: supplierInfo.supplier_id,
            supplier_name: supplierInfo.supplier_name,
            store_name: supplierInfo.store_name,
          }),
        });

        setStep("phone"); setPhone("+7"); setCode("");
        onAccountAdded();
      } else {
        setError(data.error || "Ошибка");
      }
    } catch { setError("Ошибка соединения"); }
    finally { setLoading(false); }
  }

  async function handleSaveApiKey() {
    if (!apiKeyInput.trim()) return;
    setLoading(true);
    await fetch("/api/settings/apikey", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: apiKeyInput.trim() }),
    });
    setApiKeyInput(""); setShowApiInput(false); setLoading(false);
    onAccountAdded();
  }

  return (
    <div className="space-y-2 mb-6">
      <div className="flex items-center gap-3 flex-wrap">
        {step === "phone" ? (
          <>
            <span className="text-sm text-[var(--text-muted)]">Добавить тел: +</span>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="+79001234567"
              className="w-44 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
              onKeyDown={(e) => e.key === "Enter" && handleSendPhone()} disabled={loading} />
            <button onClick={handleSendPhone} disabled={loading}
              className="px-4 py-2 border border-[var(--border)] text-sm rounded-lg hover:bg-[var(--bg-card-hover)] transition-colors disabled:opacity-50">
              {loading ? "..." : "Запросить код"}
            </button>
          </>
        ) : (
          <>
            <span className="text-sm text-[var(--accent)]">Код отправлен на {phone}</span>
            <input ref={codeRef} type="text" inputMode="numeric" value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="Код из SMS" maxLength={6}
              className="w-28 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-center tracking-widest focus:outline-none focus:border-[var(--accent)]"
              onKeyDown={(e) => e.key === "Enter" && handleSubmitCode()} disabled={loading} />
            <button onClick={handleSubmitCode} disabled={loading}
              className="px-4 py-2 bg-[var(--accent)] text-white text-sm rounded-lg transition-colors disabled:opacity-50">
              {loading ? "..." : "Подтвердить"}
            </button>
            <button onClick={() => { setStep("phone"); setError(""); }}
              className="px-3 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)]">Отмена</button>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {showApiInput ? (
            <>
              <input type="password" value={apiKeyInput} onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="Вставьте API-токен"
                className="w-64 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
                onKeyDown={(e) => e.key === "Enter" && handleSaveApiKey()} />
              <button onClick={handleSaveApiKey} disabled={!apiKeyInput.trim()}
                className="px-4 py-2 bg-[var(--accent)] text-white text-sm rounded-lg transition-colors disabled:opacity-50">
                Сохранить
              </button>
              <button onClick={() => setShowApiInput(false)}
                className="px-3 py-2 text-sm text-[var(--text-muted)]">Отмена</button>
            </>
          ) : (
            <button onClick={() => setShowApiInput(true)}
              className="px-4 py-2 border border-[var(--accent)] text-[var(--accent)] text-sm rounded-lg hover:bg-[var(--accent)]/10 transition-colors">
              Добавить API-токен
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="text-sm text-[var(--danger)]">{error}</div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// Accounts table
// ═══════════════════════════════════════════

function fmtRel(iso: string | null): string {
  if (!iso) return "—";
  // DB stores "YYYY-MM-DD HH:MM:SS" in UTC
  const d = new Date(iso.replace(" ", "T") + "Z");
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин. назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч. назад`;
  return `${Math.floor(diff / 86400)} дн. назад`;
}

function AccountsTable({ accounts, onRefresh }: { accounts: Account[]; onRefresh: () => void }) {
  const [checking, setChecking] = useState(false);

  async function handleDelete(phone: string) {
    await fetch("/api/accounts", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    onRefresh();
  }

  async function handleCheckNow() {
    setChecking(true);
    try {
      await fetch("/api/accounts/check-session", { method: "POST" });
      onRefresh();
    } finally {
      setChecking(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Аккаунты пользователей
        </h3>
        <button
          onClick={handleCheckNow}
          disabled={checking}
          className="text-xs px-3 py-1 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-card-hover)] transition-colors disabled:opacity-50"
        >
          {checking ? "Проверяю..." : "Проверить сейчас"}
        </button>
      </div>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-xs text-[var(--text-muted)] uppercase border-b border-[var(--border)]">
            <th className="py-2 px-3 text-left">Телефон</th>
            <th className="py-2 px-3 text-left">Имя</th>
            <th className="py-2 px-3 text-center">Соединение</th>
            <th className="py-2 px-3 text-left">Доступ</th>
            <th className="py-2 px-3 text-right">ID</th>
            <th className="py-2 px-3"></th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id} className="border-b border-[var(--border)] hover:bg-[var(--bg-card-hover)]">
              <td className="py-2 px-3 font-mono">{a.phone}</td>
              <td className="py-2 px-3">{a.name || "—"}</td>
              <td className="py-2 px-3 text-center">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  a.connection === "Активен"
                    ? "bg-[var(--success)]/20 text-[var(--success)]"
                    : "bg-[var(--text-muted)]/20 text-[var(--text-muted)]"
                }`}>
                  {a.connection}
                </span>
                <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                  проверено {fmtRel(a.last_check_at)}
                </div>
              </td>
              <td className="py-2 px-3 text-xs">{a.access || `${a.supplier_name || ""} [${a.store_name || ""}]`}</td>
              <td className="py-2 px-3 text-right font-mono">{a.supplier_id || "—"}</td>
              <td className="py-2 px-3 text-right">
                <button onClick={() => handleDelete(a.phone)}
                  className="text-[var(--danger)] text-xs hover:underline">✕</button>
              </td>
            </tr>
          ))}
          {accounts.length === 0 && (
            <tr><td colSpan={6} className="py-6 text-center text-[var(--text-muted)]">Нет аккаунтов</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════
// Stores table
// ═══════════════════════════════════════════

function StoresTable({ accounts, store, onRefresh }: { accounts: Account[]; store: StoreInfo; onRefresh: () => void }) {
  // Derive store from accounts + API key
  const activeAccount = accounts.find((a) => a.connection === "Активен");

  return (
    <div>
      <h3 className="text-center text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-3">
        Магазины
      </h3>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-xs text-[var(--text-muted)] uppercase border-b border-[var(--border)]">
            <th className="py-2 px-3 text-left">Пользователь</th>
            <th className="py-2 px-3 text-center">API-токен</th>
            <th className="py-2 px-3 text-center">Данные</th>
            <th className="py-2 px-3 text-left">Наименование</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-[var(--border)] hover:bg-[var(--bg-card-hover)]">
            <td className="py-2 px-3">
              {activeAccount ? (
                <div>
                  <div className="font-medium">{activeAccount.connection === "Активен" ? "Активен" : "—"}</div>
                  <div className="text-xs text-[var(--text-muted)]">{activeAccount.phone}</div>
                </div>
              ) : "—"}
            </td>
            <td className="py-2 px-3 text-center">
              {store.hasKey ? (
                <span className="inline-flex items-center gap-2">
                  <span className="text-[var(--success)] text-xs font-medium" title={store.masked}>Есть</span>
                  <button
                    onClick={async () => {
                      if (!confirm("Удалить текущий API-токен? После этого можно будет добавить новый.")) return;
                      await fetch("/api/settings/apikey", { method: "DELETE" });
                      onRefresh();
                    }}
                    className="text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
                    title="Удалить API-токен"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </span>
              ) : (
                <span className="text-[var(--text-muted)] text-xs">—</span>
              )}
            </td>
            <td className="py-2 px-3 text-center text-xs text-[var(--text-muted)]">—</td>
            <td className="py-2 px-3">
              {activeAccount?.supplier_name ? (
                <div>
                  <div className="font-medium">{activeAccount.supplier_name}</div>
                  <div className="text-xs text-[var(--text-muted)]">{activeAccount.store_name}</div>
                </div>
              ) : store.supplierName ? (
                <div className="font-medium">{store.supplierName}</div>
              ) : "—"}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function BidLimitsSettings() {
  const defaultLimits = BID_LIMIT_FIELDS.reduce((acc, field) => {
    acc[field.key] = WB_MAX_BID_RUB;
    return acc;
  }, {} as Record<BidLimitKey, number>);
  const [limits, setLimits] = useState<Record<BidLimitKey, number>>(defaultLimits);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((settings) => {
        if (!alive) return;
        setLimits({
          max_bid_manual_auction_rub: normalizeLimit(settings.max_bid_manual_auction_rub),
          max_bid_uni_rub: normalizeLimit(settings.max_bid_uni_rub),
          max_bid_cpc_rub: normalizeLimit(settings.max_bid_cpc_rub),
        });
      })
      .catch(() => { if (alive) setError("Не удалось загрузить лимиты ставок"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  function setLimit(key: BidLimitKey, raw: string) {
    if (raw === "") {
      setLimits((prev) => ({ ...prev, [key]: 0 }));
      return;
    }
    const digits = raw.replace(/\D/g, "");
    setLimits((prev) => ({ ...prev, [key]: normalizeLimit(digits) }));
  }

  async function save() {
    setError("");
    setSavedAt("");
    const invalid = BID_LIMIT_FIELDS.find((field) => limits[field.key] < 1 || limits[field.key] > WB_MAX_BID_RUB);
    if (invalid) {
      setError("Лимит должен быть от 1 до " + WB_MAX_BID_RUB + " ₽");
      return;
    }
    setSaving(true);
    try {
      const body = {
        max_bid_manual_auction_rub: limits.max_bid_manual_auction_rub,
        max_bid_uni_rub: limits.max_bid_uni_rub,
        max_bid_cpc_rub: limits.max_bid_cpc_rub,
      };
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Не удалось сохранить лимиты");
        return;
      }
      setSavedAt(new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }));
    } catch {
      setError("Ошибка соединения");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">Лимиты ставок</h3>
          <div className="mt-1 text-xs text-[var(--text-muted)]">Сервер блокирует ставку выше лимита до отправки в WB.</div>
        </div>
        <button
          onClick={save}
          disabled={loading || saving}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white transition-colors disabled:opacity-50"
        >
          {saving ? "Сохраняю..." : "Сохранить"}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {BID_LIMIT_FIELDS.map((field) => (
          <label key={field.key} className="block rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{field.label}</span>
            <span className="mt-1 block min-h-4 text-xs text-[var(--text-muted)]">{field.description}</span>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={WB_MAX_BID_RUB}
                value={limits[field.key] > 0 ? limits[field.key] : ""}
                onChange={(e) => setLimit(field.key, e.target.value)}
                onBlur={() => setLimits((prev) => ({ ...prev, [field.key]: normalizeLimit(prev[field.key]) }))}
                disabled={loading || saving}
                className="h-9 w-full rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 text-sm font-semibold text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-60"
              />
              <span className="text-sm text-[var(--text-muted)]">₽</span>
            </div>
          </label>
        ))}
      </div>

      <div className="mt-3 min-h-5 text-xs">
        {error ? <span className="text-[var(--danger)]">{error}</span> : savedAt ? <span className="text-[var(--success)]">Сохранено в {savedAt}</span> : <span className="text-[var(--text-muted)]">Максимум WB: {WB_MAX_BID_RUB} ₽.</span>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Main Settings Panel
// ═══════════════════════════════════════════

export default function SettingsPanel() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [store, setStore] = useState<StoreInfo>({ hasKey: false, masked: "", supplierName: "" });

  function loadAll() {
    fetch("/api/accounts").then((r) => r.json()).then(setAccounts).catch(() => {});
    fetch("/api/settings/apikey").then((r) => r.json()).then((d) => {
      setStore({ hasKey: d.hasKey || false, masked: d.masked || "", supplierName: d.supplierName || "" });
    }).catch(() => {});
  }

  useEffect(() => { loadAll(); }, []);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <TopActions onAccountAdded={loadAll} />

      <div className="mb-6">
        <BidLimitsSettings />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <AccountsTable accounts={accounts} onRefresh={loadAll} />
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <StoresTable accounts={accounts} store={store} onRefresh={loadAll} />
        </div>
      </div>
    </div>
  );
}
