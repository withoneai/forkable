import { meetingUrlIn } from "../../conferencing.js";
import type { Attendee, CalendarEvent, CalendarRecord, EventStatus, FreeBusySlot, RsvpResponse } from "../../types.js";

// Pure functions: Google Calendar's wire shapes -> Rill's CalendarEvent /
// CalendarRecord / Attendee. No network, no db, no One.

export interface GCalListEntry {
  id?: string;
  summary?: string;
  primary?: boolean;
  backgroundColor?: string;
  colorId?: string;
  accessRole?: string;
}

export function calendarFromGoogle(c: GCalListEntry): CalendarRecord | null {
  if (!c.id) return null;
  return {
    id: c.id,
    name: c.summary ?? c.id,
    color: c.backgroundColor ?? null,
    isDefault: Boolean(c.primary),
    accessRole: (["owner", "writer", "reader", "freeBusyReader"] as const).includes(c.accessRole as never) ? (c.accessRole as CalendarRecord["accessRole"]) : "reader",
  };
}

interface GCalDateTime { date?: string; dateTime?: string; timeZone?: string }
interface GCalAttendee { email?: string; displayName?: string; organizer?: boolean; self?: boolean; responseStatus?: string }
export interface GCalEvent {
  id?: string;
  iCalUID?: string;
  recurringEventId?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GCalDateTime;
  end?: GCalDateTime;
  status?: string;
  organizer?: { email?: string; displayName?: string };
  attendees?: GCalAttendee[];
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  updated?: string;
}

const RSVP: Record<string, RsvpResponse> = { needsAction: "needsAction", declined: "declined", tentative: "tentative", accepted: "accepted" };

function attendeeFromGoogle(a: GCalAttendee): Attendee | null {
  if (!a.email) return null;
  return {
    name: a.displayName ?? null,
    email: a.email,
    self: Boolean(a.self),
    organizer: Boolean(a.organizer),
    response: RSVP[a.responseStatus ?? ""] ?? "needsAction",
  };
}

function joinUrlOf(e: GCalEvent): string | null {
  const meet = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri;
  return meet ?? e.hangoutLink ?? meetingUrlIn(e.location) ?? meetingUrlIn(e.description);
}

const STATUS: Record<string, EventStatus> = { confirmed: "confirmed", tentative: "tentative", cancelled: "cancelled" };

export function eventFromGoogle(e: GCalEvent, calendarId: string, selfEmail: string): CalendarEvent | null {
  if (!e.id) return null;
  const allDay = Boolean(e.start?.date && !e.start?.dateTime);
  const start = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : null);
  const end = e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00Z` : null);
  if (!start || !end) return null;
  const attendees = (e.attendees ?? []).map(attendeeFromGoogle).filter((a): a is Attendee => a !== null);
  const me = attendees.find((a) => a.self || a.email.toLowerCase() === selfEmail.toLowerCase());
  return {
    id: e.id,
    iCalUID: e.iCalUID ?? null,
    recurringEventId: e.recurringEventId ?? null,
    calendarId,
    title: e.summary || "(no title)",
    description: e.description ?? null,
    location: e.location ?? null,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    timeZone: e.start?.timeZone ?? e.end?.timeZone ?? null,
    allDay,
    status: STATUS[e.status ?? "confirmed"] ?? "confirmed",
    organizer: e.organizer?.email ? { name: e.organizer.displayName ?? null, email: e.organizer.email } : null,
    attendees,
    joinUrl: joinUrlOf(e),
    myResponse: me?.response ?? (attendees.length === 0 ? "accepted" : "needsAction"),
    updated: e.updated ? new Date(e.updated).toISOString() : new Date().toISOString(),
  };
}

export function freeBusyFromGoogle(data: { calendars?: Record<string, { busy?: { start?: string; end?: string }[] }> }): Record<string, FreeBusySlot[]> {
  const out: Record<string, FreeBusySlot[]> = {};
  for (const [calId, cal] of Object.entries(data.calendars ?? {})) {
    out[calId] = (cal.busy ?? []).filter((b) => b.start && b.end).map((b) => ({ start: b.start!, end: b.end! }));
  }
  return out;
}
