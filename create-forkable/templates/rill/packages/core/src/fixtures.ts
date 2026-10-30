import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { OnboardingSuggestions } from "./api-types.js";
import type { FixtureCalendar, FixtureInbox, FixtureThread, FixturesLayer, FixtureWhen, Recording } from "./contract.js";
import { hiddenText, stripQuoted } from "./sanitize.js";
import { tzOffsetMinutes } from "./tz.js";
import type { Attendee, CalendarEvent, CalendarRecord, Mail, ThreadRecord } from "./types.js";

// The Acme sample inbox and the recordings replayed over it. A sample run
// executes every branch of the real code; only the platforms' answers come
// from disk. `rill record` refreshes the recordings with a live Jev and a
// real writer.

export const inboxPath = (root: string) => path.join(root, "fixtures", "inbox.json");
export const calendarPath = (root: string) => path.join(root, "fixtures", "calendar.json");
export const recordedDir = (root: string) => path.join(root, "fixtures", "recorded");
const recordingFile = (root: string, threadId: string) => path.join(recordedDir(root), `${threadId}.json`);

/** Pseudo label on a fixture message that carried a List-Unsubscribe header. Survives the database round trip. */
export const LIST_UNSUBSCRIBE_LABEL = "LIST_UNSUBSCRIBE";
/** Set by a mail mapper when the provider itself says a message is a meeting request or reply (Outlook's eventMessage). */
export const CALENDAR_INVITE_LABEL = "CALENDAR_INVITE";

const FIXTURE_ID = /^t\d+$/;
export const isFixtureThreadId = (id: string) => FIXTURE_ID.test(id);

let cache: { file: string; mtime: number; inbox: FixtureInbox } | undefined;
let calendarCache: { file: string; mtime: number; fixture: FixtureCalendar } | undefined;

export const fixtures: FixturesLayer = {
  loadInbox(root) {
    const file = inboxPath(root);
    if (!existsSync(file)) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(PLACEHOLDER, null, 2) + "\n");
    }
    const stat = mtimeOf(file);
    if (cache && cache.file === file && cache.mtime === stat) return cache.inbox;
    const inbox = JSON.parse(readFileSync(file, "utf8")) as FixtureInbox;
    validate(inbox, file);
    cache = { file, mtime: stat, inbox };
    return inbox;
  },

  threadRecords(inbox, now = new Date()) {
    const me = inbox.address.toLowerCase();
    return inbox.threads
      .map((t) => threadRecord(t, me, now))
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  },

  readRecording(root, threadId) {
    const file = recordingFile(root, threadId);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, "utf8")) as Recording;
    } catch {
      return null;
    }
  },

  writeRecording(root, threadId, patch) {
    if (!isFixtureThreadId(threadId)) return;
    mkdirSync(recordedDir(root), { recursive: true });
    const file = recordingFile(root, threadId);
    const all = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) all[k] = v;
    writeFileSync(file, JSON.stringify(all, null, 2) + "\n");
  },

  recording(env) {
    return env.RECORD === "1";
  },

  loadCalendar(root) {
    const file = calendarPath(root);
    if (!existsSync(file)) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(PLACEHOLDER_CALENDAR, null, 2) + "\n");
    }
    const stat = mtimeOf(file);
    if (calendarCache && calendarCache.file === file && calendarCache.mtime === stat) return calendarCache.fixture;
    const fixture = JSON.parse(readFileSync(file, "utf8")) as FixtureCalendar;
    calendarCache = { file, mtime: stat, fixture };
    return fixture;
  },

  calendarRecords(fixture, now = new Date()) {
    const calendars: CalendarRecord[] = fixture.calendars.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color ?? null,
      isDefault: Boolean(c.isDefault),
      accessRole: "owner",
    }));
    const events: CalendarEvent[] = fixture.events.map((e) => {
      const attendees: Attendee[] = e.attendees.map((a) => ({
        name: a.name,
        email: a.email.toLowerCase(),
        self: Boolean(a.self),
        organizer: Boolean(a.organizer),
        response: a.response ?? "needsAction",
      }));
      const me = attendees.find((a) => a.self);
      return {
        id: e.id,
        iCalUID: `${e.id}@acme.sample`,
        recurringEventId: e.recurringEventId ?? null,
        calendarId: e.calendarId,
        title: e.title,
        description: e.description ?? null,
        location: e.location ?? null,
        start: resolveFixtureWhen(e.when, e.timeZone, now).toISOString(),
        end: new Date(resolveFixtureWhen(e.when, e.timeZone, now).getTime() + e.durationMinutes * 60_000).toISOString(),
        timeZone: e.timeZone,
        allDay: Boolean(e.allDay),
        status: e.status ?? "confirmed",
        organizer: { name: e.organizer.name, email: e.organizer.email.toLowerCase() },
        attendees,
        joinUrl: e.joinUrl ?? null,
        myResponse: me?.response ?? "needsAction",
        updated: now.toISOString(),
      };
    });
    return { calendars, events };
  },

  suggestGoals() {
    return [
      { title: "Reply to people waiting on me", detail: "A person asked me a question or needs a decision. Not newsletters, not notifications." },
      { title: "Anything with money or a signature", detail: "Invoices, contracts, wires, approvals, legal deadlines. Anything I have to sign or pay." },
      { title: "Close the round", detail: "Investors, term sheets, data room questions, intros to funds. Not vendors selling to startups." },
      { title: "Hire", detail: "Candidates, recruiters I engaged, offers, references, interview scheduling." },
      { title: "Land design partners", detail: "Companies piloting the product, pricing questions, procurement, security reviews." },
      { title: "Ship the launch", detail: "Launch date, press, creators, the website, anything blocking the release." },
    ];
  },
};

