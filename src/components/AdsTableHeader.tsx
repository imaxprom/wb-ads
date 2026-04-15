"use client";

import { useRef, useCallback, type ReactNode } from "react";
import type { SortState } from "@/types";
import Tooltip from "./Tooltip";
import { EyeIcon, CartIcon, BoxIcon } from "./icons";

export interface Col {
  key: string;
  label: ReactNode;
  tooltip: string;
  sortable: boolean;
  sticky?: boolean;
  defaultW: number;
  align?: "left" | "right" | "center";
}

export const COLUMNS: Col[] = [
  { key: "vendorCode", label: "Товар", tooltip: "Наименование товара\nКод товара WB    Артикул продавца\nВремя последнего редактирования карточки\n✏ время последнего изменения описания на сайте WB\n\nКлик по заголовку столбца — вкл/выкл сортировка по артикулу", sortable: true, sticky: true, defaultW: 260 },
  { key: "subject", label: "Предмет", tooltip: "Категория товара", sortable: false, defaultW: 80 },
  { key: "colors", label: "Цвета", tooltip: "Цвета товара", sortable: false, defaultW: 80 },
  { key: "labels", label: "Акции", tooltip: "Текущая акция на товаре\nНазвание акции, если товар участвует", sortable: false, defaultW: 70 },
  { key: "feedbacks", label: "★", tooltip: "★ — Рейтинг и кол-во оценок товара\n\nКлик по заголовку столбца — вкл/выкл сортировка по кол-ву оценок", sortable: true, defaultW: 55, align: "right" },
  { key: "deliveryPrice", label: "Цена", tooltip: "Цена поставки\n(либо базовая, если нет доступа к ценам)\n\nСкидка WB \"СПП\"\n(если есть доступ к инф. о ценах)\n\nЦена покупателю\n(с WB кошельком 2%, если применимо)", sortable: false, defaultW: 85, align: "right" },
  { key: "stockValue", label: "Остаток", tooltip: "Остаток всего, шт.\n\nКлик по заголовку столбца — вкл/выкл сортировка по остатку", sortable: true, defaultW: 80, align: "right" },
  { key: "ordersSum", label: <span className="inline-flex items-center gap-1"><EyeIcon className="w-3.5 h-3.5" /><CartIcon className="w-3.5 h-3.5" /><BoxIcon className="w-3.5 h-3.5" /></span>, tooltip: "Воронка продаж (гибрид: MAX из открытого и закрытого API)\n\nПоказы — показы карточки в выдаче (из закрытого API Джем)\nКорзины — добавления в корзину (общие: орг. + рекл.)\nЗаказы — заказы, шт.\nСумма заказов — по ценам поставки\nВыкупы — выкупленные заказы (из закрытого API Джем)\n\nКлик — сортировка по Сумме Заказов", sortable: true, defaultW: 130, align: "right" },
  { key: "drr", label: "ДРРз", tooltip: "Доля рекламных расходов по отношению к сумме всех заказов\nдля значений меньше 1% ведущий 0 'целых' не показывается\n# % — нет заказов, хотя есть расход по рекламе\n~ — сильно меньше 0,1 %", sortable: false, defaultW: 55, align: "right" },
  { key: "adSpend", label: "Затраты рекл.", tooltip: "Корзины и заказы с рекламы и их \"рекламная\" себестоимость\nЗатраты на рекламу\n(расчёт по сумме начислений за рекламу)\n\nКлик по заголовку столбца — вкл/выкл сортировка по сумме Затрат", sortable: true, defaultW: 140, align: "right" },
  { key: "autoSpend", label: "Авто", tooltip: "Наличие автоматической кампании\n(единая ставка)\n\nКлик по заголовку столбца — вкл/выкл сортировка\n(по статусу и расходу кампании)", sortable: true, defaultW: 145, align: "right" },
  { key: "searchSpend", label: "Аукцион", tooltip: "Наличие кампании Аукцион\n(ручная ставка, кроме CPC)\n\nКлик по заголовку столбца — вкл/выкл сортировка\n(по статусу и расходу кампании)", sortable: true, defaultW: 145, align: "right" },
  { key: "cpcSpend", label: "CPC", tooltip: "Наличие кампании Аукцион CPC (оплата за клик)\n\nКлик по заголовку столбца — вкл/выкл сортировка\n(по статусу и расходу кампании)", sortable: true, defaultW: 145, align: "right" },
  { key: "queriesCount", label: "Видимость", tooltip: "Каталоги и запросы (кластеры) \"зацепившие\" карточку\n(количество активных запросов абсолютно всё не посчитать,\nэто оценка относительно других товаров в категории)\n\nКлик по заголовку столбца — вкл/выкл сортировка\n(по кол-ву активных запросов на карточке)", sortable: true, defaultW: 90, align: "right" },
];

function SortArrow({ dir }: { dir: "asc" | "desc" | null }) {
  if (!dir) return null;
  return <span className="ml-1 text-[var(--accent)]">{dir === "desc" ? "↓" : "↑"}</span>;
}

export default function AdsTableHeader({
  sort,
  onSort,
  columnOrder,
  columnWidths,
  onDragStart,
  onDragOver,
  onDrop,
  onResizeStart,
}: {
  sort: SortState;
  onSort: (col: string) => void;
  columnOrder: string[];
  columnWidths: Record<string, number>;
  onDragStart: (key: string) => void;
  onDragOver: (e: React.DragEvent, key: string) => void;
  onDrop: (key: string) => void;
  onResizeStart: (key: string, startX: number) => void;
}) {
  const colMap = new Map(COLUMNS.map((c) => [c.key, c]));
  const resizing = useRef(false);

  const handleResizeMouseDown = useCallback(
    (key: string, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      resizing.current = true;
      onResizeStart(key, e.clientX);
    },
    [onResizeStart]
  );

  return (
    <tr>
      {columnOrder.map((key) => {
        const col = colMap.get(key);
        if (!col) return null;
        const active = sort.column === col.key;
        const w = columnWidths[key] || col.defaultW;

        return (
          <th
            key={col.key}
            draggable={!col.sticky}
            onDragStart={() => onDragStart(col.key)}
            onDragOver={(e) => { e.preventDefault(); onDragOver(e, col.key); }}
            onDrop={() => onDrop(col.key)}
            onClick={() => col.sortable && onSort(col.key)}
            className={
              "relative py-2 px-2 text-xs font-semibold uppercase tracking-wide whitespace-nowrap border-b border-[var(--border)] text-center " +
              (col.sticky
                ? "sticky left-0 z-20 bg-[var(--bg-card)] "
                : "bg-[var(--bg-card)] ") +
              (col.sortable ? "select-none hover:text-[var(--accent)] " : "") +
              (!col.sticky ? "cursor-default " : "")
            }
            style={{ width: w, minWidth: 50, maxWidth: 500 }}
          >
            <Tooltip text={col.tooltip}>
              <span className="text-[var(--text-muted)]">
                {col.label}
                {active && <SortArrow dir={sort.dir} />}
              </span>
            </Tooltip>
            {/* Resize handle */}
            <div
              className="absolute top-0 -right-px w-[2px] h-full cursor-col-resize transition-colors z-10"
              style={{ background: "rgba(255,255,255,0.08)" }}
              onMouseDown={(e) => handleResizeMouseDown(col.key, e)}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "rgba(108,92,231,0.4)"; }}
              onMouseLeave={(e) => { if (!resizing.current) (e.target as HTMLElement).style.background = "rgba(255,255,255,0.08)"; }}
            />
          </th>
        );
      })}
    </tr>
  );
}
