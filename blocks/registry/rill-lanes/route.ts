import { Hono } from "hono";
import type { OneServer } from "../lib/one-server.js";
import { judgedInbox } from "../rill/inbox.js";

/** GET /api/rill/lanes?limit= -> LanesResponse. Gmail threads, Jev per thread, Rill's lane policy. */
export function rillLanesRoute(one: OneServer) {
  const r = new Hono();
  r.get("/api/rill/lanes", async (c) => {
    const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 25)));
    try {
      const { data, meta } = await judgedInbox(one, c, limit);
      return c.json({ data, meta });
    } catch (e) {
      return one.error(c, e);
    }
  });
  return r;
}
