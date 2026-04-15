import fs from "fs";
import path from "path";

export function getApiKey(): string {
  const p = path.join(process.cwd(), "data", "wb-api-key.txt");
  return fs.readFileSync(p, "utf-8").trim();
}
