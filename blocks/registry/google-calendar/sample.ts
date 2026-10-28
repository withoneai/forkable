import sample from "../../fixtures/google-calendar.json" with { type: "json" };
import type { Attendee, BusySlot, CalEvent, NewEventInput } from "./types.js";

// The Acme Inc sample calendar (Dana Reyes, CEO of Acme). What every
// calendar component shows before Sign in with One is set up. Each event is
// a day offset from today and a wall-clock time, placed in the caller's own
// time zone, so the sample always looks like this week.

interface SampleEvent {
  id: string;
  title: string;
  day: number;
  at: string;
  minutes: number;
  allDay?: boolean;
  status?: string;
  location?: string;
  description?: string;
  joinUrl?: string;
  organizer: { name: string; email: string };
  attendees: { name: string; email: string; self?: boolean; organizer?: boolean; response: string }[];
}

export const SAMPLE_ADDRESS = sample.address;

// Events created in the sample live for this process only.
const created: CalEvent[] = [];
let createdCount = 0;

export function sampleCreate(input: NewEventInput): CalEvent {
  const me: Attendee = { name: "Dana Reyes", email: sample.address, self: true, organizer: true, response: "accepted" };
  const event: CalEvent = {
    id: `sample-created-${++createdCount}`,
    title: input.title,
    start: new Date(input.start).toISOString(),
    end: new Date(input.end).toISOString(),
    allDay: false,
    status: "confirmed",
    location: input.location ?? null,
    description: input.description ?? null,
    joinUrl: input.meet ? `https://meet.google.com/acme-${createdCount}` : null,
    organizer: { name: me.name, email: me.email },
    attendees: [me, ...input.guests.map((email): Attendee => ({ name: null, email, self: false, organizer: false, response: "needsAction" }))],
    myResponse: "accepted",
  };
  created.push(event);
  return event;
}

// RSVPs in the sample live for this process only.
const replies = new Map<string, Attendee["response"]>();

export function sampleRsvp(id: string, response: Attendee["response"]): CalEvent | null {
  replies.set(id, response);
  return sampleEvents("1970-01-01T00:00:00.000Z", "9999-12-31T00:00:00.000Z").find((e) => e.id === id) ?? null;
}

/** Sample events that overlap [from, to), sorted by start. */
export function sampleEvents(from: string, to: string, timeZone = defaultZone()): CalEvent[] {
  const today = ymdIn(Date.now(), timeZone);
  const placed = (sample.events as SampleEvent[]).map((e): CalEvent => {
    const [y, m, d] = addDays(today, e.day);
    const [hh, mm] = e.at.split(":").map(Number) as [number, number];
    const start = e.allDay ? Date.UTC(y, m - 1, d) : zoned(y, m, d, hh, mm, timeZone);
    const reply = replies.get(e.id);
    const attendees = e.attendees.map((a): Attendee => ({ name: a.name, email: a.email, self: Boolean(a.self), organizer: Boolean(a.organizer), response: (a.self && reply) || (a.response as Attendee["response"]) }));
    return {
      id: e.id,
      title: e.title,
      start: new Date(start).toISOString(),
      end: new Date(start + e.minutes * 60_000).toISOString(),
      allDay: Boolean(e.allDay),
      status: (e.status ?? "confirmed") as CalEvent["status"],
      location: e.location ?? null,
      description: e.description ?? null,
      joinUrl: e.joinUrl ?? null,
      organizer: e.organizer,
      attendees,
      myResponse: attendees.find((a) => a.self)?.response ?? "accepted",
    };
  });
  return [...placed, ...created].filter((e) => e.end > from && e.start < to).sort((a, b) => a.start.localeCompare(b.start));
}

/** What Google's free/busy would answer for the sample: timed events you have not declined. */
export function sampleBusy(from: string, to: string, timeZone?: string): BusySlot[] {
  return sampleEvents(from, to, timeZone)
    .filter((e) => !e.allDay && e.status !== "cancelled" && e.myResponse !== "declined")
    .map((e) => ({ start: e.start, end: e.end }));
}

// --- wall-clock time in a zone, no date library ------------------------------

export function defaultZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function validZone(tz: string | undefined): string | undefined {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

function partsIn(ms: number, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
      .formatToParts(ms)
      .map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;
  return p;
}

function ymdIn(ms: number, tz: string): [number, number, number] {
  const p = partsIn(ms, tz);
  return [p.year!, p.month!, p.day!];
}

function addDays([y, m, d]: [number, number, number], n: number): [number, number, number] {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}

/** The instant a wall clock in `tz` reads y-m-d hh:mm. */
function zoned(y: number, m: number, d: number, hh: number, mm: number, tz: string): number {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = partsIn(guess, tz);
    const seen = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!);
    guess += wall - seen;
  }
  return guess;
}
