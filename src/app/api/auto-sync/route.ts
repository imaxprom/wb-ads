import { NextResponse } from "next/server";
import { getAutoSyncStatus, reloadAutoSync, startAutoSyncServer } from "@/lib/auto-sync-server";

export const dynamic = "force-dynamic";

// Initialize server auto-sync on first request
startAutoSyncServer();

// GET — status (polled by dashboard)
export async function GET() {
  return NextResponse.json(getAutoSyncStatus());
}

// POST — reload settings (called when user changes auto-sync settings)
export async function POST() {
  reloadAutoSync();
  return NextResponse.json({ ok: true, ...getAutoSyncStatus() });
}
