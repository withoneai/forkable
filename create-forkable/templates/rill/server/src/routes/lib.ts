import type { Context } from "hono";
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  LANES, JEV_HOLD_MS, excludedLabels, normalizeCategories, schema,
  type MailHealth,
  type ApiDraft, type ApiMailbox, type Ctx, type Db, type InboxRow, type Lane, type Mail, type MailboxRow, type SettingsRow, type ThreadRecord, type UserRow, type VipTier,
} from "@rill/core";
import { buildCtx, loadSettings } from "../ctx.js";
import type { AppEnv } from "../deps.js";
import { notFound } from "../errors.js";
import { currentUser } from "../session.js";

type MessageRow = typeof schema.messages.$inferSelect;
type ThreadRow = typeof schema.threads.$inferSelect;
type StateRow = typeof schema.threadState.$inferSelect;
type DraftRow = typeof schema.drafts.$inferSelect;

export const emptyCounts = (): Record<Lane, number> => ({ vip: 0, goals: 0, reply: 0, other: 0, screener: 0 });

/**
 * A thread shows when it has an inbound message in a tab the user reads, or
 * no inbound message at all (only your own). `off` is the labels of the tabs
 * that are off (excludedLabels); empty means every thread shows.
 */
export function inReadTabsSql(off: string[]) {
  if (off.length === 0) return undefined;
  const arr = sql`array[${sql.join(off.map((l) => sql`${l}`), sql`, `)}]::text[]`;
  return sql`(exists (select 1 from ${schema.messages} m where m.thread_id = ${schema.threadState.threadId} and m.is_from_me = false and not (m.label_ids ?| ${arr}))
    or not exists (select 1 from ${schema.messages} m where m.thread_id = ${schema.threadState.threadId} and m.is_from_me = false))`;
}

export async function laneCounts(db: Db, mailboxId: string, off: string[] = []): Promise<Record<Lane, number>> {
  const rows = await db
    .select({ lane: schema.threadState.lane, n: sql<number>`count(*)::int` })
    .from(schema.threadState)
    .where(and(
      eq(schema.threadState.mailboxId, mailboxId),
      eq(schema.threadState.done, false),
      or(isNull(schema.threadState.snoozedUntil), sql`${schema.threadState.snoozedUntil} <= now()`),
      inReadTabsSql(off),
    ))
    .groupBy(schema.threadState.lane);
  const counts = emptyCounts();
  for (const r of rows) if ((LANES as readonly string[]).includes(r.lane)) counts[r.lane] = Number(r.n);
  return counts;
}

const STALE_MS = 2 * 3600_000;

/** Sync freshness, Jev's state and the last reconcile, for the inbox banner and Settings. */
export async function mailHealth(db: Db, mailbox: MailboxRow, settings: SettingsRow, judging: number): Promise<MailHealth> {
  const categories = normalizeCategories(settings.mailCategories);
  const off = excludedLabels(categories);
  const st = mailbox.syncState ?? {};
  const since = st.jevDownSince ? new Date(st.jevDownSince) : null;
  let hiddenByTabs = 0;
  if (off.length) {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.threadState)
      .where(and(eq(schema.threadState.mailboxId, mailbox.id), eq(schema.threadState.done, false), sql`not ${inReadTabsSql(off)}`));
    hiddenByTabs = Number(r?.n ?? 0);
  }
  return {
    lastSyncAt: mailbox.lastSyncAt ? mailbox.lastSyncAt.toISOString() : null,
    stale: mailbox.source === "live" && mailbox.status === "active" && (!mailbox.lastSyncAt || Date.now() - mailbox.lastSyncAt.getTime() > STALE_MS),
    jevDownSince: since ? since.toISOString() : null,
    jevFallback: since !== null && Date.now() - since.getTime() >= JEV_HOLD_MS,
    held: since ? judging : 0,
    reconcile: st.reconcile ?? null,
    categories,
    hiddenByTabs,
  };
}

export async function toApiMailbox(db: Db, m: MailboxRow, settings?: SettingsRow): Promise<ApiMailbox> {
  const s = settings ?? (await loadSettings({ db }, m.id));
  return {
    id: m.id,
    source: m.source,
    mode: m.mode,
    label: m.label,
    address: m.address,
    status: m.status,
    lastSyncAt: m.lastSyncAt ? m.lastSyncAt.toISOString() : null,
    onboarded: s.onboarded,
    counts: await laneCounts(db, m.id, excludedLabels(normalizeCategories(s.mailCategories))),
    mailProvider: m.mailProvider,
    calendarProvider: m.calendarProvider,
  };
}

