import { and, desc, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import type { ApiCalendar, ApiEvent, ApiInvite, EventPatchInput, EventResponse, FreeBusyResponse, RsvpAction } from "./api-types.js";
import { createZoomMeeting, linkBlock, meetingUrlIn, providerOf, available as conferencingAvailable } from "./conferencing.js";
import type { Attendee } from "./types.js";
import type { CalendarLayer, Ctx } from "./contract.js";
import { calendars as calendarsTable, events as eventsTable, eventThreads as eventThreadsTable, mailboxes as mailboxesTable, messages as messagesTable, threadState as threadStateTable, threads as threadsTable } from "./db/schema.js";
import { isCalendarInvite } from "./facts.js";
import { fixtures, resolveFixtureWhen } from "./fixtures.js";
import { CALENDAR_ACTIONS } from "./providers/gmail/calendar.js";
import { getCalendarProvider } from "./providers/registry.js";
import { one } from "./one.js";
import { toMail } from "./sync.js";

// The calendar glue: sync, the window the UI reads, the invite card, RSVP and
// free/busy. Sample mailboxes bypass the provider for routine sync (fixtures
// load once, the same way sync.ts does for mail); RSVP and free/busy still
// go through one.call even for sample mailboxes, so the Access ledger shows
// real activity and the 403 receipt works the same way Gmail's does.

export const dbCalendarId = (mailboxId: string, providerCalendarId: string) => `${mailboxId}:${providerCalendarId}`;
export const dbEventId = (calendarDbId: string, providerEventId: string) => `${calendarDbId}:${providerEventId}`;

type CalendarRow = typeof calendarsTable.$inferSelect;
type EventRow = typeof eventsTable.$inferSelect;

/** Did the event's time change since the last sync? Pure; exported for tests. */
export function movedFromOf(existing: { start: string; end: string } | undefined, incomingStart: string, incomingEnd: string): { start: string; end: string } | null {
  if (!existing) return null;
  if (new Date(existing.start).getTime() === new Date(incomingStart).getTime() && new Date(existing.end).getTime() === new Date(incomingEnd).getTime()) return null;
  return { start: existing.start, end: existing.end };
}

/** Provider ids that were synced before but are missing from this sync: they were cancelled or deleted upstream. Pure; exported for tests. */
export function cancelledProviderIds(previously: { providerId: string; status: string }[], seenThisSync: Set<string>): string[] {
  return previously.filter((r) => r.status !== "cancelled" && !seenThisSync.has(r.providerId)).map((r) => r.providerId);
}

export function toApiCalendar(c: CalendarRow): ApiCalendar {
  return { id: c.id, name: c.name, color: c.color, shown: c.shown, countsForAvailability: c.countsForAvailability, isDefault: c.isDefault, syncState: c.syncState };
}

export function toApiEvent(e: EventRow, opts: { conflict?: { eventId: string; title: string } | null; relatedThreads?: { threadId: string; subject: string }[] } = {}): ApiEvent {
  return {
    id: e.id,
    calendarId: e.calendarId,
    title: e.title,
    description: e.description,
    location: e.location,
    start: e.start.toISOString(),
    end: e.end.toISOString(),
    timeZone: e.timeZone,
    allDay: e.allDay,
    status: e.status,
    organizer: e.organizer,
    attendees: e.attendees,
    joinUrl: e.joinUrl,
    myResponse: e.myResponse,
    recurringEventId: e.recurringEventId,
    conflict: opts.conflict ?? null,
    relatedThreads: opts.relatedThreads ?? [],
    editable: isEditable(e),
  };
}

/** You can change an event you organize (or one nobody organizes) while it is live. Pure; exported for tests. */
export function isEditable(e: { status: string; organizer: { email: string } | null; attendees: Attendee[] }): boolean {
  if (e.status === "cancelled") return false;
  if (!e.organizer) return true;
  const me = e.attendees.find((a) => a.self);
  return Boolean(me && (me.organizer || me.email.toLowerCase() === e.organizer.email.toLowerCase()));
}

/**
 * The guest list after an edit: you stay, guests still wanted keep their reply,
 * new ones start as needsAction with the name the picker knew. Pure; exported for tests.
 */
export function mergeAttendees(current: Attendee[], wanted: string[], names: Record<string, string> = {}, selfEmail = ""): Attendee[] {
  const self = selfEmail.toLowerCase();
  const keep = current.filter((a) => a.self || a.email.toLowerCase() === self);
  const seen = new Set(keep.map((a) => a.email.toLowerCase()));
  for (const raw of wanted) {
    const email = raw.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const was = current.find((a) => a.email.toLowerCase() === email);
    keep.push(was ?? { email, name: names[raw] ?? names[email] ?? null, self: false, organizer: false, response: "needsAction" });
  }
  return keep;
}

/** Description and location with a meeting link (and its passcode block) taken out. Pure; exported for tests. */
export function stripLink(description: string | null, location: string | null, joinUrl: string | null): { description: string | null; location: string | null } {
  if (!joinUrl) return { description, location };
  const esc = joinUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = new RegExp(`(^|\\n\\n?)Join [^\\n]* meeting\\n${esc}(\\nPasscode: [^\\n]*)?`, "g");
  const desc = (description ?? "").replace(block, "").replace(esc, "").trim();
  return { description: desc || null, location: location && location.trim() === joinUrl ? null : location };
}

export class EditNotAllowed extends Error { constructor() { super("Only the organizer can change this event"); } }
export class AlreadyCancelled extends Error { constructor() { super("This event is already cancelled"); } }

async function patchEvent(ctx: Ctx, eventId: string, input: EventPatchInput): Promise<ApiEvent> {
  const [e] = await ctx.db.select().from(eventsTable).where(and(eq(eventsTable.id, eventId), eq(eventsTable.mailboxId, ctx.mailbox.id))).limit(1);
  if (!e) throw new Error("event not found");
  if (e.status === "cancelled") throw new AlreadyCancelled();
  if (!isEditable(e)) throw new EditNotAllowed();
  const [cal] = await ctx.db.select().from(calendarsTable).where(eq(calendarsTable.id, e.calendarId)).limit(1);
  if (!cal) throw new Error("calendar not found");
  const selfEmail = (ctx.mailbox.address ?? "").toLowerCase();
  const timeZone = input.timeZone ?? e.timeZone ?? ctx.settings.timezone ?? "UTC";
  const current = { ...toApiEvent(e), iCalUID: e.iCalUid, recurringEventId: e.recurringEventId, updated: e.updated.toISOString() };

  const patch: import("./contract.js").EventPatch = { current, notify: input.notify ?? "none" };
  if (input.title !== undefined) patch.title = input.title.trim() || "(no title)";
  if (input.description !== undefined) patch.description = input.description;
  if (input.location !== undefined) patch.location = input.location;
  if (input.start !== undefined || input.end !== undefined || input.allDay !== undefined) {
    const start = input.start ?? e.start.toISOString();
    const end = input.end ?? e.end.toISOString();
    if (new Date(end) <= new Date(start)) throw new Error("end must be after start");
    patch.start = start; patch.end = end; patch.timeZone = timeZone; patch.allDay = input.allDay ?? e.allDay;
  }
  if (input.attendees !== undefined) patch.attendees = mergeAttendees(e.attendees, input.attendees, input.attendeeNames, selfEmail);
  if (input.status === "cancelled") patch.status = "cancelled";
  if (input.conferencing !== undefined) {
    const offer = await conferencingAvailable(ctx);
    if (input.conferencing && !offer.available.includes(input.conferencing)) throw new Error(`${input.conferencing} is not connected`);
    const already = providerOf(e.joinUrl);
    if (input.conferencing !== already) {
      // Any old third-party link leaves the text first; the calendar's own link is cleared by conferencing: null.
      const stripped = stripLink(patch.description !== undefined ? patch.description : e.description, patch.location !== undefined ? patch.location : e.location, e.joinUrl);
      patch.description = stripped.description; patch.location = stripped.location;
      patch.conferencing = input.conferencing === "zoom" ? null : input.conferencing;
      if (input.conferencing === "zoom") {
        const link = await createZoomMeeting(ctx, { title: patch.title ?? e.title, start: patch.start ?? e.start.toISOString(), end: patch.end ?? e.end.toISOString(), timeZone });
        patch.link = link;
        patch.description = [patch.description, linkBlock(link)].filter(Boolean).join("\n\n");
        patch.location = patch.location ?? link.url;
      } else {
        patch.link = null;
      }
    }
  }

  const result = await getCalendarProvider(ctx.mailbox.calendarProvider ?? "google-calendar").patchEvent(ctx, cal.providerId, e.providerId, patch);
  const joinUrl = result.joinUrl ?? (patch.link ? patch.link.url : patch.link === null ? null : meetingUrlIn(result.location) ?? meetingUrlIn(result.description));
  const [updated] = await ctx.db.update(eventsTable).set({
    title: result.title, description: result.description, location: result.location,
    start: new Date(result.start), end: new Date(result.end), timeZone: result.timeZone ?? timeZone, allDay: result.allDay,
    status: patch.status ?? result.status, attendees: result.attendees, joinUrl, myResponse: result.myResponse,
    updated: new Date(), editedAt: new Date(),
  }).where(eq(eventsTable.id, eventId)).returning();
  emit(ctx, { type: "calendar", phase: "done", changed: 1 });
  return toApiEvent(updated!);
}

const emit = (ctx: Ctx, ev: Parameters<Ctx["emit"]>[0]) => {
  try {
    ctx.emit(ev);
  } catch {
    // a closed stream never fails the work
  }
};

// ---- sync ---------------------------------------------------------------------

async function syncCalendarSample(ctx: Ctx): Promise<{ calendars: number; events: number; cancelled: number }> {
  const fixture = fixtures.loadCalendar(ctx.env.ROOT);
  const { calendars, events } = fixtures.calendarRecords(fixture);
  let calCount = 0;
  let evCount = 0;
  for (const c of calendars) {
    const id = dbCalendarId(ctx.mailbox.id, c.id);
    const existing = await ctx.db.select({ id: calendarsTable.id }).from(calendarsTable).where(eq(calendarsTable.id, id)).limit(1);
    await ctx.db
      .insert(calendarsTable)
      .values({ id, providerId: c.id, mailboxId: ctx.mailbox.id, provider: "google-calendar", name: c.name, color: c.color, isDefault: c.isDefault, accessRole: c.accessRole })
      .onConflictDoUpdate({ target: calendarsTable.id, set: { name: c.name, color: c.color, isDefault: c.isDefault } });
    if (existing.length === 0) calCount++;
  }
  const now = Date.now();
  for (const e of events) {
    const fe = fixture.events.find((x) => x.id === e.id)!;
    const calId = dbCalendarId(ctx.mailbox.id, e.calendarId);
    const id = dbEventId(calId, e.id);
    const existing = await ctx.db.select({ id: eventsTable.id }).from(eventsTable).where(eq(eventsTable.id, id)).limit(1);
    const movedStart = fe.movedFrom ? resolveFixtureWhen(fe.movedFrom.when, fe.timeZone, new Date(now)) : null;
    const movedFrom = fe.movedFrom && movedStart
      ? { start: movedStart.toISOString(), end: new Date(movedStart.getTime() + fe.movedFrom.durationMinutes * 60_000).toISOString() }
      : null;
    await ctx.db
      .insert(eventsTable)
      .values({
        id, providerId: e.id, calendarId: calId, mailboxId: ctx.mailbox.id, iCalUid: e.iCalUID, recurringEventId: e.recurringEventId,
        title: e.title, description: e.description, location: e.location, start: new Date(e.start), end: new Date(e.end), timeZone: e.timeZone,
        allDay: e.allDay, status: e.status, organizer: e.organizer, attendees: e.attendees, joinUrl: e.joinUrl, myResponse: e.myResponse,
        updated: new Date(e.updated), movedFrom,
      })
      .onConflictDoUpdate({
        target: eventsTable.id,
        set: { title: e.title, start: new Date(e.start), end: new Date(e.end), status: e.status, attendees: e.attendees, myResponse: e.myResponse, movedFrom, updated: new Date() },
        setWhere: isNull(eventsTable.editedAt), // an event the user changed in Rill is theirs now
      });
    if (existing.length === 0) evCount++;
    if (fe.threadId) {
      const threadDbId = `${ctx.mailbox.id}:${fe.threadId}`;
      const threadExists = await ctx.db.select({ id: threadsTable.id }).from(threadsTable).where(eq(threadsTable.id, threadDbId)).limit(1);
      if (threadExists.length) await ctx.db.insert(eventThreadsTable).values({ eventId: id, threadId: threadDbId, source: "jev" }).onConflictDoNothing();
    }
  }
  return { calendars: calCount, events: evCount, cancelled: 0 };
}

async function syncCalendarLive(ctx: Ctx): Promise<{ calendars: number; events: number; cancelled: number }> {
  if (!ctx.mailbox.calendarProvider) return { calendars: 0, events: 0, cancelled: 0 };
  const provider = getCalendarProvider(ctx.mailbox.calendarProvider);
  const remoteCals = await provider.listCalendars(ctx);
  let calCount = 0;
  const calRows: CalendarRow[] = [];
  for (const c of remoteCals) {
    const id = dbCalendarId(ctx.mailbox.id, c.id);
    const existing = await ctx.db.select({ id: calendarsTable.id }).from(calendarsTable).where(eq(calendarsTable.id, id)).limit(1);
    const [row] = await ctx.db
      .insert(calendarsTable)
      .values({ id, providerId: c.id, mailboxId: ctx.mailbox.id, provider: ctx.mailbox.calendarProvider, connectionKey: ctx.mailbox.calendarConnectionKey, name: c.name, color: c.color, isDefault: c.isDefault, accessRole: c.accessRole })
      .onConflictDoUpdate({ target: calendarsTable.id, set: { name: c.name, color: c.color, isDefault: c.isDefault, accessRole: c.accessRole } })
      .returning();
    if (existing.length === 0) calCount++;
    calRows.push(row!);
  }
  const from = new Date(Date.now() - 7 * 864e5).toISOString();
  const to = new Date(Date.now() + 60 * 864e5).toISOString();
  let evCount = 0;
  let cancelled = 0;
  for (const cal of calRows) {
    if (!cal.shown) continue;
    const { events: remote } = await provider.listEvents(ctx, cal.providerId, { from, to });
    const seen = new Set<string>();
    for (const e of remote) {
      seen.add(e.id);
      const id = dbEventId(cal.id, e.id);
      const existing = (await ctx.db.select({ start: eventsTable.start, end: eventsTable.end, movedFrom: eventsTable.movedFrom }).from(eventsTable).where(eq(eventsTable.id, id)).limit(1))[0];
      const movedFrom = existing ? movedFromOf({ start: existing.start.toISOString(), end: existing.end.toISOString() }, e.start, e.end) ?? existing.movedFrom : null;
      await ctx.db
        .insert(eventsTable)
        .values({
          id, providerId: e.id, calendarId: cal.id, mailboxId: ctx.mailbox.id, iCalUid: e.iCalUID, recurringEventId: e.recurringEventId,
          title: e.title, description: e.description, location: e.location, start: new Date(e.start), end: new Date(e.end), timeZone: e.timeZone,
          allDay: e.allDay, status: e.status, organizer: e.organizer, attendees: e.attendees, joinUrl: e.joinUrl, myResponse: e.myResponse,
          updated: new Date(e.updated), movedFrom,
        })
        .onConflictDoUpdate({
          target: eventsTable.id,
          set: { title: e.title, description: e.description, location: e.location, start: new Date(e.start), end: new Date(e.end), timeZone: e.timeZone, status: e.status, attendees: e.attendees, joinUrl: e.joinUrl, myResponse: e.myResponse, movedFrom, updated: new Date() },
        });
      if (!existing) evCount++;
    }
    const stillThere = await ctx.db
      .select({ id: eventsTable.id, providerId: eventsTable.providerId, status: eventsTable.status })
      .from(eventsTable)
      .where(and(eq(eventsTable.calendarId, cal.id), gte(eventsTable.start, new Date(from)), lte(eventsTable.start, new Date(to))));
    const toCancel = new Set(cancelledProviderIds(stillThere, seen));
    for (const row of stillThere) {
      if (toCancel.has(row.providerId)) {
        await ctx.db.update(eventsTable).set({ status: "cancelled", updated: new Date() }).where(eq(eventsTable.id, row.id));
        cancelled++;
      }
    }
  }
  await ctx.db.update(mailboxesTable).set({ calendarLastSyncAt: new Date() }).where(eq(mailboxesTable.id, ctx.mailbox.id));
  return { calendars: calCount, events: evCount, cancelled };
}

// ---- reads ----------------------------------------------------------------------

async function relatedThreadsFor(ctx: Ctx, eventDbIds: string[]): Promise<Map<string, { threadId: string; subject: string }[]>> {
  const map = new Map<string, { threadId: string; subject: string }[]>();
  if (!eventDbIds.length) return map;
  const rows = await ctx.db
    .select({ eventId: eventThreadsTable.eventId, threadId: threadsTable.gmailId, subject: threadsTable.subject })
    .from(eventThreadsTable)
    .innerJoin(threadsTable, eq(eventThreadsTable.threadId, threadsTable.id))
    .where(inArray(eventThreadsTable.eventId, eventDbIds));
  for (const r of rows) {
    const arr = map.get(r.eventId) ?? [];
    arr.push({ threadId: r.threadId, subject: r.subject });
    map.set(r.eventId, arr);
  }
  return map;
}

export interface ConflictCandidate { id: string; title: string; start: Date; end: Date; status: string; allDay: boolean }

/** Hard conflicts only: two non-all-day events whose times overlap. Pure; exported for tests. */
export function conflictsAmong<T extends ConflictCandidate>(rows: T[]): Map<string, { eventId: string; title: string }> {
  const out = new Map<string, { eventId: string; title: string }>();
  const active = rows.filter((e) => e.status !== "cancelled" && !e.allDay).sort((a, b) => a.start.getTime() - b.start.getTime());
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!;
      const b = active[j]!;
      if (b.start.getTime() >= a.end.getTime()) break;
      if (!out.has(a.id)) out.set(a.id, { eventId: b.id, title: b.title });
      if (!out.has(b.id)) out.set(b.id, { eventId: a.id, title: a.title });
    }
  }
  return out;
}

