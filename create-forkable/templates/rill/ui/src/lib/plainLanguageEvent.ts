// A small heuristic parser for "lunch w/ Priya thu 1pm": pulls a day, a time
// and a duration out of free text and leaves the rest as the title. Not an
// LLM call: fast, offline, good enough for the common "<title> <when>" shape.
// Falls back to "today, now" when nothing matches so a preview always shows.
// Days and times are read in the calendar's zone, never the browser's: someone
// in Doha with a Pacific calendar who types "fri 2pm" means 2 PM Pacific.

import { dayKey, zonedInstant } from "./calendarLayout";

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEKDAY_RE = /\b(sun(day)?|mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?)\b/i;
const RELATIVE_RE = /\b(today|tomorrow|tmrw)\b/i;
const TIME_RE = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\b/i;
const NOON_RE = /\b(noon|midday)\b/i;
const WITH_RE = /\b(?:w\/|with)\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?)/u;
const DURATION_RE = /\bfor\s+(\d+)\s*(min(ute)?s?|h(ou)?rs?|hours?)\b/i;

export interface ParsedEvent { title: string; start: Date; end: Date; confidence: number; /** "Priya" from "lunch w/ Priya", for matching a contact. */ withName: string | null }

/** Today's wall-clock date in `tz` as y/m/d plus its weekday. */
function todayIn(tz: string, now: Date) {
  const [y, m, d] = dayKey(now.toISOString(), tz).split("-").map(Number) as [number, number, number];
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

export function parsePlainLanguageEvent(text: string, now = new Date(), tz = Intl.DateTimeFormat().resolvedOptions().timeZone): ParsedEvent {
  let remaining = text.trim();
  const today = todayIn(tz, now);
  let dayOffset = 0;
  let matched = false;
  let sameWeekday = false;
  const withName = remaining.match(WITH_RE)?.[1] ?? null;

  const rel = remaining.match(RELATIVE_RE);
  if (rel) {
    matched = true;
    if (/tomorrow|tmrw/i.test(rel[0])) dayOffset = 1;
    remaining = remaining.replace(rel[0], "").trim();
  } else {
    const wd = remaining.match(WEEKDAY_RE);
    if (wd) {
      const idx = WEEKDAYS.findIndex((w) => wd[0].toLowerCase().startsWith(w));
      if (idx >= 0) { const diff = (idx - today.weekday + 7) % 7; dayOffset = diff; sameWeekday = diff === 0; matched = true; }
      remaining = remaining.replace(wd[0], "").trim();
    }
  }

  let hour = 9;
  let minute = 0;
  let timed = false;
  const noon = remaining.match(NOON_RE);
  const time = noon ? null : remaining.match(TIME_RE);
  if (noon) {
    hour = 12; timed = true; matched = true;
    remaining = remaining.replace(noon[0], "").trim();
  } else if (time) {
    hour = Number(time[1]);
    minute = Number(time[2] ?? 0);
    const mer = time[3]?.toLowerCase().charAt(0);
    if (mer === "p" && hour < 12) hour += 12;
    if (mer === "a" && hour === 12) hour = 0;
    if (!mer && hour < 8) hour += 12; // "lunch at 1" reads as 1pm, not 1am
    timed = hour < 24 && minute < 60;
    if (!timed) { hour = 9; minute = 0; }
    matched = true;
    remaining = remaining.replace(time[0], "").trim();
  }

  let durationMin = 30;
  const dur = remaining.match(DURATION_RE);
  if (dur) {
    const n = Number(dur[1]);
    durationMin = /h/i.test(dur[2]!) ? n * 60 : n;
    remaining = remaining.replace(dur[0], "").trim();
  }

  // No day and no time: the next half hour today, so a preview always shows something sensible.
  if (!matched) {
    const mins = Math.ceil((Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now)) * 60 + now.getMinutes() + 1) / 30) * 30;
    hour = Math.floor(mins / 60) % 24; minute = mins % 60;
  }
  const base = new Date(Date.UTC(today.y, today.m - 1, today.d + dayOffset));
  let start = zonedInstant(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hour, minute, tz);
  // "thu 1pm" typed on a Thursday means today unless 1pm has passed, then next week.
  if (sameWeekday && start.getTime() <= now.getTime()) start = zonedInstant(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate() + 7, hour, minute, tz);
  const end = new Date(start.getTime() + durationMin * 60_000);
  const title = remaining.replace(/\b(w\/|with)(?=\s|$)/gi, "with").replace(/\s+(at|on)$/i, "").replace(/\s{2,}/g, " ").trim() || "New event";
  return { title, start, end, confidence: matched ? 0.85 : 0.4, withName };
}
