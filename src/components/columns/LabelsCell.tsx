export default function LabelsCell({ labels }: { labels: string[] }) {
  if (!labels || labels.length === 0)
    return <span className="text-[var(--text-muted)]">—</span>;

  return (
    <div className="text-xs">
      {labels.map((l, i) => (
        <div key={i} className="text-[var(--danger)] font-medium truncate max-w-[100px]">
          {l}
        </div>
      ))}
    </div>
  );
}
