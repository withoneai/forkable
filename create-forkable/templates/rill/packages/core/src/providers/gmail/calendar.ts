import type { Ctx, CalendarProvider } from "../../contract.js";
import { one } from "../../one.js";
import type { CalendarEvent, CalendarRecord, FreeBusySlot, RsvpResponse } from "../../types.js";
import { linkBlock } from "../../conferencing.js";
import { calendarFromGoogle, eventFromGoogle, freeBusyFromGoogle, type GCalEvent, type GCalListEntry } from "./calendarMappers.js";

// The Google Calendar CalendarProvider. Action ids are the One catalog's
// (found 2026-10-22 with `one --agent actions find google-calendar ...`,
// never executed outside a real grant). Every call goes through one.call, so
// the ledger and the 403 receipt work the same way Gmail's do. Sample
// mailboxes never reach this file: packages/core/src/calendar.ts (the glue)
// reads fixtures/calendar.json directly for sync, the same way sync.ts does
// for mail; this provider's own fixture closures below exist so the
// interface stays type-correct and testable in isolation.

export const CALENDAR_ACTIONS = {
  calendarList: { id: "conn_mod_def::GJ6Rk8ghCfI::FsO0bmOYSHOsPSIvrcOZxQ", method: "GET", path: "/users/me/calendarList" },
  eventsList: { id: "conn_mod_def::GJ6RlnIYK20::YzuWSmaVQgurletRDNJavA", method: "GET", path: "/calendars/{{calendarId}}/events" },
  eventsGet: { id: "conn_mod_def::GJ6RlPEQKQw::rxHzaO_TTtKVIcxgFrWUKA", method: "GET", path: "/calendar/v3/calendars/{{calendarId}}/events/{{eventId}}" },
  eventsInstances: { id: "conn_mod_def::GJ6RlnP3LOc::4ImRHRcFSBm2s5L-QqwFlg", method: "GET", path: "/v3/calendars/{{calendarId}}/events/{{eventId}}/instances" },
  eventsInsert: { id: "conn_mod_def::GJ6RlnjZAh4::CSya4eHtRbeXRM7PHiXuRA", method: "POST", path: "/v3/calendars/{{calendarId}}/events" },
  eventsPatch: { id: "conn_mod_def::GJ6RlmhNiKo::48w5XxsbRx24lge7XAzN_w", method: "PATCH", path: "/calendar/v3/calendars/{{calendarId}}/events/{{eventId}}" },
  eventsDelete: { id: "conn_mod_def::GJ6RlN24ctU::0y6GOBuWT4ShfvJCjD3vRw", method: "DELETE", path: "/calendar/v3/calendars/{{calendarId}}/events/{{eventId}}" },
  freeBusy: { id: "conn_mod_def::GJ6Rlvk1bgM::h5exn4dzTkyhjoA89wddmQ", method: "POST", path: "/freeBusy" },
  eventsWatch: { id: "conn_mod_def::GJ6Rlzrfb_k::Oi-ZtyZ3See3CXbl6lQ6Ww", method: "POST", path: "/calendar/v3/calendars/{{calendarId}}/events/watch" },
  channelsStop: { id: "conn_mod_def::GJ6RlNlVxE8::8J4tSlqIS4Sa3zgS9gLU8w", method: "POST", path: "/channels/stop" },
} as const;

const selfEmailOf = (ctx: Ctx) => (ctx.mailbox.address ?? "").toLowerCase();

function syntheticEvent(calendarId: string, eventId: string, selfEmail: string, patch: Partial<GCalEvent> = {}): GCalEvent {
  return {
    id: eventId,
    summary: "(sample event)",
    start: { dateTime: new Date().toISOString() },
    end: { dateTime: new Date(Date.now() + 30 * 60_000).toISOString() },
    status: "confirmed",
    attendees: [{ email: selfEmail, self: true, responseStatus: "needsAction" }],
    updated: new Date().toISOString(),
    ...patch,
  };
}

