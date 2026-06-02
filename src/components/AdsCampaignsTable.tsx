"use client";

import { useEffect, useMemo, useState, useRef, useCallback, Fragment, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { AdsCampaign } from "@/app/api/ads/route";
import { PERIOD_OPTIONS } from "@/types";
import { fmtNum, fmtRub } from "@/lib/format";
import { roundedZonePercents } from "@/lib/zone-percent";
import { EyeIcon, ClickIcon, PlayIcon, PauseIcon, CartIcon, BoxIcon, CheckCircleIcon } from "./icons";
import ProductThumb from "./ProductThumb";
import Tooltip from "./Tooltip";
import AdCampaignDetailPanel from "./AdCampaignDetailPanel";
import SplitPane from "./SplitPane";
import BidEditCell from "./BidEditCell";
import BudgetDepositModal from "./BudgetDepositModal";

interface AdsApiResponse {
  ok: boolean;
  period: { startDate: string; endDate: string; days: number; offset: number };
  totals: { spendTodayTotal: number; paidToday: number; balance: number };
  campaigns: AdsCampaign[];
}

type StatusFilter = "active" | "paused" | "all";
type TypeFilter = "all" | "uni" | "search" | "catalog" | "manual" | "cpc";
type SortState = { column: string; dir: "asc" | "desc" | null };

interface AdsCol {
  key: string;
  label: ReactNode;
  tooltip: string;
  sortable: boolean;
  sticky?: boolean;
  defaultW: number;
  align?: "left" | "right" | "center";
}

const COLUMNS: AdsCol[] = [
  { key: "product", label: "Товар", tooltip: "Фото, название кампании, артикул первого товара,\nпредмет, статус и время последнего изменения\n\nКлик по заголовку — сортировка по названию", sortable: true, sticky: true, defaultW: 320 },
  { key: "campaign", label: "Камп.", tooltip: "Тип рекламной кампании\nID кампании\nПризнак доступности кампании по API\n\nКлик по заголовку столбца — вкл/выкл сортировка по ID\n(или по новизне — чем больше ID, тем более новая кампания)", sortable: true, defaultW: 110 },
  { key: "zones", label: "Зоны", tooltip: "Доли показов по зонам, %\n🔍 — Поиск по Запросам\n✦ — Рекомендации\n📁 — по Каталогам\n\nРасчёт процентов зон идёт относительно показов всей РК\nи может отставать из-за лимитов запросов WB.\n\nбелым — зона показа Активна для Аукц.(ручн.ставка)", sortable: false, defaultW: 110 },
  { key: "target", label: "Ставка / Бюджет", tooltip: "Текущая ставка (₽)\nОстаток бюджета (₽)\nВремя последнего изменения ставки и бюджета", sortable: false, defaultW: 220 },
  { key: "views", label: "Показы", tooltip: "Кол-во рекламных показов за выбранный период\nCPM = затраты / показы × 1000 (стоимость 1000 показов)", sortable: true, defaultW: 90, align: "center" },
  { key: "clicks", label: "Клики", tooltip: "Кол-во рекламных кликов за выбранный период\nCTR = клики / показы × 100%\nCPC = затраты / клики (цена клика, ₽)", sortable: true, defaultW: 115, align: "center" },
  { key: "orders", label: "Заказы", tooltip: "Кол-во рекламных заказов за выбранный период\nCR = заказы / клики × 100% (конверсия клик → заказ)\nCPO = затраты / заказы (цена заказа, ₽)", sortable: true, defaultW: 115, align: "center" },
  { key: "funnel", label: "Воронка", tooltip: "Корзины: % конверсия клик → корзина, кол-во корзин\nЗаказы: % конверсия корзина → заказ, кол-во заказов", sortable: true, defaultW: 140, align: "center" },
  { key: "costShare", label: "Доля затрат", tooltip: "Доля рекламных затрат = расход / сумма заказов × 100%\nЗаказы — выручка с рекламных заказов (₽)\nРасход — затраты на рекламу (₽)", sortable: true, defaultW: 150, align: "center" },
  { key: "ctr", label: "CTR", tooltip: "CTR рекламы = клики / показы × 100%\nПоказы и клики за выбранный период", sortable: true, defaultW: 110, align: "right" },
  { key: "spend", label: "Затраты", tooltip: "Р/клик — средняя цена рекламного клика\nΣ — сумма затрат на рекламу за период", sortable: true, defaultW: 100, align: "right" },
  { key: "day", label: "День", tooltip: "Расход на рекламу сегодня и вчера", sortable: false, defaultW: 100, align: "right" },
  { key: "conversion", label: "Конверсии", tooltip: "🛒 Клик → Корзина (atbs/clicks)\n✓ Корзина → Заказ (orders/atbs)\n📦 Клик → Заказ (orders/clicks)", sortable: true, defaultW: 105, align: "right" },
  { key: "cartOrder", label: "Корз. / Заказы", tooltip: "🛒 Кол-во корзин с рекламы × рекл. себестоимость корзины (spend/atbs)\n📦 Кол-во заказов × рекл. себестоимость заказа (spend/orders)", sortable: true, defaultW: 135, align: "right" },
  { key: "drr", label: "ДРРк / Выручка", tooltip: "Доля рекламных расходов по заказам с этой кампании\n(в т.ч. ассоциированные заказы)\nДРРк = затраты / выручка × 100%\n## — расход есть, но заказов нет\n\nКол-во заказов × Средняя цена поставки\nВыручка с 'рекламных' заказов по факт. ценам поставки\n\nКлик по заголовку — вкл/выкл сортировка по ДРР", sortable: true, defaultW: 140, align: "right" },
  { key: "account", label: "Счет / Опл.", tooltip: "всего — начислено WB за рекламу за период (из fullstats; то, что должны)\nоплачено — фактически списано со счёта за период (из /adv/v1/upd)\nЦифры могут отличаться при автопополнении или смешивании с бонусами", sortable: false, defaultW: 110, align: "right" },
];

// --- Helpers ---
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const months = ["янв", "февр", "мар", "апр", "мая", "июн", "июл", "авг", "сент", "окт", "нояб", "дек"];
  const y = String(d.getFullYear()).slice(2);
  return `${d.getDate()} ${months[d.getMonth()]}. ${y}г.`;
}

function fmtChangeTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (sameDay(d, today)) return `сегодня ${hm}`;
  if (sameDay(d, yest)) return `вчера ${hm}`;
  return fmtDate(iso);
}

function parseDbDateTime(value: string | null): Date | null {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const withIsoSeparator = trimmed.replace(" ", "T");
  const withTimezone = /[+-]\d{2}$/i.test(withIsoSeparator)
    ? `${withIsoSeparator}:00`
    : withIsoSeparator.replace(/([+-]\d{2})(\d{2})$/i, "$1:$2");
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(withTimezone)
    ? withTimezone
    : `${withTimezone}Z`;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}


function statusLabel(s: number): { text: string; color: string } {
  if (s === 4) return { text: "готова", color: "var(--accent)" };
  if (s === 9) return { text: "активна", color: "var(--success)" };
  if (s === 11) return { text: "пауза", color: "var(--warning)" };
  if (s === 7) return { text: "архив", color: "var(--text-muted)" };
  return { text: String(s), color: "var(--text-muted)" };
}

