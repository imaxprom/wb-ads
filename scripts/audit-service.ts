import fs from "fs";
import path from "path";

function loadDefaultEnv() {
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) return;
  const envPath = path.join(process.cwd(), "data", "wb-ads-prod-db.env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function flagValue(name: string, fallback: number): number {
  const prefix = `${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

async function main() {
  loadDefaultEnv();
  const { formatAuditReport, runServiceAudit } = await import("../src/lib/service-audit");
  const includeExternal = hasFlag("--external");
  const json = hasFlag("--json");
  const externalLimit = flagValue("--limit", 10);
  const report = await runServiceAudit({ includeExternal, externalLimit });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatAuditReport(report));
  }
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
