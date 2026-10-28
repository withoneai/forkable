import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Video } from "lucide-react";
import clsx from "clsx";
import { useOneQuery } from "../lib/one-client";
import { ErrorState, Skeleton, SourceChip } from "../lib/one-ui";
import { addDays, dayKey, dayLabel, fmtDay, fmtTime, keyOf, sameDay, startOfDay, zone } from "../google-calendar/time";
import type { CalEvent } from "../google-calendar/types";

export interface GoogleCalendarAgendaProps {
  /** How many days to show, starting today. */
  days?: number;
  selectedId?: string | null;
  onSelect?: (event: CalEvent) => void;
  /** Bump to refetch, for example after creating an event. */
  refreshKey?: number;
  className?: string;
}

/** The user's upcoming Google Calendar events, grouped by day. Reads on their grant. */
export function GoogleCalendarAgenda({ days = 7, selectedId, onSelect, refreshKey = 0, className }: GoogleCalendarAgendaProps) {
  const from = startOfDay(new Date());
  const to = addDays(from, days);
  const { data, meta, loading, error, reload } = useOneQuery<CalEvent[]>(
    `/api/calendar/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&tz=${encodeURIComponent(zone())}&r=${refreshKey}`,
  );

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const groups = useMemo(() => {
    const out: { day: Date; events: CalEvent[] }[] = [];
    for (let i = 0; i < days; i++) {
      const day = addDays(from, i);
      const key = keyOf(day);
      const events = (data ?? []).filter((e) => dayKey(e.start, e.allDay) === key);
      if (events.length) out.push({ day, events: [...events].sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start)) });
    }
    return out;
  }, [data, days, from.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const nowIso = now.toISOString();

  return (
    <div data-block="google-calendar-agenda" className={clsx("flex min-h-0 flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <CalendarDays className="size-4 text-muted-foreground" />
        <span className="text-13 font-medium text-foreground">Next {days} days</span>
        <span className="ml-auto">
          <SourceChip meta={meta} />
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !data ? (
          <div className="flex flex-col gap-4 p-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="p-3">
            <ErrorState error={error} onRetry={reload} />
          </div>
        ) : groups.length === 0 ? (
          <p className="p-3 text-13 text-muted-foreground">Nothing on the calendar for the next {days} days.</p>
        ) : (
          groups.map((g) => {
            const today = sameDay(g.day, now);
            const label = dayLabel(g.day);
            const relative = label === "Today" || label === "Tomorrow";
            return (
              <section key={keyOf(g.day)} className="pb-2">
                <h3 className="sticky top-0 z-10 flex items-baseline gap-1.5 bg-card/95 px-3 pt-3 pb-1.5 backdrop-blur-sm">
                  <span className={clsx("text-xs font-semibold", today ? "text-foreground" : "text-foreground/90")}>{relative ? label : fmtDay(g.day, { weekday: "long" })}</span>
                  <span className="text-xs text-muted-foreground">{fmtDay(g.day, { month: "short", day: "numeric" })}</span>
                  <span className="ml-auto text-11 text-muted-foreground tabular-nums">
                    {g.events.length} {g.events.length === 1 ? "event" : "events"}
                  </span>
                </h3>
                <ul className="flex flex-col px-1.5">
                  {g.events.map((e) => (
                    <AgendaRow key={e.id} event={e} nowIso={nowIso} selected={selectedId === e.id} onSelect={onSelect} />
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

function AgendaRow({ event: e, nowIso, selected, onSelect }: { event: CalEvent; nowIso: string; selected: boolean; onSelect?: (e: CalEvent) => void }) {
  const past = !e.allDay && e.end < nowIso;
  const live = !e.allDay && e.start <= nowIso && e.end > nowIso;
  const cancelled = e.status === "cancelled" || e.myResponse === "declined";
  const pending = e.myResponse === "needsAction" && !cancelled;
  const guests = e.attendees.filter((a) => !a.self).length;
  const meta = [e.location && !/^https?:/.test(e.location) ? e.location : null, guests ? `${guests} ${guests === 1 ? "guest" : "guests"}` : null].filter(Boolean).join(" · ");

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect?.(e)}
        onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), onSelect?.(e))}
        className={clsx(
          "group flex cursor-pointer items-stretch gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors focus-visible:outline-offset-0",
          selected ? "bg-foreground/6 ring-1 ring-accent/50 ring-inset" : "hover:bg-foreground/4",
          past && !selected && "opacity-55",
        )}
      >
        <span
          aria-hidden
          className={clsx(
            "w-0.75 shrink-0 rounded-full",
            live ? "bg-accent" : pending ? "border border-dashed border-strong" : cancelled ? "bg-muted-foreground/30" : "bg-foreground/45",
          )}
        />
        <span className="flex w-16 shrink-0 flex-col gap-0.5 pt-px text-xs tabular-nums">
          {e.allDay ? (
            <span className="text-muted-foreground">All day</span>
          ) : (
            <>
              <span className="text-foreground">{fmtTime(e.start)}</span>
              <span className="text-11 text-muted-foreground">{fmtTime(e.end)}</span>
            </>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 pt-px">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={clsx("truncate text-13 font-medium", cancelled ? "text-muted-foreground line-through" : "text-foreground")}>{e.title}</span>
            {live && <span className="shrink-0 rounded-sm bg-primary px-1 py-px text-10 font-semibold text-primary-foreground">Now</span>}
          </span>
          {(meta || pending || cancelled) && (
            <span className="flex min-w-0 items-center gap-1.5 text-11 text-muted-foreground">
              {pending && <span className="shrink-0 text-foreground">Needs your reply</span>}
              {cancelled && <span className="shrink-0">{e.status === "cancelled" ? "Cancelled" : "Declined"}</span>}
              {meta && (pending || cancelled) && <span aria-hidden>·</span>}
              {meta && <span className="truncate">{meta}</span>}
            </span>
          )}
        </span>
        {e.joinUrl && !cancelled && !past && (
          <a
            href={e.joinUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(ev) => ev.stopPropagation()}
            className={clsx(
              "inline-flex h-7 shrink-0 items-center gap-1.5 self-center rounded-md px-2 text-xs font-medium transition-colors",
              live ? "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-press" : "border border-border bg-raised text-foreground hover:border-strong",
            )}
          >
            <Video className="size-3.5" /> Join
          </a>
        )}
      </div>
    </li>
  );
}
