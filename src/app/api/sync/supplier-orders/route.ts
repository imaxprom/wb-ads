import { NextRequest, NextResponse } from "next/server";
import { getApiKey } from "@/lib/api-key";
import { getDb } from "@/lib/db";
import { localDateStr } from "@/lib/format";
import {
  ensureSupplierOrdersTable,
  wbOrderUid,
  wbOrdersDateParts,
  type WbSupplierOrder,
} from "@/lib/supplier-orders";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BASE = "https://statistics-api.wildberries.ru";
const WB_PAGE_LIMIT_GUESS = 80_000;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: NextRequest) {
  const apiKey = getApiKey();
  const db = getDb();
  ensureSupplierOrdersTable(db);

  const sp = request.nextUrl.searchParams;
  const days = Math.max(1, Math.min(90, Number(sp.get("days") || "90")));
  const flag = sp.get("flag") === "1" ? 1 : 0;
  const dateFrom = sp.get("dateFrom") || `${localDateStr(new Date(Date.now() - (days - 1) * 86400000))}T00:00:00`;
  const autoChunk = flag === 0 && !sp.get("dateFrom") && sp.get("chunk") !== "0";

  let httpStatus = 0;
  let totalRows = 0;
  let upserted = 0;
  let skipped = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;
  let error: string | null = null;
  const chunks: { dateFrom: string; rows: number; minDate: string | null; maxDate: string | null }[] = [];

  try {
    let currentDateFrom = dateFrom;
    for (let chunkIndex = 0; chunkIndex < 6; chunkIndex++) {
      const url = `${BASE}/api/v1/supplier/orders?dateFrom=${encodeURIComponent(currentDateFrom)}&flag=${flag}`;
      const res = await fetch(url, { headers: { Authorization: apiKey } });
      httpStatus = res.status;

      if (!res.ok) {
        const text = await res.text();
        error = `WB Statistics API ${res.status}: ${text.slice(0, 300)}`;
        break;
      }

      const data = await res.json();
      if (!Array.isArray(data)) {
        error = "WB Statistics API вернул не массив";
        break;
      } else {
        totalRows += data.length;
        let chunkMinDate: string | null = null;
        let chunkMaxDate: string | null = null;
        const stmt = db.prepare(`
          INSERT INTO supplier_orders (
            order_uid, srid, g_number, sticker, date, date_day, date_hour, last_change_date,
            nm_id, supplier_article, barcode, category, subject, brand, tech_size,
            warehouse_name, warehouse_type, country_name, oblast_okrug_name, region_name,
            spp, finished_price, price_with_disc, total_price, discount_percent,
            is_cancel, cancel_date, raw_json, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(order_uid) DO UPDATE SET
            srid = excluded.srid,
            g_number = excluded.g_number,
            sticker = excluded.sticker,
            date = excluded.date,
            date_day = excluded.date_day,
            date_hour = excluded.date_hour,
            last_change_date = excluded.last_change_date,
            nm_id = excluded.nm_id,
            supplier_article = excluded.supplier_article,
            barcode = excluded.barcode,
            category = excluded.category,
            subject = excluded.subject,
            brand = excluded.brand,
            tech_size = excluded.tech_size,
            warehouse_name = excluded.warehouse_name,
            warehouse_type = excluded.warehouse_type,
            country_name = excluded.country_name,
            oblast_okrug_name = excluded.oblast_okrug_name,
            region_name = excluded.region_name,
            spp = excluded.spp,
            finished_price = excluded.finished_price,
            price_with_disc = excluded.price_with_disc,
            total_price = excluded.total_price,
            discount_percent = excluded.discount_percent,
            is_cancel = excluded.is_cancel,
            cancel_date = excluded.cancel_date,
            raw_json = excluded.raw_json,
            updated_at = datetime('now')
        `);

        const tx = db.transaction((rows: WbSupplierOrder[]) => {
          for (const row of rows) {
            const { day, hour } = wbOrdersDateParts(row.date);
            const nmId = num(row.nmId);
            if (!day || !nmId) {
              skipped++;
              continue;
            }
            if (!chunkMinDate || day < chunkMinDate) chunkMinDate = day;
            if (!chunkMaxDate || day > chunkMaxDate) chunkMaxDate = day;
            if (!minDate || day < minDate) minDate = day;
            if (!maxDate || day > maxDate) maxDate = day;
            const info = stmt.run(
              wbOrderUid(row),
              row.srid || null,
              row.gNumber || null,
              row.sticker || null,
              row.date || null,
              day,
              hour,
              row.lastChangeDate || null,
              nmId,
              row.supplierArticle || null,
              row.barcode || null,
              row.category || null,
              row.subject || null,
              row.brand || null,
              row.techSize || null,
              row.warehouseName || null,
              row.warehouseType || null,
              row.countryName || null,
              row.oblastOkrugName || null,
              row.regionName || null,
              num(row.spp),
              num(row.finishedPrice),
              num(row.priceWithDisc),
              num(row.totalPrice),
              num(row.discountPercent),
              row.isCancel ? 1 : 0,
              row.cancelDate || null,
              JSON.stringify(row),
            );
            if (info.changes > 0) upserted++;
          }
        });
        tx(data as WbSupplierOrder[]);
        const chunkMin = chunkMinDate as string | null;
        const chunkMax = chunkMaxDate as string | null;
        chunks.push({ dateFrom: currentDateFrom, rows: data.length, minDate: chunkMin, maxDate: chunkMax });

        if (!autoChunk || data.length < WB_PAGE_LIMIT_GUESS || !chunkMax || chunkMax >= localDateStr(new Date())) break;
        const nextDay = localDateStr(new Date(new Date(`${chunkMax}T12:00:00`).getTime() + 86400000));
        if (nextDay <= currentDateFrom.slice(0, 10)) break;
        currentDateFrom = `${nextDay}T00:00:00`;
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    ok: error === null,
    requestedFrom: dateFrom,
    flag,
    httpStatus,
    totalRows,
    upserted,
    skipped,
    minDate,
    maxDate,
    chunks,
    error,
  }, { status: error ? 502 : 200 });
}
