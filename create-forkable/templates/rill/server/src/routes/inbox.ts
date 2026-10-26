import { Hono } from "hono";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import {
  LANES, calendar, getMailProvider, schema, sync,
  type ApiMessage, type InboxResponse, type Judgment, type Lane, type ThreadAction, type ThreadHtmlResponse, type ThreadResponse, type VipTier,
} from "@rill/core";
import type { AppEnv } from "../deps.js";
import { badRequest, notFound } from "../errors.js";
import { inboxRowFor, inboxRows, laneCounts, latestInbound, loadMailboxCtx, loadThread, readJson, threadMessages, toApiDraft } from "./lib.js";

export const inboxRoutes = new Hono<AppEnv>();

inboxRoutes.get("/mailboxes/:id/inbox", async (c) => {
  const { ctx, mailbox, db } = await loadMailboxCtx(c);
  const deps = c.get("deps");
  const laneParam = c.req.query("lane");
  const lane = laneParam && (LANES as readonly string[]).includes(laneParam) ? (laneParam as Lane) : undefined;
  if (laneParam && !lane) throw badRequest(`Unknown lane "${laneParam}"`);
  const includeDone = c.req.query("includeDone") === "1";
  const [rows, counts, judging] = await Promise.all([
    inboxRows(db, mailbox.id, { lane, includeDone }),
    laneCounts(db, mailbox.id),
    deps.scheduler.judgingCount(mailbox.id),
  ]);
  void ctx;
  const body: InboxResponse = { rows, counts, syncing: deps.scheduler.isSyncing(mailbox.id), judging };
  return c.json(body);
});

inboxRoutes.get("/mailboxes/:id/threads/:threadId", async (c) => {
  const { ctx, mailbox, db } = await loadMailboxCtx(c);
  const thread = await loadThread(db, mailbox.id, c.req.param("threadId"));
  const [state] = await db.select().from(schema.threadState).where(eq(schema.threadState.threadId, thread.id)).limit(1);
  if (!state) throw notFound("Thread");
  const msgs = await threadMessages(db, thread.id);
  const latest = latestInbound(msgs);
  const row = await inboxRowFor(db, mailbox.id, thread.id);

  const [why, draftRow, vipRow, senderRow] = await Promise.all([
    latest
      ? db.select().from(schema.judgments).where(eq(schema.judgments.messageId, latest.id)).orderBy(schema.judgments.id)
      : Promise.resolve([]),
    db.select().from(schema.drafts).where(and(eq(schema.drafts.threadId, thread.id), ne(schema.drafts.status, "discarded"))).orderBy(desc(schema.drafts.updatedAt)).limit(1).then((r) => r[0] ?? null),
    state.vipId ? db.select().from(schema.vips).where(eq(schema.vips.id, state.vipId)).limit(1).then((r) => r[0] ?? null) : Promise.resolve(null),
    latest ? db.select().from(schema.senders).where(and(eq(schema.senders.mailboxId, mailbox.id), eq(schema.senders.email, latest.fromEmail))).limit(1).then((r) => r[0] ?? null) : Promise.resolve(null),
  ]);

  let vip = vipRow;
  if (!vip && latest) {
    const email = latest.fromEmail.toLowerCase();
    const domain = email.split("@")[1] ?? "";
    const candidates = await db.select().from(schema.vips).where(eq(schema.vips.mailboxId, mailbox.id));
    vip = candidates.find((v) => (v.matchKind === "address" && v.match.toLowerCase() === email) || (v.matchKind === "domain" && v.match.toLowerCase() === domain)) ?? null;
  }

  let threadsWithThem: ThreadResponse["person"]["threadsWithThem"] = [];
  if (latest) {
    const others = await db
      .select({ id: schema.threads.id, subject: schema.threads.subject, lastMessageAt: schema.threads.lastMessageAt })
      .from(schema.threads)
      .where(and(
        eq(schema.threads.mailboxId, mailbox.id),
        ne(schema.threads.id, thread.id),
        sql`exists (select 1 from ${schema.messages} m where m.thread_id = ${schema.threads.id} and lower(m.from_email) = ${latest.fromEmail.toLowerCase()})`,
      ))
      .orderBy(desc(schema.threads.lastMessageAt))
      .limit(5);
    threadsWithThem = others.map((t) => ({ threadId: t.id, subject: t.subject, lastMessageAt: t.lastMessageAt.toISOString() }));
  }

  const invite = await calendar.inviteFor(ctx, thread.gmailId).catch(() => null);

  const messages: ApiMessage[] = msgs.map((m) => ({
    id: m.id,
    from: { name: m.fromName, email: m.fromEmail },
    to: m.to,
    cc: m.cc,
    date: m.date.toISOString(),
    subject: m.subject,
    body: m.body,
    isFromMe: m.isFromMe,
    screen: latest && m.id === latest.id ? state.screen : "pass",
  }));

  const body: ThreadResponse = {
    thread: { id: thread.id, subject: thread.subject, lastMessageAt: thread.lastMessageAt.toISOString(), participants: thread.participants },
    state: row,
    messages,
    why: why.map((j): Judgment => ({
      question: j.question, label: j.label, kind: j.kind, answer: j.answer, probability: j.probability, confidence: j.confidence,
      probabilities: j.probabilities ?? undefined, model: j.model,
    })),
    rule: state.rule,
    judgedBy: state.judgedBy,
    ask: state.ask,
    draft: draftRow ? toApiDraft(draftRow) : null,
    person: {
      name: latest?.fromName ?? row.from.name,
      email: latest?.fromEmail ?? row.from.email,
      vip: vip ? { id: vip.id, name: vip.name, tier: vip.tier, rules: vip.rules } : null,
      senderStatus: senderRow?.status ?? "unknown",
      threadsWithThem,
    },
    invite,
  };
  return c.json(body);
});

