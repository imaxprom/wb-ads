import fs from "node:fs";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { Client } from "pg";

type SqliteTable = { name: string; sql: string };
type SqliteColumn = {
  cid: number;
  name: string;
  type: string;
  notnull: 0 | 1;
  dflt_value: string | null;
  pk: number;
};

const SQLITE_PATH = process.env.SQLITE_PATH || "data/backups/ads.freeze-20260527-2242-msk.db";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

function qi(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

function pgType(col: SqliteColumn) {
  const t = (col.type || "").toUpperCase();
  if (t.includes("INT")) return "BIGINT";
  if (t.includes("REAL") || t.includes("FLOA") || t.includes("DOUB")) return "DOUBLE PRECISION";
  if (t.includes("BLOB")) return "BYTEA";
  return "TEXT";
}

function pgDefault(value: string | null) {
  if (!value) return "";
  const v = value.trim();
  const low = v.toLowerCase();
  if (low === "current_timestamp" || low === "(current_timestamp)") return " DEFAULT CURRENT_TIMESTAMP";
  if (low === "current_date" || low === "(current_date)") return " DEFAULT CURRENT_DATE";
  if (low === "datetime('now')" || low === "(datetime('now'))") return " DEFAULT CURRENT_TIMESTAMP";
  if (/^\(?-?\d+(\.\d+)?\)?$/.test(v)) return ` DEFAULT ${v.replace(/[()]/g, "")}`;
  if (/^'.*'$/.test(v)) return ` DEFAULT ${v}`;
  return "";
}

function stable(v: unknown): unknown {
  if (Buffer.isBuffer(v)) return { __blob: v.toString("base64") };
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v as Record<string, unknown>).sort()) {
      out[key] = stable((v as Record<string, unknown>)[key]);
    }
    return out;
  }
  return v;
}

function hashRows(rows: Iterable<Record<string, unknown>>) {
  const hash = crypto.createHash("sha256");
  let count = 0;
  for (const row of rows) {
    hash.update(JSON.stringify(stable(row)) + "\n");
    count++;
  }
  return { count, sha256: hash.digest("hex") };
}

