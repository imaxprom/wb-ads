import { NextResponse } from "next/server";

const g = globalThis as unknown as {
  __wbSniffPage?: import("puppeteer").Page | null;
  __wbSniffLog?: { url: string; requestHeaders: Record<string, string> }[];
};

export async function GET() {
  const page = g.__wbSniffPage;
  if (!page) return NextResponse.json({ error: "No sniffer page" });

  // Get authorizev3 from log
  const log = g.__wbSniffLog || [];
  let authToken = "";
  for (const e of log) {
    if (e.requestHeaders?.AuthorizeV3) { authToken = e.requestHeaders.AuthorizeV3; break; }
  }
  if (!authToken) return NextResponse.json({ error: "AuthorizeV3 not found in log" });

  // Step 1: Refresh wb-seller-lk from inside the browser
  let result: unknown;
  try {
    result = await page.evaluate(async (auth: string) => {
      // 1. Refresh token
      const refreshRes = await fetch(
        "https://seller.wildberries.ru/ns/suppliers-auth/suppliers-portal-core/auth/token",
        {
          method: "POST",
          headers: { "content-type": "application/json", "authorizev3": auth },
          body: JSON.stringify({ params: {}, jsonrpc: "2.0", id: "json-rpc_1" }),
        }
      );
      const refreshData = await refreshRes.json();
      const freshLk = refreshData?.result?.data?.token || refreshData?.result?.token || "";
      if (!freshLk) return { error: "refresh failed", data: refreshData };

      // 2. Now fetch funnel data with fresh token
      const dataRes = await fetch(
        "https://seller-content.wildberries.ru/ns/analytics-api/content-analytics/api/v1/sales-funnel/report/product/history",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "AuthorizeV3": auth,
            "Wb-Seller-Lk": freshLk,
          },
          body: JSON.stringify({ nmID: 322000486, currentPeriod: { start: "2026-04-10", end: "2026-04-13" } }),
        }
      );
      const text = await dataRes.text();
      return { status: dataRes.status, body: text.slice(0, 500), lkObtained: !!freshLk };
    }, authToken);
  } catch (e) {
    return NextResponse.json({ error: `evaluate error: ${e}` });
  }

  return NextResponse.json(result);
}