function campaignTypeLabel(c: AdsCampaign): { short: string; full: string; icon: string } {
  if (c.paymentType === "cpc") return { short: "CPC", full: "Аукцион CPC (оплата за клик)", icon: "cpc" };
  if (c.bidType === "manual") return { short: "Аук.", full: "Аукцион (ручная ставка)", icon: "hand" };
  const p = c.placements;
  if (p?.search && p?.recommendations) return { short: "Uni", full: "Объединённый аукцион", icon: "uni" };
  if (p?.search) return { short: "Q", full: "Аукцион Поиск", icon: "search" };
  if (p?.recommendations) return { short: "Рек", full: "Аукцион Рекомендации", icon: "reco" };
  return { short: "?", full: "Тип неизвестен", icon: "unk" };
}

function matchType(c: AdsCampaign, filter: TypeFilter): boolean {
  if (filter === "all") return true;
  const t = campaignTypeLabel(c).icon;
  if (filter === "uni") return t === "uni";
  if (filter === "search") return t === "search";
  if (filter === "catalog") return t === "reco" || t === "catalog";
  if (filter === "manual") return t === "hand";
  if (filter === "cpc") return t === "cpc";
  return true;
}

function matchStatus(c: AdsCampaign, filter: StatusFilter): boolean {
  // Архивные (status=7) не отображаются в таблице вообще — считаем, что ими управлять нельзя.
  if (c.status === 7) return false;
  if (filter === "active") return c.status === 9;
  if (filter === "paused") return c.status === 11;
  if (filter === "all") return c.status === 4 || c.status === 9 || c.status === 11;
  return true;
}

// --- Settings persistence ---
async function saveSetting(key: string, value: string) {
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [key]: value }),
  });
}
async function loadAdsColWidths(): Promise<Record<string, number>> {
  try {
    const res = await fetch("/api/settings");
    const raw = await res.json();
    return raw.ads_col_widths ? JSON.parse(raw.ads_col_widths) : {};
  } catch { return {}; }
}
async function loadAdsColOrder(): Promise<string[] | null> {
  try {
    const res = await fetch("/api/settings");
    const raw = await res.json();
    const order = raw.ads_col_order ? JSON.parse(raw.ads_col_order) : null;
    return Array.isArray(order) && order.length > 0 ? order : null;
  } catch { return null; }
}

// --- Cells (styled to match Cards visual) ---
function SortArrow({ dir }: { dir: "asc" | "desc" | null }) {
  if (!dir) return null;
  return <span className="ml-1 text-[var(--accent)]">{dir === "desc" ? "↓" : "↑"}</span>;
}