/** The mailbox in the URL, owned by the current user, with a ready Ctx. 404 otherwise. */
export async function loadMailboxCtx(c: Context<AppEnv>): Promise<{ ctx: Ctx; mailbox: MailboxRow; user: UserRow; db: Db }> {
  const deps = c.get("deps");
  const user = await currentUser(c, { create: false });
  if (!user) throw notFound("Mailbox");
  const id = c.req.param("id");
  if (!id) throw notFound("Mailbox");
  const [mailbox] = await deps.db.select().from(schema.mailboxes).where(and(eq(schema.mailboxes.id, id), eq(schema.mailboxes.userId, user.id))).limit(1);
  if (!mailbox) throw notFound("Mailbox");
  const ctx = await buildCtx(deps, mailbox, user);
  return { ctx, mailbox, user, db: deps.db };
}

export function toMail(m: MessageRow): Mail {
  return {
    id: m.gmailId,
    threadId: m.threadId,
    from: { name: m.fromName, email: m.fromEmail },
    to: m.to,
    cc: m.cc,
    date: m.date.toISOString(),
    subject: m.subject,
    body: m.body,
    rawBody: m.rawBody ?? undefined,
    hiddenText: m.hiddenText,
    snippet: m.snippet,
    labelIds: m.labelIds,
    isFromMe: m.isFromMe,
    messageIdHeader: m.messageIdHeader ?? undefined,
  };
}

export function toThreadRecord(t: ThreadRow, msgs: MessageRow[]): ThreadRecord {
  return {
    id: t.gmailId,
    subject: t.subject,
    snippet: t.snippet,
    lastMessageAt: t.lastMessageAt.toISOString(),
    messageCount: t.messageCount,
    participants: t.participants,
    messages: msgs.map(toMail),
  };
}

export function toApiDraft(d: DraftRow): ApiDraft {
  return {
    id: d.id,
    to: d.to,
    subject: d.subject,
    body: d.body,
    engine: d.engine,
    model: d.model,
    status: d.status,
    validator: d.validator ?? null,
    updatedAt: d.updatedAt.toISOString(),
  };
}

/** Messages of a thread, oldest first. */
export async function threadMessages(db: Db, threadId: string): Promise<MessageRow[]> {
  return db.select().from(schema.messages).where(eq(schema.messages.threadId, threadId)).orderBy(schema.messages.date, schema.messages.id);
}

export function latestInbound(msgs: MessageRow[]): MessageRow | null {
  for (let i = msgs.length - 1; i >= 0; i--) if (!msgs[i]!.isFromMe) return msgs[i]!;
  return msgs[msgs.length - 1] ?? null;
}

export interface InboxFilter { lane?: Lane; includeDone?: boolean; threadIds?: string[]; limit?: number; /** excludedLabels() of the tabs that are off. */ off?: string[] }

/** Rows for the inbox list: thread_state joined with its thread, latest message, goal, vip and draft flag. */
export async function inboxRows(db: Db, mailboxId: string, filter: InboxFilter = {}): Promise<InboxRow[]> {
  const conds = [eq(schema.threadState.mailboxId, mailboxId)];
  if (filter.lane) conds.push(eq(schema.threadState.lane, filter.lane));
  if (!filter.includeDone) {
    conds.push(eq(schema.threadState.done, false));
    conds.push(or(isNull(schema.threadState.snoozedUntil), sql`${schema.threadState.snoozedUntil} <= now()`)!);
  }
  if (filter.off?.length) conds.push(inReadTabsSql(filter.off)!);
  if (filter.threadIds) {
    if (filter.threadIds.length === 0) return [];
    conds.push(inArray(schema.threadState.threadId, filter.threadIds));
  }
  let q = db
    .select({ state: schema.threadState, thread: schema.threads })
    .from(schema.threadState)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.threadState.threadId))
    .where(and(...conds))
    .orderBy(desc(schema.threadState.priority), desc(schema.threads.lastMessageAt))
    .$dynamic();
  if (filter.limit) q = q.limit(filter.limit);
  const rows = await q;
  if (rows.length === 0) return [];

  const threadIds = rows.map((r) => r.thread.id);
  const [msgs, goalRows, vipRows, draftRows, inviteRows] = await Promise.all([
    db.select().from(schema.messages).where(inArray(schema.messages.threadId, threadIds)).orderBy(desc(schema.messages.date)),
    db.select().from(schema.goals).where(eq(schema.goals.mailboxId, mailboxId)),
    db.select().from(schema.vips).where(eq(schema.vips.mailboxId, mailboxId)),
    db.select({ threadId: schema.drafts.threadId }).from(schema.drafts)
      .where(and(inArray(schema.drafts.threadId, threadIds), ne(schema.drafts.status, "discarded"))),
    db.select({ threadId: schema.eventThreads.threadId, eventId: schema.eventThreads.eventId, status: schema.events.status, myResponse: schema.events.myResponse })
      .from(schema.eventThreads)
      .innerJoin(schema.events, eq(schema.events.id, schema.eventThreads.eventId))
      .where(inArray(schema.eventThreads.threadId, threadIds)),
  ]);
  // The row shows the other party: the latest inbound message, or the latest one when Dana wrote every message.
  const latest = new Map<string, MessageRow>();
  const anyLatest = new Map<string, MessageRow>();
  for (const m of msgs) {
    if (!anyLatest.has(m.threadId)) anyLatest.set(m.threadId, m);
    if (!m.isFromMe && !latest.has(m.threadId)) latest.set(m.threadId, m);
  }
  for (const [id, m] of anyLatest) if (!latest.has(id)) latest.set(id, m);
  const goals = new Map(goalRows.map((g) => [g.id, g]));
  const vips = new Map(vipRows.map((v) => [v.id, v]));
  const withDraft = new Set(draftRows.map((d) => d.threadId));
  const invites = new Map(inviteRows.map((r) => [r.threadId, { eventId: r.eventId, state: (r.status === "cancelled" ? "cancelled" : r.myResponse === "needsAction" ? "pending" : "answered") as "pending" | "answered" | "moved" | "cancelled" }]));

  return rows.map(({ state, thread }) => toInboxRow(state, thread, latest.get(thread.id) ?? null, {
    goal: state.goalId ? goals.get(state.goalId) ?? null : null,
    vip: state.vipId ? vips.get(state.vipId) ?? null : null,
    hasDraft: withDraft.has(thread.id),
    invite: invites.get(thread.id) ?? null,
  }));
}

