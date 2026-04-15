import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const accounts = db.prepare("SELECT * FROM accounts ORDER BY created_at DESC").all();
  return NextResponse.json(accounts);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = getDb();

  db.prepare(`
    INSERT INTO accounts (phone, name, connection, access, supplier_id, supplier_name, store_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET
      name = excluded.name,
      connection = excluded.connection,
      access = excluded.access,
      supplier_id = excluded.supplier_id,
      supplier_name = excluded.supplier_name,
      store_name = excluded.store_name
  `).run(
    body.phone, body.name || null, body.connection || "Активен",
    body.access || null, body.supplier_id || null,
    body.supplier_name || null, body.store_name || null
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { phone } = await req.json();
  const db = getDb();
  db.prepare("DELETE FROM accounts WHERE phone = ?").run(phone);
  return NextResponse.json({ ok: true });
}
