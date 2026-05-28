"use client";

import { useEffect, useState, useCallback, useRef, useMemo, type ReactNode } from "react";
import type { AdsCampaign } from "@/app/api/ads/route";
import type { AdCampDay, AdCampKeyword, AdCampCatalog } from "@/app/api/ad-campaign-detail/route";
import { fmtNum, fmtRub, fmtDrr, localDateStr } from "@/lib/format";
import { roundedZonePercents } from "@/lib/zone-percent";
import { getWbImageCandidateUrls, withImageVersion } from "@/lib/wb-image";
import { EyeIcon, CartIcon, BoxIcon, ClickIcon, PauseIcon, ArrowRightIcon } from "./icons";
import Tooltip from "./Tooltip";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import PositionSyncLogsModal from "./PositionSyncLogsModal";
import ManualClustersModal from "./ManualClustersModal";
import BidEditCell from "./BidEditCell";
import BidAutomationModal from "./BidAutomationModal";
import type { BidAutomationLog, BidAutomationRule } from "@/lib/bid-automation";

const AUTO_DETAIL_SYNC = process.env.NEXT_PUBLIC_WB_ADS_AUTO_DETAIL_SYNC === "1";
const ic = "w-4.5 h-4.5 inline-block align-middle";
const CASCADE_CONFIRM_SINGLE =
  "\u0418\u0441\u043a\u043b\u044e\u0447\u0438\u0442\u044c {count} \u0444\u0440\u0430\u0437 WB-\u043a\u043b\u0430\u0441\u0442\u0435\u0440\u0430? \u0411\u0443\u0434\u0443\u0442 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u044b \u0432\u0441\u0435 \u0438\u0437\u0432\u0435\u0441\u0442\u043d\u044b\u0435 \u0430\u043b\u0438\u0430\u0441\u044b \u044d\u0442\u043e\u0433\u043e preset_id.";
const CASCADE_CONFIRM_BATCH =
  "\u0418\u0441\u043a\u043b\u044e\u0447\u0438\u0442\u044c {count} \u0444\u0440\u0430\u0437 \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0445 WB-\u043a\u043b\u0430\u0441\u0442\u0435\u0440\u043e\u0432? \u0411\u0443\u0434\u0443\u0442 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u044b \u0432\u0441\u0435 \u0438\u0437\u0432\u0435\u0441\u0442\u043d\u044b\u0435 \u0430\u043b\u0438\u0430\u0441\u044b \u0438\u0445 preset_id.";

function formatDate(d: string): string {
  const [, m, day] = d.split("-");
  const months = ["", "янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."];
  return `${parseInt(day)} ${months[parseInt(m)]}`;
}

function statusLabel(s: number): { text: string; color: string } {
  if (s === 9) return { text: "активна", color: "var(--success)" };
  if (s === 11) return { text: "пауза", color: "var(--warning)" };
  if (s === 7) return { text: "архив", color: "var(--text-muted)" };
  return { text: String(s), color: "var(--text-muted)" };
}

// ═══ Settings persistence ═══

async function saveSetting(key: string, value: string) {
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [key]: value }),
  });
}

async function loadSettings(): Promise<Record<string, string>> {
  try {
    const r = await fetch("/api/settings");
    const j = await r.json();
    return j || {};
  } catch { return {}; }
}

function parseJson<T>(s: string | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

// ═══ Campaign card (left) ═══

function CampaignCard({ c }: { c: AdsCampaign }) {
  const [imgIdx, setImgIdx] = useState(0);
  const imgUrls = useMemo(
    () => c.firstNmId
      ? getWbImageCandidateUrls(c.firstNmId, "medium").map((url) => withImageVersion(url, c.firstProductUpdatedAt))
      : [],
    [c.firstNmId, c.firstProductUpdatedAt],
  );
  const imgUrl = imgUrls[imgIdx] || null;
  const st = statusLabel(c.status);
  const displayBidRub = c.bidKopecks != null ? c.bidKopecks / 100 : null;

  useEffect(() => {
    setImgIdx(0);
  }, [c.firstNmId, c.firstProductUpdatedAt]);

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-3 flex justify-center">
        {imgUrl ? (
          <img
            src={imgUrl}
            alt=""
            className="max-w-full max-h-48 rounded-lg object-contain"
            onError={() => setImgIdx((idx) => idx + 1)}
          />
        ) : (
          <div className="w-32 h-40 rounded-lg bg-[var(--border)]" />
        )}
      </div>

      <div className="text-sm font-semibold mb-2" title={c.name}>{c.name || `Кампания ${c.advertId}`}</div>

      <div className="space-y-1.5 text-xs">
        <div className="flex items-center gap-1.5">
          <span style={{ color: st.color }} className="font-semibold">{st.text}</span>
          {c.status === 11 && <PauseIcon className="w-3 h-3 text-[var(--danger)]" />}
        </div>
        {c.firstNmId && (
          <div>
            <span className="text-[var(--text-muted)]">Артикул WB: </span>
            <span className="font-mono">{c.firstNmId}</span>
          </div>
        )}
        {c.subject && (
          <div>
            <span className="text-[var(--text-muted)]">Предмет: </span>
            <span>{c.subject}</span>
          </div>
        )}
        <div>
          <span className="text-[var(--text-muted)]">ID кампании: </span>
          <span className="font-mono">{c.advertId}</span>
        </div>
        {c.startedDaysAgo != null && (
          <div>
            <span className="text-[var(--text-muted)]">Работает: </span>
            <span>{c.startedDaysAgo} дней</span>
          </div>
        )}
        {displayBidRub != null && (
          <div>
            <span className="text-[var(--text-muted)]">Ставка: </span>
            <span>{fmtRub(displayBidRub)}</span>
          </div>
        )}
        <div>
          <span className="text-[var(--text-muted)]">Бюджет: </span>
          <span>{fmtRub(c.budgetTotal)}</span>
        </div>
      </div>
    </div>
  );
}

function VerticalDivider({ onMouseDown }: { onMouseDown: () => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="w-[5px] shrink-0 cursor-col-resize bg-[var(--border)] hover:bg-[var(--accent)]/40 transition-colors flex items-center justify-center"
    >
      <div className="h-10 w-[3px] rounded-full bg-[var(--text-muted)]/30" />
    </div>
  );
}

// ═══ Column configs ═══

interface ColCfg {
  key: string;
  label: ReactNode;
  tooltip: ReactNode;
  defaultW: number;
  align?: "left" | "right";
  lockedName?: string; // displayed name for settings dropdown when label is JSX
}

const DAY_COLS: ColCfg[] = [
  { key: "date", label: "Дата", tooltip: "Дата по Мск", defaultW: 80, align: "right" },
  { key: "avg_position", label: "Ср.поз", tooltip: "Средняя позиция основного товара в показах за день\n(из Sheet1 xlsx отчёта)", defaultW: 60, align: "right", lockedName: "Ср. позиция" },
  { key: "views_total", label: "Показы", tooltip: "Показы суммарно по всем зонам за день", defaultW: 90, align: "right", lockedName: "Показы" },
  { key: "views_search", label: "Поиск", tooltip: "Показы в Поиске", defaultW: 80, align: "right" },
  { key: "views_reco", label: "Полки", tooltip: "Показы в Рекомендациях (полках)", defaultW: 70, align: "right" },
  { key: "views_catalog", label: "Кат.", tooltip: "Показы в Каталогах", defaultW: 60, align: "right" },
  { key: "ctr", label: "CTR", tooltip: "Конверсия показов в клики, %", defaultW: 60, align: "right" },
  { key: "clicks_total", label: <><ClickIcon className={ic} /> клики</>, tooltip: "Клики за день × средняя цена клика", defaultW: 115, align: "right", lockedName: "Клики" },
  { key: "cpm", label: "CPM", tooltip: "Средняя цена 1000 показов", defaultW: 70, align: "right" },
  { key: "spend", label: "Затраты", tooltip: "Сумма затрат на рекламу за день", defaultW: 85, align: "right" },
  { key: "atbs", label: "Корзин", tooltip: "Добавлений в корзину\nФормат «свои+ассоциированные»:\nсвои — по nmId, где реально были показы\nассоциированные — по другим nmId этой кампании без показов", defaultW: 80, align: "right", lockedName: "Корзин" },
  { key: "cart_cost", label: "CPL", tooltip: "CPL (cost per lead) — себестоимость корзины\nCPL = spend / atbs", defaultW: 70, align: "right", lockedName: "CPL" },
  { key: "orders", label: "Заказы", tooltip: "Заказов за день\nФормат «свои+ассоциированные»", defaultW: 80, align: "right", lockedName: "Заказы" },
  { key: "order_cost", label: "CPO", tooltip: "CPO (cost per order) — себестоимость заказа\nCPO = spend / orders", defaultW: 70, align: "right", lockedName: "CPO" },
  { key: "cr", label: "CRO", tooltip: "CRO (conversion rate order) — конверсия переходов в заказы\nCRO = orders / clicks × 100%", defaultW: 65, align: "right" },
  { key: "drr", label: "ДРРк", tooltip: "ДРР кампании = spend/sum_price × 100%", defaultW: 60, align: "right" },
  { key: "sum_price", label: "Выручка", tooltip: "Сумма заказов по ценам поставки", defaultW: 95, align: "right", lockedName: "Выручка" },
];

// Столбцы вкладки «Запросы». Источник — UNION preset-info / xlsx / normquery-bids / stats_daily.
const QUERY_COLS: ColCfg[] = [
  { key: "pos", label: "Позиция", tooltip: "Позиция в торгах (пока не собираем)", defaultW: 70, align: "right" },
  { key: "boost", label: "Буст", tooltip: "Буст — надбавка к базовой ставке (пока не собираем)", defaultW: 60, align: "right" },
  { key: "bid", label: "Ставка", tooltip: "Текущая ставка CPM по фразе в рублях", defaultW: 70, align: "right", lockedName: "Ставка" },
  { key: "avg_pos", label: "Ср.поз", tooltip: "Средняя позиция (пока не собираем)", defaultW: 70, align: "right" },
  {
    key: "phrase",
    label: "Кластер",
    tooltip: (
      <div className="space-y-1.5">
        <div>Канонический кластер WB (norm_query из preset-info). Объединяет десятки/сотни вариантов пользовательских запросов.</div>
        <div className="pt-1 border-t border-[var(--border)]">
          <div className="font-semibold text-[var(--text)] mb-1">Маркеры перед фразой:</div>
          <div><span className="text-[var(--danger)] font-mono">⊘</span> — фраза в исключениях</div>
          <div><span className="text-[var(--text-muted)] font-mono">?</span> — неуправляемая (&lt;100 показов): WB подхватил фразу автоматически, но пока нельзя задать ставку или исключить. После 100+ показов перейдёт в управляемые.</div>
          <div>без маркера — обычная управляемая фраза</div>
        </div>
      </div>
    ),
    defaultW: 240,
    align: "left",
  },
  { key: "approx_views", label: <>~<EyeIcon className={ic} /></>, tooltip: "Частотность WB — сколько раз фразу искали в WB за выбранный период.\nИсточники:\n  • вчера и старее — WB premium search-analysis (snapshot в 06:00 МСК);\n  • сегодня и дни без snapshot — fallback из Джема (phrase_djem_stats_daily, heal-тик каждый час).\nДля кластера — сумма по всем фразам в manual_clusters.", defaultW: 90, align: "right", lockedName: "~ Частота WB" },
  { key: "share", label: <>Доля <EyeIcon className={ic} /></>, tooltip: "Доля купленных рекламных показов от общей частотности фразы.\nДоля = показы рекламы / ~частотность WB × 100%.\nЗначение не обрезается до 100%, потому что источники обновляются не синхронно.", defaultW: 80, align: "right", lockedName: "Доля показов" },
  { key: "views", label: <EyeIcon className={ic} />, tooltip: "Показы рекламы", defaultW: 80, align: "right", lockedName: "Показы" },
  { key: "ctr", label: "CTR", tooltip: "CTR, %", defaultW: 60, align: "right" },
  { key: "clicks", label: <ClickIcon className={ic} />, tooltip: "Клики", defaultW: 70, align: "right", lockedName: "Клики" },
  { key: "cpc", label: "Р/клик", tooltip: "Средняя цена клика", defaultW: 75, align: "right" },
  { key: "spend", label: "Счёт", tooltip: "Расход по фразе", defaultW: 90, align: "right" },
  { key: "cpm", label: "CPM", tooltip: "Средняя цена 1000 показов", defaultW: 70, align: "right" },
  { key: "weekly_freq", label: <>🔍 / нед</>, tooltip: "Частотность запроса за неделю (пока не собираем)", defaultW: 90, align: "right", lockedName: "Частотность / нед" },
  { key: "lightning", label: "⚡", tooltip: "⚡ (пока не собираем)", defaultW: 50, align: "right", lockedName: "⚡" },
  { key: "atbs", label: <CartIcon className={ic} />, tooltip: "Корзины", defaultW: 70, align: "right", lockedName: "Корзины" },
  { key: "orders", label: <BoxIcon className={ic} />, tooltip: "Заказы", defaultW: 70, align: "right", lockedName: "Заказы" },
  { key: "atbs_xP", label: <><CartIcon className={ic} /> <span className="text-[9px] align-middle">×</span><span className="text-sm align-middle">₽</span></>, tooltip: "Себестоимость корзины", defaultW: 80, align: "right", lockedName: "Корзина ×₽" },
  { key: "order_xP", label: <><BoxIcon className={ic} /> <span className="text-[9px] align-middle">×</span><span className="text-sm align-middle">₽</span></>, tooltip: "Себестоимость заказа", defaultW: 80, align: "right", lockedName: "Заказ ×₽" },
  {
    key: "djem", label: "Джем",
    tooltip: (
      <div className="space-y-1">
        <div className="font-semibold text-[var(--text)]">WB Джем — воронка по фразе (90 дней)</div>
        <div>В ячейке: <span className="font-mono">корзин → заказов</span>.</div>
        <div>При наведении на значение — полный набор:</div>
        <ul className="pl-3 list-disc space-y-0.5">
          <li>Просмотры, Переходы, CTR</li>
          <li>Корзины, Заказы, Выручка ₽</li>
          <li>Конверсии: в корзину, в заказ</li>
          <li>Средняя цена, средняя позиция</li>
        </ul>
        <div className="pt-1 opacity-70">Источник: seller-content analytics API, period = today-89..today МСК</div>
      </div>
    ),
    defaultW: 110, align: "right", lockedName: "Джем",
  },
  { key: "meta", label: "Meta", tooltip: "Ожидаемый preset фразы (из preset-info кампании / manual_clusters)", defaultW: 160, align: "left" },
  { key: "meta2", label: "Meta 2", tooltip: "Фактический presetId из публичной выдачи search.wb.ru — под каким пресетом WB сейчас реально показывает наш товар на этом запросе. Если отличается от Meta — подсвечено.", defaultW: 100, align: "left", lockedName: "Meta 2" },
];

function colLabelText(c: ColCfg): string {
  return typeof c.label === "string" ? c.label : (c.lockedName || c.key);
}

// ═══ Reusable sortable/resizable table ═══

