import { Hono } from "hono";
import type { OneServer } from "../lib/one-server.js";
import { runtimeFor, searchPeople, type SearchParams } from "../lead/waterfall.js";

/** POST /api/lead/search { title?, company?, domain?, location?, limit? } -> SearchResponse */
export function leadPeopleSearchRoute(one: OneServer) {
  const r = new Hono();
  r.post("/api/lead/search", async (c) => {
    const f = (await c.req.json().catch(() => ({}))) as SearchParams;
    if (!f.title && !f.company && !f.domain && !f.location) return c.json({ error: { code: "bad_request", message: "Give at least one filter." } }, 400);
    try {
      const rt = runtimeFor(one, c);
      const data = await searchPeople(rt, f);
      return c.json({ data, meta: { mode: rt.mode, platform: "people-data-labs", access: "read", status: 200 } });
    } catch (e) {
      return one.error(c, e);
    }
  });
  return r;
}
