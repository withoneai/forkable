import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, addMonths, dayKey, monthGridDays, startOfMonth, utcKey } from "@/lib/calendarLayout";
import { cn } from "@/lib/utils";
import { IconButton } from "../ui/IconButton";

/**
 * The small month in Notion Calendar's sidebar: page months with the arrows,
 * click any date to jump there. The days on screen get a quiet band, today
 * the accent pill. Paging the mini month never moves the main view.
 */
export function MiniMonth({ anchor, tz, visible, onPick, className }: {
  anchor: Date; tz: string; visible: Set<string>; onPick: (day: Date) => void; className?: string;
}) {
  const [month, setMonth] = useState(() => startOfMonth(anchor, tz));
  const anchorMonth = utcKey(startOfMonth(anchor, tz));
  useEffect(() => { setMonth(startOfMonth(anchor, tz)); }, [anchorMonth]); // eslint-disable-line react-hooks/exhaustive-deps
  const days = monthGridDays(month);
  const todayKey = dayKey(new Date().toISOString(), tz);

  return (
    <div className={cn("flex flex-col gap-1 select-none", className)}>
      <div className="flex items-center gap-1 pl-1.5">
        <span className="flex-1 text-xs font-semibold">{month.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</span>
        <IconButton label="Previous month" size="sm" onClick={() => setMonth((m) => addMonths(m, -1))}><ChevronLeft /></IconButton>
        <IconButton label="Next month" size="sm" onClick={() => setMonth((m) => addMonths(m, 1))}><ChevronRight /></IconButton>
      </div>
      <div className="grid grid-cols-7 text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => (
          <span key={i} className="py-1 text-10 font-medium text-muted-foreground">{w}</span>
        ))}
        {days.map((d) => {
          const key = utcKey(d);
          const isToday = key === todayKey;
          const inMonth = d.getUTCMonth() === month.getUTCMonth();
          const onScreen = visible.has(key);
          const bandStart = onScreen && (d.getUTCDay() === 0 || !visible.has(utcKey(addDays(d, -1))));
          const bandEnd = onScreen && (d.getUTCDay() === 6 || !visible.has(utcKey(addDays(d, 1))));
          return (
            <div key={key} className={cn("flex items-center justify-center py-px", onScreen && "bg-muted", bandStart && "rounded-l-full", bandEnd && "rounded-r-full")}>
              <button
                type="button"
                onClick={() => onPick(d)}
                aria-label={d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}
                className={cn(
                  "tnum inline-flex size-6 items-center justify-center rounded-full text-11 transition-colors duration-100",
                  isToday ? "bg-accent font-semibold text-accent-foreground" : inMonth ? "text-foreground hover:bg-foreground/10" : "text-muted-foreground/50 hover:bg-foreground/10",
                )}
              >
                {d.getUTCDate()}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
