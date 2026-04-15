export default function ColorsCell({ colors }: { colors: string | null }) {
  if (!colors) return <span className="text-[var(--text-muted)]">—</span>;
  return <div className="text-xs text-[var(--text-muted)] whitespace-normal break-words leading-tight">{colors}</div>;
}
