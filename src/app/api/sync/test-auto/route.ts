import { NextResponse } from "next/server";
import { getTestSyncStatus, reloadTestSync, startAutoSyncServer } from "@/lib/auto-sync-server";

export const dynamic = "force-dynamic";

const PROXY_URL = process.env.WB_ADS_TEST_AUTO_PROXY_URL;

function frozenStatus() {
  return {
    enabled: false,
    running: false,
    intervalMinutes: 0,
    nextRunAt: null,
    lastRunAt: null,
    freeze: true,
  };
}

async function proxyToWorker(method: "GET" | "POST") {
  if (!PROXY_URL) return null;
  try {
    const headers: Record<string, string> = {
      Origin: new URL(PROXY_URL).origin,
      "Sec-Fetch-Site": "same-origin",
    };
    if (process.env.WB_ADS_LOCAL_TOKEN) headers["x-local-token"] = process.env.WB_ADS_LOCAL_TOKEN;
    const res = await fetch(PROXY_URL, { method, headers });
    const data = await res.json().catch(() => ({ ok: false, error: "worker response parse error" }));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, enabled: false, running: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}

export async function GET() {
  if (process.env.WB_ADS_DISABLE_BACKGROUND_JOBS === "1" || process.env.WB_ADS_FREEZE_MODE === "1") {
    return NextResponse.json(frozenStatus());
  }
  const proxied = await proxyToWorker("GET");
  if (proxied) return proxied;
  startAutoSyncServer();
  return NextResponse.json(getTestSyncStatus());
}

export async function POST() {
  if (process.env.WB_ADS_DISABLE_BACKGROUND_JOBS === "1" || process.env.WB_ADS_FREEZE_MODE === "1") {
    return NextResponse.json({ ok: false, ...frozenStatus(), error: "migration freeze: test auto-sync disabled" }, { status: 423 });
  }
  const proxied = await proxyToWorker("POST");
  if (proxied) return proxied;
  startAutoSyncServer();
  reloadTestSync();
  return NextResponse.json({ ok: true, ...getTestSyncStatus() });
}
