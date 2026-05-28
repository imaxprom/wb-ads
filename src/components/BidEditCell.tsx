"use client";

import { useEffect, useRef, useState } from "react";

export interface BidEditCellProps {
  valueRub: number;          // текущая ставка в рублях (что показывается до edit)
  minRub: number;            // минимум для подсказки; реальный clamp на сервере
  hasCustomBid: boolean;     // accent-цвет для наших ставок
  editable: boolean;         // hover/edit только если true (status/payment/bid_type ok)
  isEditing: boolean;
  saving: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onSubmit: (rub: number) => void;
  tooltipOverride?: string;  // для Uni: «Единая ставка кампании…»
  // Override цвет/класс для display-режима (для Uni-карточки accent даже без has_custom_bid)
  displayClassName?: string;
  displayMode?: "text" | "pill";
}

export default function BidEditCell({
  valueRub, minRub, hasCustomBid, editable, isEditing, saving,
  onStartEdit, onCancel, onSubmit, tooltipOverride, displayClassName, displayMode = "text",
}: BidEditCellProps) {
  const [draft, setDraft] = useState<string>(String(valueRub || ""));
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (isEditing) {
      setDraft(String(valueRub || ""));
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        const end = input.value.length;
        input.setSelectionRange(end, end);
      });
    }
  }, [isEditing, valueRub]);

  // Click-outside → cancel edit (Escape уже обработан в onKeyDown).
  // Используем mousedown чтобы закрыть до того, как что-то другое «съест» клик.
  useEffect(() => {
    if (!isEditing) return;
    const onDown = (e: MouseEvent) => {
      if (saving) return;
      const el = wrapRef.current;
      if (el && !el.contains(e.target as Node)) onCancel();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isEditing, saving, onCancel]);

  if (isEditing) {
    const num = parseInt(draft.replace(/\D/g, ""), 10);
    const valid = Number.isFinite(num) && num > 0;
    const tooLow = valid && num < minRub && minRub > 0;
    const submit = () => { if (!valid || saving) return; onSubmit(num); };
    const pill = displayMode === "pill";
    return (
      <span
        ref={wrapRef}
        className="inline-flex items-center justify-end gap-0.5 align-middle tabular-nums"
        style={pill
          ? { width: "76px", minWidth: "76px", maxWidth: "76px" }
          : { width: "3.5rem", minWidth: "3.5rem", maxWidth: "3.5rem" }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          size={1}
          maxLength={5}
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            else if (e.key === "Escape") onCancel();
          }}
          className={
            pill
              ? "h-[1.625rem] bg-[var(--bg)] border border-[var(--accent)] rounded-md px-2 py-0.5 text-center text-sm font-semibold leading-none focus:outline-none focus:border-[var(--accent)] shrink-0 selection:bg-transparent selection:text-[var(--text)]"
              : "h-[1.25rem] bg-[var(--bg)] border border-[var(--accent)] rounded px-1 py-0 text-right text-xs font-mono leading-none focus:outline-none focus:border-[var(--accent)] shrink-0 selection:bg-transparent selection:text-[var(--text)]"
          }
          style={pill
            ? { width: "62px", minWidth: "62px", maxWidth: "62px", boxSizing: "border-box" }
            : { width: "2.7rem", minWidth: "2.7rem", maxWidth: "2.7rem", boxSizing: "border-box" }}
          title={tooLow ? `Ниже минимума ${minRub}₽ — будет применён ${minRub}₽` : "Enter — применить, Esc — отмена"}
        />
        <span className={pill
          ? "w-2.5 text-sm font-semibold leading-none text-[var(--text-muted)] shrink-0"
          : "w-2 text-xs font-mono leading-none text-[var(--text-muted)] shrink-0"}
        >
          {saving ? "…" : "₽"}
        </span>
      </span>
    );
  }

  const tipText = tooltipOverride
    ?? (editable
      ? (hasCustomBid ? `Ваша ставка ${valueRub}₽ — клик для изменения` : `Минимум по предмету (${valueRub}₽) — клик чтобы задать свою`)
      : (hasCustomBid ? `Ваша ставка ${valueRub}₽` : `Минимум по предмету (${valueRub}₽)`));
  const color = displayClassName ?? (hasCustomBid ? "text-[var(--accent)]" : "text-[var(--text-muted)]");
  const cls = displayMode === "pill"
    ? `${color} inline-flex min-w-[76px] items-center justify-center rounded-md border border-white/10 px-2 py-0.5 text-sm transition-all ${editable ? "hover:border-current hover:bg-white/15 hover:shadow-[0_0_0_2px_rgba(255,255,255,0.08)] hover:brightness-125 active:scale-[0.98]" : ""}`
    : `${color} ${editable ? "hover:underline" : ""}`;
  return (
    <span
      ref={wrapRef}
      title={tipText}
      style={editable ? { cursor: "pointer" } : undefined}
      className="inline-flex items-center"
      onClick={(e) => { if (!editable) return; e.stopPropagation(); onStartEdit(); }}
    >
      <span className={cls}>{valueRub} ₽</span>
    </span>
  );
}
