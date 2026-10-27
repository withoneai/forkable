import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { bootDatabase, maskDatabaseUrl, type BootedDatabase } from "./boot.js";
import { applyStoredConnect, connectConfigured, loadEnv, ROOT, type ServerEnv } from "./config.js";
import { createConnect } from "./connect.js";
import { ConnectStore } from "./connect-store.js";
import type { Deps } from "./deps.js";
import { createHub } from "./events.js";
import { createScheduler } from "./scheduler.js";

// The local entry: embedded Postgres, migrations, Hono on a pinned port,
// ui/dist as static files. `startServer()` is what the cli calls.

export const VERSION: string = (() => {
  try {
    return (JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

export interface StartedServer {
  url: string;
  port: number;
  env: ServerEnv;
  deps: Deps;
  database: BootedDatabase;
  stop(): Promise<void>;
}

function portFree(port: number, host: string): Promise<boolean> {
  return new Promise((done) => {
    const srv = net.createServer();
    srv.once("error", () => done(false));
    srv.listen(port, host, () => srv.close(() => done(true)));
  });
}

const PLACEHOLDER = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Rill</title>
<style>body{font:14px/1.5 Inter,system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#111}code{background:#f3f3f3;padding:.1rem .3rem;border-radius:3px}</style></head>
<body><h1>Rill</h1><p>The server is up. The UI is not built yet.</p>
<p>Run <code>pnpm dev:ui</code> for the dev server, or <code>pnpm build</code> and reload this page.</p>
<p>API: <a href="/api/health">/api/health</a></p></body></html>`;

export async function startServer(options: { env?: Partial<ServerEnv>; log?: (line: string) => void; startScheduler?: boolean } = {}): Promise<StartedServer> {
  const log = options.log ?? ((line: string) => console.log(line));
  const env = loadEnv(options.env);
  const host = "127.0.0.1";

  if (!(await portFree(env.PORT, host))) {
    log(`Port ${env.PORT} is in use. Rill pins this port because the One Connect redirect URI http://localhost:${env.PORT}/api/one/callback is registered once. Stop the other process or set RILL_PORT and re-register.`);
    process.exit(1);
  }

  const database = await bootDatabase(env, (l) => log(`[rill] ${l}`));
  const store = new ConnectStore(env.HOME);
  const source = await applyStoredConnect(env, store);
  const hub = createHub();
  const deps = {
    db: database.db, env, oneConnect: createConnect(env, database.db), hub, version: VERSION,
    dbInfo: { kind: database.kind, url: maskDatabaseUrl(database.url), dataDir: database.dataDir },
  } as Deps;
  // The scheduler reads deps.oneConnect on every tick, so a reload reaches it too.
  deps.scheduler = createScheduler(deps);
  deps.connectSetup = {
    store,
    source,
    async reload() {
      deps.connectSetup!.source = await applyStoredConnect(env, store);
      deps.oneConnect = createConnect(env, database.db);
      log(`[rill] connect: ${connectConfigured(env) ? "configured" : "not configured"} (from the setup screen)`);
    },
  };

  const app = createApp(deps);

  // In `pnpm dev` the UI is Vite on its own port (RILL_UI_URL), so anything
  // that lands here outside /api, such as the One Connect callback's return to
  // "/", goes on to it with its path and query. Otherwise: ui/dist when built,
  // with the SPA fallback, and a plain page when it isn't.
  const devUi = process.env.RILL_UI_URL?.replace(/\/$/, "");
  if (devUi) {
    app.get("*", (c) => {
      if (c.req.path.startsWith("/api/")) return c.notFound();
      const u = new URL(c.req.url);
      return c.redirect(`${devUi}${u.pathname}${u.search}`);
    });
  }
  const uiDist = resolve(ROOT, "ui", "dist");
  const indexHtml = resolve(uiDist, "index.html");
  if (devUi) {
    // handled above
  } else if (existsSync(indexHtml)) {
    const root = relative(process.cwd(), uiDist) || ".";
    app.use("/*", serveStatic({ root }));
    app.get("*", (c) => {
      if (c.req.path.startsWith("/api/")) return c.notFound();
      return c.html(readFileSync(indexHtml, "utf8"));
    });
  } else {
    app.get("/", (c) => c.html(PLACEHOLDER));
  }

  const server: ServerType = await new Promise((ok) => {
    const s = serve({ fetch: app.fetch, port: env.PORT, hostname: host }, () => ok(s));
  });

  if (options.startScheduler !== false) deps.scheduler.start();

  const url = `http://${host}:${env.PORT}`;
  const dbLabel = database.kind === "embedded" ? `embedded (${database.dataDir?.replace(process.env.HOME ?? "", "~") ?? ""})` : "external";
  log(`Rill · ${url} · db ${dbLabel} · connect: ${connectConfigured(env) ? `configured (${source === "store" ? "setup screen" : ".env"})` : "not configured"} · every platform call runs on the user's grant`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    deps.scheduler.stop();
    hub.closeAll();
    await new Promise<void>((done) => server.close(() => done()));
    await database.stop();
  };
  return { url, port: env.PORT, env, deps, database, stop };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer().then((started) => {
    const shutdown = (signal: string) => {
      console.log(`[rill] ${signal}, shutting down`);
      started.stop().then(() => process.exit(0), () => process.exit(1));
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  }).catch((err) => {
    console.error(`[rill] failed to start: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
