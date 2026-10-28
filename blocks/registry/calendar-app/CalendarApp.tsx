import { useState } from "react";
import { CalendarClock, Plus } from "lucide-react";
import { GoogleCalendarWeek } from "../google-calendar-week/GoogleCalendarWeek";
import { GoogleCalendarAgenda } from "../google-calendar-agenda/GoogleCalendarAgenda";
import { GoogleCalendarEvent } from "../google-calendar-event/GoogleCalendarEvent";
import { GoogleCalendarNewEvent } from "../google-calendar-new-event/GoogleCalendarNewEvent";
import { GoogleCalendarOfferTimes } from "../google-calendar-offer-times/GoogleCalendarOfferTimes";
import { Button } from "../lib/one-ui";
import type { CalEvent } from "../google-calendar/types";


/** A whole calendar from the Google Calendar components. Make it yours. */
export function CalendarApp() {
  const [open, setOpen] = useState<CalEvent | null>(null);
  const [draft, setDraft] = useState<{ id: number; start?: Date; end?: Date } | null>(null);
  const [offering, setOffering] = useState(false);
  const [refresh, setRefresh] = useState(0);

  return (
    <div
      data-block="calendar-app"
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-soft"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        if (offering) setOffering(false);
        else if (draft) setDraft(null);
      }}
    >
      <div className="flex h-12 items-center gap-2 border-b border-border px-3">
        <span className="text-13 font-semibold text-foreground">Calendar</span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            onClick={() => {
              setDraft(null);
              setOffering(true);
            }}
          >
            <CalendarClock className="size-3.5" /> Offer times
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setOffering(false);
              setDraft({ id: Date.now() });
            }}
          >
            <Plus className="size-3.5" /> New event
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[20rem] shrink-0 flex-col border-r border-border">
          {draft ? (
            <GoogleCalendarNewEvent
              key={draft.id}
              variant="panel"
              className="flex-1"
              initial={draft}
              onCreated={(e) => {
                setDraft((d) => (d ? { id: d.id } : d));
                setRefresh((n) => n + 1);
                setOpen(e);
              }}
              onDraftChange={(start, end) => setDraft((d) => (d && (d.start?.getTime() !== start.getTime() || d.end?.getTime() !== end.getTime()) ? { ...d, start, end } : d))}
              onClose={() => setDraft(null)}
            />
          ) : open ? (
            <GoogleCalendarEvent
              key={open.id}
              className="min-h-0 flex-1"
              event={open}
              onChange={(e) => {
                setOpen(e);
                setRefresh((n) => n + 1);
              }}
              onClose={() => setOpen(null)}
            />
          ) : <GoogleCalendarAgenda className="min-h-0 flex-1" days={7} onSelect={setOpen} refreshKey={refresh} />}
        </div>
        <GoogleCalendarWeek
          className="min-w-0 flex-1"
          draft={draft?.start && draft.end ? { start: draft.start, end: draft.end } : null} selectedId={open?.id} onSelect={setOpen} onCreateAt={(start, end) => {
            setOffering(false);
            setDraft({ id: Date.now(), start, end });
          }} refreshKey={refresh} />
      </div>

      {offering && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/70 p-6 backdrop-blur-xs" onClick={(e) => e.target === e.currentTarget && setOffering(false)}>
          <div className="flex h-full max-h-[38rem] w-full max-w-2xl flex-col">
            <GoogleCalendarOfferTimes className="min-h-0 flex-1 shadow-overlay" onClose={() => setOffering(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
