// Relative date resolution for query operators (browser-safe). Ranges are [from, to) in UTC ISO.
//
// Every calendar step (start of day, of week, of month) happens in one time zone:
// the caller's `tz` (an IANA name such as "Asia/Qatar", sent by the browser), else
// the zone this process runs in. Wall times are kept as Dates whose UTC fields hold
// the wall clock ("wall dates"), and only turn into instants at the edges.

export interface DateRange { from: string; to: string }

const DAY = 86_400_000;

// ---------- zones ----------

const fmts = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmts.set(tz, f);
  }
  return f;
}

function systemZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

/** A usable IANA zone: the one given when Intl knows it, else this process's own. */
export function zoneOr(tz?: string | null): string {
  if (tz) { try { fmt(tz); return tz; } catch { /* unknown zone */ } }
  return systemZone();
}

/** wall clock minus UTC, in ms, at instant t */
function offset(tz: string, t: number): number {
  const p: Record<string, number> = {};
  for (const x of fmt(tz).formatToParts(new Date(t))) if (x.type !== "literal") p[x.type] = Number(x.value);
  const wall = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!);
  return wall - Math.floor(t / 1000) * 1000;
}

const toWall = (t: Date, tz: string) => new Date(t.getTime() + offset(tz, t.getTime()));
function fromWall(w: Date, tz: string): Date {
  const guess = w.getTime() - offset(tz, w.getTime());
  return new Date(w.getTime() - offset(tz, guess));
}

function startOfDay(w: Date): Date { const x = new Date(w); x.setUTCHours(0, 0, 0, 0); return x; }
function addDays(w: Date, n: number): Date { const x = new Date(w); x.setUTCDate(x.getUTCDate() + n); return x; }
function startOfWeek(w: Date): Date { const x = startOfDay(w); const dow = (x.getUTCDay() + 6) % 7; return addDays(x, -dow); }
function startOfMonth(w: Date): Date { const x = startOfDay(w); x.setUTCDate(1); return x; }
function addMonths(w: Date, n: number): Date { const x = new Date(w); x.setUTCMonth(x.getUTCMonth() + n); return x; }
const wallYmd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

/** A date word to a range, or null. "30d" means the last 30 days up to now. */
export function resolveDateValue(v: string, now: Date = new Date(), tz?: string | null): DateRange | null {
  const zone = zoneOr(tz);
  const s = v.trim().toLowerCase();
  const wnow = toWall(now, zone);
  const today = startOfDay(wnow);
  const r = (a: Date, b: Date): DateRange => ({ from: fromWall(a, zone).toISOString(), to: fromWall(b, zone).toISOString() });
  switch (s) {
    case "today": return r(today, addDays(today, 1));
    case "yesterday": return r(addDays(today, -1), today);
    case "tomorrow": return r(addDays(today, 1), addDays(today, 2));
    case "this-week": { const a = startOfWeek(wnow); return r(a, addDays(a, 7)); }
    case "last-week": { const a = addDays(startOfWeek(wnow), -7); return r(a, addDays(a, 7)); }
    case "next-week": { const a = addDays(startOfWeek(wnow), 7); return r(a, addDays(a, 7)); }
    case "this-month": { const a = startOfMonth(wnow); return r(a, addMonths(a, 1)); }
    case "last-month": { const b = startOfMonth(wnow); return r(addMonths(b, -1), b); }
  }
  let m = /^(\d+)([dwmy])$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    const ms = m[2] === "d" ? n * DAY : m[2] === "w" ? n * 7 * DAY : m[2] === "m" ? n * 30 * DAY : n * 365 * DAY;
    return { from: new Date(now.getTime() - ms).toISOString(), to: now.toISOString() };
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const a = wallYmd(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(a.getTime()) || a.getUTCDate() !== Number(m[3])) return null;
    return r(a, addDays(a, 1));
  }
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) { const a = wallYmd(Number(m[1]), Number(m[2]) - 1, 1); return Number.isNaN(a.getTime()) ? null : r(a, addMonths(a, 1)); }
  return null;
}

// ---------- plain dates in the free text (D44, D48) ----------

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
export const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

