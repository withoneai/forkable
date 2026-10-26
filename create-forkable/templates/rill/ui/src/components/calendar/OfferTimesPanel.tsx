import { Fragment, useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { useCalendar, useOfferTimes, useProposeTime, useSettings } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { addDays, fmtDay, localDay, utcDayToLocalWindow } from "@/lib/calendarLayout";
import { cn } from "@/lib/utils";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

interface Slot { start: string; end: string }

/**
 * Pick open slots on your own calendar. "offer" inserts them as plain text in
 * the draft; "propose" asks the writer for a reply proposing them instead of
 * the invite's time. Either way nothing is sent: the draft waits for a keypress.
 */
export function OfferTimesPanel({
  mailboxId, threadId, open, onClose, mode, onInsert,
}: {
  mailboxId: string; threadId: string; open: boolean; onClose: () => void; mode: "offer" | "propose"; onInsert?: (text: string) => void;
}) {
  const settingsQ = useSettings(mailboxId);
  const tz = settingsQ.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const wh = settingsQ.data?.workingHours ?? { days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1080 };
  const offer = useOfferTimes(mailboxId);
  const propose = useProposeTime(mailboxId);
  const [picked, setPicked] = useState<Slot[]>([]);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => { if (open) { setPicked([]); setPreview(null); } }, [open]);

  const days = useMemo(() => {
    const out: Date[] = [];
    let d = addDays(localDay(new Date(), tz), 1);
    while (out.length < 5) {
      if (wh.days.includes(d.getUTCDay())) out.push(d);
      d = addDays(d, 1);
    }
    return out;
  }, [tz, wh.days]);
  const minutes = useMemo(() => {
    const out: number[] = [];
    for (let m = wh.startMinute; m + 30 <= wh.endMinute; m += 30) out.push(m);
    return out;
  }, [wh.startMinute, wh.endMinute]);

  const from = utcDayToLocalWindow(days[0]!, tz).from;
  const to = utcDayToLocalWindow(days[days.length - 1]!, tz).to;
  const cal = useCalendar(mailboxId, from, to);
  const busy = (cal.data?.events ?? []).filter((e) => e.status !== "cancelled" && !e.allDay && e.myResponse !== "declined");

  const slotAt = (day: Date, minute: number): Slot => {
    const base = new Date(utcDayToLocalWindow(day, tz).from).getTime();
    return { start: new Date(base + minute * 60_000).toISOString(), end: new Date(base + (minute + 30) * 60_000).toISOString() };
  };
  const isBusy = (s: Slot) => busy.some((e) => e.start < s.end && e.end > s.start);
  const toggle = (s: Slot) => {
    setPreview(null);
    setPicked((prev) => prev.some((p) => p.start === s.start) ? prev.filter((p) => p.start !== s.start) : prev.length >= 4 ? prev : [...prev, s].sort((a, b) => a.start.localeCompare(b.start)));
  };

  const run = () => {
    if (mode === "offer") {
      offer.mutate({ threadId, input: { threadId, durationMinutes: 30, slots: picked } }, {
        onSuccess: (r) => {
          setPreview(r.text);
          if (!r.stillFree) toast({ title: "A slot was just taken", detail: "It was left out of the text." });
        },
        onError: (e) => toast({ title: "Could not check those times", detail: e.message, tone: "destructive" }),
      });
    } else {
      propose.mutate({ threadId, slots: picked }, {
        onSuccess: () => { toast({ title: "Reply drafted", detail: "It proposes the times you picked. Read it, then send." }); onClose(); },
        onError: (e) => toast({ title: "Could not draft the reply", detail: e.message, tone: "destructive" }),
      });
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={mode === "offer" ? "Offer times" : "Propose a new time"} size="lg">
      <div className="flex flex-col gap-3 p-4">
        <p className="text-xs text-muted-foreground">Pick up to 4 half-hour slots. Busy times are greyed out. Times shown in {tz.replace(/_/g, " ")}.</p>
        <div className="max-h-[52vh] overflow-y-auto">
          <div className="grid gap-px" style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))` }}>
            <div />
            {days.map((d) => (
              <div key={d.toISOString()} className="sticky top-0 bg-card pb-1.5 text-center text-11 font-medium text-muted-foreground">{fmtDay(d.toISOString(), "UTC", { weekday: "short" })} {fmtDay(d.toISOString(), "UTC", { day: "numeric" })}</div>
            ))}
            {minutes.map((m) => (
              <Fragment key={m}>
                <div className="tnum pr-2 text-right text-10 leading-7 text-muted-foreground">{m % 60 === 0 ? new Date(Date.UTC(2000, 0, 1, Math.floor(m / 60))).toLocaleTimeString("en-US", { hour: "numeric", timeZone: "UTC" }) : ""}</div>
                {days.map((d) => {
                  const s = slotAt(d, m);
                  const taken = isBusy(s);
                  const on = picked.some((p) => p.start === s.start);
                  return (
                    <button
                      key={s.start}
                      type="button"
                      disabled={taken}
                      onClick={() => toggle(s)}
                      aria-pressed={on}
                      aria-label={`${fmtDay(s.start, tz)} ${new Date(s.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz })}${taken ? ", busy" : ""}`}
                      className={cn(
                        "flex h-7 items-center justify-center rounded-sm transition-colors duration-75",
                        taken ? "cursor-not-allowed bg-muted" : on ? "bg-accent/15 text-accent ring-1 ring-inset ring-accent" : "bg-card ring-1 ring-inset ring-border hover:bg-card-hover",
                      )}
                    >
                      {on && <Check className="size-3" />}
                    </button>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
        {preview && <p className="rounded-md border border-border bg-faint px-3 py-2 text-13">{preview}</p>}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
        <span className="tnum text-11 text-muted-foreground">{picked.length} of 4 picked</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {mode === "offer" && !preview && <Button disabled={!picked.length} loading={offer.isPending} onClick={run}>Preview</Button>}
          {mode === "offer" && preview && <Button variant="primary" onClick={() => { onInsert?.(preview); onClose(); }}>Insert into draft</Button>}
          {mode === "propose" && <Button variant="primary" disabled={!picked.length} loading={propose.isPending} onClick={run}>Draft the reply</Button>}
        </div>
      </div>
    </Dialog>
  );
}
