import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { dirname, relative, resolve } from "node:path";
import type pg from "pg";
import { createDb, ensureDatabase, runMigrations, type Db } from "@rill/core";
import type { ServerEnv } from "./config.js";

// Shared by the server entry and the cli: start (or reuse) the embedded
// Postgres unless DATABASE_URL points elsewhere, make sure the database and
// the schema exist, hand back a Drizzle client.

type EmbeddedPostgresInstance = { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void> };
type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
  initdbFlags?: string[];
  onLog?: (message: string) => void;
  onError?: (message: unknown) => void;
}) => EmbeddedPostgresInstance;

export interface BootedDatabase {
  db: Db;
  pool: pg.Pool;
  /** Connection string in use (contains the embedded password, never print it as is). */
  url: string;
  kind: "embedded" | "external";
  dataDir: string | null;
  /** True when this process started the embedded server and must stop it. */
  startedEmbedded: boolean;
  stop(): Promise<void>;
}

const DB_NAME = "rill";
const PG_USER = "rill";
const PG_PASSWORD = "rill";

function pidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** postmaster.pid: line 1 pid, line 4 port. Returns the live server's port or null. */
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

/** The first free port at or after `start`, probed with a plain socket. */
export async function detectFreePort(start: number, host = "127.0.0.1"): Promise<number> {
  for (let p = start; p < start + 200; p++) {
    if (await portFree(p, host)) return p;
  }
  throw new Error(`No free port between ${start} and ${start + 200}`);
}

/** An idle client dropped by the server (restart, shutdown) must not crash the process. */
function quietPool(pool: pg.Pool, log: (line: string) => void): void {
  pool.on("error", (err) => {
    if (/terminating connection|Connection terminated/.test(err.message)) return;
    log(`database pool: ${err.message}`);
  });
}


/**
 * The platform package ships its dylib symlinks as a list (pg-symlinks.json)
 * that a postinstall script recreates. Under a package manager that gates
 * build scripts (pnpm 10, npx caches) the script never runs and initdb dies
 * with "Library not loaded". Recreate any missing link ourselves, best effort.
 */
function hydrateEmbeddedSymlinks(log: (line: string) => void): void {
  try {
    const req = createRequire(import.meta.url);
    const platformReq = createRequire(req.resolve("embedded-postgres"));
    // The platform package exports only its entry (dist/index.js); the package root is one level up.
    const entry = platformReq.resolve(`@embedded-postgres/${process.platform}-${process.arch}`);
    const root = resolve(dirname(entry), "..");
    const listFile = resolve(root, "native", "pg-symlinks.json");
    if (!existsSync(listFile)) return;
    const links = JSON.parse(readFileSync(listFile, "utf8")) as { source: string; target: string }[];
    let made = 0;
    for (const { source, target } of links) {
      const linkAbs = resolve(root, target);
      const srcAbs = resolve(root, source);
      try {
        lstatSync(linkAbs);
        continue;
      } catch {
        /* missing: recreate below */
      }
      try {
        symlinkSync(relative(dirname(linkAbs), srcAbs), linkAbs);
        made++;
      } catch {
        /* read-only install; initdb will report it */
      }
    }
    if (made > 0) log(`Restored ${made} embedded Postgres library links`);
  } catch {
    /* not an embedded install */
  }
}

export async function bootDatabase(env: ServerEnv, log: (line: string) => void = () => {}): Promise<BootedDatabase> {
  if (env.DATABASE_URL) {
    const { db, pool } = createDb(env.DATABASE_URL);
    quietPool(pool, log);
    await runMigrations(db);
    return {
      db, pool, url: env.DATABASE_URL, kind: "external", dataDir: null, startedEmbedded: false,
      async stop() { await pool.end(); },
    };
  }

  const dataDir = resolve(env.HOME, "db");
  mkdirSync(dataDir, { recursive: true });
  const initialised = existsSync(resolve(dataDir, "PG_VERSION"));

  let port = env.PG_PORT;
  let instance: EmbeddedPostgresInstance | null = null;
  const live = liveEmbedded(dataDir);
  if (live) {
    port = live.port || port;
    log(`Reusing the embedded Postgres already running (pid ${live.pid}, port ${port})`);
  } else {
    port = await detectFreePort(env.PG_PORT);
    hydrateEmbeddedSymlinks(log);
    const mod = (await import("embedded-postgres")) as { default: EmbeddedPostgresCtor };
    const EmbeddedPostgres = mod.default;
    instance = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: PG_USER,
      password: PG_PASSWORD,
      port,
      persistent: true,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      onLog: () => {},
      onError: (m) => {
        const text = String(m);
        if (/FATAL|PANIC/.test(text)) log(`embedded postgres: ${text.trim()}`);
      },
    });
    if (!initialised) {
      log(`Initialising the embedded Postgres in ${dataDir}`);
      await instance.initialise();
    }
    await instance.start();
  }

  const adminUrl = `postgres://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${port}/postgres`;
  await ensureDatabase(adminUrl, DB_NAME);
  const url = `postgres://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${port}/${DB_NAME}`;
  const { db, pool } = createDb(url);
  quietPool(pool, log);
  await runMigrations(db);

  return {
    db, pool, url, kind: "embedded", dataDir, startedEmbedded: instance !== null,
    async stop() {
      await pool.end().catch(() => {});
      if (instance) await instance.stop().catch((err) => log(`Could not stop the embedded Postgres: ${String(err)}`));
    },
  };
}

/** The connection string with its password hidden, for the Settings screen. */
export function maskDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "****";
    return u.toString();
  } catch {
    return url.replace(/:\/\/([^:@/]+):([^@/]+)@/, "://$1:****@");
  }
}
