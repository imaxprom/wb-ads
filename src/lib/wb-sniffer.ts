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
  __wbSniffPage?: Page | null;
  __wbSniffLog?: SniffEntry[];
  __wbSniffRunning?: boolean;
};

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
  if (g.__wbSniffRunning) return { ok: false, error: "Снифер уже запущен" };

  // Check if chrome-profile already has a session (subsequent launches)
  const hasProfile = fs.existsSync(path.join(PROFILE_DIR, "Default"));
  const tokens = loadTokens();

  // First launch requires tokens; subsequent launches use saved profile
  if (!hasProfile && !tokens) {
    return { ok: false, error: "Нет токенов авторизации. Сначала авторизуйтесь." };
  }

  try {
    // Launch Chrome with persistent profile
    const browser = await puppeteer.launch({
      headless: false,
      userDataDir: PROFILE_DIR,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1400,900",
      ],
    });
    g.__wbSniffBrowser = browser;

    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 850 });

    // Hide Puppeteer/automation markers from anti-bot detection
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    g.__wbSniffPage = page;

    // Set auth cookies from saved tokens (first launch or refreshing session)
    if (tokens?.authorizev3) {
      console.log("[wb-sniffer] Setting auth cookies from saved tokens...");
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

    g.__wbSniffRunning = true;

    // Navigate directly to seller portal (start page)
    console.log("[wb-sniffer] Opening seller.wildberries.ru...");
    await page.goto("https://seller.wildberries.ru/", {
      waitUntil: "networkidle2",
      timeout: 30000,
    }).catch(() => {});

    // Inject access token into localStorage if we have it from tokens
    if (tokens?.authorizev3) {
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

    // Handle browser close by user
    browser.on("disconnected", () => {
      console.log("[wb-sniffer] Browser closed.");
      g.__wbSniffBrowser = null;
      g.__wbSniffPage = null;
      g.__wbSniffRunning = false;
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Ошибка: ${err instanceof Error ? err.message : err}` };
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
