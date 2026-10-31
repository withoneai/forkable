// The local entry (SPEC 13): load env, refuse a busy pinned port, boot the
// database (embedded Postgres with pgvector, or SEARCH_DATABASE_URL), the Connect
// store, built-in profiles, deps, Hono on 127.0.0.1, the scheduler. In `pnpm dev`
// (SEARCH_UI_URL set) every non-API path 302s to Vite; otherwise ui/dist is
// served with an SPA fallback.

import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  bootDatabase, fixtureTransport, getSettings, loadBuiltinPacks, loadSampleWorld, maskDatabaseUrl, upsertBuiltins,
  type EngineCtx, type FixtureTransport, type SampleWorld,
} from "@search/core";
import { createApp } from "./app.js";
import { applyStoredConnect, connectConfigured, loadEnv, connectEnvOf, ROOT, type ServerEnv } from "./config.js";
import { createConnect } from "./connect.js";
import { ConnectCreator } from "./connect-create.js";
import { ConnectStore } from "./connect-store.js";
import type { Deps } from "./deps.js";
import { createHub } from "./events.js";
import { createScheduler } from "./scheduler.js";
import { askHash } from "./routes/setup.js";
import { mkdirSync, writeFileSync } from "node:fs";

export const VERSION: string = (() => {
  try { return (JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0"; } catch { return "0.0.0"; }
})();

export interface StartedServer { url: string; port: number; env: ServerEnv; deps: Deps; stop(): Promise<void> }

function portFree(port: number, host: string): Promise<boolean> {
  return new Promise((done) => {
    const srv = net.createServer();
    srv.once("error", () => done(false));
    srv.listen(port, host, () => srv.close(() => done(true)));
  });
}

const PLACEHOLDER = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Search</title>
<style>body{font:14px/1.5 Inter,system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem}code{background:#f3f3f3;padding:.1rem .3rem;border-radius:3px}</style></head>
<body><h1>Search</h1><p>The server is up. The UI is not built yet.</p>
<p>Run <code>pnpm dev</code> for the dev UI on port 5680, or <code>pnpm build</code> and reload this page.</p>
<p>API: <a href="/api/health">/api/health</a></p></body></html>`;

export interface StartOptions { env?: Partial<ServerEnv>; log?: (line: string) => void; startScheduler?: boolean; serveUi?: boolean }

export async function startServer(options: StartOptions = {}): Promise<StartedServer> {
  const log = options.log ?? ((line: string) => console.log(line));
  const env = loadEnv(options.env);
  const host = "127.0.0.1";
  if (!(await portFree(env.PORT, host))) {
    throw Object.assign(new Error(`port ${env.PORT} is in use. Search pins it because the One Connect redirect http://localhost:${env.PORT}/api/one/callback is registered once. Stop the other process.`), { code: "EADDRINUSE" });
  }

  const database = await bootDatabase({ home: env.HOME, pgPort: env.PG_PORT, databaseUrl: env.DATABASE_URL ?? null, forceKeyword: env.FORCE_KEYWORD, log: (l) => log(`[search] ${l}`) });
  const packs = loadBuiltinPacks(join(env.ROOT, "profiles"));
  const up = await upsertBuiltins(database.db, packs);
  if (up.created || up.updated) log(`[search] built-in profiles: ${up.created} new, ${up.updated} updated`);

  const store = new ConnectStore(env.HOME, env.SECRETS);
  const hub = createHub();
  let sample: { world: SampleWorld; transport: FixtureTransport } | null = null;
  const loadSample = () => {
    if (!sample) {
      const world = loadSampleWorld(join(env.ROOT, "fixtures", "sample"));
      sample = { world, transport: fixtureTransport(world) };
    }
    return sample;
  };
  const deps = {
    db: database.db, env, capability: database.capability, oneConnect: null, hub, connectSetup: null, version: VERSION,
    dbInfo: { kind: database.kind, url: maskDatabaseUrl(database.url), dataDir: database.dataDir, port: database.port, version: database.serverVersion },
    sample: loadSample, log,
  } as unknown as Deps;
  const ctx: EngineCtx = {
    db: database.db,
    get oneConnect() { return deps.oneConnect; },
    capability: database.capability,
    settingsFor: (userId) => getSettings(database.db, userId),
    get transport() { return loadSample().transport; },
    get world() { return loadSample().world; },
    emit: (userId, ev) => hub.emit(userId, ev),
    log: (l) => log(`[search] ${l}`),
    now: () => new Date(),
  };
  deps.ctx = ctx;

  // Connect: .env ids (pnpm connect) and the setup store (Keychain first), reloadable.
  const resolution = await applyStoredConnect(env, store);
  deps.oneConnect = createConnect(env, database.db);
  const creator = new ConnectCreator({
    root: env.ROOT, log,
    onApproved: async () => {
      mkdirSync(env.HOME, { recursive: true });
      writeFileSync(resolve(env.HOME, "connect-ask.json"), `${JSON.stringify({ hash: askHash(env), at: new Date().toISOString() })}\n`, { mode: 0o600 });
      await deps.connectSetup!.reload();
    },
  });
  deps.connectSetup = {
    store, resolution, envSnapshot: JSON.stringify(connectEnvOf(env)), creator,
    async reload() {
      const fromEnv = connectEnvOf(env);
      this.resolution = await applyStoredConnect(env, store, fromEnv);
      this.envSnapshot = JSON.stringify(fromEnv);
      deps.oneConnect = createConnect(env, database.db);
    },
  };
  deps.scheduler = createScheduler(deps);

  const app = createApp(deps);
  const isApi = (p: string) => p.startsWith("/api/") || p === "/api" || p.startsWith("/mcp") || p.startsWith("/.well-known/") || p.startsWith("/oauth/") || ["/authorize", "/token", "/register", "/revoke"].includes(p);
  if (env.UI_URL) {
    app.get("*", (c) => {
      if (isApi(c.req.path)) return c.json({ error: { code: "not_found", message: "No such route." } }, 404);
      const u = new URL(c.req.url);
      return c.redirect(`${env.UI_URL}${u.pathname}${u.search}`, 302);
    });
  } else if (options.serveUi !== false && existsSync(resolve(env.ROOT, "ui", "dist", "index.html"))) {
    const dist = resolve(env.ROOT, "ui", "dist");
    app.use("/*", serveStatic({ root: relative(process.cwd(), dist) || "." }));
    app.get("*", (c) => (isApi(c.req.path) ? c.json({ error: { code: "not_found", message: "No such route." } }, 404) : c.html(readFileSync(resolve(dist, "index.html"), "utf8"))));
  } else {
    app.get("/", (c) => c.html(PLACEHOLDER));
  }

  const server: ServerType = await new Promise((ok) => {
    const s = serve({ fetch: app.fetch, port: env.PORT, hostname: host }, () => ok(s));
  });
  if (options.startScheduler !== false) deps.scheduler.start();

  const url = `http://localhost:${env.PORT}`;
  const db = database.kind === "embedded" ? `embedded Postgres ${database.serverVersion} on ${database.port}` : `external ${maskDatabaseUrl(database.url)}`;
  const cap = database.capability.mode === "hybrid" ? `hybrid (pgvector ${database.capability.pgvector})` : `keyword-only (${database.capability.reason})`;
  log(`Search · ${url} · ${db} · ${cap} · sign in: ${connectConfigured(env) ? `on (${deps.connectSetup.resolution.source === "store" ? "setup screen" : ".env + store"})` : "off, open /setup/connect"}`);

  let stopping = false;
  return {
    url, port: env.PORT, env, deps,
    async stop() {
      if (stopping) return;
      stopping = true;
      deps.scheduler.stop();
      deps.connectSetup?.creator.stop();
      hub.closeAll();
      await Promise.race([deps.scheduler.idle(), new Promise((r) => setTimeout(r, 5000))]);
      const closing = new Promise<void>((done) => server.close(() => done()));
      (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
      await closing;
      await database.stop();
    },
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer().then((started) => {
    const shutdown = (signal: string) => {
      console.log(`[search] ${signal}, shutting down`);
      started.stop().then(() => process.exit(0), () => process.exit(1));
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  }).catch((err) => {
    console.error(`[search] failed to start: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
