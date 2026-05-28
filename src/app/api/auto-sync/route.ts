import { NextResponse } from "next/server";
import { getAutoSyncStatus, reloadAutoSync, startAutoSyncServer } from "@/lib/auto-sync-server";

export const dynamic = "force-dynamic";

function frozenStatus() {
  return {
    enabled: false,
    running: false,
    intervalMinutes: 0,
    nextRunAt: null,
    startedAt: null,
    lastRunAt: null,
    freeze: true,
  };
}

// GET — status and lazy scheduler init, controlled by DB settings (`auto_sync_enabled`).
export async function GET() {
  if (process.env.WB_ADS_DISABLE_BACKGROUND_JOBS === "1" || process.env.WB_ADS_FREEZE_MODE === "1") {
    return NextResponse.json(frozenStatus());
  }
  startAutoSyncServer();
  return NextResponse.json(getAutoSyncStatus());
}

// POST — reload settings (called when user changes auto-sync settings)
export async function POST() {
  if (process.env.WB_ADS_DISABLE_BACKGROUND_JOBS === "1" || process.env.WB_ADS_FREEZE_MODE === "1") {
    return NextResponse.json({ ok: false, ...frozenStatus(), error: "migration freeze: auto-sync disabled" }, { status: 423 });
  }
  startAutoSyncServer();
  reloadAutoSync();
  return NextResponse.json({ ok: true, ...getAutoSyncStatus() });
}
