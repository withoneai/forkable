import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Capability } from "../contract.js";
import { schema } from "./schema.js";
import { VECTOR_DDL, VECTOR_DIMS } from "./schema-vector.js";

export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool };

const here = dirname(fileURLToPath(import.meta.url));
export const migrationsFolder = resolve(here, "migrations");

export interface DbOptions {
  max?: number;
  /** Run every connection inside this schema (first on search_path). Used by the demo and tests. */
  schema?: string;
  /** Extra schemas to append to search_path (Supabase keeps vector in `extensions`). */
  extraSearchPath?: string[];
}

function searchPath(o: DbOptions): string | null {
  const parts = [o.schema, ...(o.schema || o.extraSearchPath?.length ? ["public"] : []), ...(o.extraSearchPath ?? [])].filter(Boolean) as string[];
  return parts.length ? [...new Set(parts)].map((s) => `"${s.replace(/"/g, "")}"`).join(",") : null;
}

export function createDb(url: string, maxOrOpts: number | DbOptions = 10): Db {
  const o: DbOptions = typeof maxOrOpts === "number" ? { max: maxOrOpts } : maxOrOpts;
  const sp = searchPath(o);
  const pool = new pg.Pool({ connectionString: url, max: o.max ?? 10, ...(sp ? { options: `-c search_path=${sp}` } : {}) });
  pool.on("error", () => { /* idle client dropped (restart, shutdown): never crash the process */ });
  return drizzle(pool, { schema }) as Db;
}

/** Applies drizzle migrations. With a scratch schema, the migrations table lives there too. */
export async function runMigrations(db: Db, opts: { schema?: string } = {}): Promise<void> {
  if (opts.schema) await db.execute(sql.raw(`create schema if not exists "${opts.schema.replace(/"/g, "")}"`));
  await migrate(db, { migrationsFolder, ...(opts.schema ? { migrationsSchema: opts.schema } : {}) });
}

/** Creates `name` on the server behind `adminUrl` when it does not exist. */
export async function ensureDatabase(adminUrl: string, name: string): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const r = await client.query("select 1 from pg_database where datname = $1", [name]);
    if (r.rowCount === 0) await client.query(`create database "${name.replace(/"/g, "")}"`);
  } finally {
    await client.end();
  }
}

export async function dropSchema(db: Db, name: string): Promise<void> {
  await db.execute(sql.raw(`drop schema if exists "${name.replace(/"/g, "")}" cascade`));
}

async function rows<T>(db: Db, q: ReturnType<typeof sql>): Promise<T[]> {
  const r = await db.execute(q);
  return r.rows as T[];
}

/** Where the vector extension lives, if installed. */
export async function vectorSchemaOf(db: Db): Promise<string | null> {
  const r = await rows<{ s: string }>(db, sql`select n.nspname as s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'vector'`);
  return r[0]?.s ?? null;
}

/**
 * The capability check (pgvector-embedded.md, "Capability detection at boot").
 * Creates the extension when it is available and not installed.
 */
export async function detectCapability(db: Db, opts: { embedded: boolean; extDir: string | null; force?: "keyword" }): Promise<Capability> {
  const where = opts.embedded ? "embedded" : "external";
  if (opts.force === "keyword") return { mode: "keyword", reason: "forced", where };
  if (opts.embedded && !opts.extDir) return { mode: "keyword", reason: "no_build_for_platform", where };
  const [st] = await rows<{ available: boolean; installed: string | null }>(db, sql`select
      exists (select 1 from pg_available_extensions where name = 'vector') as available,
      (select extversion from pg_extension where extname = 'vector') as installed`);
  if (!st) return { mode: "keyword", reason: "extension_unavailable", where };
  if (st.installed && !st.available) return { mode: "keyword", reason: "flags_missing", where };
  if (!st.available) return { mode: "keyword", reason: "extension_unavailable", where };
  if (!st.installed) {
    try {
      const [ext] = await rows<{ ok: boolean }>(db, sql`select exists (select 1 from pg_namespace where nspname = 'extensions') as ok`);
      if (ext?.ok && !opts.embedded) await db.execute(sql`create extension if not exists vector with schema extensions`);
      else await db.execute(sql`create extension if not exists vector`);
    } catch {
      return { mode: "keyword", reason: "cannot_create_extension", where };
    }
  }
  try {
    await db.execute(sql`select '[1]'::vector <=> '[1]'::vector`);
  } catch {
    return { mode: "keyword", reason: "extension_unavailable", where };
  }
  const [v] = await rows<{ v: string }>(db, sql`select extversion as v from pg_extension where extname = 'vector'`);
  return { mode: "hybrid", pgvector: v?.v, where, vectorSchema: (await vectorSchemaOf(db)) ?? "public" };
}

/** Vector tables and the HNSW index. Idempotent; a no-op in keyword mode. */
export async function ensureVectorSchema(db: Db, cap: Capability): Promise<void> {
  if (cap.mode !== "hybrid") return;
  for (const stmt of VECTOR_DDL) await db.execute(sql.raw(stmt));
}

export { VECTOR_DIMS };

/** A Db or an open transaction: helpers that run inside a page transaction take this. */
export type Tx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
