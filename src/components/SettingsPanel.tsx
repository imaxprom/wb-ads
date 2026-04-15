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
}

interface StoreInfo {
  hasKey: boolean;
  masked: string;
  supplierName: string;
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

function AccountsTable({ accounts, onRefresh }: { accounts: Account[]; onRefresh: () => void }) {
  async function handleDelete(phone: string) {
    await fetch("/api/accounts", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    onRefresh();
  }

  return (
    <div>
      <h3 className="text-center text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-3">
        Аккаунты пользователей
      </h3>
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

function StoresTable({ accounts, store }: { accounts: Account[]; store: StoreInfo }) {
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
                <span className="text-[var(--success)] text-xs font-medium">Есть</span>
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

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <AccountsTable accounts={accounts} onRefresh={loadAll} />
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <StoresTable accounts={accounts} store={store} />
        </div>
      </div>
    </div>
  );
}
