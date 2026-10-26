import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, RefreshCw, Video } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMailboxId } from "@/lib/mailbox";
import { keys, useBrief, useSettings } from "@/lib/queries";
import { fmtRange } from "@/lib/calendarLayout";
import { cn, fmtDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";

const TONE: Record<string, string> = {
  neutral: "bg-muted-foreground/40",
  positive: "bg-success-text",
  warning: "bg-warning-text",
  negative: "bg-destructive-text",
};

export function Brief() {
  const mailboxId = useMailboxId();
  const qc = useQueryClient();
  const q = useBrief(mailboxId);
  const settingsQ = useSettings(mailboxId);
  const tz = settingsQ.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const b = q.data;
  const groups = b ? [...new Set(b.lines.map((l) => l.when))] : [];
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-7 px-6 pb-12 pt-7">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="label-caps">{today}</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">Morning brief</h1>
          </div>
          <Button size="sm" variant="ghost" title="Reloads today's brief. A new one is written once a day." icon={<RefreshCw className={cn(q.isFetching && "animate-spin")} />} onClick={() => qc.invalidateQueries({ queryKey: keys.brief(mailboxId) })} disabled={q.isFetching}>Refresh</Button>
        </header>

        {q.isPending ? (
          <div className="flex flex-col gap-6" aria-busy>
            <p className="text-13 text-muted-foreground">Writing today's brief from your judged email. This takes a few seconds the first time.</p>
            <div className="grid grid-cols-5 gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[78px] rounded-lg" />)}</div>
            <div className="flex flex-col gap-2"><Skeleton className="h-3.5 w-full" /><Skeleton className="h-3.5 w-[92%]" /><Skeleton className="h-3.5 w-[70%]" /></div>
            <Skeleton className="h-48 w-full" />
          </div>
        ) : q.isError || !b ? (
          <LoadError what="Today's brief" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} className="rounded-lg border border-border bg-card" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
              {b.kpis.map((k) => (
                <div key={k.label} className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5">
                  <span className="truncate text-11 text-muted-foreground">{k.label}</span>
                  <span className={cn("tnum text-28 font-semibold leading-none tracking-tight", k.value === 0 && "text-muted-foreground/60")}>{k.value}</span>
                  <span className="truncate text-11 text-muted-foreground">{k.hint}</span>
                </div>
              ))}
            </div>

            <p className="text-15 leading-relaxed">{b.text}</p>

            {b.today.meetings.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="label-caps">Today</h2>
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  {b.today.meetings.map((m) => (
                    <div key={m.eventId} className="flex h-9 items-center gap-3 border-b border-border px-3 text-13 last:border-b-0">
                      <span className="tnum w-[136px] shrink-0 whitespace-nowrap text-xs text-muted-foreground">{fmtRange(m.start, m.end, tz)}</span>
                      <span className="min-w-0 flex-1 truncate">{m.title}</span>
                      {m.needsRsvp && <span className="shrink-0 text-11 text-muted-foreground">Waiting on your reply</span>}
                      <span className="flex w-4 shrink-0 justify-end">{m.joinUrl && <a href={m.joinUrl} target="_blank" rel="noreferrer" aria-label="Join" className="text-muted-foreground transition-colors hover:text-foreground"><Video className="size-3.5" /></a>}</span>
                    </div>
                  ))}
                </div>
                {b.today.conflicts.length > 0 && (
                  <p className="flex items-center gap-1.5 text-11 text-warning-text"><AlertTriangle className="size-3" /> {b.today.conflicts[0]!.a} conflicts with {b.today.conflicts[0]!.b}.</p>
                )}
              </section>
            )}

            <section className="flex flex-col gap-5">
              <h2 className="label-caps">What moved your goals</h2>
              {groups.map((g) => (
                <div key={g} className="grid grid-cols-[132px_1fr] gap-x-4">
                  <p className="pt-[7px] text-xs font-medium text-muted-foreground">{g}</p>
                  <ol className="relative flex flex-col border-l border-border">
                    {b.lines.filter((l) => l.when === g).map((l, i) => {
                      const inner = (
                        <>
                          <span className={cn("absolute -left-[5px] top-[13px] size-[9px] rounded-full ring-2 ring-background", TONE[l.tone ?? "neutral"])} />
                          <span className="flex items-center gap-2 text-13 font-medium leading-snug">
                            {l.title}
                            {l.threadId && <ArrowRight className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />}
                          </span>
                          <span className="text-xs text-muted-foreground">{l.detail}</span>
                        </>
                      );
                      return (
                        <li key={i} className="relative">
                          {l.threadId ? (
                            <Link to={`/thread/${l.threadId}`} className="group -my-px flex flex-col gap-0.5 rounded-md py-2 pl-4 pr-2 transition-colors hover:bg-faint">{inner}</Link>
                          ) : (
                            <div className="flex flex-col gap-0.5 py-2 pl-4 pr-2">{inner}</div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </section>

            <p className="text-11 text-muted-foreground">Written {fmtDateTime(b.generatedAt)} by <span className="font-mono">{b.model}</span> from stored judgments. No email was re-read to make this.</p>
          </>
        )}
      </div>
    </div>
  );
}
