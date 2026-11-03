// The local entry: platform (embedded Postgres, shims, engine), Hono on the
// pinned 51989, the preview proxy on 51990, ui/dist as static files.

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type http from "node:http";
import net from "node:net";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { BRAND, createPlatform, PORTS, SERVER_ORIGIN, type Platform, type PlatformOptions } from "@builder/core";
import type { Harness, HarnessId, HarnessInfo } from "@builder/harness/types";
import { createApp } from "./app.js";
import { createHub } from "./hub.js";
import { createProxy } from "./proxy.js";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, "..", "..");

export interface StartedServer {
  url: string;
  platform: Platform;
  stop(): Promise<void>;
}

function portFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const srv = net.createServer();
    srv.once("error", () => done(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => done(true)));
  });
}

/** "node (pid 4242)" for whoever listens on the port, best effort. */
export function portHolder(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], { timeout: 3000 }, (_e, out) => {
      const pid = /^p(\d+)/m.exec(String(out ?? ""))?.[1];
      const cmd = /^c(.+)$/m.exec(String(out ?? ""))?.[1];
      resolve(pid ? `${cmd ?? "a process"} (pid ${pid})` : null);
    });
  });
}

const PLACEHOLDER = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${BRAND.name}</title>
<style>body{font:14px/1.5 Inter,system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem}code{background:#f3f3f3;padding:.1rem .3rem;border-radius:3px}</style></head>
<body><h1>${BRAND.name}</h1><p>The server is up. The editor is not built yet.</p>
<p>Run <code>pnpm dev</code> for the dev editor on port ${PORTS.uiDev}, or <code>pnpm build</code> and reload this page.</p></body></html>`;

export async function startServer(o: { home?: string; log?: (line: string) => void; harness?: (id: HarnessId) => Harness; detect?: (force?: boolean) => Promise<HarnessInfo[]>; engine?: { maxConcurrent?: number }; audit?: boolean; env?: PlatformOptions["env"] } = {}): Promise<StartedServer> {
  const log = o.log ?? ((line: string) => console.log(line));
  for (const [what, port] of [["server", PORTS.server], ["preview proxy", PORTS.proxy]] as const) {
    if (!(await portFree(port))) {
      const holder = await portHolder(port);
      throw new Error(
        `Port ${port} is in use${holder ? ` by ${holder}` : ""}. ${BRAND.name} pins its ${what} to ${port}${port === PORTS.server ? ` because the One Connect redirect URI ${SERVER_ORIGIN}/api/one/callback is registered once` : ""}. Stop the other process and start again.`,
      );
    }
  }

  const { resolveHome, stopOrphanDevServers } = await import("@builder/core");
  // Only this home's previews (a smoke or eval server on a scratch home leaves the editor's alone).
  const orphans = await stopOrphanDevServers(SERVER_ORIGIN, resolveHome(o.home).root);
  if (orphans) log(`[${BRAND.slug}] Stopped ${orphans} preview server(s) left by an earlier run`);
  const platform = await createPlatform({ home: o.home, log: (l) => log(`[${BRAND.slug}] ${l}`), harness: o.harness, publish: { audit: o.audit ?? true }, engine: o.engine, env: o.env });
  // Anything an agent left running from an earlier session goes.
  void (async () => {
    const { stopAgentProcesses } = await import("@builder/core");
    for (const row of await platform.workspace.list()) {
      const stopped = await stopAgentProcesses(row.id);
      if (stopped.length) log(`[${BRAND.slug}] Stopped ${stopped.length} process(es) an agent left running for ${row.slug}`);
    }
  })().catch(() => {});
  const harnessMod = await import("@builder/harness");
  const detect = o.detect ?? ((force?: boolean) => harnessMod.detectAll({ force, includeReplay: process.env[`${BRAND.envPrefix}DEV`] === "1" }));
  const hub = createHub();
  platform.bus.on((id, e) => hub.emit(id, e));

  const app = createApp({ platform, hub, detect, log });
  const uiDist = resolve(ROOT, "ui", "dist");
  const indexHtml = resolve(uiDist, "index.html");
  if (existsSync(indexHtml)) {
    app.use("/*", serveStatic({ root: relative(process.cwd(), uiDist) || "." }));
    app.get("*", (c) => (c.req.path.startsWith("/api/") ? c.notFound() : c.html(readFileSync(indexHtml, "utf8"))));
  } else {
    app.get("/", (c) => c.html(PLACEHOLDER));
  }

  const { buildPreviewClient } = await import("./preview/clientBuild.js");
  let client: Promise<string> | null = null;
  const clientJs = () =>
    (client ??= buildPreviewClient({
      slug: BRAND.slug,
      editorOrigins: [SERVER_ORIGIN, `http://localhost:${PORTS.server}`, `http://127.0.0.1:${PORTS.uiDev}`, `http://localhost:${PORTS.uiDev}`],
    }).catch((err) => {
      client = null;
      log(`preview client build failed: ${(err as Error).message}`);
      return "/* preview client unavailable */";
    }));
  void clientJs();

  const server: ServerType = serve({ fetch: app.fetch, port: PORTS.server, hostname: "127.0.0.1" });
  const proxy: http.Server = createProxy({ platform, clientJs });
  await new Promise<void>((r) => proxy.listen(PORTS.proxy, "127.0.0.1", r));

  // Warm the template once in the background, so the first project is quick.
  if (!platform.workspace.templateReady()) {
    log(`[${BRAND.slug}] Getting your first project ready, about a minute, only once`);
    void platform.workspace.ensureTemplate((l) => log(`[template] ${l}`)).then(
      () => { log(`[${BRAND.slug}] Template ready`); void platform.workspace.refillSpare(); },
      (err) => log(`[${BRAND.slug}] Template warm-up failed: ${(err as Error).message}`),
    );
  } else void platform.workspace.refillSpare();

  log(`${BRAND.name} on ${SERVER_ORIGIN}  ·  previews on http://<project>.localhost:${PORTS.proxy}/`);
  let stopped = false;
  return {
    url: SERVER_ORIGIN,
    platform,
    async stop() {
      if (stopped) return;
      stopped = true;
      hub.closeAll();
      proxy.closeAllConnections?.();
      await new Promise<void>((r) => proxy.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
      await platform.stop();
    },
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer()
    .then((s) => {
      const shutdown = () => {
        s.stop().finally(() => process.exit(0));
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((err) => {
      console.error((err as Error).message);
      process.exit(1);
    });
}
