import { Link } from "react-router-dom";
import { AlertTriangle, Calendar, Check, ExternalLink, Video } from "lucide-react";
import type { EventSummary } from "@rill/core/types";
import { useBrief, useRsvp, useSettings } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { fmtRange } from "@/lib/calendarLayout";
import { cn } from "@/lib/utils";
import { EmptyState } from "../ui/EmptyState";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";

export function TodayRail({ mailboxId }: { mailboxId: string }) {
  const settingsQ = useSettings(mailboxId);
  const tz = settingsQ.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const briefQ = useBrief(mailboxId);
  const rsvp = useRsvp(mailboxId);
  const now = Date.now();

  if (briefQ.isPending) {
    return (
      <aside className="flex w-[240px] shrink-0 flex-col gap-3 border-l border-border bg-faint p-4" aria-label="Today">
        <Skeleton className="h-4 w-20" /><Skeleton className="h-16 w-full rounded-lg" /><Skeleton className="h-10 w-full rounded-lg" />
      </aside>
    );
  }

  const meetings = briefQ.data?.today.meetings ?? [];
  const next = meetings.find((m) => new Date(m.end).getTime() > now) ?? null;
  const rest = meetings.filter((m) => m.eventId !== next?.eventId);

  return (
    <aside className="flex w-[240px] shrink-0 flex-col gap-5 overflow-y-auto border-l border-border bg-faint p-4" aria-label="Today">
      <div className="flex items-center justify-between">
        <p className="label-caps">Today</p>
        <Link to="/calendar" className="text-11 text-muted-foreground transition-colors hover:text-foreground">Full calendar</Link>
      </div>

      {meetings.length === 0 ? (
        <EmptyState icon={<Calendar />} title="Nothing on the calendar" className="py-6" />
      ) : (
        <>
          {next && (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
              <p className="tnum text-11 text-muted-foreground">{fmtRange(next.start, next.end, tz)}</p>
              <p className="text-13 font-medium leading-snug">{next.title}</p>
              {next.joinUrl && (
                <a href={next.joinUrl} target="_blank" rel="noreferrer" className="flex h-7 items-center justify-center gap-1.5 rounded-md border border-border bg-card text-xs font-medium transition-colors hover:bg-card-hover">
                  <Video className="size-3" /> Join <ExternalLink className="size-2.5" />
                </a>
              )}
              {next.needsRsvp && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="flex-1" icon={<Check />} loading={rsvp.isPending} onClick={() => rsvp.mutate({ eventId: next.eventId, action: { response: "accepted" } }, { onSuccess: () => toast({ title: "Going" }) })}>Yes</Button>
                </div>
              )}
            </div>
          )}
          {rest.length > 0 && (
            <div>
              <p className="label-caps mb-1.5">Later today</p>
              <ul className="flex flex-col">
                {rest.map((m) => <MeetingRow key={m.eventId} m={m} tz={tz} />)}
              </ul>
            </div>
          )}
        </>
      )}

      {briefQ.data && briefQ.data.today.conflicts.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-warning-text/30 bg-warning-text/[0.08] px-2.5 py-2 text-11 text-warning-text">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          <span>{briefQ.data.today.conflicts[0]!.a} conflicts with {briefQ.data.today.conflicts[0]!.b}.</span>
        </div>
      )}
    </aside>
  );
}

function MeetingRow({ m, tz }: { m: EventSummary; tz: string }) {
  return (
    <li className="flex h-7 items-center gap-2 text-xs">
      <span className="tnum w-[64px] shrink-0 text-muted-foreground">{fmtRange(m.start, m.end, tz).split(" – ")[0]}</span>
      <span className="min-w-0 flex-1 truncate">{m.title}</span>
      {m.needsRsvp && <span className="shrink-0 text-11 text-muted-foreground">reply</span>}
    </li>
  );
}