export const googleCalendar: CalendarProvider = {
  platform: "google-calendar",
  verified: true,
  capabilities: { rsvp: true, create: true, patch: true, freeBusy: true, watch: true },

  async listCalendars(ctx) {
    return one.call<{ items?: GCalListEntry[] }, CalendarRecord[]>(ctx, {
      platform: "google-calendar",
      action: "calendarList",
      level: "read",
      actionId: CALENDAR_ACTIONS.calendarList.id,
      method: CALENDAR_ACTIONS.calendarList.method,
      path: CALENDAR_ACTIONS.calendarList.path,
      summary: "List your calendars",
      fixture: () => [{ id: "primary", name: selfEmailOf(ctx), color: null, isDefault: true, accessRole: "owner" }],
      pick: (d) => (d?.items ?? []).map(calendarFromGoogle).filter((c): c is CalendarRecord => c !== null),
    });
  },

  async listEvents(ctx, calendarId, opts) {
    return one.call<{ items?: GCalEvent[] }, { events: CalendarEvent[] }>(ctx, {
      platform: "google-calendar",
      action: "events-list",
      level: "read",
      actionId: CALENDAR_ACTIONS.eventsList.id,
      method: CALENDAR_ACTIONS.eventsList.method,
      path: CALENDAR_ACTIONS.eventsList.path,
      pathParams: { calendarId },
      query: { timeMin: opts.from, timeMax: opts.to, singleEvents: "true", orderBy: "startTime", maxResults: "250" },
      summary: `Read ${calendarId} for the week`,
      fixture: () => ({ events: [] }),
      pick: (d) => ({ events: (d?.items ?? []).map((e) => eventFromGoogle(e, calendarId, selfEmailOf(ctx))).filter((e): e is CalendarEvent => e !== null) }),
    });
  },

  async getEvent(ctx, calendarId, eventId) {
    const selfEmail = selfEmailOf(ctx);
    return one.call<GCalEvent, CalendarEvent | null>(ctx, {
      platform: "google-calendar",
      action: "events-get",
      level: "read",
      actionId: CALENDAR_ACTIONS.eventsGet.id,
      method: CALENDAR_ACTIONS.eventsGet.method,
      path: CALENDAR_ACTIONS.eventsGet.path,
      pathParams: { calendarId, eventId },
      summary: `Read event ${eventId}`,
      fixture: () => eventFromGoogle(syntheticEvent(calendarId, eventId, selfEmail), calendarId, selfEmail),
      pick: (d) => eventFromGoogle(d, calendarId, selfEmail),
    });
  },

  async rsvp(ctx, calendarId, eventId, response, note) {
    // Google replaces the whole `attendees` array on patch: read the event first,
    // flip the signed-in user's own entry, send the full list back.
    const current = await googleCalendar.getEvent(ctx, calendarId, eventId);
    const selfEmail = selfEmailOf(ctx);
    const attendees = (current?.attendees ?? [{ name: null, email: selfEmail, self: true, organizer: false, response: "needsAction" as RsvpResponse }]).map((a) =>
      a.email.toLowerCase() === selfEmail ? { ...a, response } : a,
    );
    return one.call<GCalEvent, CalendarEvent>(ctx, {
      platform: "google-calendar",
      action: "events-patch",
      level: "write",
      actionId: CALENDAR_ACTIONS.eventsPatch.id,
      method: CALENDAR_ACTIONS.eventsPatch.method,
      path: CALENDAR_ACTIONS.eventsPatch.path,
      pathParams: { calendarId, eventId },
      body: {
        attendees: attendees.map((a) => ({ email: a.email, displayName: a.name ?? undefined, self: a.self, organizer: a.organizer, responseStatus: a.response, comment: a.email.toLowerCase() === selfEmail ? note : undefined })),
      },
      summary: `RSVP ${response} to ${current?.title ?? eventId}`,
      fixture: () => eventFromGoogle(syntheticEvent(calendarId, eventId, selfEmail, { attendees: attendees.map((a) => ({ email: a.email, self: a.self, responseStatus: a.response })) }), calendarId, selfEmail) ?? syntheticEventFallback(calendarId, eventId, selfEmail, response),
      pick: (d) => eventFromGoogle(d, calendarId, selfEmail) ?? syntheticEventFallback(calendarId, eventId, selfEmail, response),
    });
  },

  async createEvent(ctx, calendarId, input) {
    const meet = input.conferencing === "google-meet";
    // A Zoom (or any third-party) link rides in location and description, where every
    // calendar client shows it; the mapper reads it back out as joinUrl.
    const description = input.link ? [input.description, linkBlock(input.link)].filter(Boolean).join("\n\n") : input.description;
    const body: Record<string, unknown> = {
      summary: input.title,
      description,
      location: input.location ?? input.link?.url,
      start: { dateTime: input.start, timeZone: input.timeZone },
      end: { dateTime: input.end, timeZone: input.timeZone },
      attendees: input.attendees.map((email) => ({ email, displayName: input.attendeeNames?.[email] })),
    };
    if (meet) body.conferenceData = { createRequest: { requestId: `rill-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } };
    return one.call<GCalEvent, CalendarEvent>(ctx, {
      platform: "google-calendar",
      action: "events-insert",
      level: "write",
      actionId: CALENDAR_ACTIONS.eventsInsert.id,
      method: CALENDAR_ACTIONS.eventsInsert.method,
      path: CALENDAR_ACTIONS.eventsInsert.path,
      pathParams: { calendarId },
      query: meet ? { conferenceDataVersion: "1" } : undefined,
      body,
      summary: `Create "${input.title}"`,
      fixture: () => eventFromGoogle(syntheticEvent(calendarId, `created-${Date.now()}`, selfEmailOf(ctx), { summary: input.title, description, location: input.location ?? input.link?.url, start: { dateTime: input.start, timeZone: input.timeZone }, end: { dateTime: input.end, timeZone: input.timeZone }, organizer: { email: selfEmailOf(ctx) }, attendees: [{ email: selfEmailOf(ctx), self: true, organizer: true, responseStatus: "accepted" }, ...input.attendees.map((email) => ({ email, displayName: input.attendeeNames?.[email], responseStatus: "needsAction" }))], hangoutLink: meet ? "https://meet.google.com/sample-rill" : undefined }), calendarId, selfEmailOf(ctx)) ?? syntheticEventFallback(calendarId, "created", selfEmailOf(ctx), "accepted"),
      pick: (d) => eventFromGoogle(d, calendarId, selfEmailOf(ctx)) ?? syntheticEventFallback(calendarId, "created", selfEmailOf(ctx), "accepted"),
    });
  },

  async patchEvent(ctx, calendarId, eventId, patch) {
    const self = selfEmailOf(ctx);
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.summary = patch.title;
    if (patch.description !== undefined) body.description = patch.description ?? "";
    if (patch.location !== undefined) body.location = patch.location ?? "";
    if (patch.start !== undefined && patch.end !== undefined) {
      if (patch.allDay) {
        body.start = { date: patch.start.slice(0, 10), timeZone: patch.timeZone };
        body.end = { date: patch.end.slice(0, 10), timeZone: patch.timeZone };
      } else {
        body.start = { dateTime: patch.start, timeZone: patch.timeZone };
        body.end = { dateTime: patch.end, timeZone: patch.timeZone };
      }
    }
    if (patch.attendees !== undefined) body.attendees = patch.attendees.map((a) => ({ email: a.email, displayName: a.name ?? undefined, responseStatus: a.response, self: a.self || undefined, organizer: a.organizer || undefined }));
    if (patch.status === "cancelled") body.status = "cancelled";
    const query: Record<string, string> = {};
    if (patch.notify) query.sendUpdates = patch.notify;
    if (patch.conferencing === "google-meet") {
      body.conferenceData = { createRequest: { requestId: `rill-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } };
      query.conferenceDataVersion = "1";
    } else if (patch.conferencing === null) {
      body.conferenceData = null;
      query.conferenceDataVersion = "1";
    }
    const cur = patch.current;
    // The fixture is the event as Rill has it with the patch applied, so the sample behaves like a calendar that accepted the change.
    const fixtureEvent = (): CalendarEvent => ({
      ...cur,
      title: patch.title ?? cur.title,
      description: patch.description !== undefined ? patch.description : cur.description,
      location: patch.location !== undefined ? patch.location : cur.location,
      start: patch.start ?? cur.start, end: patch.end ?? cur.end, timeZone: patch.timeZone ?? cur.timeZone, allDay: patch.allDay ?? cur.allDay,
      attendees: patch.attendees ?? cur.attendees,
      status: patch.status ?? cur.status,
      joinUrl: patch.conferencing === "google-meet" ? "https://meet.google.com/sample-rill" : patch.conferencing === null ? (patch.link?.url ?? null) : cur.joinUrl,
      updated: new Date().toISOString(),
    });
    return one.call<GCalEvent, CalendarEvent>(ctx, {
      platform: "google-calendar",
      action: "events-patch",
      level: "write",
      actionId: CALENDAR_ACTIONS.eventsPatch.id,
      method: CALENDAR_ACTIONS.eventsPatch.method,
      path: CALENDAR_ACTIONS.eventsPatch.path,
      pathParams: { calendarId, eventId },
      query: Object.keys(query).length ? query : undefined,
      body,
      summary: patch.status === "cancelled" ? `Cancel "${cur.title}"` : `Update "${patch.title ?? cur.title}"`,
      fixture: fixtureEvent,
      pick: (d) => eventFromGoogle(d, calendarId, self) ?? fixtureEvent(),
    });
  },

  async freeBusy(ctx, calendarIds, from, to) {
    return one.call<{ calendars?: Record<string, { busy?: { start?: string; end?: string }[] }> }, Record<string, FreeBusySlot[]>>(ctx, {
      platform: "google-calendar",
      action: "freebusy",
      level: "read",
      actionId: CALENDAR_ACTIONS.freeBusy.id,
      method: CALENDAR_ACTIONS.freeBusy.method,
      path: CALENDAR_ACTIONS.freeBusy.path,
      body: { timeMin: from, timeMax: to, items: calendarIds.map((id) => ({ id })) },
      summary: "Check free/busy",
      fixture: () => Object.fromEntries(calendarIds.map((id) => [id, []])) as Record<string, FreeBusySlot[]>,
      pick: (d) => freeBusyFromGoogle(d ?? {}),
    });
  },

  async attemptDelete(ctx, calendarId, eventId, note) {
    const { row } = await one.attempt<unknown>(ctx, {
      platform: "google-calendar",
      action: "events-delete",
      level: "write",
      actionId: CALENDAR_ACTIONS.eventsDelete.id,
      method: CALENDAR_ACTIONS.eventsDelete.method,
      path: CALENDAR_ACTIONS.eventsDelete.path,
      pathParams: { calendarId, eventId },
      summary: note,
      fixture: () => null,
    });
    return row;
  },

  async watch(ctx, calendarId, webhookUrl) {
    return one.call<{ id?: string; resourceId?: string; expiration?: string }, { channelId: string; resourceId?: string; expiresAt: string }>(ctx, {
      platform: "google-calendar",
      action: "events-watch",
      level: "read",
      actionId: CALENDAR_ACTIONS.eventsWatch.id,
      method: CALENDAR_ACTIONS.eventsWatch.method,
      path: CALENDAR_ACTIONS.eventsWatch.path,
      pathParams: { calendarId },
      body: { id: `rill-${calendarId}-${Date.now()}`, type: "web_hook", address: webhookUrl },
      summary: `Watch ${calendarId} for changes`,
      fixture: () => ({ channelId: "fixture-channel", expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() }),
      pick: (d) => ({ channelId: d?.id ?? "unknown", resourceId: d?.resourceId, expiresAt: new Date(Number(d?.expiration ?? Date.now())).toISOString() }),
    });
  },

  async stopWatch(ctx, channelId, resourceId) {
    await one.call<unknown, void>(ctx, {
      platform: "google-calendar",
      action: "channels-stop",
      level: "write",
      actionId: CALENDAR_ACTIONS.channelsStop.id,
      method: CALENDAR_ACTIONS.channelsStop.method,
      path: CALENDAR_ACTIONS.channelsStop.path,
      body: { id: channelId, resourceId },
      summary: `Stop watch channel ${channelId}`,
      fixture: () => undefined,
      pick: () => undefined,
    });
  },
};

function syntheticEventFallback(calendarId: string, eventId: string, selfEmail: string, response: RsvpResponse): CalendarEvent {
  const now = new Date();
  return {
    id: eventId,
    iCalUID: null,
    recurringEventId: null,
    calendarId,
    title: "(event)",
    description: null,
    location: null,
    start: now.toISOString(),
    end: new Date(now.getTime() + 30 * 60_000).toISOString(),
    timeZone: null,
    allDay: false,
    status: "confirmed",
    organizer: null,
    attendees: [{ name: null, email: selfEmail, self: true, organizer: false, response }],
    joinUrl: null,
    myResponse: response,
    updated: now.toISOString(),
  };
}
