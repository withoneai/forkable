import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./server.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgName = (JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { name: string }).name;

const { app, env } = createApp();
serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`${pkgName} listening on http://127.0.0.1:${info.port}`);
});
