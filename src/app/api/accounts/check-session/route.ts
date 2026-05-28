import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBrowser, ensureCmpPage } from "@/lib/ensure-browser";
import type { Page } from "puppeteer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const g = globalThis as unknown as {
  __wbSniffPage?: Page | null;
  __wbSniffCmpPage?: Page | null;
  __wbSniffRunning?: boolean;
};

async function pingSeller(page: Page): Promise<number | string> {
  try {
    if (!page.url().includes("wildberries.ru")) {
      await page.goto("https://seller.wildberries.ru/", { waitUntil: "domcontentloaded", timeout: 20000 });
    }
  } catch { /* try fetch anyway */ }
  return await page.evaluate(async () => {
    try {
      const tok = localStorage.getItem("wb-eu-passport-v2.access-token") || "";
      const res = await fetch("https://seller.wildberries.ru/ns/passport-portal/suppliers-portal-ru/validate", {
        method: "GET",
        credentials: "include",
        headers: { "Accept": "*/*", "Authorizev3": tok },
      });
      return res.status;
    } catch (e) { return String(e); }
  });
}

async function pingCmp(page: Page): Promise<number | string> {
  try {
    if (!page.url().includes("cmp.wildberries.ru")) {
      await page.goto("https://cmp.wildberries.ru/campaigns/list", { waitUntil: "domcontentloaded", timeout: 20000 });
    }
  } catch { /* try fetch anyway */ }
  return await page.evaluate(async () => {
    try {
      const tok = localStorage.getItem("access-token") || "";
      const res = await fetch("https://cmp.wildberries.ru/api/v5/configvalues", {
        method: "GET",
        credentials: "include",
        headers: { "Accept": "*/*", "Authorizev3": tok },
      });
      return res.status;
    } catch (e) { return String(e); }
  });
}

export async function POST() {
  const db = getDb();

  const sellerAuto = await ensureBrowser();
  const cmpAuto = await ensureCmpPage();
  const sellerPage = sellerAuto.page;
  const cmpPage = cmpAuto.page;

  const sellerStatus = sellerPage ? await pingSeller(sellerPage) : (sellerAuto.error || "no page");
  const cmpStatus = cmpPage ? await pingCmp(cmpPage) : (cmpAuto.error || "no page");

  const sellerAlive = sellerStatus === 200;
  const cmpAlive = cmpStatus === 200;
  const allAlive = sellerAlive && cmpAlive;

  let connection: string;
  if (allAlive) connection = "Активен";
  else if (sellerAlive) connection = "Реклама недоступна";
  else if (cmpAlive) connection = "Джем недоступен";
  else connection = "Нет соединения";

  db.prepare("UPDATE accounts SET connection = ?, last_check_at = datetime('now')").run(connection);

  return NextResponse.json({
    ok: true,
    alive: allAlive,
    connection,
    seller: { alive: sellerAlive, status: sellerStatus },
    cmp: { alive: cmpAlive, status: cmpStatus },
  });
}
