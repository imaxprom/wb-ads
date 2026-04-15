"use client";

import { useState, useEffect, useRef } from "react";
import { COLUMNS } from "./AdsTableHeader";

async function loadHiddenColumns(): Promise<string[]> {
  try {
    const res = await fetch("/api/settings");
    const raw = await res.json();
    return raw.col_hidden ? JSON.parse(raw.col_hidden) : [];
  } catch { return []; }
}

async function saveHiddenColumns(hidden: string[]) {
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ col_hidden: JSON.stringify(hidden) }),
  });
}

export default function ColumnSettings({
  hiddenColumns,
  onHiddenChange,
}: {
  hiddenColumns: string[];
  onHiddenChange: (hidden: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function toggle(key: string) {
    // Don't allow hiding "Товар"
    if (key === "vendorCode") return;
    const newHidden = hiddenColumns.includes(key)
      ? hiddenColumns.filter((k) => k !== key)
      : [...hiddenColumns, key];
    onHiddenChange(newHidden);
    saveHiddenColumns(newHidden);
  }

  function resetAll() {
    onHiddenChange([]);
    saveHiddenColumns([]);
  }

  // Column label as string
  function labelText(col: typeof COLUMNS[number]): string {
    if (typeof col.label === "string") return col.label;
    // For JSX labels, use key-based name
    const names: Record<string, string> = {
      ordersSum: "Корзины и заказы",
    };
    return names[col.key] || col.key;
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] transition-colors"
        title="Настройка столбцов"
      >
        <svg className="w-4 h-4 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 p-2 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl min-w-[180px] z-50">
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide px-2 py-1 mb-1">Столбцы</div>
          {COLUMNS.map((col) => {
            const isHidden = hiddenColumns.includes(col.key);
            const isLocked = col.key === "vendorCode";
            return (
              <label
                key={col.key}
                className={
                  "flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors " +
                  (isLocked ? "opacity-50 cursor-default" : "hover:bg-[var(--bg-card-hover)]")
                }
              >
                <input
                  type="checkbox"
                  checked={!isHidden}
                  onChange={() => toggle(col.key)}
                  disabled={isLocked}
                  className="accent-[var(--accent)] w-3 h-3"
                />
                <span className={isHidden ? "text-[var(--text-muted)]" : "text-[var(--text)]"}>
                  {labelText(col)}
                </span>
              </label>
            );
          })}
          <div className="border-t border-[var(--border)] mt-1.5 pt-1.5">
            <button
              onClick={resetAll}
              className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-[var(--accent)] hover:bg-[var(--bg-card-hover)] transition-colors"
            >
              По умолчанию
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { loadHiddenColumns };
