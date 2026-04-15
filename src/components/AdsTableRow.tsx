import type { ReactNode } from "react";
import type { DashboardProduct } from "@/types";
import { COLUMNS } from "./AdsTableHeader";
import ProductCell from "./columns/ProductCell";
import SubjectCell from "./columns/SubjectCell";
import ColorsCell from "./columns/ColorsCell";
import LabelsCell from "./columns/LabelsCell";
import RatingCell from "./columns/RatingCell";
import PriceCell from "./columns/PriceCell";
import StockCell from "./columns/StockCell";
import OrdersCell from "./columns/OrdersCell";
import DrrCell from "./columns/DrrCell";
import AdsSpendCell from "./columns/AdsSpendCell";
import CampaignCell from "./columns/CampaignCell";
import VisibilityCell from "./columns/VisibilityCell";

function getCellContent(key: string, p: DashboardProduct): ReactNode {
  const auto = p.campaigns.find((c) => c.campaignKind === "auto");
  const search = p.campaigns.find((c) => c.campaignKind === "search");
  const cpc = p.campaigns.find((c) => c.campaignKind === "cpc");

  switch (key) {
    case "vendorCode": return <ProductCell p={p} />;
    case "subject": return <SubjectCell subject={p.subject} />;
    case "colors": return <ColorsCell colors={p.colors} />;
    case "labels": return <LabelsCell labels={p.labels} />;
    case "feedbacks": return <RatingCell rating={p.rating} feedbacks={p.feedbacks} />;
    case "deliveryPrice": return <PriceCell deliveryPrice={p.deliveryPrice} spp={p.spp} salePrice={p.salePrice} />;
    case "stockValue": return <StockCell qty={p.stockQty} />;
    case "ordersSum": return <OrdersCell viewCount={p.viewCount} carts={p.cartsTotal} orders={p.ordersTotal} ordersSum={p.ordersSum} />;
    case "drr": return <DrrCell adSpend={p.adSpend} ordersSum={p.ordersSum} />;
    case "adSpend": return <AdsSpendCell adSpend={p.adSpend} adCarts={p.adCarts} adOrders={p.adOrders} />;
    case "autoSpend": return <CampaignCell campaign={auto} />;
    case "searchSpend": return <CampaignCell campaign={search} />;
    case "cpcSpend": return <CampaignCell campaign={cpc} />;
    case "queriesCount": return <VisibilityCell queriesCount={p.queriesCount} />;
    default: return null;
  }
}

const colMap = new Map(COLUMNS.map((c) => [c.key, c]));

export default function AdsTableRow({ p, columnOrder, columnWidths, selected, onClick }: {
  p: DashboardProduct; columnOrder: string[]; columnWidths: Record<string, number>;
  selected?: boolean; onClick?: () => void;
}) {
  const td = "py-2 px-2 border-b border-[var(--border)] border-r border-r-white/[0.06] overflow-hidden";

  return (
    <tr
      className={"group transition-colors cursor-pointer " + (selected ? "bg-[var(--accent)]/25" : "hover:bg-[var(--bg-card-hover)]")}
      onClick={onClick}
    >
      {columnOrder.map((key) => {
        const col = colMap.get(key);
        if (!col) return null;
        const isSticky = col.sticky;
        const isRight = col.align === "right";
        const w = columnWidths[key] || col.defaultW;

        return (
          <td
            key={key}
            className={
              td +
              (isSticky
                ? selected
                  ? " sticky left-0 z-10"
                  : " sticky left-0 z-10 bg-[var(--bg)] group-hover:bg-[var(--bg-card-hover)]"
                : "") +
              (isRight ? " text-right" : "")
            }
            style={{
              width: w, minWidth: 50, maxWidth: 500,
              ...(isSticky && selected ? { background: "color-mix(in srgb, var(--accent) 25%, var(--bg))" } : {}),
            }}
          >
            {getCellContent(key, p)}
          </td>
        );
      })}
    </tr>
  );
}
