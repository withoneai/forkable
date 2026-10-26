import type { Ctx, CalendarProvider, EventPatch } from "../../contract.js";
import { linkBlock, providerOf } from "../../conferencing.js";
import { one } from "../../one.js";
import type { CalendarEvent, CalendarRecord, FreeBusySlot, RsvpResponse } from "../../types.js";
import { calendarFromGraph, eventFromGraph, freeBusyFromGraph, graphTime, type GraphCalendar, type GraphEvent, type GraphScheduleInformation } from "./calendarMappers.js";

// The Outlook Calendar CalendarProvider (Microsoft Graph, through One's
// `outlook-calendar` platform). Every action id below was read from the One
// catalog with `one --agent actions find/load outlook-calendar ...` on
// 2026-10-23 and matches its documented method and path. Fixture-verified
// only (packages/core/scripts/smoke-outlook.ts); no real grant has run it yet.
//
// Where Graph differs from Google Calendar, on purpose:
// - RSVP and cancel are verb actions (accept, tentativelyAccept, decline,
//   cancel) with PascalCase parameters (`SendResponse`, `Comment`), not a
//   patch of the attendee list or of `status`.
// - An organizer's cancel is its own action: Graph sends the guests a
//   cancellation and moves the event to Deleted Items. It is not a delete
//   (delete stays outside the grant, the 403 receipt), and there is no quiet
//   version of it.
// - Graph's event PATCH has no sendUpdates switch: Outlook itself tells the
//   guests of a meeting you organize about a change, so `notify` is not sent.
//   The UI says so before the keypress.
// - Teams is made by setting isOnlineMeeting; the catalog notes Outlook ignores
//   any later change to it, so a Teams link cannot be taken off from here.
// - getSchedule answers per SMTP address, not per calendar.

export const OUTLOOK_CALENDAR_ACTIONS = {
  calendars: { id: "conn_mod_def::GMIY1FxtnJw::naghBU_mSTKsg0Lv46gF1w", method: "GET", path: "/v1.0/me/calendars" },
  calendarView: { id: "conn_mod_def::GJ58LPpX-M4::e4__fu-6SUK_WBT15hJPoQ", method: "GET", path: "/users/{{userId}}/calendars/{{calendarId}}/calendarView" },
  eventsGet: { id: "conn_mod_def::GMIY1Ut6_5I::obpJ0K6KQLeDXH7pylwnnA", method: "GET", path: "/v1.0/me/calendars/{{calendarId}}/events/{{eventId}}" },
  eventsInsert: { id: "conn_mod_def::GMIYzzLtyCs::pxfz0Zs8RAOgUEAaupZnwQ", method: "POST", path: "/v1.0/me/calendars/{{calendarId}}/events" },
  eventsPatch: { id: "conn_mod_def::GMIY4VeTZko::hZ-fygB-SKG-v62mbL9Q4A", method: "PATCH", path: "/v1.0/me/calendars/{{calendarId}}/events/{{eventId}}" },
  eventsCancel: { id: "conn_mod_def::GMIY2iX6VWo::PKMpKfnYSc--zC-KNUrxZg", method: "POST", path: "/v1.0/me/calendars/{{calendarId}}/events/{{eventId}}/microsoft.graph.cancel" },
  accept: { id: "conn_mod_def::GMIY2cTKoZQ::6Ad3ITA7TceVX2rwD20liw", method: "POST", path: "/v1.0/me/calendars/{{calendarId}}/events/{{eventId}}/microsoft.graph.accept" },
  tentativelyAccept: { id: "conn_mod_def::GMIY3h5hWBg::TaB9FQDbTrajyJOIM_Ui8g", method: "POST", path: "/v1.0/me/calendars/{{calendarId}}/events/{{eventId}}/microsoft.graph.tentativelyAccept" },
  decline: { id: "conn_mod_def::GMIY23ekoXk::KJRqXy5bRe665p0W1lQ1zw", method: "POST", path: "/v1.0/me/calendars/{{calendarId}}/events/{{eventId}}/microsoft.graph.decline" },
  getSchedule: { id: "conn_mod_def::GMIY3HWTwYM::wFSj8jG2QUm8a7Kwqg3V4w", method: "POST", path: "/v1.0/me/calendar/microsoft.graph.getSchedule" },
  eventsDelete: { id: "conn_mod_def::GJ58Ko4_2AA::Q2rSSZEERHKLX7is1w_8Ng", method: "DELETE", path: "/users/{{userId}}/calendars/{{calendarId}}/events/{{eventId}}" },
  subscriptionsCreate: { id: "conn_mod_def::GL-UqszYiaA::j_GK5FFxSNCkhTfCnEtzBA", method: "POST", path: "/v1.0/subscriptions" },
  subscriptionsDelete: { id: "conn_mod_def::GL-Uquoca4A::ZFSQGF6-QfeF6lZ6y1BPUw", method: "DELETE", path: "/v1.0/subscriptions/{{subscriptionId}}" },
} as const;

