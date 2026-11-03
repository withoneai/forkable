import { drizzle as d1 } from "drizzle-orm/d1";
import { drizzle as libsql } from "drizzle-orm/libsql/web";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import * as schema from "./schema";

// One Drizzle schema (sqlite-core), two drivers:
//   D1 (the DB binding) in preview and on Workers,
//   libSQL over HTTP on Vercel, from DATABASE_URL and DATABASE_AUTH_TOKEN,
//   which the builder sets on the Vercel project.
// Both are async SQLite, so queries read the same either way.

export function db(c: Context<AppEnv>) {
  const e = c.env;
  if (e.DB) return d1(e.DB, { schema });
  if (e.DATABASE_URL) return libsql({ connection: { url: e.DATABASE_URL, authToken: e.DATABASE_AUTH_TOKEN }, schema }) as unknown as ReturnType<typeof d1<typeof schema>>;
  throw new Error("No database: bind DB on Workers, or set DATABASE_URL on Vercel.");
}

export { schema };
