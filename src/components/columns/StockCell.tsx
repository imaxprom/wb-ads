import { fmtNum } from "@/lib/format";

export default function StockCell({ qty }: { qty: number }) {
  if (qty === 0)
    return <span className="text-[var(--text-muted)] text-xs">0 шт.</span>;
  return <span className="text-xs">{fmtNum(qty)} шт.</span>;
}
