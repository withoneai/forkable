import type { ApiEvent } from "@rill/core/api-types";

/** YYYY-MM-DD for an ISO instant in `tz`. */
export function dayKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** Minutes since local midnight, in `tz`, for an ISO instant. */
export function minutesOfDay(iso: string, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

export function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** "9:30" / "2" for a grid block: the column already says morning or afternoon. */
export function fmtTimeCompact(iso: string, tz: string): string {
  return fmtTime(iso, tz).replace(/:00(?=\s)/, "").replace(/\s?[AP]M$/, "");
}

export function fmtRange(startIso: string, endIso: string, tz: string): string {
  return `${fmtTime(startIso, tz)} – ${fmtTime(endIso, tz)}`;
}

export function fmtDay(iso: string, tz: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(new Date(iso));
}

/** UTC midnight of the local calendar day `d` falls on in `tz`: the key every grid column uses. */
export function localDay(d: Date, tz: string): Date {
  const [y, m, day] = dayKey(d.toISOString(), tz).split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, day));
}

export function startOfWeek(d: Date, tz: string): Date {
  const key = dayKey(d.toISOString(), tz);
  const [y, m, day] = key.split("-").map(Number) as [number, number, number];
  const local = new Date(Date.UTC(y, m - 1, day));
  const weekday = local.getUTCDay(); // 0=Sun
  local.setUTCDate(local.getUTCDate() - weekday);
  return local;
}

export function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + n);
  return next;
}

/** Minutes `tz` is ahead of UTC at `at` (DST-correct at that instant). */
function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(at)
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {} as Record<string, string>);
  return (Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!) - at.getTime()) / 60_000;
}

/** The [from,to) ISO window of the local calendar day a UTC-midnight day key stands for. */
export function utcDayToLocalWindow(utcDay: Date, tz: string): { from: string; to: string } {
  const naive = Date.UTC(utcDay.getUTCFullYear(), utcDay.getUTCMonth(), utcDay.getUTCDate());
  const from = naive - tzOffsetMinutes(tz, new Date(naive)) * 60_000;
  const nextNaive = naive + 864e5;
  const to = nextNaive - tzOffsetMinutes(tz, new Date(nextNaive)) * 60_000;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

export interface LaidOutEvent { event: ApiEvent; column: number; columns: number; startMin: number; endMin: number }

/** Greedy column assignment for same-day overlapping events, Google-Calendar style. */
export function layoutDay(events: ApiEvent[], tz: string): LaidOutEvent[] {
  const timed = events
    .filter((e) => !e.allDay)
    .map((e) => ({ event: e, startMin: minutesOfDay(e.start, tz), endMin: Math.max(minutesOfDay(e.start, tz) + 15, minutesOfDay(e.end, tz)) }))
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const columns: { endMin: number }[][] = [];
  const placed: LaidOutEvent[] = [];
  for (const t of timed) {
    let col = columns.findIndex((c) => c.every((x) => x.endMin <= t.startMin));
    if (col === -1) {
      col = columns.length;
      columns.push([]);
    }
    columns[col]!.push({ endMin: t.endMin });
    placed.push({ ...t, column: col, columns: 1 });
  }
  // A cluster of events that overlap in time shares the max column count among them.
  for (const p of placed) {
    const overlapping = placed.filter((o) => o.startMin < p.endMin && o.endMin > p.startMin);
    p.columns = Math.max(...overlapping.map((o) => o.column + 1));
  }
  return placed;
}

/** UTC midnight of the 1st of the month `d` falls in, in `tz`. */
export function startOfMonth(d: Date, tz: string): Date {
  const local = localDay(d, tz);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1));
}

/** Same day-of-month `n` months away, clamped to the month's last day. */
export function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes()));
}

/** The Sunday-first weeks that cover `month` (a startOfMonth key): 5 or 6 rows of 7 UTC-midnight days. */
export function monthGridDays(month: Date): Date[] {
  const first = new Date(month);
  first.setUTCDate(first.getUTCDate() - first.getUTCDay());
  const lastOfMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
  const span = Math.round((lastOfMonth.getTime() - first.getTime()) / 864e5) + 1;
  const weeks = Math.ceil(span / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(first, i));
}

/** "YYYY-MM-DD" of a UTC-midnight day key. */
export function utcKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** "9a" / "2:30p" for month cells, where no column says morning or afternoon. */
export function fmtTimeTiny(iso: string, tz: string): string {
  return fmtTime(iso, tz).replace(/:00(?=\s)/, "").replace(/\s?([AP])M$/, (_, x: string) => x.toLowerCase());
}

/** The instant of a wall-clock time in `tz` (DST-correct: the offset is read at that moment). */
export function zonedInstant(y: number, month1: number, d: number, h: number, min: number, tz: string): Date {
  const naive = Date.UTC(y, month1 - 1, d, h, min);
  let at = naive - tzOffsetMinutes(tz, new Date(naive)) * 60_000;
  at = naive - tzOffsetMinutes(tz, new Date(at)) * 60_000; // second pass settles times next to a DST change
  return new Date(at);
}
