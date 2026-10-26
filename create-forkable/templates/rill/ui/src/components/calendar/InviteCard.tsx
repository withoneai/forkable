import { useState } from "react";
import { AlertTriangle, Video } from "lucide-react";
import type { ApiInvite } from "@rill/core/api-types";
import { useRsvp, useSettings } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { useKeys } from "@/lib/keys";
import { fmtDay, fmtRange } from "@/lib/calendarLayout";
import { cn } from "@/lib/utils";
import { Button } from "../ui/Button";
import { Kbd } from "../ui/Kbd";
import { OfferTimesPanel } from "./OfferTimesPanel";

type Answer = "accepted" | "declined" | "tentative";
const LABEL: Record<Answer, string> = { accepted: "Going", declined: "Not going", tentative: "Maybe" };

/** Shown on hover or keyboard focus only, so the buttons read as words first. */
const Hint = ({ k }: { k: string }) => (
  <Kbd className="h-4 min-w-4 bg-transparent px-1 text-10 opacity-0 shadow-none transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70">{k}</Kbd>
);

function people(invite: ApiInvite): string {
  const others = invite.event.attendees.filter((a) => !a.self);
  const org = others.find((a) => a.organizer);
  const rest = others.filter((a) => a !== org);
  const first = (a: { name: string | null; email: string }) => (a.name ?? a.email).split(" ")[0];
  const head = [org ? `${first(org)} (organizer)` : null, ...rest.slice(0, 2).map(first)].filter(Boolean).join(", ");
  return rest.length > 2 ? `${head} + ${rest.length - 2}` : head;
}

/**
 * The invite, answered in the thread. The reply comes first and Yes is the
 * one accent button; Join is a quiet link because most invites are days away.
 * Moved invites show the old time struck through; cancelled ones are struck out.
 */
export function InviteCard({ mailboxId, threadId, invite }: { mailboxId: string; threadId: string; invite: ApiInvite }) {
  const settingsQ = useSettings(mailboxId);
  const tz = settingsQ.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(invite.event.start)).find((p) => p.type === "timeZoneName")?.value ?? "";
  const rsvp = useRsvp(mailboxId);
  const [answered, setAnswered] = useState<Answer | null>(null);
  const [proposeOpen, setProposeOpen] = useState(false);
  const cancelled = invite.event.status === "cancelled";
  const canRsvp = !cancelled && !invite.rsvpByEmail && !!invite.eventId;

  const act = (response: Answer) => {
    if (!canRsvp) return;
    setAnswered(response);
    rsvp.mutate({ eventId: invite.eventId!, action: { response } }, {
      onSuccess: () => toast({ title: LABEL[response], detail: "The organizer sees your answer." }),
      onError: (e) => { setAnswered(null); toast({ title: "RSVP not sent", detail: e.message, tone: "destructive" }); },
    });
  };
  useKeys({
    y: () => { if (canRsvp) act("accepted"); else return false; },
    n: () => { if (canRsvp) act("declined"); else return false; },
    m: () => { if (canRsvp) act("tentative"); else return false; },
    p: () => { if (!cancelled) setProposeOpen(true); else return false; },
  }, { priority: 3 });

  const mine = answered ?? (invite.event.myResponse === "needsAction" ? null : invite.event.myResponse);
  const when = fmtDay(invite.event.start, tz, { weekday: "short", month: "short", day: "numeric" });

  return (
    <>
      <OfferTimesPanel mailboxId={mailboxId} threadId={threadId} open={proposeOpen} onClose={() => setProposeOpen(false)} mode="propose" />
      <section aria-label="Invite" className={cn("fade-in flex gap-3 rounded-lg border border-border bg-card p-3", cancelled && "bg-faint")}>
        <div className={cn("flex size-11 shrink-0 flex-col items-center justify-center rounded-md border border-border bg-faint leading-none", cancelled && "opacity-60")}>
          <span className="text-9 font-medium uppercase tracking-wide text-muted-foreground">{fmtDay(invite.event.start, tz, { month: "short" })}</span>
          <span className="tnum mt-0.5 text-15 font-semibold">{fmtDay(invite.event.start, tz, { day: "numeric" })}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <p className={cn("truncate text-13 font-semibold", cancelled && "text-muted-foreground line-through")}>{invite.event.title}</p>
            {invite.movedFrom && !cancelled ? (
              <p className="tnum text-xs text-muted-foreground">
                <span className="line-through">{fmtRange(invite.movedFrom.start, invite.movedFrom.end, tz)}</span>
                {"  "}<span className="font-medium text-foreground">Moved to {when}, {fmtRange(invite.event.start, invite.event.end, tz)} {zone}</span>
              </p>
            ) : (
              <p className={cn("tnum text-xs text-muted-foreground", cancelled && "line-through")}>{when} · {fmtRange(invite.event.start, invite.event.end, tz)} {zone}</p>
            )}
            <p className="truncate text-xs text-muted-foreground">{people(invite)}</p>
            {invite.conflict && !cancelled && (
              <p className="flex items-center gap-1.5 text-xs text-warning-text">
                <AlertTriangle className="size-3 shrink-0" /> Overlaps {invite.conflict.title}, {fmtRange(invite.conflict.start, invite.conflict.end, tz)}
              </p>
            )}
          </div>

          {cancelled ? (
            <p className="text-xs text-muted-foreground">The organizer cancelled this event. Nothing to answer.</p>
          ) : invite.rsvpByEmail ? (
            <p className="text-xs text-muted-foreground">This event is not on your calendar yet. Reply by email for now.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant={mine === null || mine === "accepted" ? "primary" : "default"} className="group" loading={rsvp.isPending && answered === "accepted"} onClick={() => act("accepted")} trailing={<Hint k="Y" />} aria-pressed={mine === "accepted"}>
                {mine === "accepted" ? "Going" : "Yes"}
              </Button>
              <Button size="sm" variant={mine === "tentative" ? "primary" : "default"} className="group" loading={rsvp.isPending && answered === "tentative"} onClick={() => act("tentative")} trailing={<Hint k="M" />} aria-pressed={mine === "tentative"}>Maybe</Button>
              <Button size="sm" variant={mine === "declined" ? "primary" : "default"} className="group" loading={rsvp.isPending && answered === "declined"} onClick={() => act("declined")} trailing={<Hint k="N" />} aria-pressed={mine === "declined"}>No</Button>
              <Button size="sm" variant="ghost" className="group" onClick={() => setProposeOpen(true)} trailing={<Hint k="P" />}>New time</Button>
              {invite.event.joinUrl && (
                <a href={invite.event.joinUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground">
                  <Video className="size-3.5" /> Join
                </a>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
