// Apply server/db/migrations to the libSQL database at DATABASE_URL (Vercel
// builds, before the app goes live). The same SQL files D1 runs in preview.
// DATABASE_AUTH_TOKEN comes from the build environment; it is never printed.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.DATABASE_URL;
if (!url) {
  console.log("migrate: no DATABASE_URL, nothing to do");
  process.exit(0);
}
const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });
try {
  await migrate(drizzle(client), { migrationsFolder: join(root, "server", "db", "migrations") });
  console.log(`migrate: applied migrations to ${new URL(url).host || "the database"}`);
} catch (err) {
  console.error(`migrate: ${err instanceof Error ? err.message.replaceAll(process.env.DATABASE_AUTH_TOKEN || "\u0000", "***") : "failed"}`);
  process.exit(1);
} finally {
  client.close();
}
