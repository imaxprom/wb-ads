import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const result: Record<string, string> = {};
  for (const r of rows) result[r.key] = r.value;
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const db = getDb();
  const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  const update = db.transaction(() => {
    for (const [key, value] of Object.entries(body)) {
      stmt.run(key, String(value));
    }
  });
  update();
  return NextResponse.json({ ok: true });
}
