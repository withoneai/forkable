import { and, desc, eq, gte } from "drizzle-orm";
import type { ApiContact } from "./api-types.js";
import type { Db } from "./db/index.js";
import { events as eventsTable, judgments as judgmentsTable, messages as messagesTable } from "./db/schema.js";

// People to invite, for the attendee field. Read from what Rill already
// stored (mail and synced events), so typing a name never calls a platform.

export interface ContactSignal { email: string; name: string | null; weight: number; at: Date; source: "mail" | "event" }

const NO_REPLY = /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|bounce|postmaster)[@+.]/i;
/** Senders that write to everyone: someone you only ever heard from at hello@ is not a person to invite. */
const BULK_LOCAL = /^(hello|hi|news|newsletter|digest|updates?|team|info|support|billing|receipts?|orders?|marketing|community|events?|alerts?)@/i;
/** Jev's kinds that mean the sender is not a person writing to you. */
const NOT_A_PERSON = new Set(["newsletter", "receipt", "notification", "cold_pitch"]);

/** "Priya Shah <priya@northwind.vc>" or a bare address, to name and email. Pure; exported for tests. */
export function parseAddress(raw: string): { name: string | null; email: string } | null {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const email = (m ? m[2]! : raw).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const name = m?.[1]?.trim() || null;
  return { name: name && name.toLowerCase() !== email ? name : null, email };
}

/**
 * Rank contacts: each signal adds its weight, halved for every 30 days of age,
 * and a query matches the start of the email or of any word in the name.
 * Pure; exported for tests.
 */
export function rankContacts(signals: ContactSignal[], opts: { q?: string; self?: string; limit?: number; now?: Date }): ApiContact[] {
  const now = (opts.now ?? new Date()).getTime();
  const self = (opts.self ?? "").toLowerCase();
  const byEmail = new Map<string, { email: string; name: string | null; score: number; last: Date; sources: Set<"mail" | "event"> }>();
  for (const s of signals) {
    const email = s.email.toLowerCase();
    if (!email || email === self || NO_REPLY.test(email)) continue;
    const ageDays = Math.max(0, (now - s.at.getTime()) / 864e5);
    const cur = byEmail.get(email) ?? { email, name: null, score: 0, last: s.at, sources: new Set() };
    cur.score += s.weight * Math.pow(0.5, ageDays / 30);
    if (s.at >= cur.last || !cur.name) { if (s.name) cur.name = s.name; }
    if (s.at > cur.last) cur.last = s.at;
    cur.sources.add(s.source);
    byEmail.set(email, cur);
  }
  const q = (opts.q ?? "").trim().toLowerCase();
  const matches = (c: { email: string; name: string | null }) => {
    if (!q) return true;
    if (c.email.startsWith(q) || c.email.split("@")[1]?.startsWith(q)) return true;
    return (c.name ?? "").toLowerCase().split(/[\s.\-_]+/).some((w) => w.startsWith(q)) || (c.name ?? "").toLowerCase().startsWith(q);
  };
  return [...byEmail.values()]
    .filter(matches)
    .sort((a, b) => b.score - a.score || b.last.getTime() - a.last.getTime())
    .slice(0, opts.limit ?? 8)
    .map((c) => ({ email: c.email, name: c.name, source: c.sources.size > 1 ? "both" : [...c.sources][0]!, lastSeen: c.last.toISOString() }));
}

/** Signals from the last 180 days of stored mail and events for one mailbox. */
export async function contactSignals(db: Db, mailboxId: string): Promise<ContactSignal[]> {
  const since = new Date(Date.now() - 180 * 864e5);
  const [msgs, evs, kinds] = await Promise.all([
    db.select({ id: messagesTable.id, fromName: messagesTable.fromName, fromEmail: messagesTable.fromEmail, to: messagesTable.to, cc: messagesTable.cc, date: messagesTable.date, isFromMe: messagesTable.isFromMe })
      .from(messagesTable).where(and(eq(messagesTable.mailboxId, mailboxId), gte(messagesTable.date, since))).orderBy(desc(messagesTable.date)).limit(3000),
    db.select({ attendees: eventsTable.attendees, organizer: eventsTable.organizer, start: eventsTable.start })
      .from(eventsTable).where(and(eq(eventsTable.mailboxId, mailboxId), gte(eventsTable.start, since))).orderBy(desc(eventsTable.start)).limit(1000),
    db.select({ messageId: judgmentsTable.messageId, probabilities: judgmentsTable.probabilities })
      .from(judgmentsTable).where(and(eq(judgmentsTable.mailboxId, mailboxId), eq(judgmentsTable.question, "kind"))),
  ]);
  const bulk = new Set<string>();
  for (const j of kinds) {
    const top = Object.entries(j.probabilities ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (top && NOT_A_PERSON.has(top)) bulk.add(j.messageId);
  }
  const out: ContactSignal[] = [];
  for (const m of msgs) {
    if (m.isFromMe) {
      for (const raw of m.to) { const a = parseAddress(raw); if (a) out.push({ ...a, weight: 3, at: m.date, source: "mail" }); }
      for (const raw of m.cc) { const a = parseAddress(raw); if (a) out.push({ ...a, weight: 1.5, at: m.date, source: "mail" }); }
    } else {
      const a = parseAddress(m.fromEmail);
      if (a && !bulk.has(m.id) && !BULK_LOCAL.test(a.email)) out.push({ email: a.email, name: m.fromName || a.name, weight: 1, at: m.date, source: "mail" });
    }
  }
  for (const e of evs) {
    for (const a of e.attendees ?? []) if (a.email && !a.self) out.push({ email: a.email, name: a.name ?? null, weight: 2, at: e.start, source: "event" });
    if (e.organizer?.email) out.push({ email: e.organizer.email, name: e.organizer.name ?? null, weight: 1, at: e.start, source: "event" });
  }
  return out;
}
