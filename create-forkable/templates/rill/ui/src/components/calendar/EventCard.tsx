import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronRight, Mail, MapPin, Video, X } from "lucide-react";
import type { ApiEvent, EventPatchInput } from "@rill/core/api-types";
import type { ConferencingProvider, RsvpResponse } from "@rill/core/types";
import { useConferencing, useEvent, useEventPrep, usePatchEvent, useRsvp } from "@/lib/queries";
import { useKeys } from "@/lib/keys";
import { useMailbox } from "@/lib/mailbox";
import { toast } from "@/lib/toast";
import { dayKey, fmtDay, fmtTime, minutesOfDay, zonedInstant } from "@/lib/calendarLayout";
import { cn } from "@/lib/utils";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { ConfirmButton } from "../ui/ConfirmButton";
import { IconButton } from "../ui/IconButton";
import { Input, Textarea } from "../ui/Input";
import { Kbd } from "../ui/Kbd";
import { Skeleton } from "../ui/Skeleton";
import { Switch } from "../ui/Switch";
import { Tabs } from "../ui/Tabs";
import { AttendeeInput } from "./AttendeeInput";

/** "Join on Zoom" when the link says which service it is; "Join the call" otherwise. */
function joinLabel(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (/(^|\.)zoom\.(us|com)$/i.test(host)) return "Join on Zoom";
    if (/(^|\.)meet\.google\.com$/i.test(host)) return "Join on Meet";
    if (/(^|\.)teams\.(microsoft|live)\.com$/i.test(host)) return "Join on Teams";
  } catch { /* fall through */ }
  return "Join the call";
}

const CONF_LABEL: Record<ConferencingProvider, string> = { "google-meet": "Meet", teams: "Teams", zoom: "Zoom" };
const STATUS: Record<RsvpResponse, string> = { accepted: "Going", declined: "Not going", tentative: "Maybe", needsAction: "No reply" };
const RSVP: { value: "accepted" | "tentative" | "declined"; label: string }[] = [
  { value: "accepted", label: "Yes" }, { value: "tentative", label: "Maybe" }, { value: "declined", label: "No" },
];
/** Changes guests would notice. Anything else saves quietly. */
const GUEST_VISIBLE: (keyof EventPatchInput)[] = ["title", "start", "end", "allDay", "location", "attendees", "conferencing", "status"];