async function windowFor(ctx: Ctx, from: string, to: string): Promise<{ calendars: ApiCalendar[]; events: ApiEvent[] }> {
  const calRows = await ctx.db.select().from(calendarsTable).where(eq(calendarsTable.mailboxId, ctx.mailbox.id));
  const evRows = await ctx.db
    .select()
    .from(eventsTable)
    .where(and(eq(eventsTable.mailboxId, ctx.mailbox.id), lte(eventsTable.start, new Date(to)), gte(eventsTable.end, new Date(from))));
  const conflicts = conflictsAmong(evRows);
  const related = await relatedThreadsFor(ctx, evRows.map((e) => e.id));
  return {
    calendars: calRows.map(toApiCalendar),
    events: evRows.map((e) => toApiEvent(e, { conflict: conflicts.get(e.id) ?? null, relatedThreads: related.get(e.id) ?? [] })).sort((a, b) => a.start.localeCompare(b.start)),
  };
}

async function eventResponse(ctx: Ctx, eventId: string): Promise<EventResponse | null> {
  const [e] = await ctx.db.select().from(eventsTable).where(and(eq(eventsTable.id, eventId), eq(eventsTable.mailboxId, ctx.mailbox.id))).limit(1);
  if (!e) return null;
  const related = (await relatedThreadsFor(ctx, [eventId])).get(eventId) ?? [];
  const threadRows = related.length
    ? await ctx.db.select({ gmailId: threadsTable.gmailId, subject: threadsTable.subject, lastMessageAt: threadsTable.lastMessageAt }).from(threadsTable).where(and(eq(threadsTable.mailboxId, ctx.mailbox.id), inArray(threadsTable.gmailId, related.map((r) => r.threadId))))
    : [];
  const siblings = await ctx.db
    .select()
    .from(eventsTable)
    .where(and(eq(eventsTable.mailboxId, ctx.mailbox.id), lte(eventsTable.start, e.end), gte(eventsTable.end, e.start), ne(eventsTable.id, e.id)));
  const conflict = conflictsAmong([e, ...siblings]).get(e.id) ?? null;
  return {
    event: toApiEvent(e, { conflict, relatedThreads: related }),
    relatedThreads: threadRows.map((t) => ({ threadId: t.gmailId, subject: t.subject, lastMessageAt: t.lastMessageAt.toISOString() })),
    prep: null,
  };
}