const A = OUTLOOK_CALENDAR_ACTIONS;
const selfEmailOf = (ctx: Ctx) => (ctx.mailbox.address ?? "").toLowerCase();
const RSVP_ACTION = { accepted: "accept", tentative: "tentativelyAccept", declined: "decline" } as const;
const TEAMS = "teamsForBusiness";

function attendeesBody(list: { email: string; name?: string | null }[]) {
  return list.map((a) => ({ emailAddress: { address: a.email, ...(a.name ? { name: a.name } : {}) }, type: "required" }));
}

/** The event as Rill has it with the patch applied: the sample's answer, and the fallback when Graph answers without a body. */
function applied(cur: CalendarEvent, patch: EventPatch): CalendarEvent {
  return {
    ...cur,
    title: patch.title ?? cur.title,
    description: patch.description !== undefined ? patch.description : cur.description,
    location: patch.location !== undefined ? patch.location : cur.location,
    start: patch.start ?? cur.start, end: patch.end ?? cur.end, timeZone: patch.timeZone ?? cur.timeZone, allDay: patch.allDay ?? cur.allDay,
    attendees: patch.attendees ?? cur.attendees,
    status: patch.status ?? cur.status,
    joinUrl: patch.conferencing === "teams" ? "https://teams.microsoft.com/l/meetup-join/sample-rill" : patch.conferencing === null ? (patch.link?.url ?? null) : cur.joinUrl,
    updated: new Date().toISOString(),
  };
}

function fallback(calendarId: string, eventId: string, selfEmail: string, response: RsvpResponse): CalendarEvent {
  const now = new Date().toISOString();
  return { id: eventId, iCalUID: null, recurringEventId: null, calendarId, title: "(event)", description: null, location: null, start: now, end: now, timeZone: null, allDay: false, status: "confirmed", organizer: null, attendees: [{ name: null, email: selfEmail, self: true, organizer: false, response }], joinUrl: null, myResponse: response, updated: now };
}

