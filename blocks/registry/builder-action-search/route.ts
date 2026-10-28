import { Hono } from "hono";
import type { OneServer } from "../lib/one-server.js";
import { BUILDER_SAMPLE, searchSample } from "../builder/sample.js";
import type { CatalogAction, CatalogDoc } from "../builder/types.js";

/**
 * GET /api/builder/actions?platform=&q=  -> CatalogAction[]  (One's catalog, best first)
 * GET /api/builder/actions/:id           -> CatalogDoc       (the action's docs)
 * Both read One's catalog on the signed-in user's grant; no provider is called.
 */
export function builderActionSearchRoute(one: OneServer) {
  const r = new Hono();
  r.get("/api/builder/actions", async (c) => {
    const platform = (c.req.query("platform") ?? "").trim().toLowerCase();
    const q = (c.req.query("q") ?? "").trim();
    try {
      const res = await one.catalog.search(c, platform, q, () => searchSample(platform, q).map((a) => ({ _id: a.actionId, title: a.title, method: a.method, path: a.path, tags: [a.platform] })));
      const data: CatalogAction[] = res.data.map((a) => ({ actionId: a._id, title: a.title, method: a.method, path: a.path, platform: platform || a.tags?.[0] || "" }));
      return c.json({ data, meta: res.meta });
    } catch (e) {
      return one.error(c, e);
    }
  });
  r.get("/api/builder/actions/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const res = await one.catalog.knowledge(c, id, () => {
        const a = BUILDER_SAMPLE.catalog.find((x) => x.actionId === id);
        return a ? { _id: a.actionId, title: a.title, method: a.method, path: a.path, tags: [], knowledge: a.knowledge, platform: a.platform } : null;
      });
      if (!res.data) return c.json({ error: { code: "not_found", message: "No such action in the sample catalog." } }, 404);
      const k = res.data;
      return c.json({ data: { actionId: k._id, title: k.title, method: k.method, path: k.path, platform: k.platform ?? "", knowledge: k.knowledge } satisfies CatalogDoc, meta: res.meta });
    } catch (e) {
      return one.error(c, e);
    }
  });
  return r;
}
