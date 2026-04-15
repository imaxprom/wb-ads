import { NextRequest, NextResponse } from "next/server";
import { startSniffer, stopSniffer, getSnifferLog, getSnifferStatus, clearSnifferLog } from "@/lib/wb-sniffer";

// POST /api/wb/sniff — start sniffer
export async function POST() {
  const result = await startSniffer();
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
export async function DELETE() {
  const result = await stopSniffer();
  return NextResponse.json(result);
}
