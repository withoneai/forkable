import { useEffect, useRef, useState } from "react";
import type { ApiEvent } from "@rill/core/api-types";
import { dayKey, fmtDay, fmtTime, layoutDay, minutesOfDay, utcDayToLocalWindow } from "@/lib/calendarLayout";
import { cn } from "@/lib/utils";
import { EventBlock } from "./EventBlock";

const HOUR_PX = 48;
const START_HOUR = 0;
const END_HOUR = 24;

/** Where a grabbed block sits now: moved as a whole, or stretched from the bottom (never under 15 minutes). */
function grabbedRange(g: Grab): { startMin: number; endMin: number } {
  if (g.mode === "resize") return { startMin: g.startMin, endMin: Math.min(24 * 60, Math.max(g.startMin + 15, g.endMin + g.minDelta)) };
  const length = g.endMin - g.startMin;
  const startMin = Math.max(0, Math.min(24 * 60 - length, g.startMin + g.minDelta));
  return { startMin, endMin: startMin + length };
}

function hourLabel(h: number): string {
  if (h === 0 || h === 24) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

interface Grab { id: string; mode: "move" | "resize"; day: number; startMin: number; endMin: number; x0: number; y0: number; dayDelta: number; minDelta: number; moved: boolean }

export function WeekGrid({
  days, events, tz, onPick, onCreateAt, onMove, selectedId,
}: {
  selectedId?: string | null;
  days: Date[];
  events: ApiEvent[];
  tz: string;
  onPick: (eventId: string) => void;
  onCreateAt: (start: Date, end: Date) => void;
  /** A block you organize was dragged or resized to a new time. */
  onMove?: (eventId: string, start: Date, end: Date) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [drag, setDrag] = useState<{ day: number; startMin: number; endMin: number} | null>(null);
  const [grab, setGrab] = useState<Grab | null>(null);
  const columns = useRef<(HTMLDivElement | null)[]>([]);
  const todayKey = dayKey(new Date().toISOString(), tz);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  // Open one hour before the earlier of "now" (when today is visible) and the first timed event.
  const firstKey = dayKey(days[0]!.toISOString(), "UTC");
  useEffect(() => {
    const visibleKeys = new Set(days.map((d) => dayKey(d.toISOString(), "UTC")));
    const starts = events.filter((e) => !e.allDay && visibleKeys.has(dayKey(e.start, tz))).map((e) => minutesOfDay(e.start, tz));
    if (visibleKeys.has(dayKey(new Date().toISOString(), tz))) starts.push(minutesOfDay(new Date().toISOString(), tz));
    const target = starts.length ? Math.max(0, Math.min(...starts) - 60) : 8 * 60;
    scroller.current?.scrollTo({ top: Math.max(0, (target / 60) * HOUR_PX - 8) });
  }, [firstKey, days.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!drag) return;
    const cancel = () => setDrag(null);
    window.addEventListener("mouseup", cancel);
    return () => window.removeEventListener("mouseup", cancel);
  }, [drag]);
  // Moving or resizing a block: 15-minute steps; a move may cross into another column. Under 4px of travel it is a click.
  useEffect(() => {
    if (!grab) return;
    const onMoveMouse = (e: MouseEvent) => {
      const minDelta = Math.round(((e.clientY - grab.y0) / HOUR_PX) * 60 / 15) * 15;
      let dayDelta = 0;
      if (grab.mode === "move") {
        const hit = columns.current.findIndex((el) => { const r = el?.getBoundingClientRect(); return r ? e.clientX >= r.left && e.clientX < r.right : false; });
        if (hit >= 0) dayDelta = hit - grab.day;
      }
      const moved = grab.moved || Math.abs(e.clientX - grab.x0) > 4 || Math.abs(e.clientY - grab.y0) > 4;
      if (minDelta !== grab.minDelta || dayDelta !== grab.dayDelta || moved !== grab.moved) setGrab({ ...grab, minDelta, dayDelta, moved });
    };
    const onUp = () => {
      if (grab.moved) {
        const { startMin, endMin } = grabbedRange(grab);
        const day = days[grab.day + grab.dayDelta] ?? days[grab.day]!;
        const dayStart = new Date(utcDayToLocalWindow(day, tz).from).getTime();
        onMove?.(grab.id, new Date(dayStart + startMin * 60_000), new Date(dayStart + endMin * 60_000));
      }
      setGrab(null);
    };
    window.addEventListener("mousemove", onMoveMouse);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMoveMouse); window.removeEventListener("mouseup", onUp); };
  }, [grab, days, tz, onMove]);

  const dayEvents = days.map((d) => {
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const matching = events.filter((e) => dayKey(e.start, tz) === key);
    return { key, allDay: matching.filter((e) => e.allDay), timed: layoutDay(matching, tz) };
  });
  const hasAllDay = dayEvents.some((d) => d.allDay.length > 0);
  const showsToday = dayEvents.some((d) => d.key === todayKey);
  const nowMinutes = minutesOfDay(now.toISOString(), tz);
  const zoneShort = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "";

  const minuteFromY = (y: number) => Math.max(0, Math.min(24 * 60, Math.round((y / HOUR_PX) * 60 / 15) * 15));
  const ghostFor = grab?.moved ? events.find((e) => e.id === grab.id) : undefined;
  const ghostRange = grab?.moved ? grabbedRange(grab) : null;
  const ghostDay = grab ? grab.day + grab.dayDelta : -1;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex border-b border-border">
        <div className="flex w-14 shrink-0 items-end justify-end pb-1.5 pr-1.5 text-10 text-muted-foreground" title={tz.replace(/_/g, " ")}>{zoneShort}</div>
        {days.map((d, i) => {
          const key = dayEvents[i]!.key;
          const isToday = key === todayKey;
          return (
            <div key={i} className="flex flex-1 items-center justify-center gap-1.5 border-l border-border px-2 py-2">
              <span className={cn("text-11 font-medium", isToday ? "text-foreground" : "text-muted-foreground")}>{fmtDay(d.toISOString(), "UTC", { weekday: "short" })}</span>
              <span className={cn("tnum inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-13 font-semibold", isToday ? "bg-accent text-accent-foreground" : "text-foreground")}>{fmtDay(d.toISOString(), "UTC", { day: "numeric" })}</span>
            </div>
          );
        })}
      </div>
      {hasAllDay && (
        <div className="flex border-b border-border">
          <div className="w-14 shrink-0 py-1 text-right text-10 text-muted-foreground">
            <span className="pr-1.5">All day</span>
          </div>
          {dayEvents.map((d, i) => (
            <div key={i} className="flex-1 flex-wrap gap-0.5 border-l border-border p-1">
              {d.allDay.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onPick(e.id)}
                  className="mb-0.5 flex h-5 w-full items-center truncate rounded-sm border-l-2 border-l-foreground/50 bg-muted/70 px-1.5 text-11 font-medium hover:bg-muted"
                >
                  {e.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="flex" style={{ height: (END_HOUR - START_HOUR) * HOUR_PX }}>
          <div className="relative w-14 shrink-0">
            {Array.from({ length: END_HOUR - START_HOUR }).map((_, h) => (
              <div key={h} style={{ height: HOUR_PX }} className="relative">
                <span className={cn("absolute -top-[7px] right-1.5 text-10 text-muted-foreground", showsToday && Math.abs(h * 60 - nowMinutes) < 15 && "invisible")}>{h === 0 ? "" : hourLabel(h)}</span>
              </div>
            ))}
            {showsToday && (
              <span className="tnum absolute right-1.5 -translate-y-1/2 text-10 font-semibold text-accent" style={{ top: (nowMinutes / 60) * HOUR_PX }}>{fmtTime(now.toISOString(), tz)}</span>
            )}
          </div>
          {dayEvents.map((d, i) => {
            const isToday = d.key === todayKey;
            const nowMin = minutesOfDay(now.toISOString(), tz);
            return (
              <div
                key={i}
                ref={(el) => { columns.current[i] = el; }}
                className={cn("relative flex-1 border-l border-border", isToday && "bg-accent/[0.04]")}
                onMouseDown={(e) => {
                  // Only empty grid space starts a create; an event block is a click target of its own.
                  if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const startMin = minuteFromY(e.clientY - rect.top);
                  setDrag({ day: i, startMin, endMin: startMin + 30 });
                }}
                onMouseMove={(e) => {
                  if (!drag || drag.day !== i) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const m = minuteFromY(e.clientY - rect.top);
                  const endMin = Math.max(drag.startMin + 15, m);
                  if (endMin !== drag.endMin) setDrag({ ...drag, endMin });
                }}
                onMouseUp={() => {
                  if (!drag || drag.day !== i) return;
                  const dayStart = new Date(utcDayToLocalWindow(days[i]!, tz).from).getTime();
                  onCreateAt(new Date(dayStart + drag.startMin * 60_000), new Date(dayStart + drag.endMin * 60_000));
                  setDrag(null);
                }}
              >
                {Array.from({ length: END_HOUR - START_HOUR }).map((_, h) => (
                  <div key={h} style={{ height: HOUR_PX }} className="border-b border-border/70" />
                ))}
                {drag && drag.day === i && (
                  <div
                    className="pointer-events-none absolute inset-x-0.5 rounded-sm bg-accent/20 ring-1 ring-accent"
                    style={{ top: (drag.startMin / 60) * HOUR_PX, height: ((drag.endMin - drag.startMin) / 60) * HOUR_PX }}
                  />
                )}
                {ghostFor && ghostRange && ghostDay === i && (
                  <EventBlock
                    event={ghostFor}
                    tz={tz}
                    onClick={() => undefined}
                    dense={ghostRange.endMin - ghostRange.startMin < 45}
                    tall={ghostRange.endMin - ghostRange.startMin >= 60}
                    selected
                    style={{ top: (ghostRange.startMin / 60) * HOUR_PX, height: Math.max(16, ((ghostRange.endMin - ghostRange.startMin) / 60) * HOUR_PX) - 2, left: 0, width: "calc(100% - 4px)", zIndex: 20, pointerEvents: "none" }}
                  />
                )}
                {d.timed.map((t) => (
                  <EventBlock
                    key={t.event.id}
                    event={t.event}
                    tz={tz}
                    onClick={() => onPick(t.event.id)}
                    dense={t.endMin - t.startMin < 45}
                    tall={t.endMin - t.startMin >= 60}
                    selected={t.event.id === selectedId}
                    ghost={grab?.moved && grab.id === t.event.id}
                    onGrab={t.event.editable && onMove ? (mode, e) => setGrab({ id: t.event.id, mode, day: i, startMin: t.startMin, endMin: t.endMin, x0: e.clientX, y0: e.clientY, dayDelta: 0, minDelta: 0, moved: false }) : undefined}
                    style={{
                      top: (t.startMin / 60) * HOUR_PX,
                      height: Math.max(16, ((t.endMin - t.startMin) / 60) * HOUR_PX) - 2,
                      left: `${(t.column / t.columns) * 100}%`,
                      width: t.columns > 1 ? `calc(${100 / t.columns}% - 2px)` : "calc(100% - 4px)",
                    }}
                  />
                ))}
                {isToday && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: (nowMin / 60) * HOUR_PX }}>
                    <span className="-ml-1 size-1.5 rounded-full bg-accent" />
                    <span className="h-px flex-1 bg-accent" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
