import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMailboxId } from "@/lib/mailbox";
import { useCalendar, usePatchEvent, useSettings } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { fmtDay, fmtTime } from "@/lib/calendarLayout";
import { useKeys } from "@/lib/keys";
import { addDays, addMonths, localDay, monthGridDays, startOfMonth, startOfWeek, utcDayToLocalWindow, utcKey } from "@/lib/calendarLayout";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Kbd } from "@/components/ui/Kbd";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";
import { Tabs } from "@/components/ui/Tabs";
import { WeekGrid } from "@/components/calendar/WeekGrid";
import { Agenda } from "@/components/calendar/Agenda";
import { EventCard, type PendingChange } from "@/components/calendar/EventCard";
import { QuickCreate, type QuickCreateRange } from "@/components/calendar/QuickCreate";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { MiniMonth } from "@/components/calendar/MiniMonth";

type View = "week" | "day" | "month" | "agenda";

/** A UTC-midnight day key as an instant safely inside that local day, for the anchor. */
const midday = (day: Date) => new Date(day.getTime() + 12 * 3600_000);

export function Calendar() {
  const mailboxId = useMailboxId();
  const settingsQ = useSettings(mailboxId);
  const tz = settingsQ.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [anchor, setAnchor] = useState(() => new Date());
  const [view, setView] = useState<View>("week");
  const [days, setDays] = useState(7);
  const [picked, setPicked] = useState<string | null>(null);
  const [dropped, setDropped] = useState<PendingChange | null>(null);
  const patch = usePatchEvent(mailboxId);
  // A drag of your own event: saved at once when nobody else is invited, otherwise the card asks about telling the guests.
  const onMove = (eventId: string, start: Date, end: Date) => {
    const ev = q.data?.events.find((e) => e.id === eventId);
    if (!ev) return;
    const input = { start: start.toISOString(), end: end.toISOString(), timeZone: tz };
    if (ev.attendees.some((a) => !a.self)) { setPicked(eventId); setDropped(input); return; }
    patch.mutate({ eventId, input: { ...input, notify: "none" } }, {
      onSuccess: () => toast({ title: "Moved", detail: `${fmtDay(input.start, tz)} · ${fmtTime(input.start, tz)} → ${fmtTime(input.end, tz)}` }),
      onError: (e) => toast({ title: "Not moved", detail: e.message, tone: "destructive" }),
    });
  };
  const [create, setCreate] = useState<QuickCreateRange | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("create") === "1") { setCreate(null); setCreateOpen(true); setParams({}, { replace: true }); }
  }, [params, setParams]);

  const weekStart = useMemo(() => startOfWeek(anchor, tz), [anchor, tz]);
  const month = useMemo(() => startOfMonth(anchor, tz), [anchor, tz]);
  const monthDays = useMemo(() => monthGridDays(month), [month]);
  const visibleDays = useMemo(() => {
    if (view === "day") return [localDay(anchor, tz)];
    if (view === "month") return monthDays;
    return Array.from({ length: days }, (_, i) => addDays(weekStart, i));
  }, [view, days, weekStart, anchor, tz, monthDays]);
  const visibleKeys = useMemo(() => new Set((view === "month" ? [] : view === "agenda" ? Array.from({ length: 14 }, (_, i) => addDays(weekStart, i)) : visibleDays).map(utcKey)), [view, monthDays, month, visibleDays, weekStart]);
  const [jumpOpen, setJumpOpen] = useState(false);
  const jumpRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!jumpOpen) return;
    const close = (e: MouseEvent) => { if (!jumpRef.current?.contains(e.target as Node)) setJumpOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setJumpOpen(false); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", esc); };
  }, [jumpOpen]);
  const jumpTo = (day: Date) => { setAnchor(midday(day)); setJumpOpen(false); };

  const windowFrom = utcDayToLocalWindow(visibleDays[0]!, tz).from;
  const windowTo = utcDayToLocalWindow(view === "agenda" ? addDays(weekStart, 13) : visibleDays[visibleDays.length - 1]!, tz).to;
  const q = useCalendar(mailboxId, windowFrom, windowTo);

  const go = (delta: number) => setAnchor((d) => (view === "month" ? midday(addMonths(localDay(d, tz), delta)) : addDays(d, view === "day" ? delta : delta * days)));

  useKeys({
    "1": () => { setView("week"); setDays(1); },
    "2": () => { setView("week"); setDays(2); },
    "3": () => { setView("week"); setDays(3); },
    "4": () => { setView("week"); setDays(4); },
    "5": () => { setView("week"); setDays(5); },
    "6": () => { setView("week"); setDays(6); },
    "7": () => { setView("week"); setDays(7); },
    d: () => setView("day"),
    m: () => setView("month"),
    a: () => setView("agenda"),
    t: () => setAnchor(new Date()),
    "[": () => go(-1),
    "]": () => go(1),
    c: () => { setCreate(null); setCreateOpen(true); },
  });

  return (
    <div className="flex min-h-0 flex-1">
      <aside aria-label="Jump to a date" className={cn("hidden w-60 shrink-0 flex-col border-r border-border px-2 pt-2", !picked && "2xl:flex")}>
        <MiniMonth anchor={anchor} tz={tz} visible={visibleKeys} onPick={jumpTo} />
      </aside>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
          <Button size="sm" onClick={() => setAnchor(new Date())} title="Today (T)">Today</Button>
          <div className="flex items-center">
            <IconButton label="Previous" hint="[" size="sm" onClick={() => go(-1)}><ChevronLeft /></IconButton>
            <IconButton label="Next" hint="]" size="sm" onClick={() => go(1)}><ChevronRight /></IconButton>
          </div>
          <div ref={jumpRef} className="relative min-w-0 flex-1">
            <h1 className="min-w-0">
              <button type="button" onClick={() => setJumpOpen((o) => !o)} aria-expanded={jumpOpen} title="Jump to a date" className="inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-13 font-semibold hover:bg-muted">
                <span className="truncate">{(view === "day" ? localDay(anchor, tz) : view === "month" ? month : weekStart).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</span>
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </h1>
            {jumpOpen && (
              <div className="pop-in absolute left-0 top-full z-30 mt-1 w-60 rounded-lg border border-border bg-card p-2 shadow-float">
                <MiniMonth anchor={anchor} tz={tz} visible={visibleKeys} onPick={jumpTo} />
              </div>
            )}
          </div>
          <Tabs
            value={view === "week" && days === 1 ? "day" : view}
            onChange={(v) => { if (v === "week" && days === 1) setDays(7); setView(v); }}
            size="sm"
            options={[
              { key: "day" as View, label: "Day" },
              { key: "week" as View, label: days === 7 || days === 1 ? "Week" : `${days} days` },
              { key: "month" as View, label: "Month" },
              { key: "agenda" as View, label: "Agenda" },
            ]}
          />
          <Button size="sm" icon={<Plus />} onClick={() => { setCreate(null); setCreateOpen(true); }} trailing={<Kbd className="h-4 min-w-4 bg-transparent px-1 text-10 shadow-none">C</Kbd>}>New event</Button>
        </header>

        {q.isPending ? (
          <div className="flex flex-1 flex-col gap-2 p-4" aria-busy>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-full w-full" />
          </div>
        ) : q.isError || !q.data ? (
          <LoadError what="The calendar" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} className="flex-1" />
        ) : view === "month" ? (
          <MonthGrid
            month={month}
            days={monthDays}
            events={q.data.events}
            tz={tz}
            selectedId={picked}
            onPick={setPicked}
            onOpenDay={(d) => { setAnchor(midday(d)); setView("day"); }}
            onCreateAt={(start, end) => { setCreate({ start, end }); setCreateOpen(true); }}
          />
        ) : view === "agenda" ? (
          <Agenda events={q.data.events} tz={tz} onPick={setPicked} />
        ) : (
          <WeekGrid
            days={visibleDays}
            events={q.data.events}
            tz={tz}
            onPick={setPicked}
            selectedId={picked}
            onCreateAt={(start, end) => { setCreate({ start, end }); setCreateOpen(true); }}
            onMove={onMove}
          />
        )}
        <p className={cn("shrink-0 border-t border-border px-3 py-1 text-11 text-muted-foreground", (view === "agenda" || view === "month") && "hidden")}>
          Drag on the grid to create an event, or press <Kbd className="mx-0.5 h-4 min-w-4 px-1 text-10">C</Kbd> to describe one. Times in {tz.replace(/_/g, " ")}.
        </p>
      </div>
      {picked && <EventCard mailboxId={mailboxId} eventId={picked} tz={tz} dropped={dropped} onClose={() => { setPicked(null); setDropped(null); }} />}
      <QuickCreate mailboxId={mailboxId} open={createOpen} onClose={() => setCreateOpen(false)} tz={tz} initialRange={create} />
    </div>
  );
}
