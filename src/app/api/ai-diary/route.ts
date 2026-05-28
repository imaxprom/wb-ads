import { NextRequest, NextResponse } from "next/server";
import { createAiDiaryEntry, listAiDiaryEntries } from "@/lib/ai-diary";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

function readParams(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  return {
    advertId: Number(sp.get("advertId") || "0"),
    nmId: Number(sp.get("nmId") || "0"),
    phrase: String(sp.get("phrase") || "").trim(),
    limit: Number(sp.get("limit") || "20"),
  };
}

export async function GET(request: NextRequest) {
  const { advertId, nmId, phrase, limit } = readParams(request);
  if (!advertId || !nmId) {
    return NextResponse.json({ ok: false, error: "advertId and nmId required" }, { status: 400 });
  }
  const entries = listAiDiaryEntries({ advertId, nmId, phrase, limit });
  return NextResponse.json({ ok: true, entries });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as {
    advertId?: number;
    nmId?: number;
    phrase?: string;
  } | null;
  const advertId = Number(body?.advertId || 0);
  const nmId = Number(body?.nmId || 0);
  const phrase = String(body?.phrase || "").trim();
  if (!advertId || !nmId || !phrase) {
    return NextResponse.json({ ok: false, error: "advertId, nmId and phrase required" }, { status: 400 });
  }

  let entry = createAiDiaryEntry({ advertId, nmId, phrase, source: "manual" });
  if (process.env.AI_DIARY_PROVIDER === "cli") {
    const { maybeEnhanceDiaryEntryWithCli } = await import("@/lib/ai-diary-cli");
    entry = await maybeEnhanceDiaryEntryWithCli(entry);
  }
  return NextResponse.json({ ok: true, entry });
}
