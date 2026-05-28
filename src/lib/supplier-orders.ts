import type Database from "better-sqlite3";

export interface WbSupplierOrder {
  date?: string;
  lastChangeDate?: string;
  warehouseName?: string;
  warehouseType?: string;
  countryName?: string;
  oblastOkrugName?: string;
  regionName?: string;
  supplierArticle?: string;
  nmId?: number;
  barcode?: string;
  category?: string;
  subject?: string;
  brand?: string;
  techSize?: string;
  spp?: number;
  finishedPrice?: number;
  priceWithDisc?: number;
  totalPrice?: number;
  discountPercent?: number;
  isCancel?: boolean;
  cancelDate?: string;
  gNumber?: string;
  sticker?: string;
  srid?: string;
}

export interface SppDailyRow {
  date: string;
  sppAvg: number;
  sppOrders: number;
}

export interface SppHourlyRow {
  date: string;
  hour: number;
  sppAvg: number;
  sppOrders: number;
}

export interface SppDistrictRow {
  date: string;
  district: string;
  sppAvg: number;
  sppOrders: number;
}

export function ensureSupplierOrdersTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS supplier_orders (
      order_uid TEXT PRIMARY KEY,
      srid TEXT,
      g_number TEXT,
      sticker TEXT,
      date TEXT,
      date_day TEXT,
      date_hour INTEGER,
      last_change_date TEXT,
      nm_id INTEGER,
      supplier_article TEXT,
      barcode TEXT,
      category TEXT,
      subject TEXT,
      brand TEXT,
      tech_size TEXT,
      warehouse_name TEXT,
      warehouse_type TEXT,
      country_name TEXT,
      oblast_okrug_name TEXT,
      region_name TEXT,
      spp REAL,
      finished_price REAL,
      price_with_disc REAL,
      total_price REAL,
      discount_percent REAL,
      is_cancel INTEGER DEFAULT 0,
      cancel_date TEXT,
      raw_json TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_supplier_orders_nm_day ON supplier_orders(nm_id, date_day);
    CREATE INDEX IF NOT EXISTS idx_supplier_orders_day ON supplier_orders(date_day);
    CREATE INDEX IF NOT EXISTS idx_supplier_orders_last_change ON supplier_orders(last_change_date);
  `);
}

export function wbOrdersDateParts(date: string | undefined): { day: string | null; hour: number | null } {
  if (!date) return { day: null, hour: null };
  const day = date.slice(0, 10);
  const hourRaw = date.length >= 13 ? Number(date.slice(11, 13)) : NaN;
  return {
    day: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null,
    hour: Number.isFinite(hourRaw) && hourRaw >= 0 && hourRaw <= 23 ? hourRaw : null,
  };
}

export function wbOrderUid(order: WbSupplierOrder): string {
  if (order.srid) return `srid:${order.srid}`;
  const parts = [
    order.gNumber || "",
    order.sticker || "",
    order.date || "",
    order.nmId || "",
    order.barcode || "",
    order.supplierArticle || "",
  ];
  return `fallback:${parts.join("|")}`;
}
