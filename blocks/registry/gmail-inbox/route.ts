import { Hono } from "hono";
import type { OneServer } from "../lib/one-server.js";
import { GMAIL } from "../gmail/actions.js";
import { fromHelper, toSummary, type HelperThread } from "../gmail/map.js";
import { sampleThreads } from "../gmail/sample.js";
import type { MailThread } from "../gmail/types.js";

const VIEWS = { inbox: "in:inbox", unread: "in:inbox is:unread", starred: "is:starred", sent: "in:sent" } as const;
export type InboxView = keyof typeof VIEWS;

/** GET /api/gmail/threads?view=inbox|unread|starred|sent&q=&limit= */
export function gmailInboxRoute(one: OneServer) {
  const r = new Hono();
  r.get("/api/gmail/threads", async (c) => {
    const view = (c.req.query("view") ?? "inbox") as InboxView;
    const q = (c.req.query("q") ?? "").trim();
    const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 25)));
    try {
      const res = await one.call<{ threads?: HelperThread[] }>(c, {
        action: GMAIL.getThreads,
        body: { query: [VIEWS[view] ?? VIEWS.inbox, q].filter(Boolean).join(" "), numberOfThreads: limit, format: "full", maxBodyLength: 400 },
        sample: () => ({ threads: [] }),
      });
      const threads: MailThread[] =
        res.meta.mode === "sample"
          ? filterSample(view, q).slice(0, limit)
          : (res.data.threads ?? []).map((t) => fromHelper(t, "")).filter((t) => t !== null).map(toSummary);
      return c.json({ data: threads, meta: res.meta });
    } catch (e) {
      return one.error(c, e);
    }
  });
  return r;
}

function filterSample(view: InboxView, q: string): MailThread[] {
  const needle = q.toLowerCase();
  return sampleThreads()
    .filter((t) => (view === "unread" ? t.inInbox && t.unread : view === "starred" ? t.starred : view === "sent" ? t.messages.some((m) => m.fromMe) : t.inInbox))
    .filter((t) => !needle || `${t.subject} ${t.from.name} ${t.from.email} ${t.snippet}`.toLowerCase().includes(needle))
    .map(toSummary);
}
