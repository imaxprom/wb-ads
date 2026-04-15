export interface DashboardResponse {
  summary: {
    totalOrdersSum: number;
    totalAdsSpend: number;
    totalProducts: number;
  };
  products: DashboardProduct[];
}

export interface DashboardProduct {
  nmId: number;
  vendorCode: string | null;
  title: string | null;
  updatedAt: string | null;
  subject: string | null;
  colors: string | null;
  labels: string[];
  rating: number | null;
  feedbacks: number;
  price: number | null;
  discount: number | null;
  deliveryPrice: number | null;
  spp: number | null;
  salePrice: number | null;
  stockQty: number;
  stockValue: number;
  viewCount: number;
  openCardCount: number;
  cartsTotal: number;
  ordersTotal: number;
  ordersSum: number;
  buyoutsCount: number;
  buyoutsSum: number;
  drr: number | null;
  adSpend: number;
  adOrders: number;
  adCarts: number;
  adClicks: number;
  adViews: number;
  campaigns: CampaignInfo[];
  queriesCount: number;
}

export interface CampaignInfo {
  advertId: number;
  name: string;
  status: number;
  paymentType: string;
  campaignKind: "auto" | "search" | "cpc";
  bid: number | null;
  dailyBudget: number | null;
  spend: number;
}

export type SortDir = "asc" | "desc" | null;

export interface SortState {
  column: string;
  dir: SortDir;
}

export const PERIOD_OPTIONS = [
  { label: "Сегодня", days: 1, offset: 0 },
  { label: "Вчера", days: 1, offset: 1 },
  { label: "3 дня", days: 3, offset: 0 },
  { label: "5 дней", days: 5, offset: 0 },
  { label: "Неделя", days: 7, offset: 0 },
  { label: "10 дней", days: 10, offset: 0 },
  { label: "2 недели", days: 14, offset: 0 },
  { label: "Месяц", days: 30, offset: 0 },
  { label: "2 месяца", days: 60, offset: 0 },
  { label: "3 месяца", days: 90, offset: 0 },
] as const;
