import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { useOneQuery } from "../lib/one-client";
import { Button, ErrorState, SourceChip } from "../lib/one-ui";
import { addDays, dayKey, fmtClock, fmtDay, fmtRange, fmtTime, keyOf, minutesOfDay, sameDay, startOfWeek, zone, zoneShort } from "../google-calendar/time";
import type { CalEvent } from "../google-calendar/types";

const HOUR_REM = 3.5;
const DAY_MIN = 24 * 60;

export interface GoogleCalendarWeekProps {
  selectedId?: string | null;
  onSelect?: (event: CalEvent) => void;
  /** Click an empty spot to start an event there (30 minutes). */
  onCreateAt?: (start: Date, end: Date) => void;
  /** An event being made (from a drag or the New event form), drawn as a shaded block. */
  draft?: { start: Date; end: Date } | null;
  /** Bump to refetch, for example after creating an event. */
  refreshKey?: number;
  className?: string;
}

/** A Monday-to-Sunday week of the user's Google Calendar, with a line at now. Reads on their grant. */
export function GoogleCalendarWeek({ selectedId, onSelect, onCreateAt, draft, refreshKey = 0, className }: GoogleCalendarWeekProps) {
  // Drag on an empty spot to draw a new event; a plain click makes 30 minutes.
  const [drag, setDrag] = useState<{ day: number; from: number; to: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<{ day: number; minute: number } | null>(null);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const end = addDays(weekStart, 7);
  const { data, meta, loading, error, reload } = useOneQuery<CalEvent[]>(
    `/api/calendar/events?from=${encodeURIComponent(weekStart.toISOString())}&to=${encodeURIComponent(end.toISOString())}&tz=${encodeURIComponent(zone())}&r=${refreshKey}`,
  );

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Open the grid an hour before the first event of the week, or at 8 AM.
  const scroller = useRef<HTMLDivElement>(null);
  const firstMinute = useMemo(() => {
    const starts = (data ?? []).filter((e) => !e.allDay).map((e) => minutesOfDay(e.start));
    return starts.length ? Math.min(...starts) : 8 * 60;
  }, [data]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !data) return;
    const hour = Math.max(0, Math.floor(firstMinute / 60) - 1);
    el.scrollTop = Math.max(0, (hour / 24) * el.scrollHeight - 8);
  }, [weekStart, data === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = days.map((d) => {
    const key = keyOf(d);
    const mine = (data ?? []).filter((e) => dayKey(e.start, e.allDay) === key);
    return { day: d, allDay: mine.filter((e) => e.allDay), timed: layout(mine.filter((e) => !e.allDay)) };
  });
  const hasAllDay = columns.some((c) => c.allDay.length > 0);
  const thisWeek = days.some((d) => sameDay(d, now));
  const nowPct = (minutesOfDay(now.toISOString()) / DAY_MIN) * 100;
  const last = days[6]!;
  // The month most of the week is in, the way a wall calendar would title it.
  const month = fmtDay(addDays(weekStart, 3), { month: "long", year: "numeric" });
  const range = `${fmtDay(weekStart, { month: "short", day: "numeric" })} to ${fmtDay(last, weekStart.getMonth() === last.getMonth() ? { day: "numeric" } : { month: "short", day: "numeric" })}`;
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const minuteAt = (el: HTMLElement, clientY: number, step: number) => {
    const rect = el.getBoundingClientRect();
    const m = ((clientY - rect.top) / rect.height) * DAY_MIN;
    return Math.max(0, Math.min(DAY_MIN - step, Math.floor(m / step) * step));
  };
  const finish = () => {
    if (!drag) return;
    const day = days[drag.day]!;
    const a = Math.min(drag.from, drag.to);
    const b = drag.moved ? Math.max(drag.from, drag.to) + 15 : a + 30;
    setDrag(null);
    onCreateAt?.(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, a), new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, b));
  };

  return (
    <div data-block="google-calendar-week" className={clsx("flex min-h-0 flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-15 font-semibold text-foreground">{month}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{range}</span>
        <SourceChip meta={meta} />
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))} className={clsx(thisWeek && "text-muted-foreground")}>
            Today
          </Button>
          <Button variant="ghost" size="sm" icon aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" icon aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {error ? (
        <div className="p-3">
          <ErrorState error={error} onRetry={reload} />
        </div>
      ) : (
        <>
          <div className="flex border-b border-border">
            <div className="flex w-14 shrink-0 items-end justify-end pr-1.5 pb-1.5 text-10 text-muted-foreground" title={zone().replace(/_/g, " ")}>
              {zoneShort(now)}
            </div>
            {days.map((d) => {
              const today = sameDay(d, now);
              return (
                <div key={keyOf(d)} className={clsx("flex min-w-0 flex-1 items-center justify-center gap-1.5 border-l border-border py-2", isWeekend(d) && "bg-foreground/2")}>
                  <span className={clsx("text-11", today ? "font-medium text-foreground" : "text-muted-foreground")}>{fmtDay(d, { weekday: "short" })}</span>
                  <span
                    className={clsx(
                      "inline-flex size-6 items-center justify-center rounded-full text-13 font-semibold tabular-nums",
                      today ? "bg-primary text-primary-foreground" : "text-foreground",
                    )}
                  >
                    {d.getDate()}
                  </span>
                </div>
              );
            })}
          </div>

          {hasAllDay && (
            <div className="flex border-b border-border">
              <div className="w-14 shrink-0 py-1 pr-1.5 text-right text-10 text-muted-foreground">All day</div>
              {columns.map((c) => (
                <div key={keyOf(c.day)} className="flex min-w-0 flex-1 flex-col gap-0.5 border-l border-border p-0.5">
                  {c.allDay.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => onSelect?.(e)}
                      className={clsx(
                        "truncate rounded-sm border-l-3 px-1.5 py-0.5 text-left text-11 font-medium transition-colors",
                        selectedId === e.id ? "border-l-primary-press bg-primary text-primary-foreground" : "border-l-foreground/40 bg-foreground/7 text-foreground hover:bg-foreground/11",
                      )}
                    >
                      {e.title}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div ref={scroller} className={clsx("relative min-h-0 flex-1 overflow-y-auto", loading && !data && "animate-pulse")}>
            <div className="flex" style={{ height: `${24 * HOUR_REM}rem` }}>
              <div className="relative w-14 shrink-0">
                {Array.from({ length: 23 }, (_, i) => i + 1)
                  .filter((h) => !thisWeek || Math.abs(h * 60 - nowMinute) > 14)
                  .map((h) => (
                    <span key={h} className="absolute right-2 -translate-y-1/2 text-10 text-muted-foreground tabular-nums" style={{ top: `${(h / 24) * 100}%` }}>
                      {fmtTime(new Date(2000, 0, 1, h))}
                    </span>
                  ))}
                {thisWeek && (
                  <span className="absolute right-2 z-10 -translate-y-1/2 text-10 font-semibold text-accent tabular-nums" style={{ top: `${nowPct}%` }}>
                    {fmtTime(now)}
                  </span>
                )}
              </div>
              {columns.map((c) => {
                const today = sameDay(c.day, now);
                return (
                  <div
                    key={keyOf(c.day)}
                    className={clsx("relative min-w-0 flex-1 cursor-cell touch-pan-y border-l border-border select-none", today ? "bg-accent/4" : isWeekend(c.day) && "bg-foreground/2")}
                    onPointerDown={(ev) => {
                      if (!onCreateAt || ev.button !== 0 || ev.target !== ev.currentTarget) return;
                      ev.currentTarget.setPointerCapture(ev.pointerId);
                      const m = minuteAt(ev.currentTarget, ev.clientY, 15);
                      setDrag({ day: columns.indexOf(c), from: m, to: m, moved: false });
                      setHover(null);
                    }}
                    onPointerMove={(ev) => {
                      if (drag && drag.day === columns.indexOf(c)) {
                        const m = minuteAt(ev.currentTarget, ev.clientY, 15);
                        if (m !== drag.to) setDrag({ ...drag, to: m, moved: true });
                      } else if (!drag && onCreateAt && ev.pointerType === "mouse") {
                        if (ev.target !== ev.currentTarget) return setHover(null);
                        setHover({ day: columns.indexOf(c), minute: minuteAt(ev.currentTarget, ev.clientY, 30) });
                      }
                    }}
                    onPointerUp={finish}
                    onPointerCancel={() => setDrag(null)}
                    onPointerLeave={() => setHover(null)}
                  >
                    {Array.from({ length: 23 }, (_, i) => (
                      <div key={i} className="pointer-events-none absolute inset-x-0 border-t border-border/50" style={{ top: `${((i + 1) / 24) * 100}%` }} />
                    ))}
                    {hover && hover.day === columns.indexOf(c) && !drag && (
                      <div
                        className="pointer-events-none absolute inset-x-0.5 rounded-sm bg-foreground/5"
                        style={{ top: `${(hover.minute / DAY_MIN) * 100}%`, height: `${(30 / DAY_MIN) * 100}%` }}
                      />
                    )}
                    {(() => {
                      const i = columns.indexOf(c);
                      const g = drag && drag.day === i
                        ? { a: Math.min(drag.from, drag.to), b: drag.moved ? Math.max(drag.from, drag.to) + 15 : Math.min(drag.from, drag.to) + 30 }
                        : !drag && draft && sameDay(draft.start, c.day)
                          ? { a: draft.start.getHours() * 60 + draft.start.getMinutes(), b: draft.start.getHours() * 60 + draft.start.getMinutes() + Math.max(15, (draft.end.getTime() - draft.start.getTime()) / 60_000) }
                          : null;
                      if (!g) return null;
                      const at = (m: number) => new Date(c.day.getFullYear(), c.day.getMonth(), c.day.getDate(), 0, m);
                      return (
                        <div
                          aria-hidden
                          className="pointer-events-none absolute z-20 flex flex-col gap-0.5 overflow-hidden rounded-sm border border-accent border-l-3 bg-primary/30 px-1.5 py-1 shadow-soft"
                          style={{ top: `calc(${(g.a / DAY_MIN) * 100}% + 1px)`, height: `calc(${(Math.min(g.b, DAY_MIN) - g.a) / DAY_MIN * 100}% - 2px)`, left: 2, right: 2 }}
                        >
                          <span className="truncate text-11 font-medium leading-tight text-foreground">New event</span>
                          <span className="truncate text-10 text-foreground/70 tabular-nums">{fmtRange(at(g.a).toISOString(), at(Math.min(g.b, DAY_MIN)).toISOString())}</span>
                        </div>
                      );
                    })()}
                    {c.timed.map(({ event: e, col, cols }) => {
                      const top = minutesOfDay(e.start);
                      const length = Math.max(15, (new Date(e.end).getTime() - new Date(e.start).getTime()) / 60_000);
                      const oneLine = length < 50;
                      const tiny = length < 25;
                      const selected = selectedId === e.id;
                      const cancelled = e.status === "cancelled" || e.myResponse === "declined";
                      const pending = e.myResponse === "needsAction" && !cancelled;
                      const past = e.end < now.toISOString();
                      return (
                        <button
                          key={e.id}
                          onClick={() => onSelect?.(e)}
                          title={`${e.title}, ${fmtTime(e.start)} to ${fmtTime(e.end)}${pending ? ", needs your reply" : ""}`}
                          className={clsx(
                            "@container absolute flex overflow-hidden rounded-sm border-l-3 px-1.5 text-left transition-colors",
                            oneLine ? "items-center gap-1" : "flex-col gap-0.5 py-1",
                            selected
                              ? "border-l-primary-press bg-primary text-primary-foreground shadow-soft"
                              : pending
                                ? "border border-dashed border-strong border-l-strong bg-raised text-foreground hover:border-muted-foreground"
                                : cancelled
                                  ? "border-l-muted-foreground/30 bg-foreground/3 text-muted-foreground"
                                  : "border-l-foreground/40 bg-foreground/7 text-foreground hover:bg-foreground/11",
                            past && !selected && "opacity-60",
                          )}
                          style={{
                            top: `calc(${(top / DAY_MIN) * 100}% + 1px)`,
                            height: `calc(${(Math.min(length, DAY_MIN - top) / DAY_MIN) * 100}% - 2px)`,
                            left: `calc(${(col / cols) * 100}% + ${col ? 1 : 2}px)`,
                            width: `calc(${100 / cols}% - ${cols > 1 ? 3 : 4}px)`,
                          }}
                        >
                          <span className={clsx("min-w-0 font-medium leading-tight", tiny ? "text-10" : "text-11", oneLine ? "truncate" : "line-clamp-1 @[6rem]:line-clamp-2", cancelled && "line-through")}>{e.title}</span>
                          <span
                            className={clsx(
                              "shrink-0 text-10 tabular-nums",
                              selected ? "text-primary-foreground/70" : "text-muted-foreground",
                              oneLine ? "hidden @[7.5rem]:inline" : "truncate",
                            )}
                          >
                            {oneLine ? fmtClock(e.start) : fmtRange(e.start, e.end)}
                          </span>
                        </button>
                      );
                    })}
                    {today && (
                      <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: `${nowPct}%` }}>
                        <span className="-ml-1 size-2 rounded-full bg-accent ring-2 ring-card" />
                        <span className="h-0.5 flex-1 bg-accent" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

/** Side-by-side columns for events that overlap, the way every calendar does it. */
function layout(events: CalEvent[]): { event: CalEvent; col: number; cols: number }[] {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
  const out: { event: CalEvent; col: number; cols: number }[] = [];
  let cluster: { event: CalEvent; col: number; cols: number }[] = [];
  let clusterEnd = "";
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((x) => x.col + 1));
    for (const x of cluster) out.push({ ...x, cols });
    cluster = [];
    clusterEnd = "";
  };
  for (const e of sorted) {
    if (cluster.length && e.start >= clusterEnd) flush();
    const taken = new Set(cluster.filter((x) => x.event.end > e.start).map((x) => x.col));
    let col = 0;
    while (taken.has(col)) col++;
    cluster.push({ event: e, col, cols: 1 });
    if (e.end > clusterEnd) clusterEnd = e.end;
  }
  if (cluster.length) flush();
  return out;
}
