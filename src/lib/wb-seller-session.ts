import fs from "fs";
import path from "path";

export type SavedSellerSession = {
  authorizev3: string;
  cookieHeader: string;
  supplierId: string;
};

type ExportedCookie = {
  name: string;
  value: string;
};

type ExportedSession = {
  storage?: Record<string, string>;
  cookies?: ExportedCookie[];
};

export function loadSavedSellerSession(): SavedSellerSession | null {
  const file = path.join(process.cwd(), "data", "wb-seller-session-import.json");
  if (!fs.existsSync(file)) return null;

  try {
    const session = JSON.parse(fs.readFileSync(file, "utf8")) as ExportedSession;
    const authorizev3 = session.storage?.["wb-eu-passport-v2.access-token"] || "";
    const cookies = Array.isArray(session.cookies) ? session.cookies : [];
    const cookieHeader = cookies
      .filter((cookie) => cookie.name && cookie.value)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    const supplierId = cookies.find((cookie) => cookie.name === "x-supplier-id")?.value || "";

    if (!authorizev3 || !cookieHeader) return null;
    return { authorizev3, cookieHeader, supplierId };
  } catch (error) {
    console.warn("[wb-seller-session] failed to load saved session:", error instanceof Error ? error.message : error);
    return null;
  }
}
