/**
 * Ensures sniffer browser is running.
 * Auto-starts if not running and profile exists.
 */
import type { Page } from "puppeteer";
import { startSniffer } from "./wb-sniffer";

const g = globalThis as unknown as {
  __wbSniffPage?: Page | null;
  __wbSniffRunning?: boolean;
  __wbSniffAutoStarting?: boolean;
};

export async function ensureBrowser(): Promise<{ page: Page | null; error?: string }> {
  // Already running
  if (g.__wbSniffPage && g.__wbSniffRunning) {
    return { page: g.__wbSniffPage };
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
