// Database boot shared by the server and the cli (ported from Rill's server/src/boot.ts):
// external Postgres when a URL is given, else the embedded Postgres in <home>/db with
// our pgvector loaded from <home>/pg-ext through two -c flags. Then migrations and the
// capability check (hybrid or keyword-only).

import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { dirname, relative, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { postgresFlags, resolvePgvector } from "@search/pgvector";
import type { Capability } from "../contract.js";
import { createDb, detectCapability, ensureDatabase, ensureVectorSchema, runMigrations, vectorSchemaOf, type Db } from "./client.js";

type EmbeddedPostgresInstance = { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void> };
type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string; user: string; password: string; port: number; persistent: boolean;
  initdbFlags?: string[]; postgresFlags?: string[];
  onLog?: (message: string) => void; onError?: (message: unknown) => void;
}) => EmbeddedPostgresInstance;

export interface BootOptions {
  home: string;                 // ~/.search
  pgPort?: number;              // 55441
  databaseUrl?: string | null;  // SEARCH_DATABASE_URL
  forceKeyword?: boolean;       // SEARCH_FORCE_KEYWORD=1
  /** Run inside this scratch schema (demo, tests); created if missing. */
  schema?: string;
  dbName?: string;              // "search"
  log?: (line: string) => void;
}

export interface BootedDatabase {
  db: Db;
  url: string;                  // contains the embedded password; mask before printing
  kind: "embedded" | "external";
  dataDir: string | null;
  port: number | null;
  capability: Capability;
  extDir: string | null;
  serverVersion: string;
  startedEmbedded: boolean;
  stop(): Promise<void>;
}

const PG_USER = "search";
const PG_PASSWORD = "search";

