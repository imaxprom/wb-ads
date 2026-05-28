import { fmtNum } from "@/lib/format";

function formatSpp(value: number | null): string {
  return value != null && value > 0 ? `СПП ${value.toFixed(1).replace(".", ",")} %` : "СПП —";
}

export default function PriceCell({
  deliveryPrice, priceFrom, priceTo, spp,
}: {
  deliveryPrice: number | null;
  priceFrom: number | null;
  priceTo: number | null;
  spp: number | null;
}) {
  const price = priceFrom ?? deliveryPrice;
  if (price == null) return <span className="text-[var(--text-muted)]">—</span>;
  const hasRange = priceFrom != null && priceTo != null && priceTo > priceFrom;
  return (
    <div className="text-xs">
      <div>
        {hasRange
          ? <>{fmtNum(priceFrom!)}–{fmtNum(priceTo!)} ₽</>
          : <>~{fmtNum(price)} ₽</>}
      </div>
      <div className="text-[var(--text-muted)]">{formatSpp(spp)}</div>
    </div>
  );
}
