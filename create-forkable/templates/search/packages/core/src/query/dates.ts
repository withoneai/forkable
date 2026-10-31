// Relative date resolution for query operators (browser-safe). Ranges are [from, to) in UTC ISO.

export interface DateRange { from: string; to: string }

const DAY = 86_400_000;

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d: Date): Date { const x = startOfDay(d); const dow = (x.getDay() + 6) % 7; return addDays(x, -dow); }
function startOfMonth(d: Date): Date { const x = startOfDay(d); x.setDate(1); return x; }
const r = (a: Date, b: Date): DateRange => ({ from: a.toISOString(), to: b.toISOString() });

/** A date word to a range, or null. "30d" means the last 30 days up to now. */
export function resolveDateValue(v: string, now: Date = new Date()): DateRange | null {
  const s = v.trim().toLowerCase();
  const today = startOfDay(now);
  switch (s) {
    case "today": return r(today, addDays(today, 1));
    case "yesterday": return r(addDays(today, -1), today);
    case "tomorrow": return r(addDays(today, 1), addDays(today, 2));
    case "this-week": { const a = startOfWeek(now); return r(a, addDays(a, 7)); }
    case "last-week": { const a = addDays(startOfWeek(now), -7); return r(a, addDays(a, 7)); }
    case "next-week": { const a = addDays(startOfWeek(now), 7); return r(a, addDays(a, 7)); }
    case "this-month": { const a = startOfMonth(now); const b = new Date(a); b.setMonth(b.getMonth() + 1); return r(a, b); }
    case "last-month": { const b = startOfMonth(now); const a = new Date(b); a.setMonth(a.getMonth() - 1); return r(a, b); }
  }
  let m = /^(\d+)([dwmy])$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    const ms = m[2] === "d" ? n * DAY : m[2] === "w" ? n * 7 * DAY : m[2] === "m" ? n * 30 * DAY : n * 365 * DAY;
    return { from: new Date(now.getTime() - ms).toISOString(), to: now.toISOString() };
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) { const a = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); return Number.isNaN(a.getTime()) ? null : r(a, addDays(a, 1)); }
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) { const a = new Date(Number(m[1]), Number(m[2]) - 1, 1); const b = new Date(a); b.setMonth(b.getMonth() + 1); return r(a, b); }
  return null;
}

// ---------- plain dates in the free text (D44) ----------

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

export interface DateProposal { phrase: string; insert: string; label: string; remove: string }

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthLabel = (d: Date) => d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
const dayLabel = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const span = (a: Date, b: Date) => `after:${ymd(a)} before:${ymd(b)}`;

/**
 * Reads plain dates out of free text ("last month", "in October", "this week",
 * "past 2 weeks") into after:/before: operators. Proposals only: the UI offers
 * them as a chip and nothing changes until the user takes it.
 */
export function proposeDates(text: string, now: Date = new Date()): DateProposal[] {
  const out: DateProposal[] = [];
  const low = text.toLowerCase();
  const take = (re: RegExp, make: (m: RegExpExecArray) => { insert: string; label: string } | null) => {
    const m = re.exec(low);
    if (!m || out.some((p) => p.remove === text.slice(m.index, m.index + m[0].length))) return;
    const r = make(m);
    if (r) out.push({ phrase: m[0].trim(), remove: text.slice(m.index, m.index + m[0].length).trim(), ...r });
  };
  const today = startOfDay(now);
  take(/\b(last|this|past) (week|month|year)\b/, (m) => {
    const unit = m[2]!, which = m[1]!;
    if (unit === "week") {
      const a = startOfWeek(now);
      if (which === "this") return { insert: `after:${ymd(a)}`, label: `This week, since ${dayLabel(a)}` };
      if (which === "past") { const p = addDays(today, -7); return { insert: `after:${ymd(p)}`, label: `Past 7 days, since ${dayLabel(p)}` }; }
      const s = addDays(a, -7); return { insert: span(s, a), label: `Last week, ${dayLabel(s)} to ${dayLabel(addDays(a, -1))}` };
    }
    if (unit === "month") {
      const a = startOfMonth(now);
      if (which === "this") return { insert: `after:${ymd(a)}`, label: monthLabel(a) };
      if (which === "past") { const p = addDays(today, -30); return { insert: `after:${ymd(p)}`, label: `Past 30 days, since ${dayLabel(p)}` }; }
      const s = new Date(a); s.setMonth(s.getMonth() - 1); return { insert: span(s, a), label: monthLabel(s) };
    }
    const y = now.getFullYear();
    if (which === "this") return { insert: `after:${y}-01-01`, label: String(y) };
    if (which === "past") { const p = addDays(today, -365); return { insert: `after:${ymd(p)}`, label: `Past year, since ${p.toLocaleDateString("en-US", { month: "short", year: "numeric" })}` }; }
    return { insert: `after:${y - 1}-01-01 before:${y}-01-01`, label: String(y - 1) };
  });
  take(/\b(?:past|last) (\d{1,3}) (days?|weeks?|months?)\b/, (m) => {
    const n = Number(m[1]); const u = m[2]!.charAt(0);
    if (!n) return null;
    const p = addDays(today, -(u === "d" ? n : u === "w" ? n * 7 : n * 30));
    return { insert: `after:${ymd(p)}`, label: `Past ${n} ${m[2]}, since ${dayLabel(p)}` };
  });
  take(/\b(yesterday|today)\b/, (m) => (m[1] === "today" ? { insert: "on:today", label: "Today" } : { insert: "on:yesterday", label: "Yesterday" }));
  take(new RegExp(`\\b(?:in|during|since|from) ${MONTH_RE}(?:\\s+(\\d{4}))?\\b`), (m) => {
    const mi = MONTHS.findIndex((x) => x.startsWith(m[1]!.slice(0, 3)));
    if (mi < 0) return null;
    // a bare month is the most recent one that has started
    const y = m[2] ? Number(m[2]) : mi > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
    const a = new Date(y, mi, 1);
    const b = new Date(y, mi + 1, 1);
    if (/^since|^from/.test(m[0])) return { insert: `after:${ymd(a)}`, label: `Since ${monthLabel(a)}` };
    return { insert: span(a, b), label: monthLabel(a) };
  });
  take(/\b(?:in|during) (\d{4})\b/, (m) => {
    const y = Number(m[1]);
    if (y < 1990 || y > now.getFullYear() + 1) return null;
    return { insert: `after:${y}-01-01 before:${y + 1}-01-01`, label: String(y) };
  });
  return out.slice(0, 2);
}
