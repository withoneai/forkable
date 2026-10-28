import { Hono } from "hono";
import type { OneServer } from "../lib/one-server.js";
import { GCAL } from "../google-calendar/actions.js";
import { eventFromGoogle, type GEvent } from "../google-calendar/map.js";
import { sampleRsvp } from "../google-calendar/sample.js";
import type { Rsvp } from "../google-calendar/types.js";

const ANSWERS: Rsvp[] = ["accepted", "tentative", "declined"];

/**
 * POST /api/calendar/events/:id/rsvp  { response: "accepted" | "tentative" | "declined", calendarId?, notify? }
 * Answers an invite as the signed-in user. Google replaces the whole attendee
 * list on a patch, so it reads the event first and flips only your own entry.
 * The organizer sees the answer on their calendar; an email goes out only
 * with notify: true.
 */
export function googleCalendarEventRoute(one: OneServer) {
  const r = new Hono();
  r.post("/api/calendar/events/:id/rsvp", async (c) => {
    const eventId = c.req.param("id");
    const body = await c.req.json<{ response?: Rsvp; calendarId?: string; notify?: boolean }>().catch(() => ({}) as { response?: Rsvp; calendarId?: string; notify?: boolean });
    if (!body.response || !ANSWERS.includes(body.response)) return c.json({ error: { code: "bad_request", message: "response must be accepted, tentative or declined." } }, 400);
    const calendarId = body.calendarId || "primary";
    try {
      const current = await one.call<GEvent>(c, {
        action: GCAL.getEvent,
        pathParams: { calendarId, eventId },
        sample: () => ({ id: eventId }),
      });
      if (current.meta.mode === "sample") {
        const event = sampleRsvp(eventId, body.response);
        if (!event) return c.json({ error: { code: "not_found", message: "No such event." } }, 404);
        return c.json({ data: event, meta: { ...current.meta, access: "write" } });
      }
      const attendees = current.data.attendees ?? [];
      if (!attendees.some((a) => a.self)) return c.json({ error: { code: "bad_request", message: "You are not a guest on this event." } }, 400);
      const res = await one.call<GEvent>(c, {
        action: GCAL.patchEvent,
        pathParams: { calendarId, eventId },
        query: { sendUpdates: body.notify ? "all" : "none" },
        body: { attendees: attendees.map((a) => (a.self ? { ...a, responseStatus: body.response } : a)) },
        sample: () => ({}),
      });
      const event = eventFromGoogle(res.data);
      if (!event) return c.json({ error: { code: "provider_error", message: "Google did not return the event." } }, 502);
      return c.json({ data: event, meta: res.meta });
    } catch (e) {
      return one.error(c, e);
    }
  });
  return r;
}