export function toInboxRow(
  state: StateRow,
  thread: ThreadRow,
  latest: MessageRow | null,
  extra: { goal: { id: string; title: string } | null; vip: { id: string; name: string; tier: VipTier } | null; hasDraft: boolean; invite?: InboxRow["invite"] },
): InboxRow {
  const from = latest ? { name: latest.fromName, email: latest.fromEmail } : (thread.participants[0] ?? { name: "", email: "" });
  return {
    threadId: thread.id,
    lane: state.lane,
    subject: thread.subject,
    snippet: thread.snippet,
    from,
    lastMessageAt: thread.lastMessageAt.toISOString(),
    messageCount: thread.messageCount,
    priority: state.priority,
    confidence: state.confidence,
    check: state.check,
    checkReason: state.checkReason,
    goal: extra.goal ? { id: extra.goal.id, title: extra.goal.title } : null,
    vip: extra.vip ? { id: extra.vip.id, name: extra.vip.name, tier: extra.vip.tier } : null,
    kind: state.kind,
    needsReply: state.needsReply,
    urgency: state.urgency,
    summary: state.summary,
    hasDraft: extra.hasDraft,
    screen: state.screen,
    snoozedUntil: state.snoozedUntil ? state.snoozedUntil.toISOString() : null,
    replyLater: state.replyLater,
    unread: !!latest && latest.labelIds.includes("UNREAD"),
    invite: extra.invite ?? null,
    followUpDue: state.followUpAt !== null && state.followUpAt.getTime() <= Date.now(),
  };
}

/** One inbox row by thread id (done and snoozed included), or 404. */
export async function inboxRowFor(db: Db, mailboxId: string, threadId: string): Promise<InboxRow> {
  const [row] = await inboxRows(db, mailboxId, { includeDone: true, threadIds: [threadId] });
  if (!row) throw notFound("Thread");
  return row;
}

/** The thread in the URL, scoped to the mailbox. */
export async function loadThread(db: Db, mailboxId: string, threadId: string): Promise<ThreadRow> {
  // Accept the db key (`${mailboxId}:${gmailId}`) or the bare Gmail-side id.
  const [t] = await db
    .select()
    .from(schema.threads)
    .where(and(eq(schema.threads.mailboxId, mailboxId), or(eq(schema.threads.id, threadId), eq(schema.threads.id, `${mailboxId}:${threadId}`), eq(schema.threads.gmailId, threadId))))
    .limit(1);
  if (!t) throw notFound("Thread");
  return t;
}

export const sevenDaysAgo = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

/** thread_state rows per goal or vip whose thread moved in the last 7 days. */
export async function matched7d(db: Db, mailboxId: string, column: "goalId" | "vipId"): Promise<Map<string, number>> {
  const col = column === "goalId" ? schema.threadState.goalId : schema.threadState.vipId;
  const rows = await db
    .select({ id: col, n: sql<number>`count(*)::int` })
    .from(schema.threadState)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.threadState.threadId))
    .where(and(eq(schema.threadState.mailboxId, mailboxId), gt(schema.threads.lastMessageAt, sevenDaysAgo())))
    .groupBy(col);
  const m = new Map<string, number>();
  for (const r of rows) if (r.id) m.set(r.id, Number(r.n));
  return m;
}

export async function readJson<T>(c: Context<AppEnv>): Promise<T> {
  const text = await c.req.text();
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}
