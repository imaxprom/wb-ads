import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiKey } from "@/lib/api-key";
import { Client } from "pg";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const WB_STOCKS_URL = "https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=2019-01-01T00:00:00";

export async function POST() {
  const apiKey = getApiKey();

  const res = await fetch(WB_STOCKS_URL, {
    headers: { Authorization: apiKey },
    cache: "no-store",
  });
  const contentType = res.headers.get("content-type") || "";
  const body = await res.text();
  const bodyLength = Buffer.byteLength(body);
  const bodyPreview = body.slice(0, 300);

  if (!res.ok) {
    return NextResponse.json({
      ok: false,
      error: `stocks: WB API ${res.status}`,
      wbStatus: res.status,
      contentType,
      bodyLength,
      bodyPreview,
      retryable: res.status === 429 || res.status >= 500,
    }, { status: 502 });
  }

  if (!body.trim()) {
    return NextResponse.json({
      ok: false,
      error: "stocks: empty body from WB",
      wbStatus: res.status,
      contentType,
      bodyLength,
      retryable: true,
    }, { status: 502 });
  }

  let data: Record<string, unknown>[];
  try {
    const parsed = JSON.parse(body);
    if (!Array.isArray(parsed)) {
      return NextResponse.json({
        ok: false,
        error: "stocks: WB response is not an array",
        wbStatus: res.status,
        contentType,
        bodyLength,
        bodyPreview,
        retryable: true,
      }, { status: 502 });
    }
    data = parsed as Record<string, unknown>[];
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "stocks: invalid JSON from WB",
      parseError: e instanceof Error ? e.message : String(e),
      wbStatus: res.status,
      contentType,
      bodyLength,
      bodyPreview,
      retryable: true,
    }, { status: 502 });
  }

  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (databaseUrl) {
    const pg = new Client({ connectionString: databaseUrl });
    await pg.connect();
    try {
      await pg.query("BEGIN");
      await pg.query("DELETE FROM stocks");
      const sql = `
        INSERT INTO stocks (nm_id, warehouse, quantity, quantity_full, price, discount)
        VALUES ($1, $2, $3, $4, $5, $6)
      `;
      for (const s of data) {
        await pg.query(sql, [
          s.nmId,
          s.warehouseName || "Неизвестно",
          s.quantity || 0,
          s.quantityFull || 0,
          s.Price || 0,
          s.Discount || 0,
        ]);
      }
      await pg.query("COMMIT");
    } catch (e) {
      await pg.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      await pg.end();
    }
    return NextResponse.json({ ok: true, stocks: data.length });
  }

  const db = getDb();

  db.exec("DELETE FROM stocks");

  const insert = db.prepare(`
    INSERT INTO stocks (nm_id, warehouse, quantity, quantity_full, price, discount)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertAll = db.transaction(() => {
    for (const s of data) {
      insert.run(
        s.nmId,
        s.warehouseName || "Неизвестно",
        s.quantity || 0,
        s.quantityFull || 0,
        s.Price || 0,
        s.Discount || 0
      );
    }
  });
  insertAll();

  return NextResponse.json({ ok: true, stocks: data.length });
}
