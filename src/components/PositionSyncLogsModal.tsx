"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface LogRow {
  id: number;
  advert_id: number;
  nm_id: number;
  norm_query: string;
  ad_pos: number | null;
  organic_pos: number | null;
  boost: number | null;
  is_advertised: number;
  status: string;
  via: string | null;
  elapsed_sec: number | null;
  raw_error: string | null;
  recorded_at: string;
}

const STATUS_MAP: Record<string, { label: string; color: string; hint: string }> = {
  ok: { label: "OK", color: "var(--success)", hint: "Реклама и органика найдены" },
  no_ad: { label: "НЕТ РЕКЛ", color: "var(--warning)", hint: "Товар в органике, но не в рекламном топ-192" },
  no_organic: { label: "НЕТ ОРГ", color: "var(--warning)", hint: "Реклама найдена, органическая позиция не определена" },
  both_none: { label: "НИЧЕГО", color: "var(--danger)", hint: "Товар не найден ни в рекламе, ни в органике — возможно прокси отдал пустой ответ" },
  parser_error: { label: "ОШИБКА", color: "var(--danger)", hint: "Парсер пометил результат как error (incomplete после retry)" },
  ssh_error: { label: "SSH", color: "var(--danger)", hint: "SSH или Python-скрипт упал" },
  no_data: { label: "NO DATA", color: "var(--danger)", hint: "Фраза отсутствует в ответе batch" },
};

function formatRel(iso: string): string {
  const d = new Date(iso.replace(" ", "T") + "Z");
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return `${diff}с назад`;
  if (diff < 3600) return `${Math.floor(diff / 60)}м назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}ч назад`;
  return `${Math.floor(diff / 86400)}д назад`;
}

export default function PositionSyncLogsModal({
  advertId,
  onClose,
}: {
  advertId: number;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [phraseFilter, setPhraseFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ advertId: String(advertId), limit: "200" });
    if (statusFilter) params.set("status", statusFilter);
    fetch(`/api/logs/position-sync?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setRows(d.rows || []);
          setSummary(d.summary || {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [advertId, statusFilter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const filteredRows = phraseFilter
    ? rows.filter((r) => r.norm_query.toLowerCase().includes(phraseFilter.toLowerCase()))
    : rows;

  return createPortal(
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4"
      style={{ zIndex: 999999 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-2xl w-[90vw] max-w-5xl flex flex-col overflow-hidden"
        style={{ maxHeight: "85vh", minHeight: 0 }}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold text-[var(--text)]">
            Журнал проверок позиций
            <span className="text-[var(--text-muted)] font-normal ml-2">· advert {advertId}</span>
          </h3>
          <div className="flex-1" />
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)]">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] text-xs flex-wrap">
          <span className="text-[var(--text-muted)]">За последний час:</span>
          {Object.keys(STATUS_MAP).map((s) => {
            const cnt = summary[s] || 0;
            if (cnt === 0) return null;
            const meta = STATUS_MAP[s];
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(statusFilter === s ? "" : s)}
                className={
                  "px-2 py-0.5 rounded-full border transition-colors " +
                  (statusFilter === s
                    ? "bg-[var(--accent)]/20 border-[var(--accent)] text-[var(--accent)]"
                    : "border-[var(--border)] hover:bg-[var(--bg-card-hover)]")
                }
              >
                <span style={{ color: meta.color }}>{meta.label}</span>
                <span className="text-[var(--text-muted)]" style={{ marginLeft: "0.5rem" }}>{cnt}</span>
              </button>
            );
          })}
          <div className="flex-1" />
          <input
            type="text"
            value={phraseFilter}
            onChange={(e) => setPhraseFilter(e.target.value)}
            placeholder="Фильтр по фразе…"
            className="px-2 py-1 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] w-48 outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div className="flex-1 overflow-auto" style={{ minHeight: 0 }}>
          {loading ? (
            <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">Загрузка…</div>
          ) : filteredRows.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">Нет записей</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--bg-card)]">
                <tr className="text-left text-[10px] uppercase text-[var(--text-muted)] border-b border-[var(--border)]">
                  <th className="py-2 px-3">Время</th>
                  <th className="py-2 px-3">Статус</th>
                  <th className="py-2 px-3">Фраза</th>
                  <th className="py-2 px-3 text-right">Рек.поз</th>
                  <th className="py-2 px-3 text-right">Орг.поз</th>
                  <th className="py-2 px-3 text-right">Буст</th>
                  <th className="py-2 px-3 text-right">Время</th>
                  <th className="py-2 px-3">Via</th>
                  <th className="py-2 px-3">Ошибка</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => {
                  const meta = STATUS_MAP[r.status] || { label: r.status, color: "var(--text-muted)", hint: "" };
                  return (
                    <tr key={r.id} className="border-b border-[var(--border)] hover:bg-[var(--bg-card-hover)]">
                      <td className="py-1.5 px-3 text-[var(--text-muted)] whitespace-nowrap" title={r.recorded_at}>{formatRel(r.recorded_at)}</td>
                      <td className="py-1.5 px-3 whitespace-nowrap">
                        <span className="font-mono font-semibold" style={{ color: meta.color }} title={meta.hint}>{meta.label}</span>
                      </td>
                      <td className="py-1.5 px-3 font-mono">{r.norm_query}</td>
                      <td className="py-1.5 px-3 text-right font-mono">{r.ad_pos ?? "—"}</td>
                      <td className="py-1.5 px-3 text-right font-mono">{r.organic_pos ?? "—"}</td>
                      <td className="py-1.5 px-3 text-right font-mono">{r.boost ? `+${r.boost}` : "—"}</td>
                      <td className="py-1.5 px-3 text-right font-mono text-[var(--text-muted)]">{r.elapsed_sec ? r.elapsed_sec.toFixed(1) + "с" : "—"}</td>
                      <td className="py-1.5 px-3 text-[var(--text-muted)]">{r.via || "—"}</td>
                      <td className="py-1.5 px-3 text-[var(--danger)] max-w-[200px] truncate" title={r.raw_error || ""}>{r.raw_error || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 py-2 border-t border-[var(--border)] text-[10px] text-[var(--text-muted)]">
          Показано {filteredRows.length} из {rows.length}. Последние 200 записей. Фильтры по клику на статус сверху.
        </div>
      </div>
    </div>,
    document.body,
  );
}
