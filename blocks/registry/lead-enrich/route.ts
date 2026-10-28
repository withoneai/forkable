import { Hono } from "hono";
import type { OneServer } from "../lib/one-server.js";
import { enrichPerson, runtimeFor, type EnrichParams } from "../lead/waterfall.js";

/** POST /api/lead/enrich { email? | linkedinUrl? | name + domain } -> EnrichResponse */
export function leadEnrichRoute(one: OneServer) {
  const r = new Hono();
  r.post("/api/lead/enrich", async (c) => {
    const p = (await c.req.json().catch(() => ({}))) as EnrichParams;
    if (!p.email && !p.linkedinUrl && !(p.name && p.domain)) return c.json({ error: { code: "bad_request", message: "Give an email, a LinkedIn URL, or a name and a company domain." } }, 400);
    try {
      const rt = runtimeFor(one, c);
      const data = await enrichPerson(rt, p);
      return c.json({ data, meta: { mode: rt.mode, platform: "people-data-labs", access: "read", status: 200 } });
    } catch (e) {
      return one.error(c, e);
    }
  });
  return r;
}
