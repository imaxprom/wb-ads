import { fmtNum } from "@/lib/format";

export default function RatingCell({ rating, feedbacks }: { rating: number | null; feedbacks: number }) {
  if (rating == null) return <span className="text-[var(--text-muted)]">—</span>;
  return (
    <div className="text-xs">
      <div><span className="text-yellow-400">★</span> {rating.toFixed(1)}</div>
      <div className="text-[var(--text-muted)]">{fmtNum(feedbacks)}</div>
    </div>
  );
}