async function inviteFor(ctx: Ctx, threadId: string): Promise<ApiInvite | null> {
  const threadDbId = `${ctx.mailbox.id}:${threadId}`;
  const [link] = await ctx.db.select().from(eventThreadsTable).where(eq(eventThreadsTable.threadId, threadDbId)).limit(1);
  let eventRow: EventRow | undefined;
  if (link) {
    [eventRow] = await ctx.db.select().from(eventsTable).where(eq(eventsTable.id, link.eventId)).limit(1);
  } else {
    const [latest] = await ctx.db.select().from(messagesTable).where(eq(messagesTable.threadId, threadDbId)).orderBy(desc(messagesTable.date)).limit(1);
    if (!latest || !isCalendarInvite(toMail(latest))) return null;
    // Best-effort match: no ICS UID is persisted yet, so a live mailbox matches by
    // organizer and the nearest event time. The sample inbox links are explicit
    // (fixtures/calendar.json `threadId`), which is the exact-match path.
    const organizerEmail = latest.fromEmail.toLowerCase();
    const candidates = await ctx.db.select().from(eventsTable).where(eq(eventsTable.mailboxId, ctx.mailbox.id));
    const matching = candidates.filter((e) => (e.organizer?.email ?? "").toLowerCase() === organizerEmail || e.attendees.some((a) => a.email.toLowerCase() === organizerEmail));
    matching.sort((a, b) => Math.abs(a.start.getTime() - latest.date.getTime()) - Math.abs(b.start.getTime() - latest.date.getTime()));
    eventRow = matching[0];
    if (eventRow) await ctx.db.insert(eventThreadsTable).values({ eventId: eventRow.id, threadId: threadDbId, source: "ical-uid" }).onConflictDoNothing();
  }
  if (!eventRow) return null;
  const siblings = await ctx.db
    .select()
    .from(eventsTable)
    .where(and(eq(eventsTable.mailboxId, ctx.mailbox.id), lte(eventsTable.start, eventRow.end), gte(eventsTable.end, eventRow.start), ne(eventsTable.id, eventRow.id)));
  const conflict = conflictsAmong([eventRow, ...siblings]).get(eventRow.id);
  const state: ApiInvite["state"] = eventRow.status === "cancelled" ? "cancelled" : eventRow.myResponse === "needsAction" ? "pending" : "answered";
  return {
    eventId: eventRow.id,
    state,
    event: {
      title: eventRow.title,
      start: eventRow.start.toISOString(),
      end: eventRow.end.toISOString(),
      timeZone: eventRow.timeZone,
      organizerTimeZone: null,
      joinUrl: eventRow.joinUrl,
      attendees: eventRow.attendees,
      status: eventRow.status,
      myResponse: eventRow.myResponse,
    },
    movedFrom: eventRow.movedFrom,
    conflict: conflict ? { ...conflict, start: siblings.find((s) => s.id === conflict.eventId)?.start.toISOString() ?? "", end: siblings.find((s) => s.id === conflict.eventId)?.end.toISOString() ?? "" } : null,
    freeAtThatTime: !conflict,
    rsvpByEmail: false,
  };
}

