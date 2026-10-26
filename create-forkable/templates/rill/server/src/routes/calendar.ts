import type { Context } from "hono";
import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import {
  AlreadyCancelled, EditNotAllowed, calendar, conferencing, contacts, getCalendarProvider, newId, schema, toApiCalendar, toApiEvent, writer,
  type CalendarPatchInput, type ConferencingResponse, type EventPatchInput, type ContactsResponse, type CreateEventInput, type CreateEventResponse, type FreeBusyRequest, type OfferTimesInput, type OfferTimesResponse, type ProposeTimeInput, type ProposeTimeResponse, type RsvpAction,
} from "@rill/core";
import type { AppEnv } from "../deps.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { detectedEngines } from "./engines.js";
import { loadMailboxCtx, loadThread, readJson, threadMessages, toThreadRecord } from "./lib.js";

export const calendarRoutes = new Hono<AppEnv>();

const zoneOf = (tz: string | null) => tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
/** "Thursday, Oct 29 at 2:00 PM" in the user's own zone, never the server's. */
function slotText(iso: string, tz: string | null): string {
  const d = new Date(iso);
  const timeZone = zoneOf(tz);
  return `${d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone })} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone })}`;
}
/** "Pacific Time" style label for the zone the times are written in. */
function tzLabel(tz: string | null): string {
  const timeZone = zoneOf(tz);
  return new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "long" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

function window(c: Context<AppEnv>): { from: string; to: string } {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (!from || !to) throw badRequest("from and to are required (ISO instants)");
  return { from, to };
}

calendarRoutes.get("/mailboxes/:id/calendar", async (c) => {
  const { ctx } = await loadMailboxCtx(c);
  const { from, to } = window(c);
  const result = await calendar.windowFor(ctx, from, to);
  return c.json({ ...result, syncing: false });
});

calendarRoutes.get("/mailboxes/:id/events/:eventId", async (c) => {
  const { ctx } = await loadMailboxCtx(c);
  const res = await calendar.eventResponse(ctx, c.req.param("eventId"));
  if (!res) throw notFound("Event");
  return c.json(res);
});

/** Meeting prep is a writer call (seconds), so it is its own request: the event card never waits on it. */
calendarRoutes.get("/mailboxes/:id/events/:eventId/prep", async (c) => {
  const { ctx, mailbox, db } = await loadMailboxCtx(c);
  const res = await calendar.eventResponse(ctx, c.req.param("eventId"));
  if (!res) throw notFound("Event");
  if (res.event.status === "cancelled" || res.event.attendees.filter((a) => !a.self).length === 0) return c.json(null);
  const w = await writer.pickWriter(ctx, await detectedEngines(c.get("deps"), ctx.user.id)).catch(() => null);
  if (!w) return c.json(null);
  const vips = await db.select().from(schema.vips).where(eq(schema.vips.mailboxId, mailbox.id));
  const attendees = await Promise.all(res.event.attendees.filter((a) => !a.self).map(async (a) => {
    const email = a.email.toLowerCase();
    const vip = vips.find((v) => (v.matchKind === "address" && v.match.toLowerCase() === email) || (v.matchKind === "domain" && email.endsWith(`@${v.match.toLowerCase().replace(/^@/, "")}`)));
    const threads = await db
      .select({ threadId: schema.threads.gmailId, subject: schema.threads.subject, lastMessageAt: schema.threads.lastMessageAt })
      .from(schema.messages)
      .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
      .where(and(eq(schema.messages.mailboxId, mailbox.id), eq(schema.messages.fromEmail, email)))
      .orderBy(desc(schema.threads.lastMessageAt))
      .limit(3);
    const lastThread = threads[0] ? { threadId: threads[0].threadId, subject: threads[0].subject, lastMessageAt: threads[0].lastMessageAt.toISOString() } : null;
    return { name: a.name, email: a.email, vip: vip ? { name: vip.name, tier: vip.tier } : null, lastThread, recentSubjects: threads.map((t) => t.subject) };
  }));
  const related = res.event.relatedThreads[0];
  const state = related ? (await db.select({ goalId: schema.threadState.goalId }).from(schema.threadState).where(eq(schema.threadState.threadId, `${mailbox.id}:${related.threadId}`)).limit(1))[0] : undefined;
  const goalRow = state?.goalId ? (await db.select().from(schema.goals).where(eq(schema.goals.id, state.goalId)).limit(1))[0] : null;
  const prep = await writer.prep(ctx, w, { title: res.event.title, start: res.event.start, attendees, goal: goalRow ? { id: goalRow.id, title: goalRow.title } : null });
  return c.json(prep);
});

calendarRoutes.post("/mailboxes/:id/events/:eventId/rsvp", async (c) => {
  const { ctx } = await loadMailboxCtx(c);
  const action = await readJson<RsvpAction>(c);
  if (!action || !["accepted", "declined", "tentative"].includes(action.response)) throw badRequest("response must be accepted, declined or tentative");
  const event = await calendar.rsvp(ctx, c.req.param("eventId"), action);
  return c.json(event);
});

calendarRoutes.patch("/mailboxes/:id/events/:eventId", async (c) => {
  const { ctx } = await loadMailboxCtx(c);
  const input = await readJson<EventPatchInput>(c);
  if (input.notify !== undefined && input.notify !== "all" && input.notify !== "none") throw badRequest("notify must be all or none");
  if (input.status !== undefined && input.status !== "cancelled") throw badRequest("status can only be cancelled");
  try {
    return c.json(await calendar.patchEvent(ctx, c.req.param("eventId"), input));
  } catch (e) {
    if (e instanceof EditNotAllowed) throw forbidden(e.message);
    if (e instanceof AlreadyCancelled) throw conflict(e.message);
    if (e instanceof Error && /not found/.test(e.message)) throw notFound("Event");
    if (e instanceof Error && /end must be after start|not connected|not wired/.test(e.message)) throw badRequest(e.message);
    throw e;
  }
});

calendarRoutes.put("/mailboxes/:id/calendars/:calendarId", async (c) => {
  const { mailbox, db } = await loadMailboxCtx(c);
  const input = await readJson<CalendarPatchInput>(c);
  const patch: Partial<typeof schema.calendars.$inferInsert> = {};
  if (input.shown !== undefined) patch.shown = input.shown;
  if (input.countsForAvailability !== undefined) patch.countsForAvailability = input.countsForAvailability;
  if (input.color !== undefined) patch.color = input.color;
  if (input.isDefault) {
    await db.update(schema.calendars).set({ isDefault: false }).where(eq(schema.calendars.mailboxId, mailbox.id));
    patch.isDefault = true;
  }
  const [row] = await db.update(schema.calendars).set(patch).where(and(eq(schema.calendars.id, c.req.param("calendarId")), eq(schema.calendars.mailboxId, mailbox.id))).returning();
  if (!row) throw notFound("Calendar");
  return c.json(toApiCalendar(row));
});

calendarRoutes.post("/mailboxes/:id/freebusy", async (c) => {
  const { ctx } = await loadMailboxCtx(c);
  const { from, to } = await readJson<FreeBusyRequest>(c);
  if (!from || !to) throw badRequest("from and to are required (ISO instants)");
  return c.json(await calendar.freeBusy(ctx, from, to));
});

// ---- Phase B: offer times, book it, propose a new time -------------------------

calendarRoutes.post("/mailboxes/:id/threads/:threadId/offer-times", async (c) => {
  const { ctx } = await loadMailboxCtx(c);
  const input = await readJson<OfferTimesInput>(c);
  if (!input.slots?.length) throw badRequest("slots is required");
  const busy = new Set<string>();
  for (const s of input.slots) {
    const fb = await calendar.freeBusy(ctx, s.start, s.end);
    if (fb.busy.some((b) => b.start < s.end && b.end > s.start)) busy.add(`${s.start}|${s.end}`);
  }
  const stillFree = busy.size === 0;
  const lines = input.slots
    .filter((s) => !busy.has(`${s.start}|${s.end}`))
    .map((s) => {
      return slotText(s.start, ctx.settings.timezone);
    });
  const zone = tzLabel(ctx.settings.timezone);
  const text = lines.length ? `I'm free ${lines.join(", or ")} (${zone}).` : "Those times are no longer free on my end. Let me offer new ones.";
  const body: OfferTimesResponse = { text, recipientTimeZone: null, stillFree };
  return c.json(body);
});

calendarRoutes.post("/mailboxes/:id/events", async (c) => {
  const { ctx, mailbox, db } = await loadMailboxCtx(c);
  if (!mailbox.calendarProvider) throw badRequest("Connect a calendar first");
  const input = await readJson<CreateEventInput>(c);
  if (!input.title || !input.start || !input.end || !input.timeZone) throw badRequest("title, start, end and timeZone are required");
  const [cal] = await db.select().from(schema.calendars).where(and(eq(schema.calendars.mailboxId, mailbox.id), input.calendarId ? eq(schema.calendars.id, input.calendarId) : eq(schema.calendars.isDefault, true))).limit(1);
  if (!cal) throw notFound("Calendar");
  const offer = await conferencing.available(ctx);
  const wanted = input.conferencing ?? null;
  if (wanted && !offer.available.includes(wanted)) throw badRequest(`${wanted} is not connected`);
  // Zoom is its own connection: make the meeting first, then the calendar event carries its link.
  const link = wanted === "zoom" ? await conferencing.createZoomMeeting(ctx, { title: input.title, start: input.start, end: input.end, timeZone: input.timeZone, agenda: input.description }) : null;
  const created = await getCalendarProvider(mailbox.calendarProvider).createEvent(ctx, cal.providerId, {
    title: input.title, description: input.description, start: input.start, end: input.end, timeZone: input.timeZone, attendees: input.attendees, attendeeNames: input.attendeeNames, conferencing: wanted, link,
  });
  const id = `${cal.id}:${created.id}`;
  await db.insert(schema.events).values({
    id, providerId: created.id, calendarId: cal.id, mailboxId: mailbox.id, iCalUid: created.iCalUID, recurringEventId: created.recurringEventId,
    title: created.title, description: created.description, location: created.location, start: new Date(created.start), end: new Date(created.end), timeZone: created.timeZone,
    allDay: created.allDay, status: created.status, organizer: created.organizer, attendees: created.attendees, joinUrl: created.joinUrl, myResponse: created.myResponse, updated: new Date(),
  }).onConflictDoNothing();

  let confirmationDraftId: string | null = null;
  if (input.fromThreadId) {
    try {
      const thread = await loadThread(db, mailbox.id, input.fromThreadId);
      const msgs = await threadMessages(db, thread.id);
      const w = await writer.pickWriter(ctx, await detectedEngines(c.get("deps"), ctx.user.id));
      if (w && msgs.length) {
        const latest = msgs[msgs.length - 1]!;
        const draft = await writer.draft(ctx, w, {
          mail: { id: latest.gmailId, threadId: thread.gmailId, from: { name: latest.fromName, email: latest.fromEmail }, to: latest.to, cc: latest.cc, date: latest.date.toISOString(), subject: latest.subject, body: latest.body, hiddenText: "", snippet: latest.snippet, labelIds: latest.labelIds, isFromMe: latest.isFromMe },
          thread: toThreadRecord(thread, msgs),
          me: ctx.settings.me ?? "",
          person: { name: latest.fromName, email: latest.fromEmail, vipName: null, tier: null, recentSubjects: [] },
          goal: null,
          instructions: `Confirm the meeting "${created.title}" is booked for ${created.start}. You may say it is booked, since it really was just now created.`,
        });
        const [row] = await db.insert(schema.drafts).values({
          id: newId("draft"), threadId: thread.id, mailboxId: mailbox.id, replyToMessageId: latest.id, to: [latest.fromEmail],
          subject: /^re:/i.test(latest.subject) ? latest.subject : `Re: ${latest.subject}`, body: draft.body, engine: w.engine, model: w.model, validator: draft.validator,
        }).returning();
        confirmationDraftId = row?.id ?? null;
      }
    } catch {
      // Book it still succeeded; the confirmation draft is a nicety.
    }
  }
  const eventRow = (await db.select().from(schema.events).where(eq(schema.events.id, id)))[0]!;
  const response: CreateEventResponse = { event: toApiEvent(eventRow), confirmationDraftId };
  return c.json(response, 201);
});

calendarRoutes.post("/mailboxes/:id/threads/:threadId/propose-time", async (c) => {
  const { ctx, mailbox, db } = await loadMailboxCtx(c);
  const input = await readJson<ProposeTimeInput>(c);
  if (!input.slots?.length) throw badRequest("slots is required");
  const thread = await loadThread(db, mailbox.id, input.threadId);
  const msgs = await threadMessages(db, thread.id);
  const latest = msgs[msgs.length - 1];
  if (!latest) throw notFound("A message to reply to");
  const w = await writer.pickWriter(ctx, await detectedEngines(c.get("deps"), ctx.user.id));
  if (!w) throw badRequest("No writer is available. Pick an engine in Settings.");
  const lines = input.slots.map((s) => slotText(s.start, ctx.settings.timezone));
  const draft = await writer.draft(ctx, w, {
    mail: { id: latest.gmailId, threadId: thread.gmailId, from: { name: latest.fromName, email: latest.fromEmail }, to: latest.to, cc: latest.cc, date: latest.date.toISOString(), subject: latest.subject, body: latest.body, hiddenText: "", snippet: latest.snippet, labelIds: latest.labelIds, isFromMe: latest.isFromMe },
    thread: toThreadRecord(thread, msgs),
    me: ctx.settings.me ?? "",
    person: { name: latest.fromName, email: latest.fromEmail, vipName: null, tier: null, recentSubjects: [] },
    goal: null,
    instructions: `Propose a new time for this meeting instead of the one offered: ${lines.join(", or ")}.`,
  });
  const [row] = await db.insert(schema.drafts).values({
    id: newId("draft"), threadId: thread.id, mailboxId: mailbox.id, replyToMessageId: latest.id, to: [latest.fromEmail],
    subject: /^re:/i.test(latest.subject) ? latest.subject : `Re: ${latest.subject}`, body: draft.body, engine: w.engine, model: w.model, validator: draft.validator,
  }).returning();
  const body: ProposeTimeResponse = { draftId: row!.id };
  return c.json(body);
});

calendarRoutes.get("/mailboxes/:id/conferencing", async (c) => {
  const { ctx } = await loadMailboxCtx(c);
  const body: ConferencingResponse = await conferencing.available(ctx);
  return c.json(body);
});

calendarRoutes.get("/mailboxes/:id/contacts", async (c) => {
  const { mailbox, db } = await loadMailboxCtx(c);
  const limit = Math.min(20, Math.max(1, Number(c.req.query("limit") ?? 8) || 8));
  const signals = await contacts.contactSignals(db, mailbox.id);
  const body: ContactsResponse = { contacts: contacts.rankContacts(signals, { q: c.req.query("q") ?? "", self: mailbox.address ?? "", limit }) };
  return c.json(body);
});
