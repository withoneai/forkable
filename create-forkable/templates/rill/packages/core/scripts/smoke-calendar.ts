// Smoke test for the calendar glue: no database, no network, no keys.
// Covers docs/CONTRACT.md's risk list: ICS parsing, the DST week, the sync
// upsert/cancel decision, the conflict check, all-day and cross-midnight
// events. Run: pnpm exec tsx scripts/smoke-calendar.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cancelledProviderIds, conflictsAmong, fixtures, localDayWindowUTC, movedFromOf, parseIcs, resolveFixtureWhen, type ConflictCandidate } from "../src/index.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

// 1. ICS parsing: a VEVENT inside a VCALENDAR, folded lines included (RFC 5545).
const ics = [
  "BEGIN:VCALENDAR",
  "METHOD:REQUEST",
  "BEGIN:VEVENT",
  "UID:board-sync-2026@acme.sample",
  "SEQUENCE:1",
  "DTSTART;TZID=America/Los_Angeles:20261030T100000",
  "DTEND;TZID=America/Los_Angeles:20261030T110000",
  "ORGANIZER;CN=Victor Langford:mailto:victor@langpart",
  " ners.com",
  "SUMMARY:Board sync",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");
const parsed = parseIcs(ics);
check("parseIcs reads METHOD, UID, SEQUENCE", parsed?.method === "REQUEST" && parsed?.uid === "board-sync-2026@acme.sample" && parsed?.sequence === 1, JSON.stringify(parsed));
check("parseIcs unfolds a continued ORGANIZER line", parsed?.organizer === "victor@langpartners.com", parsed?.organizer ?? "null");
check("parseIcs reads DTSTART/DTEND with TZID", parsed?.tzid === "America/Los_Angeles" && parsed?.start === new Date("2026-10-30T17:00:00Z").toISOString(), `${parsed?.start} tzid=${parsed?.tzid}`);
check("parseIcs returns null for a non-calendar body", parseIcs("just an email, no calendar here") === null);

const allDayIcs = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:allday@acme.sample", "DTSTART;VALUE=DATE:20261103", "DTEND;VALUE=DATE:20261104", "END:VEVENT", "END:VCALENDAR"].join("\n");
const allDay = parseIcs(allDayIcs);
check("parseIcs reads an all-day VALUE=DATE event", allDay?.start === new Date("2026-11-03T00:00:00Z").toISOString(), allDay?.start ?? "null");

// 2. The DST week: EU moved 2026-10-25, US moved 2026-11-01. A fixed UTC
// instant must render the correct local wall-clock time on each side.
const beforeEU = new Date("2026-10-24T09:00:00Z"); // CEST (UTC+2)
const afterEU = new Date("2026-10-26T09:00:00Z"); // CET (UTC+1)
const fmt = (d: Date, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
check("Europe/Berlin is UTC+2 before the 2026-10-25 change", fmt(beforeEU, "Europe/Berlin") === "11:00", fmt(beforeEU, "Europe/Berlin"));
check("Europe/Berlin is UTC+1 after the 2026-10-25 change", fmt(afterEU, "Europe/Berlin") === "10:00", fmt(afterEU, "Europe/Berlin"));
const beforeUS = new Date("2026-10-31T16:00:00Z"); // PDT (UTC-7)
const afterUS = new Date("2026-11-02T16:00:00Z"); // PST (UTC-8)
check("America/Los_Angeles is UTC-7 before the 2026-11-01 change", fmt(beforeUS, "America/Los_Angeles") === "09:00", fmt(beforeUS, "America/Los_Angeles"));
check("America/Los_Angeles is UTC-8 after the 2026-11-01 change", fmt(afterUS, "America/Los_Angeles") === "08:00", fmt(afterUS, "America/Los_Angeles"));
// localDayWindowUTC must span exactly 24h of wall-clock local time, even across the change: the UTC window itself can be 23h or 25h long.
const euDay = localDayWindowUTC("2026-10-25", "Europe/Berlin");
check("the EU DST day's local window is 24h of wall clock", fmt(euDay.from, "Europe/Berlin") === "00:00", fmt(euDay.from, "Europe/Berlin"));
const usDay = localDayWindowUTC("2026-11-01", "America/Los_Angeles");
check("the US DST day's local window is 24h of wall clock", fmt(usDay.from, "America/Los_Angeles") === "00:00", fmt(usDay.from, "America/Los_Angeles"));

// A cross-midnight event (an overnight flight) keeps the same duration regardless of zone.
const crossMidnightStart = new Date("2026-10-25T23:30:00Z");
const crossMidnightEnd = new Date("2026-10-26T01:15:00Z");
check("a cross-midnight event keeps its 105-minute duration", crossMidnightEnd.getTime() - crossMidnightStart.getTime() === 105 * 60_000);

// 3. The conflict check: two overlapping meetings flag each other; a third, later one does not.
const base = new Date("2026-10-29T21:00:00Z"); // 2pm Pacific
const rows: ConflictCandidate[] = [
  { id: "a", title: "1:1 with Priya", start: base, end: new Date(base.getTime() + 30 * 60_000), status: "confirmed", allDay: false },
  { id: "b", title: "Design partner call", start: new Date(base.getTime() + 15 * 60_000), end: new Date(base.getTime() + 45 * 60_000), status: "confirmed", allDay: false },
  { id: "c", title: "Later, no overlap", start: new Date(base.getTime() + 60 * 60_000), end: new Date(base.getTime() + 90 * 60_000), status: "confirmed", allDay: false },
  { id: "d", title: "Cancelled, ignored", start: base, end: new Date(base.getTime() + 30 * 60_000), status: "cancelled", allDay: false },
  { id: "e", title: "All day, never conflicts", start: base, end: new Date(base.getTime() + 30 * 60_000), status: "confirmed", allDay: true },
];
const conflicts = conflictsAmong(rows);
check("overlapping events flag each other", conflicts.get("a")?.eventId === "b" && conflicts.get("b")?.eventId === "a");
check("a later non-overlapping event has no conflict", !conflicts.has("c"));
check("a cancelled event never conflicts", !conflicts.has("d"));
check("an all-day event never conflicts", !conflicts.has("e"));

// 4. The sync upsert decision: moved time is detected and reported; an unmoved time reports null.
const moved = movedFromOf({ start: "2026-10-29T18:00:00.000Z", end: "2026-10-29T18:30:00.000Z" }, "2026-10-29T22:00:00.000Z", "2026-10-29T22:30:00.000Z");
check("a changed time reports movedFrom with the old time", moved?.start === "2026-10-29T18:00:00.000Z");
const unmoved = movedFromOf({ start: "2026-10-29T22:00:00.000Z", end: "2026-10-29T22:30:00.000Z" }, "2026-10-29T22:00:00.000Z", "2026-10-29T22:30:00.000Z");
check("an unchanged time reports no move", unmoved === null);
const brandNew = movedFromOf(undefined, "2026-10-29T22:00:00.000Z", "2026-10-29T22:30:00.000Z");
check("a brand-new event (no prior sync) reports no move", brandNew === null);

// 5. The sync cancel decision: an event missing from the latest sync, and not already cancelled, is cancelled once.
const previously = [
  { providerId: "e1", status: "confirmed" },
  { providerId: "e2", status: "confirmed" },
  { providerId: "e3", status: "cancelled" },
];
const toCancel = cancelledProviderIds(previously, new Set(["e1"]));
check("an event missing from the sync is marked cancelled", toCancel.includes("e2"));
check("an event present in the sync is not cancelled", !toCancel.includes("e1"));
check("an already-cancelled event is not reported again", !toCancel.includes("e3"));

// 6. The Acme sample week: wall-clock times, and the Board sync event agrees with its invite email.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const wed = new Date("2026-10-22T15:00:00Z");
const board = resolveFixtureWhen({ weekday: 4, at: "10:00" }, "America/Los_Angeles", wed);
check("Board sync lands on the next Thursday, 10:00 PT, as its invite email says", board.toISOString() === "2026-10-29T17:00:00.000Z", board.toISOString());
const later = resolveFixtureWhen({ date: "2026-10-30", weekday: 4, at: "10:00" }, "America/Los_Angeles", new Date("2026-11-03T15:00:00Z"));
check("a date that has passed falls back to the next matching weekday", later.toISOString() === "2026-11-05T18:00:00.000Z", later.toISOString());
const { events: sample } = fixtures.calendarRecords(fixtures.loadCalendar(ROOT), wed);
const offGrid = sample.filter((e) => new Date(e.start).getUTCMinutes() % 15 !== 0);
check(`every sample event starts on a quarter hour (${sample.length} events)`, offGrid.length === 0, offGrid.map((e) => e.title).join(", "));

// 7. Attendee autocomplete: parse, rank, filter.
{
  const { parseAddress, rankContacts } = await import("../src/contacts.js");
  check("parses a named address", parseAddress('"Priya Shah" <Priya@Northwind.vc>')?.email === "priya@northwind.vc" && parseAddress("Priya Shah <priya@northwind.vc>")?.name === "Priya Shah");
  check("rejects a non-address", parseAddress("undisclosed-recipients:;") === null);
  const now = new Date("2026-10-22T12:00:00Z");
  const d = (days: number) => new Date(now.getTime() - days * 864e5);
  const ranked = rankContacts([
    { email: "priya@northwind.vc", name: "Priya Shah", weight: 3, at: d(1), source: "mail" },
    { email: "sam@globex.com", name: "Sam Ortiz", weight: 1, at: d(2), source: "mail" },
    { email: "sam@globex.com", name: "Sam Ortiz", weight: 2, at: d(3), source: "event" },
    { email: "old@initech.com", name: "Old Friend", weight: 3, at: d(150), source: "mail" },
    { email: "noreply@hooli.com", name: "Hooli", weight: 9, at: d(0), source: "mail" },
    { email: "dana@acme.com", name: "Dana", weight: 9, at: d(0), source: "mail" },
  ], { self: "dana@acme.com", now });
  check("recent sent-to ranks first, no-reply and self are left out", ranked[0]?.email === "priya@northwind.vc" && !ranked.some((c) => c.email === "noreply@hooli.com" || c.email === "dana@acme.com"), ranked.map((c) => c.email).join(","));
  check("mail plus event is marked both", ranked.find((c) => c.email === "sam@globex.com")?.source === "both");
  check("old contacts sink below recent ones", ranked[ranked.length - 1]?.email === "old@initech.com");
  const q = rankContacts([{ email: "sam@globex.com", name: "Sam Ortiz", weight: 1, at: d(1), source: "mail" }, { email: "priya@northwind.vc", name: "Priya Shah", weight: 1, at: d(1), source: "mail" }], { q: "ort", now });
  check("a query matches the start of a name word", q.length === 1 && q[0]!.email === "sam@globex.com");
  check("a query matches the domain", rankContacts([{ email: "priya@northwind.vc", name: null, weight: 1, at: d(1), source: "mail" }], { q: "north", now }).length === 1);
}

// 8. Meeting links: find one in free text, name its provider, write the description block.
{
  const { linkBlock, meetingUrlIn, providerOf } = await import("../src/conferencing.js");
  check("finds a Zoom link in a location", meetingUrlIn("https://acme.zoom.us/j/86753090000?pwd=abc") === "https://acme.zoom.us/j/86753090000?pwd=abc");
  check("finds a Teams link inside a description and drops the trailing period", meetingUrlIn("Agenda.\nJoin: https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc.") === "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc");
  check("ignores a plain web link", meetingUrlIn("Slides at https://docs.google.com/presentation/d/1") === null);
  check("names the provider from the host", providerOf("https://meet.google.com/abc-defg-hij") === "google-meet" && providerOf("https://us02web.zoom.us/j/1") === "zoom" && providerOf("https://example.com") === null);
  check("the description block carries the passcode", linkBlock({ url: "https://acme.zoom.us/j/1", passcode: "acme1", label: "Zoom" }) === "Join Zoom meeting\nhttps://acme.zoom.us/j/1\nPasscode: acme1");
}

// 9. Editing: who may, how guests merge, how a link leaves the text.
{
  const { isEditable, mergeAttendees, stripLink } = await import("../src/calendar.js");
  const me = { name: "Dana", email: "dana@acme.com", self: true, organizer: true, response: "accepted" as const };
  const priya = { name: "Priya", email: "priya@northwind.vc", self: false, organizer: false, response: "accepted" as const };
  check("the organizer may edit", isEditable({ status: "confirmed", organizer: { email: "dana@acme.com" }, attendees: [me, priya] }));
  check("a guest may not", !isEditable({ status: "confirmed", organizer: { email: "priya@northwind.vc" }, attendees: [{ ...me, organizer: false }, { ...priya, organizer: true }] }));
  check("an event nobody organizes (your own block) may be edited", isEditable({ status: "confirmed", organizer: null, attendees: [] }));
  check("a cancelled event may not", !isEditable({ status: "cancelled", organizer: null, attendees: [] }));
  const merged = mergeAttendees([me, priya], ["priya@northwind.vc", "Sam@Globex.com"], { "Sam@Globex.com": "Sam Ortiz" }, "dana@acme.com");
  check("you stay, a kept guest keeps her reply, a new one is needsAction with a name", merged.length === 3 && merged[1]!.response === "accepted" && merged[2]!.email === "sam@globex.com" && merged[2]!.name === "Sam Ortiz" && merged[2]!.response === "needsAction");
  check("a guest left out is removed", mergeAttendees([me, priya], [], {}, "dana@acme.com").length === 1);
  const stripped = stripLink("Agenda\n\nJoin Zoom meeting\nhttps://acme.zoom.us/j/1?pwd=x\nPasscode: acme1", "https://acme.zoom.us/j/1?pwd=x", "https://acme.zoom.us/j/1?pwd=x");
  check("the link block and the location go, the agenda stays", stripped.description === "Agenda" && stripped.location === null, JSON.stringify(stripped));
  check("a real location is kept", stripLink(null, "Room 4", "https://meet.google.com/abc").location === "Room 4");
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
