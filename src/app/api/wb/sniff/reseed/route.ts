import { NextResponse } from "next/server";
import { reseedCmpFromSavedSession, reseedFromTokens, startSniffer } from "@/lib/wb-sniffer";

const g = globalThis as unknown as {
  __wbSniffRunning?: boolean;
};

export const dynamic = "force-dynamic";

export async function POST() {
  if (!g.__wbSniffRunning) {
    const s = await startSniffer();
    if (!s.ok) return NextResponse.json(s);
  }
  const r = await reseedFromTokens();
  const cmp = await reseedCmpFromSavedSession();
  if (r.ok && cmp.ok) return NextResponse.json({ ok: true, seller: true, cmp: true });
  if (r.ok) return NextResponse.json({ ...r, seller: true, cmp: false, cmpError: cmp.error });
  return NextResponse.json(cmp.ok ? { ...cmp, seller: false, cmp: true, tokenError: r.error } : { ...cmp, tokenError: r.error });
}
