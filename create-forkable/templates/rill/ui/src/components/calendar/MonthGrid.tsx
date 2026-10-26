import { useLayoutEffect, useRef, useState } from "react";
import type { ApiEvent } from "@rill/core/api-types";
import { addDays, dayKey, fmtTime, fmtTimeTiny, utcDayToLocalWindow, utcKey } from "@/lib/calendarLayout";
import { cn } from "@/lib/utils";

const LINE_PX = 20;
const HEAD_PX = 28;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Every UTC day key an event covers: its start day for timed events, its date span for all-day ones. */
function keysOf(e: ApiEvent, tz: string): string[] {
  if (!e.allDay) return [dayKey(e.start, tz)];
  const out: string[] = [];
  const start = new Date(e.start.slice(0, 10) + "T00:00:00Z");
  const end = new Date(e.end.slice(0, 10) + "T00:00:00Z");
  for (let d = start; d < end || out.length === 0; d = addDays(d, 1)) { out.push(utcKey(d)); if (out.length > 31) break; }
  return out;
}

/**
 * Month view, after Notion Calendar's: a quiet grid, the date top left (today
 * in the accent pill, other months dimmed), all-day events as tinted bars,
 * timed events as one line with the time on the right, then "N more".
 * Clicking an event opens its card, the date or "N more" opens that day, and
 * clicking empty space in a day starts a new event at 9 AM.
 */
export function MonthGrid({ month, days, events, tz, selectedId, onPick, onOpenDay, onCreateAt }: {
  month: Date; days: Date[]; events: ApiEvent[]; tz: string; selectedId?: string | null;
  onPick: (eventId: string) => void; onOpenDay: (day: Date) => void; onCreateAt: (start: Date, end: Date) => void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const [cap, setCap] = useState(3);
  const weeks = days.length / 7;
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const measure = () => setCap(Math.max(1, Math.floor((el.clientHeight / weeks - HEAD_PX - 4) / LINE_PX)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weeks]);

  const todayKey = dayKey(new Date().toISOString(), tz);
  const byDay = new Map<string, ApiEvent[]>();
  for (const e of events) {
    if (e.status === "cancelled") continue;
    for (const k of keysOf(e, tz)) byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  for (const list of byDay.values()) list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));

  const createAt9 = (day: Date) => {
    const from = new Date(utcDayToLocalWindow(day, tz).from).getTime();
    onCreateAt(new Date(from + 9 * 3600_000), new Date(from + 10 * 3600_000));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="grid shrink-0 grid-cols-7 border-b border-border">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={cn("px-2 py-1.5 text-right text-11 font-medium text-muted-foreground", i > 0 && "border-l border-border")}>{w}</div>
        ))}
      </div>
      <div ref={grid} className="grid min-h-0 flex-1 grid-cols-7" style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}>
        {days.map((d, i) => {
          const key = utcKey(d);
          const inMonth = d.getUTCMonth() === month.getUTCMonth();
          const isToday = key === todayKey;
          const list = byDay.get(key) ?? [];
          const shown = list.length > cap ? list.slice(0, cap - 1) : list;
          const more = list.length - shown.length;
          const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
          return (
            <div
              key={key}
              onClick={(e) => { if (e.target === e.currentTarget) createAt9(d); }}
              className={cn(
                "flex min-h-0 cursor-default flex-col gap-px overflow-hidden px-1 pb-1",
                i % 7 > 0 && "border-l border-border",
                i >= 7 && "border-t border-border",
                weekend && "bg-faint/60",
              )}
            >
              <div className="flex h-7 shrink-0 items-center justify-end" onClick={(e) => { if (e.target === e.currentTarget) createAt9(d); }}>
                <button
                  type="button"
                  onClick={() => onOpenDay(d)}
                  title="Open this day"
                  className={cn(
                    "tnum inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-11 font-medium transition-colors duration-100",
                    isToday ? "bg-accent text-accent-foreground" : inMonth ? "text-foreground hover:bg-muted" : "text-muted-foreground/60 hover:bg-muted",
                  )}
                >
                  {d.getUTCDate() === 1 ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : d.getUTCDate()}
                </button>
              </div>
              {shown.map((e) => {
                const selected = e.id === selectedId;
                const faded = e.myResponse === "declined";
                const pending = !faded && (e.myResponse === "needsAction" || e.myResponse === "tentative");
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onPick(e.id)}
                    title={e.allDay ? e.title : `${e.title}, ${fmtTime(e.start, tz)}`}
                    className={cn(
                      "flex h-[1.125rem] shrink-0 items-center gap-1 rounded-sm px-1.5 text-left text-11 leading-4 transition-colors duration-100",
                      selected
                        ? "bg-foreground text-background"
                        : e.allDay
                          ? "border-l-2 border-l-foreground/45 bg-muted/80 hover:bg-muted dark:bg-foreground/[0.09]"
                          : "hover:bg-muted",
                      e.conflict && !selected && "text-warning-text",
                      faded && !selected && "text-muted-foreground line-through",
                      !inMonth && !selected && "opacity-60",
                    )}
                  >
                    {!e.allDay && <span aria-hidden className={cn("h-3 w-0.5 shrink-0 rounded-full", selected ? "bg-background/70" : e.conflict ? "bg-warning-text" : "bg-foreground/45", pending && "opacity-50")} />}
                    <span className={cn("min-w-0 flex-1 truncate", !e.allDay && "font-medium")}>{e.title}</span>
                    {!e.allDay && <span className={cn("tnum shrink-0 text-10", selected ? "text-background/70" : "text-muted-foreground")}>{fmtTimeTiny(e.start, tz)}</span>}
                  </button>
                );
              })}
              {more > 0 && (
                <button type="button" onClick={() => onOpenDay(d)} className="h-[1.125rem] shrink-0 rounded-sm px-1.5 text-left text-11 text-muted-foreground hover:bg-muted hover:text-foreground">
                  {more} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
