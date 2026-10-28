// Date helpers for the calendar components, in the browser's own time zone.

export const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
}

/** Monday of the week that holds `d`, at midnight. */
export function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  return addDays(day, -((day.getDay() + 6) % 7));
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Local y-m-d key. All-day events are keyed by their UTC date, the date Google gave. */
export function dayKey(iso: string, allDay = false): string {
  const d = new Date(iso);
  const [y, m, day] = allDay ? [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()] : [d.getFullYear(), d.getMonth(), d.getDate()];
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Local y-m-d key of a day. */
export const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function minutesOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** "2 PM", "2:30 PM". */
export function fmtTime(iso: string | Date): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", d.getMinutes() ? { hour: "numeric", minute: "2-digit" } : { hour: "numeric" });
}

/** "2 to 2:30 PM", "11 AM to 12 PM". */
export function fmtRange(start: string, end: string): string {
  const a = fmtTime(start);
  const b = fmtTime(end);
  const am = (s: string) => s.slice(-2);
  return am(a) === am(b) ? `${a.slice(0, -3)} to ${b}` : `${a} to ${b}`;
}

export function fmtDay(d: Date, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
  return d.toLocaleDateString("en-US", opts);
}

/** "Today", "Tomorrow" or "Thu, Oct 30". */
export function dayLabel(d: Date): string {
  const today = startOfDay(new Date());
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, addDays(today, 1))) return "Tomorrow";
  return fmtDay(d, { weekday: "long", month: "short", day: "numeric" });
}

/** The short zone name the user sees, for example "PDT" or "GMT+3". */
export function zoneShort(at = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
}

/** "9:30", "10", "4:30": a block label where the column already says AM or PM. */
export function fmtClock(iso: string | Date): string {
  const d = new Date(iso);
  const h = d.getHours() % 12 || 12;
  return d.getMinutes() ? `${h}:${String(d.getMinutes()).padStart(2, "0")}` : String(h);
}
