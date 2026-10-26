import { and, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import type { BriefResponse } from "./api-types.js";
import type { BriefInput, Ctx, Writer } from "./contract.js";
import { briefs as briefsTable, drafts as draftsTable, events as eventsTable, goals as goalsTable, messages as messagesTable, senders as sendersTable, threadState as threadStateTable, threads as threadsTable } from "./db/schema.js";
import { newId } from "./ids.js";
import { tzOffsetMinutes } from "./tz.js";
import type { EventSummary } from "./types.js";
import { meOf, writer as writerLayer } from "./writer/index.js";

/** The [start, end) of `forDate` (YYYY-MM-DD) in `tz`, expressed as UTC instants. */
export function localDayWindowUTC(forDate: string, tz: string | null): { from: Date; to: Date } {
  const naiveUtc = new Date(`${forDate}T00:00:00Z`);
  const offset = tz ? tzOffsetMinutes(tz, naiveUtc) : 0;
  const from = new Date(naiveUtc.getTime() - offset * 60_000);
  return { from, to: new Date(from.getTime() + 864e5) };
}

// The morning brief: built from stored judgments and thread state, never by
// re-reading the inbox. Code picks what goes in and computes the numbers; the
// writer turns the data into lines. Cached per mailbox and day in `briefs`.

export function humanAge(from: Date, now = new Date()): string {
  const ms = Math.max(0, now.getTime() - from.getTime());
  const h = Math.floor(ms / 36e5);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 6e4))}m`;
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export async function buildBriefInput(ctx: Ctx, forDate: string, now = new Date()): Promise<BriefInput> {
  const db = ctx.db;
  const mailboxId = ctx.mailbox.id;
  const me = (ctx.mailbox.address ?? "").toLowerCase();
  const goals = await db.select().from(goalsTable).where(eq(goalsTable.mailboxId, mailboxId)).orderBy(goalsTable.position);
  const states = await db
    .select({ state: threadStateTable, thread: threadsTable })
    .from(threadStateTable)
    .innerJoin(threadsTable, eq(threadStateTable.threadId, threadsTable.id))
    .where(and(eq(threadStateTable.mailboxId, mailboxId), eq(threadStateTable.done, false)))
    .orderBy(desc(threadStateTable.priority), desc(threadsTable.lastMessageAt));
  const active = states.filter(({ state }) => !state.snoozedUntil || state.snoozedUntil <= now);
  const threadIds = active.map(({ thread }) => thread.id);
  const withDraft = new Set<string>();
  const lastFrom = new Map<string, string>();
  const lastTo = new Map<string, string>();
  if (threadIds.length) {
    for (let i = 0; i < threadIds.length; i += 500) {
      const chunk = threadIds.slice(i, i + 500);
      const ds = await db.select({ threadId: draftsTable.threadId }).from(draftsTable).where(and(inArray(draftsTable.threadId, chunk), sql`${draftsTable.status} <> 'discarded'`));
      for (const d of ds) withDraft.add(d.threadId);
      const ms = await db
        .select({ threadId: messagesTable.threadId, fromName: messagesTable.fromName, fromEmail: messagesTable.fromEmail, to: messagesTable.to, isFromMe: messagesTable.isFromMe })
        .from(messagesTable)
        .where(inArray(messagesTable.threadId, chunk))
        .orderBy(desc(messagesTable.date));
      for (const m of ms) {
        if (!m.isFromMe && !lastFrom.has(m.threadId)) lastFrom.set(m.threadId, m.fromName || m.fromEmail);
        if (m.isFromMe && !lastTo.has(m.threadId)) lastTo.set(m.threadId, m.to.find((t) => t !== me) ?? m.to[0] ?? "them");
      }
    }
  }
  const [screened] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sendersTable)
    .where(and(eq(sendersTable.mailboxId, mailboxId), eq(sendersTable.status, "screened_out")));

  const gid = (t: typeof threadsTable.$inferSelect) => t.gmailId;
  const from = (t: typeof threadsTable.$inferSelect) => lastFrom.get(t.id) ?? t.participants.find((p) => p.email !== me)?.name ?? "someone";
  const goalTitle = (id: string | null) => goals.find((g) => g.id === id)?.title ?? "Goal";

  const vipsWaiting = active
    .filter(({ state }) => state.lane === "vip")
    .sort((a, b) => a.thread.lastMessageAt.getTime() - b.thread.lastMessageAt.getTime())
    .map(({ state, thread }) => ({ threadId: gid(thread), subject: thread.subject, from: from(thread), age: humanAge(thread.lastMessageAt, now), hasDraft: withDraft.has(state.threadId) }));
  const goalMoves = active
    .filter(({ state }) => state.lane === "goals" || (state.goalId && state.lane !== "other"))
    .map(({ state, thread }) => ({ goalTitle: goalTitle(state.goalId), threadId: gid(thread), subject: thread.subject, from: from(thread), summary: state.summary, confidence: state.confidence }));
  const repliesOwed = active
    .filter(({ state }) => state.needsReply && state.screen !== "quarantine" && (state.lane === "vip" || state.lane === "goals" || state.lane === "reply"))
    .map(({ state, thread }) => ({ threadId: gid(thread), subject: thread.subject, from: from(thread), hasDraft: withDraft.has(state.threadId) }));
  const followUps = active
    .filter(({ state }) => state.followUpAt && state.followUpAt <= now)
    .map(({ thread }) => ({
      threadId: gid(thread),
      subject: thread.subject,
      to: lastTo.get(thread.id) ?? thread.participants.find((p) => p.email !== me)?.name ?? "them",
      daysSilent: Math.floor((now.getTime() - thread.lastMessageAt.getTime()) / 864e5),
    }));

  const today = await todaysMeetings(ctx, forDate);
  return { forDate, me: await meOf(ctx), goals, vipsWaiting, goalMoves, repliesOwed, followUps, screenedOut: Number(screened?.n ?? 0), today };
}

/** Today's meetings, in order, for the brief's Today section and `codeOnlyBrief`. */
export async function todaysMeetings(ctx: Ctx, forDate: string): Promise<EventSummary[]> {
  const { from, to } = localDayWindowUTC(forDate, ctx.settings.timezone);
  const rows = await ctx.db
    .select()
    .from(eventsTable)
    .where(and(eq(eventsTable.mailboxId, ctx.mailbox.id), ne(eventsTable.status, "cancelled"), gte(eventsTable.start, from), lt(eventsTable.start, to)))
    .orderBy(eventsTable.start);
  return rows.map((e) => ({
    eventId: e.id,
    title: e.title,
    start: e.start.toISOString(),
    end: e.end.toISOString(),
    timeZone: e.timeZone,
    joinUrl: e.joinUrl,
    attendees: e.attendees.map((a) => ({ name: a.name, email: a.email })),
    myResponse: e.myResponse,
    needsRsvp: e.myResponse === "needsAction" && e.attendees.length > 1,
  }));
}

export const brief = {
  buildInput: buildBriefInput,

  /** The brief for a day: generated on first ask, cached in `briefs`. */
  async build(ctx: Ctx, w: Writer, forDate: string, opts: { force?: boolean } = {}): Promise<BriefResponse> {
    if (!opts.force) {
      const [cached] = await ctx.db.select().from(briefsTable).where(and(eq(briefsTable.mailboxId, ctx.mailbox.id), eq(briefsTable.forDate, forDate))).limit(1);
      if (cached) {
        const today = await todaysMeetings(ctx, forDate);
        return {
          forDate: cached.forDate,
          generatedAt: cached.createdAt.toISOString(),
          kpis: cached.kpis,
          lines: cached.lines.map((l) => ({ ...l, tone: (["neutral", "positive", "warning", "negative"] as const).find((t) => t === l.tone) })),
          text: cached.text,
          engine: cached.engine,
          model: cached.model,
          today: { meetings: today, invitesWaiting: today.filter((m) => m.needsRsvp).length, conflicts: [] },
        };
      }
    }
    const input = await buildBriefInput(ctx, forDate);
    const res = await writerLayer.brief(ctx, w, input);
    await ctx.db
      .insert(briefsTable)
      .values({ id: newId("brief"), mailboxId: ctx.mailbox.id, forDate, kpis: res.kpis, lines: res.lines, text: res.text, engine: res.engine, model: res.model })
      .onConflictDoUpdate({ target: [briefsTable.mailboxId, briefsTable.forDate], set: { kpis: res.kpis, lines: res.lines, text: res.text, engine: res.engine, model: res.model, createdAt: new Date() } });
    return res;
  },
};