function pidRunning(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** postmaster.pid: line 1 pid, line 4 port. */
function liveEmbedded(dataDir: string): { pid: number; port: number } | null {
  const pidFile = resolve(dataDir, "postmaster.pid");
  if (!existsSync(pidFile)) return null;
  const lines = readFileSync(pidFile, "utf8").split("\n").map((l) => l.trim());
  const pid = Number(lines[0]);
  const port = Number(lines[3]);
  if (Number.isInteger(pid) && pid > 0 && pidRunning(pid)) return { pid, port: Number.isInteger(port) && port > 0 ? port : 0 };
  rmSync(pidFile, { force: true });
  return null;
}

function portFree(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((done) => {
    const srv = net.createServer();
    srv.once("error", () => done(false));
    srv.listen(port, host, () => srv.close(() => done(true)));
  });
}

export async function detectFreePort(start: number, host = "127.0.0.1"): Promise<number> {
  for (let p = start; p < start + 200; p++) if (await portFree(p, host)) return p;
  throw new Error(`No free port between ${start} and ${start + 200}`);
}

/** Recreates the dylib links pnpm 10 never made (its postinstall is gated). */
function hydrateEmbeddedSymlinks(log: (line: string) => void): void {
  try {
    const req = createRequire(import.meta.url);
    const platformReq = createRequire(req.resolve("embedded-postgres"));
    const entry = platformReq.resolve(`@embedded-postgres/${process.platform}-${process.arch}`);
    const root = resolve(dirname(entry), "..");
    const listFile = resolve(root, "native", "pg-symlinks.json");
    if (!existsSync(listFile)) return;
    const links = JSON.parse(readFileSync(listFile, "utf8")) as { source: string; target: string }[];
    let made = 0;
    for (const { source, target } of links) {
      const linkAbs = resolve(root, target);
      try { lstatSync(linkAbs); continue; } catch { /* missing */ }
      try { symlinkSync(relative(dirname(linkAbs), resolve(root, source)), linkAbs); made++; } catch { /* read-only */ }
    }
    if (made > 0) log(`Restored ${made} embedded Postgres library links`);
  } catch { /* not an embedded install */ }
}

async function waitGone(pid: number, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (pidRunning(pid) && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
}

async function serverVersion(db: Db): Promise<string> {
  const r = await db.execute(sql`show server_version`);
  return String((r.rows[0] as { server_version?: string })?.server_version ?? "").split(" ")[0] ?? "";
}

export async function bootDatabase(o: BootOptions): Promise<BootedDatabase> {
  const log = o.log ?? (() => {});
  const dbName = o.dbName ?? "search";

  if (o.databaseUrl) {
    const u = new URL(o.databaseUrl);
    if (u.port === "6543") throw new Error("SEARCH_DATABASE_URL points at a transaction pooler (port 6543). Use the session pooler or a direct connection (port 5432): Search needs session settings and advisory locks.");
    let db = createDb(o.databaseUrl, { schema: o.schema });
    await runMigrations(db, { schema: o.schema });
    const capability = await detectCapability(db, { embedded: false, extDir: null, force: o.forceKeyword ? "keyword" : undefined });
    if (capability.mode === "hybrid") {
      const vs = await vectorSchemaOf(db);
      if (vs && vs !== "public" && vs !== o.schema) {
        await db.$client.end();
        db = createDb(o.databaseUrl, { schema: o.schema, extraSearchPath: [vs] });
      }
      await ensureVectorSchema(db, capability);
    }
    return {
      db, url: o.databaseUrl, kind: "external", dataDir: null, port: null, capability, extDir: null,
      serverVersion: await serverVersion(db), startedEmbedded: false,
      async stop() { await db.$client.end().catch(() => {}); },
    };
  }

  const extDir = o.forceKeyword ? null : resolvePgvector(o.home, log);
  const flags = postgresFlags(extDir);
  const dataDir = resolve(o.home, "db");
  mkdirSync(dataDir, { recursive: true });
  const initialised = existsSync(resolve(dataDir, "PG_VERSION"));
  const basePort = o.pgPort ?? 55441;

  let port = basePort;
  let instance: EmbeddedPostgresInstance | null = null;
  let live = liveEmbedded(dataDir);
  if (live && extDir) {
    // A reused server must have been started with our flags, else vector cannot load.
    const probe = createDb(`postgres://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${live.port}/postgres`, 1);
    let ok = false;
    try {
      const r = await probe.execute(sql`show dynamic_library_path`);
      ok = String((r.rows[0] as Record<string, string>).dynamic_library_path ?? "").includes(extDir);
    } catch { /* not ours or not reachable */ }
    await probe.$client.end().catch(() => {});
    if (!ok) {
      log(`Restarting the embedded Postgres (pid ${live.pid}) so it loads pgvector`);
      try { process.kill(live.pid, "SIGINT"); } catch { /* gone */ }
      await waitGone(live.pid, 15000);
      live = null;
    }
  }
  if (live) {
    port = live.port || port;
    log(`Reusing the embedded Postgres already running (pid ${live.pid}, port ${port})`);
  } else {
    port = await detectFreePort(basePort);
    hydrateEmbeddedSymlinks(log);
    const EmbeddedPostgres = ((await import("embedded-postgres")) as { default: EmbeddedPostgresCtor }).default;
    instance = new EmbeddedPostgres({
      databaseDir: dataDir, user: PG_USER, password: PG_PASSWORD, port, persistent: true,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      postgresFlags: flags,
      onLog: () => {},
      onError: (m) => { const t = String(m); if (/FATAL|PANIC/.test(t)) log(`embedded postgres: ${t.trim()}`); },
    });
    if (!initialised) {
      log(`Initialising the embedded Postgres in ${dataDir}`);
      await instance.initialise();
    }
    await instance.start();
  }

  await ensureDatabase(`postgres://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${port}/postgres`, dbName);
  const url = `postgres://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${port}/${dbName}`;
  const db = createDb(url, { schema: o.schema });
  await runMigrations(db, { schema: o.schema });
  const capability = await detectCapability(db, { embedded: true, extDir, force: o.forceKeyword ? "keyword" : undefined });
  await ensureVectorSchema(db, capability);

  return {
    db, url, kind: "embedded", dataDir, port, capability, extDir, serverVersion: await serverVersion(db),
    startedEmbedded: instance !== null,
    async stop() {
      await db.$client.end().catch(() => {});
      if (instance) await instance.stop().catch((err) => log(`Could not stop the embedded Postgres: ${String(err)}`));
    },
  };
}

/** The connection string with its password hidden. */
export function maskDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "****";
    return u.toString();
  } catch {
    return url.replace(/:\/\/([^:@/]+):([^@/]+)@/, "://$1:****@");
  }
}
