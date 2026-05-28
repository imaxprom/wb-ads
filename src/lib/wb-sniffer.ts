/**
 * WB HTTP Sniffer — opens Chrome with persistent profile,
 * intercepts network requests via CDP.
 * On first launch: sets auth cookies from saved tokens.
 * On subsequent launches: reuses saved session from chrome-profile.
 */
import puppeteer, { type Browser, type Page } from "puppeteer";
import fs from "fs";
import path from "path";
import { loadTokens } from "./wb-seller-api";

const DATA_DIR = path.join(process.cwd(), "data");
const LOG_PATH = path.join(DATA_DIR, "wb-sniff-log.json");
const PROFILE_DIR = path.join(DATA_DIR, "chrome-profile");

interface SniffEntry {
  timestamp: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  responseStatus: number;
  responseBody: string | null;
  responseSize: number;
}

// Singleton
const g = globalThis as unknown as {
  __wbSniffBrowser?: Browser | null;
  __wbSniffPage?: Page | null;       // seller.wildberries.ru tab
  __wbSniffCmpPage?: Page | null;    // cmp.wildberries.ru tab
  __wbSniffLog?: SniffEntry[];
  __wbSniffRunning?: boolean;
};

async function adoptBrowser(browser: Browser): Promise<void> {
  g.__wbSniffBrowser = browser;
  const existingPages = await browser.pages();

  let sellerPage = existingPages.find((p) => p.url().includes("seller.wildberries.ru"));
  if (!sellerPage) sellerPage = existingPages[0] || await browser.newPage();
  await sellerPage.setViewport({ width: 1400, height: 850 }).catch(() => {});
  g.__wbSniffPage = sellerPage;

  let cmpPage = existingPages.find((p) => p.url().includes("cmp.wildberries.ru"));
  if (!cmpPage) {
    cmpPage = await browser.newPage();
    await cmpPage.setViewport({ width: 1400, height: 850 }).catch(() => {});
    await cmpPage.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    }).catch(() => {});
    await cmpPage.goto("https://cmp.wildberries.ru/campaigns/list", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    }).catch(() => {});
  }
  g.__wbSniffCmpPage = cmpPage;
  g.__wbSniffRunning = true;

  browser.on("disconnected", () => {
    console.log("[wb-sniffer] Browser closed.");
    g.__wbSniffBrowser = null;
    g.__wbSniffPage = null;
    g.__wbSniffCmpPage = null;
    g.__wbSniffRunning = false;
  });
}

async function connectExistingBrowser(): Promise<boolean> {
  const activePortPath = path.join(PROFILE_DIR, "DevToolsActivePort");
  if (!fs.existsSync(activePortPath)) return false;
  try {
    const [port, pathPart] = fs.readFileSync(activePortPath, "utf8").trim().split(/\r?\n/);
    if (!port || !pathPart) return false;
    const browserWSEndpoint = `ws://127.0.0.1:${port}${pathPart}`;
    const browser = await puppeteer.connect({ browserWSEndpoint });
    await adoptBrowser(browser);
    console.log("[wb-sniffer] Reconnected to existing Chrome for Testing.");
    return true;
  } catch (e) {
    console.warn("[wb-sniffer] Failed to reconnect existing browser:", e);
    return false;
  }
}

function getLog(): SniffEntry[] {
  if (!g.__wbSniffLog) g.__wbSniffLog = [];
  return g.__wbSniffLog;
}