export interface DateProposal { phrase: string; insert: string; label: string; remove: string }
/** A date phrase found in the text: where it is, the operators it means and a label in plain words. */
export interface DateSpan {
  start: number; end: number; phrase: string; insert: string; label: string;
  /** "from <month>": the word after "from" is a month */
  month?: string;
  /** A month still ahead this year ("in December" in November): the most recent one is `insert`, this one the other choice. */
  alt?: { insert: string; label: string };
  /** The last day (YYYY-MM-DD) of a period `insert` leaves open ("this week" is after: its Monday): for "due this week". */
  until?: string;
}

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const NUMBER_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "a couple of", "a few", "a"];
function numberOf(w: string): number {
  if (/^\d+$/.test(w)) return Number(w);
  const i = NUMBER_WORDS.indexOf(w);
  if (w === "a couple of") return 2;
  if (w === "a few") return 3;
  if (w === "a") return 1;
  return i >= 0 ? i + 1 : 0;
}
const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
const monthLabel = (d: Date) => d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const dayLabel = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const span = (a: Date, b: Date) => `after:${ymd(a)} before:${ymd(b)}`;

/**
 * Finds plain dates in free text ("last month", "in October", "this week",
 * "past 2 weeks", "yesterday") with their place in the text, as after:/before:/on:
 * operators. `masked` marks characters that are not free text (operators, quotes):
 * no date phrase may touch them.
 */
