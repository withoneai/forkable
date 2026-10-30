import { and, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { categoryQuery, excludedLabels, normalizeCategories } from "./categories.js";
import { BlockedByGrant, type Ctx, type GoalRow, type JevInput, type SyncLayer, type VipRow, type Writer } from "./contract.js";
import { computeFacts, type SenderRow } from "./facts.js";
import { fixtures } from "./fixtures.js";
import { LANE_LABEL_PREFIX } from "./providers/gmail/mail.js";
import { getMailProvider } from "./providers/registry.js";
import { newId } from "./ids.js";
import { jev } from "./jev.js";
import { loadPolicy, decide, type CompiledPolicy } from "./policy.js";
import { domainOf } from "./sanitize.js";
import {
  drafts as draftsTable, goals as goalsTable, judgments as judgmentsTable, mailboxes as mailboxesTable, messages as messagesTable,
  senders as sendersTable, threadState as threadStateTable, threads as threadsTable, vips as vipsTable,
} from "./db/schema.js";
import { DEFAULT_THRESHOLDS, type Decision, type Judgment, type JevAnswers, type Lane, type Mail, type ThreadRecord, type Thresholds } from "./types.js";
import { writer as writerLayer } from "./writer/index.js";

// The glue: import a mailbox, judge what is new, re-decide when the rules
// move. Thread and message ids in the database are `${mailboxId}:${gmailId}`;
// everything the UI sees (events, brief, ask) uses the Gmail-side id, which is
// unique within a mailbox and is what fixtures and recordings are keyed by.

type ThreadRow = typeof threadsTable.$inferSelect;
type MessageRow = typeof messagesTable.$inferSelect;

export const dbId = (mailboxId: string, gmailId: string) => `${mailboxId}:${gmailId}`;
export const laneLabel = (lane: Lane) => `${LANE_LABEL_PREFIX}${lane === "vip" ? "VIP" : lane[0]!.toUpperCase() + lane.slice(1)}`;

const PUBLIC_DOMAINS = new Set(["gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "me.com", "live.com", "protonmail.com", "proton.me", "hey.com", "aol.com"]);

/** Runs fn over items with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/** The inbox tabs this mailbox reads, from settings. */
export const categoriesOf = (ctx: Ctx) => normalizeCategories(ctx.settings.mailCategories);

/** True for a message in a tab the user reads; a SQL condition on a labelIds column. */
export function inReadTabs(col: AnyPgColumn, ctx: Ctx): SQL | undefined {
  const off = excludedLabels(categoriesOf(ctx));
  if (off.length === 0) return undefined;
  return sql`not (${col} ?| array[${sql.join(off.map((l) => sql`${l}`), sql`, `)}]::text[])`;
}

const emit = (ctx: Ctx, ev: Parameters<Ctx["emit"]>[0]) => {
  try {
    ctx.emit(ev);
  } catch {
    // a closed stream never fails the work
  }
};

// ---- rows <-> records ---------------------------------------------------------

export function toMail(m: MessageRow): Mail {
  return {
    id: m.gmailId,
    threadId: m.threadId.slice(m.mailboxId.length + 1),
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
  const messages = msgs.map(toMail).sort((a, b) => a.date.localeCompare(b.date));
  return {
    id: t.gmailId,
    subject: t.subject,
    snippet: t.snippet,
    lastMessageAt: t.lastMessageAt.toISOString(),
    messageCount: messages.length || t.messageCount,
    participants: t.participants,
    messages,
  };
}

export async function loadThread(ctx: Ctx, gmailThreadId: string): Promise<{ row: ThreadRow; messages: MessageRow[]; record: ThreadRecord } | null> {
  const id = dbId(ctx.mailbox.id, gmailThreadId);
  const [row] = await ctx.db.select().from(threadsTable).where(eq(threadsTable.id, id)).limit(1);
  if (!row) return null;
  const messages = await ctx.db.select().from(messagesTable).where(eq(messagesTable.threadId, id)).orderBy(messagesTable.date);
  return { row, messages, record: toThreadRecord(row, messages) };
}

// ---- upserts -----------------------------------------------------------------------

async function upsertThread(ctx: Ctx, t: ThreadRecord): Promise<{ inserted: boolean; newMessages: number }> {
  const db = ctx.db;
  const mailboxId = ctx.mailbox.id;
  const id = dbId(mailboxId, t.id);
  const me = (ctx.mailbox.address ?? "").toLowerCase();
  const existing = await db.select({ id: threadsTable.id }).from(threadsTable).where(eq(threadsTable.id, id)).limit(1);
  await db
    .insert(threadsTable)
    .values({
      id,
      gmailId: t.id,
      mailboxId,
      subject: t.subject || "(no subject)",
      snippet: t.snippet,
      lastMessageAt: new Date(t.lastMessageAt),
      messageCount: t.messageCount,
      participants: t.participants,
    })
    .onConflictDoUpdate({
      target: threadsTable.id,
      set: { subject: t.subject || "(no subject)", snippet: t.snippet, lastMessageAt: new Date(t.lastMessageAt), messageCount: t.messageCount, participants: t.participants, updatedAt: new Date() },
    });

  let newMessages = 0;
  for (const m of t.messages) {
    if (!m.id) continue;
    const inserted = await db
      .insert(messagesTable)
      .values({
        id: dbId(mailboxId, m.id),
        gmailId: m.id,
        threadId: id,
        mailboxId,
        fromName: m.from.name,
        fromEmail: m.from.email,
        to: m.to,
        cc: m.cc,
        date: new Date(m.date),
        subject: m.subject,
        body: m.body,
        rawBody: m.rawBody ?? null,
        hiddenText: m.hiddenText,
        snippet: m.snippet,
        labelIds: m.labelIds,
        isFromMe: m.isFromMe,
        messageIdHeader: m.messageIdHeader ?? null,
        judgedAt: m.isFromMe ? new Date() : null, // the user's own messages are never judged
      })
      .onConflictDoNothing()
      .returning({ id: messagesTable.id });
    if (inserted.length === 0) {
      await db.update(messagesTable).set({ labelIds: m.labelIds }).where(eq(messagesTable.id, dbId(mailboxId, m.id)));
      continue;
    }
    newMessages++;
    if (m.isFromMe) {
      for (const e of [...m.to, ...m.cc]) if (e && e !== me) await touchSender(ctx, e, null, 0, true);
    } else if (m.from.email && m.from.email !== me) {
      await touchSender(ctx, m.from.email, m.from.name, 1, false);
    }
  }
  return { inserted: existing.length === 0, newMessages };
}

async function touchSender(ctx: Ctx, email: string, name: string | null, countDelta: number, wroteToThem: boolean): Promise<void> {
  await ctx.db
    .insert(sendersTable)
    .values({ mailboxId: ctx.mailbox.id, email, name, messageCount: countDelta, iWroteToThem: wroteToThem })
    .onConflictDoUpdate({
      target: [sendersTable.mailboxId, sendersTable.email],
      set: {
        messageCount: sql`${sendersTable.messageCount} + ${countDelta}`,
        iWroteToThem: wroteToThem ? sql`true` : sendersTable.iWroteToThem,
        name: name ? sql`coalesce(${sendersTable.name}, ${name})` : sendersTable.name,
      },
    });
}

async function markLetIn(ctx: Ctx, email: string, name: string | null): Promise<void> {
  await ctx.db
    .insert(sendersTable)
    .values({ mailboxId: ctx.mailbox.id, email, name, status: "let_in" })
    .onConflictDoUpdate({
      target: [sendersTable.mailboxId, sendersTable.email],
      set: { status: sql`case when ${sendersTable.status} = 'unknown' then 'let_in' else ${sendersTable.status} end` },
    });
}

async function countPending(ctx: Ctx): Promise<number> {
  const [r] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(messagesTable)
    .where(and(eq(messagesTable.mailboxId, ctx.mailbox.id), isNull(messagesTable.judgedAt), eq(messagesTable.isFromMe, false), inReadTabs(messagesTable.labelIds, ctx)));
  return Number(r?.n ?? 0);
}

// ---- the layer ---------------------------------------------------------------------

export const sync: SyncLayer = {
  async syncMailbox(ctx, opts = {}) {
    emit(ctx, { type: "sync", phase: "start" });
    let imported = 0;
    let updated = 0;
    const listed: string[] = [];
    try {
      if (ctx.mailbox.source === "sample") {
        const inbox = fixtures.loadInbox(ctx.env.ROOT);
        const records = fixtures.threadRecords(inbox);
        for (const t of records) {
          const r = await upsertThread(ctx, t);
          if (r.inserted) imported++;
          else if (r.newMessages) updated++;
          listed.push(t.id);
        }
        // Screener memory for the sample: everyone except the screener threads and the
        // quarantined one has written to Dana before, so they are let in from the start.
        const me = inbox.address.toLowerCase();
        for (const t of inbox.threads) {
          const e = t.expect;
          if (!e || e.lane === "screener" || /quarantine/i.test(e.note ?? "")) continue;
          for (const m of t.messages) {
            const email = m.from.email.toLowerCase();
            if (m.isFromMe || email === me) continue;
            await markLetIn(ctx, email, m.from.name);
          }
        }
      } else {
        const mail = getMailProvider(ctx.mailbox.mailProvider);
        const state = ctx.mailbox.syncState ?? {};
        const full = Boolean(opts.full) || !state.initialImportDone;
        // Only the tabs the user reads (Primary by default), so Promotions never costs a fetch or a Jev call.
        const query = `${categoryQuery(ctx.mailbox.mailProvider, categoriesOf(ctx))} ${full ? "newer_than:7d" : "newer_than:2d"}`;
        const want = full ? (opts.max ?? 100) : 50;
        let pageToken: string | undefined;
        let got = 0;
        for (let page = 0; page < 10 && got < want; page++) {
          const res = await mail.listThreads(ctx, { query, max: Math.min(100, want - got), pageToken });
          for (const t of res.threads) {
            listed.push(t.id);
            const r = await upsertThread(ctx, t);
            if (r.inserted) imported++;
            else if (r.newMessages) updated++;
          }
          got += res.threads.length;
          pageToken = res.nextPageToken;
          if (!pageToken || res.threads.length === 0) break;
        }
        if (full) {
          // People the user has written to skip the screener.
          try {
            for (const s of await mail.sentTo(ctx, 100)) await touchSender(ctx, s.email, s.name, 0, true);
          } catch (e) {
            if (e instanceof BlockedByGrant) throw e;
            // sent mail is a nicety; a failure here does not stop the import
          }
        }
        await ctx.db
          .update(mailboxesTable)
          .set({ lastSyncAt: new Date(), syncState: { ...state, initialImportDone: true, lastError: null } })
          .where(eq(mailboxesTable.id, ctx.mailbox.id));
      }
      if (ctx.mailbox.source === "sample") await ctx.db.update(mailboxesTable).set({ lastSyncAt: new Date() }).where(eq(mailboxesTable.id, ctx.mailbox.id));
      await reconcile(ctx, listed).catch((e) => {
        if (process.env.RILL_DEBUG) console.error(`reconcile: ${String((e as Error).message ?? e)}`);
      });
      const toJudge = await countPending(ctx);
      emit(ctx, { type: "sync", phase: "done", imported });
      return { imported, updated, toJudge };
    } catch (e) {
      const msg = String((e as Error).message ?? e).slice(0, 300);
      emit(ctx, { type: "sync", phase: "error", error: msg });
      try {
        await ctx.db.update(mailboxesTable).set({ syncState: { ...(ctx.mailbox.syncState ?? {}), lastError: msg } }).where(eq(mailboxesTable.id, ctx.mailbox.id));
      } catch {
        // the original error matters more
      }
      throw e;
    }
  },

  async judgePending(ctx, opts = {}) {
    const pending = await ctx.db
      .select()
      .from(messagesTable)
      .where(and(eq(messagesTable.mailboxId, ctx.mailbox.id), isNull(messagesTable.judgedAt), eq(messagesTable.isFromMe, false), inReadTabs(messagesTable.labelIds, ctx)))
      .orderBy(desc(messagesTable.date))
      .limit(opts.limit ?? 500);
    const total = pending.length;
    if (total === 0) return { judged: 0, failed: 0, held: 0 };
    const deps = await loadDeps(ctx);
    let judged = 0;
    let failed = 0;
    let held = 0;
    await mapLimit(pending, opts.concurrency ?? 3, async (msg) => {
      try {
        await judgeOne(ctx, msg, deps);
        judged++;
      } catch (e) {
        if ((e as { code?: string }).code === "jev_held") {
          held++;
          return;
        }
        failed++;
        if (process.env.RILL_DEBUG) console.error(`judge ${msg.id} failed: ${String((e as Error).message ?? e)}`);
        if (e instanceof BlockedByGrant) throw e;
        if ((e as { code?: string }).code === "reconnect_required") throw e;
      } finally {
        emit(ctx, { type: "progress", judged: judged + failed + held, total });
      }
    });
    return { judged, failed, held };
  },

  async redecide(ctx) {
    const deps = await loadDeps(ctx, { writer: false });
    const states = await ctx.db.select().from(threadStateTable).where(eq(threadStateTable.mailboxId, ctx.mailbox.id));
    let updated = 0;
    for (const st of states) {
      const gmailThreadId = st.threadId.slice(ctx.mailbox.id.length + 1);
      const loaded = await loadThread(ctx, gmailThreadId);
      if (!loaded) continue;
      const latest = [...loaded.messages].reverse().find((m) => !m.isFromMe) ?? loaded.messages[loaded.messages.length - 1];
      if (!latest) continue;
      const rows = await ctx.db.select().from(judgmentsTable).where(eq(judgmentsTable.messageId, latest.id));
      const judgmentRows: Judgment[] = rows.map(rowToJudgment);
      const answers = jev.fromJudgments(judgmentRows, { goals: deps.goals, vips: deps.vips });
      const mail = toMail(latest);
      const [senderRow] = await ctx.db.select().from(sendersTable).where(and(eq(sendersTable.mailboxId, ctx.mailbox.id), eq(sendersTable.email, mail.from.email))).limit(1);
      const facts = await computeFacts(ctx.db, ctx.mailbox, mail, loaded.record, deps.vips, deps.teamDomain, senderRow ? [senderRow] : []);
      const decision = decide(deps.policy, {
        facts,
        answers,
        goals: deps.goals,
        vips: deps.vips,
        senderStatus: senderRow?.status ?? "unknown",
        thresholds: deps.thresholds,
        judgedBy: (st.judgedBy as "jev" | "writer-fallback" | null) ?? null,
      });
      await ctx.db
        .update(threadStateTable)
        .set({
          lane: decision.lane,
          rule: decision.rule,
          priority: decision.priority,
          confidence: decision.confidence,
          check: decision.check,
          checkReason: decision.checkReason,
          goalId: decision.goalId,
          vipId: decision.vipId,
          needsReply: decision.needsReply,
          followUpAt: followUpAt(loaded.record, decision),
          updatedAt: new Date(),
        })
        .where(eq(threadStateTable.threadId, st.threadId));
      updated++;
      if (st.lane !== decision.lane || st.priority !== decision.priority) emit(ctx, { type: "judged", threadId: gmailThreadId, lane: decision.lane, priority: decision.priority });
    }
    return { updated };
  },

  async invalidateJudgments(ctx, reason) {
    const goals = await ctx.db.select().from(goalsTable).where(eq(goalsTable.mailboxId, ctx.mailbox.id));
    const goalIds = new Set(goals.map((g) => g.id));
    const sample = ctx.mailbox.source === "sample";
    const judgedMessages = await ctx.db
      .select({ id: messagesTable.id, threadId: messagesTable.threadId })
      .from(messagesTable)
      .where(and(eq(messagesTable.mailboxId, ctx.mailbox.id), isNotNull(messagesTable.judgedAt), eq(messagesTable.isFromMe, false)));
    const goalRows = await ctx.db
      .select({ messageId: judgmentsTable.messageId, probabilities: judgmentsTable.probabilities })
      .from(judgmentsTable)
      .where(and(eq(judgmentsTable.mailboxId, ctx.mailbox.id), eq(judgmentsTable.question, "goal")));
    const withGoalRow = new Set(goalRows.map((r) => r.messageId));
    const stale = new Set<string>();
    if (reason === "goals-changed" && !sample) {
      for (const m of judgedMessages) stale.add(m.id);
    } else {
      for (const r of goalRows) {
        const keys = Object.keys(r.probabilities ?? {}).filter((k) => k !== "none");
        if (keys.some((k) => !goalIds.has(k)) || (goalIds.size > 0 && keys.length === 0)) stale.add(r.messageId);
      }
      if (goalIds.size > 0 || reason === "goals-changed") {
        for (const m of judgedMessages) if (!withGoalRow.has(m.id) && goalIds.size > 0) stale.add(m.id);
      }
    }
    let ids = [...stale];
    if (sample) {
      const byId = new Map(judgedMessages.map((m) => [m.id, m.threadId]));
      ids = ids.filter((id) => {
        const t = byId.get(id);
        if (!t) return false;
        return fixtures.readRecording(ctx.env.ROOT, t.slice(ctx.mailbox.id.length + 1)) !== null;
      });
    }
    if (ids.length === 0) return { count: 0 };
    for (let i = 0; i < ids.length; i += 500) {
      await ctx.db.update(messagesTable).set({ judgedAt: null }).where(inArray(messagesTable.id, ids.slice(i, i + 500)));
    }
    return { count: ids.length };
  },
};

// ---- reconcile -------------------------------------------------------------------------

/** A message imported this long ago and still unjudged counts as stuck. */
const STUCK_MS = 30 * 60_000;

/**
 * Proof that nothing slipped through. Every thread the provider listed this
 * run must be in the database with a lane; every inbound message in a tab the
 * user reads must be judged within half an hour. A listed thread whose
 * messages are all marked judged but which has no lane is put back in the
 * queue (that is the silent miss). The counts land on the mailbox, and the
 * inbox shows a line when anything is missing or stuck.
 */
export async function reconcile(ctx: Ctx, listedGmailIds: string[]): Promise<NonNullable<typeof mailboxesTable.$inferSelect["syncState"]["reconcile"]>> {
  const mailboxId = ctx.mailbox.id;
  const ids = [...new Set(listedGmailIds)].map((g) => dbId(mailboxId, g));
  let missing = 0;
  let requeued = 0;
  if (ids.length) {
    const have = await ctx.db.select({ id: threadsTable.id }).from(threadsTable).where(inArray(threadsTable.id, ids));
    missing = ids.length - have.length;
    const laned = new Set(
      (await ctx.db.select({ id: threadStateTable.threadId }).from(threadStateTable).where(inArray(threadStateTable.threadId, ids))).map((r) => r.id),
    );
    const noLane = have.map((h) => h.id).filter((id) => !laned.has(id));
    if (noLane.length) {
      const reset = await ctx.db
        .update(messagesTable)
        .set({ judgedAt: null })
        .where(and(inArray(messagesTable.threadId, noLane), eq(messagesTable.isFromMe, false), isNotNull(messagesTable.judgedAt), inReadTabs(messagesTable.labelIds, ctx)))
        .returning({ id: messagesTable.id });
      requeued = reset.length;
    }
  }
  const [stuckRow] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(messagesTable)
    .where(and(
      eq(messagesTable.mailboxId, mailboxId),
      isNull(messagesTable.judgedAt),
      eq(messagesTable.isFromMe, false),
      sql`${messagesTable.createdAt} < ${new Date(Date.now() - STUCK_MS)}`,
      inReadTabs(messagesTable.labelIds, ctx),
    ));
  const out = { at: new Date().toISOString(), listed: ids.length, missing, requeued, stuck: Number(stuckRow?.n ?? 0) };
  await ctx.db
    .update(mailboxesTable)
    .set({ syncState: sql`${mailboxesTable.syncState} || jsonb_build_object('reconcile', ${JSON.stringify(out)}::jsonb)` })
    .where(eq(mailboxesTable.id, mailboxId));
  if (missing || requeued || out.stuck) emit(ctx, { type: "health" });
  return out;
}

// ---- follow-ups -------------------------------------------------------------------------

/** Adds days to a date, skipping Saturdays and Sundays when `business` is set. */
export function addDays(from: Date, days: number, business: boolean): Date {
  if (!business) return new Date(from.getTime() + days * 864e5);
  const d = new Date(from.getTime());
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

/**
 * Ball-in-their-court timers, recomputed from the messages themselves (a reply
 * you send from Gmail never passes through the judge). When you wrote last
 * and the timer runs out, the thread comes back once: undone, unsnoozed, with
 * a Follow up chip. Anyone writing again moves the timer.
 */
export async function followUps(ctx: Ctx): Promise<{ due: number; resurfaced: number }> {
  const policy = loadPolicy(ctx.env.ROOT);
  const vips = await ctx.db.select().from(vipsTable).where(eq(vipsTable.mailboxId, ctx.mailbox.id));
  const me = (ctx.mailbox.address ?? "").toLowerCase();
  const rows = await ctx.db.execute<{ thread_id: string; vip_id: string | null; follow_up_at: Date | null; follow_up_shown_at: Date | null; done: boolean; snoozed_until: Date | null; last_at: Date; last_from_me: boolean }>(sql`
    select ts.thread_id, ts.vip_id, ts.follow_up_at, ts.follow_up_shown_at, ts.done, ts.snoozed_until, m.date as last_at,
           (m.is_from_me or (${me} <> '' and lower(m.from_email) = ${me})) as last_from_me
    from ${threadStateTable} ts
    join lateral (select date, is_from_me, from_email from ${messagesTable} where thread_id = ts.thread_id order by date desc limit 1) m on true
    where ts.mailbox_id = ${ctx.mailbox.id} and ts.screen <> 'quarantine'`).then((r) => r.rows);
  const now = Date.now();
  let due = 0;
  let resurfaced = 0;
  for (const r of rows) {
    const lastAt = new Date(r.last_at);
    let at: Date | null = null;
    if (r.last_from_me) {
      const vip = r.vip_id ? vips.find((v) => v.id === r.vip_id) : undefined;
      const days = policy.followUp.vipCanOverride && typeof vip?.rules.followUpDays === "number" ? vip.rules.followUpDays : policy.followUp.days;
      at = addDays(lastAt, days, policy.followUp.businessDays);
    }
    const prevAt = r.follow_up_at ? new Date(r.follow_up_at).getTime() : null;
    const shownAt = r.follow_up_shown_at ? new Date(r.follow_up_shown_at) : null;
    // A follow-up shown before the latest message belongs to an older round.
    const shownThisRound = shownAt !== null && shownAt >= lastAt;
    const isDue = at !== null && at.getTime() <= now;
    if (isDue) due++;
    const resurface = isDue && !shownThisRound;
    const hidden = r.done || (r.snoozed_until !== null && new Date(r.snoozed_until).getTime() > now);
    const nextShown = resurface ? new Date() : shownThisRound ? shownAt : null;
    if ((at?.getTime() ?? null) === prevAt && nextShown?.getTime() === shownAt?.getTime()) continue;
    await ctx.db
      .update(threadStateTable)
      .set({
        followUpAt: at,
        followUpShownAt: nextShown,
        ...(resurface && hidden ? { done: false, doneReason: null, snoozedUntil: null } : {}),
      })
      .where(eq(threadStateTable.threadId, r.thread_id));
    if (resurface) {
      resurfaced++;
      if (hidden) emit(ctx, { type: "health" });
    }
  }
  return { due, resurfaced };
}

// ---- judging one message --------------------------------------------------------

interface Deps {
  goals: GoalRow[];
  vips: VipRow[];
  policy: CompiledPolicy;
  thresholds: Thresholds;
  me: string;
  teamDomain: string | null;
  writer: Writer | null;
  labelIds: Map<Lane, string>;
  /** When Jev started failing on this mailbox, or null while it answers. */
  jevDownSince: Date | null;
  /** Jev already failed once in this run; the rest of the queue waits without calling it again. */
  jevFailedThisRun: boolean;
}

async function loadDeps(ctx: Ctx, o: { writer?: boolean } = {}): Promise<Deps> {
  const goals = await ctx.db.select().from(goalsTable).where(eq(goalsTable.mailboxId, ctx.mailbox.id)).orderBy(goalsTable.position);
  const vips = await ctx.db.select().from(vipsTable).where(eq(vipsTable.mailboxId, ctx.mailbox.id));
  const policy = loadPolicy(ctx.env.ROOT);
  const thresholds: Thresholds = { ...DEFAULT_THRESHOLDS, ...(ctx.settings.thresholds ?? {}) };
  let me = ctx.settings.me ?? "";
  let teamDomain: string | null = null;
  if (ctx.mailbox.source === "sample") {
    const inbox = fixtures.loadInbox(ctx.env.ROOT);
    me ||= inbox.me;
    teamDomain = inbox.team_domain;
  } else {
    me ||= ctx.user.name ?? ctx.user.email ?? ctx.mailbox.address ?? "me";
    const d = domainOf(ctx.mailbox.address ?? "");
    teamDomain = d && !PUBLIC_DOMAINS.has(d) ? d : null;
  }
  let w: Writer | null = null;
  if (o.writer !== false) {
    try {
      const detected = await writerLayer.detectEngines(ctx.env);
      w = await writerLayer.pickWriter(ctx, detected);
    } catch {
      w = null;
    }
  }
  const [fresh] = await ctx.db.select({ syncState: mailboxesTable.syncState }).from(mailboxesTable).where(eq(mailboxesTable.id, ctx.mailbox.id)).limit(1);
  const since = fresh?.syncState?.jevDownSince;
  return { goals, vips, policy, thresholds, me, teamDomain, writer: w, labelIds: new Map(), jevDownSince: since ? new Date(since) : null, jevFailedThisRun: false };
}

function rowToJudgment(r: typeof judgmentsTable.$inferSelect): Judgment {
  return { question: r.question, label: r.label, kind: r.kind, answer: r.answer, probability: r.probability, confidence: r.confidence, probabilities: r.probabilities ?? undefined, model: r.model };
}

function followUpAt(thread: ThreadRecord, decision: Decision): Date | null {
  if (decision.followUpDays === null) return null;
  return new Date(new Date(thread.lastMessageAt).getTime() + decision.followUpDays * 864e5);
}

// ---- Jev down: hold, then judge without drafts -------------------------------------

/** How long Rill holds mail unjudged while Jev fails before the writer may judge it. */
export const JEV_HOLD_MS = 60 * 60_000;

/** Records the first failure (once, across concurrent judges) and returns when Jev went down. */
async function markJevDown(ctx: Ctx, deps: Deps): Promise<Date> {
  if (deps.jevDownSince) return deps.jevDownSince;
  const now = new Date().toISOString();
  const [r] = await ctx.db
    .update(mailboxesTable)
    .set({ syncState: sql`${mailboxesTable.syncState} || jsonb_build_object('jevDownSince', coalesce(${mailboxesTable.syncState}->>'jevDownSince', ${now}::text))` })
    .where(eq(mailboxesTable.id, ctx.mailbox.id))
    .returning({ syncState: mailboxesTable.syncState });
  deps.jevDownSince = new Date(r?.syncState?.jevDownSince ?? now);
  emit(ctx, { type: "health" });
  return deps.jevDownSince;
}

async function markJevUp(ctx: Ctx, deps: Deps): Promise<void> {
  if (!deps.jevDownSince) return;
  deps.jevDownSince = null;
  await ctx.db
    .update(mailboxesTable)
    .set({ syncState: sql`${mailboxesTable.syncState} - 'jevDownSince'` })
    .where(eq(mailboxesTable.id, ctx.mailbox.id));
  emit(ctx, { type: "health" });
}

const LANE_PRIORITY: Record<Lane, number> = { vip: 80, goals: 60, reply: 50, screener: 20, other: 10 };

async function judgeOne(ctx: Ctx, msg: MessageRow, deps: Deps): Promise<void> {
  const gmailThreadId = msg.threadId.slice(ctx.mailbox.id.length + 1);
  const loaded = await loadThread(ctx, gmailThreadId);
  if (!loaded) {
    await ctx.db.update(messagesTable).set({ judgedAt: new Date() }).where(eq(messagesTable.id, msg.id));
    return;
  }
  const thread = loaded.record;
  const mail = toMail(msg);
  const [senderRow] = await ctx.db.select().from(sendersTable).where(and(eq(sendersTable.mailboxId, ctx.mailbox.id), eq(sendersTable.email, mail.from.email))).limit(1);
  const senders: SenderRow[] = senderRow ? [senderRow] : [];
  const facts = await computeFacts(ctx.db, ctx.mailbox, mail, thread, deps.vips, deps.teamDomain, senders);
  const senderStatus = senderRow?.status ?? "unknown";
  const input: JevInput = { me: deps.me, goals: deps.goals, vips: deps.vips, mail, thread, facts };

  let answers: JevAnswers | null = null;
  let judgedBy: "jev" | "writer-fallback" | null = null;
  let rows: Judgment[] = [];
  let forced: Decision | null = null;
  /** Jev has been down past the hold: the writer judges, but writes no draft. */
  let degraded = false;

  const neverJudge = senderStatus === "screened_out" && deps.policy.screening.screenedOutNeverJudged;
  const holding = deps.jevFailedThisRun && deps.jevDownSince !== null && Date.now() - deps.jevDownSince.getTime() < JEV_HOLD_MS;
  if (holding && !neverJudge) throw Object.assign(new Error("Jev unavailable, holding"), { code: "jev_held" });
  if (!neverJudge) {
    try {
      if (deps.jevFailedThisRun) throw Object.assign(new Error("Jev failed earlier in this run"), { code: "jev_down" });
      answers = await jev.judge(ctx, input);
      judgedBy = "jev";
      await markJevUp(ctx, deps);
    } catch (e) {
      if (e instanceof BlockedByGrant || (e as { code?: string }).code === "reconnect_required") throw e;
      // Fail closed. A live mailbox whose Jev call failed (not one that never
      // granted Jev) holds the message unjudged: no lane guessed, no draft.
      // After an hour the writer judges it, with drafting off and Check on.
      if (ctx.mailbox.source === "live" && (e as { code?: string }).code !== "jev_missing") {
        deps.jevFailedThisRun = true;
        const since = await markJevDown(ctx, deps);
        if (Date.now() - since.getTime() < JEV_HOLD_MS || !deps.writer) {
          throw Object.assign(new Error(`Jev unavailable, holding: ${String((e as Error).message ?? e).slice(0, 200)}`), { code: "jev_held" });
        }
        degraded = true;
      }
      let fell = false;
      if (deps.writer) {
        try {
          answers = await writerLayer.judgeFallback(ctx, deps.writer, input);
          judgedBy = "writer-fallback";
          fell = true;
        } catch {
          fell = false;
        }
      }
      if (!fell) {
        if (ctx.mailbox.source !== "sample") throw e;
        // A sample thread without a recording: the fixture's own expectation stands in.
        const expect = fixtures.loadInbox(ctx.env.ROOT).threads.find((t) => t.id === gmailThreadId)?.expect;
        const lane: Lane = expect?.lane ?? "other";
        const quarantined = /quarantine/i.test(expect?.note ?? "");
        rows = [{ question: "sample_expectation", label: "Sample expectation", kind: "choice", answer: quarantined ? "Quarantined" : lane, probability: 0.9, confidence: 0.9, probabilities: { [lane]: 0.9 }, model: "fixture-expect" }];
        forced = {
          lane: quarantined ? "other" : lane,
          rule: quarantined ? "quarantined (sample expectation)" : `${lane}: sample expectation`,
          priority: quarantined ? 0 : LANE_PRIORITY[lane],
          confidence: 0.9,
          check: quarantined,
          checkReason: quarantined ? "Quarantined (sample expectation)" : null,
          goalId: lane === "goals" ? (deps.goals.find((g) => !g.paused)?.id ?? null) : null,
          vipId: facts.vipId,
          needsReply: lane === "reply" || lane === "vip",
          draft: false,
          followUpDays: facts.meSentLast ? deps.policy.followUp.days : null,
        };
      }
    }
  }
  if (answers) {
    rows = jev.toJudgments(answers, input);
    if (judgedBy === "writer-fallback") rows = rows.map((r) => ({ ...r, confidence: Math.min(0.6, r.confidence) }));
  }

  let decision = forced ?? decide(deps.policy, { facts, answers, goals: deps.goals, vips: deps.vips, senderStatus, thresholds: deps.thresholds, judgedBy });
  if (degraded) {
    decision = { ...decision, draft: false, check: true, checkReason: "Jev was down for over an hour, so your writer judged this one. No draft was written.", rule: `${decision.rule} (Jev down, writer judged)` };
  }
  const screen = answers ? jev.screenOf(answers, deps.thresholds).screen : forced?.check ? "quarantine" : "pass";

  await ctx.db.delete(judgmentsTable).where(eq(judgmentsTable.messageId, msg.id));
  if (rows.length) {
    await ctx.db.insert(judgmentsTable).values(
      rows.map((r) => ({
        messageId: msg.id,
        mailboxId: ctx.mailbox.id,
        question: r.question,
        label: r.label,
        kind: r.kind,
        answer: r.answer,
        probability: r.probability,
        confidence: r.confidence,
        probabilities: r.probabilities ?? null,
        model: r.model,
      })),
    );
  }

  const [existing] = await ctx.db.select().from(threadStateTable).where(eq(threadStateTable.threadId, loaded.row.id)).limit(1);
  const isLatest = !loaded.messages.some((m) => !m.isFromMe && m.date > msg.date);
  const stateValues = {
    lane: decision.lane,
    rule: decision.rule,
    priority: decision.priority,
    confidence: decision.confidence,
    check: decision.check,
    checkReason: decision.checkReason,
    goalId: decision.goalId,
    vipId: decision.vipId,
    needsReply: decision.needsReply,
    ball: answers?.ball.choice ?? null,
    urgency: answers?.urgency.score ?? 0,
    kind: answers?.kind.choice ?? null,
    screen,
    judgedBy,
    followUpAt: followUpAt(thread, decision),
    updatedAt: new Date(),
  };
  if (!existing) {
    await ctx.db.insert(threadStateTable).values({ threadId: loaded.row.id, mailboxId: ctx.mailbox.id, ...stateValues });
  } else if (isLatest) {
    // Keep the user's own flags; a newer message reopens a thread marked done.
    const reopen = existing.done && existing.updatedAt < msg.date;
    await ctx.db
      .update(threadStateTable)
      .set({ ...stateValues, ...(reopen ? { done: false, doneReason: null } : {}) })
      .where(eq(threadStateTable.threadId, loaded.row.id));
  }

  if (isLatest && deps.writer && screen !== "quarantine" && !neverJudge) {
    try {
      const s = await writerLayer.summarize(ctx, deps.writer, mail, thread);
      await ctx.db.update(threadStateTable).set({ summary: s.summary, ask: s.ask }).where(eq(threadStateTable.threadId, loaded.row.id));
    } catch {
      // a summary is a nicety
    }
    if (decision.draft && ctx.settings.autoDraft && screen === "pass") {
      const open = await ctx.db
        .select({ id: draftsTable.id })
        .from(draftsTable)
        .where(and(eq(draftsTable.threadId, loaded.row.id), sql`${draftsTable.status} <> 'discarded'`))
        .limit(1);
      if (open.length === 0) {
        try {
          const person = await personFor(ctx, mail, thread, deps);
          const goal = decision.goalId ? deps.goals.find((g) => g.id === decision.goalId) ?? null : null;
          const d = await writerLayer.draft(ctx, deps.writer, { mail, thread, me: deps.me, person, goal });
          const canned = d.validator.reasons.includes("no recording for this thread");
          if (d.body && !canned) {
            const draftId = newId("draft");
            await ctx.db.insert(draftsTable).values({
              id: draftId,
              threadId: loaded.row.id,
              mailboxId: ctx.mailbox.id,
              replyToMessageId: msg.id,
              to: [mail.from.email],
              subject: /^re:/i.test(mail.subject) ? mail.subject : `Re: ${mail.subject}`,
              body: d.body,
              engine: deps.writer.engine,
              model: deps.writer.model,
              validator: d.validator,
            });
            emit(ctx, { type: "draft", threadId: gmailThreadId, draftId });
          }
        } catch {
          // no draft is better than a failed one
        }
      }
    }
  }

  await ctx.db.update(messagesTable).set({ judgedAt: new Date() }).where(eq(messagesTable.id, msg.id));
  emit(ctx, { type: "judged", threadId: gmailThreadId, lane: decision.lane, priority: decision.priority, from: msg.fromName, subject: msg.subject });

  if (isLatest && ctx.settings.applyLabels && ctx.mailbox.source === "live") {
    try {
      const mail = getMailProvider(ctx.mailbox.mailProvider);
      const want = laneLabel(decision.lane);
      const id = await mail.ensureLabel(ctx, want);
      deps.labelIds.set(decision.lane, id);
      const remove = [...deps.labelIds.entries()].filter(([lane]) => lane !== decision.lane).map(([, lid]) => lid);
      await mail.modifyThreadLabels(ctx, gmailThreadId, [id], remove);
    } catch (e) {
      if ((e as { code?: string }).code === "reconnect_required") throw e;
      if (!(e instanceof BlockedByGrant) && process.env.RILL_DEBUG) console.error(`label ${gmailThreadId}: ${String((e as Error).message ?? e)}`);
      // refused or disabled writes are already on the ledger
    }
  }
}

async function personFor(ctx: Ctx, mail: Mail, thread: ThreadRecord, deps: Deps) {
  const vip = deps.vips.find((v) => (v.matchKind === "address" && v.match.toLowerCase() === mail.from.email) || (v.matchKind === "domain" && v.match.toLowerCase().replace(/^@/, "") === domainOf(mail.from.email)));
  const others = await ctx.db
    .select({ subject: threadsTable.subject })
    .from(messagesTable)
    .innerJoin(threadsTable, eq(messagesTable.threadId, threadsTable.id))
    .where(and(eq(messagesTable.mailboxId, ctx.mailbox.id), eq(messagesTable.fromEmail, mail.from.email), sql`${threadsTable.gmailId} <> ${thread.id}`))
    .orderBy(desc(messagesTable.date))
    .limit(5);
  return {
    name: mail.from.name || mail.from.email,
    email: mail.from.email,
    vipName: vip?.name ?? null,
    tier: vip?.tier ?? null,
    recentSubjects: [...new Set(others.map((o) => o.subject))],
  };
}
