// Acme Inc sample calendar for this page (Dana Reyes, made up; see
// WORLD.md for the shared story), shaped like
// Google Calendar's "List a Calendar's Events" answer: items[] with summary,
// start.dateTime, end.dateTime, organizer, attendees[].responseStatus and
// hangoutLink. The people match the sample inbox, so Meeting prep finds a
// real thread with each guest. Times are relative to now, on 15 minutes.

type Person = { email: string; displayName: string };

const DANA: Person = { email: "dana@acme.com", displayName: "Dana Reyes" };
const P = {
  victor: { email: "victor@langpartners.com", displayName: "Victor Lang" },
  priya: { email: "priya@northwind.vc", displayName: "Priya Nair" },
  rosa: { email: "rosa@delgadopearson.com", displayName: "Rosa Delgado" },
  marcus: { email: "marcus@acme.com", displayName: "Marcus Lee" },
  jordan: { email: "jordan@acme.com", displayName: "Jordan Park" },
  riley: { email: "riley@acme.com", displayName: "Riley Chen" },
  elena: { email: "elena@globex.com", displayName: "Elena Ruiz" },
  patricia: { email: "patricia.gomez@globex.com", displayName: "Patricia Gomez" },
  grace: { email: "grace@lindqvist.me", displayName: "Grace Lindqvist" },
  omar: { email: "omar@farouk.dev", displayName: "Omar Farouk" },
};

type Seed = {
  id: string;
  summary: string;
  inMinutes: number;
  minutes: number;
  organizer: Person;
  guests: Person[];
  description?: string;
  location?: string;
  meet?: string;
};

const SEEDS: Seed[] = [
  { id: "ev01", summary: "Daily standup", inMinutes: -150, minutes: 15, organizer: DANA, guests: [P.marcus, P.jordan, P.riley], meet: "https://meet.google.com/acm-stnd-upp" },
  {
    id: "ev02",
    summary: "Northwind terms",
    inMinutes: 70,
    minutes: 45,
    organizer: P.priya,
    guests: [P.rosa, P.victor],
    description: "Board seat timing, pro rata and the option pool, before Northwind's IC on Thursday.",
    meet: "https://meet.google.com/kqp-wzrt-bnm",
  },
  { id: "ev03", summary: "Lunch with Grace", inMinutes: 190, minutes: 60, organizer: DANA, guests: [P.grace], location: "Tartine, Guerrero St" },
  { id: "ev04", summary: "Globex pricing call", inMinutes: 300, minutes: 45, organizer: DANA, guests: [P.elena, P.patricia], location: "https://zoom.us/j/5551234567" },
  { id: "ev05", summary: "1:1 with Jordan", inMinutes: 390, minutes: 30, organizer: DANA, guests: [P.jordan] },
  { id: "ev06", summary: "Onsite interview: Omar Farouk", inMinutes: 22 * 60, minutes: 90, organizer: P.marcus, guests: [P.omar, P.marcus] },
];

const quarter = (t: number) => Math.round(t / 900_000) * 900_000;

export function listEvents(query: Record<string, string> = {}) {
  const now = quarter(Date.now());
  const min = query.timeMin ? Date.parse(query.timeMin) : -Infinity;
  const max = query.timeMax ? Date.parse(query.timeMax) : Infinity;
  const items = SEEDS.map((s) => {
    const start = now + s.inMinutes * 60_000;
    const end = start + s.minutes * 60_000;
    const people = [s.organizer, ...s.guests.filter((g) => g.email !== s.organizer.email)];
    if (!people.some((p) => p.email === DANA.email)) people.splice(1, 0, DANA);
    return {
      kind: "calendar#event",
      id: s.id,
      status: "confirmed",
      htmlLink: `https://www.google.com/calendar/event?eid=${s.id}`,
      summary: s.summary,
      description: s.description,
      location: s.location,
      hangoutLink: s.meet,
      start: { dateTime: new Date(start).toISOString() },
      end: { dateTime: new Date(end).toISOString() },
      organizer: { ...s.organizer, self: s.organizer.email === DANA.email || undefined },
      attendees:
        s.guests.length === 0
          ? undefined
          : people.map((p) => ({
              ...p,
              self: p.email === DANA.email || undefined,
              organizer: p.email === s.organizer.email || undefined,
              responseStatus: p.email === DANA.email && s.organizer.email !== DANA.email ? "needsAction" : "accepted",
            })),
    };
  })
    .filter((e) => Date.parse(e.end.dateTime) > min && Date.parse(e.start.dateTime) < max)
    .sort((a, b) => a.start.dateTime.localeCompare(b.start.dateTime));
  return { kind: "calendar#events", summary: DANA.email, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, items };
}