export function findDates(text: string, now: Date = new Date(), tz?: string | null, masked?: (i: number) => boolean): DateSpan[] {
  const zone = zoneOr(tz);
  const out: DateSpan[] = [];
  const low = text.toLowerCase();
  const wnow = toWall(now, zone);
  const today = startOfDay(wnow);
  const free = (a: number, b: number) => { if (!masked) return true; for (let i = a; i < b; i++) if (masked(i)) return false; return true; };
  const take = (re: RegExp, make: (m: RegExpExecArray) => { insert: string; label: string; month?: string; alt?: DateSpan["alt"]; until?: string } | null) => {
    const g = new RegExp(re.source, "g");
    for (let m = g.exec(low); m; m = g.exec(low)) {
      const start = m.index, end = m.index + m[0].length;
      if (!free(start, end) || out.some((p) => start < p.end && end > p.start)) continue;
      const r = make(m);
      if (r) out.push({ start, end, phrase: text.slice(start, end), ...r });
    }
  };
  // "between Oct 1 and Oct 15", "from Oct 1 to Oct 15" (both ends count)
  take(new RegExp(`\\b(?:between|from) ${MONTH_RE} (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))? (?:and|to|until|through|-) (?:${MONTH_RE} )?(\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?\\b`), (m) => {
    const m1 = MONTHS.findIndex((x) => x.startsWith(m[1]!.slice(0, 3)));
    const m2 = m[4] ? MONTHS.findIndex((x) => x.startsWith(m[4]!.slice(0, 3))) : m1;
    if (m1 < 0 || m2 < 0) return null;
    const y2 = m[6] ? Number(m[6]) : m[3] ? Number(m[3]) : null;
    let y1 = m[3] ? Number(m[3]) : y2 ?? wnow.getUTCFullYear();
    let a = wallYmd(y1, m1, Number(m[2]));
    let b = wallYmd(y2 ?? y1, m2, Number(m[5]));
    if (b.getTime() < a.getTime() && y2 === null) b = wallYmd(y1 + 1, m2, Number(m[5]));
    // a bare range that has not started yet this year is last year's
    if (!m[3] && !m[6] && a.getTime() > today.getTime()) { y1 -= 1; a = wallYmd(y1, m1, Number(m[2])); b = wallYmd(b.getUTCFullYear() - 1, m2, Number(m[5])); }
    if (a.getUTCDate() !== Number(m[2]) || b.getUTCDate() !== Number(m[5]) || b.getTime() < a.getTime()) return null;
    return { insert: span(a, addDays(b, 1)), label: `${dayLabel(a)} to ${dayLabel(b)}${a.getUTCFullYear() !== wnow.getUTCFullYear() ? `, ${a.getUTCFullYear()}` : ""}` };
  });
  // "this quarter", "last quarter", "next quarter"
  take(/\b(last|this|next|past) quarter\b/, (m) => {
    const q0 = wallYmd(wnow.getUTCFullYear(), Math.floor(wnow.getUTCMonth() / 3) * 3, 1);
    const a = addMonths(q0, m[1] === "last" || m[1] === "past" ? -3 : m[1] === "next" ? 3 : 0);
    const b = addMonths(a, 3);
    const q = Math.floor(a.getUTCMonth() / 3) + 1;
    const word = m[1] === "this" ? "This quarter" : m[1] === "next" ? "Next quarter" : "Last quarter";
    return { insert: span(a, b), label: `${word}, Q${q} ${a.getUTCFullYear()}` };
  });
  // "since Monday", "last Friday", "before last Friday": the most recent such day (today counts for since)
  take(new RegExp(`\\b(before last|after last|since last|on last|from last|since|before|after|last) (${WEEKDAYS.join("|")})\\b`), (m) => {
    const want = WEEKDAYS.indexOf(m[2]!);
    const dow = (today.getUTCDay() + 6) % 7;
    const which = m[1]!.split(" ")[0]!;
    let back = (dow - want + 7) % 7;
    if (back === 0 && (m[1]!.includes("last") || which === "before" || which === "after")) back = 7;
    const d = addDays(today, -back);
    const name = `${WEEKDAY_NAMES[want]}, ${dayLabel(d)}`;
    if (which === "since" || which === "from") return { insert: `after:${ymd(d)}`, label: `Since ${name}` };
    if (which === "before") return { insert: `before:${ymd(d)}`, label: `Before ${name}` };
    if (which === "after") return { insert: `after:${ymd(addDays(d, 1))}`, label: `After ${name}` };
    return { insert: `on:${ymd(d)}`, label: name };
  });
  // "3 days ago", "two weeks ago"
  take(new RegExp(`\\b(\\d{1,3}|${NUMBER_WORDS.join("|")}) (days?|weeks?) ago\\b`), (m) => {
    const n = numberOf(m[1]!);
    if (!n) return null;
    if (m[2]!.startsWith("d")) { const d = addDays(today, -n); return { insert: `on:${ymd(d)}`, label: `${n} ${n === 1 ? "day" : "days"} ago, ${dayLabel(d)}` }; }
    const a = addDays(startOfWeek(wnow), -7 * n);
    return { insert: span(a, addDays(a, 7)), label: `${n} ${n === 1 ? "week" : "weeks"} ago, ${dayLabel(a)} to ${dayLabel(addDays(a, 6))}` };
  });
  take(/\b(last|this|past|next) (week|month|year)\b/, (m) => {
    const unit = m[2]!, which = m[1]!;
    if (unit === "week") {
      const a = startOfWeek(wnow);
      if (which === "this") return { insert: `after:${ymd(a)}`, label: `This week, since ${dayLabel(a)}`, until: ymd(addDays(a, 6)) };
      if (which === "past") { const p = addDays(today, -7); return { insert: `after:${ymd(p)}`, label: `Past 7 days, since ${dayLabel(p)}` }; }
      if (which === "next") { const s = addDays(a, 7); return { insert: span(s, addDays(s, 7)), label: `Next week, ${dayLabel(s)} to ${dayLabel(addDays(s, 6))}` }; }
      const s = addDays(a, -7); return { insert: span(s, a), label: `Last week, ${dayLabel(s)} to ${dayLabel(addDays(a, -1))}` };
    }
    if (unit === "month") {
      const a = startOfMonth(wnow);
      if (which === "this") return { insert: `after:${ymd(a)}`, label: monthLabel(a), until: ymd(addDays(addMonths(a, 1), -1)) };
      if (which === "past") { const p = addDays(today, -30); return { insert: `after:${ymd(p)}`, label: `Past 30 days, since ${dayLabel(p)}` }; }
      if (which === "next") { const s = addMonths(a, 1); return { insert: span(s, addMonths(s, 1)), label: monthLabel(s) }; }
      const s = addMonths(a, -1); return { insert: span(s, a), label: monthLabel(s) };
    }
    const y = wnow.getUTCFullYear();
    if (which === "this") return { insert: `after:${y}-01-01`, label: String(y), until: `${y}-12-31` };
    if (which === "past") { const p = addDays(today, -365); return { insert: `after:${ymd(p)}`, label: `Past year, since ${p.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}` }; }
    if (which === "next") return { insert: `after:${y + 1}-01-01 before:${y + 2}-01-01`, label: String(y + 1) };
    return { insert: `after:${y - 1}-01-01 before:${y}-01-01`, label: String(y - 1) };
  });
  take(new RegExp(`\\b(?:past|last|previous) (\\d{1,3}|${NUMBER_WORDS.join("|")}) (days?|weeks?|months?)\\b`), (m) => {
    const n = numberOf(m[1]!); const u = m[2]!.charAt(0);
    if (!n) return null;
    const p = addDays(today, -(u === "d" ? n : u === "w" ? n * 7 : n * 30));
    return { insert: `after:${ymd(p)}`, label: `Past ${n} ${m[2]}, since ${dayLabel(p)}` };
  });
  take(/\b(yesterday|today|tomorrow)\b/, (m) => (m[1] === "today" ? { insert: "on:today", label: `Today, ${dayLabel(today)}` }
    : m[1] === "tomorrow" ? { insert: "on:tomorrow", label: `Tomorrow, ${dayLabel(addDays(today, 1))}` }
    : { insert: "on:yesterday", label: `Yesterday, ${dayLabel(addDays(today, -1))}` }));
  take(new RegExp(`\\b(in|during|since|from|before|after|on) ${MONTH_RE}(?:\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d:]))?(?:,?\\s+(\\d{4}))?\\b`), (m) => {
    const mi = MONTHS.findIndex((x) => x.startsWith(m[2]!.slice(0, 3)));
    if (mi < 0) return null;
    const which = m[1]!, month = m[2]!;
    const day = m[3] ? Number(m[3]) : null;
    if (which === "on" && day === null) return null; // "on May" is not a date phrase
    const typedYear = m[4] ? Number(m[4]) : null;
    const thisYear = wnow.getUTCFullYear();
    // a bare month (or month and day) is the most recent one that has started; one still
    // ahead this year could mean either, so it is offered with the other year as a choice
    const startOf = (y: number) => wallYmd(y, mi, day ?? 1);
    const ahead = typedYear === null && startOf(thisYear).getTime() > today.getTime();
    const y = typedYear ?? (ahead ? thisYear - 1 : thisYear);
    const build = (yy: number): { insert: string; label: string } | null => {
      const a = startOf(yy);
      if (day !== null && (a.getUTCMonth() !== mi || a.getUTCDate() !== day)) return null;
      const name = day !== null ? `${dayLabel(a)}, ${yy}` : monthLabel(a);
      const end = day !== null ? addDays(a, 1) : addMonths(a, 1);
      if (which === "since" || which === "from") return { insert: `after:${ymd(a)}`, label: `Since ${name}` };
      if (which === "before") return { insert: `before:${ymd(a)}`, label: `Before ${name}` };
      if (which === "after") return { insert: `after:${ymd(end)}`, label: `After ${name}` };
      return { insert: span(a, end), label: name };
    };
    const r = build(y);
    if (!r) return null;
    const spanWord = which === "in" || which === "during" || which === "on";
    const alt = ahead && spanWord ? build(thisYear) : null;
    return { ...r, month, ...(alt ? { alt } : {}) };
  });
  take(/\b(?:in|during) (\d{4})\b/, (m) => {
    const y = Number(m[1]);
    if (y < 1990 || y > wnow.getUTCFullYear() + 1) return null;
    return { insert: `after:${y}-01-01 before:${y + 1}-01-01`, label: String(y) };
  });
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Plain dates in free text as proposals (D44): the UI offers them as a chip and
 * nothing changes until the user takes it. Used when understanding is off.
 */
export function proposeDates(text: string, now: Date = new Date(), tz?: string | null): DateProposal[] {
  return findDates(text, now, tz).slice(0, 2).map((d) => ({ phrase: d.phrase.trim(), remove: d.phrase.trim(), insert: d.insert, label: d.label }));
}
