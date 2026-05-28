import Database from "better-sqlite3";
import path from "path";
import { Worker } from "worker_threads";

const DB_PATH = path.join(process.cwd(), "data", "ads.db");

let db: Database.Database | null = null;

type PgValue = string | number | boolean | null | Date;
type RunResult = { changes: number; lastInsertRowid: number | bigint };
type PgTxContext = {
  statements: string[];
  size: number;
};

let pgTxContext: PgTxContext | null = null;

const PG_BATCH_MAX_STATEMENTS = 250;
const PG_BATCH_MAX_CHARS = 450_000;
const PG_SYNC_BUFFER_BYTES = Number(process.env.WB_ADS_PG_SYNC_BUFFER_BYTES || 64 * 1024 * 1024);
const PG_SYNC_TIMEOUT_MS = Number(process.env.WB_ADS_PG_SYNC_TIMEOUT_MS || 5 * 60 * 1000);

let pgWorker: Worker | null = null;

const PG_WORKER_CODE = `
const { parentPort } = require("worker_threads");
const { Pool, types } = require("pg");

types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));
types.setTypeParser(700, (v) => Number(v));
types.setTypeParser(701, (v) => Number(v));
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1114, (v) => v);
types.setTypeParser(1184, (v) => v);

let pool = null;

function getPool() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for PostgreSQL mode");
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: Number(process.env.WB_ADS_PG_POOL_MAX || 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

function valueToText(value) {
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function queryResultToText(result) {
  const results = Array.isArray(result) ? result : [result];
  const last = [...results].reverse().find((r) => r && Array.isArray(r.rows));
  if (!last || last.rows.length === 0) return "";
  const fields = (last.fields || []).map((f) => f.name);
  if (fields.length === 0) return "";
  return last.rows.map((row) => {
    if (fields.length === 1) return valueToText(row[fields[0]]);
    return fields.map((name) => valueToText(row[name])).join("|");
  }).join("\\n");
}

function writeResult(sab, status, text) {
  const state = new Int32Array(sab, 0, 3);
  const body = new Uint8Array(sab, 12);
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > body.length) {
    const msg = new TextEncoder().encode("PostgreSQL result exceeded sync buffer");
    body.set(msg.slice(0, body.length));
    Atomics.store(state, 1, Math.min(msg.length, body.length));
    Atomics.store(state, 2, bytes.length);
    Atomics.store(state, 0, 2);
  } else {
    body.set(bytes);
    Atomics.store(state, 1, bytes.length);
    Atomics.store(state, 2, 0);
    Atomics.store(state, 0, status);
  }
  Atomics.notify(state, 0, 1);
}

parentPort.on("message", async ({ sql, sab }) => {
  try {
    const result = await getPool().query(sql);
    writeResult(sab, 1, queryResultToText(result).trim());
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    writeResult(sab, 2, message);
  }
});
`;

const INSERT_OR_REPLACE_CONFLICTS: Record<string, string[]> = {
  auth_wb_funnel_daily: ["nm_id", "date"],
  buyer_entry_points: ["nm_id", "start_date", "end_date"],
  campaign_budgets: ["advert_id"],
  campaign_catalogs: ["advert_id", "date", "catalog_id"],
  campaign_keyword_bids: ["advert_id", "nm_id", "norm_query"],
  campaign_keyword_stats_daily: ["advert_id", "nm_id", "date", "norm_query"],
  campaign_keywords: ["advert_id", "date", "phrase"],
  campaign_phrase_positions: ["advert_id", "nm_id", "norm_query"],
  campaign_preset_keywords: ["advert_id", "nm_id", "name"],
  campaign_stats_by_nm: ["advert_id", "nm_id", "date"],
  campaign_stats_daily: ["advert_id", "date"],
  campaigns: ["advert_id"],
  phrase_djem_stats: ["nm_id", "phrase"],
  phrase_djem_stats_daily: ["nm_id", "phrase", "date"],
  product_promotions: ["nm_id", "promo_id"],
  sales_funnel_daily: ["nm_id", "date"],
  search_cluster_bids: ["advert_id", "nm_id", "norm_query"],
  search_cluster_stats: ["advert_id", "nm_id", "norm_query", "date"],
  search_texts_wb: ["phrase_lc", "snapshot_date"],
  settings: ["key"],
};

