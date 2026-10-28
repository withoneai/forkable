import { useEffect, useMemo, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import clsx from "clsx";
import { oneFetch, type OneClientError, type OneMeta } from "../lib/one-client";
import { Button, ErrorState, Skeleton, SourceChip } from "../lib/one-ui";
import { addDays, fmtDay, fmtTime, keyOf, startOfDay, zone, zoneShort } from "../google-calendar/time";
import type { BusySlot } from "../google-calendar/types";

export interface GoogleCalendarOfferTimesProps {
  /** Weekdays to offer, starting tomorrow. */
  days?: number;
  /** Working hours, in the user's zone. */
  startHour?: number;
  endHour?: number;
  slotMinutes?: number;
  /** Most slots someone can pick. */
  max?: number;
  /** Called with the sentence, for example to drop it into a draft. */
  onInsert?: (text: string) => void;
  /** Shows a close button in the header. */
  onClose?: () => void;
  className?: string;
}

interface Slot {
  start: Date;
  end: Date;
}

/**
 * Pick open times from the user's free/busy and get a sentence to paste into
 * an email. Reads busy times only, never event titles. Nothing is sent.
 */
export function GoogleCalendarOfferTimes({ days = 5, startHour = 9, endHour = 18, slotMinutes = 30, max = 4, onInsert, onClose, className }: GoogleCalendarOfferTimesProps) {
  const dayList = useMemo(() => {
    const out: Date[] = [];
    let d = addDays(startOfDay(new Date()), 1);
    while (out.length < days) {
      if (d.getDay() !== 0 && d.getDay() !== 6) out.push(d);
      d = addDays(d, 1);
    }
    return out;
  }, [days]);
  const minutes = useMemo(() => {
    const out: number[] = [];
    for (let m = startHour * 60; m + slotMinutes <= endHour * 60; m += slotMinutes) out.push(m);
    return out;
  }, [startHour, endHour, slotMinutes]);

  const [busy, setBusy] = useState<BusySlot[] | null>(null);
  const [meta, setMeta] = useState<OneMeta | null>(null);
  const [error, setError] = useState<OneClientError | null>(null);
  const [tick, setTick] = useState(0);
  const [picked, setPicked] = useState<Slot[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    setError(null);
    oneFetch<BusySlot[]>("/api/calendar/free-busy", {
      method: "POST",
      body: { from: dayList[0]!.toISOString(), to: addDays(dayList[dayList.length - 1]!, 1).toISOString(), timeZone: zone() },
    })
      .then((r) => live && (setBusy(r.data), setMeta(r.meta)))
      .catch((e) => live && setError(e as OneClientError));
    return () => {
      live = false;
    };
  }, [dayList, tick]);

  const slotAt = (day: Date, m: number): Slot => {
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m);
    return { start, end: new Date(start.getTime() + slotMinutes * 60_000) };
  };
  const isBusy = (s: Slot) => (busy ?? []).some((b) => new Date(b.start) < s.end && new Date(b.end) > s.start);
  const isOn = (s: Slot) => picked.some((p) => p.start.getTime() === s.start.getTime());
  const toggle = (s: Slot) => {
    setCopied(false);
    setPicked((prev) =>
      isOn(s) ? prev.filter((p) => p.start.getTime() !== s.start.getTime()) : prev.length >= max ? prev : [...prev, s].sort((a, b) => a.start.getTime() - b.start.getTime()),
    );
  };

  const text = sentence(picked);

  async function copy() {
    await navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(true);
    onInsert?.(text);
  }

  return (
    <div data-block="google-calendar-offer-times" className={clsx("flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-soft", className)}>
      <div className="flex h-11 items-center gap-2 border-b border-border px-3">
        <span className="text-13 font-medium text-foreground">Offer times</span>
        <SourceChip meta={meta} />
        <span className="ml-auto text-11 text-muted-foreground">
          Times in {zoneShort()}. Pick up to {max}.
        </span>
        {onClose && (
          <Button variant="ghost" size="sm" icon onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {error ? (
          <ErrorState error={error} onRetry={() => setTick((n) => n + 1)} />
        ) : (
          <div className="flex">
            <div className="relative w-12 shrink-0" style={{ marginTop: "2.75rem", height: `${minutes.length * 1.5}rem` }}>
              {minutes.map((m, i) =>
                m % 60 === 0 ? (
                  <span key={m} className="absolute right-2 -translate-y-1/2 text-10 text-muted-foreground tabular-nums" style={{ top: `${i * 1.5}rem` }}>
                    {fmtTime(new Date(2000, 0, 1, 0, m))}
                  </span>
                ) : null,
              )}
            </div>
            {dayList.map((d) => {
              const cells = minutes.map((m) => {
                const s = slotAt(d, m);
                return { m, s, taken: busy ? isBusy(s) : false, on: isOn(s) };
              });
              const freeMin = cells.filter((c) => !c.taken).length * slotMinutes;
              return (
                <div key={keyOf(d)} className="flex min-w-0 flex-1 flex-col border-l border-border">
                  <div className="flex h-11 flex-col items-center justify-center gap-0.5">
                    <span className="text-11 font-medium text-foreground">
                      {fmtDay(d, { weekday: "short" })} <span className="tabular-nums">{d.getDate()}</span>
                    </span>
                    <span className="text-10 text-muted-foreground tabular-nums">{busy ? (freeMin ? `${freeMin % 60 ? (freeMin / 60).toFixed(1) : freeMin / 60} h free` : "Full") : "\u00a0"}</span>
                  </div>
                  <div className="flex flex-col">
                    {cells.map((c, i) => {
                      if (!busy) return <Skeleton key={c.m} className="h-6 rounded-none border-t border-card" />;
                      const prev = cells[i - 1];
                      const next = cells[i + 1];
                      const hour = c.m % 60 === 0;
                      const runStart = c.on ? !prev?.on : c.taken ? !prev?.taken : true;
                      const runEnd = c.on ? !next?.on : c.taken ? !next?.taken : true;
                      return (
                        <button
                          key={c.m}
                          type="button"
                          disabled={c.taken}
                          onClick={() => toggle(c.s)}
                          aria-pressed={c.on}
                          aria-label={`${fmtDay(c.s.start)} ${fmtTime(c.s.start)}${c.taken ? ", busy" : ""}`}
                          className={clsx(
                            "group relative flex h-6 shrink-0 items-start px-1.5 text-left text-10 tabular-nums transition-colors",
                            hour && !(c.taken && !runStart) && "border-t border-border",
                            c.taken
                              ? "cursor-not-allowed text-foreground/12"
                              : c.on
                                ? "z-10 mx-0.5 bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-primary/25 hover:text-foreground",
                            c.on && runStart && "rounded-t-sm",
                            c.on && runEnd && "rounded-b-sm",
                          )}
                          style={c.taken ? { backgroundImage: "repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 6px)", backgroundAttachment: "fixed" } : undefined}
                        >
                          {c.taken ? (
                            runStart && <span className="pt-0.5 text-muted-foreground">Busy</span>
                          ) : c.on ? (
                            runStart && (
                              <span className="flex items-center gap-1 pt-0.5 font-medium">
                                <Check className="size-3" /> {fmtTime(c.s.start)}
                              </span>
                            )
                          ) : (
                            <span className="pt-0.5 opacity-0 transition-opacity group-hover:opacity-100">{fmtTime(c.s.start)}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border px-3 py-2.5">
        <p className={clsx("min-h-10 rounded-md border border-border bg-raised px-3 py-2 text-13 leading-relaxed", text ? "text-foreground" : "text-muted-foreground")}>
          {text || "Pick a few open times and the sentence writes itself."}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-11 tabular-nums text-muted-foreground">
            {picked.length} of {max} picked
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" onClick={() => (setPicked([]), setCopied(false))} disabled={!picked.length}>
              Clear
            </Button>
            <Button variant="primary" onClick={copy} disabled={!text}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : onInsert ? "Insert" : "Copy"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * "I'm free Thu, Oct 29 at 9 or 10 AM, or Mon, Nov 2 from 2 to 3 PM (GMT+3).
 * Does one of those work?" Touching slots read as one range; one day is named once.
 */
export function sentence(slots: Slot[]): string {
  if (!slots.length) return "";
  const runs: Slot[] = [];
  for (const s of [...slots].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    const last = runs[runs.length - 1];
    if (last && last.end.getTime() === s.start.getTime()) last.end = s.end;
    else runs.push({ ...s });
  }
  const meridiem = (d: Date) => fmtTime(d).slice(-2);
  const bare = (d: Date) => fmtTime(d).slice(0, -3);
  const byDay = new Map<string, Slot[]>();
  for (const r of runs) byDay.set(keyOf(r.start), [...(byDay.get(keyOf(r.start)) ?? []), r]);

  const days = [...byDay.values()].map((list) => {
    const day = fmtDay(list[0]!.start, { weekday: "short", month: "short", day: "numeric" });
    const allSingle = list.every((r) => r.end.getTime() - r.start.getTime() <= 30 * 60_000);
    if (allSingle) {
      // "9 or 10 AM", "11 AM or 2 PM"
      const times = list.map((r, i) => {
        const nextSame = list[i + 1] && meridiem(list[i + 1]!.start) === meridiem(r.start);
        return nextSame ? bare(r.start) : fmtTime(r.start);
      });
      return `${day} at ${joinOr(times)}`;
    }
    const parts = list.map((r) => {
      if (r.end.getTime() - r.start.getTime() <= 30 * 60_000) return `at ${fmtTime(r.start)}`;
      return `from ${meridiem(r.start) === meridiem(r.end) ? bare(r.start) : fmtTime(r.start)} to ${fmtTime(r.end)}`;
    });
    return `${day} ${joinOr(parts)}`;
  });
  const list = days.length === 1 ? days[0] : `${days.slice(0, -1).join(", ")}, or ${days[days.length - 1]}`;
  return `I'm free ${list} (${zoneShort(runs[0]!.start)}). Does one of those work?`;
}

function joinOr(items: string[]): string {
  return items.length <= 2 ? items.join(" or ") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}
