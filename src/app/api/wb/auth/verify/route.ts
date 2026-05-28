import { NextRequest, NextResponse } from "next/server";
import { cdpSubmitCode } from "@/lib/wb-auth-cdp";
import { reseedFromTokens, startSniffer } from "@/lib/wb-sniffer";

const g = globalThis as unknown as {
  __wbSniffRunning?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const { code } = await req.json();
    if (!code) return NextResponse.json({ ok: false, step: "error", error: "Укажите код" }, { status: 400 });
    const result = await cdpSubmitCode(code);

    // If auth succeeded — propagate fresh tokens into the running sniffer so
    // sync endpoints pick them up immediately without a manual restart.
    if (result.ok && result.step === "authenticated") {
      try {
        if (g.__wbSniffRunning) {
          await reseedFromTokens();
        } else {
          await startSniffer(); // fresh profile or first launch — seeds automatically
        }
      } catch (e) {
        console.warn("[auth/verify] reseed failed:", e);
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, step: "error", error: String(err) }, { status: 500 });
  }
}
