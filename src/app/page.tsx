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
import AdsCampaignsTable from "@/components/AdsCampaignsTable";

const ACTIVE_TAB_STORAGE_KEY = "wb_ads_active_tab";
const VALID_TABS = new Set(["cards", "ads", "settings"]);
const CARDS_DETAIL_BOTTOM_HEIGHT = 362;
const CLIENT_BUILD = "2026-05-28-0017";

function normalizeTab(tab: unknown): string | null {
  return typeof tab === "string" && VALID_TABS.has(tab) ? tab : null;
}

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
  const [hiddenColumnsReady, setHiddenColumnsReady] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<DashboardProduct | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Фильтр «Реклама» по артикулу — триггерится dblclick в «Карточках».
  // Nonce инкрементится при каждом dblclick чтобы повторный клик по тому же артикулу
  // тоже переприменил фильтр.
  const [adsArticleFilter, setAdsArticleFilter] = useState<string | null>(null);
  const [adsArticleFilterNonce, setAdsArticleFilterNonce] = useState(0);
  // Обратная навигация: dblclick по кампании → скролл к карточке в «Карточках».
  // Nonce триггерит scrollIntoView даже когда nmId не сменился.
  const [cardScrollNmId, setCardScrollNmId] = useState<number | null>(null);
  const [cardScrollNonce, setCardScrollNonce] = useState(0);

  const loadData = useCallback(async (d: number, o: number = 0, silent: boolean = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/dashboard?days=${d}&offset=${o}&v=${CLIENT_BUILD}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`dashboard ${res.status}`);
      const data: DashboardResponse = await res.json();
      setProducts(data.products);
      setSummary(data.summary);
      // Update selected product with fresh data (keep selection)
      if (silent) {
        setSelectedProduct((prev) => {
          if (!prev) return null;
          return data.products.find((p) => p.nmId === prev.nmId) || prev;
        });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const browserTab = normalizeTab(window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY));
    fetch(`/api/settings?v=${CLIENT_BUILD}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((s) => {
        const saved = Number(s.dashboard_period);
        const d = saved > 0 ? saved : 7;
        const o = Number(s.dashboard_offset) || 0;
        setDays(d);
        setOffset(o);
        loadData(d, o);
        setActiveTab(browserTab || normalizeTab(s.active_tab) || "cards");
      })
      .catch(() => { setDays(7); loadData(7); setActiveTab(browserTab || "cards"); });

    loadHiddenColumns()
      .then(setHiddenColumns)
      .catch(() => setHiddenColumns([]))
      .finally(() => setHiddenColumnsReady(true));
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

  function persistActiveTab(tab: string) {
    const normalized = normalizeTab(tab);
    if (!normalized) return;
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, normalized);
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active_tab: normalized }),
    }).catch(() => {});
  }

  function switchTab(tab: string) {
    const normalized = normalizeTab(tab);
    if (!normalized) return;
    setActiveTab(normalized);
    persistActiveTab(normalized);
  }

  useEffect(() => {
    if (!activeTab) return;
    persistActiveTab(activeTab);
  }, [activeTab]);

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
        onSyncComplete={() => { if (days) loadData(days, offset, true); setRefreshKey((k) => k + 1); }}
        onSyncManual={() => { if (activeTab) persistActiveTab(activeTab); setSyncOpen(true); }}
      />
      <AdsNavigation activeTab={activeTab || "cards"} onTabChange={(tab) => {
        switchTab(tab);
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
                onSync={() => { persistActiveTab("cards"); setSyncOpen(true); }}
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
          {loading || !hiddenColumnsReady ? (
            <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
              Загрузка...
            </div>
          ) : (
            <SplitPane
              defaultRatio={0.45}
              defaultBottomPx={CARDS_DETAIL_BOTTOM_HEIGHT}
              top={
                <AdsTable
                  products={products}
                  search={search}
                  archive={archive}
                  hiddenColumns={hiddenColumns}
                  onRowClick={setSelectedProduct}
                  onRowDoubleClick={(p) => {
                    setAdsArticleFilter(String(p.nmId));
                    setAdsArticleFilterNonce((n) => n + 1);
                    switchTab("ads");
                  }}
                  selectedNmId={selectedProduct?.nmId ?? null}
                  scrollToNmId={cardScrollNmId}
                  scrollNonce={cardScrollNonce}
                />
              }
              bottom={
                <DetailPanel
                  product={selectedProduct}
                  days={days}
                  offset={offset}
                  refreshKey={refreshKey}
                  onClearProduct={() => setSelectedProduct(null)}
                />
              }
            />
          )}
        </>
      )}

      {activeTab === "ads" && (
        <AdsCampaignsTable
          days={days}
          articleFilter={adsArticleFilter}
          articleFilterNonce={adsArticleFilterNonce}
          onRowDoubleClick={(nmId) => {
            if (nmId == null) {
              alert("У этой кампании не привязан товар");
              return;
            }
            const product = products.find((p) => p.nmId === nmId);
            if (!product) {
              // Архивные/старые кампании ссылаются на nm_id, которых нет в products
              // (товар удалён из ассортимента или не синхронизируется). Если переключить
              // таб — выделение останется на старой карточке, и кажется что «перебросило
              // не туда». Лучше остановиться и сказать пользователю.
              alert(`Товар ${nmId} не найден в Карточках (возможно, удалён из ассортимента или не синхронизируется)`);
              return;
            }
            setSelectedProduct(product);
            // Сбрасываем фильтры, чтобы карточка точно появилась в списке.
            setSearch("");
            setArchive(true);
            // Запрашиваем скролл к строке (nonce — чтобы триггерилось каждый раз).
            setCardScrollNmId(nmId);
            setCardScrollNonce((n) => n + 1);
            switchTab("cards");
          }}
        />
      )}

      {activeTab === "settings" && <SettingsPanel />}

      <SyncModal
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        onComplete={() => { if (days) loadData(days, offset, true); setRefreshKey((k) => k + 1); }}
      />
    </div>
  );
}
