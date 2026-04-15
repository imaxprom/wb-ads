import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const KEY_PATH = path.join(process.cwd(), "data", "wb-api-key.txt");

export async function GET() {
  try {
    if (fs.existsSync(KEY_PATH)) {
      const key = fs.readFileSync(KEY_PATH, "utf-8").trim();
      if (key) {
        const masked = key.length > 12 ? "••••••••••••" + key.slice(-8) : "••••••••";
        // Decode JWT to get supplier info
        let supplierName = "";
        try {
          const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64").toString());
          supplierName = payload.s || payload.sid || "";
        } catch { /* not a JWT */ }
        return NextResponse.json({ hasKey: true, masked, supplierName });
      }
    }
    return NextResponse.json({ hasKey: false });
  } catch {
    return NextResponse.json({ hasKey: false });
  }
}

export async function PUT(req: NextRequest) {
  const { key } = await req.json();
  if (!key?.trim()) return NextResponse.json({ error: "Пустой ключ" }, { status: 400 });
  const dir = path.dirname(KEY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(KEY_PATH, key.trim(), "utf-8");
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  if (fs.existsSync(KEY_PATH)) fs.unlinkSync(KEY_PATH);
  return NextResponse.json({ ok: true });
}
