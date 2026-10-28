import { Hono } from "hono";
import type { OneServer } from "../lib/one-server.js";
import { GCAL } from "../google-calendar/actions.js";
import { eventFromGoogle, type GEvent } from "../google-calendar/map.js";
import { sampleEvents, validZone } from "../google-calendar/sample.js";
import type { CalEvent } from "../google-calendar/types.js";

const DAY = 86_400_000;

/**
 * GET /api/calendar/events?from=&to=   ISO instants, or
 * GET /api/calendar/events?days=7      from now, for the next N days
 * Optional: calendarId (default "primary"), tz (places the sample in your zone).
 * Recurring events come back as single instances, sorted by start.
 */
export function googleCalendarAgendaRoute(one: OneServer) {
  const r = new Hono();
  r.get("/api/calendar/events", async (c) => {
    const days = Math.min(42, Math.max(1, Number(c.req.query("days") ?? 7) || 7));
    const from = isoOr(c.req.query("from"), new Date().toISOString());
    const to = isoOr(c.req.query("to"), new Date(new Date(from).getTime() + days * DAY).toISOString());
    if (to <= from) return c.json({ error: { code: "bad_request", message: "to must be after from." } }, 400);
    const calendarId = c.req.query("calendarId") || "primary";
    const tz = validZone(c.req.query("tz"));
    try {
      const res = await one.call<{ items?: GEvent[] }>(c, {
        action: GCAL.listEvents,
        pathParams: { calendarId },
        query: { timeMin: from, timeMax: to, singleEvents: "true", orderBy: "startTime", maxResults: "250" },
        sample: () => ({ items: [] }),
      });
      const events: CalEvent[] =
        res.meta.mode === "sample"
          ? sampleEvents(from, to, tz)
          : (res.data.items ?? []).map((e) => eventFromGoogle(e)).filter((e): e is CalEvent => e !== null);
      return c.json({ data: events, meta: res.meta });
    } catch (e) {
      return one.error(c, e);
    }
  });
  return r;
}

function isoOr(v: string | undefined, fallback: string): string {
  if (!v) return fallback;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : fallback;
}
