// The preview proxy: http://<slug>.localhost:51990/ -> the
// project's dev server. Injects the preview client into HTML, forwards
// WebSocket upgrades (Vite HMR), answers /__builder/* itself, and answers the
// shared preview callback every project's Connect app registers
// (http://127.0.0.1:51990/api/one/callback, see docs/CONTRACT.md section 18):
// it sends the browser on to the one preview that registered the
// sign-in's state, and to nothing else.

import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { BRAND, DEV_URL, PORTS, PREVIEW_CALLBACK, PREVIEW_ROUTE, parseVersionLabel, projectCallback, type Platform, type PreviewBeacon, type ErrorInput } from "@builder/core";

const SCRIPT_TAG = `<script src="${PREVIEW_ROUTE}/client.js" defer></script>`;

export function injectScript(html: string): string {
  if (html.includes(`${PREVIEW_ROUTE}/client.js`)) return html;
  const head = html.search(/<\/head>/i);
  if (head >= 0) return html.slice(0, head) + SCRIPT_TAG + html.slice(head);
  const body = html.search(/<body[^>]*>/i);
  if (body >= 0) {
    const end = html.indexOf(">", body) + 1;
    return html.slice(0, end) + SCRIPT_TAG + html.slice(end);
  }
  return SCRIPT_TAG + html;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function page(title: string, body: string, poll = false): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{color-scheme:light dark;--fg:#1d1c1a;--muted:#77736d;--bg:#fbfaf8;--line:#e7e4df}
@media (prefers-color-scheme:dark){:root{--fg:#ecebe8;--muted:#9c978f;--bg:#1b1a19;--line:#33312e}}
html,body{height:100%;margin:0}body{display:grid;place-items:center;background:var(--bg);color:var(--fg);font:13px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}
.box{text-align:center;max-width:22rem;padding:1.5rem}.t{font-size:15px;font-weight:600;margin:0 0 .25rem}.m{color:var(--muted);margin:0}
.dot{width:8px;height:8px;border-radius:9px;background:var(--muted);display:inline-block;margin-bottom:.75rem;animation:p 1.2s ease-in-out infinite}
@keyframes p{50%{opacity:.25}}
</style></head><body><div class="box">${poll ? '<span class="dot"></span>' : ""}${body}</div>
${poll ? `<script>(function(){function t(){fetch("${PREVIEW_ROUTE}/ping?ready=1",{cache:"no-store"}).then(function(r){return r.json()}).then(function(j){if(j.ready)location.reload();else setTimeout(t,700)}).catch(function(){setTimeout(t,1200)})}setTimeout(t,700)})()</script>` : ""}
</body></html>`;
}

function slugOf(host: string | undefined): string | null {
  if (!host) return null;
  const h = host.split(":")[0]!.toLowerCase();
  const m = h.match(/^([a-z0-9-]+)\.localhost$/);
  return m ? m[1]! : null;
}

function beaconToError(b: PreviewBeacon): ErrorInput {
  if (b.kind === "network") {
    // A grant refusal (One, or the stub grant's Sample) is a grant question, not a code bug.
    const refusal = b.refusal?.source === "one" || b.refusal?.source === "sample";
    const held = b.refusal?.source === "held";
    return {
      source: refusal ? "one" : "network",
      message: `${b.message || `${b.path} answered ${b.status}`}${held ? " (held_during_build)" : b.refusal ? ` (${b.refusal.source}: ${b.refusal.code})` : ""}`,
      severity: b.level === "warning" ? "warning" : "error",
    };
  }
  return {
    source: "runtime",
    message: b.message,
    stack: b.stack ?? null,
    file: b.file ?? null,
    line: b.line ?? null,
    col: b.col ?? null,
    severity: b.level === "warning" ? "warning" : "error",
  };
}

export interface ProxyOptions {
  platform: Platform;
  clientJs: () => Promise<string>;
}

export function createProxy(o: ProxyOptions): http.Server {
  const { platform } = o;
  const slugCache = new Map<string, { id: string; path: string; at: number }>();
  const lookup = async (slug: string) => {
    const hit = slugCache.get(slug);
    if (hit && Date.now() - hit.at < 5000) return hit;
    const row = await platform.workspace.bySlug(slug);
    if (!row) return null;
    const v = { id: row.id, path: row.path, at: Date.now() };
    slugCache.set(slug, v);
    return v;
  };
  const ensure = async (projectId: string) => {
    const row = await platform.workspace.get(projectId);
    if (!row || !platform.devservers) return;
    void platform.devservers.ensure({ id: row.id, path: row.path, devUrl: DEV_URL(row.id), devToken: platform.workspace.devToken(row) });
  };

  // A version preview (Preview this version): <slug>--v-<shortsha>. Its port
  // comes from the version's own dev server; null when that version is not open.
  type Version = { id: string; path: string; short: string; open: boolean };
  const versionOf = async (label: string): Promise<Version | null | undefined> => {
    const v = parseVersionLabel(label);
    if (!v) return undefined;
    const proj = await lookup(v.slug);
    if (!proj) return null;
    return { id: proj.id, path: proj.path, short: v.short, open: !!platform.versions?.match(proj.id, v.short) };
  };
  const versionPort = (v: Version) => platform.versions?.readyPort(v.id, v.short) ?? null;

  const callbackPath = new URL(PREVIEW_CALLBACK).pathname;
  const callbackHosts = new Set([new URL(PREVIEW_CALLBACK).host, `localhost:${PORTS.proxy}`]);

  /**
   * The shared preview callback. One sends every project's sign-in here; the
   * state names the preview that started it (bound by that app with its own
   * dev token, one use, ten minutes). The browser goes on to that preview's
   * own /api/one/callback, where its PKCE cookie and code exchange finish the
   * sign-in. The target host comes from the project's slug in the database,
   * never from the request, and only the OAuth answer's own fields go along.
   */
  const sharedCallback = (url: URL, res: http.ServerResponse) => {
    const pending = platform.connect.takeState(url.searchParams.get("state"));
    const head = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" };
    if (!pending) {
      res.writeHead(400, head);
      res.end(page("Sign in with One", `<p class="t">This sign-in did not start here, or it expired</p><p class="m">Start again from the app's Sign in with One. A sign-in link works once, for ten minutes.</p>`));
      return;
    }
    const next = new URL(projectCallback(pending.label));
    for (const k of ["code", "state", "error", "error_description"]) {
      const v = url.searchParams.get(k);
      if (v !== null) next.searchParams.set(k, v);
    }
    res.writeHead(302, { ...head, location: next.toString() });
    res.end();
  };

  const server = http.createServer(async (req, res) => {
    try {
      const slug = slugOf(req.headers.host);
      const url = new URL(req.url ?? "/", "http://x");
      if (!slug && callbackHosts.has(String(req.headers.host ?? "").toLowerCase()) && url.pathname === callbackPath && req.method === "GET") {
        sharedCallback(url, res);
        return;
      }
      if (!slug) {
        res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        res.end(page("Preview", `<p class="t">Open a project preview</p><p class="m">Previews live at http://&lt;project&gt;.localhost:${PORTS.proxy}/</p>`));
        return;
      }
      const version = await versionOf(slug);
      const proj = version === undefined ? await lookup(slug) : null;
      if (url.pathname.startsWith(`${PREVIEW_ROUTE}/`)) {
        const sub = url.pathname.slice(PREVIEW_ROUTE.length + 1);
        if (sub === "client.js") {
          res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
          res.end(await o.clientJs());
          return;
        }
        if (sub === "ping") {
          const ready = version ? versionPort(version) != null : !!proj && platform.devservers?.readyPort(proj.id) != null;
          res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
          res.end(JSON.stringify({ ok: true, slug, ready }));
          return;
        }
        if (sub === "events" && req.method === "POST") {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const c of req) {
            size += (c as Buffer).length;
            if (size > 256 * 1024) break;
            chunks.push(c as Buffer);
          }
          res.writeHead(204);
          res.end();
          // An older version's errors are not the project's: no rows, no auto-fix.
          if (!proj) return;
          let body: unknown;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            return;
          }
          const list = (Array.isArray(body) ? body : [body]).slice(0, 50) as PreviewBeacon[];
          for (const b of list) {
            if (!b || typeof b.message !== "string") continue;
            await platform.errors.record(proj.id, proj.path, beaconToError(b));
          }
          return;
        }
        res.writeHead(404);
        res.end();
        return;
      }
      if (version === null || (version && !version.open)) {
        res.writeHead(404, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(page("Version closed", `<p class="t">This version preview is closed</p><p class="m">Open it again from History in ${esc(BRAND.name)}.</p>`));
        return;
      }
      if (version) {
        platform.versions?.viewed(version.id);
        const vport = versionPort(version);
        if (!vport) {
          platform.versions?.ensure(version.id);
          res.writeHead(503, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "1" });
          res.end(page("Starting this version", `<p class="t">Starting this version</p><p class="m">This page reloads when it is ready.</p>`, true));
          return;
        }
        forward(req, res, vport);
        return;
      }
      if (!proj) {
        res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        res.end(page("Not found", `<p class="t">No project called ${esc(slug)}</p><p class="m">Check the name in ${esc(BRAND.name)}.</p>`));
        return;
      }
      platform.devservers?.viewed(proj.id);
      // The developer's own session in this preview, for the verifier after a turn (memory only).
      platform.sessions.seen(proj.id, req.headers.cookie);
      const port = platform.devservers?.readyPort(proj.id) ?? null;
      if (!port) {
        void ensure(proj.id);
        const accept = String(req.headers.accept ?? "");
        res.writeHead(503, { "content-type": accept.includes("text/html") || req.method === "GET" ? "text/html; charset=utf-8" : "text/plain", "cache-control": "no-store", "retry-after": "1" });
        res.end(page("Starting preview", `<p class="t">Starting preview</p><p class="m">This page reloads when the app is ready.</p>`, true));
        return;
      }
      forward(req, res, port);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end(`Preview proxy error: ${(err as Error).message}`);
    }
  });

  function forward(req: http.IncomingMessage, res: http.ServerResponse, port: number): void {
    const headers = { ...req.headers, "accept-encoding": "identity" };
    const up = http.request({ host: "127.0.0.1", port, method: req.method, path: req.url, headers }, (ur) => {
      const type = String(ur.headers["content-type"] ?? "");
      if (type.includes("text/html")) {
        const chunks: Buffer[] = [];
        ur.on("data", (c: Buffer) => chunks.push(c));
        ur.on("end", () => {
          const html = injectScript(Buffer.concat(chunks).toString("utf8"));
          const h = { ...ur.headers };
          delete h["content-length"];
          delete h["content-encoding"];
          delete h["transfer-encoding"];
          h["content-length"] = String(Buffer.byteLength(html));
          res.writeHead(ur.statusCode ?? 200, h);
          res.end(html);
        });
        ur.on("error", () => res.destroy());
      } else {
        res.writeHead(ur.statusCode ?? 200, ur.headers);
        ur.pipe(res);
      }
    });
    up.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/html; charset=utf-8" });
        res.end(page("Starting preview", `<p class="t">Starting preview</p><p class="m">The app is restarting.</p>`, true));
      } else res.destroy();
    });
    req.pipe(up);
  }

  // Upgraded sockets (Vite HMR) are outside the server's own connection
  // tracking, so closeAllConnections ends them too; otherwise close() waits forever.
  const upgraded = new Set<Duplex>();
  const closeAll = server.closeAllConnections.bind(server);
  server.closeAllConnections = () => {
    closeAll();
    for (const s of upgraded) s.destroy();
    upgraded.clear();
  };

  server.on("upgrade", async (req, socket, head) => {
    const slug = slugOf(req.headers.host);
    const version = slug ? await versionOf(slug) : null;
    const proj = slug && version === undefined ? await lookup(slug) : null;
    const port = version ? versionPort(version) : proj ? platform.devservers?.readyPort(proj.id) : null;
    if (!port) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      return;
    }
    const up = net.connect(port, "127.0.0.1", () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      up.write(lines.join("\r\n") + "\r\n\r\n");
      if (head?.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    upgraded.add(socket).add(up);
    const close = () => {
      up.destroy();
      socket.destroy();
      upgraded.delete(socket);
      upgraded.delete(up);
    };
    up.on("error", close);
    socket.on("error", close);
    up.on("close", close);
    socket.on("close", close);
  });
  return server;
}
