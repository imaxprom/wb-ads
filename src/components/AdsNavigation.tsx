"use client";

const TABS = [
  { key: "search", label: "Выдача WB", enabled: false },
  { key: "cards", label: "Карточки", enabled: true },
  { key: "ads", label: "Реклама", enabled: false },
  { key: "settings", label: "Настройки", enabled: true },
];

export default function AdsNavigation({
  activeTab,
  onTabChange,
}: {
  activeTab: string;
  onTabChange: (tab: string) => void;
}) {
  return (
    <div className="flex gap-1 px-4 pt-4 pb-2 border-b border-[var(--border)]">
      {TABS.map((t) => {
        const isActive = t.key === activeTab;
        if (t.enabled) {
          return (
            <button key={t.key} onClick={() => onTabChange(t.key)}
              className={
                "px-4 py-2 text-sm font-medium transition-colors " +
                (isActive
                  ? "text-white font-semibold border-b-2 border-[var(--accent)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]")
              }>
              {t.label}
            </button>
          );
        }
        return (
          <button key={t.key} disabled
            className="px-4 py-2 text-sm font-medium text-[var(--text-muted)] cursor-not-allowed">
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
