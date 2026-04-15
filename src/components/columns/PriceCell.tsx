import { fmtNum } from "@/lib/format";

export default function PriceCell({
  deliveryPrice, spp, salePrice,
}: {
  deliveryPrice: number | null; spp: number | null; salePrice: number | null;
}) {
  if (deliveryPrice == null) return <span className="text-[var(--text-muted)]">—</span>;
  return (
    <div className="text-xs">
      <div>~{fmtNum(deliveryPrice)} ₽</div>
      <div className="text-[var(--text-muted)]">{spp != null ? `${Math.round(spp)} %` : "—"}</div>
      <div>{salePrice ? `~${fmtNum(salePrice)} ₽` : "—"}</div>
    </div>
  );
}
