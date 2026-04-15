"use client";

import { useState, useEffect, useCallback } from "react";
import type { DashboardResponse, DashboardProduct } from "@/types";
import AdsNavigation from "@/components/AdsNavigation";
import AdsFilters from "@/components/AdsFilters";
import AdsTable from "@/components/AdsTable";
import ControlPanel from "@/components/ControlPanel";
import ColumnSettings, { loadHiddenColumns } from "@/components/ColumnSettings";
import SyncModal from "@/components/SyncModal";
import SettingsPanel from "@/components/SettingsPanel";
import SplitPane from "@/components/SplitPane";
import DetailPanel from "@/components/DetailPanel";

export default function Home() {
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [archive, setArchive] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<DashboardProduct[]>([]);
  const [summary, setSummary] = useState({ totalOrdersSum: 0, totalAdsSpend: 0, totalProducts: 0 });
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<DashboardProduct | null>(null);

  const loadData = useCallback(async (d: number, o: number = 0) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard?days=${d}&offset=${o}`);
      const data: DashboardResponse = await res.json();
      setProducts(data.products);
      setSummary(data.summary);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        const saved = Number(s.dashboard_period);
        const d = saved > 0 ? saved : 7;
        const o = Number(s.dashboard_offset) || 0;
        setDays(d);
        setOffset(o);
        loadData(d, o);
        setActiveTab(s.active_tab || "cards");
      })
      .catch(() => { setDays(7); loadData(7); setActiveTab("cards"); });

    loadHiddenColumns().then(setHiddenColumns);
  }, [loadData]);

  function handleDaysChange(d: number, o: number = 0) {
    setDays(d);
    setOffset(o);
    loadData(d, o);
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dashboard_period: String(d), dashboard_offset: String(o) }),
    });
  }

  const shown = products.filter((p) => {
    if (!archive && p.stockQty === 0 && p.ordersTotal === 0) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!String(p.nmId).includes(q) && !(p.vendorCode || "").toLowerCase().includes(q)) return false;
    }
    return true;
  }).length;

  if (days === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] text-[var(--text-muted)]">
        Загрузка...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      <ControlPanel
        onSyncComplete={() => { if (days) loadData(days); }}
        onSyncManual={() => setSyncOpen(true)}
      />
      <AdsNavigation activeTab={activeTab || "cards"} onTabChange={(tab) => {
        setActiveTab(tab);
        fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active_tab: tab }),
        });
      }} />

      {activeTab === "cards" && (
        <>
          <div className="flex items-center border-b border-[var(--border)] shrink-0">
            <div className="flex-1">
              <AdsFilters
                days={days}
                offset={offset}
                onDaysChange={handleDaysChange}
                search={search}
                onSearchChange={setSearch}
                archive={archive}
                onArchiveChange={setArchive}
                syncing={false}
                onSync={() => setSyncOpen(true)}
                shown={shown}
                total={summary.totalProducts}
                totalOrdersSum={summary.totalOrdersSum}
                totalAdsSpend={summary.totalAdsSpend}
              />
            </div>
            <div className="pr-3">
              <ColumnSettings
                hiddenColumns={hiddenColumns}
                onHiddenChange={setHiddenColumns}
              />
            </div>
          </div>
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
              Загрузка...
            </div>
          ) : (
            <SplitPane
              defaultRatio={0.45}
              top={
                <AdsTable
                  products={products}
                  search={search}
                  archive={archive}
                  hiddenColumns={hiddenColumns}
                  onRowClick={setSelectedProduct}
                  selectedNmId={selectedProduct?.nmId ?? null}
                />
              }
              bottom={
                <DetailPanel product={selectedProduct} days={days} offset={offset} />
              }
            />
          )}
        </>
      )}

      {activeTab === "settings" && <SettingsPanel />}

      <SyncModal
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        onComplete={() => { if (days) loadData(days); }}
      />
    </div>
  );
}
