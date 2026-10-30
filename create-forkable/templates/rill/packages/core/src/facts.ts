import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import type { MailboxRow, VipRow } from "./contract.js";
import type { Db } from "./db/client.js";
import { events as eventsTable, messages as messagesTable, senders as sendersTable } from "./db/schema.js";
import { CALENDAR_INVITE_LABEL, LIST_UNSUBSCRIBE_LABEL } from "./fixtures.js";
import { domainOf } from "./sanitize.js";
import type { Facts, Mail, ThreadRecord, VipTier } from "./types.js";

// Hard facts: everything that is true or false without judgment. Exact VIP
// match, team domain, first-time sender (never wrote to them, never met them),
// who wrote last, list mail, a reply, a calendar invite, a meeting with them
// in the next 48 hours. Jev gets these as state and the policy reads them
// first, so the model is never asked what the database already knows.

export type SenderRow = typeof sendersTable.$inferSelect;

export function vipMatch(email: string, vips: Pick<VipRow, "id" | "matchKind" | "match" | "tier">[]): { id: string; tier: VipTier } | null {
  const e = email.toLowerCase();
  const d = domainOf(e);
  for (const v of vips) {
    if (v.matchKind === "address" && v.match.toLowerCase() === e) return { id: v.id, tier: v.tier };
  }
  for (const v of vips) {
    if (v.matchKind === "domain" && v.match.toLowerCase().replace(/^@/, "") === d) return { id: v.id, tier: v.tier };
  }
  return null;
}

export function isCalendarInvite(mail: Mail): boolean {
  if (mail.labelIds.includes(CALENDAR_INVITE_LABEL)) return true;
  if (/calendar-notification@google\.com|calendar-server\.bounces\.google\.com/.test(mail.from.email)) return true;
  if (/^(invitation|updated invitation|accepted|declined|tentatively accepted|canceled event|cancelled event):/i.test(mail.subject.trim())) return true;
  return /BEGIN:VCALENDAR/.test(mail.rawBody ?? "");
}

export function hasListUnsubscribe(mail: Mail): boolean {
  if (mail.labelIds.includes(LIST_UNSUBSCRIBE_LABEL)) return true;
  return /\bunsubscribe\b|manage (your )?(email )?preferences|opt[ -]?out\b/i.test((mail.rawBody ?? mail.body).slice(-2500));
}

const wroteCache = new Map<string, boolean>();

/** Has the user ever sent a message to this address, anywhere in the mailbox? Cached per process. */
export async function everWroteTo(db: Db, mailboxId: string, email: string): Promise<boolean> {
  const key = `${mailboxId}:${email}`;
  const hit = wroteCache.get(key);
  if (hit !== undefined) return hit;
  const needle = JSON.stringify([email]);
  const [r] = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(and(eq(messagesTable.mailboxId, mailboxId), eq(messagesTable.isFromMe, true), sql`(${messagesTable.to} @> ${needle}::jsonb or ${messagesTable.cc} @> ${needle}::jsonb)`))
    .limit(1);
  const v = Boolean(r);
  if (v) wroteCache.set(key, true);
  return v;
}

const MEETING_SOON_MS = 48 * 3600_000;

/** Events (not cancelled) where this address is the organizer or a guest. `window` limits them to a start range. */
async function eventsWith(db: Db, mailboxId: string, email: string, window?: { from: Date; to: Date }): Promise<boolean> {
  const needle = JSON.stringify([{ email }]);
  const [r] = await db
    .select({ id: eventsTable.id })
    .from(eventsTable)
    .where(and(
      eq(eventsTable.mailboxId, mailboxId),
      ne(eventsTable.status, "cancelled"),
      window ? gte(eventsTable.start, window.from) : undefined,
      window ? lte(eventsTable.start, window.to) : undefined,
      sql`(${eventsTable.attendees} @> ${needle}::jsonb or lower(${eventsTable.organizer}->>'email') = ${email})`,
    ))
    .limit(1);
  return Boolean(r);
}

/** A meeting with this person starts in the next 48 hours. */
export function meetingSoonWith(db: Db, mailboxId: string, email: string, now = new Date()): Promise<boolean> {
  return eventsWith(db, mailboxId, email, { from: now, to: new Date(now.getTime() + MEETING_SOON_MS) });
}

/**
 * Computes the facts for one message. `senders` is the mailbox's senders
 * table, when the caller already has it; otherwise the sender's row is read.
 */
export async function computeFacts(
  db: Db,
  mailbox: MailboxRow,
  mail: Mail,
  thread: ThreadRecord,
  vips: VipRow[],
  teamDomain: string | null,
  senders?: SenderRow[] | Map<string, SenderRow>,
): Promise<Facts> {
  const me = (mailbox.address ?? "").toLowerCase();
  const from = mail.from.email.toLowerCase();
  const team = teamDomain ? domainOf(from) === teamDomain.toLowerCase().replace(/^@/, "") && from !== me : false;

  let vip = vipMatch(from, vips);
  if (!vip) {
    for (const p of thread.participants) {
      if (!p.email || p.email === me) continue;
      vip = vipMatch(p.email, vips);
      if (vip) break;
    }
  }

  let senderRow: SenderRow | undefined;
  if (senders instanceof Map) senderRow = senders.get(from);
  else if (Array.isArray(senders)) senderRow = senders.find((s) => s.email === from);
  else {
    const [r] = await db.select().from(sendersTable).where(and(eq(sendersTable.mailboxId, mailbox.id), eq(sendersTable.email, from))).limit(1);
    senderRow = r;
  }

  const ordered = [...thread.messages].sort((a, b) => a.date.localeCompare(b.date));
  const idx = ordered.findIndex((m) => m.id === mail.id);
  const before = idx >= 0 ? ordered.slice(0, idx) : ordered.filter((m) => m.date < mail.date);
  const last = ordered[ordered.length - 1];
  const fromMe = mail.isFromMe || (me !== "" && from === me);

  // First-time sender: nobody has screened them, the user never wrote to them
  // (sender memory, this thread, or any sent message in the mailbox), they are
  // not on the team and not a VIP. Message counts alone do not make a sender known.
  let firstTimeSender = false;
  if (!fromMe && !team && !vipMatch(from, vips)) {
    const screened = senderRow ? senderRow.status !== "unknown" : false;
    let wroteToThem = Boolean(senderRow?.iWroteToThem) || thread.messages.some((m) => m.isFromMe && [...m.to, ...m.cc].includes(from));
    if (!screened && !wroteToThem) wroteToThem = await everWroteTo(db, mailbox.id, from);
    // Met them: any meeting on the calendar, past or future, makes them known.
    const met = !screened && !wroteToThem ? await eventsWith(db, mailbox.id, from).catch(() => false) : false;
    firstTimeSender = !screened && !wroteToThem && !met;
  }
  const meetingSoon = fromMe ? false : await meetingSoonWith(db, mailbox.id, from).catch(() => false);

  return {
    vipId: vip?.id ?? null,
    vipTier: vip?.tier ?? null,
    team,
    firstTimeSender,
    fromMe,
    meSentLast: Boolean(last && (last.isFromMe || (me !== "" && last.from.email.toLowerCase() === me))),
    hasListUnsubscribe: hasListUnsubscribe(mail),
    isReply: before.length > 0 || /^\s*(re|aw|sv|antw)\s*:/i.test(mail.subject),
    calendarInvite: isCalendarInvite(mail),
    messageCount: thread.messageCount || ordered.length || 1,
    meetingSoon,
  };
}