async function sampleRsvpLedger(ctx: Ctx, cal: CalendarRow, e: EventRow, action: RsvpAction): Promise<void> {
  const selfEmail = (ctx.mailbox.address ?? "").toLowerCase();
  await one.call<unknown, void>(ctx, {
    platform: "google-calendar",
    action: "events-patch",
    level: "write",
    actionId: CALENDAR_ACTIONS.eventsPatch.id,
    method: CALENDAR_ACTIONS.eventsPatch.method,
    path: CALENDAR_ACTIONS.eventsPatch.path,
    pathParams: { calendarId: cal.providerId, eventId: e.providerId },
    body: { attendees: e.attendees.map((a) => ({ email: a.email, self: a.self, organizer: a.organizer, responseStatus: a.email.toLowerCase() === selfEmail ? action.response : a.response })) },
    summary: `RSVP ${action.response} to ${e.title}`,
    fixture: () => undefined,
    pick: () => undefined,
  });
}

async function rsvp(ctx: Ctx, eventId: string, action: RsvpAction): Promise<ApiEvent> {
  const [e] = await ctx.db.select().from(eventsTable).where(and(eq(eventsTable.id, eventId), eq(eventsTable.mailboxId, ctx.mailbox.id))).limit(1);
  if (!e) throw new Error("event not found");
  const [cal] = await ctx.db.select().from(calendarsTable).where(eq(calendarsTable.id, e.calendarId)).limit(1);
  if (ctx.mailbox.source === "sample") {
    await sampleRsvpLedger(ctx, cal!, e, action);
  } else {
    if (!ctx.mailbox.calendarProvider) throw new Error("no calendar connected");
    await getCalendarProvider(ctx.mailbox.calendarProvider).rsvp(ctx, cal!.providerId, e.providerId, action.response, action.note);
  }
  const selfEmail = (ctx.mailbox.address ?? "").toLowerCase();
  const attendees = e.attendees.map((a) => (a.email.toLowerCase() === selfEmail ? { ...a, response: action.response } : a));
  const [updated] = await ctx.db.update(eventsTable).set({ myResponse: action.response, attendees, updated: new Date() }).where(eq(eventsTable.id, eventId)).returning();
  const [link] = await ctx.db.select().from(eventThreadsTable).where(eq(eventThreadsTable.eventId, eventId)).limit(1);
  if (link) await ctx.db.update(threadStateTable).set({ done: true, doneReason: `RSVP ${action.response}`, updatedAt: new Date() }).where(eq(threadStateTable.threadId, link.threadId));
  return toApiEvent(updated!);
}

