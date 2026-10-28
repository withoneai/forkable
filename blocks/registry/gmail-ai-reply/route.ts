import { Hono } from "hono";
import type { OneServer } from "../lib/one-server.js";
import { ANTHROPIC, GMAIL } from "../gmail/actions.js";
import { fromRaw, type RawThread } from "../gmail/map.js";
import recorded from "../../fixtures/gmail-ai.json" with { type: "json" };

export interface ReplyAssist {
  summary: string;
  ask: string | null;
  draft: string | null;
}

const MODEL = "claude-haiku-5-5";
const SYSTEM = `You help someone handle one email thread. Return JSON only:
{"summary": two sentences on what this thread is and what is wanted,
 "ask": what they need to do, in one short line, or null,
 "draft": a reply in their voice, plain text, no subject, no sign-off name, or null if no reply is needed}.
Write like a busy, warm person. Never invent facts, numbers or dates.`;

/**
 * POST /api/gmail/threads/:id/assist -> ReplyAssist
 * Reads the thread on the user's Gmail grant, then asks Claude through One on
 * the same grant. No model key in the app.
 */
export function gmailAiReplyRoute(one: OneServer) {
  const r = new Hono();
  r.post("/api/gmail/threads/:id/assist", async (c) => {
    const id = c.req.param("id");
    try {
      const thread = await one.call<RawThread>(c, {
        action: GMAIL.getThread,
        pathParams: { userId: "me", id },
        query: { format: "full" },
        sample: () => ({ id }),
      });
      if (thread.meta.mode === "sample") {
        const rec = (recorded as unknown as Record<string, ReplyAssist | { summary: null }>)[id];
        if (!rec?.summary) return c.json({ error: { code: "not_found", message: "No sample for this thread." } }, 404);
        return c.json({ data: rec as ReplyAssist, meta: { ...thread.meta, platform: "anthropic" } });
      }
      const t = fromRaw(thread.data, "");
      if (!t) return c.json({ error: { code: "not_found", message: "No such thread." } }, 404);
      const text = t.messages.map((m) => `From: ${m.from.name} <${m.from.email}>\n${m.body.slice(0, 4000)}`).join("\n\n---\n\n");
      const res = await one.call<{ content?: { type: string; text?: string }[] }>(c, {
        action: ANTHROPIC.messages,
        body: { model: MODEL, max_tokens: 800, system: SYSTEM, messages: [{ role: "user", content: `Subject: ${t.subject}\n\n${text}` }] },
        sample: () => ({ content: [] }),
      });
      const raw = res.data.content?.find((b) => b.type === "text")?.text ?? "{}";
      const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as ReplyAssist;
      return c.json({ data: json, meta: res.meta });
    } catch (e) {
      return one.error(c, e);
    }
  });
  return r;
}
