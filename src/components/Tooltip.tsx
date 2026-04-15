"use client";
import { useState, useRef, type ReactNode } from "react";

export default function Tooltip({
  children,
  text,
}: {
  children: ReactNode;
  text: string;
}) {
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  return (
    <span
      className="relative"
      onMouseEnter={() => { timer.current = setTimeout(() => setShow(true), 300); }}
      onMouseLeave={() => { clearTimeout(timer.current); setShow(false); }}
    >
      {children}
      {show && (
        <div className={"absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 bg-[var(--bg-card)] border border-[var(--accent)]/40 text-[var(--text-muted)] text-[10px] font-normal normal-case tracking-normal px-3 py-2 rounded-lg shadow-2xl w-max max-w-[280px] " + (text.includes("\n") ? "whitespace-pre-line" : "whitespace-nowrap")}>
          {text}
        </div>
      )}
    </span>
  );
}
