import { fmtNum } from "@/lib/format";

export default function VisibilityCell({ queriesCount }: { queriesCount: number }) {
  return (
    <div className="text-xs">
      <div className="text-[var(--text-muted)]">— каталог</div>
      <div>{queriesCount > 0 ? `${fmtNum(queriesCount)} запрос` : "—"}</div>
    </div>
  );
}
