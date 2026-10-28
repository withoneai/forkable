import type { Attendee, BusySlot, CalEvent, NewEventInput, Rsvp } from "./types.js";

// Google Calendar's answers mapped to the shapes in types.ts, and the one
// request body we build. Trimmed from Rill's calendar mappers.

interface GDateTime { date?: string; dateTime?: string; timeZone?: string }
interface GAttendee { email?: string; displayName?: string; organizer?: boolean; self?: boolean; responseStatus?: string }
export interface GEvent {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GDateTime;
  end?: GDateTime;
  status?: string;
  organizer?: { email?: string; displayName?: string };
  attendees?: GAttendee[];
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
}
export interface GFreeBusy { calendars?: Record<string, { busy?: { start?: string; end?: string }[] }> }

const RSVP: Record<string, Rsvp> = { needsAction: "needsAction", declined: "declined", tentative: "tentative", accepted: "accepted" };
const STATUS: Record<string, CalEvent["status"]> = { confirmed: "confirmed", tentative: "tentative", cancelled: "cancelled" };
const MEETING_URL = /https:\/\/(?:[\w-]+\.)?(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com)\/[^\s<>"')]+/i;

function attendee(a: GAttendee): Attendee | null {
  if (!a.email) return null;
  return { name: a.displayName ?? null, email: a.email, self: Boolean(a.self), organizer: Boolean(a.organizer), response: RSVP[a.responseStatus ?? ""] ?? "needsAction" };
}

export function eventFromGoogle(e: GEvent, selfEmail = ""): CalEvent | null {
  if (!e.id) return null;
  const allDay = Boolean(e.start?.date && !e.start?.dateTime);
  const start = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : null);
  const end = e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00Z` : null);
  if (!start || !end) return null;
  const attendees = (e.attendees ?? []).map(attendee).filter((a): a is Attendee => a !== null);
  const me = attendees.find((a) => a.self || (selfEmail && a.email.toLowerCase() === selfEmail.toLowerCase()));
  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri;
  return {
    id: e.id,
    title: e.summary || "(no title)",
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    allDay,
    status: STATUS[e.status ?? "confirmed"] ?? "confirmed",
    location: e.location ?? null,
    description: e.description ?? null,
    joinUrl: video ?? e.hangoutLink ?? e.location?.match(MEETING_URL)?.[0] ?? e.description?.match(MEETING_URL)?.[0] ?? null,
    organizer: e.organizer?.email ? { name: e.organizer.displayName ?? null, email: e.organizer.email } : null,
    attendees,
    myResponse: me?.response ?? (attendees.length === 0 ? "accepted" : "needsAction"),
  };
}

export function busyFromGoogle(d: GFreeBusy): BusySlot[] {
  return Object.values(d.calendars ?? {})
    .flatMap((c) => c.busy ?? [])
    .filter((b): b is BusySlot => Boolean(b.start && b.end))
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** The events.insert body for a new event. */
export function toGoogleInsert(input: NewEventInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: input.title,
    start: { dateTime: input.start, timeZone: input.timeZone },
    end: { dateTime: input.end, timeZone: input.timeZone },
    attendees: input.guests.map((email) => ({ email })),
  };
  if (input.description) body.description = input.description;
  if (input.location) body.location = input.location;
  if (input.meet) body.conferenceData = { createRequest: { requestId: `forkable-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } };
  return body;
}
