import type { ApiEvent } from "@rill/core/api-types";
import { dayKey, fmtDay, fmtRange } from "@/lib/calendarLayout";
import { cn } from "@/lib/utils";
import { EmptyState } from "../ui/EmptyState";
import { Calendar as CalendarIcon } from "lucide-react";

export function Agenda({ events, tz, onPick }: { events: ApiEvent[]; tz: string; onPick: (eventId: string) => void }) {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  const groups = new Map<string, ApiEvent[]>();
  for (const e of sorted) {
    const k = dayKey(e.start, tz);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(e);
  }
  if (sorted.length === 0) return <EmptyState icon={<CalendarIcon />} title="Nothing on the calendar" detail="This window is clear." />;
  const todayKey = dayKey(new Date().toISOString(), tz);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[640px] flex-col gap-5 px-6 py-5">
        {[...groups.entries()].map(([k, es]) => (
          <div key={k}>
            <p className={cn("label-caps mb-1.5", k === todayKey && "text-foreground")}>{fmtDay(es[0]!.start, tz, { weekday: "long", month: "short", day: "numeric" })}{k === todayKey ? " · Today" : ""}</p>
            <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
              {es.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onPick(e.id)}
                  className="flex h-10 w-full items-center gap-3 border-b border-border px-3 text-left last:border-b-0 transition-colors hover:bg-card-hover"
                >
                  <span className="tnum w-[136px] shrink-0 whitespace-nowrap text-xs text-muted-foreground">{e.allDay ? "All day" : fmtRange(e.start, e.end, tz)}</span>
                  <span className={cn("min-w-0 flex-1 truncate text-13", e.status === "cancelled" && "text-muted-foreground line-through")}>{e.title}</span>
                  {e.conflict && <span className="shrink-0 text-11 text-warning-text">Overlaps {e.conflict.title}</span>}
                  {e.myResponse === "needsAction" && e.status !== "cancelled" && <span className="shrink-0 text-11 text-muted-foreground">Waiting on your reply</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