function sqlLiteral(value: PgValue): string {
  if (value == null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const str = value instanceof Date ? value.toISOString() : String(value);
  return `'${str.replace(/'/g, "''")}'`;
}

function bindSql(sql: string, params: PgValue[]): string {
  let i = 0;
  let out = "";
  let quote: "'" | '"' | "`" | null = null;
  for (let pos = 0; pos < sql.length; pos += 1) {
    const ch = sql[pos];
    if (quote) {
      out += quote === "`" ? '"' : ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      out += ch === "`" ? '"' : ch;
      continue;
    }
    if (ch === "?") {
      out += sqlLiteral(params[i++] ?? null);
      continue;
    }
    out += ch;
  }
  return out;
}

function splitSqlColumns(columnsSql: string): string[] {
  return columnsSql
    .split(",")
    .map((col) => col.trim().replace(/^["`]|["`]$/g, ""))
    .filter(Boolean);
}

function findClosingParen(sql: string, openIndex: number): number {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  for (let i = openIndex; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (quote) {
      if (ch === quote) {
        if (quote === "'" && next === "'") {
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function rewriteInsertOrReplace(sql: string): string {
  const match = /\bINSERT\s+OR\s+REPLACE\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/i.exec(sql);
  if (!match || match.index == null) return sql;
  const table = match[1];
  const conflict = INSERT_OR_REPLACE_CONFLICTS[table.toLowerCase()];
  if (!conflict) return sql;

  const columnsOpen = sql.indexOf("(", match.index + match[0].length - 1);
  const columnsClose = findClosingParen(sql, columnsOpen);
  if (columnsOpen < 0 || columnsClose < 0) return sql;
  const columns = splitSqlColumns(sql.slice(columnsOpen + 1, columnsClose));
  if (columns.length === 0) return sql;

  const afterColumns = sql.slice(columnsClose + 1);
  const valuesMatch = /^\s*VALUES\s*\(/i.exec(afterColumns);
  if (!valuesMatch) return sql;
  const valuesOpen = columnsClose + 1 + valuesMatch[0].lastIndexOf("(");
  const valuesClose = findClosingParen(sql, valuesOpen);
  if (valuesClose < 0) return sql;

  const valuesSql = sql.slice(valuesOpen + 1, valuesClose);
  const updates = columns
    .filter((col) => !conflict.includes(col.toLowerCase()))
    .map((col) => `${col} = EXCLUDED.${col}`);
  const action = updates.length > 0 ? `DO UPDATE SET ${updates.join(", ")}` : "DO NOTHING";
  const replacement = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${valuesSql}) ON CONFLICT (${conflict.join(", ")}) ${action}`;
  return `${sql.slice(0, match.index)}${replacement}${sql.slice(valuesClose + 1)}`;
}

function toPostgresSql(sql: string): string {
  const pragmaTable = sql.match(/^\s*PRAGMA\s+table_info\((["`']?)([A-Za-z_][A-Za-z0-9_]*)\1\)\s*;?\s*$/i);
  if (pragmaTable) {
    return `
      SELECT
        ordinal_position - 1 AS cid,
        column_name AS name,
        data_type AS type,
        CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull,
        column_default AS dflt_value,
        0 AS pk
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '${pragmaTable[2].replace(/'/g, "''")}'
      ORDER BY ordinal_position
    `;
  }
  return rewriteInsertOrReplace(sql)
    .replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, "INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY")
    .replace(/\bINSERT\s+OR\s+REPLACE\s+INTO\s+settings\s*\(\s*key\s*,\s*value\s*\)\s*VALUES\s*\(\s*\?\s*,\s*\?\s*\)/gi,
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value")
    .replace(/\b([A-Za-z_][A-Za-z0-9_\.]*)\s+GLOB\s+'\*\[([^'\]]+)\]\*'/gi, "$1 ~ '[$2]'")
    .replace(/datetime\('now',\s*\?\)/gi, "(now() + (?::interval))::text")
    .replace(/datetime\('now',\s*'([^']+)'\)/gi, "(now() + '$1'::interval)::text")
    .replace(/datetime\('now',\s*'-1 hour'\)/gi, "(now() - interval '1 hour')::text")
    .replace(/datetime\('now'\)/gi, "now()::text")
    .replace(/date\('now',\s*'([^']+)'\)/gi, "(now() + '$1'::interval)::date::text")
    .replace(/date\('now'\)/gi, "current_date::text")
    .replace(/ROUND\(\s*AVG\(([^)]+)\)\s*,\s*(\d+)\s*\)/gi, "ROUND(AVG($1)::numeric, $2)::float")
    .replace(/MAX\(COALESCE\(([^()]+),\s*0\),\s*COALESCE\(([^()]+),\s*0\)\)/gi, "GREATEST(COALESCE($1, 0), COALESCE($2, 0))")
    .replace(/MAX\(\s*0\s*,\s*\((CASE[\s\S]*?END)\)\s*-\s*views_search\s*-\s*views_reco\s*\)/gi, "GREATEST(0, ($1) - views_search - views_reco)")
    .replace(/MAX\(\s*0\s*,\s*([A-Za-z_][A-Za-z0-9_\.]*)\s*\)/gi, "GREATEST(0, $1)")
    .replace(/MAX\(\s*([A-Za-z_][A-Za-z0-9_\.]*)\s*,\s*([A-Za-z_][A-Za-z0-9_\.]*)\s*\)/gi, "GREATEST($1, $2)")
    .replace(/\bAUTOINCREMENT\b/gi, "GENERATED BY DEFAULT AS IDENTITY");
}

function redactSecrets(text: string): string {
  return text.replace(/postgres(?:ql)?:\/\/([^:\s]+):([^@\s]+)@/gi, "postgresql://$1:***@");
}

function getPgWorker(): Worker {
  if (!pgWorker) {
    pgWorker = new Worker(PG_WORKER_CODE, { eval: true });
    pgWorker.unref();
    pgWorker.on("exit", () => { pgWorker = null; });
  }
  return pgWorker;
}

function pgSync(sql: string): string {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    throw new Error("DATABASE_URL is required for PostgreSQL mode");
  }
  const sab = new SharedArrayBuffer(12 + PG_SYNC_BUFFER_BYTES);
  const state = new Int32Array(sab, 0, 3);
  getPgWorker().postMessage({ sql, sab });
  const wait = Atomics.wait(state, 0, 0, PG_SYNC_TIMEOUT_MS);
  if (wait === "timed-out") {
    pgWorker?.terminate().catch(() => {});
    pgWorker = null;
    throw new Error(`PostgreSQL query timed out after ${PG_SYNC_TIMEOUT_MS}ms`);
  }
  const len = Atomics.load(state, 1);
  const status = Atomics.load(state, 0);
  const text = new TextDecoder().decode(new Uint8Array(sab, 12, len));
  if (status === 2) throw new Error(redactSecrets(text || "PostgreSQL query failed"));
  return text.trim();
}

function trimStatement(sql: string): string {
  return sql.trim().replace(/;+\s*$/, "");
}

function flushPostgresBatch(ctx: PgTxContext) {
  if (ctx.statements.length === 0) return;
  const body = ctx.statements.map(trimStatement).filter(Boolean).join(";\n");
  ctx.statements = [];
  ctx.size = 0;
  if (!body) return;
  pgSync(`BEGIN;\n${body};\nCOMMIT;`);
}

function queuePostgresStatement(sql: string) {
  if (!pgTxContext) return false;
  const statement = trimStatement(sql);
  if (!statement) return true;
  pgTxContext.statements.push(statement);
  pgTxContext.size += statement.length + 2;
  if (
    pgTxContext.statements.length >= PG_BATCH_MAX_STATEMENTS ||
    pgTxContext.size >= PG_BATCH_MAX_CHARS
  ) {
    flushPostgresBatch(pgTxContext);
  }
  return true;
}

function needsImmediateRunResult(sql: string): boolean {
  const s = sql.trim();
  // Some callers inside transaction() need lastInsertRowid or immediate unique
  // constraint feedback. UPSERT-heavy sync loops do not, so those are batched.
  return /^INSERT\b/i.test(s) && !/\bON\s+CONFLICT\b/i.test(s) && !/\bRETURNING\b/i.test(s);
}

function runPostgresStatement(boundSql: string): RunResult {
  const sql = trimStatement(boundSql);
  if (/^(INSERT|UPDATE|DELETE)\b/i.test(sql) && !/\bRETURNING\b/i.test(sql)) {
    if (!needsImmediateRunResult(sql) && queuePostgresStatement(sql)) {
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (pgTxContext) flushPostgresBatch(pgTxContext);
  }
  if (/^(INSERT|UPDATE|DELETE)\b/i.test(sql) && !/\bRETURNING\b/i.test(sql)) {
    const rowsText = pgSync(`WITH __wb_run AS (${sql} RETURNING *) SELECT COALESCE(json_agg(row_to_json(__wb_run)), '[]'::json) FROM __wb_run`);
    const rows = JSON.parse(rowsText || "[]") as Array<Record<string, unknown>>;
    const idRow = [...rows].reverse().find((row) => typeof row.id === "number" || typeof row.id === "string");
    const rawId = idRow?.id;
    const lastInsertRowid = typeof rawId === "number" ? rawId : typeof rawId === "string" && /^\d+$/.test(rawId) ? Number(rawId) : 0;
    return { changes: rows.length, lastInsertRowid };
  }
  pgSync(boundSql);
  return { changes: 0, lastInsertRowid: 0 };
}

function makePgDb() {
  return {
    pragma() {},
    exec(sql: string) {
      pgSync(toPostgresSql(sql));
    },
    prepare(sql: string) {
      const pgSql = toPostgresSql(sql);
      return {
        all(...params: PgValue[]) {
          if (pgTxContext) flushPostgresBatch(pgTxContext);
          const bound = bindSql(pgSql, params);
          const json = pgSync(`SELECT COALESCE(json_agg(row_to_json(__q)), '[]'::json) FROM (${bound}) __q`);
          return JSON.parse(json || "[]");
        },
        get(...params: PgValue[]) {
          return this.all(...params)[0];
        },
        run(...params: PgValue[]) {
          const bound = bindSql(pgSql, params);
          return runPostgresStatement(bound);
        },
      };
    },
    transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
      return ((...args: Parameters<T>) => {
        const parent = pgTxContext;
        if (parent) return fn(...args);
        const ctx: PgTxContext = { statements: [], size: 0 };
        pgTxContext = ctx;
        try {
          const result = fn(...args);
          flushPostgresBatch(ctx);
          return result;
        } catch (error) {
          ctx.statements = [];
          ctx.size = 0;
          throw error;
        } finally {
          pgTxContext = parent;
        }
      }) as T;
    },
  };
}

export function getDb(): Database.Database {
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) {
    return makePgDb() as unknown as Database.Database;
  }
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("cache_size = -64000");
    db.pragma("busy_timeout = 5000");
  }
  return db;
}
