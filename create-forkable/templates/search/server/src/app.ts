// The whole API on Hono. Static files and the dev redirect are node.ts's job.

import { Hono } from "hono";
import type { AppEnv, Deps } from "./deps.js";
import { errorToResponse } from "./errors.js";
import { sessionMiddleware } from "./session.js";
import { mountConnectRoutes } from "./connect.js";
import { accountRoutes } from "./routes/account.js";
import { chatRoutes } from "./routes/chat.js";
import { profileRoutes } from "./routes/profiles.js";
import { searchRoutes } from "./routes/search.js";
import { setupRoutes } from "./routes/setup.js";
import { sourceRoutes } from "./routes/sources.js";
import { apiBearer, mountOAuth } from "./oauth.js";
import { mountMcp } from "./mcp.js";

export function createApp(deps: Deps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("deps", deps); await next(); });
  app.use("/api/*", sessionMiddleware);
  app.onError((err, c) => errorToResponse(c, err));
  app.notFound((c) => c.json({ error: { code: "not_found", message: "No such route." } }, 404));

  app.get("/api/health", (c) => c.json({ ok: true, version: deps.version, capability: deps.capability, db: deps.dbInfo.kind, publicUrl: deps.env.PUBLIC_URL }));
  mountConnectRoutes(app, deps);
  // OAuth authorization server (CLI, scripts, MCP clients) and the MCP endpoint.
  app.use("/oauth/*", sessionMiddleware);
  app.use("/authorize", sessionMiddleware);
  const oauth = mountOAuth(app, deps);
  mountMcp(app, deps, oauth);

  const v1 = new Hono<AppEnv>();
  v1.use("*", apiBearer(deps, oauth));
  v1.route("/", accountRoutes);
  v1.route("/", searchRoutes);
  v1.route("/", chatRoutes);
  v1.route("/", sourceRoutes);
  v1.route("/", profileRoutes);
  v1.route("/", setupRoutes);
  app.route("/api/v1", v1);
  return app;
}