async function main() {
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();

  const tables = sqlite
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as SqliteTable[];

  const report: {
    sqlitePath: string;
    startedAt: string;
    finishedAt?: string;
    tables: { name: string; count: number; sqliteSha256: string; pgCount: number; pgSha256: string }[];
  } = { sqlitePath: SQLITE_PATH, startedAt: new Date().toISOString(), tables: [] };

  await pg.query("BEGIN");
  await pg.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pg.query("CREATE SCHEMA public AUTHORIZATION wb_ads_user");
  await pg.query("SET search_path TO public");

  for (const table of tables) {
    const cols = sqlite.prepare(`PRAGMA table_info(${qi(table.name)})`).all() as SqliteColumn[];
    const pkCols = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
    const singleIntegerIdPk =
      pkCols.length === 1 && pkCols[0].name === "id" && pgType(pkCols[0]) === "BIGINT";

    const defs = cols.map((col) => {
      const parts = [qi(col.name)];
      if (singleIntegerIdPk && col.name === "id") parts.push("BIGSERIAL");
      else parts.push(pgType(col));
      if (col.notnull && !(singleIntegerIdPk && col.name === "id")) parts.push("NOT NULL");
      if (!(singleIntegerIdPk && col.name === "id")) parts.push(pgDefault(col.dflt_value).trim());
      if (pkCols.length === 1 && pkCols[0].name === col.name) parts.push("PRIMARY KEY");
      return parts.filter(Boolean).join(" ");
    });
    if (pkCols.length > 1) {
      defs.push(`PRIMARY KEY (${pkCols.map((c) => qi(c.name)).join(", ")})`);
    }

    await pg.query(`CREATE TABLE ${qi(table.name)} (${defs.join(", ")})`);
  }

  for (const table of tables) {
    const cols = sqlite.prepare(`PRAGMA table_info(${qi(table.name)})`).all() as SqliteColumn[];
    const colNames = cols.map((c) => c.name);
    const quotedCols = colNames.map(qi).join(", ");
    const placeholders = colNames.map((_, i) => `$${i + 1}`).join(", ");
    const stmt = sqlite.prepare(`SELECT * FROM ${qi(table.name)}`);
    const insertSql = `INSERT INTO ${qi(table.name)} (${quotedCols}) VALUES (${placeholders})`;

    let batch: Record<string, unknown>[] = [];
    const flush = async () => {
      for (const row of batch) {
        await pg.query(insertSql, colNames.map((name) => row[name]));
      }
      batch = [];
    };

    for (const row of stmt.iterate() as Iterable<Record<string, unknown>>) {
      batch.push(row);
      if (batch.length >= 500) await flush();
    }
    await flush();

    if (colNames.includes("id")) {
      const seq = `${table.name}_id_seq`;
      const exists = await pg.query("SELECT to_regclass($1) AS seq", [seq]);
      if (exists.rows[0]?.seq) {
        await pg.query(`SELECT setval($1, COALESCE((SELECT MAX(id) FROM ${qi(table.name)}), 1), true)`, [seq]);
      }
    }
  }

  const indexes = sqlite
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name")
    .all() as { name: string; sql: string }[];
  for (const idx of indexes) {
    let sql = idx.sql.trim().replace(/`/g, '"');
    sql = sql.replace(/\bIF NOT EXISTS\b/gi, "");
    sql = sql.replace(/^CREATE\s+(UNIQUE\s+)?INDEX\s+/i, (m) => `${m}IF NOT EXISTS `);
    await pg.query(sql);
  }

  for (const table of tables) {
    const indexList = sqlite.prepare(`PRAGMA index_list(${qi(table.name)})`).all() as {
      name: string;
      unique: 0 | 1;
    }[];
    for (const idx of indexList) {
      if (!idx.unique) continue;
      const cols = sqlite.prepare(`PRAGMA index_info(${qi(idx.name)})`).all() as { name: string }[];
      if (cols.length === 0) continue;
      const pgIndexName = `ux_${table.name}_${cols.map((c) => c.name).join("_")}`
        .replace(/[^A-Za-z0-9_]/g, "_")
        .slice(0, 60);
      await pg.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${qi(pgIndexName)} ON ${qi(table.name)} (${cols.map((c) => qi(c.name)).join(", ")})`,
      );
    }
  }

  await pg.query("COMMIT");

  for (const table of tables) {
    const cols = sqlite.prepare(`PRAGMA table_info(${qi(table.name)})`).all() as SqliteColumn[];
    const pkCols = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    const orderCols = pkCols.length ? pkCols : cols.map((c) => c.name);
    const order = orderCols.map(qi).join(", ");
    const sqliteHash = hashRows(sqlite.prepare(`SELECT * FROM ${qi(table.name)} ORDER BY ${order}`).iterate() as Iterable<Record<string, unknown>>);
    const pgRows = await pg.query(`SELECT * FROM ${qi(table.name)} ORDER BY ${order}`);
    const pgHash = hashRows(pgRows.rows);
    report.tables.push({
      name: table.name,
      count: sqliteHash.count,
      sqliteSha256: sqliteHash.sha256,
      pgCount: pgHash.count,
      pgSha256: pgHash.sha256,
    });
    console.log(`${table.name}|sqlite=${sqliteHash.count}|pg=${pgHash.count}|${sqliteHash.sha256 === pgHash.sha256 ? "hash_ok" : "hash_diff"}`);
  }

  report.finishedAt = new Date().toISOString();
  fs.mkdirSync("data/migration", { recursive: true });
  fs.writeFileSync("data/migration/postgres-import-report-20260527-2242-msk.json", JSON.stringify(report, null, 2));
  await pg.end();

  const diffs = report.tables.filter((t) => t.count !== t.pgCount || t.sqliteSha256 !== t.pgSha256);
  if (diffs.length) {
    throw new Error(`Migration verification failed for ${diffs.length} tables`);
  }
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
