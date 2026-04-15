"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import type { DashboardProduct, SortState } from "@/types";
import AdsTableHeader, { COLUMNS } from "./AdsTableHeader";
import AdsTableRow from "./AdsTableRow";
import { loadColumnWidths, saveColumnWidths, loadColumnOrder, saveColumnOrder } from "./ControlPanel";

function getSortValue(p: DashboardProduct, col: string): number | string {
  switch (col) {
    case "vendorCode": return p.vendorCode || "";
    case "feedbacks": return p.feedbacks;
    case "stockValue": return p.stockQty;
    case "ordersSum": return p.ordersSum;
    case "adSpend": return p.adSpend;
    case "queriesCount": return p.queriesCount;
    case "autoSpend": {
      const c = p.campaigns.find((c) => c.campaignKind === "auto");
      return c ? (c.status === 9 ? 1000000 : 0) + c.spend : -1;
    }
    case "searchSpend": {
      const c = p.campaigns.find((c) => c.campaignKind === "search");
      return c ? (c.status === 9 ? 1000000 : 0) + c.spend : -1;
    }
    case "cpcSpend": {
      const c = p.campaigns.find((c) => c.campaignKind === "cpc");
      return c ? (c.status === 9 ? 1000000 : 0) + c.spend : -1;
    }
    default: return 0;
  }
}

export default function AdsTable({
  products, search, archive, hiddenColumns = [], onRowClick, selectedNmId,
}: {
  products: DashboardProduct[];
  search: string;
  archive: boolean;
  hiddenColumns?: string[];
  onRowClick?: (product: DashboardProduct) => void;
  selectedNmId?: number | null;
}) {
  const defaultOrder = COLUMNS.map((c) => c.key);
  const [sort, setSort] = useState<SortState>({ column: "", dir: null });
  const [columnOrder, setColumnOrder] = useState<string[]>(defaultOrder);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const dragKey = useRef<string | null>(null);
  const resizeKey = useRef<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Load from DB on mount
  useEffect(() => {
    loadColumnWidths().then((w) => {
      if (Object.keys(w).length > 0) setColumnWidths(w);
    });
    loadColumnOrder().then((o) => {
      if (o && o.length === defaultOrder.length) setColumnOrder(o);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced save to DB
  function debouncedSaveWidths(w: Record<string, number>) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveColumnWidths(w), 500);
  }

  const handleResizeStart = useCallback((key: string, startX: number) => {
    resizeKey.current = key;
    resizeStartX.current = startX;
    const col = COLUMNS.find((c) => c.key === key);
    resizeStartW.current = columnWidths[key] || col?.defaultW || 100;

    const onMouseMove = (e: MouseEvent) => {
      if (!resizeKey.current) return;
      const diff = e.clientX - resizeStartX.current;
      const newW = Math.max(50, Math.min(500, resizeStartW.current + diff));
      setColumnWidths((prev) => {
        const updated = { ...prev, [resizeKey.current!]: newW };
        return updated;
      });
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      resizeKey.current = null;
      setColumnWidths((prev) => { debouncedSaveWidths(prev); return prev; });
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [columnWidths]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSort(col: string) {
    setSort((prev) => {
      if (prev.column !== col) return { column: col, dir: "desc" };
      if (prev.dir === "desc") return { column: col, dir: "asc" };
      if (prev.dir === "asc") return { column: "", dir: null };
      return { column: col, dir: "desc" };
    });
  }

  function handleDragStart(key: string) { dragKey.current = key; }
  function handleDragOver(e: React.DragEvent) { e.preventDefault(); }
  function handleDrop(targetKey: string) {
    const srcKey = dragKey.current;
    if (!srcKey || srcKey === targetKey || targetKey === "vendorCode" || srcKey === "vendorCode") return;
    setColumnOrder((prev) => {
      const newOrder = [...prev];
      const srcIdx = newOrder.indexOf(srcKey);
      const tgtIdx = newOrder.indexOf(targetKey);
      if (srcIdx === -1 || tgtIdx === -1) return prev;
      newOrder.splice(srcIdx, 1);
      newOrder.splice(tgtIdx, 0, srcKey);
      saveColumnOrder(newOrder);
      return newOrder;
    });
    dragKey.current = null;
  }

  const filtered = useMemo(() => {
    let list = products;
    if (!archive) list = list.filter((p) => p.stockQty > 0 || p.ordersTotal > 0);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => String(p.nmId).includes(q) || (p.vendorCode || "").toLowerCase().includes(q));
    }
    if (sort.column && sort.dir) {
      list = [...list].sort((a, b) => {
        const va = getSortValue(a, sort.column);
        const vb = getSortValue(b, sort.column);
        const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return list;
  }, [products, search, archive, sort]);

  const visibleOrder = columnOrder.filter((k) => !hiddenColumns.includes(k));

  return (
    <div className="overflow-x-auto flex-1">
      <table className="border-collapse text-sm" style={{ tableLayout: "fixed" }}>
        <thead>
          <AdsTableHeader
            sort={sort}
            onSort={handleSort}
            columnOrder={visibleOrder}
            columnWidths={columnWidths}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onResizeStart={handleResizeStart}
          />
        </thead>
        <tbody>
          {filtered.map((p) => (
            <AdsTableRow
              key={p.nmId}
              p={p}
              columnOrder={visibleOrder}
              columnWidths={columnWidths}
              selected={p.nmId === selectedNmId}
              onClick={() => onRowClick?.(p)}
            />
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={14} className="py-12 text-center text-[var(--text-muted)]">
                Нет данных
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
