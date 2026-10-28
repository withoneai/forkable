import { Hono } from "hono";
import type { OneServer } from "../lib/one-server.js";
import { GCAL } from "../google-calendar/actions.js";
import { busyFromGoogle, type GFreeBusy } from "../google-calendar/map.js";
import { sampleBusy, validZone } from "../google-calendar/sample.js";
import type { BusySlot, FreeBusyInput } from "../google-calendar/types.js";

/**
 * POST /api/calendar/free-busy  FreeBusyInput -> BusySlot[]
 * When the user is busy on their primary calendar. Google answers with times
 * only, never titles, so this is the least a scheduling feature can read.
 */
export function googleCalendarOfferTimesRoute(one: OneServer) {
  const r = new Hono();
  r.post("/api/calendar/free-busy", async (c) => {
    const input = await c.req.json<FreeBusyInput>().catch(() => null);
    const from = new Date(input?.from ?? "");
    const to = new Date(input?.to ?? "");
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) {
      return c.json({ error: { code: "bad_request", message: "Send from and to, with to after from." } }, 400);
    }
    if (to.getTime() - from.getTime() > 31 * 86_400_000) return c.json({ error: { code: "bad_request", message: "Ask for 31 days or less." } }, 400);
    try {
      const res = await one.call<GFreeBusy>(c, {
        action: GCAL.freeBusy,
        body: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }] },
        sample: () => ({ calendars: { primary: { busy: sampleBusy(from.toISOString(), to.toISOString(), validZone(input?.timeZone)) } } }),
      });
      const busy: BusySlot[] = busyFromGoogle(res.data);
      return c.json({ data: busy, meta: res.meta });
    } catch (e) {
      return one.error(c, e);
    }
  });
  return r;
}
