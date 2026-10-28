import { Hono } from "hono";
import type { OneServer } from "../lib/one-server.js";
import { GMAIL } from "../gmail/actions.js";
import { sampleModify } from "../gmail/sample.js";

const OPS = {
  archive: { add: [], remove: ["INBOX"] },
  unarchive: { add: ["INBOX"], remove: [] },
  read: { add: [], remove: ["UNREAD"] },
  unread: { add: ["UNREAD"], remove: [] },
  star: { add: ["STARRED"], remove: [] },
  unstar: { add: [], remove: ["STARRED"] },
} as const;
export type ThreadOp = keyof typeof OPS;

/** POST /api/gmail/threads/:id/modify  { op: "archive" | "unarchive" | "read" | "unread" | "star" | "unstar" } */
export function gmailThreadActionsRoute(one: OneServer) {
  const r = new Hono();
  r.post("/api/gmail/threads/:id/modify", async (c) => {
    const id = c.req.param("id");
    const { op } = await c.req.json<{ op: ThreadOp }>();
    const change = OPS[op];
    if (!change) return c.json({ error: { code: "bad_request", message: `Unknown op ${op}.` } }, 400);
    try {
      const res = await one.call(c, {
        action: GMAIL.modifyThread,
        pathParams: { userId: "me", id },
        body: { addLabelIds: change.add, removeLabelIds: change.remove },
        sample: () => sampleModify(id, [...change.add], [...change.remove]),
      });
      return c.json({ data: { id, op }, meta: res.meta });
    } catch (e) {
      return one.error(c, e);
    }
  });
  return r;
}
