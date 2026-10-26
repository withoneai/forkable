import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  agents, assistant, localWriter, newId, oneWriter, schema, writer,
  type ApiChat, type ApiChatMessage, type ChatMessageInput, type ChatStreamEvent, type Ctx, type Writer,
} from "@rill/core";
import type { AppEnv } from "../deps.js";
import { badRequest, HttpError, notFound } from "../errors.js";
import { detectedEngines } from "./engines.js";
import { loadMailboxCtx, readJson } from "./lib.js";

export const chatRoutes = new Hono<AppEnv>();

function toApiChat(c: typeof schema.chats.$inferSelect): ApiChat {
  return { id: c.id, title: c.title, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() };
}

function toApiChatMessage(m: typeof schema.chatMessages.$inferSelect): ApiChatMessage {
  return {
    id: m.id, chatId: m.chatId, role: m.role, content: m.content, blocks: m.blocks,
    engine: m.engine, model: m.model, createdAt: m.createdAt.toISOString(),
  };
}

async function loadChat(c: Parameters<typeof loadMailboxCtx>[0]) {
  const loaded = await loadMailboxCtx(c);
  const [chat] = await loaded.db.select().from(schema.chats)
    .where(and(eq(schema.chats.id, c.req.param("chatId") ?? ""), eq(schema.chats.mailboxId, loaded.mailbox.id))).limit(1);
  if (!chat) throw notFound("Chat");
  return { ...loaded, chat };
}

/**
 * Builds a writer honoring a per-message engine override, falling back to
 * `pickWriter`. Neither path sets a `recordingKey`, so on a sample mailbox
 * `pickWriter`'s fixture wrapper passes straight through to the real writer:
 * chat always gets a live answer, never a canned recording.
 */
async function pickChatWriter(ctx: Ctx, detected: Awaited<ReturnType<typeof detectedEngines>>, override?: ChatMessageInput["engine"]): Promise<Writer | null> {
  if (override?.engine === "local") {
    const ready = detected.find((o) => o.group === "local" && o.status === "ready" && o.id === override.provider);
    const cli = ready ? (await agents.detect()).find((d) => d.id === ready.id) : null;
    if (cli?.bin) return localWriter({ id: cli.id, bin: cli.bin }, override.model || undefined);
  } else if (override?.engine === "one" && override.provider === "anthropic") {
    return oneWriter("anthropic", override.model || undefined);
  }
  return writer.pickWriter(ctx, detected);
}

function deriveTitle(content: string): string {
  const clean = content.replace(/^\/\w+\s*/, "").trim().replace(/\s+/g, " ");
  return clean.length > 60 ? `${clean.slice(0, 60)}…` : clean || "New chat";
}

chatRoutes.get("/mailboxes/:id/chats", async (c) => {
  const { mailbox, db } = await loadMailboxCtx(c);
  const rows = await db.select().from(schema.chats).where(eq(schema.chats.mailboxId, mailbox.id)).orderBy(desc(schema.chats.updatedAt)).limit(50);
  return c.json(rows.map(toApiChat));
});

chatRoutes.post("/mailboxes/:id/chats", async (c) => {
  const { mailbox, db } = await loadMailboxCtx(c);
  const { title } = await readJson<{ title?: string }>(c);
  const [row] = await db.insert(schema.chats).values({ id: newId("chat"), mailboxId: mailbox.id, title: title?.trim() || "New chat" }).returning();
  return c.json(toApiChat(row!));
});

chatRoutes.get("/mailboxes/:id/chats/:chatId", async (c) => {
  const { chat, db } = await loadChat(c);
  const messages = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.chatId, chat.id)).orderBy(asc(schema.chatMessages.createdAt));
  return c.json({ chat: toApiChat(chat), messages: messages.map(toApiChatMessage) });
});

chatRoutes.delete("/mailboxes/:id/chats/:chatId", async (c) => {
  const { chat, db } = await loadChat(c);
  await db.delete(schema.chats).where(eq(schema.chats.id, chat.id));
  return c.body(null, 204);
});

chatRoutes.post("/mailboxes/:id/chats/:chatId/messages", async (c) => {
  const { ctx, chat, db } = await loadChat(c);
  const input = await readJson<ChatMessageInput>(c);
  if (typeof input.content !== "string" || !input.content.trim()) throw badRequest("content is required");

  const priorRows = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.chatId, chat.id)).orderBy(asc(schema.chatMessages.createdAt)).limit(40);
  const history = priorRows.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })).filter((m) => m.role === "user" || m.role === "assistant");

  const [userRow] = await db.insert(schema.chatMessages).values({
    id: newId("cmsg"), chatId: chat.id, role: "user", content: input.content, blocks: {},
  }).returning();
  void userRow;

  const detected = await detectedEngines(c.get("deps"), ctx.user.id);
  const w = await pickChatWriter(ctx, detected, input.engine);
  if (!w) throw new HttpError(503, "no_writer", "No writer is available. Pick an engine in Settings.");

  return streamSSE(c, async (stream) => {
    try {
      const result = await assistant.respond(ctx, w, { content: input.content, context: input.context, history }, {
        stream: (delta) => {
          if (!delta) return;
          const ev: ChatStreamEvent = { type: "delta", text: delta };
          void stream.writeSSE({ event: "delta", data: JSON.stringify(ev) });
        },
      });

      const blocksEv: ChatStreamEvent = { type: "blocks", proposals: result.blocks.proposals ?? [], citations: result.blocks.citations ?? [] };
      await stream.writeSSE({ event: "blocks", data: JSON.stringify(blocksEv) });

      const [assistantRow] = await db.insert(schema.chatMessages).values({
        id: newId("cmsg"), chatId: chat.id, role: "assistant", content: result.text, blocks: result.blocks,
        engine: result.engine, model: result.model,
      }).returning();
      await db.update(schema.chats).set({ updatedAt: new Date(), title: chat.title === "New chat" ? deriveTitle(input.content) : chat.title }).where(eq(schema.chats.id, chat.id));

      const doneEv: ChatStreamEvent = { type: "done", messageId: assistantRow!.id, engine: result.engine, model: result.model };
      await stream.writeSSE({ event: "done", data: JSON.stringify(doneEv) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorEv: ChatStreamEvent = { type: "error", message };
      await stream.writeSSE({ event: "error", data: JSON.stringify(errorEv) });
    }
  });
});