function saveLog() {
  const log = getLog();
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

export async function startSniffer(): Promise<{ ok: boolean; error?: string }> {
  if (g.__wbSniffRunning) return { ok: true };

  if (await connectExistingBrowser()) return { ok: true };

  // Check if chrome-profile already has a session (subsequent launches)
  const hasProfile = fs.existsSync(path.join(PROFILE_DIR, "Default"));
  const tokens = loadTokens();

  // Allow launching with empty profile AND no tokens — user will log in manually
  // in the Chromium window. First launch used to require tokens, but that blocked
  // the clean-slate recovery flow.

  try {
    // Launch Chrome with persistent profile
    const browser = await puppeteer.launch({
      headless: process.env.WB_ADS_HEADLESS_BROWSER === "1",
      userDataDir: PROFILE_DIR,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1400,900",
      ],
    });
    // Reuse the initial blank tab Puppeteer opens on launch instead of
    // creating a new one (otherwise we end up with an extra about:blank).
    const existingPages = await browser.pages();
    const page = existingPages[0] || await browser.newPage();
    await page.setViewport({ width: 1400, height: 850 });

    // Hide Puppeteer/automation markers from anti-bot detection
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    g.__wbSniffPage = page;

    // Seed cookies from data/wb-tokens.json when either:
    //  - profile is empty (first launch, no cookies yet), or
    //  - tokens file was updated recently (fresh phone-auth within 10 min) —
    //    phone-auth writes fresh tokens and expects sniffer to adopt them.
    // Otherwise we skip seeding so a manually-authenticated Chromium session
    // isn't overwritten by an older file.
    const tokensPath = path.join(DATA_DIR, "wb-tokens.json");
    const tokensFresh = (() => {
      try {
        const mt = fs.statSync(tokensPath).mtimeMs;
        return Date.now() - mt < 10 * 60 * 1000; // < 10 min
      } catch { return false; }
    })();
    const shouldSeed = (!hasProfile || tokensFresh) && !!tokens?.authorizev3;
    if (shouldSeed && tokens?.authorizev3) {
      console.log("[wb-sniffer] First launch: seeding auth cookies from saved tokens...");
      const domains = [".wildberries.ru", "seller.wildberries.ru", "seller-auth.wildberries.ru"];
      const cookieParts = (tokens.cookies || "").split("; ").filter(Boolean);

      for (const domain of domains) {
        await page.setCookie(
          { name: "WBTokenV3", value: tokens.authorizev3, domain, path: "/" },
          { name: "authorizev3", value: tokens.authorizev3, domain, path: "/" },
        );
        for (const part of cookieParts) {
          const [name, ...valueParts] = part.split("=");
          const value = valueParts.join("=");
          if (name && value) {
            await page.setCookie({ name, value, domain, path: "/" });
          }
        }
      }
    } else if (hasProfile) {
      console.log("[wb-sniffer] Reusing saved session from chrome-profile");
    }

    // CDP sniffer disabled — not needed for sync (page.evaluate handles requests)
    // Can be re-enabled via startSnifferCDP() when manual traffic analysis is needed
    g.__wbSniffLog = [];

    g.__wbSniffBrowser = browser;
    g.__wbSniffRunning = true;

    // Navigate directly to seller portal (start page)
    console.log("[wb-sniffer] Opening seller.wildberries.ru...");
    await page.goto("https://seller.wildberries.ru/", {
      waitUntil: "networkidle2",
      timeout: 30000,
    }).catch(() => {});

    // Inject access token into localStorage under the same "fresh or first launch" rule
    if (shouldSeed && tokens?.authorizev3) {
      await page.evaluate((token: string) => {
        try { localStorage.setItem("wb-eu-passport-v2.access-token", token); } catch {}
      }, tokens.authorizev3).catch(() => {});
    }

    // Check if authenticated
    const url = page.url();
    if (url.includes("about-portal") || url.includes("seller-auth")) {
      console.log("[wb-sniffer] Session expired. Trying auth page...");

      console.log("[wb-sniffer] Not authenticated. Please log in manually in the browser window.");
    } else {
      console.log("[wb-sniffer] Authenticated. Ready.");
    }

    // Open a second tab for cmp.wildberries.ru so ads syncs don't have to navigate
    // back and forth between seller.wildberries.ru and cmp.wildberries.ru.
    try {
      const cmpPage = await browser.newPage();
      await cmpPage.setViewport({ width: 1400, height: 850 });
      await cmpPage.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });
      await cmpPage.goto("https://cmp.wildberries.ru/campaigns/list", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      }).catch(() => {});
      g.__wbSniffCmpPage = cmpPage;
      console.log("[wb-sniffer] Second tab opened at cmp.wildberries.ru.");
    } catch (e) {
      console.warn("[wb-sniffer] Failed to open cmp tab:", e);
    }

    // Handle browser close by user
    browser.on("disconnected", () => {
      console.log("[wb-sniffer] Browser closed.");
      g.__wbSniffBrowser = null;
      g.__wbSniffPage = null;
      g.__wbSniffCmpPage = null;
      g.__wbSniffRunning = false;
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Ошибка: ${err instanceof Error ? err.message : err}` };
  }
}

/**
 * Seed fresh tokens from data/wb-tokens.json into the currently running sniffer.
 * Used after the phone-auth flow (wb-auth-cdp.ts) writes new tokens — otherwise
 * the sniffer keeps using stale cookies from its profile.
 */
export async function reseedFromTokens(): Promise<{ ok: boolean; error?: string }> {
  const tokens = loadTokens();
  if (!tokens?.authorizev3) return { ok: false, error: "Нет wb-tokens.json" };
  const page = g.__wbSniffPage;
  const cmpPage = g.__wbSniffCmpPage;
  if (!page) return { ok: false, error: "Sniffer не запущен" };

  const domains = [".wildberries.ru", "seller.wildberries.ru", "seller-auth.wildberries.ru", "cmp.wildberries.ru"];
  const cookieParts = (tokens.cookies || "").split("; ").filter(Boolean);

  for (const domain of domains) {
    await page.setCookie(
      { name: "WBTokenV3", value: tokens.authorizev3, domain, path: "/" },
      { name: "authorizev3", value: tokens.authorizev3, domain, path: "/" },
    );
    for (const part of cookieParts) {
      const [name, ...valueParts] = part.split("=");
      const value = valueParts.join("=");
      if (name && value) {
        await page.setCookie({ name, value, domain, path: "/" });
      }
    }
  }

  try {
    await page.goto("https://seller.wildberries.ru/", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.evaluate((token: string) => {
      try { localStorage.setItem("wb-eu-passport-v2.access-token", token); } catch {}
    }, tokens.authorizev3);
  } catch { /* ignore */ }
  if (cmpPage) {
    try {
      await cmpPage.goto("https://cmp.wildberries.ru/campaigns/list", { waitUntil: "domcontentloaded", timeout: 20000 });
    } catch { /* ignore */ }
  }

  console.log("[wb-sniffer] Reseeded cookies from wb-tokens.json.");
  return { ok: true };
}

export async function reseedCmpFromSavedSession(): Promise<{ ok: boolean; error?: string }> {
  const file = path.join(DATA_DIR, "wb-cmp-session-import.json");
  if (!fs.existsSync(file)) return { ok: false, error: "Нет wb-cmp-session-import.json" };
  const page = g.__wbSniffPage;
  const cmpPage = g.__wbSniffCmpPage;
  if (!page || !cmpPage) return { ok: false, error: "Sniffer/CMP-вкладка не запущены" };

  try {
    const session = JSON.parse(fs.readFileSync(file, "utf8")) as {
      storage?: Record<string, string>;
      cookies?: {
        name: string;
        value: string;
        domain?: string;
        path?: string;
        expires?: number;
        httpOnly?: boolean;
        secure?: boolean;
        sameSite?: "Strict" | "Lax" | "None";
      }[];
    };
    const cookies = (session.cookies || [])
      .filter((c) => c.name && c.value)
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain || ".wildberries.ru",
        path: c.path || "/",
        expires: typeof c.expires === "number" && c.expires > 0 ? c.expires : undefined,
        httpOnly: Boolean(c.httpOnly),
        secure: Boolean(c.secure),
        sameSite: c.sameSite,
      }));
    if (cookies.length > 0) await page.setCookie(...cookies);

    await cmpPage.goto("https://cmp.wildberries.ru/campaigns/list", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    const storage = session.storage || {};
    await cmpPage.evaluate((entries: [string, string][]) => {
      for (const [key, value] of entries) {
        try { localStorage.setItem(key, value); } catch {}
      }
    }, Object.entries(storage));
    await cmpPage.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});

    console.log("[wb-sniffer] Reseeded CMP browser session from wb-cmp-session-import.json.");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `CMP reseed failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function stopSniffer(): Promise<{ ok: boolean; captured: number }> {
  const log = getLog();
  saveLog();

  const browser = g.__wbSniffBrowser;
  if (browser && browser.connected) {
    await browser.close().catch(() => {});
  }

  g.__wbSniffBrowser = null;
  g.__wbSniffPage = null;
  g.__wbSniffCmpPage = null;
  g.__wbSniffRunning = false;

  return { ok: true, captured: log.length };
}

export function getSnifferLog(): { running: boolean; entries: SniffEntry[] } {
  return {
    running: g.__wbSniffRunning || false,
    entries: getLog(),
  };
}

export function getSnifferStatus(): { running: boolean; captured: number } {
  return {
    running: g.__wbSniffRunning || false,
    captured: getLog().length,
  };
}

export function clearSnifferLog(): { ok: boolean; cleared: number } {
  const log = getLog();
  const count = log.length;
  g.__wbSniffLog = [];
  saveLog();
  return { ok: true, cleared: count };
}
