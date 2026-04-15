import { fmtDrr } from "@/lib/format";

export default function DrrCell({ adSpend, ordersSum }: { adSpend: number; ordersSum: number }) {
  const { text, color } = fmtDrr(adSpend, ordersSum);
  return <span className="text-sm font-medium" style={{ color }}>{text}</span>;
}
