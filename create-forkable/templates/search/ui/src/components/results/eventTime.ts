// When an event happens, in words (final review 2026-11-12, item 8): an all-day event is
// its dates, never "7:00 PM to 7:00 PM"; a timed one is in the viewer's zone, with the
// event's own time beside it when its calendar is in another zone.

type When = { start: string; end: string; allDay?: boolean; timeZone?: string };

const day = (d: Date, tz?: string) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(tz ? { timeZone: tz } : {}) });
const time = (d: Date, tz?: string) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", ...(tz ? { timeZone: tz } : {}) });
const ymdIn = (d: Date, tz?: string) => d.toLocaleDateString("en-CA", tz ? { timeZone: tz } : {});

function viewerZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

function offsetMin(tz: string, at: Date): number | null {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
    return Math.round((Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!) - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
  } catch { return null; }
}

/** "Thu, Nov 19, all day", "Thu, Nov 19 to Sat, Nov 21, all day", "Wed, Nov 18, 10:00 AM to 11:30 AM". */
export function eventWhen(f: When, viewer = viewerZone()): string {
  const a = new Date(f.start), b = new Date(f.end);
  if (Number.isNaN(a.getTime())) return "";
  if (f.allDay) {
    // the dates as written: midnight to midnight, the end not included
    const s = new Date(`${f.start.slice(0, 10)}T12:00:00Z`);
    const eRaw = Number.isNaN(b.getTime()) ? s : new Date(`${f.end.slice(0, 10)}T12:00:00Z`);
    const last = eRaw.getTime() > s.getTime() ? new Date(eRaw.getTime() - 86_400_000) : s;
    return last.getTime() > s.getTime() ? `${day(s, "UTC")} to ${day(last, "UTC")}, all day` : `${day(s, "UTC")}, all day`;
  }
  if (Number.isNaN(b.getTime())) return `${day(a, viewer)}, ${time(a, viewer)}`;
  return ymdIn(a, viewer) === ymdIn(b, viewer)
    ? `${day(a, viewer)}, ${time(a, viewer)} to ${time(b, viewer)}`
    : `${day(a, viewer)}, ${time(a, viewer)} to ${day(b, viewer)}, ${time(b, viewer)}`;
}

/** "9:00 AM to 9:30 AM Los Angeles time" when the event's zone differs from the viewer's, else null. */
export function eventZoneNote(f: When, viewer = viewerZone()): string | null {
  // Outlook sends every time in UTC unless asked otherwise: that is not the event's own zone, so no note
  if (f.allDay || !f.timeZone || /^(utc|etc\/utc|gmt|etc\/gmt|z|coordinated universal time)$/i.test(f.timeZone.trim())) return null;
  const a = new Date(f.start), b = new Date(f.end);
  if (Number.isNaN(a.getTime())) return null;
  const theirs = offsetMin(f.timeZone, a), mine = offsetMin(viewer, a);
  if (theirs === null || mine === null || theirs === mine) return null;
  const place = f.timeZone === "UTC" || f.timeZone === "Etc/UTC" ? "UTC" : `${f.timeZone.split("/").pop()!.replace(/_/g, " ")} time`;
  const sameDay = ymdIn(a, f.timeZone) === ymdIn(a, viewer);
  const when = Number.isNaN(b.getTime()) ? time(a, f.timeZone) : `${time(a, f.timeZone)} to ${time(b, f.timeZone)}`;
  return `${sameDay ? "" : `${day(a, f.timeZone)}, `}${when} ${place}`;
}

/**
 * An answer to an invite in the app's words, from either calendar: Google (accepted, tentative,
 * declined, needsAction) and Outlook (accepted, tentativelyAccepted, declined, notResponded, none,
 * organizer). Anything else reads as Invited, never as the raw value.
 */
export type Rsvp = "going" | "maybe" | "no" | "invited";
export function rsvpOf(v: string | null | undefined): Rsvp {
  switch ((v ?? "").toLowerCase()) {
    case "accepted": case "organizer": return "going";
    case "tentative": case "tentativelyaccepted": return "maybe";
    case "declined": return "no";
    default: return "invited";
  }
}
export const RSVP_LABEL: Record<Rsvp, string> = { going: "Going", maybe: "Maybe", no: "Not going", invited: "Invited" };

type RawAttendee = { name?: string; email?: string; response?: string; self?: boolean; displayName?: string; responseStatus?: string; emailAddress?: { name?: string; address?: string }; status?: { response?: string }; type?: string };
export interface Attendee { name: string | null; email: string | null; rsvp: Rsvp; self: boolean }

/** The attendees as stored by either calendar, read one way. Your own answer is the event's own (`selfResponse`), so the row and the preview agree. */
export function attendeesOf(f: { attendees?: unknown[]; selfResponse?: string }, selfEmails: string[] = []): Attendee[] {
  return ((f.attendees ?? []) as RawAttendee[]).map((a) => {
    const email = a.email ?? a.emailAddress?.address ?? null;
    const self = !!a.self || (!!email && selfEmails.includes(email.toLowerCase()));
    const raw = a.response ?? a.responseStatus ?? a.status?.response;
    return { name: a.name ?? a.displayName ?? a.emailAddress?.name ?? null, email, self, rsvp: self && f.selfResponse ? rsvpOf(f.selfResponse) : rsvpOf(raw) };
  });
}

/** Your own answer to the event: what the calendar says you said, else Going for an event with no one else on it. */
export function selfRsvp(f: { attendees?: unknown[]; selfResponse?: string }): Rsvp {
  if (f.selfResponse) return rsvpOf(f.selfResponse);
  const me = attendeesOf(f).find((a) => a.self);
  if (me) return me.rsvp;
  return (f.attendees ?? []).length ? "invited" : "going";
}
