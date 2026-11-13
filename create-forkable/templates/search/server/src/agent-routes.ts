// GET /start.md, /skill.md, /.well-known/agent-skills/search/SKILL.md,
// /.well-known/agent-skills/index.json and /llms.txt (SPEC 16.5). Public on
// purpose: they hold no data and no paths, only how to connect and how to use the tools.

import type { Context, Hono } from "hono";
import { llmsTxt, skillMd, skillsIndex, startMd } from "./agent-docs.js";
import type { AppEnv, Deps } from "./deps.js";
import { baseFor } from "./oauth.js";

export function mountAgentDocs(app: Hono<AppEnv>, deps: Deps): void {
  const md = (c: Context, body: string, type = "text/markdown; charset=utf-8") =>
    c.body(body, 200, { "content-type": type, "cache-control": "no-cache", "access-control-allow-origin": "*" });
  app.get("/start.md", (c) => md(c, startMd(baseFor(deps, c))));
  app.get("/skill.md", (c) => md(c, skillMd(baseFor(deps, c))));
  app.get("/.well-known/agent-skills/search/SKILL.md", (c) => md(c, skillMd(baseFor(deps, c))));
  app.get("/.well-known/agent-skills/index.json", (c) => md(c, skillsIndex(baseFor(deps, c)), "application/json; charset=utf-8"));
  app.get("/llms.txt", (c) => md(c, llmsTxt(baseFor(deps, c)), "text/plain; charset=utf-8"));
}
