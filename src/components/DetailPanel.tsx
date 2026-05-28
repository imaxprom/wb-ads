"use client";

import { useState, useEffect, useRef, useCallback, useMemo, Fragment, type ReactNode } from "react";
import { fmtNum, fmtRub, fmtDrr, localDateStr } from "@/lib/format";
import type { DashboardProduct } from "@/types";
import { getWbImageCandidateUrls, withImageVersion } from "@/lib/wb-image";
import { EyeIcon, CartIcon, BoxIcon, ClickIcon, CheckCircleIcon } from "./icons";
import Tooltip from "./Tooltip";

interface AssocDetail { sourceNmId: number; vendorCode: string; carts: number; orders: number; sumPrice: number }
interface SppHour { hour: number; sppAvg: number; sppOrders: number }
interface SppDistrict { district: string; sppAvg: number; sppOrders: number }

interface DayRow {
  date: string; ordersCount: number; views: number; ctrGeneral: number; clicks: number;
  cartConversion: number; cartsTotal: number; orderConversion: number;
  avgPrice: number; sppAvg: number; sppOrders: number; sppByHour: SppHour[]; sppByDistrict: SppDistrict[];
  drr: number; drrFull: number; cps: number; adSpend: number; ordersSum: number;
  adViews: number; adCtr: number; adClicks: number; adCpc: number;
  cpm: number; adClickToCart: number; adCarts: number; cartCostAd: number; adOrders: number;
  orderCostAd: number; assocCarts: number; assocOrders: number;
  assocDetails: AssocDetail[];
  assocOutCarts: number; assocOutOrders: number;
  assocOutDetails: AssocDetail[];
  buyouts: number; cancels: number; inTransit: number; buyoutPercent: number;
}

function formatDate(d: string): string {
  const [, m, day] = d.split("-");
  const months = ["","янв.","февр.","мар.","апр.","мая","июн.","июл.","авг.","сент.","окт.","нояб.","дек."];
  return `${parseInt(day)} ${months[parseInt(m)]}`;
}

// Settings persistence for detail table columns
async function saveSetting(key: string, value: string) {
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [key]: value }),
  });
}

async function loadDetailColWidths(): Promise<Record<string, number>> {
  try {
    const res = await fetch("/api/settings");
    const raw = await res.json();
    return raw.detail_col_widths ? JSON.parse(raw.detail_col_widths) : {};
  } catch { return {}; }
}

async function loadDetailColOrder(): Promise<string[] | null> {
  try {
    const res = await fetch("/api/settings");
    const raw = await res.json();
    const order = raw.detail_col_order ? JSON.parse(raw.detail_col_order) : null;
    return Array.isArray(order) && order.length > 0 ? order : null;
  } catch { return null; }
}

const DEFAULT_W: Record<string, number> = {
  date: 72, ordersCount: 82, views: 80, ctrGeneral: 55, clicks: 78,
  cartConversion: 58, cartsTotal: 72, orderConversion: 58, avgPrice: 82,
  sppAvg: 62, drr: 55, drrFull: 55, cps: 70, cpo: 70, adSpend: 72, ordersSum: 100, adViews: 78, adCtr: 50,
  adClicks: 115, adClickToCart: 58, cpm: 60, adCarts: 85, cartCostAd: 68, adOrders: 78,
  orderCostAd: 68, assocCarts: 55, assocOrders: 55, buyouts: 65,
  cancels: 52, inTransit: 50, buyoutPercent: 58,
};

// Text names for column settings dropdown (when label is JSX)
function colLabelText(key: string): string {
  const map: Record<string, string> = {
    ordersCount: "Заказы общ.",
    views: "Показы общ.",
    clicks: "Клики общ.",
    cartConversion: "Корзина %",
    cartsTotal: "Корзины общ.",
    orderConversion: "Заказы %",
    adViews: "Показы рекл.",
    adClicks: "Клики рекл.",
    adClickToCart: "Клик→Корзина %",
    adCarts: "Корзины рекл.",
    cartCostAd: "Корзина xP",
    adOrders: "Заказы рекл.",
    orderCostAd: "Заказы xP",
    assocCarts: "+Корзины",
    assocOrders: "+Заказы",
    buyouts: "Выкуплено",
    drr: "ДРРз",
    drrFull: "ДРРп",
    cps: "CPS",
    cpo: "CPO",
    sppAvg: "СПП",
  };
  return map[key] || key;
}

const ic = "w-4.5 h-4.5 inline-block align-middle"; // icon class for column headers — larger than text, vertically centered

const COLS: { key: string; label: ReactNode; tooltip: string; align?: "right"|"left" }[] = [
  { key: "date", label: "Дата", tooltip: "Дата по Мск", align: "right" },
  { key: "ordersCount", label: "Заказы", tooltip: "Общее кол-во заказанных товаров, шт" },
  { key: "views", label: <><EyeIcon className={ic} />*общ.</>, tooltip: "Увидели карточку\n\nСколько раз покупатели видели карточку товара в выдаче каталога, поиска и рекомендаций\n(данные из закрытого API Джем)" },
  { key: "ctrGeneral", label: "CTR", tooltip: "Конверсия общих показов в переходы (клики), %\n(данные из закрытого API Джем)\n~ — слишком мало показов" },
  { key: "clicks", label: <><ClickIcon className={ic} /> общ.</>, tooltip: "Общее кол-во переходов в карточку товара\n(и с органики, и с рекламы)" },
  { key: "cartConversion", label: <><CartIcon className={ic} /> %</>, tooltip: "Конверсия общих переходов в корзины" },
  { key: "cartsTotal", label: <><CartIcon className={ic} /> общ.</>, tooltip: "Общее кол-во товаров помещённых в корзину" },
  { key: "orderConversion", label: <><BoxIcon className={ic} /> %</>, tooltip: "Конверсия корзин в заказы\n## — сбой (или запаздывание) статистики корзин" },
  { key: "avgPrice", label: "Ср. цена", tooltip: "Средняя цена товара по заказам покупателей\nЦена поставки (без скидки WB \"СПП\")" },
  { key: "sppAvg", label: "СПП", tooltip: "Средняя скидка постоянного покупателя по заказам WB за день\nИсточник: Statistics API /api/v1/supplier/orders\nНаведение на значение показывает средний СПП по часам и федеральным округам" },
  { key: "drr", label: <span>ДРР<span className="text-[8px]">з</span></span>, tooltip: "Доля рекламных расходов по отношению к сумме всех заказов\nдля значений меньше 1% ведущий 0 'целых' не показывается\n# % — нет заказов, хотя есть расход по рекламе\n~ — сильно меньше 0,1 %" },
  { key: "cpo", label: "CPO", tooltip: "Cost Per Order — себестоимость заказа.\nCPO = расход на рекламу / общее кол-во заказов\n(включая органические заказы, без учёта выкупа).\n— расхода нет либо нет заказов.", align: "right" },
  { key: "cps", label: "CPS", tooltip: "Cost Per Sale — себестоимость фактической продажи\nCPS = adSpend / (ordersCount × buyoutPct)\nС учётом возвратов/отмен по 30-дневному % выкупа.", align: "right" },
  { key: "drrFull", label: <span>ДРР<span className="text-[8px]">п</span></span>, tooltip: "Полный ДРР с учётом % выкупа\nДРРп = adSpend / (ordersSum × buyoutPct) × 100%\nbuyoutPct — % выкупа артикула за последние 30 дней (единый на все дни)\n# % — расход есть, выкупов нет\n— — нет данных по выкупу (синк buyout-percent не отработал)", align: "right" },
  { key: "adSpend", label: "Счет", tooltip: "Сумма затрат (начислений) на рекламу\n~ — менее 1 руб." },
  { key: "ordersSum", label: "Сум. заказы", tooltip: "Сумма всех заказов товара покупателями\nПо ценам поставки (без скидки WB \"СПП\")" },
  { key: "adViews", label: <><EyeIcon className={ic} /> рекл.</>, tooltip: "Показы рекламы" },
  { key: "adCtr", label: "CTR", tooltip: "Конверсия показов рекламы в клики, %" },
  { key: "adClicks", label: <><ClickIcon className={ic} /> рекл.</>, tooltip: "Кол-во кликов с рекламы x Средняя цена клика" },
  { key: "adClickToCart", label: <><ClickIcon className={ic} />{"\u2192"}<CartIcon className={ic} /></>, tooltip: "Конверсия рекламных кликов в корзины, %" },
  { key: "cpm", label: "CPM", tooltip: "Средняя цена 1000 рекл. показов" },
  { key: "adCarts", label: <><CartIcon className={ic} /> рекл.</>, tooltip: "Добавления в корзину рекламируемого товара\n(может включать и часть кол-ва ассоциированных,\nесли идет сбой/задержка получения детальных данных)\n\n+? — есть ещё добавления в корзину\nот исходной рекламы других товаров" },
  { key: "cartCostAd", label: <><CartIcon className={ic} /> <span className="text-[9px] align-middle">×</span><span className="text-sm align-middle">₽</span></>, tooltip: "Рекламная себестоимость корзин\n(с учетом ассоциированных корзин других товаров)\n# — расход есть, но корзин нет" },
  { key: "adOrders", label: <><BoxIcon className={ic} /> рекл.</>, tooltip: "Заказы с рекламы этого товара\n(может включать и часть кол-ва ассоциированных,\nесли идет сбой/задержка получения детальных данных)\n\n+? — есть ещё заказы\nот исходной рекламы других товаров" },
  { key: "orderCostAd", label: <><BoxIcon className={ic} /> <span className="text-[9px] align-middle">×</span><span className="text-sm align-middle">₽</span></>, tooltip: "Рекламная себестоимость заказов\n(с учетом ассоциированных заказов других товаров)\n# — расход есть, но заказов нет\n\nВажно: Показы рекламы и Заказы с неё идут не все день-в-день!\n(реклама с одного дня приносит заказы и в последующие дни)" },
  { key: "assocCarts", label: <><span>+</span><CartIcon className={ic} /></>, tooltip: "Плюс ассоциированные корзины других товаров от рекламы этого товара\n(если WB даёт такие данные в статистике рекламы\nи если этот товар единственный в своей рекл. кампании)" },
  { key: "assocOrders", label: <><span>+</span><BoxIcon className={ic} /></>, tooltip: "Плюс ассоциированные заказы других товаров от рекламы этого товара\n(если WB даёт такие данные в статистике рекламы\nи если этот товар единственный в своей рекл. кампании)" },
  { key: "buyouts", label: <><CheckCircleIcon className={ic} /> Куп</>, tooltip: "Выкуплено заказанных товаров, шт\n(из заказанных в этот день)" },
  { key: "cancels", label: "Отм", tooltip: "Сколько заказов отменили, шт\n(из заказанных в этот день)" },
  { key: "inTransit", label: "~?~", tooltip: "Сколько заказов где-то в пути, шт" },
  { key: "buyoutPercent", label: "% вык", tooltip: "Процент выкупа\nРасчёт по выкупленным и отменённым заказам.\n~?~ — данных недостаточно, много товаров в пути" },
];

