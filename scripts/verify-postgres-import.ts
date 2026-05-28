import fs from "node:fs";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { Client } from "pg";

type SqliteColumn = { name: string; type: string; pk: number };

const SQLITE_PATH = process.env.SQLITE_PATH || "data/backups/ads.freeze-20260527-2242-msk.db";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

function qi(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

function normalizeValue(value: unknown, col: SqliteColumn) {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return { __blob: value.toString("base64") };
  const type = (col.type || "").toUpperCase();
  if (type.includes("INT")) return Number(value);
  if (type.includes("REAL") || type.includes("FLOA") || type.includes("DOUB")) return Number(value);
  return value;
}

function hashRows(rows: Iterable<Record<string, unknown>>, cols: SqliteColumn[]) {
  const hash = crypto.createHash("sha256");
  let count = 0;
  for (const row of rows) {
    const normalized: Record<string, unknown> = {};
    for (const col of cols) normalized[col.name] = normalizeValue(row[col.name], col);
    hash.update(JSON.stringify(normalized) + "\n");
    count++;
  }
  return { count, sha256: hash.digest("hex") };
}

async function main() {
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();

  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];

  const report: {
    sqlitePath: string;
    checkedAt: string;
    tables: { name: string; sqliteCount: number; pgCount: number; sqliteSha256: string; pgSha256: string; ok: boolean }[];
  } = { sqlitePath: SQLITE_PATH, checkedAt: new Date().toISOString(), tables: [] };

  for (const table of tables) {
    const cols = sqlite.prepare(`PRAGMA table_info(${qi(table.name)})`).all() as SqliteColumn[];
    const pkCols = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    const orderCols = pkCols.length ? pkCols : cols.map((c) => c.name);
    const order = orderCols.map(qi).join(", ");
    const sqliteHash = hashRows(
      sqlite.prepare(`SELECT * FROM ${qi(table.name)} ORDER BY ${order}`).iterate() as Iterable<Record<string, unknown>>,
      cols,
    );
    const pgRows = await pg.query(`SELECT * FROM ${qi(table.name)} ORDER BY ${order}`);
    const pgHash = hashRows(pgRows.rows, cols);
    const ok = sqliteHash.count === pgHash.count && sqliteHash.sha256 === pgHash.sha256;
    report.tables.push({
      name: table.name,
      sqliteCount: sqliteHash.count,
      pgCount: pgHash.count,
      sqliteSha256: sqliteHash.sha256,
      pgSha256: pgHash.sha256,
      ok,
    });
    console.log(`${table.name}|sqlite=${sqliteHash.count}|pg=${pgHash.count}|${ok ? "ok" : "diff"}`);
  }

  fs.mkdirSync("data/migration", { recursive: true });
  fs.writeFileSync("data/migration/postgres-verify-report-20260527-2242-msk.json", JSON.stringify(report, null, 2));
  await pg.end();

  const diffs = report.tables.filter((t) => !t.ok);
  if (diffs.length) throw new Error(`Verification failed for ${diffs.length} tables`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
