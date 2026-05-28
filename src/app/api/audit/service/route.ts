import { NextRequest, NextResponse } from "next/server";
import { runServiceAudit } from "@/lib/service-audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const includeExternal = sp.get("external") === "1";
  const externalLimit = Number(sp.get("limit") || "10");
  const report = await runServiceAudit({ includeExternal, externalLimit });
  return NextResponse.json(report, { status: report.ok ? 200 : 500 });
}