function cellValue(row: DayRow, key: string): string {
  const v = row[key as keyof DayRow];
  switch (key) {
    case "date": return formatDate(row.date);
    case "ordersCount": case "views": case "clicks": case "cartsTotal": case "adViews":
    case "buyouts": case "cancels": case "inTransit":
      return String(Math.round(v as number));
    case "assocCarts":
      return row.assocOutCarts > 0 ? `+${row.assocOutCarts}` : "0";
    case "assocOrders":
      return row.assocOutOrders > 0 ? `+${row.assocOutOrders}` : "0";
    case "adCarts":
      if (row.adCarts === 0 && row.assocCarts === 0) return "0";
      return row.assocCarts > 0
        ? `${row.adCarts}+${row.assocCarts}`
        : String(row.adCarts);
    case "adOrders":
      if (row.adOrders === 0 && row.assocOrders === 0) return "0";
      return row.assocOrders > 0
        ? `${row.adOrders}+${row.assocOrders}`
        : String(row.adOrders);
    case "adClicks":
      if (row.adClicks === 0) return "—";
      return row.adCpc > 0
        ? `${row.adClicks} x ${row.adCpc.toFixed(1)} ₽`
        : String(row.adClicks);
    case "avgPrice": case "adSpend": case "ordersSum":
      return (v as number) > 0 ? fmtRub(v as number) : "—";
    case "sppAvg":
      return row.sppOrders > 0 ? `${row.sppAvg.toFixed(1).replace(".", ",")} %` : "—";
    case "ctrGeneral": case "cartConversion": case "orderConversion": case "adCtr": case "adClickToCart":
      return (v as number) > 0 ? `${v} %` : "—";
    case "cpm": case "adCpc":
      return (v as number) > 0 ? `${fmtNum(Math.round(v as number))} ₽` : "—";
    case "cartCostAd": case "orderCostAd":
      return (v as number) > 0 ? `x ${fmtNum(v as number)} ₽` : "—";
    case "drr": return fmtDrr(row.adSpend, row.ordersSum).text;
    case "drrFull":
      if (row.drrFull === -1) return "# %";
      if (row.drrFull === 0 && row.adSpend === 0) return "—";
      if (row.drrFull === 0) return "—";
      if (row.drrFull < 0.1) return "~ %";
      if (row.drrFull < 1) return `.${Math.round(row.drrFull * 10)} %`;
      return `${row.drrFull.toFixed(1)} %`;
    case "cps": return row.cps > 0 ? fmtRub(row.cps) : "—";
    case "cpo": {
      if (row.adSpend <= 0 || row.ordersCount <= 0) return "—";
      return fmtRub(Math.round(row.adSpend / row.ordersCount));
    }
    case "buyoutPercent": return (v as number) > 0 ? `${v} %` : "~?~";
    default: return String(v ?? "—");
  }
}

function formatSppValue(value: number, orders: number): string {
  return orders > 0 ? `${value.toFixed(1).replace(".", ",")} %` : "—";
}

function formatFederalDistrictName(value: string): string {
  return value.replace(/\s+федеральный округ/gi, " ФО");
}

function useLeftCenteredPopup(
  width: number,
  desiredHeight: number,
  opts: { margin?: number; bottomMargin?: number; verticalOffset?: number } = {},
) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [popupPos, setPopupPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  function showPopup() {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 8;
    const margin = opts.margin ?? 8;
    const bottomMargin = opts.bottomMargin ?? margin;
    const maxHeight = Math.max(120, window.innerHeight - margin - bottomMargin);
    const height = Math.min(desiredHeight, maxHeight);
    const anchorCenterX = rect.left + rect.width / 2;
    const anchorCenterY = rect.top + rect.height / 2;

    // Открываем сбоку слева от ячейки СПП, а не вниз под ней.
    // Если слева мало места, прижимаем к краю экрана, сохраняя саму таблицу видимой.
    const left = Math.min(Math.max(anchorCenterX - width - gap, margin), window.innerWidth - width - margin);
    const top = Math.min(
      Math.max(anchorCenterY - height / 2 + (opts.verticalOffset ?? 0), margin),
      window.innerHeight - height - bottomMargin,
    );
    setPopupPos({ left, top, maxHeight });
  }

  return { anchorRef, popupPos, showPopup, hidePopup: () => setPopupPos(null) };
}

