"use client";
import { useState, useRef, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export default function Tooltip({
  children,
  text,
  maxWidth,
  interactive = false,
  placement = "auto",
}: {
  children: ReactNode;
  text: ReactNode;
  /** Override default max-width: 280px. Pass e.g. "360px" for rich tooltips with tables. */
  maxWidth?: string;
  /** Позволить навести курсор на сам тултип (для скролла / клика внутри). */
  interactive?: boolean;
  /** "auto" — под элементом по центру (старое поведение). "left-full" — слева от элемента,
   *  от верхнего top-bar до низа viewport: удобно для длинных скроллируемых панелей.
   *  "left" — компактный тултип слева от элемента (по вертикали выровнен по центру элемента). */
  placement?: "auto" | "left-full" | "left";
}) {
  const [show, setShow] = useState(false);
  type Pos =
    | { mode: "auto"; top: number; left: number }
    | { mode: "left-full"; top: number; right: number; maxHeight: number }
    | { mode: "left"; top: number; right: number };
  const [pos, setPos] = useState<Pos | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // При каждом показе пересчитываем позицию относительно окна.
  // Portal-рендер в document.body даёт иммунитет к overflow-hidden
  // любого родителя (шапка вкладки, контейнер кнопок и т.д.).
  useLayoutEffect(() => {
    if (!show || !wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    if (placement === "left-full") {
      // От верха контентной области (ниже top-bar) до низа viewport, слева от элемента.
      const TOP_OFFSET = 60;
      const BOTTOM_MARGIN = 16;
      setPos({
        mode: "left-full",
        top: TOP_OFFSET,
        right: window.innerWidth - r.left + 8,
        maxHeight: window.innerHeight - TOP_OFFSET - BOTTOM_MARGIN,
      });
    } else if (placement === "left") {
      // Компактно слева, по вертикали выровнен по центру элемента.
      setPos({
        mode: "left",
        top: r.top + r.height / 2,
        right: window.innerWidth - r.left + 8,
      });
    } else {
      setPos({ mode: "auto", top: r.bottom + 4, left: r.left + r.width / 2 });
    }
  }, [show, placement]);

  const scheduleClose = () => {
    clearTimeout(closeTimer.current);
    if (interactive) {
      closeTimer.current = setTimeout(() => { setShow(false); setPos(null); }, 150);
    } else {
      setShow(false);
      setPos(null);
    }
  };
  const cancelClose = () => clearTimeout(closeTimer.current);

  const tooltipStyle: React.CSSProperties = pos?.mode === "left-full"
    ? {
        top: pos.top,
        right: pos.right,
        maxHeight: pos.maxHeight,
        maxWidth: maxWidth || "420px",
        zIndex: 999999,
        isolation: "isolate",
      }
    : pos?.mode === "left"
      ? {
          top: pos.top,
          right: pos.right,
          transform: "translateY(-50%)",
          zIndex: 999999,
          isolation: "isolate",
          maxWidth: maxWidth || "320px",
        }
      : pos?.mode === "auto"
        ? {
            top: pos.top,
            left: pos.left,
            transform: "translateX(-50%)",
            zIndex: 999999,
            isolation: "isolate",
            maxWidth: maxWidth || "280px",
          }
        : {};

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex"
      onMouseEnter={() => { cancelClose(); timer.current = setTimeout(() => setShow(true), 300); }}
      onMouseLeave={() => { clearTimeout(timer.current); scheduleClose(); }}
    >
      {children}
      {show && pos && typeof document !== "undefined" && createPortal(
        <div
          onMouseEnter={interactive ? cancelClose : undefined}
          onMouseLeave={interactive ? scheduleClose : undefined}
          className={
            "fixed bg-[var(--bg-card)] border border-[var(--accent)]/40 " +
            "text-[var(--text-muted)] text-[10px] font-normal normal-case tracking-normal " +
            "px-3 py-2 rounded-lg shadow-2xl " +
            (placement === "left-full" ? "" : "w-max ") +
            (interactive ? "" : "pointer-events-none ") +
            (typeof text === "string" && text.includes("\n") ? "whitespace-pre-line" : "")
          }
          style={tooltipStyle}
        >
          {text}
        </div>,
        document.body,
      )}
    </span>
  );
}
