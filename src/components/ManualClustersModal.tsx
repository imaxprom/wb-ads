"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fmtNum } from "@/lib/format";

interface Cluster {
  id: number;
  name: string;
  phrases: string[];
  phrasesCount: number;
  totalFrequency: number;
  createdAt: string;
  updatedAt: string;
  source: "manual" | "mpstats";
  mpstatsPresetId: number | null;
  presetId: number | null;
  importedAt: string | null;
}

type SourceFilter = "all" | "manual" | "mpstats";

interface ProductOption { nmId: number; title: string; subjectId: number | null }

export default function ManualClustersModal({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | "new" | null>(null);
  const [name, setName] = useState("");
  const [phrasesText, setPhrasesText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<"keyword" | "product">("keyword");
  const [importKeyword, setImportKeyword] = useState("");
  const [importNmId, setImportNmId] = useState<number | "">("");
  const [importLimit, setImportLimit] = useState(20);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  async function loadClusters() {
    setLoading(true);
    try {
      const res = await fetch("/api/clusters");
      const d = await res.json();
      if (d.ok) setClusters(d.clusters || []);
    } finally { setLoading(false); }
  }

  useEffect(() => { loadClusters(); }, []);

  // Список активных товаров для «Импорт по артикулу». Берём из /api/ads и уникализируем nmId.
  async function loadProducts() {
    try {
      const res = await fetch("/api/ads?days=7");
      const d = await res.json();
      const seen = new Set<number>();
      const opts: ProductOption[] = [];
      for (const c of (d.campaigns || []) as { firstNmId?: number; firstProductTitle?: string; subjectId?: number | null }[]) {
        const nm = c.firstNmId;
        if (!nm || seen.has(nm)) continue;
        seen.add(nm);
        opts.push({ nmId: nm, title: c.firstProductTitle || String(nm), subjectId: c.subjectId ?? null });
      }
      setProducts(opts);
    } catch { /* silent */ }
  }
  useEffect(() => { if (importOpen) loadProducts(); }, [importOpen]);

  async function runImport() {
    setImporting(true);
    setImportResult(null);
    try {
      const body: Record<string, unknown> = {};
      if (importMode === "keyword") {
        if (!importKeyword.trim()) { setImportResult("Введите фразу"); return; }
        body.keyword = importKeyword.trim();
      } else {
        if (!importNmId) { setImportResult("Выберите артикул"); return; }
        body.nmId = Number(importNmId);
        body.limit = importLimit;
      }
      const res = await fetch("/api/sync/mpstats-clusters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!d.ok) { setImportResult(`Ошибка: ${d.error || "unknown"}`); return; }
      const parts: string[] = [];
      if (d.created?.length) parts.push(`создано ${d.created.length}`);
      if (d.updated?.length) parts.push(`обновлено ${d.updated.length}`);
      if (d.skipped?.length) parts.push(`пропущено ${d.skipped.length}`);
      if (d.failed?.length) parts.push(`ошибок ${d.failed.length}`);
      setImportResult(parts.length ? parts.join(", ") : `Найдено кластеров: ${d.clustersFound}`);
      await loadClusters();
      onChanged?.();
    } catch (e) {
      setImportResult(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setImporting(false); }
  }

  async function detachFromMpstats() {
    if (typeof selectedId !== "number") return;
    if (!confirm("Отвязать кластер от MPSTATS? После этого его можно будет редактировать, и при следующем авто-импорте он не перезапишется.")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/clusters/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ detachFromMpstats: true }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.error || "Не удалось отвязать"); return; }
      await loadClusters();
      onChanged?.();
    } finally { setSaving(false); }
  }

  async function refreshFromMpstats() {
    const current = clusters.find((c) => c.id === selectedId);
    if (!current || !current.mpstatsPresetId) return;
    setSaving(true);
    try {
      // Переимпортируем по имени (norm_query) — MPSTATS вернёт тот же preset и обновит фразы.
      const res = await fetch("/api/sync/mpstats-clusters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: current.name }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.error || "Не удалось обновить"); return; }
      await loadClusters();
      onChanged?.();
      // Пересинкаем выбранный кластер (данные в state)
      const updated = (await fetch("/api/clusters").then((r) => r.json())).clusters?.find((c: Cluster) => c.id === selectedId);
      if (updated) { setName(updated.name); setPhrasesText(updated.phrases.join("\n")); }
    } finally { setSaving(false); }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function selectCluster(c: Cluster) {
    setSelectedId(c.id);
    setName(c.name);
    setPhrasesText(c.phrases.join("\n"));
    setError(null);
  }

  function newCluster() {
    setSelectedId("new");
    setName("");
    setPhrasesText("");
    setError(null);
  }

  async function save() {
    const trimmedName = name.trim();
    if (!trimmedName) { setError("Имя кластера обязательно"); return; }
    const phrases = phrasesText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    setSaving(true);
    setError(null);
    try {
      let res: Response;
      if (selectedId === "new") {
        res = await fetch("/api/clusters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmedName, phrases }),
        });
      } else {
        res = await fetch(`/api/clusters/${selectedId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmedName, phrases }),
        });
      }
      const d = await res.json();
      if (!d.ok) { setError(d.error || "Не удалось сохранить"); return; }
      await loadClusters();
      onChanged?.();
      if (selectedId === "new") {
        // После создания — выбираем новый id (последний в списке)
        setSelectedId(Number(d.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  }

  async function remove() {
    if (selectedId === null || selectedId === "new") return;
    if (!confirm(`Удалить кластер «${name}»?`)) return;
    setSaving(true);
    try {
      await fetch(`/api/clusters/${selectedId}`, { method: "DELETE" });
      await loadClusters();
      onChanged?.();
      setSelectedId(null);
      setName("");
      setPhrasesText("");
    } finally { setSaving(false); }
  }

  if (typeof document === "undefined") return null;
  const isEditing = selectedId !== null;
  const phrasesCount = phrasesText.split("\n").filter((s) => s.trim()).length;
  const manualCount = clusters.filter((c) => c.source === "manual").length;
  const mpstatsCount = clusters.filter((c) => c.source === "mpstats").length;
  const filteredClusters = sourceFilter === "all" ? clusters : clusters.filter((c) => c.source === sourceFilter);
  const selectedCluster = typeof selectedId === "number" ? clusters.find((c) => c.id === selectedId) : null;
  const isMpstatsSelected = selectedCluster?.source === "mpstats";

  return createPortal(
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4"
      style={{ zIndex: 999999 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: "90vw", maxWidth: "56rem", height: "85vh" }}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] shrink-0 flex-wrap">
          <h3 className="text-sm font-semibold text-[var(--text)]">Наши кластеры</h3>
          <span className="text-xs text-[var(--text-muted)]">{clusters.length} шт. ({manualCount} ручных + {mpstatsCount} MPSTATS)</span>
          <div className="flex-1" />
          <div className="flex items-center gap-1 text-[10px]">
            {(["all", "manual", "mpstats"] as SourceFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setSourceFilter(f)}
                className={
                  "px-2 py-1 rounded border transition-colors " +
                  (sourceFilter === f
                    ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10"
                    : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]")
                }
              >
                {f === "all" ? "Все" : f === "manual" ? "Ручные" : "MPSTATS"}
              </button>
            ))}
          </div>
          <button
            onClick={() => setImportOpen((v) => !v)}
            className="px-3 py-1 text-xs rounded-lg border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
          >
            {importOpen ? "× Закрыть импорт" : "↓ Импорт из MPSTATS"}
          </button>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)]">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {importOpen && (
          <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg)]/40 flex flex-col gap-2 shrink-0">
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={importMode === "keyword"} onChange={() => setImportMode("keyword")} className="accent-[var(--accent)]" />
                По фразе
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={importMode === "product"} onChange={() => setImportMode("product")} className="accent-[var(--accent)]" />
                По артикулу
              </label>
              <div className="flex-1" />
              <span className="text-[10px] text-[var(--text-muted)]">PRESET = совпадает с WB preset_id. Перезаписывает только source=mpstats.</span>
            </div>
            <div className="flex items-center gap-2">
              {importMode === "keyword" ? (
                <input
                  type="text"
                  value={importKeyword}
                  onChange={(e) => setImportKeyword(e.target.value)}
                  placeholder="трусы женские"
                  className="flex-1 px-3 py-1.5 text-xs rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
              ) : (
                <>
                  <select
                    value={importNmId}
                    onChange={(e) => setImportNmId(e.target.value ? Number(e.target.value) : "")}
                    className="flex-1 px-2 py-1.5 text-xs rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  >
                    <option value="">— выбери артикул —</option>
                    {products.map((p) => (
                      <option key={p.nmId} value={p.nmId}>{p.nmId} — {p.title.slice(0, 60)}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                    Топ фраз:
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={importLimit}
                      onChange={(e) => setImportLimit(Math.max(1, Math.min(50, Number(e.target.value) || 20)))}
                      className="w-14 px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg)] text-right font-mono text-xs"
                    />
                  </label>
                </>
              )}
              <button
                onClick={runImport}
                disabled={importing}
                className="px-4 py-1.5 text-xs rounded bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
              >
                {importing ? "Импорт…" : "Импортировать"}
              </button>
            </div>
            {importResult && <div className="text-[11px] text-[var(--text-muted)]">{importResult}</div>}
          </div>
        )}

        <div className="flex-1 flex overflow-hidden" style={{ minHeight: 0 }}>
          <div className="w-64 border-r border-[var(--border)] overflow-y-auto flex flex-col" style={{ minHeight: 0 }}>
            <button
              onClick={newCluster}
              className="m-2 px-3 py-2 text-xs rounded-lg border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors font-medium"
            >
              + Добавить кластер
            </button>
            {loading ? (
              <div className="p-4 text-xs text-[var(--text-muted)] text-center">Загрузка…</div>
            ) : filteredClusters.length === 0 ? (
              <div className="p-4 text-xs text-[var(--text-muted)] text-center">
                {clusters.length === 0 ? "Пусто. Нажмите «+ Добавить кластер» чтобы начать." : "Нет кластеров в этом фильтре."}
              </div>
            ) : (
              filteredClusters.map((c) => (
                <button
                  key={c.id}
                  onClick={() => selectCluster(c)}
                  className={
                    "text-left px-3 py-2 border-b border-[var(--border)] transition-colors " +
                    (selectedId === c.id
                      ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                      : "text-[var(--text)] hover:bg-[var(--bg-card-hover)]")
                  }
                >
                  <div className="flex items-center gap-1.5">
                    <div className="text-xs font-semibold truncate flex-1">{c.name}</div>
                    {c.source === "mpstats" && (
                      <span
                        title={`Импорт из MPSTATS · preset ${c.mpstatsPresetId}`}
                        className="shrink-0 inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wide bg-purple-500/20 text-purple-300 border border-purple-500/40"
                      >
                        M 🔒
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                    {c.phrasesCount} фраз · {fmtNum(c.totalFrequency)} показов
                    {c.presetId != null && <span className="ml-1">· preset {c.presetId}</span>}
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
            {!isEditing ? (
              <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-sm">
                Выберите кластер слева или создайте новый
              </div>
            ) : (
              <>
                <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3">
                  {isMpstatsSelected && selectedCluster && (
                    <div className="p-3 rounded-lg border border-purple-500/30 bg-purple-500/5">
                      <div className="flex items-center gap-2 text-[11px] text-purple-300 font-semibold mb-1">
                        <span>ⓘ Импортировано из MPSTATS</span>
                        <span className="text-[var(--text-muted)] font-normal">· preset {selectedCluster.mpstatsPresetId}</span>
                        {selectedCluster.importedAt && (
                          <span className="text-[var(--text-muted)] font-normal">· {selectedCluster.importedAt.slice(0, 16).replace("T", " ")}</span>
                        )}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] mb-2">
                        Поля заблокированы — MPSTATS-кластер перезаписывается при ре-импорте. Чтобы править — нажми «Сделать своим».
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={refreshFromMpstats}
                          disabled={saving}
                          className="px-2.5 py-1 text-[10px] rounded border border-[var(--accent)]/60 text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:opacity-50"
                        >
                          ↻ Обновить из MPSTATS
                        </button>
                        <button
                          onClick={detachFromMpstats}
                          disabled={saving}
                          className="px-2.5 py-1 text-[10px] rounded border border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-card-hover)] disabled:opacity-50"
                        >
                          🔓 Сделать своим
                        </button>
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Имя кластера</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={isMpstatsSelected}
                      className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div className="flex-1 flex flex-col min-h-0">
                    <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">
                      Фразы <span className="text-[var(--text-muted)]/70">(каждая с новой строки · {phrasesCount} шт.)</span>
                    </label>
                    <textarea
                      value={phrasesText}
                      onChange={(e) => setPhrasesText(e.target.value)}
                      disabled={isMpstatsSelected}
                      className="flex-1 mt-1 px-3 py-2 text-xs font-mono rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)] resize-none disabled:opacity-60 disabled:cursor-not-allowed"
                      style={{ minHeight: "400px" }}
                    />
                  </div>
                  {error && <div className="text-xs text-[var(--danger)]">{error}</div>}
                </div>
                <div className="border-t border-[var(--border)] px-4 py-3 flex items-center gap-2">
                  <button
                    onClick={save}
                    disabled={saving || isMpstatsSelected}
                    title={isMpstatsSelected ? "Нельзя править MPSTATS-кластер. Нажми «Сделать своим»." : undefined}
                    className="px-4 py-1.5 text-xs rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? "Сохраняю…" : "Сохранить"}
                  </button>
                  {selectedId !== "new" && (
                    <button
                      onClick={remove}
                      disabled={saving}
                      className="px-4 py-1.5 text-xs rounded-lg border border-[var(--danger)]/50 text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors disabled:opacity-50"
                    >
                      Удалить
                    </button>
                  )}
                  <div className="flex-1" />
                  <button
                    onClick={() => { setSelectedId(null); setName(""); setPhrasesText(""); setError(null); }}
                    className="px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                  >
                    Отмена
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
