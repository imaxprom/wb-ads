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
  const headers: Record<string, string> = {
    Origin: base,
    "Sec-Fetch-Site": "same-origin",
  };
  if (process.env.WB_ADS_LOCAL_TOKEN) headers["x-local-token"] = process.env.WB_ADS_LOCAL_TOKEN;

  const results: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const step of STEPS) {
    const name = step.split("?")[0];
    try {
      const res = await fetch(`${base}/api/sync/${step}`, { method: "POST", headers });
      const data = await res.json();
      results[name] = data;
      if (!res.ok || data?.ok === false || data?.error || (Array.isArray(data?.errors) && data.errors.length > 0)) {
        errors.push(`${name}: ${data?.error || (Array.isArray(data?.errors) ? `${data.errors.length} errors` : `HTTP ${res.status}`)}`);
      }
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({ ok: errors.length === 0, ...results, errors }, { status: errors.length === 0 ? 200 : 502 });
}
