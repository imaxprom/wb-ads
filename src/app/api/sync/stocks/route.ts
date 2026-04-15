import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiKey } from "@/lib/api-key";

export async function POST() {
  const apiKey = getApiKey();

  const res = await fetch(
    "https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=2019-01-01T00:00:00",
    { headers: { Authorization: apiKey } }
  );

  if (!res.ok) {
    return NextResponse.json({ error: `WB API ${res.status}` }, { status: 502 });
  }

  const data: Record<string, unknown>[] = await res.json();
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
