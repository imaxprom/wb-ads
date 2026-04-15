import { fmtNum, fmtRub } from "@/lib/format";
import { EyeIcon, CartIcon, BoxIcon } from "@/components/icons";

export default function OrdersCell({
  viewCount, carts, orders, ordersSum,
}: {
  viewCount: number; carts: number; orders: number; ordersSum: number;
}) {
  return (
    <div className="text-xs">
      {viewCount > 0 && (
        <div className="flex items-center justify-end gap-1">
          <EyeIcon className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)] opacity-50" />
          <span className="min-w-[3.5rem] text-right text-[var(--text-muted)] opacity-70 font-mono">{fmtNum(viewCount)}</span>
        </div>
      )}
      <div className="flex items-center justify-end gap-1">
        <CartIcon className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)]" />
        <span className="min-w-[3.5rem] text-right text-[var(--text-muted)] font-mono">{fmtNum(carts)}</span>
      </div>
      <div className="flex items-center justify-end gap-1">
        <BoxIcon className="w-3.5 h-3.5 shrink-0" />
        <span className="min-w-[3.5rem] text-right font-semibold font-mono">{fmtNum(orders)}</span>
      </div>
      <div className="text-right">{fmtRub(ordersSum)}</div>
    </div>
  );
}