function ProductAdsCell({ c }: { c: AdsCampaign }) {
  return (
    <div className="flex items-center gap-2 min-w-[300px] max-w-[340px]">
      {c.firstNmId ? <ProductThumb nmId={c.firstNmId} version={c.firstProductUpdatedAt} /> : <div className="w-11 h-14 rounded bg-[var(--border)] flex-shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm leading-tight text-[var(--text)]">{c.name || `Кампания ${c.advertId}`}</div>
        <div className="text-xs text-[var(--text-muted)] truncate">
          <span className="font-mono">{c.firstNmId ?? "—"}</span>
          {c.subject && <span className="ml-2">{c.subject}</span>}
        </div>
        <div className="text-xs text-[var(--text-muted)]" style={{ marginTop: 2 }}>
          создана {fmtDate(c.startTime)}
        </div>
      </div>
    </div>
  );
}

function CampaignStatusControl({ c, saving, onChange }: { c: AdsCampaign; saving: boolean; onChange: (event: ReactMouseEvent<HTMLButtonElement>) => void }) {
  const canStart = c.status === 4 || c.status === 11;
  const canPause = c.status === 9;
  const clickable = canStart || canPause;
  const st = statusLabel(c.status);
  const Icon = c.status === 11 ? PauseIcon : PlayIcon;
  const title = canPause
    ? "Сейчас активна. Нажмите, чтобы приостановить."
    : canStart
      ? "Сейчас не запущена. Нажмите, чтобы запустить."
      : st.text;

  return (
    <button
      type="button"
      disabled={!clickable || saving}
      onClick={(e) => {
        e.stopPropagation();
        if (clickable) onChange(e);
      }}
      className={
        "mt-1 inline-flex min-w-[76px] items-center justify-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold transition-all disabled:cursor-default disabled:opacity-80 " +
        (clickable
          ? "border-white/10 cursor-pointer hover:border-current hover:bg-white/15 hover:shadow-[0_0_0_2px_rgba(255,255,255,0.08)] hover:brightness-125 active:scale-[0.98]"
          : "border-transparent")
      }
      style={{
        color: st.color,
        background: clickable ? "color-mix(in srgb, currentColor 10%, transparent)" : "transparent",
      }}
      title={title}
      aria-label={title}
    >
      <Icon className="w-3 h-3" />
      <span>{saving ? "..." : st.text}</span>
    </button>
  );
}

function CampaignCell({ c, statusSaving, onStatusChange }: { c: AdsCampaign; statusSaving: boolean; onStatusChange: (event: ReactMouseEvent<HTMLButtonElement>) => void }) {
  const t = campaignTypeLabel(c);
  return (
    <div className="text-sm">
      <div className="text-[var(--accent)] text-xs font-mono">{t.short}</div>
      <div className="font-mono text-[var(--text)]">{c.advertId}</div>
      <CampaignStatusControl c={c} saving={statusSaving} onChange={onStatusChange} />
      <div className="text-xs text-[var(--text-muted)]">{fmtChangeTime(c.changeTime)}</div>
    </div>
  );
}

// Real zone shares from cmp.wildberries.ru (campaign_zones_daily).
// Green when the zone is active in settings.placements.
function ZoneCell({ c }: { c: AdsCampaign }) {
  const parts = [
    { label: "Поиск", active: c.zoneSearchActive, share: c.zoneSearchShare },
    { label: "Каталог", active: c.zoneCatalogActive, share: c.zoneCatalogShare },
    { label: "Полки", active: c.zoneRecoActive, share: c.zoneRecoShare },
  ];
  const rounded = roundedZonePercents(parts.map((p) => p.share));
  // Показываем ВСЕ три строки всегда: Поиск / Каталог / Полки.
  // Если нет данных и зона не активна — ставим «—» вместо процента.
  return (
    <div className="text-xs" style={{ display: "grid", gridTemplateColumns: "auto auto", columnGap: 4, rowGap: 2, width: "fit-content" }}>
      {parts.map((p, idx) => {
        const color = p.active ? "var(--text)" : "var(--text-muted)";
        const pct = rounded[idx] > 0 ? `${rounded[idx]} %` : "—";
        return (
          <Fragment key={p.label}>
            <span style={{ color, textAlign: "right", whiteSpace: "nowrap" }} className="font-semibold">{pct}</span>
            <span className="text-[var(--text-muted)]" style={{ textAlign: "left", whiteSpace: "nowrap" }}>{p.label}</span>
          </Fragment>
        );
      })}
    </div>
  );
}

// Тултип: история успешных смен единой ставки Uni-кампании.
function BidHistoryTooltip({ history }: { history: { at: string; rub: number }[] }) {
  if (!history || history.length === 0) {
    return <span>нет истории изменений</span>;
  }
  const months = ["янв", "февр", "мар", "апр", "мая", "июн", "июл", "авг", "сент", "окт", "нояб", "дек"];
  const fmtAt = (at: string) => {
    const d = parseDbDateTime(at);
    if (!d) return at || "—";
    return `${d.getDate()} ${months[d.getMonth()]} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  return (
    <div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>История изменений ставки</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto auto", columnGap: 12, rowGap: 3, fontSize: 12 }}>
        {history.map((h, i) => (
          <Fragment key={i}>
            <span style={{ whiteSpace: "nowrap" }}>{fmtAt(h.at)}</span>
            <span style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>{fmtRub(h.rub)}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// Тултип: история успешных пополнений бюджета. Источник — bid_changes_log.
function DepositHistoryTooltip({ history }: { history: { at: string; sum: number; type: number }[] }) {
  if (!history || history.length === 0) {
    return <span>нет истории пополнений</span>;
  }
  const SOURCE: Record<number, string> = { 0: "Счёт", 1: "Баланс", 3: "Бонусы" };
  const months = ["янв", "февр", "мар", "апр", "мая", "июн", "июл", "авг", "сент", "окт", "нояб", "дек"];
  const fmtAt = (at: string) => {
    const d = parseDbDateTime(at);
    if (!d) return at || "—";
    const day = d.getDate();
    const m = months[d.getMonth()];
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${day} ${m} ${hh}:${mm}`;
  };
  return (
    <div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>История пополнений</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto auto auto", columnGap: 12, rowGap: 3, fontSize: 12 }}>
        {history.map((h, i) => (
          <Fragment key={i}>
            <span style={{ whiteSpace: "nowrap" }}>{fmtAt(h.at)}</span>
            <span style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>{fmtRub(h.sum)}</span>
            <span style={{ opacity: 0.7, whiteSpace: "nowrap" }}>{SOURCE[h.type] ?? `?${h.type}`}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

interface TargetCellProps {
  c: AdsCampaign;
  isEditing: boolean;
  saving: boolean;
  pendingRub: number | null;
  onStartEdit: () => void;
  onCancel: () => void;
  onSubmit: (rub: number) => void;
  onBudgetClick: () => void;
}

function TargetCell({ c, isEditing, saving, pendingRub, onStartEdit, onCancel, onSubmit, onBudgetClick }: TargetCellProps) {
  const bidRub = pendingRub ?? (c.bidKopecks ? c.bidKopecks / 100 : 0);
  // Uni-кампания — единая ставка на всю РК, редактируется здесь.
  const isUni = c.bidType !== "manual" && !!c.placements?.search && !!c.placements?.recommendations;
  const isCpc = c.paymentType === "cpc";
  const editable = ((isUni && c.paymentType === "cpm") || isCpc) && [4, 9, 11].includes(c.status);
  const tip = editable
    ? isCpc
      ? "Ставка CPC-кампании (" + bidRub + "₽ за клик). Клик — изменить."
      : "Единая ставка Uni-кампании (" + bidRub + "₽). Клик — изменить. Меняется на всю кампанию сразу" + (c.minCpmUnified > 0 ? ". Минимум по предмету: " + c.minCpmUnified + "₽" : "")
    : c.bidType === "manual"
      ? "Ставка " + bidRub + "₽. У ручного CPM-аукциона ставки меняются в запросах кампании."
      : "Ставка " + bidRub + "₽. Быстрое редактирование доступно только для Uni-кампаний CPM.";
  return (
    <div
      className="text-sm"
      style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 16, alignItems: "start", textAlign: "center" }}
    >
      <div>
        <div>
          <Tooltip text={<BidHistoryTooltip history={c.bidHistory} />} maxWidth="280px" placement="left">
            <span
              style={{ display: "inline-block", color: "var(--accent)" }}
            >
              {editable ? (
                <BidEditCell
                  valueRub={bidRub}
                  minRub={isCpc ? 0 : c.minCpmUnified}
                  hasCustomBid={false}
                  editable={true}
                  isEditing={isEditing}
                  saving={saving}
                  onStartEdit={onStartEdit}
                  onCancel={onCancel}
                  onSubmit={onSubmit}
                  tooltipOverride={tip}
                  displayClassName="text-[var(--accent)] font-semibold"
                  displayMode="pill"
                />
              ) : (
                <span
                  className="inline-flex min-w-[76px] items-center justify-center rounded-md border border-dashed border-white/10 px-2 py-0.5 text-sm font-semibold text-[var(--text-muted)] transition-colors hover:border-white/20"
                  title={tip}
                >
                  {fmtRub(bidRub)}
                </span>
              )}
            </span>
          </Tooltip>
        </div>
        <div className="text-xs text-[var(--text-muted)]" style={{ marginTop: 2 }}>ставка</div>
      </div>
      <div>
        <Tooltip text={<DepositHistoryTooltip history={c.depositHistory} />} maxWidth="320px" placement="left">
          <button
            onClick={(e) => { e.stopPropagation(); onBudgetClick(); }}
            className="inline-flex min-w-[76px] items-center justify-center rounded-md border border-white/10 px-2 py-0.5 text-sm font-semibold text-[var(--accent)] transition-all cursor-pointer hover:border-current hover:bg-white/15 hover:shadow-[0_0_0_2px_rgba(255,255,255,0.08)] hover:brightness-125 active:scale-[0.98]"
          >
            {fmtRub(c.budgetTotal)}
          </button>
        </Tooltip>
        <div className="text-xs text-[var(--text-muted)]" style={{ marginTop: 2 }}>бюджет</div>
      </div>
    </div>
  );
}

function ViewsCell({ c }: { c: AdsCampaign }) {
  const cpm = c.views > 0 ? (c.spend / c.views) * 1000 : 0;
  return (
    <div className="text-sm text-center whitespace-nowrap">
      <div>{c.views > 0 ? fmtNum(c.views) : "—"}</div>
      <div className="flex justify-center text-xs text-[var(--text-muted)] mt-0.5">
        <div className="text-center">
          <div>CPM</div>
          <div>{cpm > 0 ? fmtRub(Math.round(cpm)) : "—"}</div>
        </div>
      </div>
    </div>
  );
}

function ClicksCell({ c }: { c: AdsCampaign }) {
  return (
    <div className="text-sm text-center whitespace-nowrap">
      <div>{c.clicks > 0 ? fmtNum(c.clicks) : "—"}</div>
      <div className="flex justify-center gap-3 text-xs text-[var(--text-muted)] mt-0.5">
        <div className="text-center">
          <div>CTR</div>
          <div>{c.ctr > 0 ? `${c.ctr.toFixed(1)} %` : "—"}</div>
        </div>
        <div className="text-center">
          <div>CPC</div>
          <div>{c.cpc > 0 ? c.cpc.toFixed(1) : "—"}</div>
        </div>
      </div>
    </div>
  );
}

function OrdersAdsCell({ c }: { c: AdsCampaign }) {
  const cr = c.clicks > 0 ? (c.orders / c.clicks) * 100 : 0;
  const cpo = c.orders > 0 ? c.spend / c.orders : 0;
  return (
    <div className="text-sm text-center whitespace-nowrap">
      <div>{c.orders > 0 ? fmtNum(c.orders) : "—"}</div>
      <div className="flex justify-center gap-3 text-xs text-[var(--text-muted)] mt-0.5">
        <div className="text-center">
          <div>CR</div>
          <div>{cr > 0 ? `${cr.toFixed(1)} %` : "—"}</div>
        </div>
        <div className="text-center">
          <div>CPO</div>
          <div>{cpo > 0 ? fmtRub(Math.round(cpo)) : "—"}</div>
        </div>
      </div>
    </div>
  );
}

function CostShareCell({ c }: { c: AdsCampaign }) {
  const drrTxt = c.sumPrice > 0 ? `${c.drr.toFixed(1)} %` : (c.spend > 0 ? "## %" : "—");
  const drrColor = c.sumPrice > 0 && c.drr <= 10 ? "var(--success)" : c.drr <= 15 ? "var(--warning)" : "var(--danger)";
  return (
    <div className="text-sm text-center whitespace-nowrap">
      <div style={{ color: c.sumPrice > 0 ? drrColor : "var(--text-muted)" }}>{drrTxt}</div>
      <div className="flex justify-center gap-3 text-xs text-[var(--text-muted)] mt-0.5">
        <div className="text-center">
          <div>Заказы</div>
          <div>{c.sumPrice > 0 ? fmtRub(c.sumPrice) : "—"}</div>
        </div>
        <div className="text-center">
          <div>Расход</div>
          <div>{c.spend > 0 ? fmtRub(c.spend) : "—"}</div>
        </div>
      </div>
    </div>
  );
}

function FunnelCell({ c }: { c: AdsCampaign }) {
  const cartConv = c.clicks > 0 ? (c.atbs / c.clicks) * 100 : 0;
  const orderConv = c.atbs > 0 ? (c.orders / c.atbs) * 100 : 0;
  return (
    <div className="text-sm text-center whitespace-nowrap">
      <div className="flex justify-center gap-3">
        <div className="text-center">
          <div>{c.atbs > 0 ? fmtNum(c.atbs) : "—"}</div>
          <div className="text-xs text-[var(--text-muted)] mt-0.5">Корзины</div>
          <div className="text-xs text-[var(--text-muted)]">{cartConv > 0 ? `${cartConv.toFixed(1)} %` : "—"}</div>
        </div>
        <div className="text-center">
          <div>{c.orders > 0 ? fmtNum(c.orders) : "—"}</div>
          <div className="text-xs text-[var(--text-muted)] mt-0.5">Заказы</div>
          <div className="text-xs text-[var(--text-muted)]">{orderConv > 0 ? `${orderConv.toFixed(1)} %` : "—"}</div>
        </div>
      </div>
    </div>
  );
}

function CtrCell({ c }: { c: AdsCampaign }) {
  return (
    <div className="text-sm text-right whitespace-nowrap">
      <div className="text-[var(--success)] font-semibold">{c.ctr > 0 ? `${c.ctr.toFixed(1)} %` : "—"}</div>
      <div className="flex items-center justify-end gap-1 text-xs text-[var(--text-muted)]">
        <EyeIcon className="w-3.5 h-3.5" /> {fmtNum(c.views)}
      </div>
      <div className="flex items-center justify-end gap-1 text-xs text-[var(--text-muted)]">
        <ClickIcon className="w-3.5 h-3.5" /> {fmtNum(c.clicks)}
      </div>
    </div>
  );
}

function SpendCell({ c }: { c: AdsCampaign }) {
  return (
    <div className="text-sm text-right whitespace-nowrap">
      <div className="text-xs text-[var(--text-muted)]">Р/клик</div>
      <div>{c.cpc > 0 ? c.cpc.toFixed(1) : "—"}</div>
      <div className="text-xs text-[var(--text-muted)]">Σ</div>
      <div>{c.spend > 0 ? fmtRub(c.spend) : "—"}</div>
    </div>
  );
}

function DayCell({ c }: { c: AdsCampaign }) {
  return (
    <div className="text-sm text-right whitespace-nowrap">
      <div className="text-xs text-[var(--text-muted)]">сегодня</div>
      <div>{fmtRub(c.spendToday)}</div>
      <div className="text-xs text-[var(--text-muted)] mt-1">вчера</div>
      <div>{fmtRub(c.spendYesterday)}</div>
    </div>
  );
}

function ConversionCell({ c }: { c: AdsCampaign }) {
  const clickToCart = c.clicks > 0 ? (c.atbs / c.clicks) * 100 : 0;
  const cartToOrder = c.atbs > 0 ? (c.orders / c.atbs) * 100 : 0;
  const clickToOrder = c.cr;
  const row = (icon: React.ReactNode, pct: number) => (
    <div className="flex items-center justify-end gap-1 whitespace-nowrap">
      {icon}
      <span>{pct > 0 ? `${pct.toFixed(1)} %` : "—"}</span>
    </div>
  );
  return (
    <div className="text-sm flex flex-col items-end gap-0.5">
      {row(<CartIcon className="w-3.5 h-3.5 text-[var(--text-muted)]" />, clickToCart)}
      {row(<CheckCircleIcon className="w-3.5 h-3.5 text-[var(--text-muted)]" />, cartToOrder)}
      {row(<BoxIcon className="w-3.5 h-3.5 text-[var(--text-muted)]" />, clickToOrder)}
    </div>
  );
}

function CartOrderCell({ c }: { c: AdsCampaign }) {
  const cartCost = c.atbs > 0 ? c.spend / c.atbs : 0;
  const orderCost = c.orders > 0 ? c.spend / c.orders : 0;
  const row = (count: number, icon: React.ReactNode, cost: number) => (
    <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
      <span>{count > 0 ? fmtNum(count) : "—"}</span>
      {icon}
      <span className="text-[var(--text-muted)]">× {cost > 0 ? fmtRub(Math.round(cost)) : "—"}</span>
    </div>
  );
  return (
    <div className="text-sm flex flex-col items-end gap-0.5">
      {row(c.atbs, <CartIcon className="w-3.5 h-3.5 text-[var(--text-muted)]" />, cartCost)}
      {row(c.orders, <BoxIcon className="w-3.5 h-3.5 text-[var(--text-muted)]" />, orderCost)}
    </div>
  );
}

function DrrRevCell({ c }: { c: AdsCampaign }) {
  const drrTxt = c.sumPrice > 0 ? `${c.drr.toFixed(1)} %` : (c.spend > 0 ? "## %" : "—");
  const drrColor = c.sumPrice > 0 && c.drr <= 10 ? "var(--success)" : c.drr <= 15 ? "var(--warning)" : "var(--danger)";
  const avgPrice = c.orders > 0 ? c.sumPrice / c.orders : 0;
  return (
    <div className="text-sm text-right whitespace-nowrap">
      <div style={{ color: drrColor }} className="font-semibold">{drrTxt}</div>
      <div>{c.orders > 0 ? `${fmtNum(c.orders)} × ${fmtRub(Math.round(avgPrice))}` : "—"}</div>
      <div className="text-xs text-[var(--text-muted)]">{c.sumPrice > 0 ? fmtRub(c.sumPrice) : "—"}</div>
    </div>
  );
}

function AccountCell({ c }: { c: AdsCampaign }) {
  return (
    <div className="text-sm text-right whitespace-nowrap">
      <div className="text-xs text-[var(--text-muted)]">всего</div>
      <div>{c.spend > 0 ? fmtRub(c.spend) : "—"}</div>
      <div className="text-xs text-[var(--text-muted)] mt-0.5">оплачено</div>
      <div>{c.paidPeriod > 0 ? fmtRub(c.paidPeriod) : "—"}</div>
    </div>
  );
}

interface CellContext {
  bidEditing: boolean;
  bidSaving: boolean;
  pendingBidRub: number | null;
  onBidStartEdit: () => void;
  onBidCancel: () => void;
  onBidSubmit: (rub: number) => void;
  onBudgetClick: () => void;
  statusSaving: boolean;
  onStatusChange: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

function getCellContent(key: string, c: AdsCampaign, ctx: CellContext): ReactNode {
  switch (key) {
    case "product": return <ProductAdsCell c={c} />;
    case "campaign": return <CampaignCell c={c} statusSaving={ctx.statusSaving} onStatusChange={ctx.onStatusChange} />;
    case "zones": return <ZoneCell c={c} />;
    case "target": return (
      <TargetCell
        c={c}
        isEditing={ctx.bidEditing}
        saving={ctx.bidSaving}
        pendingRub={ctx.pendingBidRub}
        onStartEdit={ctx.onBidStartEdit}
        onCancel={ctx.onBidCancel}
        onSubmit={ctx.onBidSubmit}
        onBudgetClick={ctx.onBudgetClick}
      />
    );
    case "views": return <ViewsCell c={c} />;
    case "clicks": return <ClicksCell c={c} />;
    case "orders": return <OrdersAdsCell c={c} />;
    case "costShare": return <CostShareCell c={c} />;
    case "funnel": return <FunnelCell c={c} />;
    case "ctr": return <CtrCell c={c} />;
    case "spend": return <SpendCell c={c} />;
    case "day": return <DayCell c={c} />;
    case "conversion": return <ConversionCell c={c} />;
    case "cartOrder": return <CartOrderCell c={c} />;
    case "drr": return <DrrRevCell c={c} />;
    case "account": return <AccountCell c={c} />;
    default: return null;
  }
}

function getSortValue(c: AdsCampaign, key: string): number | string {
  switch (key) {
    case "product": return (c.name || "").toLowerCase();
    case "campaign": return c.advertId;
    case "views": return c.views;
    case "clicks": return c.clicks;
    case "orders": return c.orders;
    case "costShare": return c.sumPrice > 0 ? c.drr : 0;
    case "funnel": return c.atbs;
    case "ctr": return c.ctr;
    case "spend": return c.spend;
    case "conversion": return c.cr;
    case "cartOrder": return c.orders;
    case "drr": return c.sumPrice > 0 ? c.drr : 0;
    default: return 0;
  }
}

// --- Refresh icon for filters ---
function RefreshIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

type StatusConfirmState = {
  campaign: AdsCampaign;
  action: "start" | "pause";
  left: number;
  top: number;
  width: number;
};

// --- Main component ---
export default function AdsCampaignsTable({ days: initialDays = 7, articleFilter, articleFilterNonce, onRowDoubleClick }: {
  days?: number;
  // Автофильтр по артикулу при переходе из «Карточки» через dblclick.
  articleFilter?: string | null;
  // Меняется при каждом dblclick, чтобы один и тот же артикул повторно применил фильтр.
  articleFilterNonce?: number;
  // Обратная навигация: dblclick по строке кампании → переход на «Карточки» с выбранным товаром.
  onRowDoubleClick?: (firstNmId: number | null, advertId: number) => void;
}) {
  const [data, setData] = useState<AdsApiResponse | null>(null);
  const dataRef = useRef<AdsApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [groupBySubject, setGroupBySubject] = useState(false);
  const [search, setSearch] = useState(articleFilter ?? "");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState>({ column: "orders", dir: "desc" });
  const [days, setDays] = useState<number>(initialDays);
  const [offset, setOffset] = useState<number>(0);
  const [selectedAdvertId, setSelectedAdvertId] = useState<number | null>(null);
  // Ручной детектор double-click. Нативный onDoubleClick ломается, потому что первый клик
  // переключает selectedAdvertId → появляется SplitPane → таблица сжимается до 45% высоты
  // и скроллится в начало; второй клик при том же y попадает на ДРУГУЮ кампанию (которая
  // подъехала к курсору), и onDoubleClick там либо не срабатывает, либо открывает не ту.
  // Лечим так: одиночный клик «откладываем» на 280мс — если за это время приходит второй
  // клик, отменяем выбор и идём в навигацию. Двойной клик ловится по advertId+timestamp.
  const lastRowClick = useRef<{ advertId: number; ts: number } | null>(null);
  const pendingClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Inline-редактор единой ставки Uni-кампании (в TargetCell верхней таблицы).
  // editingBid — какая кампания сейчас в режиме редактирования.
  // pendingBid — оптимистичное значение, показывается пока сохраняется на сервере.
  const [editingBidAdvertId, setEditingBidAdvertId] = useState<number | null>(null);
  const [savingBidAdvertId, setSavingBidAdvertId] = useState<number | null>(null);
  const [pendingBidByAdvert, setPendingBidByAdvert] = useState<Map<number, number>>(new Map());
  const [savingStatusAdvertId, setSavingStatusAdvertId] = useState<number | null>(null);
  const [statusConfirm, setStatusConfirm] = useState<StatusConfirmState | null>(null);
  // Открытая модалка пополнения бюджета (для какой кампании).
  const [budgetDepositFor, setBudgetDepositFor] = useState<AdsCampaign | null>(null);
  // Вкладка детальной панели рекламы (daily/queries). Держим в родителе —
  // иначе key-remount дочернего компонента на каждой смене кампании её сбрасывает.
  // Загружаем из settings один раз при mount, сохраняем при каждом переключении.
  const [adTab, setAdTab] = useState<"daily" | "queries">("daily");
  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((s) => {
      const t = s?.ad_panel_tab;
      if (t === "daily" || t === "queries") setAdTab(t);
    }).catch(() => {});
  }, []);
  const handleAdTabChange = useCallback((t: "daily" | "queries") => {
    setAdTab(t);
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ad_panel_tab: t }),
    }).catch(() => {});
  }, []);

  // Перезапись search + сброс статус-фильтра при dblclick на артикул в «Карточках».
  // Ставим statusFilter="all" (активные + на паузе), чтобы пользователь сразу увидел
  // все кампании по артикулу, а не только активные. Nonce триггерит эффект даже если
  // значение то же самое (повторный клик по тому же артикулу).
  useEffect(() => {
    if (articleFilter != null) {
      setSearch(articleFilter);
      setStatusFilter("all");
    }
  }, [articleFilter, articleFilterNonce]);

  useEffect(() => {
    if (!statusConfirm) return;
    function close() { setStatusConfirm(null); }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [statusConfirm]);

  // Column widths & order
  const defaultOrder = COLUMNS.map((c) => c.key);
  const [colOrder, setColOrder] = useState<string[]>(defaultOrder);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [hiddenCols, setHiddenCols] = useState<string[]>([]);
  const [colSettingsReady, setColSettingsReady] = useState(false);
  const [colSettingsOpen, setColSettingsOpen] = useState(false);
  const colSettingsRef = useRef<HTMLDivElement>(null);
  const dragKey = useRef<string | null>(null);
  const resizeKey = useRef<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const resizingHandle = useRef(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      loadAdsColWidths(),
      loadAdsColOrder(),
      fetch("/api/settings").then((r) => r.json()).catch(() => ({})),
    ]).then(([w, o, s]) => {
      if (!alive) return;
      if (Object.keys(w).length > 0) setColWidths(w);
      if (o) {
        const known = new Set(defaultOrder);
        const result = o.filter((k) => known.has(k));
        const missing = defaultOrder.filter((k) => !result.includes(k));
        for (const m of missing) {
          const defIdx = defaultOrder.indexOf(m);
          let inserted = false;
          for (let i = defIdx - 1; i >= 0; i--) {
            const pos = result.indexOf(defaultOrder[i]);
            if (pos !== -1) {
              result.splice(pos + 1, 0, m);
              inserted = true;
              break;
            }
          }
          if (!inserted) result.unshift(m);
        }
        setColOrder(result);
      }
      const h = s.ads_col_hidden ? JSON.parse(s.ads_col_hidden) : [];
      if (Array.isArray(h)) setHiddenCols(h);
      const d = Number(s.ads_days);
      if (d > 0) setDays(d);
      // Вкладка рекламы должна открываться на периоде до сегодняшнего дня.
      // "Вчера" можно выбрать вручную, но не восстанавливаем его после reload.
      setOffset(0);
      if (s.ads_offset && s.ads_offset !== "0") saveSetting("ads_offset", "0").catch(() => {});
    }).catch(() => {}).finally(() => {
      if (alive) setColSettingsReady(true);
    });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => {
    if (!dataRef.current) setLoading(true);
    fetch("/api/ads?days=" + days + "&offset=" + offset)
      .then((r) => r.json())
      .then((d) => {
        dataRef.current = d;
        setData(d);
      })
      .finally(() => setLoading(false));
  }, [days, offset]);

  // Изменение единой ставки Uni-кампании. Шлёт на /api/advert/set-campaign-bid
  // (PATCH /api/advert/v1/bids в WB), оптимистично обновляет UI, потом ре-синкает campaigns.
  const handleSetCampaignBid = useCallback(async (advertId: number, cpmRub: number): Promise<{ ok: boolean; error?: string }> => {
    setSavingBidAdvertId(advertId);
    setPendingBidByAdvert((prev) => new Map(prev).set(advertId, cpmRub));
    try {
      const res = await fetch("/api/advert/set-campaign-bid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ advertId, cpmRub }),
      });
      const d = await res.json();
      if (!d.ok) {
        setPendingBidByAdvert((prev) => { const n = new Map(prev); n.delete(advertId); return n; });
        setSavingBidAdvertId(null);
        return { ok: false, error: d.error || `status ${d.status || res.status}` };
      }
      // Если WB подрезал до минимума — покажем фактическое значение.
      const appliedRub = Number(d.appliedRub ?? cpmRub);
      if (d.clamped && appliedRub !== cpmRub) {
        setPendingBidByAdvert((prev) => new Map(prev).set(advertId, appliedRub));
      }
      // Триггерим ре-синк campaigns, чтобы из WB пришло подтверждённое bid_kopecks,
      // и через 4с перезагружаем список — pendingBid тогда снимается естественно.
      fetch("/api/sync/campaigns?force=1", { method: "POST" }).catch(() => {});
      setTimeout(() => {
        reload();
        setPendingBidByAdvert((prev) => { const n = new Map(prev); n.delete(advertId); return n; });
      }, 4000);
      setSavingBidAdvertId(null);
      return { ok: true };
    } catch (e) {
      setPendingBidByAdvert((prev) => { const n = new Map(prev); n.delete(advertId); return n; });
      setSavingBidAdvertId(null);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [reload]);

  const handleSetCpcBid = useCallback(async (advertId: number, cpcRub: number): Promise<{ ok: boolean; error?: string }> => {
    setSavingBidAdvertId(advertId);
    setPendingBidByAdvert((prev) => new Map(prev).set(advertId, cpcRub));
    try {
      const res = await fetch("/api/advert/set-cpc-bid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ advertId, cpcRub }),
      });
      const d = await res.json();
      if (!d.ok) {
        setPendingBidByAdvert((prev) => { const n = new Map(prev); n.delete(advertId); return n; });
        setSavingBidAdvertId(null);
        return { ok: false, error: d.error || "status " + (d.status || res.status) };
      }
      const appliedRub = Number(d.cpcRub ?? cpcRub);
      if (appliedRub !== cpcRub) {
        setPendingBidByAdvert((prev) => new Map(prev).set(advertId, appliedRub));
      }
      fetch("/api/sync/campaigns?force=1", { method: "POST" }).catch(() => {});
      setTimeout(() => {
        reload();
        setPendingBidByAdvert((prev) => { const n = new Map(prev); n.delete(advertId); return n; });
      }, 4000);
      setSavingBidAdvertId(null);
      return { ok: true };
    } catch (e) {
      setPendingBidByAdvert((prev) => { const n = new Map(prev); n.delete(advertId); return n; });
      setSavingBidAdvertId(null);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [reload]);

  const openStatusConfirm = useCallback((campaign: AdsCampaign, event: ReactMouseEvent<HTMLButtonElement>) => {
    const action = campaign.status === 9 ? "pause" : "start";
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 340;
    const margin = 8;
    const left = Math.min(Math.max(rect.left, margin), window.innerWidth - width - margin);
    const top = Math.min(Math.max(rect.bottom + 8, margin), window.innerHeight - 178);
    setStatusConfirm({ campaign, action, left, top, width });
  }, []);

  const handleSetCampaignStatus = useCallback(async (campaign: AdsCampaign, action: "start" | "pause"): Promise<void> => {
    setStatusConfirm(null);
    setSavingStatusAdvertId(campaign.advertId);
    try {
      const res = await fetch("/api/advert/campaign-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ advertId: campaign.advertId, action }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        const detail = typeof d?.detail === "object" && d.detail && "error" in d.detail
          ? String((d.detail as { error?: unknown }).error)
          : "";
        const message = detail || d?.error || `HTTP ${res.status}`;
        alert(`Ошибка: ${message}`);
        return;
      }

      const nextStatus = Number(d.status);
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          campaigns: prev.campaigns.map((c) => c.advertId === campaign.advertId
            ? { ...c, status: nextStatus, changeTime: new Date().toISOString() }
            : c),
        };
      });

      fetch("/api/sync/campaigns?force=1", { method: "POST" }).catch(() => {});
      setTimeout(reload, 4000);
    } catch (e) {
      alert(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingStatusAdvertId(null);
    }
  }, [reload]);

  useEffect(() => { reload(); }, [reload]);

  function handlePeriodChange(d: number, o: number) {
    setDays(d);
    setOffset(o);
    saveSetting("ads_days", String(d));
    saveSetting("ads_offset", "0");
  }

  function debouncedSaveWidths(w: Record<string, number>) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveSetting("ads_col_widths", JSON.stringify(w)), 500);
  }

  const handleResizeStart = useCallback((key: string, startX: number) => {
    resizeKey.current = key;
    resizeStartX.current = startX;
    const col = COLUMNS.find((c) => c.key === key);
    resizeStartW.current = colWidths[key] || col?.defaultW || 100;

    const onMouseMove = (e: MouseEvent) => {
      if (!resizeKey.current) return;
      const diff = e.clientX - resizeStartX.current;
      const newW = Math.max(50, Math.min(500, resizeStartW.current + diff));
      setColWidths((prev) => ({ ...prev, [resizeKey.current!]: newW }));
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      resizeKey.current = null;
      resizingHandle.current = false;
      setColWidths((prev) => { debouncedSaveWidths(prev); return prev; });
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [colWidths]);

  function handleSort(col: string) {
    const meta = COLUMNS.find((c) => c.key === col);
    if (!meta?.sortable) return;
    setSort((prev) => {
      if (prev.column !== col) return { column: col, dir: "desc" };
      if (prev.dir === "desc") return { column: col, dir: "asc" };
      if (prev.dir === "asc") return { column: "", dir: null };
      return { column: col, dir: "desc" };
    });
  }

  function toggleCol(key: string) {
    if (key === "product") return; // locked
    setHiddenCols((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      saveSetting("ads_col_hidden", JSON.stringify(next));
      return next;
    });
  }
  function resetHiddenCols() {
    setHiddenCols([]);
    saveSetting("ads_col_hidden", JSON.stringify([]));
  }

  useEffect(() => {
    if (!colSettingsOpen) return;
    const onClick = (e: MouseEvent) => {
      if (colSettingsRef.current && !colSettingsRef.current.contains(e.target as Node)) setColSettingsOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [colSettingsOpen]);

  function handleDragStart(key: string) { dragKey.current = key; }
  function handleDragOver(e: React.DragEvent) { e.preventDefault(); }
  function handleDrop(targetKey: string) {
    const srcKey = dragKey.current;
    if (!srcKey || srcKey === targetKey || targetKey === "product" || srcKey === "product") return;
    setColOrder((prev) => {
      const next = [...prev];
      const si = next.indexOf(srcKey);
      const ti = next.indexOf(targetKey);
      if (si === -1 || ti === -1) return prev;
      next.splice(si, 1);
      next.splice(ti, 0, srcKey);
      saveSetting("ads_col_order", JSON.stringify(next));
      return next;
    });
    dragKey.current = null;
  }

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.campaigns.filter((c) => matchStatus(c, statusFilter));
    list = list.filter((c) => matchType(c, typeFilter));
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((c) =>
        String(c.advertId).includes(q) ||
        c.nmIds.some((n) => String(n).includes(q)) ||
        (c.name || "").toLowerCase().includes(q),
      );
    }
    // Primary sort — статус: активные наверху, пауза ниже, готовые/архив в конце.
    // Secondary — выбор пользователя (если есть), иначе порядок из API (по advert_id).
    const statusOrder = (s: number): number => (s === 9 ? 0 : s === 11 ? 1 : s === 4 ? 2 : 3);
    list = [...list].sort((a, b) => {
      const sd = statusOrder(a.status) - statusOrder(b.status);
      if (sd !== 0) return sd;
      if (sort.column && sort.dir) {
        const va = getSortValue(a, sort.column);
        const vb = getSortValue(b, sort.column);
        const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
        return sort.dir === "asc" ? cmp : -cmp;
      }
      return 0;
    });
    return list;
  }, [data, statusFilter, typeFilter, search, sort]);

  const grouped = useMemo(() => {
    if (!groupBySubject) return null;
    const map = new Map<string, AdsCampaign[]>();
    for (const c of filtered) {
      const key = c.subject || "Без предмета";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filtered, groupBySubject]);

  function toggleGroup(k: string) {
    setCollapsedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
  }

  // total — только управляемые (активные + паузные + готовые), не считая архив.
  const total = data?.campaigns.filter((c) => c.status === 9 || c.status === 11 || c.status === 4).length ?? 0;
  const shown = filtered.length;
  const colMap = new Map(COLUMNS.map((c) => [c.key, c]));

  // --- Row ---
  const tdBase = "py-2 px-2 border-b border-[var(--border)] border-r border-r-white/[0.06] overflow-hidden";

  const visibleOrder = colOrder.filter((k) => !hiddenCols.includes(k));

  function renderRow(c: AdsCampaign) {
    const isSelected = selectedAdvertId === c.advertId;
    const rowCls =
      "group transition-colors cursor-pointer " +
      (isSelected ? "bg-[var(--accent)]/25" : "hover:bg-[var(--bg-card-hover)]");
    const ctx: CellContext = {
      bidEditing: editingBidAdvertId === c.advertId,
      bidSaving: savingBidAdvertId === c.advertId,
      pendingBidRub: pendingBidByAdvert.get(c.advertId) ?? null,
      onBidStartEdit: () => setEditingBidAdvertId(c.advertId),
      onBidCancel: () => setEditingBidAdvertId(null),
      onBidSubmit: async (rub: number) => {
        const res = c.paymentType === "cpc"
          ? await handleSetCpcBid(c.advertId, rub)
          : await handleSetCampaignBid(c.advertId, rub);
        if (res.ok) setEditingBidAdvertId(null);
        else alert(`Ошибка: ${res.error}`);
      },
      onBudgetClick: () => setBudgetDepositFor(c),
      statusSaving: savingStatusAdvertId === c.advertId,
      onStatusChange: (event) => openStatusConfirm(c, event),
    };
    return (
      <tr
        key={c.advertId}
        className={rowCls}
        onClick={() => {
          const now = Date.now();
          const prev = lastRowClick.current;
          if (prev && prev.advertId === c.advertId && now - prev.ts < 400) {
            // Второй клик подряд по той же кампании — отменяем отложенный single-click и навигируем.
            if (pendingClickTimer.current) { clearTimeout(pendingClickTimer.current); pendingClickTimer.current = null; }
            lastRowClick.current = null;
            onRowDoubleClick?.(c.firstNmId, c.advertId);
            return;
          }
          lastRowClick.current = { advertId: c.advertId, ts: now };
          // Откладываем выбор кампании, чтобы DOM не поехал до второго клика.
          if (pendingClickTimer.current) clearTimeout(pendingClickTimer.current);
          const advertId = c.advertId;
          pendingClickTimer.current = setTimeout(() => {
            setSelectedAdvertId((prevSel) => prevSel === advertId ? null : advertId);
            pendingClickTimer.current = null;
          }, 280);
        }}
      >
        {visibleOrder.map((key) => {
          const col = colMap.get(key);
          if (!col) return null;
          const w = colWidths[key] || col.defaultW;
          const isRight = col.align === "right";
          const isSticky = col.sticky;
          return (
            <td
              key={key}
              className={
                tdBase +
                (isSticky
                  ? isSelected
                    ? " sticky left-0 z-10"
                    : " sticky left-0 z-10 bg-[var(--bg)] group-hover:bg-[var(--bg-card-hover)]"
                  : "") +
                (isRight ? " text-right" : "")
              }
              style={{
                width: w, minWidth: 50, maxWidth: 500,
                ...(isSticky && isSelected ? { background: "color-mix(in srgb, var(--accent) 25%, var(--bg))" } : {}),
              }}
            >
              {getCellContent(key, c, ctx)}
            </td>
          );
        })}
      </tr>
    );
  }

  // --- Filter panel (matches AdsFilters look) ---
  return (
    <div className="flex flex-col overflow-hidden" style={{ height: "calc(100vh - 90px)" }}>
      {statusConfirm && (
        <div
          className="fixed z-[120] rounded-xl border border-[var(--accent)]/50 bg-[var(--bg-card)] shadow-2xl"
          style={{ left: statusConfirm.left, top: statusConfirm.top, width: statusConfirm.width }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-[var(--border)] text-sm font-semibold text-[var(--text)]">
            {statusConfirm.action === "pause" ? "Приостановить рекламу" : "Запустить рекламу"}
          </div>
          <div className="px-3 py-2 text-xs leading-relaxed text-[var(--text-muted)]">
            {statusConfirm.action === "pause" ? (
              <>
                Кампания <span className="font-mono text-[var(--text)]">{statusConfirm.campaign.advertId}</span> будет поставлена на паузу. Показы по кампании остановятся.
              </>
            ) : (
              <>
                Кампания <span className="font-mono text-[var(--text)]">{statusConfirm.campaign.advertId}</span> будет запущена. Если бюджета недостаточно, Wildberries вернёт ошибку.
              </>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 px-3 pb-3">
            <button
              type="button"
              onClick={() => setStatusConfirm(null)}
              className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card-hover)] transition-colors"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => handleSetCampaignStatus(statusConfirm.campaign, statusConfirm.action)}
              className={
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors " +
                (statusConfirm.action === "pause"
                  ? "bg-[var(--warning)]/20 text-[var(--warning)] hover:bg-[var(--warning)]/30"
                  : "bg-[var(--accent)] text-white hover:brightness-110")
              }
            >
              {statusConfirm.action === "pause" ? "Пауза" : "Запустить"}
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-3 px-4 py-2 text-sm flex-wrap border-b border-[var(--border)] shrink-0">
        <button
          onClick={reload}
          className="p-2 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-card-hover)] transition-colors"
          title="Обновить"
        >
          <RefreshIcon />
        </button>

        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-[var(--text-muted)]">
          <input
            type="checkbox"
            checked={groupBySubject}
            onChange={(e) => setGroupBySubject(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          гр. Предмет
        </label>

        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Артикул / ID"
            className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text)] w-40 outline-none focus:border-[var(--accent)]"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              title="Очистить фильтр"
              aria-label="Очистить фильтр"
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-white hover:bg-red-500/20 hover:border-red-500/60 hover:text-red-400 transition-colors text-lg leading-none"
            >
              ×
            </button>
          )}
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          className="px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text)] text-xs"
        >
          <option value="all">Все типы</option>
          <option value="uni">Аук. Uni</option>
          <option value="search">Аук. Поиск</option>
          <option value="catalog">Аук. Каталог</option>
          <option value="manual">Аук. Ручная</option>
          <option value="cpc">CPC</option>
        </select>

        <select
          value={`${days}:${offset}`}
          onChange={(e) => {
            const [d, o] = e.target.value.split(":").map(Number);
            handlePeriodChange(d, o);
          }}
          className="px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text)] text-xs"
        >
          {PERIOD_OPTIONS.map((o) => (
            <option key={`${o.days}:${o.offset}`} value={`${o.days}:${o.offset}`}>{o.label}</option>
          ))}
        </select>

        <span className="text-[var(--text-muted)] text-xs">{shown} ({total})</span>

        <div className="flex items-center rounded-lg border border-[var(--border)] overflow-hidden">
          {(["active", "paused", "all"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={
                "px-3 py-1.5 text-xs transition-colors " +
                (statusFilter === s
                  ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]")
              }
            >
              {s === "active" ? "Активные" : s === "paused" ? "Пауза" : "Все"}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-4 text-xs">
          <div>
            <span className="text-[var(--text-muted)]">Счет: </span>
            <span className="text-white font-semibold">{fmtRub(data?.totals.spendTodayTotal || 0)}</span>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Опл: </span>
            <span className="text-white font-semibold">{fmtRub(data?.totals.paidToday || 0)}</span>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Доступно: </span>
            <span className="text-[var(--accent)] font-semibold">{fmtRub(data?.totals.balance || 0)}</span>
          </div>

          <div ref={colSettingsRef} className="relative ml-1">
            <button
              onClick={() => setColSettingsOpen(!colSettingsOpen)}
              className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] transition-colors"
              title="Настройка столбцов"
            >
              <svg className="w-4 h-4 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
            {colSettingsOpen && (
              <div className="absolute right-0 top-full mt-1 p-2 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl min-w-[200px] max-h-[400px] overflow-y-auto z-50">
                <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide px-2 py-1 mb-1">Столбцы</div>
                {COLUMNS.map((col) => {
                  const isHidden = hiddenCols.includes(col.key);
                  const isLocked = col.key === "product";
                  const name = typeof col.label === "string" ? col.label : col.key;
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
                    onClick={resetHiddenCols}
                    className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-[var(--accent)] hover:bg-[var(--bg-card-hover)] transition-colors"
                  >
                    По умолчанию
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Table + optional detail panel (resizable split) */}
      {(() => {
        const tableEl = loading || !colSettingsReady ? (
          <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">Загрузка...</div>
        ) : (
          <div className="h-full overflow-auto">
          <table className="border-collapse text-sm" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr>
                {visibleOrder.map((key) => {
                  const col = colMap.get(key);
                  if (!col) return null;
                  const w = colWidths[key] || col.defaultW;
                  const active = sort.column === col.key;
                  return (
                    <th
                      key={col.key}
                      draggable={!col.sticky}
                      onDragStart={() => handleDragStart(col.key)}
                      onDragOver={handleDragOver}
                      onDrop={() => handleDrop(col.key)}
                      onClick={() => col.sortable && handleSort(col.key)}
                      className={
                        "relative py-2 px-2 text-xs font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)] text-center " +
                        (col.sticky
                          ? "sticky left-0 z-20 bg-[var(--bg-card)] "
                          : "bg-[var(--bg-card)] ") +
                        (col.sortable ? "select-none cursor-pointer hover:text-[var(--accent)] " : "cursor-default ")
                      }
                      style={{ width: w, minWidth: 50, maxWidth: 500 }}
                    >
                      <Tooltip text={col.tooltip}>
                        <span className="text-[var(--text-muted)]">
                          {col.label}
                          {active && <SortArrow dir={sort.dir} />}
                        </span>
                      </Tooltip>
                      <div
                        className="absolute top-0 -right-px w-[2px] h-full cursor-col-resize transition-colors z-10"
                        style={{ background: "rgba(255,255,255,0.08)" }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          resizingHandle.current = true;
                          handleResizeStart(col.key, e.clientX);
                        }}
                        onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "rgba(108,92,231,0.4)"; }}
                        onMouseLeave={(e) => { if (!resizingHandle.current) (e.target as HTMLElement).style.background = "rgba(255,255,255,0.08)"; }}
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {grouped
                ? grouped.map(([subj, items]) => {
                    const collapsed = collapsedGroups.has(subj);
                    return (
                      <Fragment key={`group-${subj}`}>
                        <tr className="bg-[var(--bg-card)]/60 border-b border-[var(--border)]">
                          <td colSpan={visibleOrder.length} className="px-3 py-1.5 text-xs">
                            <button
                              onClick={() => toggleGroup(subj)}
                              className="flex items-center gap-2 text-[var(--text)] hover:text-[var(--accent)]"
                            >
                              <span className="text-[var(--accent)]">{collapsed ? "▸" : "▾"}</span>
                              <span>~ {subj}</span>
                              <span className="text-[var(--accent)] font-semibold">{items.length}</span>
                              <span className="text-[var(--text-muted)]">камп.</span>
                            </button>
                          </td>
                        </tr>
                        {!collapsed && items.map(renderRow)}
                      </Fragment>
                    );
                  })
                : filtered.map(renderRow)}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={visibleOrder.length} className="py-12 text-center text-[var(--text-muted)]">
                    {search && /^\d+$/.test(search.trim())
                      ? <>По артикулу <span className="font-mono text-[var(--text)]">{search.trim()}</span> нет активных рекламных кампаний</>
                      : "Нет кампаний по фильтру"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        );
        const camp = selectedAdvertId ? data?.campaigns.find((c) => c.advertId === selectedAdvertId) || null : null;
        if (!camp) return <div className="flex-1 overflow-hidden">{tableEl}</div>;
        return (
          <div className="flex-1 overflow-hidden">
            <SplitPane
              fitParent
              defaultRatio={0.45}
              top={tableEl}
              bottom={
                <AdCampaignDetailPanel
                  key={camp.advertId}
                  campaign={camp}
                  days={90}
                  offset={0}
                  tab={adTab}
                  onTabChange={handleAdTabChange}
                  onClose={() => setSelectedAdvertId(null)}
                />
              }
            />
          </div>
        );
      })()}

      {budgetDepositFor && (
        <BudgetDepositModal
          advertId={budgetDepositFor.advertId}
          campaignName={budgetDepositFor.name}
          currentBudgetRub={budgetDepositFor.budgetTotal}
          onClose={() => setBudgetDepositFor(null)}
          onSuccess={() => {
            // Перезагрузим список — подхватим новый total из БД (мы оптимистично обновили в endpoint).
            reload();
          }}
        />
      )}
    </div>
  );
}
