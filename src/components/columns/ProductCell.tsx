import type { DashboardProduct } from "@/types";
import ProductThumb from "@/components/ProductThumb";

export default function ProductCell({ p }: { p: DashboardProduct }) {
  return (
    <div className="flex items-center gap-2 min-w-[260px] max-w-[300px]">
      <ProductThumb nmId={p.nmId} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm leading-tight">
          {p.title || `Товар ${p.nmId}`}
        </div>
        <div className="text-xs text-[var(--text-muted)] truncate">
          {p.nmId}
        </div>
        {p.vendorCode && (
          <div className="text-xs text-[var(--text-muted)] truncate">
            {p.vendorCode}
          </div>
        )}
      </div>
    </div>
  );
}