async function freeBusy(ctx: Ctx, from: string, to: string): Promise<FreeBusyResponse> {
  if (ctx.mailbox.source === "sample") {
    const rows = await ctx.db
      .select()
      .from(eventsTable)
      .where(and(eq(eventsTable.mailboxId, ctx.mailbox.id), ne(eventsTable.status, "cancelled"), lte(eventsTable.start, new Date(to)), gte(eventsTable.end, new Date(from))));
    return { busy: rows.map((e) => ({ start: e.start.toISOString(), end: e.end.toISOString() })) };
  }
  if (!ctx.mailbox.calendarProvider) return { busy: [] };
  const calRows = await ctx.db.select().from(calendarsTable).where(and(eq(calendarsTable.mailboxId, ctx.mailbox.id), eq(calendarsTable.countsForAvailability, true), eq(calendarsTable.shown, true)));
  if (!calRows.length) return { busy: [] };
  const map = await getCalendarProvider(ctx.mailbox.calendarProvider).freeBusy(ctx, calRows.map((c) => c.providerId), from, to);
  return { busy: Object.values(map).flat() };
}

/** The calendar receipt demo: attempts to delete the most recently synced event. Null when nothing is synced yet. */
export async function calendarReceiptDemo(ctx: Ctx): Promise<import("./api-types.js").LedgerRow | null> {
  if (!ctx.mailbox.calendarProvider) return null;
  const [row] = await ctx.db
    .select({ event: eventsTable, calendar: calendarsTable })
    .from(eventsTable)
    .innerJoin(calendarsTable, eq(eventsTable.calendarId, calendarsTable.id))
    .where(eq(eventsTable.mailboxId, ctx.mailbox.id))
    .orderBy(desc(eventsTable.start))
    .limit(1);
  if (!row) return null;
  return getCalendarProvider(ctx.mailbox.calendarProvider).attemptDelete(ctx, row.calendar.providerId, row.event.providerId, "Rill never deletes a meeting from your calendar");
}

export const calendar: CalendarLayer = {
  patchEvent,
  async syncCalendar(ctx) {
    emit(ctx, { type: "calendar", phase: "start" });
    try {
      const result = ctx.mailbox.source === "sample" ? await syncCalendarSample(ctx) : await syncCalendarLive(ctx);
      emit(ctx, { type: "calendar", phase: "done", changed: result.events + result.cancelled });
      return result;
    } catch (e) {
      emit(ctx, { type: "calendar", phase: "error", error: String((e as Error).message ?? e) });
      throw e;
    }
  },
  windowFor,
  eventResponse,
  inviteFor,
  rsvp,
  freeBusy,
};
