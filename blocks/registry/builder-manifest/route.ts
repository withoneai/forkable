import { Hono } from "hono";
import type { OneMeta, OneServer } from "../lib/one-server.js";
import { BUILDER_SAMPLE } from "../builder/sample.js";
import { scanManifest } from "../builder/scan.js";
import type { ManifestResponse, SourceFile } from "../builder/types.js";

/**
 * POST /api/builder/manifest { files: [{ path, content }] } -> ManifestResponse
 * connect.manifest.json derived from the code: every One action it calls,
 * plus what goes around the grant. Titles the code leaves out come from
 * One's catalog on the user's grant. Before a Connect app exists, an empty
 * body scans the Acme sample app.
 */
export function builderManifestRoute(one: OneServer) {
  const r = new Hono();
  r.post("/api/builder/manifest", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { files?: SourceFile[] };
    const sample = one.mode() === "sample";
    const files = body.files?.length ? body.files.slice(0, 500) : sample ? BUILDER_SAMPLE.app.files : [];
    if (!files.length) return c.json({ error: { code: "bad_request", message: "Send the files to scan." } }, 400);
    try {
      const { manifest, issues } = scanManifest(files);
      let meta: OneMeta = { mode: one.mode(), platform: "one", access: "read", status: 200 };
      for (const a of manifest.actions.filter((x) => !x.title)) {
        const k = await one.catalog.knowledge(c, a.actionId, () => {
          const s = BUILDER_SAMPLE.catalog.find((x) => x.actionId === a.actionId);
          return s ? { _id: s.actionId, title: s.title, method: s.method, path: s.path, tags: [], knowledge: "" } : null;
        });
        meta = k.meta;
        if (k.data) a.title = k.data.title;
      }
      return c.json({ data: { manifest, issues, files: files.length } satisfies ManifestResponse, meta });
    } catch (e) {
      return one.error(c, e);
    }
  });
  return r;
}
