import { Hono } from "hono";
import { createOneServer } from "../../registry/lib/one-server";

// The static gallery (forkable.dev/blocks) has no server. So the page runs
// every block's real route code right here, on the Acme sample, and answers
// the components' fetch("/api/...") calls with it. Same code a fork mounts;
// only the transport differs. `pnpm dev` uses the real Node server instead.

type RouteFactory = (one: ReturnType<typeof createOneServer>) => Hono;
const metas = import.meta.glob<{ route?: string; name: string }>("../../registry/*/block.json", { eager: true, import: "default" });
const routes = import.meta.glob<Record<string, RouteFactory>>(["../../registry/*/route.ts", "!../../registry/sign-in-with-one/route.ts"], { eager: true });

export function installBrowserApi() {
  const one = createOneServer({ connect: null, userId: () => "gallery" });
  const app = new Hono();
  // Sign in with One needs a real server; here it reports "not set up yet".
  app.get("/api/one/status", (c) => c.json({ data: { configured: false, connected: false, connections: [] } }));
  for (const [path, meta] of Object.entries(metas)) {
    const mod = routes[path.replace("block.json", "route.ts")];
    if (meta.route && mod?.[meta.route]) app.route("/", mod[meta.route]!(one));
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return realFetch(input, init);
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 200)); // feel like a network
    return app.fetch(new Request(url, init));
  };
}
