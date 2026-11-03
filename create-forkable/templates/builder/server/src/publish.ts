// Publish routes: the scan, GitHub export and Vercel deploy
// on the builder's grant, and publish history. Request bodies are never
// logged: the Vercel body may carry the database token, which goes to
// Vercel once and nowhere else.

import type { Context, Hono } from "hono";
import { PublishRefused, type ApiError, type Platform, type ProjectRow, type PublishBody, type PublishStartResponse } from "@builder/core";

function fail(c: Context, status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  const body: ApiError & Record<string, unknown> = { error: { code, message }, ...extra };
  return c.json(body, status as 400);
}

export function mountPublish(app: Hono, p: Platform, log: (line: string) => void): void {
  const load = async (c: Context): Promise<ProjectRow | Response> => {
    const row = await p.workspace.get(c.req.param("id")!);
    if (!row || row.archivedAt) return fail(c, 404, "not_found", "No such project.");
    return row;
  };
  const refused = (c: Context, err: unknown): Response => {
    if (err instanceof PublishRefused) return fail(c, err.status, err.code, err.message, err.scan ? { scan: err.scan } : {});
    log(`publish: ${(err as Error).message}`);
    return fail(c, 500, "publish_failed", (err as Error).message || "Publishing stopped.");
  };

  app.post("/api/projects/:id/publish/scan", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    const { sha } = (await c.req.json().catch(() => ({}))) as { sha?: string };
    try {
      return c.json({ scan: await p.publish.scan(row, sha) });
    } catch (err) {
      return refused(c, err);
    }
  });

  app.post("/api/projects/:id/publish", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    const body = (await c.req.json().catch(() => null)) as PublishBody | null;
    if (!body || typeof body !== "object") return fail(c, 400, "bad_body", "Send {target, options}.");
    try {
      const { record } = await p.publish.publish(row, body);
      const out: PublishStartResponse = { publish: record };
      return c.json(out, 202);
    } catch (err) {
      return refused(c, err);
    }
  });

  app.get("/api/projects/:id/publishes", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    return c.json(await p.publish.response(row));
  });
}
