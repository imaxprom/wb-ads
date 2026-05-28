import { NextRequest, NextResponse } from "next/server";
import { startSniffer, stopSniffer, getSnifferLog, getSnifferStatus, clearSnifferLog } from "@/lib/wb-sniffer";
import { auditMutation, checkRateLimit, rateLimitKey } from "@/lib/security";

// POST /api/wb/sniff — start sniffer
export async function POST(request: NextRequest) {
  const rl = checkRateLimit(rateLimitKey(request, "wb-sniff-start"), 5, 10 * 60 * 1000);
  if (!rl.ok) {
    auditMutation(request, { action: "wb-sniff-start", targetType: "wb-sniff", status: "blocked", details: { reason: "rate_limit", retryAfterSec: rl.retryAfterSec } });
    return NextResponse.json({ ok: false, error: "rate limit", retryAfterSec: rl.retryAfterSec }, { status: 429 });
  }
  auditMutation(request, { action: "wb-sniff-start", targetType: "wb-sniff", status: "accepted" });
  const result = await startSniffer();
  auditMutation(request, { action: "wb-sniff-start", targetType: "wb-sniff", status: result.ok ? "success" : "failed", details: result.error ? { error: result.error } : undefined });
  return NextResponse.json(result);
}

// GET /api/wb/sniff — get status + log
export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode");
  if (mode === "status") return NextResponse.json(getSnifferStatus());
  if (mode === "clear") return NextResponse.json(clearSnifferLog());
  return NextResponse.json(getSnifferLog());
}

// DELETE /api/wb/sniff — stop sniffer (closes browser!)
export async function DELETE(request: NextRequest) {
  const result = await stopSniffer();
  auditMutation(request, { action: "wb-sniff-stop", targetType: "wb-sniff", status: "success", details: { captured: result.captured } });
  return NextResponse.json(result);
}