// The reader asks for HTML lazily. Messages that already carry HTML (fixtures, an
// earlier open) answer from the database; the rest come from Gmail once and are kept.
inboxRoutes.get("/mailboxes/:id/threads/:threadId/html", async (c) => {
  const { ctx, mailbox, db } = await loadMailboxCtx(c);
  const thread = await loadThread(db, mailbox.id, c.req.param("threadId"));
  const msgs = await threadMessages(db, thread.id);
  const html: Record<string, string> = {};
  const missing: typeof msgs = [];
  for (const m of msgs) {
    if (m.html) html[m.id] = m.html;
    else if (mailbox.source === "sample" && m.rawBody && /^\s*<(html|!doctype|body|div|p)/i.test(m.rawBody)) html[m.id] = m.rawBody;
    else missing.push(m);
  }
  // Only Gmail's own text/html part counts. Fetched once per thread, kept in messages.html.
  if (missing.length > 0 && mailbox.source === "live") {
    const fetched = await getMailProvider(ctx.mailbox.mailProvider).threadHtml(ctx, thread.gmailId).catch(() => ({}) as Record<string, string>);
    for (const m of missing) {
      const h = fetched[m.gmailId];
      if (!h) continue;
      html[m.id] = h;
      await db.update(schema.messages).set({ html: h.length > 400_000 ? h.slice(0, 400_000) : h }).where(eq(schema.messages.id, m.id));
    }
  }
  const body: ThreadHtmlResponse = { html };
  return c.json(body);
});

inboxRoutes.post("/mailboxes/:id/threads/:threadId/actions", async (c) => {
  const { ctx, mailbox, db } = await loadMailboxCtx(c);
  const thread = await loadThread(db, mailbox.id, c.req.param("threadId"));
  const action = await readJson<ThreadAction>(c);
  if (!action || typeof action.action !== "string") throw badRequest("Missing action");
  const where = eq(schema.threadState.threadId, thread.id);
  const msgs = await threadMessages(db, thread.id);
  const latest = latestInbound(msgs);
  const now = new Date();

  switch (action.action) {
    case "done": {
      await db.update(schema.threadState).set({ done: true, doneReason: "Marked done", updatedAt: now }).where(where);
      if (mailbox.source === "live" && ctx.settings.applyLabels) {
        try {
          const mail = getMailProvider(ctx.mailbox.mailProvider);
          const labelId = await mail.ensureLabel(ctx, "Rill/Done");
          await mail.modifyThreadLabels(ctx, thread.gmailId, [labelId], []);
        } catch (err) {
          // The ledger has the row; the user's action still stands.
          console.log(`[rill] label skipped: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      break;
    }
    case "undo":
      await db.update(schema.threadState).set({ done: false, doneReason: null, snoozedUntil: null, updatedAt: now }).where(where);
      break;
    case "snooze": {
      const until = new Date(action.until);
      if (Number.isNaN(until.getTime())) throw badRequest("snooze needs an ISO date in `until`");
      await db.update(schema.threadState).set({ snoozedUntil: until, updatedAt: now }).where(where);
      break;
    }
    case "reply_later":
      await db.update(schema.threadState).set({ replyLater: sql`not ${schema.threadState.replyLater}`, updatedAt: now }).where(where);
      break;
    case "let_in":
    case "screen_out": {
      if (!latest) throw badRequest("This thread has no sender to screen");
      const status = action.action === "let_in" ? "let_in" : "screened_out";
      await db.insert(schema.senders)
        .values({ mailboxId: mailbox.id, email: latest.fromEmail, name: latest.fromName, status })
        .onConflictDoUpdate({ target: [schema.senders.mailboxId, schema.senders.email], set: { status, name: latest.fromName } });
      await sync.redecide(ctx);
      break;
    }
    case "add_vip": {
      if (!latest) throw badRequest("This thread has no sender to add");
      const tier: VipTier = action.tier ?? "key";
      const existing = await db.select({ id: schema.vips.id }).from(schema.vips)
        .where(and(eq(schema.vips.mailboxId, mailbox.id), eq(schema.vips.matchKind, "address"), eq(schema.vips.match, latest.fromEmail)));
      if (existing.length === 0) {
        const { newId } = await import("@rill/core");
        await db.insert(schema.vips).values({ id: newId("vip"), mailboxId: mailbox.id, name: latest.fromName || latest.fromEmail, matchKind: "address", match: latest.fromEmail, tier });
      }
      await sync.redecide(ctx);
      break;
    }
    case "move": {
      if (!(LANES as readonly string[]).includes(action.lane)) throw badRequest(`Unknown lane "${String(action.lane)}"`);
      await db.update(schema.threadState).set({ lane: action.lane, rule: "manual", updatedAt: now }).where(where);
      break;
    }
    default:
      throw badRequest(`Unknown action "${String((action as { action: string }).action)}"`);
  }
  const row = await inboxRowFor(db, mailbox.id, thread.id);
  ctx.emit({ type: "judged", threadId: thread.id, lane: row.lane, priority: row.priority });
  return c.json(row);
});