function duration(start: string, end: string): string {
  const m = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000);
  return m < 60 ? `${m}m` : m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`;
}
const hhmm = (iso: string, tz: string) => { const m = minutesOfDay(iso, tz); return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
/** The instant for a YYYY-MM-DD and HH:MM in `tz`. */
function at(day: string, time: string, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [h, min] = time.split(":").map(Number) as [number, number];
  return zonedInstant(y, m, d, h, min, tz);
}

export interface PendingChange { start: string; end: string }

/**
 * The side panel for one event, after Notion Calendar's: what and when, then the
 * reply, then Join, then who, then context. When you organize the event every
 * field edits in place and saves on its own. A change guests would see waits
 * behind "Send update to guests?" so no email goes out without a keypress.
 */
export function EventCard({ mailboxId, eventId, tz, onClose, dropped }: {
  mailboxId: string; eventId: string; tz: string; onClose: () => void;
  /** A move or resize from the grid that still needs the guest question. */
  dropped?: PendingChange | null;
}) {
  const q = useEvent(mailboxId, eventId);
  const prepQ = useEventPrep(mailboxId, eventId);
  const rsvp = useRsvp(mailboxId);
  const patch = usePatchEvent(mailboxId);
  const confQ = useConferencing(mailboxId, Boolean(q.data?.event.editable));
  // Outlook tells a meeting's guests about every change you make as organizer; Graph has no quiet save, so "Don't send" is not offered.
  const quietSave = useMailbox().mailbox?.calendarProvider !== "outlook-calendar";
  const d = q.data;
  const e = d?.event;
  const cancelled = e?.status === "cancelled";
  const editable = Boolean(e?.editable);
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";

  // Edits guests would see queue here until Send / Don't send; the card shows them as if applied.
  const [pending, setPending] = useState<EventPatchInput | null>(null);
  const [whenOpen, setWhenOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setPending(null); setWhenOpen(false); }, [eventId]);
  useEffect(() => { if (dropped) setPending((p) => ({ ...p, start: dropped.start, end: dropped.end })); }, [dropped]);
  useEffect(() => {
    if (!e) return;
    setTitle(e.title); setLocation(e.location && e.location !== e.joinUrl ? e.location : ""); setDescription(e.description ?? "");
  }, [e?.id, e?.title, e?.location, e?.description, e?.joinUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const guests = e ? e.attendees.filter((a) => !a.self) : [];
  const view: ApiEvent | undefined = e && pending
    ? { ...e, title: pending.title ?? e.title, start: pending.start ?? e.start, end: pending.end ?? e.end, allDay: pending.allDay ?? e.allDay, location: pending.location !== undefined ? pending.location : e.location }
    : e;

  const send = (input: EventPatchInput, notify: "all" | "none", done?: string) => {
    patch.mutate({ eventId, input: { ...input, notify } }, {
      onSuccess: () => { setPending(null); if (done) toast({ title: done, detail: notify === "all" && guests.length ? `${guests.length} guest${guests.length > 1 ? "s" : ""} got an update.` : undefined }); },
      onError: (err) => toast({ title: "Not saved", detail: err.message, tone: "destructive" }),
    });
  };
  const commit = (input: EventPatchInput) => {
    if (guests.length && GUEST_VISIBLE.some((k) => k in input)) setPending((p) => ({ ...p, ...input }));
    else send(input, "none");
  };

  const act = (response: "accepted" | "declined" | "tentative") => {
    rsvp.mutate({ eventId, action: { response } }, {
      onSuccess: () => toast({ title: STATUS[response], detail: "The organizer sees your answer." }),
      onError: (err) => toast({ title: "RSVP not sent", detail: err.message, tone: "destructive" }),
    });
  };
  useKeys({
    escape: () => { if (whenOpen) { setWhenOpen(false); return; } onClose(); },
    j: () => { if (e?.joinUrl && !cancelled) window.open(e.joinUrl, "_blank", "noopener"); else return false; },
    e: () => { if (editable) titleRef.current?.focus(); else return false; },
  }, { priority: 4 });

  const showRsvp = e && !cancelled && (!editable || guests.length > 0);
  const offered = confQ.data?.available ?? [];
  const currentConf: ConferencingProvider | "none" = !view?.joinUrl ? "none" : /zoom\./.test(view.joinUrl) ? "zoom" : /meet\.google/.test(view.joinUrl) ? "google-meet" : /teams\./.test(view.joinUrl) ? "teams" : "none";

  return (
    <aside className="slide-in-right flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-border bg-faint" aria-label="Event">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border pl-4 pr-2">
        <span className="text-xs font-medium text-muted-foreground">{editable ? "Your event" : "Event"}</span>
        <span className="flex items-center gap-1">
          {patch.isPending && <span className="text-11 text-muted-foreground" aria-live="polite">Saving…</span>}
          <IconButton label="Close" hint="Esc" size="sm" onClick={onClose}><X /></IconButton>
        </span>
      </div>
      {!d || !e || !view ? (
        <div className="flex flex-col gap-3 p-4" aria-busy>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
      ) : (
        <div className="flex flex-col gap-5 p-4">
          {pending && (
            <div role="status" className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
              <p className="text-13 font-medium">Send update to {guests.length} guest{guests.length > 1 ? "s" : ""}?</p>
              <p className="text-xs text-muted-foreground">{pending.status === "cancelled" ? "They get a cancellation." : "They get the new details by email."}{quietSave ? "" : " Outlook always tells them."}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="primary" loading={patch.isPending} onClick={() => send(pending, "all", pending.status === "cancelled" ? "Cancelled" : "Saved")}>Send</Button>
                {quietSave && <Button size="sm" loading={patch.isPending} onClick={() => send(pending, "none", pending.status === "cancelled" ? "Cancelled" : "Saved")}>Don't send</Button>}
                <Button size="sm" variant="ghost" onClick={() => { setPending(null); setTitle(e.title); }}>Undo</Button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            {editable ? (
              <input
                ref={titleRef}
                value={title}
                onChange={(ev) => setTitle(ev.target.value)}
                onBlur={() => { if (title.trim() && title.trim() !== e.title) commit({ title: title.trim() }); else setTitle(e.title); }}
                onKeyDown={(ev) => { if (ev.key === "Enter") (ev.target as HTMLInputElement).blur(); if (ev.key === "Escape") { setTitle(e.title); (ev.target as HTMLInputElement).blur(); ev.stopPropagation(); } }}
                aria-label="Title"
                className="-mx-1.5 rounded-md bg-transparent px-1.5 py-0.5 text-15 font-semibold leading-snug text-foreground outline-none transition-colors hover:bg-card-hover focus:bg-card focus:shadow-[0_0_0_1px_var(--ring)]"
              />
            ) : (
              <h2 className={cn("text-15 font-semibold leading-snug", cancelled && "text-muted-foreground line-through")}>{e.title}</h2>
            )}
            {editable && !whenOpen ? (
              <button type="button" onClick={() => setWhenOpen(true)} title="Change the time" className="tnum -mx-1.5 rounded-md px-1.5 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground">
                {fmtDay(view.start, tz, { weekday: "short", month: "short", day: "numeric" })}
                {" · "}
                {view.allDay ? "All day" : <>{fmtTime(view.start, tz)} → {fmtTime(view.end, tz)} · {duration(view.start, view.end)} · {zone}</>}
              </button>
            ) : editable && whenOpen ? (
              <WhenEditor
                start={view.start} end={view.end} allDay={view.allDay} tz={tz} zone={zone}
                onChange={(next) => commit(next)}
                onDone={() => setWhenOpen(false)}
              />
            ) : (
              <p className="tnum text-xs text-muted-foreground">
                {fmtDay(e.start, tz, { weekday: "short", month: "short", day: "numeric" })}
                {" · "}
                {e.allDay ? "All day" : <>{fmtTime(e.start, tz)} → {fmtTime(e.end, tz)} · {duration(e.start, e.end)} · {zone}</>}
              </p>
            )}
            {cancelled && <p className="text-xs text-destructive-text">{editable || !e.organizer ? "This event was cancelled." : "The organizer cancelled this event."}</p>}
            {e.conflict && !cancelled && (
              <p className="flex items-center gap-1.5 text-xs text-warning-text"><AlertTriangle className="size-3 shrink-0" /> Overlaps {e.conflict.title}</p>
            )}
          </div>

          {showRsvp && (
            <div className="flex flex-col gap-1.5">
              <p className="label-caps">Going?</p>
              <div role="radiogroup" aria-label="Your RSVP" className="grid grid-cols-3 gap-0.5 rounded-md border border-border bg-card p-0.5">
                {RSVP.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    role="radio"
                    aria-checked={e.myResponse === r.value}
                    disabled={rsvp.isPending}
                    onClick={() => act(r.value)}
                    className={cn("h-7 rounded-sm text-xs font-medium transition-colors", e.myResponse === r.value ? "bg-foreground text-background" : "text-muted-foreground hover:bg-card-hover hover:text-foreground")}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {e.joinUrl && !cancelled && (
            <a href={e.joinUrl} target="_blank" rel="noreferrer" className="flex h-8 items-center justify-center gap-2 rounded-md bg-accent text-13 font-medium text-accent-foreground transition-[filter] hover:brightness-[1.08]">
              <Video className="size-3.5" /> {joinLabel(e.joinUrl)} <Kbd className="h-4 min-w-4 border-0 bg-accent-foreground/15 px-1 text-10 text-accent-foreground shadow-none">J</Kbd>
            </a>
          )}
          {editable && offered.length > 0 && (
            <div className="flex items-center justify-between gap-2">
              <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"><Video className="size-3.5" /> Link</span>
              <Tabs
                size="sm"
                value={currentConf}
                onChange={(v) => commit({ conferencing: v === "none" ? null : v })}
                options={[...offered.map((p) => ({ key: p, label: CONF_LABEL[p] })), { key: "none" as const, label: "None" }]}
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <p className="label-caps">People</p>
            <ul className="flex flex-col gap-2">
              {e.attendees.map((a) => (
                <li key={a.email} className="group flex items-center gap-2">
                  <Avatar name={a.name ?? a.email} size="sm" />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className={cn("truncate text-13", a.response === "declined" && "text-muted-foreground line-through")}>{a.name ?? a.email}{a.self ? " (you)" : ""}</span>
                    {a.organizer && <span className="text-11 text-muted-foreground">Organizer</span>}
                  </span>
                  <span className="shrink-0 text-11 text-muted-foreground">{STATUS[a.response]}</span>
                  {editable && !a.self && (
                    <IconButton label={`Remove ${a.name ?? a.email}`} size="sm" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => commit({ attendees: guests.filter((g) => g.email !== a.email).map((g) => g.email) })}><X /></IconButton>
                  )}
                </li>
              ))}
            </ul>
            {editable && (
              <AttendeeInput
                mailboxId={mailboxId}
                value={[]}
                onChange={(added) => { if (added.length) commit({ attendees: [...guests.map((g) => g.email), ...added.map((a) => a.email)], attendeeNames: Object.fromEntries(added.filter((a) => a.name).map((a) => [a.email, a.name!])) }); }}
              />
            )}
          </div>

          {editable ? (
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-1.5">
                <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                <Input value={location} onChange={(ev) => setLocation(ev.target.value)} onBlur={() => { const v = location.trim() || null; if (v !== (e.location && e.location !== e.joinUrl ? e.location : null)) commit({ location: v }); }} onKeyDown={(ev) => { if (ev.key === "Enter") (ev.target as HTMLInputElement).blur(); }} placeholder="Add a location" aria-label="Location" className="h-7 border-transparent bg-transparent px-1.5 hover:border-border" />
              </label>
              <Textarea value={description} onChange={(ev) => setDescription(ev.target.value)} onBlur={() => { const v = description.trim() || null; if (v !== (e.description ?? null)) commit({ description: v }); }} placeholder="Add a description" aria-label="Description" className="min-h-[56px] border-transparent bg-transparent px-1.5 hover:border-border" />
            </div>
          ) : (
            <>
              {e.location && e.location !== e.joinUrl && <p className="flex items-center gap-1.5 text-13"><MapPin className="size-3.5 shrink-0 text-muted-foreground" /> {e.location}</p>}
              {e.description && <p className="whitespace-pre-wrap text-13 leading-relaxed text-muted-foreground">{e.description}</p>}
            </>
          )}

          {d.relatedThreads.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="label-caps">From your mail</p>
              <ul className="flex flex-col">
                {d.relatedThreads.map((t) => (
                  <li key={t.threadId}>
                    <Link to={`/thread/${t.threadId}`} className="group -mx-1.5 flex h-8 items-center gap-2 rounded-md px-1.5 text-xs transition-colors hover:bg-card-hover">
                      <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{t.subject}</span>
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!cancelled && (prepQ.isPending || prepQ.data) && guests.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="label-caps">Prep notes</p>
              {prepQ.isPending ? (
                <p className="text-xs text-muted-foreground" aria-busy>Reading your mail with these people…</p>
              ) : prepQ.data ? (
                <>
                  <p className="text-13 leading-relaxed">{prepQ.data.text}</p>
                  {prepQ.data.attendees.filter((a) => a.asks.length).map((a) => (
                    <p key={a.email} className="text-xs"><span className="font-medium">{a.name ?? a.email}:</span> <span className="text-muted-foreground">{a.asks.join("; ")}</span></p>
                  ))}
                </>
              ) : null}
            </div>
          )}

          {editable && (
            <div className="flex justify-start border-t border-border pt-3">
              <ConfirmButton size="sm" variant="ghost" confirmLabel={guests.length ? "Cancel for everyone?" : "Really cancel?"} onConfirm={() => commit({ status: "cancelled" })} className="text-destructive-text">
                Cancel event
              </ConfirmButton>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

/** Date, start and end as native pickers in the calendar's zone, plus All day. Each change saves. */
function WhenEditor({ start, end, allDay, tz, zone, onChange, onDone }: {
  start: string; end: string; allDay: boolean; tz: string; zone: string;
  onChange: (next: { start: string; end: string; allDay: boolean }) => void; onDone: () => void;
}) {
  const day = dayKey(start, tz);
  const s = hhmm(start, tz);
  const en = hhmm(end, tz);
  const durationMs = new Date(end).getTime() - new Date(start).getTime();
  const setDay = (nextDay: string) => { if (!nextDay) return; const ns = at(nextDay, s, tz); onChange({ start: ns.toISOString(), end: new Date(ns.getTime() + durationMs).toISOString(), allDay }); };
  const setStart = (t: string) => { if (!t) return; const ns = at(day, t, tz); onChange({ start: ns.toISOString(), end: new Date(ns.getTime() + durationMs).toISOString(), allDay }); };
  const setEnd = (t: string) => { if (!t) return; let ne = at(day, t, tz); if (ne <= new Date(start)) ne = new Date(new Date(start).getTime() + 15 * 60_000); onChange({ start, end: ne.toISOString(), allDay }); };
  const toggleAllDay = (v: boolean) => {
    if (v) { const ds = at(day, "00:00", tz); onChange({ start: ds.toISOString(), end: new Date(ds.getTime() + 864e5).toISOString(), allDay: true }); }
    else { const ns = at(day, "09:00", tz); onChange({ start: ns.toISOString(), end: new Date(ns.getTime() + 30 * 60_000).toISOString(), allDay: false }); }
  };
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-2">
      <Input type="date" value={day} onChange={(ev) => setDay(ev.target.value)} aria-label="Date" className="tnum h-7" />
      {!allDay && (
        <div className="flex items-center gap-1.5">
          <Input type="time" step={900} value={s} onChange={(ev) => setStart(ev.target.value)} aria-label="Start" className="tnum h-7" />
          <span className="text-xs text-muted-foreground">→</span>
          <Input type="time" step={900} value={en} onChange={(ev) => setEnd(ev.target.value)} aria-label="End" className="tnum h-7" />
        </div>
      )}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">All day <Switch label="All day" checked={allDay} onChange={toggleAllDay} /></label>
        <span className="flex items-center gap-2">
          <span className="text-11 text-muted-foreground">{zone}</span>
          <Button size="sm" variant="ghost" onClick={onDone}>Done</Button>
        </span>
      </div>
    </div>
  );
}
