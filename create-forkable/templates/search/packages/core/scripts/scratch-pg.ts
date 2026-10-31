// Starts a throwaway embedded Postgres (a stand-in "external" database) and waits for Ctrl-C.
// Usage: tsx scripts/scratch-pg.ts <dataDir> <port> [vector]
import { postgresFlags, resolvePgvector } from "@search/pgvector";
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { ensureDatabase } from "../src/db/client.js";
const [dir, port, vec] = process.argv.slice(2);
const ext = vec ? resolvePgvector(`${dir}-home`) : null;
const pg = new EmbeddedPostgres({ databaseDir: dir!, user: "ext", password: "ext", port: Number(port), persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"], postgresFlags: postgresFlags(ext), onLog: () => {} });
if (!existsSync(`${dir}/PG_VERSION`)) await pg.initialise();
await pg.start();
await ensureDatabase(`postgres://ext:ext@127.0.0.1:${port}/postgres`, "ext");
console.log(`ready postgres://ext:ext@127.0.0.1:${port}/ext`);
process.on("SIGTERM", async () => { await pg.stop(); process.exit(0); });
setInterval(() => {}, 1 << 30);
