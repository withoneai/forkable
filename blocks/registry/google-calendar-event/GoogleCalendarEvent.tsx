import { useState } from "react";
import { MapPin, Video, X } from "lucide-react";
import clsx from "clsx";
import { oneFetch, type OneClientError, type OneMeta } from "../lib/one-client";
import { Avatar, Button, SourceChip } from "../lib/one-ui";
import { fmtDay, fmtRange } from "../google-calendar/time";
import type { CalEvent, Rsvp } from "../google-calendar/types";

export interface GoogleCalendarEventProps {
  event: CalEvent;
  /** Called with the event as Google has it after an RSVP. */
  onChange?: (event: CalEvent) => void;
  onClose?: () => void;
  className?: string;
}

const ANSWER: { value: Rsvp; label: string }[] = [
  { value: "accepted", label: "Going" },
  { value: "tentative", label: "Maybe" },
  { value: "declined", label: "No" },
];
const STATUS: Record<Rsvp, string> = { accepted: "Going", declined: "Not going", tentative: "Maybe", needsAction: "No reply yet" };

function length(e: CalEvent): string {
  const min = Math.round((new Date(e.end).getTime() - new Date(e.start).getTime()) / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}

/** One event: when, the join link, your answer, and who is coming. RSVPs on the user's grant. */
export function GoogleCalendarEvent({ event: e, onChange, onClose, className }: GoogleCalendarEventProps) {
  const [mine, setMine] = useState<Rsvp>(e.myResponse);
  const [busy, setBusy] = useState<Rsvp | null>(null);
  const [meta, setMeta] = useState<OneMeta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const me = e.attendees.find((a) => a.self);
  const canAnswer = !!me && !me.organizer && e.status !== "cancelled";
  const cancelled = e.status === "cancelled";
  const going = e.attendees.filter((a) => (a.self ? mine : a.response) === "accepted" || a.organizer).length;

  async function answer(r: Rsvp) {
    if (r === mine || busy) return;
    const before = mine;
    setMine(r);
    setBusy(r);
    setErr(null);
    try {
      const res = await oneFetch<CalEvent>(`/api/calendar/events/${encodeURIComponent(e.id)}/rsvp`, { method: "POST", body: { response: r } });
      setMeta(res.meta);
      onChange?.(res.data);
    } catch (x) {
      setMine(before);
      setErr((x as OneClientError).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div data-block="google-calendar-event" className={clsx("flex min-h-0 flex-col overflow-y-auto", className)}>
      <div className="flex items-start gap-2 px-4 pt-4 pb-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 className={clsx("text-15 font-semibold leading-snug text-foreground", cancelled && "text-muted-foreground line-through")}>{e.title}</h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {fmtDay(new Date(e.start), { weekday: "long", month: "short", day: "numeric", ...(e.allDay ? { timeZone: "UTC" } : {}) })}
            {e.allDay ? " · All day" : ` · ${fmtRange(e.start, e.end)} · ${length(e)}`}
          </span>
          {cancelled && <span className="text-xs text-muted-foreground">Cancelled by the organizer.</span>}
        </div>
        {onClose && (
          <Button variant="ghost" size="sm" icon aria-label="Close" onClick={onClose}>
            <X className="size-4" />
          </Button>
        )}
      </div>

      {(e.joinUrl || canAnswer) && (
        <div className="flex flex-col gap-2 px-4 pb-4">
          {e.joinUrl && !cancelled && (
            <a href={e.joinUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-13 font-medium text-primary-foreground transition-colors hover:bg-primary-hover active:bg-primary-press">
              <Video className="size-3.5" /> Join {joinName(e.joinUrl)}
            </a>
          )}
          {canAnswer && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{mine === "needsAction" ? "Are you going?" : "Your answer"}</span>
                <SourceChip meta={meta} />
              </div>
              <div role="radiogroup" aria-label="Your answer" className="grid grid-cols-3 gap-0.5 rounded-md border border-border bg-foreground/4 p-0.5">
                {ANSWER.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    role="radio"
                    aria-checked={mine === a.value}
                    onClick={() => answer(a.value)}
                    disabled={busy !== null}
                    className={clsx(
                      "h-7 rounded-sm text-xs font-medium transition-colors",
                      mine === a.value ? "bg-raised text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
                      busy === a.value && "animate-pulse",
                    )}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
              {err ? <span className="text-11 text-danger">{err}</span> : <span className="text-11 text-muted-foreground">The organizer sees it on their calendar. No email goes out.</span>}
            </div>
          )}
        </div>
      )}

      {(e.location || e.description) && (
        <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
          {e.location && !/^https?:/.test(e.location) && (
            <span className="flex items-center gap-1.5 text-13 text-foreground">
              <MapPin className="size-3.5 shrink-0 text-muted-foreground" /> {e.location}
            </span>
          )}
          {e.description && <p className="text-13 leading-relaxed whitespace-pre-wrap text-foreground">{e.description}</p>}
        </div>
      )}

      {e.attendees.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
          <span className="text-xs text-muted-foreground">
            {e.attendees.length} {e.attendees.length === 1 ? "person" : "people"} · {going} going
          </span>
          <ul className="flex flex-col gap-2.5">
            {[...e.attendees]
              .sort((a, b) => Number(b.organizer) - Number(a.organizer) || Number(b.self) - Number(a.self))
              .map((a) => {
                const r = a.self ? mine : a.response;
                return (
                  <li key={a.email} className="flex items-center gap-2.5">
                    <span className="relative">
                      <Avatar name={a.name ?? a.email} />
                      <span
                        aria-hidden
                        className={clsx(
                          "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card",
                          r === "accepted" || a.organizer ? "bg-accent" : r === "declined" ? "bg-muted-foreground" : r === "tentative" ? "border border-muted-foreground bg-card" : "border border-dashed border-strong bg-card",
                        )}
                      />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={clsx("truncate text-13", r === "declined" ? "text-muted-foreground line-through" : "text-foreground")}>
                        {a.name ?? a.email}
                        {a.self && <span className="text-muted-foreground"> (you)</span>}
                      </span>
                      <span className="truncate text-11 text-muted-foreground">{a.organizer ? "Organizer" : STATUS[r]}</span>
                    </span>
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </div>
  );
}

function joinName(url: string): string {
  if (/meet\.google\.com/.test(url)) return "Google Meet";
  if (/zoom\.us/.test(url)) return "Zoom";
  if (/teams\.(microsoft|live)\.com/.test(url)) return "Teams";
  return "the call";
}
