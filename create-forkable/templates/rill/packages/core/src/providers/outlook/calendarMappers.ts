import { meetingUrlIn } from "../../conferencing.js";
import { htmlToText } from "../../sanitize.js";
import { wallClockToUtc } from "../../tz.js";
import type { Attendee, CalendarEvent, CalendarRecord, EventStatus, FreeBusySlot, RsvpResponse } from "../../types.js";

// Pure functions: Microsoft Graph's calendar wire shapes -> Rill's
// CalendarEvent / CalendarRecord / Attendee. Field names are the One catalog's
// documented responses for List Calendars, calendarView, Create/Update an
// Event and getSchedule (checked 2026-10-23); fixture-verified by
// packages/core/scripts/smoke-outlook.ts, not yet against a real grant.

export interface GraphCalendar { id?: string; name?: string; isDefaultCalendar?: boolean; hexColor?: string; canEdit?: boolean; owner?: { name?: string; address?: string } }

export function calendarFromGraph(c: GraphCalendar): CalendarRecord | null {
  if (!c.id) return null;
  return { id: c.id, name: c.name ?? c.id, color: c.hexColor || null, isDefault: Boolean(c.isDefaultCalendar), accessRole: c.canEdit === false ? "reader" : "owner" };
}

export interface GraphDateTimeZone { dateTime?: string; timeZone?: string }
interface GraphAddress { name?: string; address?: string }
export interface GraphAttendee { emailAddress?: GraphAddress; status?: { response?: string; time?: string }; type?: string }
export interface GraphEvent {
  id?: string;
  iCalUId?: string;
  seriesMasterId?: string;
  type?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  location?: { displayName?: string };
  start?: GraphDateTimeZone;
  end?: GraphDateTimeZone;
  isAllDay?: boolean;
  isCancelled?: boolean;
  isOrganizer?: boolean;
  organizer?: { emailAddress?: GraphAddress };
  attendees?: GraphAttendee[];
  isOnlineMeeting?: boolean;
  onlineMeetingProvider?: string;
  onlineMeeting?: { joinUrl?: string } | null;
  onlineMeetingUrl?: string | null;
  responseStatus?: { response?: string; time?: string };
  showAs?: string;
  lastModifiedDateTime?: string;
}

const RESPONSE: Record<string, RsvpResponse> = {
  none: "needsAction",
  notResponded: "needsAction",
  organizer: "accepted",
  accepted: "accepted",
  tentativelyAccepted: "tentative",
  declined: "declined",
};

/** Graph's dateTimeTimeZone as a UTC ISO instant. */
export function instantOf(t: GraphDateTimeZone | undefined): string | null {
  if (!t?.dateTime) return null;
  const d = wallClockToUtc(t.dateTime, t.timeZone);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** An instant as Graph's dateTimeTimeZone. Rill writes UTC: the instant is exact whatever zone names Graph accepts, and each guest's client shows it in their own zone. */
export function graphTime(iso: string): GraphDateTimeZone {
  return { dateTime: new Date(iso).toISOString().replace("Z", "").replace(/\.\d+$/, ""), timeZone: "UTC" };
}

function descriptionOf(e: GraphEvent): string | null {
  const c = e.body?.content;
  if (c) {
    const text = e.body?.contentType === "html" ? htmlToText(c) : c;
    if (text.trim()) return text.trim();
  }
  return e.bodyPreview?.trim() || null;
}

export function eventFromGraph(e: GraphEvent, calendarId: string, selfEmail: string): CalendarEvent | null {
  if (!e.id) return null;
  const self = selfEmail.toLowerCase();
  const allDay = Boolean(e.isAllDay);
  // An all-day event is a date, not an instant: kept at UTC midnight, the way the Google mapper keeps `date`.
  const start = allDay && e.start?.dateTime ? `${e.start.dateTime.slice(0, 10)}T00:00:00.000Z` : instantOf(e.start);
  const end = allDay && e.end?.dateTime ? `${e.end.dateTime.slice(0, 10)}T00:00:00.000Z` : instantOf(e.end);
  if (!start || !end) return null;
  const organizerEmail = e.organizer?.emailAddress?.address?.toLowerCase() ?? null;
  const attendees: Attendee[] = [];
  for (const a of e.attendees ?? []) {
    const email = a.emailAddress?.address?.toLowerCase();
    if (!email || attendees.some((x) => x.email === email)) continue;
    attendees.push({ name: a.emailAddress?.name ?? null, email, self: email === self, organizer: email === organizerEmail, response: RESPONSE[a.status?.response ?? "none"] ?? "needsAction" });
  }
  // When `attendees` leaves the organizer out, you are added as organizer: isEditable and the editor read "you" from that list.
  if (e.isOrganizer && self && !attendees.some((a) => a.email === self)) {
    attendees.unshift({ name: e.organizer?.emailAddress?.name ?? null, email: self, self: true, organizer: true, response: "accepted" });
  }
  const mine = RESPONSE[e.responseStatus?.response ?? ""];
  const myResponse: RsvpResponse = e.isOrganizer ? "accepted" : mine ?? attendees.find((a) => a.self)?.response ?? (attendees.length === 0 ? "accepted" : "needsAction");
  for (const a of attendees) if (a.self && mine) a.response = mine;
  const status: EventStatus = e.isCancelled ? "cancelled" : "confirmed";
  const location = e.location?.displayName?.trim() || null;
  const description = descriptionOf(e);
  return {
    id: e.id,
    iCalUID: e.iCalUId ?? null,
    recurringEventId: e.seriesMasterId ?? null,
    calendarId,
    title: e.subject || "(no title)",
    description,
    location,
    start,
    end,
    timeZone: e.start?.timeZone ?? null,
    allDay,
    status,
    organizer: organizerEmail ? { name: e.organizer?.emailAddress?.name ?? null, email: organizerEmail } : null,
    attendees,
    joinUrl: e.onlineMeeting?.joinUrl ?? e.onlineMeetingUrl ?? meetingUrlIn(location) ?? meetingUrlIn(description),
    myResponse,
    updated: e.lastModifiedDateTime ? new Date(e.lastModifiedDateTime).toISOString() : new Date().toISOString(),
  };
}

export interface GraphScheduleInformation {
  scheduleId?: string;
  scheduleItems?: { start?: GraphDateTimeZone; end?: GraphDateTimeZone; status?: string }[];
  error?: { message?: string; responseCode?: string };
}

/** Busy slots per schedule (an SMTP address). Free and working-elsewhere items are not busy. */
export function freeBusyFromGraph(schedules: GraphScheduleInformation[]): Record<string, FreeBusySlot[]> {
  const out: Record<string, FreeBusySlot[]> = {};
  for (const s of schedules) {
    if (!s.scheduleId) continue;
    out[s.scheduleId.toLowerCase()] = (s.scheduleItems ?? [])
      .filter((i) => i.status !== "free" && i.status !== "workingElsewhere")
      .map((i) => ({ start: instantOf(i.start), end: instantOf(i.end) }))
      .filter((i): i is FreeBusySlot => Boolean(i.start && i.end));
  }
  return out;
}
