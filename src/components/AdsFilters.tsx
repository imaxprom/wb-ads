"use client";

import { PERIOD_OPTIONS } from "@/types";
import { fmtNum } from "@/lib/format";

interface Props {
  days: number;
  onDaysChange: (d: number, offset?: number) => void;
  offset?: number;
  search: string;
  onSearchChange: (s: string) => void;
  archive: boolean;
  onArchiveChange: (a: boolean) => void;
  syncing: boolean;
  onSync: () => void;
  shown: number;
  total: number;
  totalOrdersSum: number;
  totalAdsSpend: number;
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      className={"w-4 h-4" + (spinning ? " animate-spin" : "")}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

export default function AdsFilters(props: Props) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-sm flex-wrap">
      {/* Refresh */}
      <button
        onClick={props.onSync}
        disabled={props.syncing}
        className="p-2 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-card-hover)] transition-colors"
        title="Обновить данные"
      >
        <RefreshIcon spinning={props.syncing} />
      </button>

      {/* Search */}
      <input
        type="text"
        value={props.search}
        onChange={(e) => props.onSearchChange(e.target.value)}
        placeholder="Артикул"
        className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text)] w-36 outline-none focus:border-[var(--accent)]"
      />
      <span className="text-[var(--text-muted)] text-xs">
        {props.shown} ({props.total})
      </span>

      {/* Group (stub) */}
      <select className="px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text)] text-xs">
        <option>по склейке</option>
        <option>по баркоду</option>
      </select>

      {/* Archive */}
      <label className="flex items-center gap-1.5 cursor-pointer text-xs text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={props.archive}
          onChange={(e) => props.onArchiveChange(e.target.checked)}
          className="accent-[var(--accent)]"
        />
        Архив
      </label>

      {/* Period */}
      <select
        value={`${props.days}:${props.offset || 0}`}
        onChange={(e) => {
          const [d, o] = e.target.value.split(":").map(Number);
          props.onDaysChange(d, o);
        }}
        className="px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text)] text-xs"
      >
        {PERIOD_OPTIONS.map((o) => (
          <option key={`${o.days}:${o.offset}`} value={`${o.days}:${o.offset}`}>
            {o.label}
          </option>
        ))}
      </select>

      {/* Summary */}
      <div className="ml-auto text-xs">
        <span className="text-[var(--text-muted)]">За период </span>
        <span className="text-white font-semibold">{fmtNum(props.totalOrdersSum)} ₽</span>
        {props.totalAdsSpend > 0 && (
          <span className="text-[var(--danger)] ml-1">
            (-{fmtNum(props.totalAdsSpend)} ₽)
          </span>
        )}
      </div>
    </div>
  );
}
