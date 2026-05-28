"use client";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  key: string;
  label: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  icon?: ReactNode;
  /** Подсказка при наведении (например, почему пункт disabled) */
  title?: string;
  /** Разделитель ДО пункта */
  divider?: boolean;
}

/**
 * Контекстное меню — рендерится через Portal, позиционируется по клиенту (x, y).
 * Закрывается по клику вне, Escape, и правому клику вне.
 */
export default function ContextMenu({
  x, y, items, onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-ctx-menu]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("contextmenu", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("contextmenu", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  // Позиция — с отступом, чтобы не вылезать за правый/нижний край viewport.
  const menuW = 240;
  const menuH = Math.min(10 + items.length * 36, 400);
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const left = Math.min(x, vw - menuW - 8);
  const top = Math.min(y, vh - menuH - 8);

  return createPortal(
    <div
      data-ctx-menu
      className="fixed bg-[var(--bg-card)] border border-[var(--accent)]/30 rounded-lg shadow-2xl py-1 min-w-[220px]"
      style={{ top, left, zIndex: 999999 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <div key={it.key}>
          {it.divider && i > 0 && <div className="my-1 border-t border-[var(--border)]" />}
          <button
            disabled={it.disabled}
            onClick={() => {
              if (it.disabled) return;
              it.onClick?.();
              onClose();
            }}
            title={it.title}
            className={
              "w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors " +
              (it.disabled
                ? "text-[var(--text-muted)] opacity-40 cursor-not-allowed"
                : it.danger
                  ? "text-[var(--danger)] hover:bg-[var(--danger)]/10"
                  : "text-[var(--text)] hover:bg-[var(--bg-card-hover)]")
            }
          >
            {it.icon && <span className="shrink-0">{it.icon}</span>}
            <span>{it.label}</span>
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
