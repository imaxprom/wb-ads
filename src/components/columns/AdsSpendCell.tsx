import { fmtNum, fmtRub } from "@/lib/format";
import { CartIcon, BoxIcon } from "@/components/icons";

export default function AdsSpendCell({
  adSpend, adCarts, adOrders,
}: {
  adSpend: number; adCarts: number; adOrders: number;
}) {
  if (adSpend === 0) return <span className="text-[var(--text-muted)]">—</span>;

  const costPerCart = adCarts > 0 ? Math.round(adSpend / adCarts) : null;
  const costPerOrder = adOrders > 0 ? Math.round(adSpend / adOrders) : null;

  return (
    <div className="text-xs font-mono">
      <div className="flex items-center justify-end gap-0.5 text-[var(--text-muted)]">
        <CartIcon className="w-3.5 h-3.5 shrink-0" />
        <span className="min-w-[2.5rem] text-right">{adCarts > 0 ? fmtNum(adCarts) : "—"}</span>
        {adCarts > 0 && <>
          <span className="w-3 text-center">×</span>
          <span className="min-w-[2.5rem] text-right">{fmtNum(costPerCart!)} ₽</span>
        </>}
      </div>
      <div className="flex items-center justify-end gap-0.5">
        <BoxIcon className="w-3.5 h-3.5 shrink-0" />
        <span className="min-w-[2.5rem] text-right">{adOrders > 0 ? fmtNum(adOrders) : "—"}</span>
        {adOrders > 0 && <>
          <span className="w-3 text-center">×</span>
          <span className="min-w-[2.5rem] text-right">{fmtNum(costPerOrder!)} ₽</span>
        </>}
      </div>
      <div className="text-right font-semibold">{fmtRub(adSpend)}</div>
    </div>
  );
}
