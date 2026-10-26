import { Hono } from "hono";
import { errorToResponse } from "./errors.js";
import type { AppEnv, Deps } from "./deps.js";
import { sessionMiddleware } from "./session.js";
import { mountConnectRoutes } from "./connect.js";
import { accessRoutes } from "./routes/access.js";
import { briefRoutes } from "./routes/brief.js";
import { calendarRoutes } from "./routes/calendar.js";
import { chatRoutes } from "./routes/chats.js";
import { draftRoutes } from "./routes/drafts.js";
import { engineRoutes } from "./routes/engines.js";
import { goalRoutes } from "./routes/goals.js";
import { inboxRoutes } from "./routes/inbox.js";
import { mailboxRoutes } from "./routes/mailboxes.js";
import { meRoutes } from "./routes/me.js";
import { miscRoutes } from "./routes/misc.js";
import { vipRoutes } from "./routes/vips.js";
import { setupRoutes } from "./routes/setup.js";

export interface CreateAppOptions {
  /** Node only: the Connect routes need the raw req/res. The Worker mounts its own. */
  mountConnect?: boolean;
}

/** The whole API. Static files and the Connect adapter are the entry's job. */
export function createApp(deps: Deps, opts: CreateAppOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("deps", deps);
    await next();
  });
  app.use("/api/*", sessionMiddleware);
  app.onError((err, c) => errorToResponse(c, err));
  app.notFound((c) => c.json({ error: { code: "not_found", message: "No such route" } }, 404));

  app.get("/api/health", (c) => c.json({ ok: true, version: deps.version }));

  if (opts.mountConnect !== false) mountConnectRoutes(app, deps);

  const v1 = new Hono<AppEnv>();
  v1.route("/", meRoutes);
  v1.route("/", mailboxRoutes);
  v1.route("/", inboxRoutes);
  v1.route("/", draftRoutes);
  v1.route("/", goalRoutes);
  v1.route("/", vipRoutes);
  v1.route("/", briefRoutes);
  v1.route("/", calendarRoutes);
  v1.route("/", accessRoutes);
  v1.route("/", chatRoutes);
  v1.route("/", miscRoutes);
  v1.route("/", engineRoutes);
  v1.route("/", setupRoutes);
  app.route("/api/v1", v1);

  return app;
}