/** Today's YYYY-MM-DD in `tz`, plus `days`. */
function localDateKey(now: Date, tz: string, days = 0): string {
  const base = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A wall-clock time on a calendar day in `tz`, as the real instant (DST-correct). */
function wallClock(dateKey: string, hhmm: string, tz: string): Date {
  const naive = new Date(`${dateKey}T${hhmm}:00Z`);
  return new Date(naive.getTime() - tzOffsetMinutes(tz, naive) * 60_000);
}

/** Resolves a fixture's `when` against "now". Exported for the calendar sync and tests. */
export function resolveFixtureWhen(when: FixtureWhen, tz: string, now = new Date()): Date {
  if (when.date) {
    const exact = wallClock(when.date, when.at, tz);
    if (exact.getTime() > now.getTime() || when.weekday === undefined) return exact;
  }
  if (when.weekday !== undefined) {
    for (let i = 1; i <= 7; i++) {
      const key = localDateKey(now, tz, i);
      if (new Date(`${key}T12:00:00Z`).getUTCDay() === when.weekday) return wallClock(key, when.at, tz);
    }
  }
  return wallClock(localDateKey(now, tz, when.day ?? 0), when.at, tz);
}

function mtimeOf(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function validate(inbox: FixtureInbox, file: string): void {
  const miss = (what: string) => new Error(`${file}: ${what}`);
  if (!inbox || typeof inbox !== "object") throw miss("not an object");
  if (typeof inbox.address !== "string") throw miss("missing address");
  if (!Array.isArray(inbox.threads)) throw miss("missing threads[]");
  const seen = new Set<string>();
  for (const t of inbox.threads) {
    if (!t.id || seen.has(t.id)) throw miss(`thread id missing or repeated: ${t.id}`);
    seen.add(t.id);
    if (!Array.isArray(t.messages) || t.messages.length === 0) throw miss(`thread ${t.id} has no messages`);
  }
  inbox.goals ??= [];
  inbox.vips ??= [];
}

function threadRecord(t: FixtureThread, me: string, now: Date): ThreadRecord {
  const messages: Mail[] = t.messages
    .map((m) => {
      const fromEmail = m.from.email.toLowerCase();
      const isFromMe = m.isFromMe ?? fromEmail === me;
      const labelIds = [...(m.labelIds ?? [])];
      if (isFromMe && !labelIds.includes("SENT")) labelIds.push("SENT");
      if (!isFromMe && !labelIds.includes("INBOX")) labelIds.push("INBOX");
      if (m.listUnsubscribe && !labelIds.includes(LIST_UNSUBSCRIBE_LABEL)) labelIds.push(LIST_UNSUBSCRIBE_LABEL);
      if (!isFromMe && t.category) labelIds.push(`CATEGORY_${t.category.toUpperCase()}`);
      const body = stripQuoted(m.body);
      const mail: Mail = {
        id: m.id,
        threadId: t.id,
        from: { name: m.from.name, email: fromEmail },
        to: m.to.map((x) => x.toLowerCase()),
        cc: (m.cc ?? []).map((x) => x.toLowerCase()),
        date: new Date(now.getTime() - m.minutesAgo * 60_000).toISOString(),
        subject: t.subject,
        body,
        rawBody: m.html ?? m.body,
        hiddenText: m.html ? hiddenText(m.html, m.body) : "",
        snippet: body.replace(/\s+/g, " ").slice(0, 140),
        labelIds,
        isFromMe,
      };
      return mail;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const last = messages[messages.length - 1]!;
  const participants: { name: string; email: string }[] = [];
  for (const m of messages) {
    for (const p of [m.from, ...m.to.map((e) => ({ name: "", email: e })), ...m.cc.map((e) => ({ name: "", email: e }))]) {
      if (!participants.some((x) => x.email === p.email)) participants.push({ name: p.name, email: p.email });
      else if (p.name) {
        const ex = participants.find((x) => x.email === p.email)!;
        if (!ex.name) ex.name = p.name;
      }
    }
  }
  return {
    id: t.id,
    subject: t.subject,
    snippet: last.snippet,
    lastMessageAt: last.date,
    messageCount: messages.length,
    participants,
    messages,
  };
}

/** Written only when fixtures/inbox.json does not exist yet; never overwrites. */
const PLACEHOLDER: FixtureInbox = {
  me: "Dana Reyes, CEO of Acme Inc",
  address: "dana@acme.com",
  team_domain: "acme.com",
  goals: [
    { id: "g1", title: "Close the round", detail: "Investors, term sheets, data room questions. Not vendors selling to startups.", weight: 9 },
    { id: "g2", title: "Land design partners", detail: "Companies piloting Acme, pricing, procurement, security reviews.", weight: 7 },
    { id: "g3", title: "Hire", detail: "Candidates, offers, references, interview scheduling.", weight: 6 },
  ],
  vips: [
    { id: "v1", name: "Priya Natarajan", matchKind: "address", match: "priya@northwind.vc", tier: "inner", rules: { alwaysTop: true } },
    { id: "v2", name: "Globex", matchKind: "domain", match: "globex.com", tier: "key" },
    { id: "v3", name: "Acme team", matchKind: "domain", match: "acme.com", tier: "team" },
    { id: "v4", name: "Our board", matchKind: "description", match: "Anyone who sits on Acme's board or represents a board seat", tier: "inner" },
  ],
  threads: [
    {
      id: "t01",
      subject: "Term sheet redlines",
      messages: [
        {
          id: "t01m1",
          from: { name: "Priya Natarajan", email: "priya@northwind.vc" },
          to: ["dana@acme.com"],
          minutesAgo: 95,
          body: "Dana, two open points on the term sheet: the option pool size and the pro rata clause. Can you confirm by Thursday 5pm so we can circulate the final?\n\nPriya",
        },
      ],
      expect: { lane: "vip" },
    },
    {
      id: "t02",
      subject: "Pilot results and 40 seats",
      messages: [
        {
          id: "t02m1",
          from: { name: "Marcus Hill", email: "marcus.hill@globex.com" },
          to: ["dana@acme.com"],
          minutesAgo: 240,
          body: "The pilot finished and the team wants to roll out to 40 seats. Could you send pricing for an annual plan by Friday?\n\nMarcus",
        },
      ],
      expect: { lane: "vip" },
    },
    {
      id: "t03",
      subject: "Your weekly product digest",
      messages: [
        {
          id: "t03m1",
          from: { name: "Vandelay Weekly", email: "digest@vandelay-news.example" },
          to: ["dana@acme.com"],
          minutesAgo: 600,
          listUnsubscribe: true,
          body: "This week in product: five launches, three pricing changes and one acquisition. Read the full issue online.\n\nUnsubscribe at any time.",
        },
      ],
      expect: { lane: "other" },
    },
  ],
};

/** Written only when fixtures/calendar.json does not exist yet; never overwrites. The real Acme week lives in that file. */
const PLACEHOLDER_CALENDAR: FixtureCalendar = {
  calendars: [{ id: "cal1", name: "Dana Reyes", isDefault: true }],
  events: [
    {
      id: "e1",
      calendarId: "cal1",
      title: "Board sync",
      when: { day: 0, at: "15:00" },
      durationMinutes: 30,
      timeZone: "America/Los_Angeles",
      organizer: { name: "Dana Reyes", email: "dana@acme.com" },
      attendees: [{ name: "Dana Reyes", email: "dana@acme.com", self: true, organizer: true, response: "accepted" }],
    },
  ],
};
