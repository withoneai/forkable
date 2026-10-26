import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getMailProvider, newId, schema, writer, type Person } from "@rill/core";
import type { AppEnv } from "../deps.js";
import { badRequest, HttpError, notFound } from "../errors.js";
import { detectedEngines } from "./engines.js";
import { latestInbound, loadMailboxCtx, loadThread, readJson, threadMessages, toApiDraft, toMail, toThreadRecord } from "./lib.js";

export const draftRoutes = new Hono<AppEnv>();

const replySubject = (s: string) => (/^re:/i.test(s.trim()) ? s.trim() : `Re: ${s.trim()}`);

draftRoutes.post("/mailboxes/:id/threads/:threadId/draft", async (c) => {
  const { ctx, mailbox, db } = await loadMailboxCtx(c);
  const thread = await loadThread(db, mailbox.id, c.req.param("threadId"));
  const { instructions } = await readJson<{ instructions?: string }>(c);
  const msgs = await threadMessages(db, thread.id);
  const latest = latestInbound(msgs);
  if (!latest) throw badRequest("Nothing to reply to in this thread");

  const w = await writer.pickWriter(ctx, await detectedEngines(c.get("deps"), ctx.user.id));
  if (!w) throw new HttpError(503, "no_writer", "No writer is available. Pick an engine in Settings.");

  const [state] = await db.select().from(schema.threadState).where(eq(schema.threadState.threadId, thread.id)).limit(1);
  const goal = state?.goalId ? (await db.select().from(schema.goals).where(eq(schema.goals.id, state.goalId)).limit(1))[0] ?? null : null;
  const vip = state?.vipId ? (await db.select().from(schema.vips).where(eq(schema.vips.id, state.vipId)).limit(1))[0] ?? null : null;
  const recent = await db.select({ subject: schema.threads.subject }).from(schema.threads)
    .where(and(eq(schema.threads.mailboxId, mailbox.id), inArray(schema.threads.id,
      db.select({ id: schema.messages.threadId }).from(schema.messages).where(and(eq(schema.messages.mailboxId, mailbox.id), eq(schema.messages.fromEmail, latest.fromEmail))))))
    .orderBy(desc(schema.threads.lastMessageAt)).limit(5);
  const person: Person = {
    name: latest.fromName, email: latest.fromEmail, vipName: vip?.name ?? null, tier: vip?.tier ?? null,
    recentSubjects: recent.map((r) => r.subject),
  };

  const result = await writer.draft(ctx, w, {
    mail: toMail(latest), thread: toThreadRecord(thread, msgs), me: ctx.settings.me ?? "", person, goal, instructions,
  });

  const [open] = await db.select().from(schema.drafts)
    .where(and(eq(schema.drafts.threadId, thread.id), inArray(schema.drafts.status, ["proposed", "edited"])))
    .orderBy(desc(schema.drafts.updatedAt)).limit(1);
  const values = {
    to: [latest.fromEmail], subject: replySubject(thread.subject), body: result.body, engine: w.engine, model: w.model,
    status: "proposed" as const, validator: result.validator, replyToMessageId: latest.id, updatedAt: new Date(),
  };
  let row;
  if (open) {
    [row] = await db.update(schema.drafts).set(values).where(eq(schema.drafts.id, open.id)).returning();
  } else {
    [row] = await db.insert(schema.drafts).values({ id: newId("drf"), threadId: thread.id, mailboxId: mailbox.id, ...values }).returning();
  }
  ctx.emit({ type: "draft", threadId: thread.id, draftId: row!.id });
  return c.json(toApiDraft(row!));
});

// A new, non-reply draft (no thread yet). Mirrors createDraft's reply path, just without a threadId.
draftRoutes.post("/mailboxes/:id/compose", async (c) => {
  const { ctx, mailbox } = await loadMailboxCtx(c);
  const { to, subject, body } = await readJson<{ to?: string[]; subject?: string; body?: string }>(c);
  if (!Array.isArray(to) || to.length === 0 || to.some((a) => typeof a !== "string" || !a.trim())) throw badRequest("`to` must be a non-empty array of addresses");
  if (typeof subject !== "string" || !subject.trim()) throw badRequest("`subject` is required");
  if (typeof body !== "string") throw badRequest("`body` must be a string");
  const { gmailDraftId } = await getMailProvider(mailbox.mailProvider).createDraft(ctx, { to, subject: subject.trim(), body });
  return c.json({ gmailDraftId });
});

