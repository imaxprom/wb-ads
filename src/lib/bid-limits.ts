import { getDb } from "@/lib/db";

export const WB_MAX_BID_RUB = 29999;

export const BID_LIMIT_KEYS = {
  manualAuction: "max_bid_manual_auction_rub",
  uni: "max_bid_uni_rub",
  cpc: "max_bid_cpc_rub",
} as const;

export type BidLimitKind = keyof typeof BID_LIMIT_KEYS;

type DbLike = ReturnType<typeof getDb>;

export function normalizeBidLimitRub(value: unknown, fallback = WB_MAX_BID_RUB): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(WB_MAX_BID_RUB, n));
}

export function readBidLimitRub(db: DbLike, kind: BidLimitKind): number {
  const key = BID_LIMIT_KEYS[kind];
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return normalizeBidLimitRub(row?.value);
}

export function readBidLimitsRub(db: DbLike) {
  return {
    manualAuction: readBidLimitRub(db, "manualAuction"),
    uni: readBidLimitRub(db, "uni"),
    cpc: readBidLimitRub(db, "cpc"),
  };
}