interface ColumnMgrProps {
  storageKey: string; // prefix for settings keys
  cols: ColCfg[];
  lockedKey?: string; // key that cannot be hidden
}

function useColumnMgr({ storageKey, cols, lockedKey }: ColumnMgrProps) {
  const defaultOrder = useMemo(() => cols.map((c) => c.key), [cols]);
  const [colOrder, setColOrder] = useState<string[]>(defaultOrder);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [hiddenCols, setHiddenCols] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const dragKey = useRef<string | null>(null);
  const resizeKey = useRef<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    let alive = true;
    loadSettings().then((s) => {
      if (!alive) return;
      const w = parseJson<Record<string, number>>(s[`${storageKey}_widths`], {});
      if (Object.keys(w).length > 0) setColWidths(w);
      const o = parseJson<string[]>(s[`${storageKey}_order`], []);
      if (Array.isArray(o) && o.length === defaultOrder.length) setColOrder(o);
      const h = parseJson<string[]>(s[`${storageKey}_hidden`], []);
      if (Array.isArray(h)) setHiddenCols(h);
    }).catch(() => {}).finally(() => {
      if (alive) setReady(true);
    });
    return () => { alive = false; };
  }, [storageKey, defaultOrder]);

  function saveWidthsDebounced(w: Record<string, number>) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveSetting(`${storageKey}_widths`, JSON.stringify(w)), 500);
  }

  const handleResizeStart = useCallback((key: string, startX: number) => {
    const col = cols.find((c) => c.key === key);
    resizeKey.current = key;
    resizeStartX.current = startX;
    resizeStartW.current = colWidths[key] || col?.defaultW || 60;
    const onMove = (e: MouseEvent) => {
      if (!resizeKey.current) return;
      const diff = e.clientX - resizeStartX.current;
      const newW = Math.max(30, Math.min(400, resizeStartW.current + diff));
      setColWidths((prev) => ({ ...prev, [resizeKey.current!]: newW }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      resizeKey.current = null;
      setColWidths((prev) => { saveWidthsDebounced(prev); return prev; });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [cols, colWidths, storageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleDragStart(key: string) { dragKey.current = key; }
  function handleDragOver(e: React.DragEvent) { e.preventDefault(); }
  function handleDrop(targetKey: string) {
    const src = dragKey.current;
    if (!src || src === targetKey) return;
    setColOrder((prev) => {
      const next = [...prev];
      const si = next.indexOf(src);
      const ti = next.indexOf(targetKey);
      if (si === -1 || ti === -1) return prev;
      next.splice(si, 1);
      next.splice(ti, 0, src);
      saveSetting(`${storageKey}_order`, JSON.stringify(next));
      return next;
    });
    dragKey.current = null;
  }

  function toggleCol(key: string) {
    if (key === lockedKey) return;
    setHiddenCols((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      saveSetting(`${storageKey}_hidden`, JSON.stringify(next));
      return next;
    });
  }

  function resetHidden() {
    setHiddenCols([]);
    saveSetting(`${storageKey}_hidden`, JSON.stringify([]));
  }

  return {
    colOrder, colWidths, hiddenCols, ready,
    handleResizeStart, handleDragStart, handleDragOver, handleDrop,
    toggleCol, resetHidden,
  };
}

// ═══ Column settings dropdown ═══

function ColSettingsButton({ cols, hiddenCols, toggleCol, resetHidden, lockedKey }: {
  cols: ColCfg[];
  hiddenCols: string[];
  toggleCol: (k: string) => void;
  resetHidden: () => void;
  lockedKey?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative ml-1">
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
        <div className="absolute right-0 top-full mt-1 p-2 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl min-w-[180px] max-h-[400px] overflow-y-auto z-50">
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide px-2 py-1 mb-1">Столбцы</div>
          {cols.map((col) => {
            const isHidden = hiddenCols.includes(col.key);
            const isLocked = col.key === lockedKey;
            const name = colLabelText(col);
            return (
              <label
                key={col.key}
                className={
                  "flex items-center gap-2 px-2 py-1 rounded-lg text-xs cursor-pointer transition-colors " +
                  (isLocked ? "opacity-50 cursor-default" : "hover:bg-[var(--bg-card-hover)]")
                }
              >
                <input
                  type="checkbox"
                  checked={!isHidden}
                  onChange={() => toggleCol(col.key)}
                  disabled={isLocked}
                  className="accent-[var(--accent)] w-3 h-3"
                />
                <span className={isHidden ? "text-[var(--text-muted)]" : "text-[var(--text)]"}>{name}</span>
              </label>
            );
          })}
          <div className="border-t border-[var(--border)] mt-1.5 pt-1.5">
            <button
              onClick={resetHidden}
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

// ═══ Days tab ═══

// Тултип для ячеек «Корзины» / «Заказы» в «По дням»: показывает breakdown ассоциированных
// конверсий (товары других nm_id, куда ушли корзины/заказы с рекламы этого dvrt).
// Не-ассоциированные (atbs_own / orders_own) — прямые, показываем без breakdown.
function AssocDayCell({ d, field }: { d: AdCampDay; field: "atbs" | "orders" }) {
  const own = field === "atbs" ? d.atbs_own : d.orders_own;
  const assoc = field === "atbs" ? d.atbs_assoc : d.orders_assoc;
  if (own === 0 && assoc === 0) return <>—</>;
  const text = assoc > 0 ? `${own}+${assoc}` : String(own);
  if (d.assoc_details.length === 0) return <>{text}</>;

  // Сортируем breakdown по той же метрике, на которую наведён hover:
  // в тултипе «Корзины» — по корзинам DESC, в «Заказы» — по заказам DESC.
  const sortedDetails = [...d.assoc_details].sort((a, b) =>
    field === "atbs" ? b.carts - a.carts : b.orders - a.orders,
  );

  return (
    <span className="relative group/assoc cursor-default">
      {text}
      <div className="
        invisible opacity-0 group-hover/assoc:visible group-hover/assoc:opacity-100
        transition-all delay-300
        absolute z-50 right-0 top-full mt-1
        px-3 py-2 rounded-lg
        bg-[#2a2a3e] border-2 border-[var(--accent)] shadow-[0_0_20px_rgba(108,92,231,0.3)]
        text-[10px] text-white font-normal normal-case tracking-normal
        whitespace-nowrap text-left min-w-[240px]
        pointer-events-none
      ">
        <div className="font-semibold text-[var(--text)] mb-1.5">
          Ассоциированные конверсии
        </div>
        <div className="text-[9px] mb-2 opacity-60">
          Корзины/заказы, которые достались другим товарам этой кампании
        </div>
        <table className="w-full">
          <thead>
            <tr className="text-[9px] uppercase tracking-wide opacity-50">
              <td className="pb-1">nm_id</td>
              <td className="pb-1 text-right px-1.5">корз.</td>
              <td className="pb-1 text-right px-1.5">зак.</td>
              <td className="pb-1 text-right text-[9px]">товар</td>
            </tr>
          </thead>
          <tbody>
            {sortedDetails.map((item) => (
              <tr key={item.nmId} className="border-t border-[var(--border)]">
                <td className="py-0.5 font-mono">{item.nmId}</td>
                <td className={"py-0.5 text-right px-1.5 " + (field === "atbs" ? "text-[var(--accent)]" : "")}>{item.carts}</td>
                <td className={"py-0.5 text-right px-1.5 " + (field === "orders" ? "text-[var(--accent)]" : "")}>{item.orders}</td>
                <td className="py-0.5 text-right text-[9px] opacity-70 max-w-[120px] truncate">{item.name || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </span>
  );
}

function dayCellValue(d: AdCampDay, key: string): ReactNode {
  switch (key) {
    case "date": return d.date;
    case "avg_position": return d.avg_position > 0 ? String(d.avg_position) : "—";
    case "atbs": return <AssocDayCell d={d} field="atbs" />;
    case "orders": return <AssocDayCell d={d} field="orders" />;
    case "views_total": return d.views_total > 0 ? fmtNum(d.views_total) : "—";
    case "views_search": return d.views_search > 0 ? fmtNum(d.views_search) : "—";
    case "views_reco": return d.views_reco > 0 ? fmtNum(d.views_reco) : "—";
    case "views_catalog": return d.views_catalog > 0 ? fmtNum(d.views_catalog) : "—";
    case "ctr": return d.ctr > 0 ? `${d.ctr.toFixed(1)} %` : "—";
    case "clicks_total": {
      if (d.clicks_total === 0) return "—";
      return d.cpc > 0 ? `${fmtNum(d.clicks_total)} x ${d.cpc.toFixed(1)} ₽` : fmtNum(d.clicks_total);
    }
    case "cpm": return d.views_total > 0 && d.spend > 0 ? `${Math.round(d.spend / d.views_total * 1000)} ₽` : "—";
    case "spend": return d.spend > 0 ? fmtRub(d.spend) : "—";
    case "atbs": return d.atbs > 0 ? fmtNum(d.atbs) : "—";
    case "cart_cost": return d.atbs > 0 && d.spend > 0 ? `${Math.round(d.spend / d.atbs)} ₽` : "—";
    case "orders": return d.orders > 0 ? fmtNum(d.orders) : "—";
    case "order_cost": return d.orders > 0 && d.spend > 0 ? `${Math.round(d.spend / d.orders)} ₽` : "—";
    case "cr": return d.cr > 0 ? `${d.cr.toFixed(2)} %` : "—";
    case "drr": return fmtDrr(d.spend, d.sum_price).text;
    case "sum_price": return d.sum_price > 0 ? fmtRub(d.sum_price) : "—";
    default: return "—";
  }
}

function DaysSummary({ today }: { today: AdCampDay | null }) {
  if (!today) return null;
  const [searchPct, catalogPct, recoPct] = roundedZonePercents([
    today.views_search,
    today.views_catalog,
    today.views_reco,
  ]);
  const sharePct = (v: number) => v > 0 ? `${v} %` : "—";
  return (
    <div className="border-b border-[var(--border)] px-3 py-2 text-xs bg-[var(--bg-card)]/60">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="text-[var(--text-muted)] font-semibold">Сегодня:</div>
        <div>
          <span className="text-[var(--text-muted)]">все зоны </span>
          <span className="font-semibold">{fmtNum(today.views_total)}</span>
        </div>
        <div>
          <span className="text-[var(--text-muted)]">🔍 поиск </span>
          <span className="font-semibold">{fmtNum(today.views_search)}</span>
          <span className="text-[var(--text-muted)]"> ({sharePct(searchPct)})</span>
        </div>
        <div>
          <span className="text-[var(--text-muted)]">✦ полки </span>
          <span className="font-semibold">{fmtNum(today.views_reco)}</span>
          <span className="text-[var(--text-muted)]"> ({sharePct(recoPct)})</span>
        </div>
        <div>
          <span className="text-[var(--text-muted)]">📁 каталоги </span>
          <span className="font-semibold">{fmtNum(today.views_catalog)}</span>
          <span className="text-[var(--text-muted)]"> ({sharePct(catalogPct)})</span>
        </div>
        <div className="ml-auto text-[var(--text-muted)]">
          CTR <span className="text-[var(--text)] font-semibold">{today.ctr.toFixed(1)} %</span>
          <span className="mx-2">·</span>
          Счёт <span className="text-[var(--text)] font-semibold">{fmtRub(today.spend)}</span>
        </div>
      </div>
    </div>
  );
}

// ═══ Shared draggable/resizable header cell ═══

function HeaderCell({
  col, w, onDragStart, onDragOver, onDrop, onResizeStart, onHeaderClick, sortIndicator,
}: {
  col: ColCfg;
  w: number;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onResizeStart: (x: number) => void;
  onHeaderClick?: () => void;
  sortIndicator?: "desc" | null;
}) {
  return (
    <th
      key={col.key}
      draggable
      onDragStart={(e) => {
        onDragStart();
        const el = e.currentTarget.cloneNode(true) as HTMLElement;
        el.style.position = "absolute"; el.style.top = "-9999px"; el.style.width = `${w}px`;
        el.style.background = "var(--bg-card)"; el.style.opacity = "0.9";
        el.style.borderRadius = "4px"; el.style.border = "1px solid var(--accent)";
        document.body.appendChild(el);
        e.dataTransfer.setDragImage(el, w / 2, 14);
        requestAnimationFrame(() => document.body.removeChild(el));
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="relative py-1.5 px-2 text-center text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap bg-[var(--bg-card)] border-b border-[var(--border)] text-[var(--text-muted)] cursor-default select-none"
      style={{ width: w, minWidth: 30, maxWidth: 400 }}
    >
      <Tooltip text={col.tooltip}>
        <span
          onClick={onHeaderClick ? (e) => { e.stopPropagation(); onHeaderClick(); } : undefined}
          className={onHeaderClick ? "cursor-pointer hover:text-[var(--text)] transition-colors" : undefined}
        >
          {col.label}
          {sortIndicator === "desc" && <span className="ml-1 text-[var(--accent)]">▼</span>}
        </span>
      </Tooltip>
      <div
        className="absolute top-0 -right-px w-[2px] h-full cursor-col-resize z-10 hover:bg-[var(--accent)]/40 transition-colors"
        style={{ background: "rgba(255,255,255,0.06)" }}
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onResizeStart(e.clientX); }}
      />
    </th>
  );
}

// ═══ Period selector (вкладка «Запросы») ═══

type PeriodSel =
  | { mode: "empty" }
  | { mode: "single"; date: string }
  | { mode: "anchor"; anchor: string }
  | { mode: "range"; from: string; to: string };

function periodToDates(p: PeriodSel, todayStr: string): { startDate: string; endDate: string } {
  if (p.mode === "single") return { startDate: p.date, endDate: p.date };
  if (p.mode === "anchor") return { startDate: p.anchor, endDate: p.anchor };
  if (p.mode === "range") return { startDate: p.from, endDate: p.to };
  return { startDate: todayStr, endDate: todayStr };
}

function formatShortDate(d: string): string {
  const [, m, day] = d.split("-");
  const months = ["", "янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."];
  return `${parseInt(day)} ${months[parseInt(m)]}`;
}

function periodLabel(p: PeriodSel, todayStr: string): string {
  if (p.mode === "empty") return "Сегодня";
  if (p.mode === "single") {
    if (p.date === todayStr) return "Сегодня";
    const y = localDateStr(new Date(Date.now() - 86400000));
    if (p.date === y) return "Вчера";
    return formatShortDate(p.date);
  }
  if (p.mode === "anchor") return `${formatShortDate(p.anchor)} → …`;
  const nd = Math.round((Date.parse(p.to + "T12:00:00") - Date.parse(p.from + "T12:00:00")) / 86400000) + 1;
  return `${formatShortDate(p.from)} – ${formatShortDate(p.to)} · ${nd} дн.`;
}

function DateSidebar({
  period, onChange, todayStr,
}: {
  period: PeriodSel;
  onChange: (p: PeriodSel) => void;
  todayStr: string;
}) {
  // 90 дат вниз от сегодня
  const dates = useMemo(() => {
    const arr: string[] = [];
    for (let i = 0; i < 90; i++) arr.push(localDateStr(new Date(Date.now() - i * 86400000)));
    return arr;
  }, []);

  // Двойной клик ловим через собственный таймер (onDoubleClick в React работает, но в паре
  // с onClick создаёт race — сначала всегда выстреливает onClick). Нужен lookahead.
  const clickTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const DBL_DELAY = 250;

  const handleSingle = useCallback((date: string) => {
    // Одиночный клик: всегда переход в single. Если повторный по уже выбранной single — сброс.
    if (period.mode === "single" && period.date === date) {
      onChange({ mode: "empty" });
    } else {
      onChange({ mode: "single", date });
    }
  }, [period, onChange]);

  const handleDouble = useCallback((date: string) => {
    // Первый двойной — anchor. Второй — range (или single, если та же дата).
    if (period.mode === "anchor") {
      if (period.anchor === date) { onChange({ mode: "single", date }); return; }
      const from = period.anchor < date ? period.anchor : date;
      const to = period.anchor < date ? date : period.anchor;
      onChange({ mode: "range", from, to });
    } else {
      onChange({ mode: "anchor", anchor: date });
    }
  }, [period, onChange]);

  const onClick = (date: string) => {
    const ex = clickTimers.current.get(date);
    if (ex) { clearTimeout(ex); clickTimers.current.delete(date); handleDouble(date); return; }
    const t = setTimeout(() => { clickTimers.current.delete(date); handleSingle(date); }, DBL_DELAY);
    clickTimers.current.set(date, t);
  };

  function stateFor(date: string): "none" | "single" | "anchor" | "range-start" | "range-end" | "range-mid" {
    if (period.mode === "single" && period.date === date) return "single";
    if (period.mode === "anchor" && period.anchor === date) return "anchor";
    if (period.mode === "range") {
      if (date === period.from) return "range-start";
      if (date === period.to) return "range-end";
      if (date > period.from && date < period.to) return "range-mid";
    }
    // empty — подсвечиваем «сегодня» как псевдо-single
    if (period.mode === "empty" && date === todayStr) return "single";
    return "none";
  }

  return (
    <div className="shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--bg)]" style={{ width: 96 }}>
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="py-1.5 px-2 text-right text-[10px] font-semibold uppercase tracking-wide bg-[var(--bg-card)] border-b border-[var(--border)] text-[var(--text-muted)]">Дата</th>
          </tr>
        </thead>
        <tbody>
          {dates.map((d) => {
            const s = stateFor(d);
            const dow = new Date(d + "T12:00:00").getDay();
            const isWeekend = dow === 6 || dow === 0;
            const isToday = d === todayStr;
            const bg =
              s === "single" ? "bg-[var(--accent)]/25 " :
              s === "anchor" ? "bg-[var(--accent)]/35 ring-1 ring-[var(--accent)] ring-inset " :
              s === "range-start" || s === "range-end" ? "bg-[var(--accent)]/30 " :
              s === "range-mid" ? "bg-[var(--accent)]/15 " :
              "hover:bg-[var(--bg-card-hover)] ";
            return (
              <tr
                key={d}
                onClick={() => onClick(d)}
                className={"cursor-pointer border-b border-[var(--border)] transition-colors select-none " + bg}
                style={isWeekend ? { borderLeft: "2px solid rgba(251,191,36,0.5)" } : undefined}
                title={period.mode === "anchor" ? "Двойной клик — выбрать конец диапазона" : "Клик — 1 день, двойной клик — начало диапазона"}
              >
                <td
                  className={
                    "py-1 px-2 text-right text-xs font-mono whitespace-nowrap " +
                    (isToday ? "font-semibold text-[var(--accent)]" :
                      isWeekend ? "" : "text-[var(--text-muted)]")
                  }
                  style={isWeekend && !isToday ? { color: "rgba(251,191,36,0.8)" } : undefined}
                >
                  {isToday ? "сегодня" : formatShortDate(d)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ═══ Main panel ═══

export default function AdCampaignDetailPanel({
  campaign,
  days,
  offset = 0,
  tab,
  onTabChange,
  onClose,
}: {
  campaign: AdsCampaign | null;
  days: number;
  offset?: number;
  tab: "daily" | "queries";
  onTabChange: (t: "daily" | "queries") => void;
  onClose?: () => void;
}) {
  const [daysData, setDaysData] = useState<AdCampDay[]>([]);
  const [catalogs, setCatalogs] = useState<AdCampCatalog[]>([]);
  const [loading, setLoading] = useState(false);
  const [leftWidth, setLeftWidth] = useState(220);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // «Запросы»: выбор периода через DateSidebar (single/anchor/range). По умолчанию — empty = сегодня.
  const [qPeriod, setQPeriod] = useState<PeriodSel>({ mode: "empty" });
  // Uni-кампания (объединённый аукцион Поиск+Рекомендации) — в ней WB сам ставит ставки
  // по кластерам, «Наша ставка» как отдельный режим не применяется. Скрываем кнопку и
  // делаем «Управляемые» дефолтом. Ручной «Аукцион» (bidType=manual) — не трогаем.
  const isUniCampaign = !!(campaign?.placements?.search && campaign?.placements?.recommendations && campaign?.bidType !== "manual");
  const isActiveManualAuction = !!(campaign && campaign.status === 9 && campaign.bidType === "manual");
  const isActiveUniCampaign = !!(campaign && campaign.status === 9 && isUniCampaign);
  // Фильтр по типу фразы: all / managed (common) / active (common+unknown) / excluded / our_bid / deferred (disabled)
  const [qTypeFilter, setQTypeFilter] = useState<"all" | "managed" | "active" | "excluded" | "our_bid" | "deferred">("our_bid");
  // Для Uni-кампаний нет «Нашей ставки» — принудительно переключаем на «Управляемые»
  // при открытии такой кампании или при смене.
  useEffect(() => {
    if (isUniCampaign && qTypeFilter === "our_bid") setQTypeFilter("managed");
  }, [isUniCampaign, qTypeFilter]);
  // Поиск по тексту фразы (клиентский фильтр, не влияет на счётчики-бейджи)
  const [qSearch, setQSearch] = useState("");
  const [qKeywords, setQKeywords] = useState<AdCampKeyword[]>([]);
  const [qCatalogs, setQCatalogs] = useState<AdCampCatalog[]>([]);
  const [qLoading, setQLoading] = useState(false);
  const [qRefreshTick, setQRefreshTick] = useState(0);
  const [qRefreshing, setQRefreshing] = useState(false);
  // Журнал проверок позиций (модалка)
  const [logsOpen, setLogsOpen] = useState(false);
  // Наши кластеры (модалка)
  const [clustersOpen, setClustersOpen] = useState(false);
  // Контекстное меню по правому клику на фразу
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; phrase: string; type: string } | null>(null);
  // Выделенные фразы для массовых операций (Set живёт между фильтрами/периодами)
  const [selectedPhrases, setSelectedPhrases] = useState<Set<string>>(new Set());
  // Развёрнутые parent-кластеры (показывают внутри себя children)
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  // Фраза для скролла/подсветки после ddclick-навигации (lc). Снимается по таймеру.
  const [highlightedPhrase, setHighlightedPhrase] = useState<string | null>(null);
  // Клик по заголовку «Джем» — сортировка по djem_orders DESC (повторный клик — сброс).
  const [djemSortActive, setDjemSortActive] = useState(false);
  useEffect(() => {
    loadSettings().then((s) => {
      if (s["ad_queries_djem_sort"] === "1") setDjemSortActive(true);
    });
  }, []);
  const toggleDjemSort = useCallback(() => {
    setDjemSortActive((prev) => {
      const next = !prev;
      saveSetting("ad_queries_djem_sort", next ? "1" : "0");
      return next;
    });
  }, []);
  const toggleExpand = useCallback((parentLc: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(parentLc)) next.delete(parentLc);
      else next.add(parentLc);
      return next;
    });
  }, []);
  // Локальные оптимистичные пометки: фразы, которые мы только что отправили в/из исключений.
  // Ждём ресинка preset-info (через ~2с), а пока UI не врёт.
  const [pendingExcluded, setPendingExcluded] = useState<Map<string, boolean>>(new Map());
  // Оптимистичный UI для ставок: lc(phrase) → {rub, phrasesLc[]} (все фразы кластера, на которые
  // ставка была только что применена). Снимается в useEffect, когда свежий qKeywords подтвердил bid.
  const [pendingBid, setPendingBid] = useState<Map<string, number>>(new Map());
  // Какая фраза сейчас в режиме редактирования (lc). null — режим display.
  const [editingBid, setEditingBid] = useState<string | null>(null);
  const [savingBid, setSavingBid] = useState(false);
  const [bidAutoRules, setBidAutoRules] = useState<BidAutomationRule[]>([]);
  const [bidAutoLogs, setBidAutoLogs] = useState<BidAutomationLog[]>([]);
  const [bidAutoMinBid, setBidAutoMinBid] = useState(0);
  const [bidAutoPhrase, setBidAutoPhrase] = useState<string | null>(null);
  // Флаг: автоскан позиций для этой кампании уже был запущен.
  // Сбрасывается при смене кампании и при handleRefresh (перезапустить автоскан).
  const autoCheckStartedRef = useRef(false);
  const autoOpenedAdvertRef = useRef<number | null>(null);
  const [checkingPhrases, setCheckingPhrases] = useState<Set<string>>(new Set());
  const [freshPos, setFreshPos] = useState<Map<string, { ad_pos: number; organic_pos: number; boost: number }>>(new Map());
  // Дневная разбивка Джема (90 строк на фразу). null = не загружено, Map — готово.
  type DjemDay = { date: string; freq: number; oc: number; atc: number; o: number; pos: number };
  const [djemDaily, setDjemDaily] = useState<Map<string, DjemDay[]> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const dayCols = useColumnMgr({ storageKey: "ad_daily_col", cols: DAY_COLS, lockedKey: "date" });
  const qCols = useColumnMgr({ storageKey: "ad_queries_v2_col", cols: QUERY_COLS, lockedKey: "phrase" });

  const todayStr = useMemo(() => localDateStr(new Date()), []);

  const loadBidAutomation = useCallback(async () => {
    if (!campaign?.firstNmId) {
      setBidAutoRules([]);
      setBidAutoLogs([]);
      setBidAutoMinBid(0);
      return;
    }
    try {
      const res = await fetch(`/api/bid-automation?advertId=${campaign.advertId}&nmId=${campaign.firstNmId}`);
      const d = await res.json();
      if (d?.ok) {
        setBidAutoRules(Array.isArray(d.rules) ? d.rules : []);
        setBidAutoLogs(Array.isArray(d.logs) ? d.logs : []);
        setBidAutoMinBid(Number(d.minBidRub || 0));
      }
    } catch { /* ignore */ }
  }, [campaign, qKeywords]);

  useEffect(() => {
    if (tab !== "queries") return;
    loadBidAutomation();
  }, [tab, loadBidAutomation]);

  // 1) Верхняя панель «По дням» — зависит от days/offset (фильтр сверху)
  useEffect(() => {
    if (!campaign) return;
    setLoading(true);
    const ctrl = new AbortController();
    fetch(`/api/ad-campaign-detail?advertID=${campaign.advertId}&days=${days}&offset=${offset}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) return;
        setDaysData(d.days || []);
        setCatalogs(d.catalogs || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [campaign, days, offset]);

  // 2) Локальное состояние при открытии кампании.
  //   - preset-info (кэш 10 мин) — держит актуальным список управляемых/исключений
  //   - автоскан позиций запускается отдельно в useEffect[qKeywords]:
  //     manual — «Наша ставка», Uni — «Управляемые».
  //     Старый bulk sync phrase-positions убран.
  useEffect(() => {
    if (!campaign) return;
    // Новая кампания — сбрасываем клиентский кэш позиций и флаг автоскана
    autoCheckStartedRef.current = false;
    setFreshPos(new Map());
    setCheckingPhrases(new Set());
    setDjemDaily(null);
    if (campaign.firstNmId) {
      const nmId = campaign.firstNmId;
      if (AUTO_DETAIL_SYNC) {
        fetch(`/api/sync/preset-info?advertID=${campaign.advertId}&nmId=${nmId}`, { method: "POST" })
          .then((r) => r.json())
          .then((d) => { if (d?.ok && (d.rowsWritten > 0 || d.pairs > 0)) setQRefreshTick((x) => x + 1); })
          .catch(() => {});
        // Джем — per-phrase воронка за 90 дней. Кэш 1ч; при скипе silent.
        fetch(`/api/sync/phrase-djem-stats?nmId=${nmId}`, { method: "POST" })
          .then((r) => r.json())
          .then((d) => { if (d?.ok && d.written > 0) setQRefreshTick((x) => x + 1); })
          .catch(() => {});
      }
      // Дневная разбивка Джема — UI только читает из БД.
      // Наполнение БД — фоновый tick в auto-sync-server.ts (каждые 30 мин проходит по всем
      // активным nmId с heal-стратегией: missing-дни + today, yesterday после 09:00 МСК).
      (async () => {
        try {
          const res = await fetch(`/api/phrase-djem-daily?nmId=${nmId}`);
          const d = await res.json();
          if (d?.ok && d.byPhrase) {
            const m = new Map<string, DjemDay[]>();
            for (const [lc, arr] of Object.entries(d.byPhrase as Record<string, DjemDay[]>)) m.set(lc, arr);
            setDjemDaily(m);
          }
        } catch { /* */ }
      })();
    }
  }, [campaign]);

  // При открытии активного ручного аукциона сразу показываем «Запросы» → «Наша ставка»,
  // при открытии активной Uni — «Запросы» → «Управляемые».
  // Делаем это один раз на advert, чтобы ручная навигация пользователя дальше не сбрасывалась.
  useEffect(() => {
    if (!campaign || (!isActiveManualAuction && !isActiveUniCampaign)) return;
    if (autoOpenedAdvertRef.current === campaign.advertId) return;
    autoOpenedAdvertRef.current = campaign.advertId;
    setQTypeFilter(isActiveUniCampaign ? "managed" : "our_bid");
    if (tab !== "queries") onTabChange("queries");
  }, [campaign, isActiveManualAuction, isActiveUniCampaign, tab, onTabChange]);

  const requestPhrasePosition = useCallback(async (phrase: string) => {
    if (!campaign?.firstNmId) return;
    const res = await fetch(
      `/api/sync/phrase-position-one?advertID=${campaign.advertId}&nmId=${campaign.firstNmId}&phrase=${encodeURIComponent(phrase)}`,
      { method: "POST" },
    );
    const d = await res.json();
    const adPos = Number(d?.ad_pos);
    if (!Number.isFinite(adPos)) return;
    const organicPos = Number(d?.organic_pos ?? 0);
    const boost = Number(d?.boost ?? 0);
    setFreshPos((prev) => {
      const next = new Map(prev);
      next.set(phrase, {
        ad_pos: adPos,
        organic_pos: Number.isFinite(organicPos) ? organicPos : 0,
        boost: Number.isFinite(boost) ? boost : 0,
      });
      return next;
    });
  }, [campaign]);

  const requestPhrasePositionsBatch = useCallback(async (phrases: string[]): Promise<Set<string>> => {
    const failed = new Set<string>();
    if (!campaign?.firstNmId || phrases.length === 0) return failed;
    const res = await fetch("/api/sync/phrase-positions-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ advertID: campaign.advertId, nmId: campaign.firstNmId, phrases }),
    });
    const d = await res.json().catch(() => null) as {
      ok?: boolean;
      results?: {
        phrase: string;
        ad_pos: number;
        organic_pos: number;
        boost: number;
        error?: boolean;
      }[];
      error?: string;
    } | null;
    if (!res.ok || !d?.ok || !Array.isArray(d.results)) {
      throw new Error(d?.error || `batch status ${res.status}`);
    }

    const seen = new Set<string>();
    const updates: { phrase: string; ad_pos: number; organic_pos: number; boost: number }[] = [];
    for (const r of d.results || []) {
      if (!r?.phrase) continue;
      seen.add(r.phrase);
      const adPos = Number(r.ad_pos);
      const organicPos = Number(r.organic_pos ?? 0);
      const boost = Number(r.boost ?? 0);
      if (!Number.isFinite(adPos) || r.error || adPos <= 0) {
        failed.add(r.phrase);
        continue;
      }
      updates.push({
        phrase: r.phrase,
        ad_pos: adPos,
        organic_pos: Number.isFinite(organicPos) ? organicPos : 0,
        boost: Number.isFinite(boost) ? boost : 0,
      });
    }

    setFreshPos((prev) => {
      const next = new Map(prev);
      for (const update of updates) {
        next.set(update.phrase, {
          ad_pos: update.ad_pos,
          organic_pos: update.organic_pos,
          boost: update.boost,
        });
      }
      return next;
    });

    for (const phrase of phrases) {
      if (!seen.has(phrase)) failed.add(phrase);
    }
    return failed;
  }, [campaign]);

  // Автообновление позиций идёт очередью через single-endpoint.
  // Сначала пробуем batch одним SSH, затем single-endpoint с 5 попытками только для неудачных фраз.
  const runAutoCheck = useCallback(async (phrases: string[]) => {
    if (!campaign?.firstNmId || phrases.length === 0) return;
    const uniquePhrases = Array.from(new Set(phrases.filter(Boolean)));
    if (uniquePhrases.length === 0) return;
    setCheckingPhrases((prev) => {
      const next = new Set(prev);
      for (const p of uniquePhrases) next.add(p);
      return next;
    });
    let retryPhrases = uniquePhrases;
    try {
      const failed = await requestPhrasePositionsBatch(uniquePhrases);
      retryPhrases = uniquePhrases.filter((phrase) => failed.has(phrase));
      setCheckingPhrases((prev) => {
        const next = new Set(prev);
        for (const phrase of uniquePhrases) {
          if (!failed.has(phrase)) next.delete(phrase);
        }
        return next;
      });
    } catch {
      retryPhrases = uniquePhrases;
    }

    for (const phrase of retryPhrases) {
      try {
        await requestPhrasePosition(phrase);
      } catch { /* ошибка сети — просто снимаем checking */ }
      setCheckingPhrases((prev) => {
        const next = new Set(prev);
        next.delete(phrase);
        return next;
      });
    }
  }, [campaign?.firstNmId, requestPhrasePosition, requestPhrasePositionsBatch]);

  // Запуск автоскана — один раз для активной кампании, как только qKeywords загружен:
  // manual auction → фразы из «Нашей ставки», Uni → управляемые common-фразы.
  useEffect(() => {
    if (!isActiveManualAuction && !isActiveUniCampaign) return;
    if (autoCheckStartedRef.current) return;
    if (tab !== "queries") return;
    if (!campaign?.firstNmId) return;
    if (qKeywords.length === 0) return;
    const phrases = qKeywords
      .filter((k) => isActiveUniCampaign
        ? k.type === "common"
        : k.has_custom_bid && k.type !== "excluded")
      .map((k) => k.phrase);
    if (phrases.length === 0) return;
    autoCheckStartedRef.current = true;
    runAutoCheck(phrases);
  }, [campaign, isActiveManualAuction, isActiveUniCampaign, tab, qKeywords, runAutoCheck]);

  // Отправить/вернуть фразу в/из исключений. Сразу оптимистичная пометка,
  // затем PUT preset-minus → ресинк preset-info → refresh ad-campaign-detail.
  // Пометка снимается автоматически в useEffect ниже, когда свежие qKeywords
  // подтвердят новое состояние is_excluded (устраняет «лаг возврата»).
  //
  // ВАЖНО: WB знает только КАНОНИЧЕСКУЮ (parent) фразу кластера. Children — это
  // синонимы из нашей БД/MPSTATS, WB их не принимает (400 "norm_query X is not
  // valid for nm Y"). Поэтому в API шлём только parent, а children подсвечиваем
  // локально — WB сам раскроет кластер и исключит/вернёт их вместе с parent.
  const handlePresetMinus = useCallback(async (phrase: string, isExcluded: boolean) => {
    if (!campaign?.firstNmId) return;
    const lc = phrase.toLowerCase();

    // Собираем весь кластер для оптимистичной пометки (UI),
    // и каноническую (parent) фразу для отправки в WB.
    type Kw = AdCampKeyword & { is_parent?: boolean; parent_phrase?: string | null; children_phrases?: string[]; real_preset_id?: number | null; preset_id?: string };
    const own = (qKeywords as Kw[]).find((k) => k.phrase.toLowerCase() === lc);
    let clusterPhrases: string[] = [phrase];
    let canonicalPhrase = phrase;
    let cascadePresetId = (own?.real_preset_id ?? Number(own?.preset_id || 0)) || 0;
    if (own) {
      if (own.is_parent && own.children_phrases?.length) {
        clusterPhrases = [own.phrase, ...own.children_phrases];
        canonicalPhrase = own.phrase;
      } else if (own.parent_phrase) {
        const parent = (qKeywords as Kw[]).find((k) => k.phrase.toLowerCase() === own.parent_phrase);
        if (parent) {
          clusterPhrases = [parent.phrase, ...(parent.children_phrases ?? [])];
          canonicalPhrase = parent.phrase;
          cascadePresetId = (parent.real_preset_id ?? Number(parent.preset_id || 0)) || cascadePresetId;
        }
      }
    }
    const cascadeVisibleCount = cascadePresetId > 0
      ? (qKeywords as Kw[]).filter((k) => ((k.real_preset_id ?? Number(k.preset_id || 0)) || 0) === cascadePresetId).length
      : clusterPhrases.length;
    if (isExcluded && cascadeVisibleCount > 1) {
      const ok = window.confirm(CASCADE_CONFIRM_SINGLE.replace("{count}", String(cascadeVisibleCount)));
      if (!ok) return;
    }

    // Оптимистичная пометка для ВСЕХ фраз кластера
    setPendingExcluded((prev) => {
      const next = new Map(prev);
      for (const p of clusterPhrases) next.set(p.toLowerCase(), isExcluded);
      return next;
    });
    try {
      const res = await fetch("/api/advert/preset-minus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advertId: campaign.advertId,
          nmId: campaign.firstNmId,
          isExcluded,
          cascadeByPreset: cascadePresetId > 0,
          cascadePresetId: cascadePresetId || undefined,
          phrases: [canonicalPhrase],
        }),
      });
      const d = await res.json();
      if (!d.ok) {
        setPendingExcluded((prev) => {
          const n = new Map(prev);
          for (const p of clusterPhrases) n.delete(p.toLowerCase());
          return n;
        });
        const details = Array.isArray(d.attempts)
          ? d.attempts.map((a: { reason?: string; status?: number | string; via?: string }) =>
              `${a.via || "?"}: ${a.reason || a.status || "fail"}`).join(" | ")
          : "";
        alert(`Ошибка: ${d.error || d.status || "не удалось обновить"}${details ? `\n${details}` : ""}`);
        return;
      }
      // Сразу (без setTimeout) запускаем ресинк preset-info → trigger refetch ad-campaign-detail.
      // pending держится до приезда свежих qKeywords — useEffect ниже его снимет.
      await fetch(`/api/sync/preset-info?advertID=${campaign.advertId}&nmId=${campaign.firstNmId}&force=1`, { method: "POST" })
        .catch(() => { /* даже если ресинк упал — оставим pending, следующий auto-sync подтянет */ });
      setQRefreshTick((x) => x + 1);
    } catch (e) {
      setPendingExcluded((prev) => {
        const n = new Map(prev);
        for (const p of clusterPhrases) n.delete(p.toLowerCase());
        return n;
      });
      alert(`Ошибка сети: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [campaign, qKeywords]);

  // Массовое исключение/возврат выделенных фраз. Один PUT на список.
  // В WB шлём только канонические (parent) фразы затронутых кластеров — children
  // раскрываются на стороне WB. Для UI подсвечиваем весь кластер.
  const handleBatchPresetMinus = useCallback(async (isExcluded: boolean) => {
    if (!campaign?.firstNmId || selectedPhrases.size === 0) return;
    type Kw = AdCampKeyword & { is_parent?: boolean; parent_phrase?: string | null; children_phrases?: string[]; real_preset_id?: number | null; preset_id?: string };

    const selected = Array.from(selectedPhrases);
    const affectedCluster = new Set<string>();
    const canonicals = new Set<string>();
    const cascadePresetIds = new Set<number>();

    for (const phrase of selected) {
      const own = (qKeywords as Kw[]).find((k) => k.phrase.toLowerCase() === phrase.toLowerCase());
      const ownPresetId = (own?.real_preset_id ?? Number(own?.preset_id || 0)) || 0;
      if (ownPresetId > 0) cascadePresetIds.add(ownPresetId);
      if (own?.is_parent && own.children_phrases?.length) {
        canonicals.add(own.phrase);
        affectedCluster.add(own.phrase.toLowerCase());
        for (const c of own.children_phrases) affectedCluster.add(c.toLowerCase());
      } else if (own?.parent_phrase) {
        const parent = (qKeywords as Kw[]).find((k) => k.phrase.toLowerCase() === own.parent_phrase);
        if (parent) {
          const parentPresetId = (parent.real_preset_id ?? Number(parent.preset_id || 0)) || 0;
          if (parentPresetId > 0) cascadePresetIds.add(parentPresetId);
          canonicals.add(parent.phrase);
          affectedCluster.add(parent.phrase.toLowerCase());
          for (const c of parent.children_phrases ?? []) affectedCluster.add(c.toLowerCase());
        } else {
          canonicals.add(phrase);
          affectedCluster.add(phrase.toLowerCase());
        }
      } else {
        canonicals.add(phrase);
        affectedCluster.add(phrase.toLowerCase());
      }
    }

    const phrasesToSend = Array.from(canonicals);
    const pendingKeys = Array.from(affectedCluster);
    if (isExcluded && cascadePresetIds.size > 0) {
      const visibleCascadeCount = (qKeywords as Kw[])
        .filter((k) => cascadePresetIds.has((k.real_preset_id ?? Number(k.preset_id || 0)) || 0))
        .length;
      const ok = window.confirm(CASCADE_CONFIRM_BATCH.replace("{count}", String(visibleCascadeCount || phrasesToSend.length)));
      if (!ok) return;
    }

    setPendingExcluded((prev) => {
      const next = new Map(prev);
      for (const p of pendingKeys) next.set(p, isExcluded);
      return next;
    });
    try {
      const res = await fetch("/api/advert/preset-minus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advertId: campaign.advertId,
          nmId: campaign.firstNmId,
          isExcluded,
          cascadeByPreset: cascadePresetIds.size > 0,
          phrases: phrasesToSend,
        }),
      });
      const d = await res.json();
      if (!d.ok) {
        setPendingExcluded((prev) => {
          const n = new Map(prev);
          for (const p of pendingKeys) n.delete(p);
          return n;
        });
        const details = Array.isArray(d.attempts)
          ? d.attempts.map((a: { reason?: string; status?: number | string; via?: string }) =>
              `${a.via || "?"}: ${a.reason || a.status || "fail"}`).join(" | ")
          : "";
        alert(`Ошибка: ${d.error || d.status || "не удалось обновить"}${details ? `\n${details}` : ""}`);
        return;
      }
      // Ресинк preset-info → useEffect снимет pending, когда сервер подтвердит
      await fetch(`/api/sync/preset-info?advertID=${campaign.advertId}&nmId=${campaign.firstNmId}&force=1`, { method: "POST" })
        .catch(() => {});
      setQRefreshTick((x) => x + 1);
      setSelectedPhrases(new Set()); // очистить выделение
    } catch (e) {
      setPendingExcluded((prev) => {
        const n = new Map(prev);
        for (const p of pendingKeys) n.delete(p);
        return n;
      });
      alert(`Ошибка сети: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [campaign, selectedPhrases, qKeywords]);

  const togglePhraseSelection = useCallback((phrase: string) => {
    setSelectedPhrases((prev) => {
      const next = new Set(prev);
      if (next.has(phrase)) next.delete(phrase);
      else next.add(phrase);
      return next;
    });
  }, []);

  // Применить новую ставку на ОДНУ WB-нормфразу (parent manual-кластера или одиночный common).
  // WB `/adv/v0/normquery/bids` принимает ставку только на каноническую нормфразу своего
  // кластеризатора — попытки задать ставку на длинные варианты («набор трусов женских 5 штук»)
  // WB молча отклоняет. Поэтому шлём одну фразу, а не весь manual-кластер.
  const handleSetBid = useCallback(async (phrase: string, bidRub: number): Promise<{ ok: boolean; appliedRub?: number; error?: string }> => {
    if (!campaign?.firstNmId) return { ok: false, error: "no firstNmId" };
    type Kw = AdCampKeyword & { is_parent?: boolean; parent_phrase?: string | null; children_phrases?: string[] };
    const sourceLc = phrase.toLowerCase();
    const own = (qKeywords as Kw[]).find((k) => k.phrase.toLowerCase() === sourceLc);
    let canonicalPhrase = phrase;
    let pendingPhrases: string[] = [phrase];
    if (own?.is_parent && own.children_phrases?.length) {
      canonicalPhrase = own.phrase;
      pendingPhrases = [own.phrase, ...own.children_phrases];
    } else if (own?.parent_phrase) {
      const parent = (qKeywords as Kw[]).find((k) => k.phrase.toLowerCase() === own.parent_phrase);
      if (parent) {
        canonicalPhrase = parent.phrase;
        pendingPhrases = [parent.phrase, ...(parent.children_phrases ?? [])];
      }
    }
    const canonicalLc = canonicalPhrase.toLowerCase();

    setSavingBid(true);
    setPendingBid((prev) => {
      const next = new Map(prev);
      for (const p of pendingPhrases) next.set(p.toLowerCase(), bidRub);
      return next;
    });

    try {
      const res = await fetch("/api/advert/set-bid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advertId: campaign.advertId,
          nmId: campaign.firstNmId,
          phrases: [canonicalPhrase],
          bidRub,
        }),
      });
      const d = await res.json();
      if (!d.ok) {
        setPendingBid((prev) => {
          const next = new Map(prev);
          for (const p of pendingPhrases) next.delete(p.toLowerCase());
          next.delete(canonicalLc);
          return next;
        });
        setSavingBid(false);
        return { ok: false, error: d.error || `status ${d.status || res.status}` };
      }

      const appliedRub = Number(d.bidRub ?? bidRub);
      if (d.clamped && appliedRub !== bidRub) {
        setPendingBid((prev) => {
          const next = new Map(prev);
          for (const p of pendingPhrases) next.set(p.toLowerCase(), appliedRub);
          return next;
        });
      }
      fetch(`/api/sync/preset-info?advertID=${campaign.advertId}&nmId=${campaign.firstNmId}&force=1`, { method: "POST" })
        .catch(() => {});
      setQRefreshTick((x) => x + 1);
      setSavingBid(false);
      return { ok: true, appliedRub };
    } catch (e) {
      setPendingBid((prev) => {
        const next = new Map(prev);
        for (const p of pendingPhrases) next.delete(p.toLowerCase());
        next.delete(canonicalLc);
        return next;
      });
      setSavingBid(false);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [campaign, qKeywords]);

  const clearSelection = useCallback(() => {
    setSelectedPhrases(new Set());
  }, []);

  // Снять pending-пометку, когда свежие qKeywords из сервера подтвердили новое состояние.
  // Это закрывает окно «pending снят, qKeywords старый» → нет возврата фразы на долю секунды.
  useEffect(() => {
    if (pendingExcluded.size === 0) return;
    setPendingExcluded((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const [lc, expected] of prev) {
        const kw = qKeywords.find((k) => k.phrase.toLowerCase() === lc);
        if (kw && kw.is_excluded === expected) {
          next.delete(lc);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [qKeywords, pendingExcluded]);

  // То же для pendingBid: снимаем, когда qKeywords.bid (рубли) подтверждает ожидаемое значение.
  useEffect(() => {
    if (pendingBid.size === 0) return;
    setPendingBid((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const [lc, expectedRub] of prev) {
        const kw = qKeywords.find((k) => k.phrase.toLowerCase() === lc);
        if (kw && kw.has_custom_bid && Math.round(kw.bid) === Math.round(expectedRub)) {
          next.delete(lc);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [qKeywords, pendingBid]);

  // Скан фраз кампании через wb-parser → авто-кластеризация по реальным WB-preset.
  // Endpoint: POST /api/clusters/scan-campaign?advertId=X. Запускается, мы поллим прогресс через GET.
  const [scanProgress, setScanProgress] = useState<{ scanned: number; total: number; pass: number; running: boolean } | null>(null);
  const scanPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopScanPolling = useCallback(() => {
    if (scanPollRef.current) { clearInterval(scanPollRef.current); scanPollRef.current = null; }
  }, []);
  const startScanPolling = useCallback((advertId: number) => {
    stopScanPolling();
    scanPollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/clusters/scan-campaign?advertId=${advertId}`);
        const j = await r.json();
        if (!j.ok || !j.progress) return;
        setScanProgress({ scanned: j.progress.scanned, total: j.progress.total, pass: j.progress.pass, running: j.progress.running });
        if (j.progress.running) return;
        // Scan завершился. Останавливаем polling, перезагружаем данные, прячем счётчик.
        stopScanPolling();
        setQRefreshing(false);
        if (!j.progress.error && campaign?.firstNmId) {
          try {
            await fetch(`/api/sync/preset-info?advertID=${advertId}&nmId=${campaign.firstNmId}&force=1`, { method: "POST" });
          } catch { /* */ }
          setQRefreshTick((x) => x + 1);
          autoCheckStartedRef.current = false;
        }
        setTimeout(() => setScanProgress(null), 3000);
      } catch { /* */ }
    }, 1500);
  }, [stopScanPolling, campaign]);
  // queryRows объявлен ниже handleRefresh (вычисляется из qKeywords/фильтров).
  // Используем ref, чтобы handleRefresh не зависел от queryRows и не пересоздавался на
  // каждом изменении фильтра — но при клике брал актуальный список.
  const queryRowsRef = useRef<{ kind: string; phrase: string; depth: number; children_phrases?: string[] }[]>([]);
  // На маунте/смене кампании — проверяем не идёт ли scan на этом advert (запущенный
  // ранее в другой сессии panel'а). Если идёт — подцепляем polling, чтобы UI показал прогресс.
  // На размонтаже — глушим интервал, чтобы он не висел в фоне после ухода с кампании.
  useEffect(() => {
    if (!campaign?.advertId) return;
    const advertId = campaign.advertId;
    fetch(`/api/clusters/scan-campaign?advertId=${advertId}`)
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok || !j.progress) return;
        if (j.progress.running) {
          setScanProgress({ scanned: j.progress.scanned, total: j.progress.total, pass: j.progress.pass, running: true });
          setQRefreshing(true);
          startScanPolling(advertId);
        }
      })
      .catch(() => {});
    return () => { stopScanPolling(); };
  }, [campaign?.advertId, startScanPolling, stopScanPolling]);

  const handleRefresh = useCallback(async () => {
    if (!campaign || qRefreshing) return;
    const advertId = campaign.advertId;

    // Скан фраз под текущим фильтром: top-level (видимые в дереве) + ВСЕ их child'ы из
    // manual_clusters (даже свернутые). Детей сканируем потому, что WB мог пере-кластеризовать
    // или MPSTATS изначально неправильно объединил — без скана детей мы это не обнаружим.
    // Если у child реальный preset отличается от parent'а — алгоритм сам перенесёт его.
    const phraseSet = new Set<string>();
    for (const r of queryRowsRef.current) {
      if (r.kind !== "kw" || r.depth !== 0) continue;
      phraseSet.add(r.phrase);
      for (const c of r.children_phrases || []) phraseSet.add(c);
    }
    const phrasesToScan = Array.from(phraseSet);
    if (phrasesToScan.length === 0) {
      alert("Нет фраз для сканирования. Откройте вкладку с непустым списком (Управляемые / Активные / Исключения / Все).");
      return;
    }

    setQRefreshing(true);
    setScanProgress({ scanned: 0, total: 0, pass: 0, running: true });

    try {
      const res = await fetch(`/api/clusters/scan-campaign?advertId=${advertId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrases: phrasesToScan }),
      });
      const result = await res.json();

      if (res.status === 409) {
        // Уже идёт scan (например пользователь ушёл с кампании, потом вернулся и нажал ↻).
        // Не алертим — просто подцепляемся к существующему через polling.
        startScanPolling(advertId);
        return;
      }
      if (!result?.ok) {
        alert(`Ошибка скана: ${result?.error || "неизвестная"}`);
        setQRefreshing(false);
        setScanProgress(null);
        return;
      }
      // POST вернулся успешно — scan завершён (он сам ждёт окончания всех passes).
      // Подгружаем финальный прогресс через GET и запускаем краткое polling-завершение
      // (на случай если completion-handlers нужны).
      startScanPolling(advertId);
    } catch (e) {
      alert(`Ошибка скана: ${e instanceof Error ? e.message : String(e)}`);
      setQRefreshing(false);
      setScanProgress(null);
    }
  }, [campaign, qRefreshing, startScanPolling]);

  // 3) Запросы — пересчёт по выбранному period (debounce 250мс чтобы быстрые клики = 1 запрос)
  useEffect(() => {
    if (!campaign) return;
    const { startDate, endDate } = periodToDates(qPeriod, todayStr);
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setQLoading(true);
      fetch(`/api/ad-campaign-detail?advertID=${campaign.advertId}&startDate=${startDate}&endDate=${endDate}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => {
          if (!d.ok) return;
          setQKeywords(d.keywords || []);
          setQCatalogs(d.catalogs || []);
        })
        .catch(() => {})
        .finally(() => setQLoading(false));
    }, 250);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [campaign, qPeriod, todayStr, qRefreshTick]);

  const handleDividerMouseDown = useCallback(() => {
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const w = e.clientX - rect.left;
      setLeftWidth(Math.max(140, Math.min(500, w)));
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // Счётчики для кнопок-фильтров считают top-level строки тем же правилом, что и queryRows.
  // Для «Нашей ставки» child со ставкой остается внутри parent-кластера: ставку меняем только на parent.
  const typeCounters = useMemo(() => {
    type FilterKey = "all" | "managed" | "active" | "excluded" | "our_bid";
    type CounterRow = {
      phrase: string;
      type: "common" | "excluded" | "unknown";
      has_custom_bid: boolean;
      is_parent: boolean;
      parent_phrase: string | null;
    };
    type Kw = AdCampKeyword & {
      is_parent?: boolean;
      parent_phrase?: string | null;
    };

    const rows: CounterRow[] = (qKeywords as Kw[]).map((k) => {
      const lc = k.phrase.toLowerCase();
      const pend = pendingExcluded.get(lc);
      const effType = pend == null
        ? k.type
        : (pend ? "excluded" : (k.type === "excluded" ? "common" : k.type));
      return {
        phrase: k.phrase,
        type: effType,
        has_custom_bid: pendingBid.has(lc) ? true : k.has_custom_bid,
        is_parent: Boolean(k.is_parent),
        parent_phrase: k.parent_phrase ?? null,
      };
    });

    const parentLcs = new Set(rows.filter((row) => row.is_parent).map((row) => row.phrase.toLowerCase()));
    const rowByPhrase = new Map(rows.map((row) => [row.phrase.toLowerCase(), row]));

    const passes = (row: CounterRow, filter: FilterKey) => {
      if (filter === "all") return true;
      if (filter === "managed") return row.type === "common";
      if (filter === "active") return row.type === "common" || row.type === "unknown";
      if (filter === "excluded") return row.type === "excluded";
      return row.type !== "excluded" && row.has_custom_bid;
    };

    const countFor = (filter: FilterKey) => {
      const childrenByParent = new Map<string, CounterRow[]>();
      const topRows: CounterRow[] = [];

      for (const row of rows) {
        const parentLc = row.parent_phrase?.toLowerCase() ?? null;
        if (parentLc && parentLcs.has(parentLc)) {
          const parentRow = rowByPhrase.get(parentLc);
          const childKeepsParent = filter === "our_bid" && row.type !== "excluded" && row.has_custom_bid;
          if (parentRow && (passes(parentRow, filter) || childKeepsParent)) {
            const kids = childrenByParent.get(parentLc) ?? [];
            kids.push(row);
            childrenByParent.set(parentLc, kids);
            continue;
          }
        }
        topRows.push(row);
      }

      let count = 0;
      for (const row of topRows) {
        let rowPasses = passes(row, filter);
        if (!rowPasses && row.is_parent && row.type !== "excluded") {
          const kids = childrenByParent.get(row.phrase.toLowerCase()) ?? [];
          rowPasses = kids.some((kid) => passes(kid, filter));
        }
        if (rowPasses) count++;
      }
      return count;
    };

    return {
      all: countFor("all"),
      managed: countFor("managed"),
      active: countFor("active"),
      excluded: countFor("excluded"),
      our_bid: countFor("our_bid"),
      deferred: 0,
    };
  }, [qKeywords, pendingExcluded, pendingBid]);

  const queryRows = useMemo(() => {
    type Row = {
      kind: "kw" | "cat"; phrase: string; share: number;
      type: "common" | "excluded" | "unknown" | "cat";
      is_excluded: boolean; has_custom_bid: boolean;
      views: number; ctr: number; clicks: number; cpc: number; spend: number;
      bid: number; min_cpm_search: number; avg_pos: number; cpm: number;
      baskets: number; orders: number; shks: number;
      approx_views_wb: number;
      cluster_inner: { phrase: string; frequency: number }[];
      ad_pos: number; boost: number; preset_id: string;
      real_preset_id: number | null;
      djem_views: number; djem_clicks: number; djem_baskets: number;
      djem_orders: number; djem_order_sum: number; djem_ctr: number;
      djem_cart_conv: number; djem_order_conv: number;
      djem_avg_price: number; djem_avg_pos: number;
      djem_period_start: string | null; djem_period_end: string | null;
      is_parent: boolean;
      parent_phrase: string | null;
      children_count: number;
      children_phrases: string[];
      djem_phrases: string[];  // lc-фразы для lookup в phrase_djem_stats_daily
      depth: 0 | 1; // 0 — верхний уровень, 1 — child под parent
      parent_is_excluded: boolean; // только для depth=1: parent excluded → красим как excluded
      parent_filtered_out: boolean; // depth=0 но фраза — child кластера, чей parent не прошёл фильтр (orphaned-by-filter)
      parent_excluded_real: boolean; // если parent_filtered_out — у parent'а type=excluded?
    };
    // Фильтр по типу — кальки логики ивирмы:
    //   all = всё (включая каталоги), managed = common, active = common+unknown,
    //   excluded = excluded, our_bid = has_custom_bid (ставка задана вручную),
    //   deferred = pass-through (пока disabled в UI)
    const allowedTypes = new Set<string>();
    if (qTypeFilter === "all") ["common", "excluded", "unknown", "cat"].forEach((t) => allowedTypes.add(t));
    else if (qTypeFilter === "our_bid") { allowedTypes.add("common"); allowedTypes.add("unknown"); }
    else if (qTypeFilter === "managed") allowedTypes.add("common");
    else if (qTypeFilter === "active") { allowedTypes.add("common"); allowedTypes.add("unknown"); }
    else if (qTypeFilter === "excluded") allowedTypes.add("excluded");

    const q = qSearch.trim().toLowerCase();

    // 1) Превращаем все qKeywords в Row, БЕЗ фильтрации.
    // Фильтр применим позже только к top-level (чтобы children не отсеивались из-за
    // несоответствия фильтру — они часть кластера и должны показываться при expand всегда).
    const allRows: Row[] = [];
    for (const k of qKeywords) {
      const pend = pendingExcluded.get(k.phrase.toLowerCase());
      const effType = pend == null ? k.type : (pend ? "excluded" : (k.type === "excluded" ? "common" : k.type));
      const effExcluded = pend == null ? k.is_excluded : pend;
      const pendBidRub = pendingBid.get(k.phrase.toLowerCase());
      const effBid = pendBidRub != null ? pendBidRub : k.bid;
      const effHasCustomBid = pendBidRub != null ? true : k.has_custom_bid;
      const kExt = k as AdCampKeyword & {
        cluster_inner?: { phrase: string; frequency: number }[];
        is_parent?: boolean;
        parent_phrase?: string | null;
        children_phrases?: string[];
        djem_phrases?: string[];
      };
      allRows.push({
        kind: "kw", phrase: k.phrase, share: k.share,
        type: effType, is_excluded: effExcluded, has_custom_bid: effHasCustomBid,
        views: k.views, ctr: k.ctr, clicks: k.clicks, cpc: k.cpc, spend: k.spend,
        bid: effBid, min_cpm_search: k.min_cpm_search ?? 0, avg_pos: k.avg_pos, cpm: k.cpm,
        baskets: k.baskets, orders: k.orders, shks: k.shks,
        approx_views_wb: k.approx_views_wb ?? 0,
        cluster_inner: kExt.cluster_inner ?? [],
        ad_pos: k.ad_pos, boost: k.boost, preset_id: k.preset_id,
        real_preset_id: k.real_preset_id ?? null,
        djem_views: k.djem_views ?? 0, djem_clicks: k.djem_clicks ?? 0, djem_baskets: k.djem_baskets ?? 0,
        djem_orders: k.djem_orders ?? 0, djem_order_sum: k.djem_order_sum ?? 0, djem_ctr: k.djem_ctr ?? 0,
        djem_cart_conv: k.djem_cart_conv ?? 0, djem_order_conv: k.djem_order_conv ?? 0,
        djem_avg_price: k.djem_avg_price ?? 0, djem_avg_pos: k.djem_avg_pos ?? 0,
        djem_period_start: k.djem_period_start ?? null, djem_period_end: k.djem_period_end ?? null,
        is_parent: Boolean(kExt.is_parent),
        parent_phrase: kExt.parent_phrase ?? null,
        children_count: (kExt.children_phrases ?? []).length,
        children_phrases: kExt.children_phrases ?? [],
        djem_phrases: kExt.djem_phrases ?? [k.phrase.toLowerCase()],
        depth: 0,
        parent_is_excluded: false,
        parent_filtered_out: false,
        parent_excluded_real: false,
      });
    }
    // 2) Bucket children под parent_phrase. ВАЖНО: бакет только если parent проходит
    // текущий тип-фильтр. Иначе child прячется под невидимым parent'ом и теряется.
    // Пример: «стринги детские» (common) лежит в кластере «стринги женские» (excluded).
    // На вкладке «Управляемые» parent невидим — child должен стать top-level чтобы показаться.
    const allParentLcs = new Set<string>();
    for (const r of allRows) if (r.is_parent) allParentLcs.add(r.phrase.toLowerCase());
    const rowByPhrase = new Map<string, typeof allRows[number]>();
    for (const r of allRows) rowByPhrase.set(r.phrase.toLowerCase(), r);
    const parentPassesTypeFilter = (row: typeof allRows[number]) => {
      const matchType = allowedTypes.has(row.type);
      const matchOurBid = qTypeFilter !== "our_bid" || row.has_custom_bid;
      return matchType && matchOurBid;
    };
    const childrenByParent = new Map<string, typeof allRows>();
    const allChildrenByParent = new Map<string, typeof allRows>();
    const nonChildRows: typeof allRows = [];
    for (const r of allRows) {
      const pp = r.parent_phrase;
      if (pp && allParentLcs.has(pp)) {
        const parentRow = rowByPhrase.get(pp);
        if (parentRow) {
          const allKids = allChildrenByParent.get(pp) ?? [];
          allKids.push(r);
          allChildrenByParent.set(pp, allKids);
        }
        const childKeepsParentForOurBid = qTypeFilter === "our_bid" && r.type !== "excluded" && r.has_custom_bid;
        if (parentRow && (parentPassesTypeFilter(parentRow) || childKeepsParentForOurBid)) {
          const arr = childrenByParent.get(pp) ?? [];
          arr.push(r);
          childrenByParent.set(pp, arr);
          continue;
        }
        // Parent существует, но не проходит фильтр → child становится top-level.
        // Помечаем чтобы UI отрисовал маркер «↳ из кластера X» (даёт контекст потерянной группировки).
        if (parentRow) {
          nonChildRows.push({ ...r, parent_filtered_out: true, parent_excluded_real: parentRow.type === "excluded" });
          continue;
        }
      }
      nonChildRows.push(r);
    }

    // 3) Фильтр применяется только к top-level (parents + orphans).
    // Для parent: если хотя бы один child подходит фильтру, оставляем родителя
    // (иначе пользователь потеряет весь кластер при просмотре Исключений/Управляемых).
    const filteredTopLevel: typeof allRows = [];
    for (const row of nonChildRows) {
      const matchPhrase = !q || row.phrase.toLowerCase().includes(q);
      const selfMatchesType = allowedTypes.has(row.type);
      const selfMatchesOurBid = qTypeFilter !== "our_bid" || row.has_custom_bid;
      let selfPasses = selfMatchesType && selfMatchesOurBid && matchPhrase;
      // Fallback через children только если сам parent НЕ excluded. Исключённый кластер
      // показываем только на «Исключения»/«Все» — его не должно быть в managed/active/our_bid,
      // даже если у какого-то ребёнка локально остался type=common.
      if (!selfPasses && row.is_parent && row.type !== "excluded") {
        const kids = childrenByParent.get(row.phrase.toLowerCase()) ?? [];
        const anyKidMatches = kids.some((k) =>
          allowedTypes.has(k.type) &&
          (qTypeFilter !== "our_bid" || k.has_custom_bid) &&
          (!q || k.phrase.toLowerCase().includes(q)),
        );
        if (anyKidMatches) selfPasses = true;
      }
      if (selfPasses) filteredTopLevel.push(row);
    }

    // 4) Каталоги — только на вкладке «Все»
    if (qTypeFilter === "all") {
      for (const c of qCatalogs) {
        const label = `Каталог ${c.catalog_id}`;
        if (q && !label.toLowerCase().includes(q)) continue;
        filteredTopLevel.push({
          kind: "cat", phrase: label, share: c.share,
          type: "cat", is_excluded: false, has_custom_bid: false,
          views: c.views, ctr: c.ctr, clicks: c.clicks, cpc: c.cpc, spend: c.spend,
          bid: 0, min_cpm_search: 0, avg_pos: 0, cpm: 0, baskets: 0, orders: 0, shks: 0,
          approx_views_wb: 0,
          cluster_inner: [],
          ad_pos: 0, boost: 0, preset_id: "", real_preset_id: null,
          djem_views: 0, djem_clicks: 0, djem_baskets: 0,
          djem_orders: 0, djem_order_sum: 0, djem_ctr: 0,
          djem_cart_conv: 0, djem_order_conv: 0,
          djem_avg_price: 0, djem_avg_pos: 0,
          djem_period_start: null, djem_period_end: null,
          is_parent: false, parent_phrase: null, children_count: 0, children_phrases: [], djem_phrases: [], depth: 0,
          parent_is_excluded: false,
          parent_filtered_out: false,
          parent_excluded_real: false,
        });
      }
    }

    // 5) Сортировка. По умолчанию — по кластерной частотности (стабильна между датами).
    // Если активна сортировка по Джему — сортируем по djem_orders DESC, tie-break по freq.
    const byFreq = (a: (typeof allRows)[number], b: (typeof allRows)[number]) => {
      const fa = a.approx_views_wb || 0;
      const fb = b.approx_views_wb || 0;
      if (fa !== fb) return fb - fa;
      return b.views - a.views;
    };
    const byDjemOrders = (a: (typeof allRows)[number], b: (typeof allRows)[number]) => {
      const oa = a.djem_orders || 0;
      const ob = b.djem_orders || 0;
      if (oa !== ob) return ob - oa;
      return byFreq(a, b);
    };
    const cmp = djemSortActive ? byDjemOrders : byFreq;
    filteredTopLevel.sort(cmp);

    // 6) Финальный список: parents + expanded children (все, без фильтра на children)
    const out: typeof allRows = [];
    for (const r of filteredTopLevel) {
      out.push(r);
      if (r.is_parent && expandedParents.has(r.phrase.toLowerCase())) {
        const kids = (allChildrenByParent.get(r.phrase.toLowerCase()) ?? childrenByParent.get(r.phrase.toLowerCase()) ?? []).slice().sort(cmp);
        // Если parent в исключениях — пропагируем excluded на children для визуала
        // (WB исключает кластер целиком, в БД is_excluded стоит только у parent canonical).
        const parentExcluded = r.is_excluded || r.type === "excluded";
        for (const kid of kids) out.push({ ...kid, depth: 1, parent_is_excluded: parentExcluded });
      }
    }
    return out;
  }, [qKeywords, qCatalogs, qTypeFilter, qSearch, pendingExcluded, pendingBid, expandedParents, djemSortActive]);

  // Зеркалим queryRows в ref для handleRefresh (он не пересоздаётся на каждом изменении фильтров,
  // но при клике должен видеть актуальный список фраз для скана).
  useEffect(() => { queryRowsRef.current = queryRows; }, [queryRows]);

  // Скролл и подсветка фразы после dblclick-навигации в «Исключения».
  // 1) Если целевая фраза — child, раскрываем её parent чтобы строка появилась в дереве.
  // 2) Скроллим к строке.
  // 3) Через 2.5с снимаем подсветку.
  useEffect(() => {
    if (!highlightedPhrase) return;
    // Найти target row по lc
    const target = queryRows.find((r) => r.phrase.toLowerCase() === highlightedPhrase);
    if (!target) return;
    // Если child — раскрыть parent
    if (target.depth === 1 && target.parent_phrase) {
      const parentLc = target.parent_phrase.toLowerCase();
      if (!expandedParents.has(parentLc)) {
        setExpandedParents((prev) => { const n = new Set(prev); n.add(parentLc); return n; });
        return; // следующий тик с раскрытым parent перерисует и сюда придём снова
      }
    }
    // Скролл (после микрозадержки чтобы DOM успел перерендериться)
    const t1 = setTimeout(() => {
      const el = document.querySelector(`tr[data-phrase="${CSS.escape(highlightedPhrase)}"]`);
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 50);
    // Снимаем подсветку через 2.5с
    const t2 = setTimeout(() => setHighlightedPhrase(null), 2500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [highlightedPhrase, queryRows, expandedParents]);

  async function checkSinglePhrase(phrase: string) {
    if (!campaign || checkingPhrases.has(phrase)) return;
    const primaryNmId = campaign.firstNmId;
    if (!primaryNmId) return;
    setCheckingPhrases((prev) => new Set(prev).add(phrase));
    try {
      await requestPhrasePosition(phrase);
    } catch { /* ignore */ }
    setCheckingPhrases((prev) => { const next = new Set(prev); next.delete(phrase); return next; });
  }

  if (!campaign) return null;

  const todayRow = daysData.find((d) => d.date === todayStr) || daysData[0] || null;
  const dayColMap = new Map(DAY_COLS.map((c) => [c.key, c]));
  const bidAutoSelectedLc = bidAutoPhrase?.toLowerCase() || "";
  const bidAutoSelectedRow = bidAutoSelectedLc
    ? queryRows.find((r) => r.kind === "kw" && r.phrase.toLowerCase() === bidAutoSelectedLc) || null
    : null;
  const bidAutoSelectedRule = bidAutoSelectedLc
    ? bidAutoRules.find((r) => r.phrase.toLowerCase() === bidAutoSelectedLc) || null
    : null;
  const bidAutoSelectedLog = bidAutoSelectedLc
    ? bidAutoLogs.find((l) => l.phrase.toLowerCase() === bidAutoSelectedLc) || null
    : null;
  const bidAutoSelectedLogs = bidAutoSelectedLc
    ? bidAutoLogs.filter((l) => l.phrase.toLowerCase() === bidAutoSelectedLc).slice(0, 20)
    : [];

  return (
    <div ref={containerRef} className="flex h-full overflow-hidden bg-[var(--bg)]">
      {bidAutoPhrase && bidAutoSelectedRow && campaign.firstNmId && (
        <BidAutomationModal
          open={true}
          advertId={campaign.advertId}
          nmId={campaign.firstNmId}
          campaignName={campaign.name || `Кампания ${campaign.advertId}`}
          phrase={bidAutoPhrase}
          currentBidRub={bidAutoSelectedRow.has_custom_bid && bidAutoSelectedRow.bid > 0
            ? bidAutoSelectedRow.bid
            : (bidAutoSelectedRow.min_cpm_search || bidAutoMinBid)}
          minBidRub={bidAutoMinBid || bidAutoSelectedRow.min_cpm_search || 1}
          rule={bidAutoSelectedRule}
          lastLog={bidAutoSelectedLog}
          logs={bidAutoSelectedLogs}
          onClose={() => setBidAutoPhrase(null)}
          onSaved={loadBidAutomation}
        />
      )}
      <div style={{ width: leftWidth }} className="shrink-0 overflow-hidden border-r border-[var(--border)]">
        <CampaignCard c={campaign} />
      </div>
      <VerticalDivider onMouseDown={handleDividerMouseDown} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] shrink-0">
          {([
            { key: "daily", label: "По дням" },
            { key: "queries", label: "Запросы" },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => onTabChange(t.key)}
              className={
                "px-3 py-1 text-xs rounded-lg border transition-colors " +
                (tab === t.key
                  ? "bg-[var(--accent)]/20 text-[var(--accent)] border-[var(--accent)]"
                  : "text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text)]")
              }
            >
              {t.label}
            </button>
          ))}
          {tab === "queries" && (
            <>
              {/* 5 кнопок-фильтров по аналогии с ивирмой */}
              <div className="ml-2 flex items-center rounded-lg border border-[var(--border)] overflow-hidden">
                {([
                  // Для Uni-кампаний (объединённый аукцион) скрываем «Наша ставка» —
                  // там нет ручных ставок на фразы, WB сам рулит по кластерам.
                  ...(isUniCampaign ? [] : [{
                    k: "our_bid" as const, label: "Наша ставка", n: typeCounters.our_bid, disabled: false,
                    tip: "Фразы, на которые вы поставили ставку CPM вручную.\nВ колонке ₽ они подсвечены акцентом.",
                  }]),
                  {
                    k: "managed" as const, label: "Управляемые", n: typeCounters.managed, disabled: false,
                    tip: "Фразы, по которым WB даёт API управления:\n• установить/сбросить ставку CPM\n• отправить в исключения\n\nДоступны только те, что набрали 100+ показов за историю кампании.",
                  },
                  {
                    k: "active" as const, label: "Активные", n: typeCounters.active, disabled: false,
                    tip: "Все фразы, по которым сейчас крутится реклама (не в исключениях):\n• управляемые — с доступным API\n• неуправляемые (<100 показов) — WB пока не даёт API\n\nПо неуправляемым реклама тоже показывается и тратит бюджет — но править их можно только после 100 показов.",
                  },
                  {
                    k: "excluded" as const, label: "Исключения", n: typeCounters.excluded, disabled: false,
                    tip: "Фразы, которые вы отправили в минус.\nПо ним реклама не показывается, бюджет не тратится.",
                  },
                  {
                    k: "all" as const, label: "Все", n: typeCounters.all, disabled: false,
                    tip: "Полный список: управляемые + неуправляемые + исключения.\n+ все каталоги, на которые идёт реклама.",
                  },
                  {
                    k: "deferred" as const, label: "Отложенные искл.", n: typeCounters.deferred, disabled: true,
                    tip: "Beta, скоро. Поставить неуправляемую фразу (<100 показов) в очередь на автоисключение.\nКак только она наберёт 100 показов — бот автоматически отправит её в минус через API, не дожидаясь слива бюджета.\nТребует API-ключ WB с правом рекламы.",
                  },
                ]).map((f) => (
                  <Tooltip key={f.k} text={f.tip}>
                    <button
                      onClick={() => !f.disabled && setQTypeFilter(f.k)}
                      disabled={f.disabled}
                      className={
                        "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors border-r border-[var(--border)] last:border-r-0 " +
                        (f.disabled
                          ? "text-[var(--text-muted)] cursor-not-allowed"
                          : qTypeFilter === f.k
                            ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                            : "text-[var(--text-muted)] hover:text-[var(--text)]")
                      }
                    >
                      <span>{f.label}</span>
                      <span className={
                        "inline-flex items-center justify-center h-4 min-w-[20px] px-1 rounded-full text-[9px] font-mono leading-none bg-[var(--bg)] " +
                        (f.disabled ? "text-[var(--text-muted)]/40" : "text-[var(--text-muted)]")
                      }>
                        {f.disabled ? "?" : f.n}
                      </span>
                    </button>
                  </Tooltip>
                ))}
              </div>
              <div className="ml-2 flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
                <span className="text-[var(--text)]">{periodLabel(qPeriod, todayStr)}</span>
                {qPeriod.mode !== "empty" && (
                  <button
                    onClick={() => setQPeriod({ mode: "empty" })}
                    className="ml-1 text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
                    title="Сбросить выбор периода"
                  >
                    ×
                  </button>
                )}
              </div>
              <button
                onClick={handleRefresh}
                disabled={qRefreshing}
                className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] transition-colors text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-50 disabled:cursor-wait"
                title="Сканировать все фразы кампании через wb-parser и пере-кластеризовать по реальным WB-preset"
              >
                <svg className={"w-3.5 h-3.5 " + (qRefreshing ? "animate-spin" : "")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
                  <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
                </svg>
              </button>
              {scanProgress && (
                <span className="text-xs text-[var(--text-muted)] font-mono whitespace-nowrap" title={`Проход ${scanProgress.pass} / 10`}>
                  {scanProgress.scanned}/{scanProgress.total > 0 ? scanProgress.total : "…"}
                </span>
              )}
              <button
                onClick={() => setLogsOpen(true)}
                className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] transition-colors text-[var(--text-muted)] hover:text-[var(--text)]"
                title="Журнал проверок позиций (отладка)"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <line x1="10" y1="9" x2="8" y2="9" />
                </svg>
              </button>
              <button
                onClick={() => setClustersOpen(true)}
                className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] transition-colors text-[var(--text-muted)] hover:text-[var(--text)]"
                title="Наши кластеры (ручная база)"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </button>
              <div className="ml-2 flex items-center rounded-lg border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
                <svg className="w-3.5 h-3.5 ml-2 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  value={qSearch}
                  onChange={(e) => setQSearch(e.target.value)}
                  placeholder="Поиск по фразе…"
                  className="px-2 py-1 text-xs bg-transparent text-[var(--text)] w-48 outline-none"
                />
                {qSearch && (
                  <button
                    onClick={() => setQSearch("")}
                    className="px-2 text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
                    title="Очистить поиск"
                  >
                    ×
                  </button>
                )}
              </div>
              {selectedPhrases.size > 0 && (
                <div className="ml-2 flex items-center gap-2 px-3 py-1 rounded-lg border border-[var(--accent)] bg-[var(--accent)]/10 text-xs">
                  <span className="text-[var(--accent)] font-semibold">Выбрано: {selectedPhrases.size}</span>
                  <div className="w-px h-4 bg-[var(--accent)]/40" />
                  {qTypeFilter !== "excluded" ? (
                    <button
                      onClick={() => handleBatchPresetMinus(true)}
                      className="text-[var(--danger)] hover:underline font-medium flex items-center gap-1"
                      title="Исключить все выделенные фразы"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                      </svg>
                      Исключить
                    </button>
                  ) : (
                    <button
                      onClick={() => handleBatchPresetMinus(false)}
                      className="text-[var(--accent)] hover:underline font-medium flex items-center gap-1"
                      title="Вернуть все выделенные фразы из исключений"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 12a9 9 0 1 0 9-9" /><polyline points="3 4 3 10 9 10" />
                      </svg>
                      Вернуть
                    </button>
                  )}
                  <button
                    onClick={clearSelection}
                    className="text-[var(--text-muted)] hover:text-[var(--text)] ml-1"
                    title="Снять выделение"
                  >
                    ×
                  </button>
                </div>
              )}
            </>
          )}
          <div className="flex-1" />
          {tab === "daily" && (
            <ColSettingsButton cols={DAY_COLS} hiddenCols={dayCols.hiddenCols} toggleCol={dayCols.toggleCol} resetHidden={dayCols.resetHidden} lockedKey="date" />
          )}
          {tab === "queries" && (
            <ColSettingsButton cols={QUERY_COLS} hiddenCols={qCols.hiddenCols} toggleCol={qCols.toggleCol} resetHidden={qCols.resetHidden} lockedKey="phrase" />
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-card-hover)] transition-colors text-[var(--text-muted)]"
              title="Закрыть"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">Загрузка...</div>
          ) : tab === "queries" && !qCols.ready ? (
            <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">Загрузка...</div>
          ) : tab === "queries" ? (
            <div className="flex-1 flex overflow-hidden min-h-0">
              <DateSidebar period={qPeriod} onChange={setQPeriod} todayStr={todayStr} />
              <div className="flex-1 overflow-auto">
            <table className="w-full border-collapse text-xs" style={{ tableLayout: "fixed" }}>
              <thead className="sticky top-0 z-10">
                <tr>
                  {/* Master-checkbox: toggle all currently visible kw-rows */}
                  <th className="w-8 bg-[var(--bg-card)] border-b border-[var(--border)] text-center py-1.5">
                    {(() => {
                      const visible = queryRows.filter((r) => r.kind === "kw").map((r) => r.phrase);
                      const allSel = visible.length > 0 && visible.every((p) => selectedPhrases.has(p));
                      const someSel = visible.some((p) => selectedPhrases.has(p));
                      return (
                        <input
                          type="checkbox"
                          checked={allSel}
                          ref={(el) => { if (el) el.indeterminate = someSel && !allSel; }}
                          onChange={() => {
                            setSelectedPhrases((prev) => {
                              const next = new Set(prev);
                              if (allSel) for (const p of visible) next.delete(p);
                              else for (const p of visible) next.add(p);
                              return next;
                            });
                          }}
                          className="accent-[var(--text-muted)] w-3 h-3 cursor-pointer opacity-40 hover:opacity-90 checked:opacity-100 transition-opacity"
                          title={allSel ? "Снять выделение со всех видимых" : "Выделить все видимые фразы"}
                        />
                      );
                    })()}
                  </th>
                  {qCols.colOrder.filter((k) => !qCols.hiddenCols.includes(k)).map((k) => {
                    const col = QUERY_COLS.find((c) => c.key === k);
                    if (!col) return null;
                    const w = qCols.colWidths[k] || col.defaultW;
                    const isDjem = k === "djem";
                    return (
                      <HeaderCell
                        key={k}
                        col={col}
                        w={w}
                        onDragStart={() => qCols.handleDragStart(k)}
                        onDragOver={qCols.handleDragOver}
                        onDrop={() => qCols.handleDrop(k)}
                        onResizeStart={(x) => qCols.handleResizeStart(k, x)}
                        onHeaderClick={isDjem ? toggleDjemSort : undefined}
                        sortIndicator={isDjem && djemSortActive ? "desc" : null}
                      />
                    );
                  })}
                  <th className="bg-[var(--bg-card)] border-b border-[var(--border)]" />
                </tr>
              </thead>
              <tbody>
                {queryRows.map((r, i) => {
                  const fresh = freshPos.get(r.phrase);
                  const displayAdPos = fresh?.ad_pos ?? r.ad_pos;
                  const displayBoost = fresh?.boost ?? r.boost;
                  const checking = checkingPhrases.has(r.phrase);
                  // Эффективный excluded для child уже приходит с сервера: если parent-кластер
                  // в минусах, его children не должны возвращаться в «Нашу ставку» из-за старого bid.
                  const isExcluded = r.type === "excluded";
                  const isUnknown = r.type === "unknown";
                  return (
                  <tr
                    key={`q-${r.kind}-${r.phrase}-${i}`}
                    data-phrase={r.phrase.toLowerCase()}
                    onClick={() => r.kind === "kw" && r.depth === 0 && checkSinglePhrase(r.phrase)}
                    onDoubleClick={() => {
                      // Двойной клик по excluded-фразе — переход на вкладку «Исключения» с подсветкой.
                      // Не из самой вкладки «Исключения» (там она уже видна).
                      if (r.kind !== "kw" || r.type !== "excluded") return;
                      if (qTypeFilter === "excluded") return;
                      setQTypeFilter("excluded");
                      setHighlightedPhrase(r.phrase.toLowerCase());
                    }}
                    onContextMenu={(e) => {
                      if (r.kind !== "kw") return;
                      e.preventDefault();
                      setCtxMenu({ x: e.clientX, y: e.clientY, phrase: r.phrase, type: r.type });
                    }}
                    className={
                      "border-b border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--bg-card-hover)] " +
                      (r.kind === "kw" ? "cursor-pointer " : "") +
                      (checking ? "bg-[var(--accent)]/10 " : "") +
                      (isExcluded || isUnknown ? "opacity-50 " : "") +
                      (highlightedPhrase && r.phrase.toLowerCase() === highlightedPhrase ? "!bg-[var(--accent)]/30 " : "") +
                      (selectedPhrases.has(r.phrase) ? "!bg-[var(--accent)]/15 " : "")
                    }
                    title={r.kind === "kw" ? "Клик — проверить позицию и буст · 2× клик по excluded — перейти в «Исключения» · ПКМ — меню" : ""}
                  >
                    <td
                      className="w-8 text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.kind === "kw" && r.depth === 0 && (
                        <input
                          type="checkbox"
                          checked={selectedPhrases.has(r.phrase)}
                          onChange={() => togglePhraseSelection(r.phrase)}
                          className="accent-[var(--text-muted)] w-3 h-3 cursor-pointer opacity-40 hover:opacity-90 checked:opacity-100 transition-opacity"
                          title="Выбрать для массового действия"
                        />
                      )}
                    </td>
                    {qCols.colOrder.filter((k) => !qCols.hiddenCols.includes(k)).map((k) => {
                      const col = QUERY_COLS.find((c) => c.key === k);
                      if (!col) return null;
                      const w = qCols.colWidths[k] || col.defaultW;
                      const alignCls = col.align === "left" ? "text-left" : "text-right";
                      let content: ReactNode = <span className="text-[var(--text-muted)]">—</span>;
                      switch (k) {
                        case "phrase": {
                          const marker = isExcluded
                            ? <span className="mr-1 text-[var(--danger)]" title="В исключениях">⊘</span>
                            : isUnknown
                              ? <span className="mr-1 text-[var(--text-muted)]" title="Неуправляемая (<100 показов)">?</span>
                              : null;
                          const expanded = expandedParents.has(r.phrase.toLowerCase());
                          const expandToggle = r.is_parent ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleExpand(r.phrase.toLowerCase()); }}
                              className="mr-1 inline-flex items-center text-[var(--text-muted)] hover:text-[var(--text)] shrink-0"
                              title={expanded ? "Свернуть" : `Развернуть (${r.children_count})`}
                            >
                              <svg
                                className="w-3 h-3 transition-transform"
                                style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
                                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                              >
                                <polyline points="9 18 15 12 9 6" />
                              </svg>
                            </button>
                          ) : r.depth === 0 ? (
                            // Placeholder под стрелку, чтобы фразы без children выравнивались с parents.
                            <span className="mr-1 inline-block shrink-0" style={{ width: "0.75rem" }} />
                          ) : null;
                          content = (
                            <div className="flex flex-col">
                              <span
                                title={r.phrase}
                                className="flex items-center truncate"
                              >
                                {expandToggle}
                                {r.kind === "cat" && <span className="mr-1 text-[var(--text-muted)]">📁</span>}
                                {marker}
                                <span className="truncate">{r.phrase}</span>
                                {r.is_parent && r.children_count > 0 && (
                                  <span className="ml-1 text-[var(--text-muted)] text-[10px] shrink-0">({r.children_count})</span>
                                )}
                              </span>
                              {r.parent_filtered_out && r.parent_phrase && (
                                <span
                                  className="text-[10px] text-[var(--text-muted)] truncate"
                                  style={{ paddingLeft: "1.25rem" }}
                                  title={`parent-кластер: ${r.parent_phrase}${r.parent_excluded_real ? " (в исключениях)" : ""}`}
                                >
                                  ↳ из кластера {r.parent_excluded_real && <span className="text-[var(--danger)]">⊘</span>} {r.parent_phrase}
                                </span>
                              )}
                            </div>
                          );
                          break;
                        }
                        case "pos":
                          if (r.depth === 1) { content = null; break; }
                          content = checking
                            ? <svg className="w-3 h-3 animate-spin inline-block text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="10" opacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" /></svg>
                            : (displayAdPos > 0 ? String(displayAdPos) : "—");
                          break;
                        case "boost":
                          if (r.depth === 1) { content = null; break; }
                          content = checking
                            ? <span className="text-[var(--text-muted)]">…</span>
                            : (displayBoost > 0
                              ? <span className="text-[var(--success)]">+{displayBoost}</span>
                              : displayBoost < 0
                                ? <span className="text-[var(--danger)]">{displayBoost}</span>
                                : "—");
                          break;
                        case "djem": {
                          // djem_phrases приходит с сервера уже в нужной нормализации
                          // (cluster.phrasesLcSet для parent, [lc(phrase)] для orphan/child) —
                          // это критично т.к. WB Djem нормализует фразы иначе, чем cmp preset-info.
                          const phrasesForAgg: string[] = r.djem_phrases.length > 0
                            ? r.djem_phrases
                            : [r.phrase.toLowerCase()];
                          // Суммируем по дню: берём все 90 дней из djemDaily, мёржим.
                          type Agg = { freq: number; oc: number; atc: number; o: number; posW: number };
                          const perDay = new Map<string, Agg>();
                          if (djemDaily) {
                            for (const p of phrasesForAgg) {
                              const arr = djemDaily.get(p) ?? [];
                              for (const d of arr) {
                                const prev = perDay.get(d.date) ?? { freq: 0, oc: 0, atc: 0, o: 0, posW: 0 };
                                prev.freq += d.freq; prev.oc += d.oc; prev.atc += d.atc; prev.o += d.o;
                                // Взвешенная средняя позиция: sum(pos × freq), потом / sum(freq)
                                prev.posW += d.pos * d.freq;
                                perDay.set(d.date, prev);
                              }
                            }
                          }
                          const sortedDays = Array.from(perDay.entries()).sort((a, b) => b[0].localeCompare(a[0]));
                          // Значение в самой ячейке — за выбранный в левом сайдбаре период (qPeriod).
                          // Если djemDaily не загружен — fallback на 90-дневный агрегат из сервера.
                          const { startDate: selStart, endDate: selEnd } = periodToDates(qPeriod, todayStr);
                          let cellAtc = 0, cellO = 0, cellHasData = false;
                          if (djemDaily) {
                            for (const [date, v] of perDay) {
                              if (date >= selStart && date <= selEnd) {
                                cellAtc += v.atc; cellO += v.o; cellHasData = true;
                              }
                            }
                          } else {
                            cellAtc = r.djem_baskets; cellO = r.djem_orders;
                            cellHasData = r.djem_baskets > 0 || r.djem_orders > 0 || r.djem_clicks > 0;
                          }
                          if (!cellHasData) { content = "—"; break; }
                          const dayLabel = (iso: string) => {
                            const [, m, d] = iso.split("-");
                            const months = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
                            return `${Number(d)} ${months[Number(m) - 1]}`;
                          };
                          // Three-pane layout: заголовок фразы + заголовок колонок — sticky, скроллится только body.
                          // Tooltip снаружи задаёт display:flex, flexDirection:column — дочерние заполняют высоту.
                          const colClasses = [
                            "text-left",
                            "text-right", "text-right", "text-right", "text-right", "text-right",
                          ];
                          const colWidths = ["3.5rem", "2.2rem", "3.2rem", "2.6rem", "2.4rem", "2.4rem"];
                          const GridRow = ({ cells, header, footer }: { cells: React.ReactNode[]; header?: boolean; footer?: boolean }) => (
                            <div
                              className={
                                "grid w-full gap-1 px-1 " +
                                (header ? "py-1 border-b border-[var(--border)]/50 text-[var(--text-muted)]" : "") +
                                (footer ? "py-1 border-t border-[var(--border)] font-semibold text-[var(--text)]" : "")
                              }
                              style={{ gridTemplateColumns: colWidths.join(" ") }}
                            >
                              {cells.map((c, i) => (
                                <div key={i} className={colClasses[i] + (i === 0 && !header && !footer ? " text-[var(--text-muted)]" : "")}>{c}</div>
                              ))}
                            </div>
                          );
                          const tipBody = (
                            <div className="text-[10px] normal-case tracking-normal font-mono tabular-nums">
                              <div className="font-semibold text-[var(--text)] pb-1 border-b border-[var(--border)]/50">
                                {r.phrase}
                              </div>
                              {djemDaily === null ? (
                                <div className="opacity-60 py-2">Грузим историю Джема… (~5 мин при первом открытии)</div>
                              ) : sortedDays.length === 0 ? (
                                <div className="opacity-60">Данных по фразе нет</div>
                              ) : (
                                <>
                                  <GridRow
                                    header
                                    cells={["Дата", "Поз", "Запр", "Пер", <CartIcon key="c" className="w-3 h-3 inline" />, <BoxIcon key="b" className="w-3 h-3 inline" />]}
                                  />
                                  {/* maxHeight через vh — не зависит от flex-parent'ов, работает в любом контексте */}
                                  <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 200px)" }}>
                                    {sortedDays.map(([date, v]) => (
                                      <GridRow
                                        key={date}
                                        cells={[
                                          dayLabel(date),
                                          v.freq > 0 ? (v.posW / v.freq).toFixed(0) : "—",
                                          v.freq || "—",
                                          v.oc || "—",
                                          v.atc || "—",
                                          v.o || "—",
                                        ]}
                                      />
                                    ))}
                                  </div>
                                </>
                              )}
                            </div>
                          );
                          content = (
                            <Tooltip text={tipBody} maxWidth="380px" interactive placement="left-full">
                              <span className="inline-flex items-center gap-1 font-mono text-xs cursor-help">
                                <span>{cellAtc}</span>
                                <ArrowRightIcon className="w-3 h-3 text-[var(--text-muted)]" />
                                <span>{cellO}</span>
                              </span>
                            </Tooltip>
                          );
                          break;
                        }
                        case "meta":
                          content = r.preset_id
                            ? <span className="text-[var(--text-muted)] text-[10px]">{r.preset_id}</span>
                            : "—";
                          break;
                        case "meta2": {
                          if (r.real_preset_id == null) { content = "—"; break; }
                          const expected = Number(r.preset_id || 0);
                          const actual = r.real_preset_id;
                          const mismatch = expected > 0 && actual !== expected;
                          content = (
                            <span
                              className={`font-mono text-[10px] ${mismatch ? "text-[var(--warning)]" : "text-[var(--text-muted)]"}`}
                              title={mismatch
                                ? `В выдаче presetId: ${actual}, ожидался: ${expected}`
                                : `presetId из search.wb.ru: ${actual}`}
                            >
                              {actual}
                            </span>
                          );
                          break;
                        }
                        case "bid": {
                          if (r.depth === 1) { content = null; break; }
                          const bidEditable = Boolean(
                            campaign &&
                            campaign.firstNmId &&
                            r.type === "common" &&
                            campaign.bidType === "manual" &&
                            campaign.paymentType === "cpm" &&
                            [4, 9, 11].includes(campaign.status),
                          );
                          // Для Uni-кампаний (bid_type=unified) ставка на фразу не существует —
                          // WB использует единую ставку на уровне кампании. Здесь только зеркалим
                          // её read-only; редактирование — в верхней таблице (TargetCell).
                          const campaignBidRub = campaign?.bidKopecks ? campaign.bidKopecks / 100 : 0;
                          if (isUniCampaign && r.type === "common" && campaignBidRub > 0) {
                            content = (
                              <span
                                className="text-[var(--text-muted)]"
                                title="Единая ставка Uni-кампании. Меняется в верхней таблице кампаний."
                              >
                                {campaignBidRub} ₽
                              </span>
                            );
                            break;
                          }
                          // Показываем: свою ставку (accent) или min_cpm_search (muted) или просто bid
                          const displayRub = r.has_custom_bid && r.bid > 0
                            ? r.bid
                            : (r.type === "common" && r.min_cpm_search > 0 ? r.min_cpm_search : r.bid);
                          if (displayRub <= 0) { content = "—"; break; }
                          if (bidEditable) {
                            const lc = r.phrase.toLowerCase();
                            const autoRule = bidAutoRules.find((x) => x.phrase.toLowerCase() === lc);
                            const autoOn = autoRule?.enabled === 1;
                            content = (
                              <span className="inline-flex items-center justify-end gap-1">
                                <BidEditCell
                                  valueRub={displayRub}
                                  minRub={r.min_cpm_search}
                                  hasCustomBid={r.has_custom_bid}
                                  editable={true}
                                  isEditing={editingBid === lc}
                                  saving={savingBid}
                                  onStartEdit={() => setEditingBid(lc)}
                                  onCancel={() => setEditingBid(null)}
                                  onSubmit={async (rub) => {
                                    const res = await handleSetBid(r.phrase, rub);
                                    if (res.ok) setEditingBid(null);
                                    else alert(`Ошибка: ${res.error}`);
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setBidAutoPhrase(r.phrase);
                                  }}
                                  className={
                                    "inline-flex h-5 w-5 items-center justify-center rounded border text-[10px] font-semibold leading-none transition-colors " +
                                    (autoOn
                                      ? "border-[var(--success)] bg-[var(--success)]/15 text-[var(--success)]"
                                      : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]")
                                  }
                                  title={autoOn ? "Автоставка включена" : "Настроить автоставку"}
                                >
                                  A
                                </button>
                              </span>
                            );
                          } else if (r.has_custom_bid && r.bid > 0) {
                            content = <span className="text-[var(--accent)]" title="Ваша ставка">{r.bid} ₽</span>;
                          } else if (r.type === "common" && r.min_cpm_search > 0) {
                            content = <span className="text-[var(--text-muted)]" title={`Минимум по предмету (${r.min_cpm_search}₽) — ставка не задана вручную`}>{r.min_cpm_search} ₽</span>;
                          } else if (r.bid > 0) {
                            content = `${r.bid} ₽`;
                          } else {
                            content = "—";
                          }
                          break;
                        }
                        case "avg_pos":
                          if (r.depth === 1) { content = null; break; }
                          content = r.avg_pos > 0 ? r.avg_pos.toFixed(1) : "—";
                          break;
                        case "cpm":
                          content = r.cpm > 0 ? `${Math.round(r.cpm)} ₽` : "—";
                          break;
                        case "approx_views":
                          if (r.approx_views_wb > 0) {
                            const inner = r.cluster_inner;
                            const tipLines = inner.length > 0
                              ? [
                                  `Кластер: ${inner.length} фраз`,
                                  "",
                                  ...inner.slice(0, 12).map((i) => `${fmtNum(i.frequency).padStart(7, " ")} · ${i.phrase}`),
                                  ...(inner.length > 12 ? [`… ещё ${inner.length - 12}`] : []),
                                ].join("\n")
                              : "";
                            content = tipLines
                              ? <Tooltip text={tipLines}><span className="cursor-help">{fmtNum(r.approx_views_wb)}</span></Tooltip>
                              : fmtNum(r.approx_views_wb);
                          } else {
                            content = "—";
                          }
                          break;
                        case "atbs":
                          content = r.baskets > 0 ? fmtNum(r.baskets) : "—";
                          break;
                        case "orders":
                          content = r.orders > 0 ? fmtNum(r.orders) : "—";
                          break;
                        case "atbs_xP":
                          content = r.baskets > 0 && r.spend > 0 ? `${Math.round(r.spend / r.baskets)} ₽` : "—";
                          break;
                        case "order_xP":
                          content = r.orders > 0 && r.spend > 0 ? `${Math.round(r.spend / r.orders)} ₽` : "—";
                          break;
                        case "share":
                          if (r.views > 0 && r.approx_views_wb > 0) {
                            const boughtShare = (r.views / r.approx_views_wb) * 100;
                            content = boughtShare >= 1 ? `${Math.round(boughtShare)} %` : "<1 %";
                          } else {
                            content = "—";
                          }
                          break;
                        case "views":
                          content = r.views > 0 ? fmtNum(r.views) : "—";
                          break;
                        case "ctr":
                          content = r.ctr > 0 ? `${r.ctr.toFixed(1)}` : "—";
                          break;
                        case "clicks":
                          content = r.clicks > 0 ? fmtNum(r.clicks) : "—";
                          break;
                        case "cpc":
                          content = r.cpc > 0 ? `${r.cpc.toFixed(1)} ₽` : "—";
                          break;
                        case "spend":
                          content = r.spend > 0 ? fmtRub(r.spend) : "—";
                          break;
                      }
                      return (
                        <td
                          key={k}
                          className={`py-1 px-2 whitespace-nowrap font-mono overflow-hidden ${alignCls}`}
                          style={{
                            width: w, minWidth: 30, maxWidth: 400,
                            ...(k === "phrase" && r.depth === 1 ? { paddingLeft: "2.5rem" } : {}),
                          }}
                        >
                          {content}
                        </td>
                      );
                    })}
                    <td className="bg-[var(--bg-card)]" />
                  </tr>
                  );
                })}
                {queryRows.length === 0 && (
                  <tr>
                    <td colSpan={qCols.colOrder.filter((k) => !qCols.hiddenCols.includes(k)).length + 2} className="py-8 text-center text-[var(--text-muted)]">
                      {qLoading ? "Загрузка..." : "Нет данных за период"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
              </div>
            </div>
          ) : tab === "daily" && !dayCols.ready ? (
            <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">Загрузка...</div>
          ) : tab === "daily" ? (
            <div className="flex-1 overflow-auto">
              <DaysSummary today={todayRow} />
              <table className="w-full border-collapse text-xs" style={{ tableLayout: "fixed" }}>
                <thead className="sticky top-0 z-10">
                  <tr>
                    {dayCols.colOrder.filter((k) => !dayCols.hiddenCols.includes(k)).map((k) => {
                      const col = dayColMap.get(k);
                      if (!col) return null;
                      const w = dayCols.colWidths[k] || col.defaultW;
                      return (
                        <HeaderCell
                          key={k}
                          col={col}
                          w={w}
                          onDragStart={() => dayCols.handleDragStart(k)}
                          onDragOver={dayCols.handleDragOver}
                          onDrop={() => dayCols.handleDrop(k)}
                          onResizeStart={(x) => dayCols.handleResizeStart(k, x)}
                        />
                      );
                    })}
                    <th className="bg-[var(--bg-card)] border-b border-[var(--border)]" />
                  </tr>
                </thead>
                <tbody>
                  {daysData.map((row) => {
                    const isToday = row.date === todayStr;
                    const dow = new Date(row.date + "T12:00:00").getDay();
                    const isSaturday = dow === 6;
                    const isSunday = dow === 0;
                    const isWeekend = isSaturday || isSunday;
                    const isEmpty = row.views_total === 0 && row.spend === 0 && row.clicks_total === 0;
                    const isSelected = selectedDate === row.date;
                    return (
                      <tr
                        key={row.date}
                        onClick={() => setSelectedDate(isSelected ? null : row.date)}
                        className={
                          "border-b border-[var(--border)] cursor-pointer transition-colors " +
                          (isSelected
                            ? "bg-[var(--accent)]/25 "
                            : "bg-[var(--bg)] hover:bg-[var(--bg-card-hover)] ") +
                          (isEmpty && !isSelected && !isToday ? "opacity-40" : "")
                        }
                        style={isWeekend ? { borderLeft: "2px solid rgba(251, 191, 36, 0.5)" } : undefined}
                      >
                        {dayCols.colOrder.filter((k) => !dayCols.hiddenCols.includes(k)).map((k) => {
                          const col = dayColMap.get(k);
                          if (!col) return null;
                          const w = dayCols.colWidths[k] || col.defaultW;
                          return (
                            <td
                              key={k}
                              className={
                                "py-1 px-2 whitespace-nowrap font-mono " +
                                // Ячейкам с тултипом ассоциированных конверсий НЕ ставим overflow-hidden,
                                // иначе тултип обрезается границами td.
                                (k === "atbs" || k === "orders" ? "" : "overflow-hidden ") +
                                (col.align === "left" ? "text-left" : "text-right") +
                                (isToday && k === "date" ? " font-semibold text-[var(--accent)]" : "")
                              }
                              style={{
                                width: w, minWidth: 30, maxWidth: 400,
                                ...(k === "drr" ? { color: fmtDrr(row.spend, row.sum_price).color } : {}),
                                ...((isSaturday || isSunday) && k === "date" && !isToday ? { color: "rgba(251, 191, 36, 0.8)" } : {}),
                              }}
                            >
                              {k === "date" && isToday ? "Сегодня" : (k === "date" ? formatDate(row.date) : dayCellValue(row, k))}
                            </td>
                          );
                        })}
                        <td className="bg-[var(--bg-card)]" />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
      {ctxMenu && (() => {
        // Логика активности пунктов меню — по текущему фильтру вкладки, а не по типу фразы.
        //   - Исключения (qTypeFilter === "excluded"): активна «Вернуть», «Исключить» — серая
        //   - Все остальные (our_bid/managed/active/all/deferred): активна «Исключить»
        const onExcludedTab = qTypeFilter === "excluded";
        const items: ContextMenuItem[] = [
          {
            key: "exclude",
            label: "Исключить запрос",
            disabled: onExcludedTab,
            danger: true,
            title: onExcludedTab ? "Вы на вкладке «Исключения» — фраза уже в минусах" : undefined,
            icon: (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
            ),
            onClick: () => handlePresetMinus(ctxMenu.phrase, true),
          },
          {
            key: "restore",
            label: "Вернуть из исключений",
            disabled: !onExcludedTab,
            title: !onExcludedTab ? "Перейдите на вкладку «Исключения», чтобы вернуть фразу" : undefined,
            icon: (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9" />
                <polyline points="3 4 3 10 9 10" />
              </svg>
            ),
            onClick: () => handlePresetMinus(ctxMenu.phrase, false),
          },
        ];
        return <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={items} onClose={() => setCtxMenu(null)} />;
      })()}
      {logsOpen && campaign && (
        <PositionSyncLogsModal advertId={campaign.advertId} onClose={() => setLogsOpen(false)} />
      )}
      {clustersOpen && (
        <ManualClustersModal
          onClose={() => setClustersOpen(false)}
          onChanged={() => setQRefreshTick((x) => x + 1)}
        />
      )}
    </div>
  );
}
