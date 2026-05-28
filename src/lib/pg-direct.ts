import { Pool, types } from "pg";

export type PgParam = string | number | boolean | null | Date;

let pool: Pool | null = null;
let parsersConfigured = false;

export function hasPostgresUrl(): boolean {
  return Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
}

function configureParsers() {
  if (parsersConfigured) return;
  parsersConfigured = true;
  types.setTypeParser(20, (v) => Number(v)); // int8
  types.setTypeParser(1700, (v) => Number(v)); // numeric
  types.setTypeParser(700, (v) => Number(v)); // float4
  types.setTypeParser(701, (v) => Number(v)); // float8
  types.setTypeParser(1082, (v) => v); // date
  types.setTypeParser(1114, (v) => v); // timestamp
  types.setTypeParser(1184, (v) => v); // timestamptz
}

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for PostgreSQL direct mode");
  configureParsers();
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: Number(process.env.WB_ADS_PG_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

function convertQuestionParams(sql: string): string {
  let out = "";
  let idx = 1;
  let quote: "'" | '"' | "`" | null = null;
  for (let pos = 0; pos < sql.length; pos += 1) {
    const ch = sql[pos];
    const next = sql[pos + 1];
    if (quote) {
      if (quote === "`") {
        out += ch === "`" ? "\"" : ch;
      } else {
        out += ch;
      }
      if (ch === quote) {
        if (quote === "'" && next === "'") {
          out += next;
          pos += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      out += ch === "`" ? "\"" : ch;
      continue;
    }
    if (ch === "?") {
      out += `$${idx}`;
      idx += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function toPgSql(sql: string): string {
  return convertQuestionParams(sql)
    .replace(/\b([A-Za-z_][A-Za-z0-9_\.]*)\s+GLOB\s+'\*\[([^'\]]+)\]\*'/gi, "$1 ~ '[$2]'");
}

export async function pgAll<T>(sql: string, params: PgParam[] = []): Promise<T[]> {
  const res = await getPool().query(toPgSql(sql), params);
  return res.rows as T[];
}

export async function pgGet<T>(sql: string, params: PgParam[] = []): Promise<T | undefined> {
  const rows = await pgAll<T>(sql, params);
  return rows[0];
}