async function loadDraft(c: Parameters<typeof loadMailboxCtx>[0]) {
  const loaded = await loadMailboxCtx(c);
  const [draft] = await loaded.db.select().from(schema.drafts)
    .where(and(eq(schema.drafts.id, c.req.param("draftId") ?? ""), eq(schema.drafts.mailboxId, loaded.mailbox.id))).limit(1);
  if (!draft) throw notFound("Draft");
  return { ...loaded, draft };
}

draftRoutes.put("/mailboxes/:id/drafts/:draftId", async (c) => {
  const { db, draft } = await loadDraft(c);
  const { body } = await readJson<{ body?: string }>(c);
  if (typeof body !== "string") throw badRequest("`body` must be a string");
  if (draft.status === "sent") throw new HttpError(409, "already_sent", "This draft was sent and cannot change.");
  const [row] = await db.update(schema.drafts).set({ body, status: "edited", updatedAt: new Date() }).where(eq(schema.drafts.id, draft.id)).returning();
  return c.json(toApiDraft(row!));
});

draftRoutes.post("/mailboxes/:id/drafts/:draftId/save", async (c) => {
  const { ctx, db, draft } = await loadDraft(c);
  if (draft.status === "sent") throw new HttpError(409, "already_sent", "This draft was sent already.");
  const thread = await loadThread(db, ctx.mailbox.id, draft.threadId);
  const reply = draft.replyToMessageId ? (await db.select().from(schema.messages).where(eq(schema.messages.id, draft.replyToMessageId)).limit(1))[0] : undefined;
  const { gmailDraftId } = await getMailProvider(ctx.mailbox.mailProvider).createDraft(ctx, {
    to: draft.to, subject: draft.subject, body: draft.body, threadId: thread.gmailId, inReplyTo: reply?.messageIdHeader ?? undefined, replyToMessageId: reply?.gmailId,
  });
  const [row] = await db.update(schema.drafts).set({ gmailDraftId, status: "saved", updatedAt: new Date() }).where(eq(schema.drafts.id, draft.id)).returning();
  return c.json(toApiDraft(row!));
});

// The only path in Rill that calls send-email. A person pressed Send.
draftRoutes.post("/mailboxes/:id/drafts/:draftId/send", async (c) => {
  const { ctx, db, draft } = await loadDraft(c);
  if (draft.status === "sent") throw new HttpError(409, "already_sent", "This draft was sent already.");
  if (draft.status === "discarded") throw new HttpError(409, "discarded", "This draft was discarded.");
  const thread = await loadThread(db, ctx.mailbox.id, draft.threadId);
  const reply = draft.replyToMessageId ? (await db.select().from(schema.messages).where(eq(schema.messages.id, draft.replyToMessageId)).limit(1))[0] : undefined;
  await getMailProvider(ctx.mailbox.mailProvider).send(ctx, {
    to: draft.to, subject: draft.subject, body: draft.body, threadId: thread.gmailId, inReplyTo: reply?.messageIdHeader ?? undefined, replyToMessageId: reply?.gmailId,
  });
  const now = new Date();
  const [row] = await db.update(schema.drafts).set({ status: "sent", updatedAt: now }).where(eq(schema.drafts.id, draft.id)).returning();
  await db.update(schema.threadState).set({ done: true, doneReason: "Sent by you", updatedAt: now }).where(eq(schema.threadState.threadId, thread.id));
  ctx.emit({ type: "judged", threadId: thread.id, lane: "reply", priority: 0 });
  return c.json(toApiDraft(row!));
});

draftRoutes.post("/mailboxes/:id/drafts/:draftId/discard", async (c) => {
  const { db, draft } = await loadDraft(c);
  await db.update(schema.drafts).set({ status: "discarded", updatedAt: new Date() }).where(eq(schema.drafts.id, draft.id));
  return c.body(null, 204);
});
