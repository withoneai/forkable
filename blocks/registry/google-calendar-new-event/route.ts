import { Hono } from "hono";
import type { OneServer } from "../lib/one-server.js";
import { GCAL } from "../google-calendar/actions.js";
import { eventFromGoogle, toGoogleInsert, type GEvent } from "../google-calendar/map.js";
import { sampleCreate } from "../google-calendar/sample.js";
import type { CalEvent, NewEventInput } from "../google-calendar/types.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/calendar/events  NewEventInput -> CalEvent
 * Creates the event on the user's primary calendar. Guests get no email
 * unless notifyGuests is true (sendUpdates "none" by default).
 */
export function googleCalendarNewEventRoute(one: OneServer) {
  const r = new Hono();
  r.post("/api/calendar/events", async (c) => {
    const input = await c.req.json<NewEventInput>().catch(() => null);
    const bad = (message: string) => c.json({ error: { code: "bad_request", message } }, 400);
    if (!input?.title?.trim()) return bad("Add a title.");
    const start = new Date(input.start);
    const end = new Date(input.end);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return bad("Pick a start and an end.");
    if (end <= start) return bad("The end must be after the start.");
    const guests = (input.guests ?? []).map((g) => g.trim().toLowerCase()).filter(Boolean);
    const wrong = guests.find((g) => !EMAIL.test(g));
    if (wrong) return bad(`${wrong} is not an email address.`);
    const clean: NewEventInput = { ...input, title: input.title.trim(), start: start.toISOString(), end: end.toISOString(), guests, timeZone: input.timeZone || "UTC" };

    const calendarId = c.req.query("calendarId") || "primary";
    const query: Record<string, string> = { sendUpdates: clean.notifyGuests && guests.length ? "all" : "none" };
    if (clean.meet) query.conferenceDataVersion = "1";
    try {
      const res = await one.call<GEvent | { sample: CalEvent }>(c, {
        action: GCAL.createEvent,
        pathParams: { calendarId },
        query,
        body: toGoogleInsert(clean),
        sample: () => ({ sample: sampleCreate(clean) }),
      });
      const event = "sample" in res.data ? res.data.sample : eventFromGoogle(res.data);
      if (!event) return c.json({ error: { code: "provider_error", message: "Google did not return the new event." }, meta: res.meta }, 502);
      return c.json({ data: event, meta: res.meta });
    } catch (e) {
      return one.error(c, e);
    }
  });
  return r;
}
