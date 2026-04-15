import { fmtNum, fmtRub } from "@/lib/format";
import type { CampaignInfo } from "@/types";

function StatusBadge({ active }: { active: boolean }) {
  const bg = active ? "rgba(0,184,148,0.2)" : "rgba(231,76,60,0.2)";
  const color = active ? "var(--success)" : "var(--danger)";

  return (
    <span
      className="inline-flex items-center justify-center w-4 h-4 rounded-full shrink-0"
      style={{ background: bg }}
    >
      {active ? (
        <svg className="w-2 h-2" viewBox="0 0 10 12" fill={color}>
          <polygon points="0,0 10,6 0,12" />
        </svg>
      ) : (
        <svg className="w-2 h-2" viewBox="0 0 10 12" fill={color}>
          <rect x="1" y="0" width="3" height="12" rx="0.5" />
          <rect x="6" y="0" width="3" height="12" rx="0.5" />
        </svg>
      )}
    </span>
  );
}

export default function CampaignCell({ campaign }: { campaign: CampaignInfo | undefined }) {
  if (!campaign) return <span className="text-[var(--text-muted)]" />;

  const isActive = campaign.status === 9;

  return (
    <div className="text-xs">
      {campaign.bid != null && (
        <div className="flex items-center justify-end gap-1">
          <span className="w-[3.2rem] text-right text-[var(--text-muted)] shrink-0">ставка</span>
          <span className="min-w-[4.5rem] text-right font-mono">{fmtNum(campaign.bid)} ₽</span>
          <StatusBadge active={isActive} />
        </div>
      )}
      {campaign.spend > 0 && (
        <div className="flex items-center justify-end gap-1">
          <span className="w-[3.2rem] text-right text-[var(--text-muted)] shrink-0">затраты</span>
          <span className="min-w-[4.5rem] text-right font-mono">{fmtRub(campaign.spend)}</span>
          <span className="w-4 shrink-0" />
        </div>
      )}
      {campaign.dailyBudget != null && campaign.dailyBudget > 0 && (
        <div className="flex items-center justify-end gap-1">
          <span className="w-[3.2rem] text-right text-[var(--text-muted)] shrink-0">бюджет</span>
          <span className="min-w-[4.5rem] text-right font-mono">{fmtRub(campaign.dailyBudget)}</span>
          <span className="w-4 shrink-0" />
        </div>
      )}
    </div>
  );
}
