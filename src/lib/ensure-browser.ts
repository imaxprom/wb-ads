/**
 * Ensures sniffer browser is running.
 * Auto-starts if not running and profile exists.
 */
import type { Page } from "puppeteer";
import { startSniffer } from "./wb-sniffer";

const g = globalThis as unknown as {
  __wbSniffBrowser?: import("puppeteer").Browser | null;
  __wbSniffPage?: Page | null;
  __wbSniffCmpPage?: Page | null;
  __wbSniffRunning?: boolean;
  __wbSniffAutoStarting?: boolean;
};

function liveBrowserBlockedByFreeze() {
  return (process.env.WB_ADS_FREEZE_MODE === "1" || process.env.WB_ADS_DISABLE_BACKGROUND_JOBS === "1")
    && process.env.WB_ADS_ALLOW_LIVE_BROWSER !== "1";
}

/** Return the cmp.wildberries.ru tab, creating it on demand if missing/closed. */
export async function ensureCmpPage(): Promise<{ page: Page | null; error?: string }> {
  if (liveBrowserBlockedByFreeze()) {
    return { page: null, error: "migration freeze: live WB browser is disabled" };
  }

  // Проверяем что cached page ещё жива (не закрыта через UI/crash)
  if (g.__wbSniffCmpPage && g.__wbSniffRunning) {
    try {
      if (!g.__wbSniffCmpPage.isClosed()) return { page: g.__wbSniffCmpPage };
    } catch { /* page object не валиден — создаём новую */ }
    g.__wbSniffCmpPage = null;
  }
  if (!g.__wbSniffBrowser) {
    const main = await ensureBrowser();
    if (!main.page) return { page: null, error: main.error };
  }
  if (!g.__wbSniffBrowser) return { page: null, error: "Браузер не запущен" };
  // Проверка что и сам browser ещё жив
  try { if (!g.__wbSniffBrowser.connected) { g.__wbSniffBrowser = null; g.__wbSniffRunning = false; g.__wbSniffPage = null; } } catch { /* */ }
  if (!g.__wbSniffBrowser) {
    const main = await ensureBrowser();
    if (!main.page) return { page: null, error: main.error };
  }
  try {
    const cmpPage = await g.__wbSniffBrowser!.newPage();
    await cmpPage.setViewport({ width: 1400, height: 850 });
    await cmpPage.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    await cmpPage.goto("https://cmp.wildberries.ru/campaigns/list", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    g.__wbSniffCmpPage = cmpPage;
    return { page: cmpPage };
  } catch (e) {
    return { page: null, error: `ensureCmpPage: ${e instanceof Error ? e.message : e}` };
  }
}

export async function ensureBrowser(): Promise<{ page: Page | null; error?: string }> {
  if (liveBrowserBlockedByFreeze()) {
    return { page: null, error: "migration freeze: live WB browser is disabled" };
  }

  // Already running — но проверяем что page не закрыта
  if (g.__wbSniffPage && g.__wbSniffRunning) {
    try {
      if (!g.__wbSniffPage.isClosed()) return { page: g.__wbSniffPage };
    } catch { /* */ }
    // seller page мертва — сбросить флаги и auto-start заново
    g.__wbSniffPage = null;
    g.__wbSniffRunning = false;
  }

  // Prevent concurrent auto-starts
  if (g.__wbSniffAutoStarting) {
    return { page: null, error: "Браузер запускается..." };
  }

  // Try to auto-start
  g.__wbSniffAutoStarting = true;
  console.log("[ensure-browser] Auto-starting sniffer browser...");

  try {
    const result = await startSniffer();
    if (!result.ok) {
      return { page: null, error: result.error };
    }

    // Wait a moment for page to settle
    await new Promise((r) => setTimeout(r, 2000));

    if (g.__wbSniffPage && g.__wbSniffRunning) {
      console.log("[ensure-browser] Browser auto-started successfully.");
      return { page: g.__wbSniffPage };
    }

    return { page: null, error: "Браузер запустился, но страница не готова" };
  } catch (err) {
    return { page: null, error: `Ошибка автозапуска: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    g.__wbSniffAutoStarting = false;
  }
}
