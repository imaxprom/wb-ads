import { NextResponse } from "next/server";

const STEPS = [
  "campaigns",
  "products",
  "stocks",
  "stats",
  "balance",
  "clusters",
  "funnel?days=1",  // only today — fast
];

export async function POST(request: Request) {
  const base = new URL(request.url).origin;
  const results: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const step of STEPS) {
    const name = step.split("?")[0];
    try {
      const res = await fetch(`${base}/api/sync/${step}`, { method: "POST" });
      results[name] = await res.json();
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({ ok: true, ...results, errors });
}
