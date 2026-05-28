import fs from "fs";
import path from "path";

export type SavedCmpSession = {
  authorizev3: string;
  supplierId: string;
  cookieHeader: string;
};

export const CMP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

type ExportedCookie = {
  name: string;
  value: string;
};

type ExportedSession = {
  storage?: Record<string, string>;
  cookies?: ExportedCookie[];
};

export function loadSavedCmpSession(): SavedCmpSession | null {
  const file = path.join(process.cwd(), "data", "wb-cmp-session-import.json");
  if (!fs.existsSync(file)) return null;

  try {
    const session = JSON.parse(fs.readFileSync(file, "utf8")) as ExportedSession;
    const authorizev3 = session.storage?.["access-token"] || "";
    const cookies = Array.isArray(session.cookies) ? session.cookies : [];
    const cookieHeader = cookies
      .filter((cookie) => cookie.name && cookie.value)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    const supplierId =
      cookies.find((cookie) => cookie.name === "x-supplier-id")?.value ||
      cookies.find((cookie) => cookie.name === "x-supplier-id-external")?.value ||
      "";

    if (!authorizev3 || !supplierId || !cookieHeader) return null;
    return { authorizev3, supplierId, cookieHeader };
  } catch (error) {
    console.warn("[wb-cmp-session] failed to load saved session:", error instanceof Error ? error.message : error);
    return null;
  }
}
