import { Hono } from "hono";
import type { OneServer } from "../lib/one-server.js";
import { GMAIL } from "../gmail/actions.js";
import { fromRaw, type RawThread } from "../gmail/map.js";
import { sampleModify, sampleThreads } from "../gmail/sample.js";

/** GET /api/gmail/threads/:id  (opening a thread marks it read) */
export function gmailThreadRoute(one: OneServer) {
  const r = new Hono();
  r.get("/api/gmail/threads/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const res = await one.call<RawThread>(c, {
        action: GMAIL.getThread,
        pathParams: { userId: "me", id },
        query: { format: "full" },
        sample: () => ({ id }),
      });
      if (res.meta.mode === "sample") {
        const t = sampleThreads().find((x) => x.id === id);
        if (!t) return c.json({ error: { code: "not_found", message: "No such thread." } }, 404);
        sampleModify(id, [], ["UNREAD"]);
        return c.json({ data: { ...t, unread: false }, meta: res.meta });
      }
      const t = fromRaw(res.data, "");
      if (!t) return c.json({ error: { code: "not_found", message: "No such thread." } }, 404);
      return c.json({ data: t, meta: res.meta });
    } catch (e) {
      return one.error(c, e);
    }
  });
  return r;
}
