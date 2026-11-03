import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./env";
import { oneRoutes } from "./one/connect";

// The app's API. Runtime-neutral Hono: server/worker.ts runs it on Workers,
// api/index.ts on Vercel. Add routes below the One routes.

const app = new Hono<AppEnv>();

app.get("/api/health", (c) => c.json({ ok: true, app: "__PROJECT_NAME__" }));

// Sign in with One, the grant, and /api/one/health. Do not edit.
app.route("/api/one", oneRoutes);

// App routes go here. Routes that call one(c).run start with requireUser(c).
// Example:
//   app.get("/api/hello", (c) => c.json({ message: "Hello from Acme Inc" }));

app.notFound((c) => c.json({ error: { code: "not_found", message: `No route for ${c.req.path}` } }, 404));

app.onError((err, c) => {
  // requireUser's 401 (and any HTTPException) keeps its own answer; only real failures are a 500.
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: { code: "server_error", message: err.message } }, 500);
});

export default app;