function SppCell({ row }: { row: DayRow }) {
  const { anchorRef, popupPos, showPopup, hidePopup } = useLeftCenteredPopup(300, 860, {
    bottomMargin: 28,
    verticalOffset: 18,
  });
  const byHour = new Map(row.sppByHour.map((h) => [h.hour, h]));
  const hours = Array.from({ length: 24 }, (_, hour) => {
    const h = byHour.get(hour);
    return { hour, sppAvg: h?.sppAvg || 0, sppOrders: h?.sppOrders || 0 };
  });
  const districts = row.sppByDistrict ?? [];

  return (
    <span
      ref={anchorRef}
      className="cursor-default"
      onMouseEnter={showPopup}
      onMouseLeave={hidePopup}
    >
      {formatSppValue(row.sppAvg, row.sppOrders)}
      {row.sppOrders > 0 && popupPos && (
        <div className="
          fixed z-[1000]
          px-3 py-2 rounded-lg
          bg-[#2a2a3e] border-2 border-[var(--accent)] shadow-[0_0_20px_rgba(108,92,231,0.3)]
          text-[10px] text-white font-normal normal-case tracking-normal
          whitespace-nowrap text-left
          pointer-events-none
          overflow-y-auto
        " style={{ left: popupPos.left, top: popupPos.top, width: 300, maxHeight: popupPos.maxHeight }}>
          <div className="font-semibold text-[var(--text)] mb-1.5">
            СПП по часам
          </div>
          <div className="text-[9px] mb-2 opacity-60">
            Среднее по заказам за {formatDate(row.date)}
          </div>
          <table className="w-full table-fixed">
            <colgroup>
              <col className="w-[165px]" />
              <col className="w-[58px]" />
              <col className="w-[53px]" />
            </colgroup>
            <thead>
              <tr className="text-[9px] uppercase tracking-wide opacity-50">
                <td className="pb-1">час</td>
                <td className="pb-1 text-right px-2">СПП</td>
                <td className="pb-1 text-right">заказы</td>
              </tr>
            </thead>
            <tbody>
              {hours.map((h) => (
                <tr key={h.hour} className="border-t border-white/10">
                  <td className="py-0.5 font-mono">{String(h.hour).padStart(2, "0")}:00</td>
                  <td className="py-0.5 text-right px-2">{formatSppValue(h.sppAvg, h.sppOrders)}</td>
                  <td className="py-0.5 text-right text-[var(--text-muted)]">{h.sppOrders || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {districts.length > 0 && (
            <>
              <div className="mt-3 pt-2 border-t border-white/15">
                <div className="font-semibold text-[var(--text)] mb-1.5">
                  СПП по федеральным округам
                </div>
                <table className="w-full table-fixed">
                  <colgroup>
                    <col className="w-[165px]" />
                    <col className="w-[58px]" />
                    <col className="w-[53px]" />
                  </colgroup>
                  <thead>
                    <tr className="text-[9px] uppercase tracking-wide opacity-50">
                      <td className="pb-1">округ</td>
                      <td className="pb-1 text-right px-2">СПП</td>
                      <td className="pb-1 text-right">заказы</td>
                    </tr>
                  </thead>
                  <tbody>
                    {districts.map((d) => {
                      const districtName = formatFederalDistrictName(d.district);
                      return (
                      <tr key={d.district} className="border-t border-white/10">
                        <td className="py-0.5 pr-2 truncate" title={d.district}>{districtName}</td>
                        <td className="py-0.5 text-right px-2">{formatSppValue(d.sppAvg, d.sppOrders)}</td>
                        <td className="py-0.5 text-right text-[var(--text-muted)]">{d.sppOrders || "—"}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </span>
  );
}

// ═══ Associated Conversions Cell with Tooltip ═══

function AssocCell({ row, field }: { row: DayRow; field: "adCarts" | "adOrders" }) {
  const popupHeight = Math.min(420, 76 + row.assocDetails.length * 22);
  const { anchorRef, popupPos, showPopup, hidePopup } = useLeftCenteredPopup(390, popupHeight);
  const direct = field === "adCarts" ? row.adCarts : row.adOrders;
  const assoc = field === "adCarts" ? row.assocCarts : row.assocOrders;
  const text = assoc > 0 ? `${direct}+${assoc}` : String(direct);

  return (
    <span
      ref={anchorRef}
      className="cursor-default"
      onMouseEnter={showPopup}
      onMouseLeave={hidePopup}
    >
      {text}
      {row.assocDetails.length > 0 && popupPos && (
        <div className="
          fixed z-[1000]
          px-3 py-2 rounded-lg
          bg-[#2a2a3e] border-2 border-[var(--accent)] shadow-[0_0_20px_rgba(108,92,231,0.3)]
          text-[10px] text-white font-normal normal-case tracking-normal
          whitespace-nowrap text-left
          pointer-events-none
          overflow-y-auto
        " style={{ left: popupPos.left, top: popupPos.top, width: 390, maxHeight: popupPos.maxHeight }}>
          <div className="font-semibold text-[var(--text)] mb-1.5">
            Ассоциированные конверсии в этот товар
          </div>
          <div className="text-[9px] mb-2 opacity-60">
            (только которые удалось однозначно сопоставить)
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-[9px] uppercase tracking-wide opacity-50">
                <td className="pb-1">код товара</td>
                <td className="pb-1 text-right px-1.5">корз.</td>
                <td className="pb-1 text-right px-1.5">зак.</td>
                <td className="pb-1 text-right px-1.5">сумма</td>
                <td className="pb-1 text-right">арт.</td>
              </tr>
            </thead>
            <tbody>
              {row.assocDetails.map((d) => (
                <tr key={d.sourceNmId} className="border-t border-[var(--border)]">
                  <td className="py-0.5 font-mono">{d.sourceNmId}</td>
                  <td className="py-0.5 text-right px-1.5">{d.carts}</td>
                  <td className="py-0.5 text-right px-1.5">{d.orders}</td>
                  <td className="py-0.5 text-right px-1.5">{fmtRub(d.sumPrice)}</td>
                  <td className="py-0.5 text-right text-[9px] opacity-70">{d.vendorCode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </span>
  );
}

// ═══ Associated OUT Cell (conversions FROM this product's ads to OTHER products) ═══

function AssocOutCell({ row, field }: { row: DayRow; field: "assocCarts" | "assocOrders" }) {
  const popupHeight = Math.min(420, 56 + row.assocOutDetails.length * 22);
  const { anchorRef, popupPos, showPopup, hidePopup } = useLeftCenteredPopup(390, popupHeight);
  const value = field === "assocCarts" ? row.assocOutCarts : row.assocOutOrders;
  const text = value > 0 ? `+${value}` : "0";

  return (
    <span
      ref={anchorRef}
      className="cursor-default"
      onMouseEnter={showPopup}
      onMouseLeave={hidePopup}
    >
      {text}
      {row.assocOutDetails.length > 0 && popupPos && (
        <div className="
          fixed z-[1000]
          px-3 py-2 rounded-lg
          bg-[#2a2a3e] border-2 border-[var(--accent)] shadow-[0_0_20px_rgba(108,92,231,0.3)]
          text-[10px] text-white font-normal normal-case tracking-normal
          whitespace-nowrap text-left
          pointer-events-none
          overflow-y-auto
        " style={{ left: popupPos.left, top: popupPos.top, width: 390, maxHeight: popupPos.maxHeight }}>
          <div className="font-semibold mb-1.5">
            Ассоциированные конверсии из этого товара
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-[9px] uppercase tracking-wide opacity-50">
                <td className="pb-1">код товара</td>
                <td className="pb-1 text-right px-1.5">корз.</td>
                <td className="pb-1 text-right px-1.5">зак.</td>
                <td className="pb-1 text-right px-1.5">сумма</td>
                <td className="pb-1 text-right">арт.</td>
              </tr>
            </thead>
            <tbody>
              {row.assocOutDetails.map((d) => (
                <tr key={d.sourceNmId} className="border-t border-white/10">
                  <td className="py-0.5 font-mono">{d.sourceNmId}</td>
                  <td className="py-0.5 text-right px-1.5">{d.carts}</td>
                  <td className="py-0.5 text-right px-1.5">{d.orders}</td>
                  <td className="py-0.5 text-right px-1.5">{fmtRub(d.sumPrice)}</td>
                  <td className="py-0.5 text-right text-[9px] opacity-70">{d.vendorCode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </span>
  );
}

// ═══ Buyer Entry Points (traffic sources) ═══

interface EntryPoint {
  name: string;
  viewCount: number;
  openCard: number;
  CTR: number;
  addToCart: number;
  openToCart: number;
  orders: number;
  cartToOrder: number;
  detailedEntryPoints?: EntryPoint[];
}

interface EntryPointsData {
  total: { viewCount: number; openCard: number; CTR: number; addToCart: number; openToCart: number; orders: number; cartToOrder: number };
  entryPoints: EntryPoint[];
}

function BuyerEntryPoints({ nmId, selectedDate, onSelectDate }: {
  nmId: number;
  selectedDate: string | null;
  onSelectDate: (d: string) => void;
}) {
  const [source, setSource] = useState<"wb" | "traffic" | "entry">("traffic");
  const [data, setData] = useState<EntryPointsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [knownEmpty, setKnownEmpty] = useState<Set<string>>(new Set());

  const todayStr = localDateStr(new Date());
  const effectiveDate = selectedDate ?? todayStr;

  const dates = useMemo(() => {
    const arr: string[] = [];
    for (let i = 0; i < 90; i++) arr.push(localDateStr(new Date(Date.now() - i * 86400000)));
    return arr;
  }, []);

  useEffect(() => {
    const offset = Math.max(
      0,
      Math.round((new Date(todayStr + "T12:00:00").getTime() - new Date(effectiveDate + "T12:00:00").getTime()) / 86400000)
    );
    const url = `/api/buyer-profile?nmId=${nmId}&days=1&offset=${offset}`;
    const abort = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function run(attempt = 0) {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(url, { signal: abort.signal });
        if (r.status === 429) {
          const wait = 10;
          setError(`WB rate limit. Повтор через ${wait} сек…`);
          setLoading(false);
          if (attempt < 2) {
            retryTimer = setTimeout(() => run(attempt + 1), wait * 1000);
          }
          return;
        }
        const d = await r.json();
        if (d.ok) {
          setData(d.data);
          const total = d.data?.total;
          const empty = !total || (total.viewCount === 0 && total.openCard === 0 && total.orders === 0);
          if (empty) setKnownEmpty((prev) => { const s = new Set(prev); s.add(effectiveDate); return s; });
        } else {
          setError(d.error || "Ошибка загрузки");
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return; // silent cancel
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }

    // Debounce rapid clicks so 5 fast switches = 1 request
    const debounce = setTimeout(() => { run(); }, 250);

    return () => {
      clearTimeout(debounce);
      if (retryTimer) clearTimeout(retryTimer);
      abort.abort();
    };
  }, [nmId, effectiveDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const sourceToggle = (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--border)] shrink-0">
      {([
        { key: "traffic", label: "Тип трафика" },
        { key: "entry", label: "Точки входа" },
        { key: "wb", label: "WB" },
      ] as const).map((s) => (
        <button
          key={s.key}
          onClick={() => setSource(s.key)}
          className={
            "px-3 py-1 text-xs rounded-lg border transition-colors " +
            (source === s.key
              ? "bg-[var(--accent)]/20 text-[var(--accent)] border-[var(--accent)]"
              : "text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text)]")
          }
        >
          {s.label}
        </button>
      ))}
    </div>
  );

  const datesColumn = (
    <div className="shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--bg)]" style={{ width: 96 }}>
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="py-1.5 px-2 text-right text-[10px] font-semibold uppercase tracking-wide bg-[var(--bg-card)] border-b border-[var(--border)] text-[var(--text-muted)]">Дата</th>
          </tr>
        </thead>
        <tbody>
          {dates.map((d) => {
            const isSel = d === effectiveDate;
            const isToday = d === todayStr;
            const dow = new Date(d + "T12:00:00").getDay();
            const weekend = dow === 0 || dow === 6;
            const empty = knownEmpty.has(d);
            return (
              <tr
                key={d}
                onClick={() => onSelectDate(d)}
                className={
                  "cursor-pointer border-b border-[var(--border)] transition-colors " +
                  (isSel ? "bg-[var(--accent)]/25 " : "hover:bg-[var(--bg-card-hover)] ") +
                  (empty && !isSel ? "opacity-40 " : "")
                }
                style={weekend ? { borderLeft: "2px solid rgba(251, 191, 36, 0.5)" } : undefined}
              >
                <td
                  className={"py-1 px-2 text-right font-mono whitespace-nowrap " + (isToday ? "font-semibold text-[var(--text)]" : weekend ? "" : "text-[var(--text-muted)]")}
                  style={weekend && !isToday ? { color: "rgba(251, 191, 36, 0.8)" } : undefined}
                >
                  {isToday ? "сегодня" : formatDate(d)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  let rightInner: ReactNode;
  if (loading) {
    rightInner = <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">Загрузка...</div>;
  } else if (error) {
    rightInner = <div className="flex items-center justify-center h-32 text-[var(--danger)] text-sm">{error}</div>;
  } else if (!data || (data.total.viewCount === 0 && data.total.openCard === 0 && data.total.orders === 0)) {
    rightInner = <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">Нет данных за эту дату</div>;
  } else if (source === "traffic") {
    rightInner = <BuyerTrafficType data={data} totalData={data?.total || null} loading={false} error={null} />;
  } else if (source === "entry") {
    rightInner = <BuyerEntryPointsDetailed data={data} totalData={data?.total || null} loading={false} error={null} />;
  } else {
    rightInner = null; // WB — rendered below with full table
  }

  if (rightInner !== null || source !== "wb") {
    return (
      <div className="flex h-full overflow-hidden">
        {datesColumn}
        <div className="flex-1 overflow-hidden flex flex-col">
          {sourceToggle}
          <div className="flex-1 overflow-auto">{rightInner}</div>
        </div>
      </div>
    );
  }

  // WB source + data present below
  if (!data) return null;
  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  const pct = (a: number, b: number) => b > 0 ? Math.round((a / b) * 1000) / 10 : 0;

  return (
    <div className="flex h-full overflow-hidden">
      {datesColumn}
      <div className="flex-1 overflow-hidden flex flex-col">
      {sourceToggle}
      <div className="flex-1 overflow-auto">
      <table className="w-full border-collapse text-xs" style={{ tableLayout: "fixed" }}>
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="py-1.5 px-3 text-left text-[10px] font-semibold uppercase tracking-wide bg-[var(--bg-card)] border-b border-[var(--border)] text-[var(--text-muted)] w-[220px]">Источник</th>
            <th className="py-1.5 px-2 text-right text-[10px] font-semibold uppercase tracking-wide bg-[var(--bg-card)] border-b border-[var(--border)] text-[var(--text-muted)] w-[80px]">Показы</th>
            <th className="py-1.5 px-2 text-right text-[10px] font-semibold uppercase tracking-wide bg-[var(--bg-card)] border-b border-[var(--border)] text-[var(--text-muted)] w-[80px]">Переходы</th>
            <th className="py-1.5 px-2 text-right text-[10px] font-semibold uppercase tracking-wide bg-[var(--bg-card)] border-b border-[var(--border)] text-[var(--text-muted)] w-[55px]">CTR</th>
            <th className="py-1.5 px-2 text-right text-[10px] font-semibold uppercase tracking-wide bg-[var(--bg-card)] border-b border-[var(--border)] text-[var(--text-muted)] w-[80px]">Корзины</th>
            <th className="py-1.5 px-2 text-right text-[10px] font-semibold uppercase tracking-wide bg-[var(--bg-card)] border-b border-[var(--border)] text-[var(--text-muted)] w-[55px]">CR</th>
            <th className="py-1.5 px-2 text-right text-[10px] font-semibold uppercase tracking-wide bg-[var(--bg-card)] border-b border-[var(--border)] text-[var(--text-muted)] w-[70px]">Заказы</th>
            <th className="py-1.5 px-2 text-right text-[10px] font-semibold uppercase tracking-wide bg-[var(--bg-card)] border-b border-[var(--border)] text-[var(--text-muted)] w-[70px]">Доля</th>
            <th className="bg-[var(--bg-card)] border-b border-[var(--border)]" />
          </tr>
        </thead>
        <tbody>
          {/* Entry points */}
          {data.entryPoints
            .filter((ep) => ep.viewCount > 0 || ep.openCard > 0 || ep.orders > 0)
            .map((ep) => {
              const hasDetails = ep.detailedEntryPoints && ep.detailedEntryPoints.length > 1;
              const isExpanded = expanded.has(ep.name);
              const share = pct(ep.orders, data.total.orders);
              return (
                <Fragment key={ep.name}>
                  <tr
                    className={"border-b border-[var(--border)] bg-[var(--bg)] transition-colors " + (hasDetails ? "cursor-pointer hover:bg-[var(--bg-card-hover)]" : "")}
                    onClick={() => hasDetails && toggleExpand(ep.name)}
                  >
                    <td className="py-1.5 px-3 flex items-center gap-1.5">
                      {hasDetails && (
                        <svg className={`w-3 h-3 text-[var(--text-muted)] transition-transform shrink-0 ${isExpanded ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                      )}
                      {!hasDetails && <span className="w-3" />}
                      <span className="truncate">{ep.name}</span>
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">{fmtNum(ep.viewCount)}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{fmtNum(ep.openCard)}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{ep.CTR} %</td>
                    <td className="py-1.5 px-2 text-right font-mono">{fmtNum(ep.addToCart)}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{ep.openToCart} %</td>
                    <td className="py-1.5 px-2 text-right font-mono">{fmtNum(ep.orders)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-[var(--text-muted)]">{share} %</td>
                    <td className="bg-[var(--bg-card)]" />
                  </tr>
                  {isExpanded && ep.detailedEntryPoints
                    ?.filter((d) => d.viewCount > 0 || d.openCard > 0 || d.orders > 0)
                    .map((d) => (
                      <tr key={d.name} className="border-b border-[var(--border)] bg-[var(--bg)]">
                        <td className="py-1 px-3 pl-8 text-[var(--text-muted)] truncate">{d.name}</td>
                        <td className="py-1 px-2 text-right font-mono text-[var(--text-muted)]">{fmtNum(d.viewCount)}</td>
                        <td className="py-1 px-2 text-right font-mono text-[var(--text-muted)]">{fmtNum(d.openCard)}</td>
                        <td className="py-1 px-2 text-right font-mono text-[var(--text-muted)]">{d.CTR} %</td>
                        <td className="py-1 px-2 text-right font-mono text-[var(--text-muted)]">{fmtNum(d.addToCart)}</td>
                        <td className="py-1 px-2 text-right font-mono text-[var(--text-muted)]">{d.openToCart} %</td>
                        <td className="py-1 px-2 text-right font-mono text-[var(--text-muted)]">{fmtNum(d.orders)}</td>
                        <td className="py-1 px-2 text-right font-mono text-[var(--text-muted)]">{pct(d.orders, data.total.orders)} %</td>
                        <td className="bg-[var(--bg-card)]" />
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          {/* Total row */}
          <tr className="bg-[var(--bg)] font-semibold">
            <td className="py-1.5 px-3 border-t-2 border-[var(--accent)]/30">Итого</td>
            <td className="py-1.5 px-2 text-right font-mono border-t-2 border-[var(--accent)]/30">{fmtNum(data.total.viewCount)}</td>
            <td className="py-1.5 px-2 text-right font-mono border-t-2 border-[var(--accent)]/30">{fmtNum(data.total.openCard)}</td>
            <td className="py-1.5 px-2 text-right font-mono border-t-2 border-[var(--accent)]/30">{data.total.CTR} %</td>
            <td className="py-1.5 px-2 text-right font-mono border-t-2 border-[var(--accent)]/30">{fmtNum(data.total.addToCart)}</td>
            <td className="py-1.5 px-2 text-right font-mono border-t-2 border-[var(--accent)]/30">{data.total.openToCart} %</td>
            <td className="py-1.5 px-2 text-right font-mono border-t-2 border-[var(--accent)]/30">{fmtNum(data.total.orders)}</td>
            <td className="py-1.5 px-2 text-right font-mono border-t-2 border-[var(--accent)]/30">100 %</td>
            <td className="bg-[var(--bg-card)]" />
          </tr>
        </tbody>
      </table>
      </div>
      </div>
    </div>
  );
}

// ═══ Traffic Type (aggregated by group) ═══

function BuyerTrafficType({ data, totalData, loading, error }: {
  data: EntryPointsData | null;
  totalData: EntryPointsData["total"] | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) return <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">Загрузка...</div>;
  if (error) return <div className="flex items-center justify-center h-32 text-[var(--danger)] text-sm">{error}</div>;
  if (!data || !totalData) return null;

  // Aggregate entry points by group
  const groupData = new Map<string, { views: number; openCard: number; addToCart: number; orders: number }>();
  for (const ep of data.entryPoints) {
    const group = GROUP_MAP[ep.name] || "Прочее";
    const ex = groupData.get(group);
    if (ex) {
      ex.views += ep.viewCount;
      ex.openCard += ep.openCard;
      ex.addToCart += ep.addToCart;
      ex.orders += ep.orders;
    } else {
      groupData.set(group, { views: ep.viewCount, openCard: ep.openCard, addToCart: ep.addToCart, orders: ep.orders });
    }
  }

  const GROUP_ORDER = ["Поиск", "Полки", "Прочее", "Каталог", "По ссылке"];
  const groups = [...groupData.entries()]
    .filter(([, g]) => g.views > 0 || g.openCard > 0)
    .sort((a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0]));

  const tv = totalData.viewCount;
  const tc = totalData.openCard;
  const tCart = totalData.addToCart;
  const tOrd = totalData.orders;
  const pct = (a: number, b: number) => b > 0 ? (a / b * 100).toFixed(2) : "0";

  const thCls = "py-1.5 px-2 text-right text-[10px] font-semibold uppercase tracking-wide bg-[var(--bg-card)] border-b border-[var(--border)] text-[var(--text-muted)] whitespace-nowrap";
  const tdCls = "py-1.5 px-2 text-right font-mono whitespace-nowrap";

  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className={thCls + " text-left w-[120px]"}>Группа</th>
            <th className={thCls + " w-[70px]"}>CRO</th>
            <th className={thCls + " w-[70px]"}>CRF</th>
            <th className={thCls + " w-[80px]"}>Показы</th>
            <th className={thCls + " w-[60px]"}>Доля</th>
            <th className={thCls + " w-[75px]"}>Переходы</th>
            <th className={thCls + " w-[60px]"}>Доля</th>
            <th className={thCls + " w-[55px]"}>CTR</th>
            <th className={thCls + " w-[60px]"}>Корз.</th>
            <th className={thCls + " w-[55px]"}>Доля</th>
            <th className={thCls + " w-[65px]"}>CR корз.</th>
            <th className={thCls + " w-[60px]"}>Заказы</th>
            <th className={thCls + " w-[55px]"}>Доля</th>
            <th className={thCls + " w-[75px]"}>CR зак.</th>
            <th className="bg-[var(--bg-card)] border-b border-[var(--border)]" />
          </tr>
        </thead>
        <tbody>
          {groups.map(([group, g]) => {
            const groupStyle = GROUP_COLORS[group] || GROUP_COLORS["Прочее"];
            const cro = g.openCard > 0 ? (g.orders / g.openCard * 100).toFixed(2) : "0";
            const crf = g.views > 0 ? (g.orders / g.views * 100).toFixed(2) : "0";
            const ctr = g.views > 0 ? (g.openCard / g.views * 100).toFixed(2) : "0";
            const crCart = g.openCard > 0 ? (g.addToCart / g.openCard * 100).toFixed(2) : "0";
            const crOrd = g.addToCart > 0 ? (g.orders / g.addToCart * 100).toFixed(2) : "0";

            return (
              <tr key={group} className="border-b border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--bg-card-hover)] transition-colors">
                <td className="py-1.5 px-2 text-left">
                  <span className={`text-[10px] px-2 py-0.5 rounded ${groupStyle}`}>{group}</span>
                </td>
                <td className={tdCls}>{cro}%</td>
                <td className={tdCls}>{crf}%</td>
                <td className={tdCls}>{fmtNum(g.views)}</td>
                <td className={tdCls + " text-[var(--text-muted)]"}>{pct(g.views, tv)}%</td>
                <td className={tdCls}>{fmtNum(g.openCard)}</td>
                <td className={tdCls + " text-[var(--text-muted)]"}>{pct(g.openCard, tc)}%</td>
                <td className={tdCls}>{ctr}%</td>
                <td className={tdCls}>{fmtNum(g.addToCart)}</td>
                <td className={tdCls + " text-[var(--text-muted)]"}>{pct(g.addToCart, tCart)}%</td>
                <td className={tdCls}>{crCart}%</td>
                <td className={tdCls + " font-semibold"}>{fmtNum(g.orders)}</td>
                <td className={tdCls + " text-[var(--text-muted)]"}>{pct(g.orders, tOrd)}%</td>
                <td className={tdCls}>{crOrd}%</td>
                <td className="bg-[var(--bg-card)]" />
              </tr>
            );
          })}
          {/* Total */}
          {(() => { const bt = " border-t-2 border-[var(--accent)]/30"; return (
          <tr className="bg-[var(--bg)] font-semibold">
            <td className={"py-1.5 px-2 text-left" + bt}>Итого</td>
            <td className={tdCls + bt}>{tc > 0 ? (tOrd / tc * 100).toFixed(2) : 0}%</td>
            <td className={tdCls + bt}>{tv > 0 ? (tOrd / tv * 100).toFixed(2) : 0}%</td>
            <td className={tdCls + bt}>{fmtNum(tv)}</td>
            <td className={tdCls + " text-[var(--text-muted)]" + bt}>100%</td>
            <td className={tdCls + bt}>{fmtNum(tc)}</td>
            <td className={tdCls + " text-[var(--text-muted)]" + bt}>100%</td>
            <td className={tdCls + bt}>{totalData.CTR}%</td>
            <td className={tdCls + bt}>{fmtNum(tCart)}</td>
            <td className={tdCls + " text-[var(--text-muted)]" + bt}>100%</td>
            <td className={tdCls + bt}>{tc > 0 ? (tCart / tc * 100).toFixed(2) : 0}%</td>
            <td className={tdCls + " font-semibold" + bt}>{fmtNum(tOrd)}</td>
            <td className={tdCls + " text-[var(--text-muted)]" + bt}>100%</td>
            <td className={tdCls + bt}>{tCart > 0 ? (tOrd / tCart * 100).toFixed(2) : 0}%</td>
            <td className="bg-[var(--bg-card)]" />
          </tr>); })()}
        </tbody>
      </table>
    </div>
  );
}

// ═══ Entry Points Detailed (by group) ═══

const GROUP_MAP: Record<string, string> = {
  "Карточка товара": "Полки",
  "Главная страница": "Полки",
  "Поиск": "Поиск",
  "Каталог": "Каталог",
  "Переходы по ссылке": "По ссылке",
  "Специальные акции": "Прочее",
  "Экран оплаты": "Прочее",
  "Профиль покупателя": "Прочее",
  "Разное": "Прочее",
  "Корзина": "Прочее",
  "Пуш-уведомления": "Прочее",
  "Карусель «Вы недавно смотрели»": "Прочее",
  "Похожие товары": "Прочее",
  "Страница бренда": "Прочее",
  "Страница магазина": "Прочее",
  "Страница «Для бизнеса»": "Прочее",
  "Приложение Wibes": "Прочее",
  "Другое": "Прочее",
};

const GROUP_COLORS: Record<string, string> = {
  "Полки": "bg-orange-400/20 text-orange-300",
  "Поиск": "bg-yellow-400/20 text-yellow-300",
  "Прочее": "bg-gray-400/20 text-gray-300",
  "Каталог": "bg-blue-400/20 text-blue-300",
  "По ссылке": "bg-red-400/20 text-red-300",
};

function BuyerEntryPointsDetailed({ data, totalData, loading, error }: {
  data: EntryPointsData | null;
  totalData: EntryPointsData["total"] | null;
  loading: boolean;
  error: string | null;
}) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  if (loading) return <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">Загрузка...</div>;
  if (error) return <div className="flex items-center justify-center h-32 text-[var(--danger)] text-sm">{error}</div>;
  if (!data || !totalData) return null;

  function toggleRow(name: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  const pct = (a: number, b: number) => b > 0 ? (a / b * 100).toFixed(2) : "0";
  const pct1 = (a: number, b: number) => b > 0 ? (a / b * 100).toFixed(1) : "0";
  const tv = totalData.viewCount;
  const tc = totalData.openCard;
  const tCart = totalData.addToCart;
  const tOrd = totalData.orders;

  const thCls = "py-1.5 px-2 text-right text-[10px] font-semibold uppercase tracking-wide bg-[var(--bg-card)] border-b border-[var(--border)] text-[var(--text-muted)] whitespace-nowrap";
  const tdCls = "py-1 px-2 text-right font-mono whitespace-nowrap";

  const entries = data.entryPoints.filter((ep) => ep.viewCount > 0 || ep.openCard > 0 || ep.orders > 0);

  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className={thCls + " text-left w-[160px]"}>Точки входа</th>
            <th className={thCls + " w-[70px]"}>Группа</th>
            <th className={thCls + " w-[65px]"}>CRO</th>
            <th className={thCls + " w-[65px]"}>CRF</th>
            <th className={thCls + " w-[70px]"}>Показы</th>
            <th className={thCls + " w-[55px]"}>Доля</th>
            <th className={thCls + " w-[70px]"}>Переходы</th>
            <th className={thCls + " w-[55px]"}>Доля</th>
            <th className={thCls + " w-[50px]"}>CTR</th>
            <th className={thCls + " w-[55px]"}>Корз.</th>
            <th className={thCls + " w-[50px]"}>Доля</th>
            <th className={thCls + " w-[60px]"}>CR корз.</th>
            <th className={thCls + " w-[55px]"}>Заказы</th>
            <th className={thCls + " w-[50px]"}>Доля</th>
            <th className={thCls + " w-[65px]"}>CR зак.</th>
            <th className="bg-[var(--bg-card)] border-b border-[var(--border)]" />
          </tr>
        </thead>
        <tbody>
          {entries.map((ep) => {
            const group = GROUP_MAP[ep.name] || "Прочее";
            const groupStyle = GROUP_COLORS[group] || GROUP_COLORS["Прочее"];
            const hasDetails = ep.detailedEntryPoints && ep.detailedEntryPoints.length > 1;
            const isExpanded = expandedRows.has(ep.name);
            const cro = ep.openCard > 0 ? (ep.orders / ep.openCard * 100).toFixed(2) : "";
            const crf = ep.viewCount > 0 ? (ep.orders / ep.viewCount * 100).toFixed(2) : "";
            const crCart = ep.openCard > 0 ? (ep.addToCart / ep.openCard * 100).toFixed(2) : "";
            const crOrd = ep.addToCart > 0 ? (ep.orders / ep.addToCart * 100).toFixed(2) : "";

            return (
              <Fragment key={ep.name}>
                <tr
                  className={"border-b border-[var(--border)] bg-[var(--bg)] transition-colors " + (hasDetails ? "cursor-pointer hover:bg-[var(--bg-card-hover)]" : "")}
                  onClick={() => hasDetails && toggleRow(ep.name)}
                >
                  <td className="py-1 px-2 text-left flex items-center gap-1.5">
                    {hasDetails && (
                      <svg className={`w-3 h-3 text-[var(--text-muted)] transition-transform shrink-0 ${isExpanded ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    )}
                    {!hasDetails && <span className="w-3" />}
                    <span className="truncate">{ep.name}</span>
                  </td>
                  <td className="py-1 px-2 text-center">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${groupStyle}`}>{group}</span>
                  </td>
                  <td className={tdCls}>{cro ? cro + "%" : "—"}</td>
                  <td className={tdCls}>{crf ? crf + "%" : "—"}</td>
                  <td className={tdCls}>{fmtNum(ep.viewCount)}</td>
                  <td className={tdCls + " text-[var(--text-muted)]"}>{pct(ep.viewCount, tv)}%</td>
                  <td className={tdCls}>{fmtNum(ep.openCard)}</td>
                  <td className={tdCls + " text-[var(--text-muted)]"}>{pct(ep.openCard, tc)}%</td>
                  <td className={tdCls}>{ep.CTR}%</td>
                  <td className={tdCls}>{fmtNum(ep.addToCart)}</td>
                  <td className={tdCls + " text-[var(--text-muted)]"}>{pct(ep.addToCart, tCart)}%</td>
                  <td className={tdCls}>{crCart ? crCart + "%" : "—"}</td>
                  <td className={tdCls + " font-semibold"}>{fmtNum(ep.orders)}</td>
                  <td className={tdCls + " text-[var(--text-muted)]"}>{pct(ep.orders, tOrd)}%</td>
                  <td className={tdCls}>{crOrd ? crOrd + "%" : "—"}</td>
                  <td className="bg-[var(--bg-card)]" />
                </tr>
                {isExpanded && ep.detailedEntryPoints
                  ?.filter((d) => d.viewCount > 0 || d.openCard > 0 || d.orders > 0)
                  .map((d) => {
                    const dCro = d.openCard > 0 ? (d.orders / d.openCard * 100).toFixed(2) : "";
                    const dCrf = d.viewCount > 0 ? (d.orders / d.viewCount * 100).toFixed(2) : "";
                    const dCrCart = d.openCard > 0 ? (d.addToCart / d.openCard * 100).toFixed(2) : "";
                    const dCrOrd = d.addToCart > 0 ? (d.orders / d.addToCart * 100).toFixed(2) : "";
                    return (
                      <tr key={d.name} className="border-b border-[var(--border)] bg-[var(--bg)]">
                        <td className="py-1 px-2 pl-8 text-left text-[var(--text-muted)] truncate">{d.name}</td>
                        <td />
                        <td className={tdCls + " text-[var(--text-muted)]"}>{dCro ? dCro + "%" : ""}</td>
                        <td className={tdCls + " text-[var(--text-muted)]"}>{dCrf ? dCrf + "%" : ""}</td>
                        <td className={tdCls + " text-[var(--text-muted)]"}>{fmtNum(d.viewCount)}</td>
                        <td className={tdCls + " text-[var(--text-muted)]"}>{pct(d.viewCount, tv)}%</td>
                        <td className={tdCls + " text-[var(--text-muted)]"}>{fmtNum(d.openCard)}</td>
                        <td className={tdCls + " text-[var(--text-muted)]"}>{pct(d.openCard, tc)}%</td>
                        <td className={tdCls + " text-[var(--text-muted)]"}>{d.CTR}%</td>
                        <td className={tdCls + " text-[var(--text-muted)]"}>{fmtNum(d.addToCart)}</td>
                        <td className={tdCls + " text-[var(--text-muted)]"}>{pct(d.addToCart, tCart)}%</td>
                        <td className={tdCls + " text-[var(--text-muted)]"}>{dCrCart ? dCrCart + "%" : ""}</td>
                        <td className={tdCls + " text-[var(--text-muted)]"}>{fmtNum(d.orders)}</td>
                        <td className={tdCls + " text-[var(--text-muted)]"}>{pct(d.orders, tOrd)}%</td>
                        <td className={tdCls + " text-[var(--text-muted)]"}>{dCrOrd ? dCrOrd + "%" : ""}</td>
                        <td className="bg-[var(--bg-card)]" />
                      </tr>
                    );
                  })}
              </Fragment>
            );
          })}
          {/* Total row */}
          {(() => { const bt = " border-t-2 border-[var(--accent)]/30"; return (
          <tr className="bg-[var(--bg)] font-semibold">
            <td className={"py-1.5 px-2 text-left" + bt} colSpan={2}>Итого</td>
            <td className={tdCls + bt}>{tc > 0 ? (tOrd / tc * 100).toFixed(2) : 0}%</td>
            <td className={tdCls + bt}>{tv > 0 ? (tOrd / tv * 100).toFixed(2) : 0}%</td>
            <td className={tdCls + bt}>{fmtNum(tv)}</td>
            <td className={tdCls + " text-[var(--text-muted)]" + bt}>100%</td>
            <td className={tdCls + bt}>{fmtNum(tc)}</td>
            <td className={tdCls + " text-[var(--text-muted)]" + bt}>100%</td>
            <td className={tdCls + bt}>{totalData.CTR}%</td>
            <td className={tdCls + bt}>{fmtNum(tCart)}</td>
            <td className={tdCls + " text-[var(--text-muted)]" + bt}>100%</td>
            <td className={tdCls + bt}>{tc > 0 ? (tCart / tc * 100).toFixed(2) : 0}%</td>
            <td className={tdCls + " font-semibold" + bt}>{fmtNum(tOrd)}</td>
            <td className={tdCls + " text-[var(--text-muted)]" + bt}>100%</td>
            <td className={tdCls + bt}>{tCart > 0 ? (tOrd / tCart * 100).toFixed(2) : 0}%</td>
            <td className="bg-[var(--bg-card)]" />
          </tr>); })()}
        </tbody>
      </table>
    </div>
  );
}

// ═══ Product Card (left side) ═══

function ProductCard({ product }: { product: DashboardProduct }) {
  const [imgIdx, setImgIdx] = useState(0);
  const imgUrls = useMemo(
    () => getWbImageCandidateUrls(product.nmId, "medium").map((url) => withImageVersion(url, product.updatedAt)),
    [product.nmId, product.updatedAt],
  );
  const imgUrl = imgUrls[imgIdx] || null;

  useEffect(() => {
    setImgIdx(0);
  }, [product.nmId, product.updatedAt]);

  return (
    <div className="h-full overflow-y-auto p-4">
      {/* Large photo */}
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

      {/* Title */}
      <div className="text-sm font-semibold mb-2">{product.title}</div>

      {/* Info */}
      <div className="space-y-1.5 text-xs">
        <div>
          <span className="text-[var(--text-muted)]">Артикул WB: </span>
          <span className="font-mono">{product.nmId}</span>
        </div>
        {product.vendorCode && (
          <div>
            <span className="text-[var(--text-muted)]">Артикул продавца: </span>
            <span className="font-mono">{product.vendorCode}</span>
          </div>
        )}
        {product.subject && (
          <div>
            <span className="text-[var(--text-muted)]">Предмет: </span>
            <span>{product.subject}</span>
          </div>
        )}
        {product.colors && (
          <div>
            <span className="text-[var(--text-muted)]">Цвета: </span>
            <span>{product.colors}</span>
          </div>
        )}
        {product.rating && (
          <div>
            <span className="text-yellow-400">★</span> {product.rating.toFixed(1)}
          </div>
        )}
        {(product.priceFrom || product.deliveryPrice) && (
          <div>
            <span className="text-[var(--text-muted)]">Цена: </span>
            <span>
              {product.priceFrom && product.priceTo && product.priceTo > product.priceFrom
                ? `${fmtNum(product.priceFrom)}–${fmtNum(product.priceTo)} ₽`
                : fmtRub(product.priceFrom || product.deliveryPrice!)}
            </span>
          </div>
        )}
        <div>
          <span className="text-[var(--text-muted)]">Остаток: </span>
          <span>{fmtNum(product.stockQty)} шт.</span>
        </div>
      </div>
    </div>
  );
}

// ═══ Vertical Divider ═══

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

// ═══ Main Detail Panel ═══

export default function DetailPanel({
  product,
  days,
  offset: dayOffset = 0,
  refreshKey = 0,
  onClearProduct,
}: {
  product: DashboardProduct | null;
  days: number;
  offset?: number;
  refreshKey?: number;
  onClearProduct?: () => void;
}) {
  const [rows, setRows] = useState<DayRow[]>([]);
  const [buyoutPct30, setBuyoutPct30] = useState<number>(0);
  const [buyoutUpdatedAt, setBuyoutUpdatedAt] = useState<string | null>(null);
  const [tab, setTab] = useState("daily");
  const [loading, setLoading] = useState(false);
  const [leftWidth, setLeftWidth] = useState(220);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<number>(0);
  const [syncAgoText, setSyncAgoText] = useState("");
  const [syncTimeText, setSyncTimeText] = useState("");
  const wholeShop = !product;
  const [hiddenCols, setHiddenCols] = useState<string[]>([]);
  const [colSettingsOpen, setColSettingsOpen] = useState(false);
  const colSettingsRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Column order & widths
  const defaultOrder = COLS.map((c) => c.key);
  const [colOrder, setColOrder] = useState<string[]>(defaultOrder);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [colSettingsReady, setColSettingsReady] = useState(false);
  const dragKey = useRef<string | null>(null);
  const resizeKey = useRef<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Load column settings on mount
  useEffect(() => {
    let alive = true;
    Promise.all([
      loadDetailColWidths(),
      loadDetailColOrder(),
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
        const cpsIdx = result.indexOf("cps");
        const cpoIdx = result.indexOf("cpo");
        if (cpsIdx !== -1 && cpoIdx !== -1 && cpsIdx < cpoIdx) {
          [result[cpsIdx], result[cpoIdx]] = [result[cpoIdx], result[cpsIdx]];
        }
        setColOrder(result);
      }
      if (s.detail_col_hidden) setHiddenCols(JSON.parse(s.detail_col_hidden));
    }).catch(() => {}).finally(() => {
      if (alive) setColSettingsReady(true);
    });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close column settings on click outside
  useEffect(() => {
    if (!colSettingsOpen) return;
    function handleClick(e: MouseEvent) {
      if (colSettingsRef.current && !colSettingsRef.current.contains(e.target as Node)) setColSettingsOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [colSettingsOpen]);

  function toggleCol(key: string) {
    if (key === "date") return; // don't allow hiding date
    const next = hiddenCols.includes(key) ? hiddenCols.filter((k) => k !== key) : [...hiddenCols, key];
    setHiddenCols(next);
    saveSetting("detail_col_hidden", JSON.stringify(next));
  }

  function resetHiddenCols() {
    setHiddenCols([]);
    saveSetting("detail_col_hidden", "[]");
  }

  const prevProductRef = useRef<number | null>(null);

  useEffect(() => {
    // Show loading only on first load or product/mode change, not on silent refresh
    const currentKey = product?.nmId ?? null;
    const isNewProduct = prevProductRef.current !== currentKey;
    if (isNewProduct) setLoading(true);
    prevProductRef.current = currentKey;

    const url = wholeShop
      ? `/api/product-detail?nmId=all&days=90`
      : `/api/product-detail?nmId=${product!.nmId}&days=90`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        setRows(d.rows || []);
        setBuyoutPct30(Number(d.buyoutPct30) || 0);
        setBuyoutUpdatedAt(d.buyoutUpdatedAt || null);
      })
      .finally(() => setLoading(false));
  }, [product?.nmId, days, wholeShop, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Read last_sync_time from settings and update "ago" text
  useEffect(() => {
    function update() {
      fetch("/api/settings").then((r) => r.json()).then((s) => {
        const t = Number(s.last_sync_time) || 0;
        if (t > 0) {
          setLastSyncTime(t);
          const d = new Date(t);
          setSyncTimeText(d.toTimeString().slice(0, 5));
          const sec = Math.floor((Date.now() - t) / 1000);
          if (sec < 60) setSyncAgoText("только что");
          else if (sec < 3600) setSyncAgoText(`${Math.floor(sec / 60)} мин.`);
          else setSyncAgoText(`${Math.floor(sec / 3600)} ч.`);
        }
      }).catch(() => {});
    }
    update();
    const iv = setInterval(update, 15000);
    return () => clearInterval(iv);
  }, []);

  // Debounced save widths
  function debouncedSaveWidths(w: Record<string, number>) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveSetting("detail_col_widths", JSON.stringify(w)), 500);
  }

  // Column resize
  const handleResizeStart = useCallback((key: string, startX: number) => {
    resizeKey.current = key;
    resizeStartX.current = startX;
    resizeStartW.current = colWidths[key] || DEFAULT_W[key] || 60;

    const onMouseMove = (e: MouseEvent) => {
      if (!resizeKey.current) return;
      const diff = e.clientX - resizeStartX.current;
      const newW = Math.max(30, Math.min(300, resizeStartW.current + diff));
      setColWidths((prev) => ({ ...prev, [resizeKey.current!]: newW }));
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      resizeKey.current = null;
      setColWidths((prev) => { debouncedSaveWidths(prev); return prev; });
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [colWidths]); // eslint-disable-line react-hooks/exhaustive-deps

  // Column drag-n-drop
  function handleDragStart(key: string) { dragKey.current = key; }
  function handleDragOver(e: React.DragEvent) { e.preventDefault(); }
  function handleDrop(targetKey: string) {
    const srcKey = dragKey.current;
    if (!srcKey || srcKey === targetKey) return;
    setColOrder((prev) => {
      const newOrder = [...prev];
      const srcIdx = newOrder.indexOf(srcKey);
      const tgtIdx = newOrder.indexOf(targetKey);
      if (srcIdx === -1 || tgtIdx === -1) return prev;
      newOrder.splice(srcIdx, 1);
      newOrder.splice(tgtIdx, 0, srcKey);
      saveSetting("detail_col_order", JSON.stringify(newOrder));
      return newOrder;
    });
    dragKey.current = null;
  }

  const colMap = new Map(COLS.map((c) => [c.key, c]));

  // Динамическая надпись для tooltip ДРРп: показываем 30-дневный % выкупа и дату обновления.
  const buyoutTooltipSuffix = (() => {
    if (buyoutPct30 > 0) {
      let updated = "";
      if (buyoutUpdatedAt) {
        const d = new Date(buyoutUpdatedAt.replace(" ", "T") + "Z");
        const months = ["янв","февр","мар","апр","мая","июн","июл","авг","сент","окт","нояб","дек"];
        updated = ` · обновлено ${d.getDate()} ${months[d.getMonth()]}`;
      }
      return `\n\nВыкуп 30д: ${buyoutPct30.toString().replace(".", ",")}%${updated}`;
    }
    return "\n\nВыкуп 30д: — (синк buyout-percent ещё не отработал по этому товару)";
  })();

  const handleDividerMouseDown = useCallback(() => {
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newW = e.clientX - rect.left;
      setLeftWidth(Math.max(120, Math.min(500, newW)));
    };
    const onMouseUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  const tabs = [
    { key: "daily", label: "Воронка продаж", enabled: true },
    { key: "buyer", label: "Портрет покупателя", enabled: true },
    { key: "stocks", label: "Остатки", enabled: false },
    { key: "catalogs", label: "Каталоги", enabled: false },
    { key: "queries", label: "Запросы", enabled: false },
  ];

  return (
    <div ref={containerRef} className="flex h-full overflow-hidden">
      {/* Left — Product Card (only when a specific product is selected) */}
      {product && (
        <>
          <div style={{ width: leftWidth }} className="shrink-0 overflow-hidden border-r border-[var(--border)]">
            <ProductCard product={product} />
          </div>
          <VerticalDivider onMouseDown={handleDividerMouseDown} />
        </>
      )}

      {/* Right — Tabs + Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tabs header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] shrink-0">
          {tabs.map((t) => {
            if (!t.enabled) {
              return (
                <button
                  key={t.key}
                  disabled
                  className="px-3 py-1 text-xs rounded-lg border border-[var(--border)] text-[var(--text-muted)] opacity-40 cursor-not-allowed"
                >
                  {t.label}
                </button>
              );
            }
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={
                  "px-3 py-1 text-xs rounded-lg border transition-colors " +
                  (tab === t.key
                    ? "bg-[var(--accent)]/20 text-[var(--accent)] border-[var(--accent)]"
                    : "text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text)]")
                }
              >
                {t.label}
              </button>
            );
          })}

          {/* Last sync time */}
          {lastSyncTime > 0 && (
            <Tooltip text={`Последний синк в ${syncTimeText}`}>
              <span className="text-[10px] text-[var(--text-muted)] ml-1 flex items-center gap-1 cursor-default">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="rgba(250, 204, 21, 0.6)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
                <span>{syncAgoText}</span>
              </span>
            </Tooltip>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Checkboxes */}
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
            <input type="checkbox" disabled className="accent-[var(--accent)] w-3 h-3 opacity-40" />
            <span className="opacity-40">вся склейка</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
            <input
              type="checkbox"
              checked={wholeShop}
              onChange={(e) => {
                if (e.target.checked && product) onClearProduct?.();
              }}
              className="accent-[var(--accent)] w-3 h-3"
            />
            весь магазин
          </label>

          {/* Column visibility settings */}
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
              <div className="fixed p-2 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl min-w-[180px] max-h-[400px] overflow-y-auto z-[100]" style={{ top: colSettingsRef.current ? colSettingsRef.current.getBoundingClientRect().bottom + 4 : 0, right: 8 }}>
                <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide px-2 py-1 mb-1">Столбцы</div>
                {COLS.map((col) => {
                  const isHidden = hiddenCols.includes(col.key);
                  const isLocked = col.key === "date";
                  const name = typeof col.label === "string" ? col.label : colLabelText(col.key);
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
                      <span className={isHidden ? "text-[var(--text-muted)]" : "text-[var(--text)]"}>
                        {name}
                      </span>
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

        {/* Tab content */}
        <div className="flex-1 overflow-auto">
          {tab === "daily" && (
            loading || !colSettingsReady ? (
              <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">Загрузка...</div>
            ) : (
              <table className="w-full border-collapse text-xs" style={{ tableLayout: "fixed" }}>
                <thead className="sticky top-0 z-10">
                  <tr>
                    {colOrder.filter((k) => !hiddenCols.includes(k)).map((key) => {
                      const col = colMap.get(key);
                      if (!col) return null;
                      const w = colWidths[key] || DEFAULT_W[key] || 60;
                      return (
                        <th
                          key={key}
                          draggable
                          onDragStart={(e) => {
                            handleDragStart(key);
                            // Custom drag image: only this column header
                            const el = e.currentTarget.cloneNode(true) as HTMLElement;
                            el.style.position = "absolute";
                            el.style.top = "-9999px";
                            el.style.width = `${w}px`;
                            el.style.background = "var(--bg-card)";
                            el.style.opacity = "0.9";
                            el.style.borderRadius = "4px";
                            el.style.border = "1px solid var(--accent)";
                            document.body.appendChild(el);
                            e.dataTransfer.setDragImage(el, w / 2, 14);
                            requestAnimationFrame(() => document.body.removeChild(el));
                          }}
                          onDragOver={handleDragOver}
                          onDrop={() => handleDrop(key)}
                          className="relative py-1.5 px-2 text-center text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap bg-[var(--bg-card)] border-b border-[var(--border)] text-[var(--text-muted)] cursor-default select-none"
                          style={{ width: w, minWidth: 30, maxWidth: 300 }}
                        >
                          <span className="peer">{col.label}</span>
                          <div className="
                            invisible opacity-0 peer-hover:visible peer-hover:opacity-100
                            transition-all delay-250
                            absolute z-50 left-1/2 -translate-x-1/2 top-full mt-1
                            px-2.5 py-1.5 rounded-lg
                            bg-[var(--bg-card)] border border-[var(--accent)]/40 shadow-2xl
                            text-[10px] text-[var(--text-muted)] font-normal normal-case tracking-normal
                            whitespace-pre-wrap text-left min-w-[140px] max-w-[260px]
                            pointer-events-none
                          ">{key === "drrFull" ? col.tooltip + buyoutTooltipSuffix : col.tooltip}</div>
                          {/* Resize handle */}
                          <div
                            className="absolute top-0 -right-px w-[2px] h-full cursor-col-resize z-10 hover:bg-[var(--accent)]/40 transition-colors"
                            style={{ background: "rgba(255,255,255,0.06)" }}
                            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); handleResizeStart(key, e.clientX); }}
                          />
                        </th>
                      );
                    })}
                    <th className="bg-[var(--bg-card)] border-b border-[var(--border)]" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isEmpty = row.ordersCount === 0 && row.views === 0 && row.cartsTotal === 0 && row.adSpend === 0;
                    const isToday = row.date === localDateStr(new Date());
                    const isSelected = selectedDate === row.date;
                    const dayOfWeek = new Date(row.date + "T12:00:00").getDay(); // 0=Sun, 6=Sat
                    const isSaturday = dayOfWeek === 6;
                    const isSunday = dayOfWeek === 0;
                    return (
                      <tr
                        key={row.date}
                        onClick={() => setSelectedDate(isSelected ? null : row.date)}
                        className={
                          "border-b border-[var(--border)] cursor-pointer transition-colors " +
                          (isSelected
                            ? "bg-[var(--accent)]/25 "
                            : "bg-[var(--bg)] hover:bg-[var(--bg-card-hover)] ") +
                          (isEmpty && !isSelected && !isToday ? "opacity-40 " : "")
                        }
                        style={(isSaturday || isSunday) ? { borderLeft: "2px solid rgba(251, 191, 36, 0.5)" } : undefined}
                      >
                        {colOrder.filter((k) => !hiddenCols.includes(k)).map((key) => {
                          const col = colMap.get(key);
                          if (!col) return null;
                          const w = colWidths[key] || DEFAULT_W[key] || 60;
                          return (
                            <td
                              key={key}
                              className={
                                "py-1 px-2 whitespace-nowrap font-mono " +
                                (["adCarts", "adOrders", "assocCarts", "assocOrders", "sppAvg"].includes(key) ? "" : "overflow-hidden ") +
                                (col.align === "left" ? "text-left" : "text-right") +
                                (isToday && key === "date" ? " font-semibold text-[var(--accent)]" : "")
                              }
                              style={{
                                width: w, minWidth: 30, maxWidth: 300,
                                ...(key === "drr" ? { color: fmtDrr(row.adSpend, row.ordersSum).color } : {}),
                                ...(key === "drrFull" ? { color: fmtDrr(row.adSpend, row.ordersSum > 0 && buyoutPct30 > 0 ? Math.round(row.ordersSum * buyoutPct30 / 100) : 0).color } : {}),
                                ...((isSaturday || isSunday) && key === "date" && !isToday ? { color: "rgba(251, 191, 36, 0.8)" } : {}),
                              }}
                            >
                              {isToday && key === "date"
                                ? "Сегодня"
                                : key === "sppAvg"
                                  ? <SppCell row={row} />
                                  : (key === "adCarts" || key === "adOrders") && row.assocDetails.length > 0
                                    ? <AssocCell row={row} field={key as "adCarts" | "adOrders"} />
                                    : (key === "assocCarts" || key === "assocOrders") && row.assocOutDetails.length > 0
                                      ? <AssocOutCell row={row} field={key as "assocCarts" | "assocOrders"} />
                                      : cellValue(row, key)}
                            </td>
                          );
                        })}
                        <td className="border-b border-[var(--border)] bg-[var(--bg-card)]" />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          )}
          {tab === "stocks" && <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">Остатки — в разработке</div>}
          {tab === "catalogs" && <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">Каталоги — в разработке</div>}
          {tab === "queries" && <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">Запросы — в разработке</div>}
          {tab === "buyer" && <BuyerEntryPoints nmId={product?.nmId ?? 0} selectedDate={selectedDate} onSelectDate={setSelectedDate} />}
        </div>
      </div>
    </div>
  );
}
