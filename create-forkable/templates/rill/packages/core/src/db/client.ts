import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { schema } from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

const here = dirname(fileURLToPath(import.meta.url));
export const migrationsFolder = resolve(here, "migrations");

export function createDb(connectionString: string, max = 5): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString, max });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder });
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
