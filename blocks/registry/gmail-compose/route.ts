import { Hono } from "hono";
import type { OneServer } from "../lib/one-server.js";
import { GMAIL } from "../gmail/actions.js";
import type { DraftInput } from "../gmail/types.js";

let sampleDrafts = 0;

/**
 * POST /api/gmail/drafts  DraftInput -> { id }   saves to the user's Gmail Drafts
 * POST /api/gmail/send    DraftInput -> { id }   sends now
 */
export function gmailComposeRoute(one: OneServer) {
  const r = new Hono();

  r.post("/api/gmail/drafts", async (c) => {
    const d = await c.req.json<DraftInput>();
    if (!d.to?.length) return c.json({ error: { code: "bad_request", message: "Add at least one recipient." } }, 400);
    try {
      const res = await one.call<{ id?: string; draftId?: string }>(c, {
        action: GMAIL.createDraft,
        body: { to: d.to.join(", "), subject: d.subject, body: d.body, ...(d.threadId ? { threadId: d.threadId } : {}) },
        sample: () => ({ id: `sample-draft-${++sampleDrafts}` }),
      });
      return c.json({ data: { id: res.data.id ?? res.data.draftId ?? "created" }, meta: res.meta });
    } catch (e) {
      return one.error(c, e);
    }
  });

  r.post("/api/gmail/send", async (c) => {
    const d = await c.req.json<DraftInput>();
    if (!d.to?.length) return c.json({ error: { code: "bad_request", message: "Add at least one recipient." } }, 400);
    try {
      const res = await one.call<{ id?: string }>(c, {
        action: GMAIL.sendEmail,
        body: { to: d.to.join(", "), subject: d.subject, body: d.body, ...(d.threadId ? { threadId: d.threadId } : {}) },
        sample: () => ({ id: "sample-sent" }),
      });
      return c.json({ data: { id: res.data.id ?? "sent" }, meta: res.meta });
    } catch (e) {
      return one.error(c, e);
    }
  });

  return r;
}
