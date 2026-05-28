import { NextResponse } from "next/server";

const g = globalThis as unknown as {
  __wbSniffPage?: import("puppeteer").Page | null;
  __wbSniffCmpPage?: import("puppeteer").Page | null;
  __wbSniffRunning?: boolean;
};

export const dynamic = "force-dynamic";

export async function GET() {
  const sellerPage = g.__wbSniffPage;
  const cmpPage = g.__wbSniffCmpPage;

  async function describe(page: import("puppeteer").Page | null | undefined) {
    if (!page) return { url: null };
    try {
      const url = page.url();
      const cookies = await page.cookies(url);
      const ls = await page.evaluate(() => {
        const keys: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)!;
          const v = localStorage.getItem(k) || "";
          keys[k] = v.length > 50 ? v.slice(0, 50) + `... (${v.length})` : v;
        }
        return keys;
      }).catch(() => ({}));
      return {
        url,
        hasAuthCookie: cookies.some((c) => c.name === "authorizev3"),
        hasWBToken: cookies.some((c) => c.name === "WBTokenV3"),
        supplierIdCookie: cookies.find((c) => c.name === "x-supplier-id")?.value,
        cookieCount: cookies.length,
        localStorage: ls,
      };
    } catch (e) { return { url: null, error: String(e) }; }
  }

  return NextResponse.json({
    running: g.__wbSniffRunning || false,
    seller: await describe(sellerPage),
    cmp: await describe(cmpPage),
  });
}
