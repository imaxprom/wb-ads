import { NextRequest, NextResponse } from "next/server";
import { cdpSendPhone, cdpCheckSession, cdpLogout } from "@/lib/wb-auth-cdp";
import { auditMutation, checkRateLimit, rateLimitKey } from "@/lib/security";

export async function POST(req: NextRequest) {
  try {
    const { phone } = await req.json();
    if (!phone) return NextResponse.json({ ok: false, step: "error", error: "Укажите номер телефона" }, { status: 400 });
    const rl = checkRateLimit(rateLimitKey(req, "wb-auth-phone"), 3, 10 * 60 * 1000);
    if (!rl.ok) {
      auditMutation(req, { action: "wb-auth-phone", targetType: "wb-auth", status: "blocked", details: { reason: "rate_limit", retryAfterSec: rl.retryAfterSec } });
      return NextResponse.json({ ok: false, step: "error", error: "rate limit", retryAfterSec: rl.retryAfterSec }, { status: 429 });
    }
    auditMutation(req, { action: "wb-auth-phone", targetType: "wb-auth", status: "accepted", details: { phoneMasked: String(phone).replace(/\d(?=\d{2})/g, "*") } });
    const result = await cdpSendPhone(phone);
    auditMutation(req, { action: "wb-auth-phone", targetType: "wb-auth", status: result.ok ? "success" : "failed", details: { step: result.step } });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, step: "error", error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const result = await cdpCheckSession();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    cdpLogout();
    auditMutation(req, { action: "wb-auth-logout", targetType: "wb-auth", status: "success" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
