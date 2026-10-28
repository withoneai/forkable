import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Mail, Users, Video, X } from "lucide-react";
import clsx from "clsx";
import { oneFetch, type OneClientError, type OneMeta } from "../lib/one-client";
import { Button, SourceChip } from "../lib/one-ui";
import { addDays, fmtDay, fmtRange, fmtTime, sameDay, startOfDay, startOfWeek, zone, zoneShort } from "../google-calendar/time";
import type { CalEvent, NewEventInput } from "../google-calendar/types";

export interface GoogleCalendarNewEventProps {
  /** Prefill, for example from a click on the week grid. */
  initial?: { title?: string; start?: Date; end?: Date; guests?: string[] };
  onCreated?: (event: CalEvent) => void;
  /** Called as the time changes, so a calendar can draw the event before it is saved. */
  onDraftChange?: (start: Date, end: Date) => void;
  onClose?: () => void;
  /** "dialog" floats with a border and shadow; "panel" fills a side panel. */
  variant?: "dialog" | "panel";
  className?: string;
}

const STEP = 15;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The next half hour from now, for a sensible default. */
function nextSlot(): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d;
}

const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();
const at = (day: Date, minutes: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);
function fmtLength(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * A new event on the user's Google Calendar. Guests get no email unless the
 * user ticks "Email the guests an invite". Cmd+Enter saves.
 */
export function GoogleCalendarNewEvent({ initial, onCreated, onDraftChange, onClose, variant = "dialog", className }: GoogleCalendarNewEventProps) {
  const s0 = initial?.start ?? nextSlot();
  const e0 = initial?.end ?? new Date(s0.getTime() + 30 * 60_000);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [day, setDay] = useState(() => startOfDay(s0));
  const [startMin, setStartMin] = useState(minutesOf(s0));
  const [length, setLength] = useState(Math.max(STEP, Math.round((e0.getTime() - s0.getTime()) / 60_000)));
  const [guestList, setGuestList] = useState<string[]>(initial?.guests ?? []);
  const [guestDraft, setGuestDraft] = useState("");
  const [meet, setMeet] = useState(false);
  const [notify, setNotify] = useState(false);
  const [state, setState] = useState<{ kind: "idle" | "saving" | "saved" | "error"; text?: string; meta?: OneMeta; event?: CalEvent }>({ kind: "idle" });
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => first.current?.focus(), 0);
  }, []);

  const startAt = at(day, startMin);
  const endAt = new Date(startAt.getTime() + length * 60_000);
  useEffect(() => {
    onDraftChange?.(startAt, endAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startAt.getTime(), endAt.getTime()]);
  const badGuest = guestList.find((g) => !EMAIL.test(g));
  const valid = !!title.trim() && !badGuest;

  function addGuests(text: string) {
    const found = text.split(/[,;\s]+/).map((g) => g.trim().replace(/^<|>$/g, "")).filter(Boolean);
    if (found.length) setGuestList((l) => [...l, ...found.filter((g) => !l.includes(g))]);
    setGuestDraft("");
  }

  async function save() {
    if (!valid || state.kind === "saving") return;
    setState({ kind: "saving" });
    const input: NewEventInput = {
      title: title.trim(),
      start: startAt.toISOString(),
      end: endAt.toISOString(),
      timeZone: zone(),
      guests: [...guestList, ...(EMAIL.test(guestDraft.trim()) ? [guestDraft.trim()] : [])],
      meet,
      notifyGuests: notify && guestList.length > 0,
    };
    try {
      const r = await oneFetch<CalEvent>("/api/calendar/events", { method: "POST", body: input });
      setState({ kind: "saved", meta: r.meta, event: r.data });
      onCreated?.(r.data);
    } catch (e) {
      setState({ kind: "error", text: (e as OneClientError).message });
    }
  }

  const saved = state.kind === "saved" ? state.event : undefined;

  return (
    <div
      data-block="google-calendar-new-event"
      role="dialog"
      aria-label="New event"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose?.();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
      }}
      className={clsx(
        "flex w-full flex-col",
        variant === "dialog" ? "max-w-lg rounded-xl border border-border bg-card shadow-overlay" : "min-h-0 overflow-y-auto",
        className,
      )}
    >
      <div className="flex h-11 items-center gap-2 border-b border-border px-3">
        <span className="text-13 font-medium text-foreground">New event</span>
        <SourceChip meta={state.meta ?? null} />
        {onClose && (
          <Button variant="ghost" size="sm" icon onClick={onClose} className="ml-auto" aria-label="Close">
            <X className="size-4" />
          </Button>
        )}
      </div>

      {saved ? (
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2 text-13 text-foreground">
            <Check className="size-4 shrink-0 text-accent" />
            <span>Added to your calendar.</span>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-raised p-3">
            <span className="text-13 font-medium text-foreground">{saved.title}</span>
            <span className="text-xs text-muted-foreground">
              {fmtDay(new Date(saved.start))}, {fmtRange(saved.start, saved.end)}
            </span>
            {saved.joinUrl && <span className="truncate text-xs text-muted-foreground">{saved.joinUrl}</span>}
            {saved.attendees.length > 1 && (
              <span className="text-xs text-muted-foreground">
                {saved.attendees.length - 1} {saved.attendees.length === 2 ? "guest" : "guests"}, {notify ? "invited by email" : "not emailed"}
              </span>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => {
                setTitle("");
                setGuestList([]);
                setState({ kind: "idle" });
              }}
            >
              Add another
            </Button>
            {onClose && (
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 px-4 pt-4 pb-3">
            <input
              ref={first}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Add a title"
              aria-label="Title"
              className="w-full bg-transparent text-15 font-semibold text-foreground outline-none placeholder:font-medium placeholder:text-muted-foreground"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <Picker label={fmtDay(day, { weekday: "short", month: "short", day: "numeric" })} ariaLabel="Date">
                {(close) => (
                  <MiniMonth
                    value={day}
                    onPick={(d) => {
                      setDay(d);
                      close();
                    }}
                  />
                )}
              </Picker>
              <Picker label={fmtTime(startAt)} ariaLabel="Start time">
                {(close) => (
                  <TimeList
                    selected={startMin}
                    options={Array.from({ length: (24 * 60) / STEP }, (_, i) => i * STEP)}
                    render={(m) => fmtTime(at(day, m))}
                    onPick={(m) => {
                      setStartMin(m);
                      close();
                    }}
                  />
                )}
              </Picker>
              <ArrowRight className="size-3.5 text-muted-foreground" />
              <Picker label={fmtTime(endAt)} ariaLabel="End time">
                {(close) => (
                  <TimeList
                    selected={length}
                    options={Array.from({ length: 32 }, (_, i) => (i + 1) * STEP)}
                    render={(len) => (
                      <>
                        {fmtTime(new Date(startAt.getTime() + len * 60_000))}
                        <span className="ml-auto pl-3 text-11 text-muted-foreground">{fmtLength(len)}</span>
                      </>
                    )}
                    onPick={(len) => {
                      setLength(len);
                      close();
                    }}
                  />
                )}
              </Picker>
              <span className="text-11 text-muted-foreground tabular-nums">
                {fmtLength(length)} · <span title={zone().replace(/_/g, " ")}>{zoneShort(startAt)}</span>
              </span>
            </div>
          </div>

          <div className="flex items-start gap-2.5 border-t border-border px-4 py-2.5">
            <Users className="mt-1.5 size-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {guestList.map((g) => (
                <span
                  key={g}
                  title={EMAIL.test(g) ? g : `${g} is not an email address`}
                  className={clsx(
                    "inline-flex h-6 max-w-full items-center gap-1 rounded-md pl-2 pr-1 text-xs",
                    EMAIL.test(g) ? "border border-border bg-raised text-foreground" : "border border-dashed border-danger text-danger line-through",
                  )}
                >
                  <span className="truncate">{g}</span>
                  <button type="button" aria-label={`Remove ${g}`} onClick={() => setGuestList((l) => l.filter((x) => x !== g))} className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <input
                value={guestDraft}
                onChange={(e) => (/[,;\s]$/.test(e.target.value) ? addGuests(e.target.value) : setGuestDraft(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && guestDraft.trim() && !(e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    addGuests(guestDraft);
                  }
                  if (e.key === "Backspace" && !guestDraft && guestList.length) setGuestList((l) => l.slice(0, -1));
                }}
                onBlur={() => guestDraft.trim() && addGuests(guestDraft)}
                onPaste={(e) => {
                  e.preventDefault();
                  addGuests(e.clipboardData.getData("text"));
                }}
                placeholder={guestList.length ? "" : "Add guests by email"}
                aria-label="Guests"
                className="h-7 min-w-32 flex-1 bg-transparent text-13 text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <div className="flex flex-col border-t border-border py-1">
            <Switch checked={meet} onChange={setMeet} icon={<Video className="size-4" />}>
              Google Meet link
            </Switch>
            <Switch checked={notify} onChange={setNotify} disabled={guestList.length === 0} icon={<Mail className="size-4" />} hint={guestList.length === 0 ? "Add a guest first" : undefined}>
              Email the guests an invite
            </Switch>
          </div>

          <div className="flex items-center gap-2 border-t border-border px-4 py-2.5">
            <span className="min-w-0 truncate text-11 text-muted-foreground">
              {state.kind === "saving"
                ? "Saving..."
                : state.kind === "error"
                  ? state.text
                  : badGuest
                    ? `${badGuest} is not an email address.`
                    : guestList.length && !notify
                      ? "Guests see it on their calendar. No email goes out."
                      : "Cmd+Enter saves"}
            </span>
            <Button variant="primary" className="ml-auto" onClick={save} disabled={!valid || state.kind === "saving"}>
              Save event
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** A chip that opens a small panel under it. Closes on pick, Escape or a click outside. */
function Picker({ label, ariaLabel, children }: { label: string; ariaLabel: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);
  return (
    <div
      ref={box}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-label={`${ariaLabel}: ${label}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={clsx("h-7 rounded-md border px-2 text-13 tabular-nums transition-colors", open ? "border-strong bg-raised text-foreground ring-3 ring-primary/35" : "border-border bg-raised text-foreground hover:border-strong")}
      >
        {label}
      </button>
      {open && (
        <div className="absolute top-full left-0 z-30 mt-1 rounded-lg border border-border bg-raised p-1 shadow-overlay">{children(() => setOpen(false))}</div>
      )}
    </div>
  );
}

function TimeList<T extends number>({ options, selected, render, onPick }: { options: T[]; selected: T; render: (v: T) => ReactNode; onPick: (v: T) => void }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>("[aria-selected=true]")?.scrollIntoView({ block: "center" });
  }, []);
  return (
    <div ref={list} role="listbox" className="flex max-h-56 w-44 flex-col overflow-y-auto">
      {options.map((v) => (
        <button
          key={v}
          type="button"
          role="option"
          aria-selected={v === selected}
          onClick={() => onPick(v)}
          className={clsx("flex h-7 shrink-0 items-center rounded-md px-2 text-left text-13 tabular-nums", v === selected ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-foreground/5")}
        >
          {render(v)}
        </button>
      ))}
    </div>
  );
}

function MiniMonth({ value, onPick }: { value: Date; onPick: (d: Date) => void }) {
  const [month, setMonth] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1));
  const today = startOfDay(new Date());
  const cells = useMemo(() => {
    const first = startOfWeek(month);
    return Array.from({ length: 42 }, (_, i) => addDays(first, i));
  }, [month]);
  return (
    <div className="flex w-60 flex-col gap-1 p-1">
      <div className="flex items-center gap-1 pb-1">
        <span className="pl-1 text-13 font-medium text-foreground">{fmtDay(month, { month: "long", year: "numeric" })}</span>
        <button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground">
          <ChevronLeft className="size-4" />
        </button>
        <button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-md p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground">
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-10 text-muted-foreground">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="py-1">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d) => {
          const inMonth = d.getMonth() === month.getMonth();
          const picked = sameDay(d, value);
          const isToday = sameDay(d, today);
          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => onPick(d)}
              className={clsx(
                "flex h-7 items-center justify-center rounded-md text-xs tabular-nums transition-colors",
                picked ? "bg-primary font-semibold text-primary-foreground" : isToday ? "font-semibold text-accent ring-1 ring-strong ring-inset" : inMonth ? "text-foreground hover:bg-foreground/5" : "text-muted-foreground/50 hover:bg-foreground/5",
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Switch({ checked, onChange, disabled, icon, hint, children }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; icon: ReactNode; hint?: string; children: ReactNode }) {
  const on = checked && !disabled;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2.5 px-4 py-1.5 text-left text-13 text-foreground transition-colors hover:bg-foreground/4 disabled:cursor-not-allowed disabled:text-muted-foreground"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1">{children}</span>
      {hint && <span className="text-11 text-muted-foreground">{hint}</span>}
      <span className={clsx("relative h-4 w-7 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-strong")}>
        <span className={clsx("absolute top-0.5 size-3 rounded-full transition-all", on ? "left-3.5 bg-primary-foreground" : "left-0.5 bg-raised shadow-soft")} />
      </span>
    </button>
  );
}
