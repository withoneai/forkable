// The assistant (SPEC 14, CONTRACT 7.1): POST /chat streams ChatEvents as SSE
// (`event: <type>` + `data: <json>`), POST /answer is one round for the strip.

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { and, asc, desc, eq } from "drizzle-orm";
import { answerOnce, dbSchema, runChatTurn, type ChatEvent, type ChatMessage, type ChatTurnInput } from "@search/core";
import type { AppEnv } from "../deps.js";
import { badRequest, notFound } from "../errors.js";
import { requireUser } from "../session.js";
import { need, readJson } from "./lib.js";

const { chats, chatMessages } = dbSchema;

export const chatRoutes = new Hono<AppEnv>();

chatRoutes.get("/chats", async (c) => {
  need(c, "search:ask");
  const u = await requireUser(c);
  const rows = await c.get("deps").db.select().from(chats).where(eq(chats.userId, u.id)).orderBy(desc(chats.updatedAt)).limit(100);
  return c.json(rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.toISOString() })));
});

chatRoutes.get("/chats/:id", async (c) => {
  need(c, "search:ask");
  const u = await requireUser(c);
  const db = c.get("deps").db;
  const [chat] = await db.select().from(chats).where(and(eq(chats.id, c.req.param("id")), eq(chats.userId, u.id)));
  if (!chat) throw notFound("Chat");
  const msgs = await db.select().from(chatMessages).where(eq(chatMessages.chatId, chat.id)).orderBy(asc(chatMessages.createdAt));
  const messages: ChatMessage[] = msgs.map((m) => ({
    id: m.id, role: m.role, content: m.content, citations: m.citations, steps: m.steps, proposal: m.proposal ?? null,
    followups: m.followups, grounded: m.grounded, model: m.model ?? "", createdAt: m.createdAt.toISOString(),
  }));
  return c.json({ id: chat.id, title: chat.title, messages });
});

chatRoutes.delete("/chats/:id", async (c) => {
  need(c, "search:ask");
  const u = await requireUser(c);
  const db = c.get("deps").db;
  const [chat] = await db.select({ id: chats.id }).from(chats).where(and(eq(chats.id, c.req.param("id")), eq(chats.userId, u.id)));
  if (chat) {
    await db.delete(chatMessages).where(eq(chatMessages.chatId, chat.id));
    await db.delete(chats).where(eq(chats.id, chat.id));
  }
  return c.body(null, 204);
});

chatRoutes.post("/chat", async (c) => {
  need(c, "search:ask");
  const u = await requireUser(c);
  const b = await readJson<Partial<ChatTurnInput>>(c);
  if (!b.message?.trim()) throw badRequest("Empty message.");
  if (b.chatId) {
    const [chat] = await c.get("deps").db.select({ id: chats.id }).from(chats).where(and(eq(chats.id, b.chatId), eq(chats.userId, u.id)));
    if (!chat) throw notFound("Chat");
  }
  const input: ChatTurnInput = { chatId: b.chatId, message: b.message.trim(), context: b.context ?? {} };
  const ctx = c.get("deps").ctx;
  const abort = new AbortController();
  return streamSSE(c, async (stream) => {
    stream.onAbort(() => abort.abort());
    const send = (e: ChatEvent) => stream.writeSSE({ event: e.type, data: JSON.stringify(e) });
    try {
      for await (const ev of runChatTurn(ctx, u.id, input, abort.signal, viaOf(c))) {
        if (abort.signal.aborted) break;
        await send(ev);
      }
    } catch (e) {
      if (!abort.signal.aborted) {
        await send({ type: "error", error: { code: "internal", message: (e as Error).message } });
        await send({ type: "done" });
      }
    }
  });
});

chatRoutes.post("/answer", async (c) => {
  need(c, "search:ask");
  const u = await requireUser(c);
  const b = await readJson<{ q?: string; queryId?: string }>(c);
  if (!b.q?.trim()) throw badRequest("q is required.");
  return c.json(await answerOnce(c.get("deps").ctx, u.id, { q: b.q.trim(), queryId: b.queryId }, viaOf(c)));
});

/** A bearer (OAuth client) request logs as api with its client id; the web session stays the assistant. */
function viaOf(c: { get: (k: "clientId") => string | null | undefined }): { actor: "assistant" | "api"; clientId: string | null } {
  const clientId = c.get("clientId") ?? null;
  return clientId ? { actor: "api", clientId } : { actor: "assistant", clientId: null };
}