export const outlookCalendar: CalendarProvider = {
  platform: "outlook-calendar",
  verified: false,
  capabilities: { rsvp: true, create: true, patch: true, freeBusy: true, watch: true },

  async listCalendars(ctx) {
    return one.call<{ value?: GraphCalendar[] }, CalendarRecord[]>(ctx, {
      platform: "outlook-calendar",
      action: "calendars",
      level: "read",
      actionId: A.calendars.id,
      method: A.calendars.method,
      path: A.calendars.path,
      summary: "List your Outlook calendars",
      fixture: () => [{ id: "primary", name: selfEmailOf(ctx), color: null, isDefault: true, accessRole: "owner" }],
      pick: (d) => (d?.value ?? []).map(calendarFromGraph).filter((c): c is CalendarRecord => c !== null),
    });
  },

  async listEvents(ctx, calendarId, opts) {
    const self = selfEmailOf(ctx);
    const events: CalendarEvent[] = [];
    let skip = 0;
    // calendarView expands recurring series into single instances, the way Google's singleEvents does; pages ride on $skip.
    for (let page = 0; page < 10; page++) {
      const res = await one.call<{ value?: GraphEvent[]; "@odata.nextLink"?: string }, { events: CalendarEvent[]; more: boolean }>(ctx, {
        platform: "outlook-calendar",
        action: "calendarView",
        level: "read",
        actionId: A.calendarView.id,
        method: A.calendarView.method,
        path: A.calendarView.path,
        pathParams: { userId: "me", calendarId },
        query: { startDateTime: opts.from, endDateTime: opts.to, $top: "100", ...(skip ? { $skip: String(skip) } : {}) },
        summary: `Read ${calendarId} for the week`,
        fixture: () => ({ events: [], more: false }),
        pick: (d) => ({ events: (d?.value ?? []).map((e) => eventFromGraph(e, calendarId, self)).filter((e): e is CalendarEvent => e !== null), more: Boolean(d?.["@odata.nextLink"]) }),
      });
      events.push(...res.events);
      if (!res.more || res.events.length === 0) break;
      skip += res.events.length;
    }
    return { events };
  },

  async getEvent(ctx, calendarId, eventId) {
    const self = selfEmailOf(ctx);
    return one.call<GraphEvent, CalendarEvent | null>(ctx, {
      platform: "outlook-calendar",
      action: "events-get",
      level: "read",
      actionId: A.eventsGet.id,
      method: A.eventsGet.method,
      path: A.eventsGet.path,
      pathParams: { calendarId, eventId },
      summary: `Read event ${eventId}`,
      fixture: () => null,
      pick: (d) => eventFromGraph(d, calendarId, self),
    });
  },

  async rsvp(ctx, calendarId, eventId, response, note) {
    const self = selfEmailOf(ctx);
    const verb = RSVP_ACTION[response as keyof typeof RSVP_ACTION];
    if (!verb) throw new Error(`Outlook has no RSVP for "${response}"`);
    const action = A[verb];
    await one.call<unknown, void>(ctx, {
      platform: "outlook-calendar",
      action: verb,
      level: "write",
      actionId: action.id,
      method: action.method,
      path: action.path,
      pathParams: { calendarId, eventId },
      body: { SendResponse: true, ...(note ? { Comment: note } : {}) },
      summary: `RSVP ${response} to event ${eventId}`,
      fixture: () => undefined,
      pick: () => undefined,
    });
    // accept/decline answer with no body; read the event back for the new state.
    const updated = await outlookCalendar.getEvent(ctx, calendarId, eventId).catch(() => null);
    if (!updated) return fallback(calendarId, eventId, self, response);
    return { ...updated, myResponse: response, attendees: updated.attendees.map((a) => (a.self ? { ...a, response } : a)) };
  },

  async createEvent(ctx, calendarId, input) {
    const self = selfEmailOf(ctx);
    const teams = input.conferencing === "teams";
    // A Zoom (or any third-party) link rides in location and description, where every client shows it; the mapper reads it back as joinUrl.
    const description = input.link ? [input.description, linkBlock(input.link)].filter(Boolean).join("\n\n") : input.description;
    const location = input.location ?? input.link?.url;
    const body: Record<string, unknown> = {
      subject: input.title,
      body: { contentType: "text", content: description ?? "" },
      start: graphTime(input.start),
      end: graphTime(input.end),
      attendees: attendeesBody(input.attendees.map((email) => ({ email, name: input.attendeeNames?.[email] }))),
    };
    if (location) body.location = { displayName: location };
    if (teams) { body.isOnlineMeeting = true; body.onlineMeetingProvider = TEAMS; }
    const sample = (): CalendarEvent => ({
      id: `created-${Date.now()}`, iCalUID: null, recurringEventId: null, calendarId, title: input.title, description: description ?? null, location: location ?? null,
      start: new Date(input.start).toISOString(), end: new Date(input.end).toISOString(), timeZone: input.timeZone, allDay: false, status: "confirmed",
      organizer: { name: null, email: self },
      attendees: [{ name: null, email: self, self: true, organizer: true, response: "accepted" }, ...input.attendees.map((email) => ({ name: input.attendeeNames?.[email] ?? null, email, self: false, organizer: false, response: "needsAction" as const }))],
      joinUrl: teams ? "https://teams.microsoft.com/l/meetup-join/sample-rill" : input.link?.url ?? null, myResponse: "accepted", updated: new Date().toISOString(),
    });
    const created = await one.call<GraphEvent, CalendarEvent>(ctx, {
      platform: "outlook-calendar",
      action: "events-insert",
      level: "write",
      actionId: A.eventsInsert.id,
      method: A.eventsInsert.method,
      path: A.eventsInsert.path,
      pathParams: { calendarId },
      body,
      summary: `Create "${input.title}"`,
      fixture: sample,
      pick: (d) => eventFromGraph(d, calendarId, self) ?? sample(),
    });
    // Rill wrote the times in UTC; the event keeps the zone it was made in for display.
    return { ...created, timeZone: input.timeZone };
  },

  async patchEvent(ctx, calendarId, eventId, patch) {
    const self = selfEmailOf(ctx);
    const cur = patch.current;
    if (patch.status === "cancelled") {
      await one.call<unknown, void>(ctx, {
        platform: "outlook-calendar",
        action: "events-cancel",
        level: "write",
        actionId: A.eventsCancel.id,
        method: A.eventsCancel.method,
        path: A.eventsCancel.path,
        pathParams: { calendarId, eventId },
        body: { Comment: `${cur.title} is cancelled.` },
        summary: `Cancel "${cur.title}"`,
        fixture: () => undefined,
        pick: () => undefined,
      });
      return { ...applied(cur, patch), status: "cancelled" };
    }
    if (patch.conferencing === null && providerOf(cur.joinUrl) === "teams") {
      throw new Error("Outlook keeps a Teams link once it is made. Remove it in Outlook.");
    }
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.subject = patch.title;
    if (patch.description !== undefined) body.body = { contentType: "text", content: patch.description ?? "" };
    if (patch.location !== undefined) body.location = { displayName: patch.location ?? "" };
    if (patch.start !== undefined && patch.end !== undefined) {
      if (patch.allDay) {
        // All day: midnight to midnight in one zone, as the catalog requires.
        body.start = { dateTime: `${patch.start.slice(0, 10)}T00:00:00`, timeZone: "UTC" };
        body.end = { dateTime: `${patch.end.slice(0, 10)}T00:00:00`, timeZone: "UTC" };
      } else {
        body.start = graphTime(patch.start);
        body.end = graphTime(patch.end);
      }
      body.isAllDay = Boolean(patch.allDay);
    }
    // You are the organizer, not an attendee, in Graph's list.
    if (patch.attendees !== undefined) body.attendees = attendeesBody(patch.attendees.filter((a) => !a.self));
    if (patch.conferencing === "teams") { body.isOnlineMeeting = true; body.onlineMeetingProvider = TEAMS; }
    const result = await one.call<GraphEvent, CalendarEvent>(ctx, {
      platform: "outlook-calendar",
      action: "events-patch",
      level: "write",
      actionId: A.eventsPatch.id,
      method: A.eventsPatch.method,
      path: A.eventsPatch.path,
      pathParams: { calendarId, eventId },
      body,
      summary: `Update "${patch.title ?? cur.title}"`,
      fixture: () => applied(cur, patch),
      pick: (d) => eventFromGraph(d, calendarId, self) ?? applied(cur, patch),
    });
    return { ...result, timeZone: patch.timeZone ?? cur.timeZone ?? result.timeZone };
  },

  async freeBusy(ctx, calendarIds, from, to) {
    const self = selfEmailOf(ctx);
    const empty = () => Object.fromEntries(calendarIds.map((id) => [id, []])) as Record<string, FreeBusySlot[]>;
    if (!self) return empty();
    return one.call<{ value?: GraphScheduleInformation[] }, Record<string, FreeBusySlot[]>>(ctx, {
      platform: "outlook-calendar",
      action: "getSchedule",
      level: "read",
      actionId: A.getSchedule.id,
      method: A.getSchedule.method,
      path: A.getSchedule.path,
      body: { Schedules: [self], StartTime: graphTime(from), EndTime: graphTime(to) },
      summary: "Check free/busy",
      fixture: empty,
      // One schedule covers every calendar you own, so it answers for each of them.
      pick: (d) => {
        const busy = freeBusyFromGraph(d?.value ?? [])[self] ?? [];
        return Object.fromEntries(calendarIds.map((id, i) => [id, i === 0 ? busy : []]));
      },
    });
  },

  async attemptDelete(ctx, calendarId, eventId, note) {
    const { row } = await one.attempt<unknown>(ctx, {
      platform: "outlook-calendar",
      action: "events-delete",
      level: "write",
      actionId: A.eventsDelete.id,
      method: A.eventsDelete.method,
      path: A.eventsDelete.path,
      // The /users/{userId} form wants a UPN, which the mailbox address is.
      pathParams: { userId: selfEmailOf(ctx) || "me", calendarId, eventId },
      summary: note,
      fixture: () => null,
    });
    return row;
  },

  async watch(ctx, calendarId, webhookUrl) {
    return one.call<{ id?: string; expirationDateTime?: string }, { channelId: string; expiresAt: string }>(ctx, {
      platform: "outlook-calendar",
      action: "subscriptions-create",
      level: "read",
      actionId: A.subscriptionsCreate.id,
      method: A.subscriptionsCreate.method,
      path: A.subscriptionsCreate.path,
      body: { changeType: "created,updated,deleted", notificationUrl: webhookUrl, resource: `me/calendars/${calendarId}/events`, expirationDateTime: new Date(Date.now() + 3 * 864e5).toISOString() },
      summary: `Watch ${calendarId} for changes`,
      fixture: () => ({ channelId: "fixture-subscription", expiresAt: new Date(Date.now() + 3 * 864e5).toISOString() }),
      pick: (d) => ({ channelId: d?.id ?? "unknown", expiresAt: d?.expirationDateTime ?? new Date().toISOString() }),
    });
  },

  async stopWatch(ctx, channelId) {
    await one.call<unknown, void>(ctx, {
      platform: "outlook-calendar",
      action: "subscriptions-stop",
      level: "write",
      actionId: A.subscriptionsDelete.id,
      method: A.subscriptionsDelete.method,
      path: A.subscriptionsDelete.path,
      pathParams: { subscriptionId: channelId },
      summary: `Stop subscription ${channelId}`,
      fixture: () => undefined,
      pick: () => undefined,
    });
  },
};
