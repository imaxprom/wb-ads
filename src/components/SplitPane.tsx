"use client";

import { useState, useRef, useCallback, type ReactNode } from "react";

export default function SplitPane({
  top,
  bottom,
  defaultRatio = 0.5,
}: {
  top: ReactNode;
  bottom: ReactNode;
  defaultRatio?: number;
}) {
  const [ratio, setRatio] = useState(defaultRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const handleMouseDown = useCallback(() => {
    dragging.current = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newRatio = (e.clientY - rect.top) / rect.height;
      setRatio(Math.max(0.05, Math.min(0.95, newRatio)));
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  const topPercent = ratio * 100;
  const bottomPercent = (1 - ratio) * 100;

  return (
    <div
      ref={containerRef}
      className="flex flex-col overflow-hidden"
      style={{ height: "calc(100vh - 90px)" }}
    >
      {/* Top */}
      <div style={{ height: `${topPercent}%` }} className="overflow-auto shrink-0">
        {top}
      </div>

      {/* Divider */}
      <div
        onMouseDown={handleMouseDown}
        className="h-[5px] shrink-0 cursor-row-resize bg-[var(--border)] hover:bg-[var(--accent)]/40 transition-colors flex items-center justify-center"
      >
        <div className="w-10 h-[3px] rounded-full bg-[var(--text-muted)]/30" />
      </div>

      {/* Bottom */}
      <div style={{ height: `${bottomPercent}%` }} className="overflow-hidden bg-[var(--bg-card)] shrink-0">
        {bottom}
      </div>
    </div>
  );
}
