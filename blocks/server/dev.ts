import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createOneServer } from "../registry/lib/one-server.js";
import { signInWithOneRoute } from "../registry/sign-in-with-one/route.js";

// The gallery's backend: every block's real route, mounted the way a fork
// mounts them. No Connect app here, so each call answers from the sample
// and says so in meta.mode. Routes are found from each block.json.

const REGISTRY = join(dirname(fileURLToPath(import.meta.url)), "../registry");
const connect = null;
const userId = () => "gallery";
const one = createOneServer({ connect, userId });

const app = new Hono();
app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/", signInWithOneRoute({ connect, userId, identifyUser: () => "gallery" }));

for (const dir of readdirSync(REGISTRY)) {
  const meta = join(REGISTRY, dir, "block.json");
  if (!existsSync(meta)) continue;
  const block = JSON.parse(readFileSync(meta, "utf8")) as { route?: string };
  if (!block.route || dir === "sign-in-with-one") continue;
  const mod = await import(join(REGISTRY, dir, "route.ts"));
  app.route("/", mod[block.route](one));
}

const port = Number(process.env.PORT ?? 52190);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => console.log(`blocks api on http://127.0.0.1:${port}`));
