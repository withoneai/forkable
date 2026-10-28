import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import clsx from "clsx";
import { OneClientError, oneFetch, useOneQuery, type OneMeta } from "../lib/one-client";
import { Button, ErrorState, Skeleton, SourceChip } from "../lib/one-ui";
import type { BriefResponse } from "../rill/types";

export interface RillMorningBriefProps {
  /** Open a thread the brief names. */
  onOpen?: (threadId: string) => void;
  className?: string;
}

const KPIS: { key: keyof BriefResponse["kpis"]; label: string }[] = [
  { key: "vipsWaiting", label: "VIPs waiting" },
  { key: "goalMoves", label: "Goal moves" },
  { key: "repliesOwed", label: "Replies owed" },
  { key: "followUps", label: "Follow-ups" },
  { key: "newSenders", label: "New senders" },
];

/** Rill's morning brief over the judged inbox. Numbers from code; sentences from Claude only when asked. */
export function RillMorningBrief({ onOpen, className }: RillMorningBriefProps) {
  const q = useOneQuery<BriefResponse>("/api/rill/brief");
  const [written, setWritten] = useState<{ data: BriefResponse; meta: OneMeta } | null>(null);
  const [writing, setWriting] = useState(false);
  const [err, setErr] = useState<OneClientError | null>(null);
  useEffect(() => setWritten(null), [q.data]);

  const brief = written?.data ?? q.data;
  const write = async () => {
    setWriting(true);
    setErr(null);
    try {
      setWritten(await oneFetch<BriefResponse>("/api/rill/brief/write", { method: "POST", body: {} }));
    } catch (e) {
      setErr(e instanceof OneClientError ? e : new OneClientError(0, "network", String(e)));
    } finally {
      setWriting(false);
    }
  };

  return (
    <div data-block="rill-morning-brief" className={clsx("flex min-h-0 flex-col gap-4 overflow-y-auto p-4 [&>*]:shrink-0", className)}>
      <div className="flex items-center gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-10 uppercase tracking-[0.05em] text-muted-foreground">Morning brief</span>
          <span className="text-15 font-semibold text-foreground">
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </span>
        </div>
        <span className="ml-auto">
          <SourceChip meta={written?.meta ?? q.meta} />
        </span>
      </div>

      {q.loading && !brief ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.reload} />
      ) : brief ? (
        <>
          <div className="grid grid-cols-5 overflow-hidden rounded-lg border border-border">
            {KPIS.map((k, i) => (
              <div key={k.key} className={clsx("flex flex-col gap-0.5 px-3 py-2", i > 0 && "border-l border-border")}>
                <span className="text-15 font-semibold tabular-nums text-foreground">{brief.kpis[k.key]}</span>
                <span className="truncate text-10 text-muted-foreground">{k.label}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm leading-relaxed text-foreground">{brief.text}</p>
            <div className="flex items-center gap-2">
              {brief.writtenBy === "code" ? (
                <Button onClick={write} disabled={writing} title="Sends the counted threads (subjects, senders, summaries) to Claude on your own Anthropic account.">
                  <Sparkles className="size-3.5" />
                  {writing ? "Writing" : "Write with Claude"}
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => setWritten(null)}>
                  Show the plain counts
                </Button>
              )}
              <span className="text-11 text-muted-foreground">{brief.writtenBy === "code" ? "Counted in code. Claude only sees the threads listed below." : "Written by Claude from the counted threads."}</span>
            </div>
            {err && <ErrorState error={err} />}
          </div>

          <ul className="flex flex-col">
            {brief.lines.map((l) => (
              <li key={l.threadId + l.when}>
                <button onClick={() => onOpen?.(l.threadId)} className="flex w-full items-start gap-3 border-t border-border py-2.5 text-left hover:bg-card/60">
                  <span className={clsx("mt-1.5 size-1.5 shrink-0 rounded-full", l.tone === "warning" || l.tone === "negative" ? "bg-accent" : "bg-foreground/30")} />
                  <span className="w-28 shrink-0 truncate text-11 text-muted-foreground">{l.when}</span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-13 font-medium text-foreground">{l.title}</span>
                    <span className="text-xs text-muted-foreground">{l.detail}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
