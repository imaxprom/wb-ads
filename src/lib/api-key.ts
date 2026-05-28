import fs from "fs";
import path from "path";

export function getApiKey(): string {
  const p = path.join(process.cwd(), "data", "wb-api-key.txt");
  return fs.readFileSync(p, "utf-8").trim();
}

export function getPricesApiKey(): string {
  const p = path.join(process.cwd(), "data", "wb-prices-api-key.txt");
  if (fs.existsSync(p)) {
    const key = fs.readFileSync(p, "utf-8").trim();
    if (key) return key;
  }
  return getApiKey();
}
