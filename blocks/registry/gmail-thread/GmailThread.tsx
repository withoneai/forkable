import type { ReactNode } from "react";
import clsx from "clsx";
import { useOneQuery } from "../lib/one-client";
import { Avatar, ErrorState, Skeleton, SourceChip } from "../lib/one-ui";
import type { MailThreadDetail } from "../gmail/types";

export interface GmailThreadProps {
  threadId: string | null;
  /** Rendered in the header, right side. Put GmailThreadActions here. */
  actions?: ReactNode;
  /** Rendered under the last message. Put GmailAiReply here. */
  footer?: ReactNode;
  className?: string;
}

/** One Gmail thread, every message in order, the newest open. */
export function GmailThread({ threadId, actions, footer, className }: GmailThreadProps) {
  const { data, meta, loading, error, reload } = useOneQuery<MailThreadDetail>(threadId ? `/api/gmail/threads/${encodeURIComponent(threadId)}` : null);

  if (!threadId) return <div data-block="gmail-thread" className={clsx("flex items-center justify-center text-13 text-muted-foreground", className)}>Pick a thread to read it.</div>;

  return (
    <div data-block="gmail-thread" className={clsx("flex min-h-0 flex-col", className)}>
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {loading && !data ? <Skeleton className="h-4 w-2/3" /> : <h2 className="text-15 font-semibold text-foreground">{data?.subject}</h2>}
          <div className="flex items-center gap-1.5">
            <SourceChip meta={meta} />
            {data && <span className="text-11 text-muted-foreground">{data.count} {data.count === 1 ? "message" : "messages"}</span>}
          </div>
        </div>
        {actions}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="p-4">
            <ErrorState error={error} onRetry={reload} />
          </div>
        ) : loading && !data ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ) : (
          <div className="flex flex-col">
            {data?.messages.map((m, i) => {
              const last = i === data.messages.length - 1;
              return (
                <details key={m.id} open={last} className="group border-b border-border px-4 py-3">
                  <summary className="-mx-1 flex cursor-pointer list-none items-center gap-2 rounded-md px-1 focus-visible:outline-offset-0">
                    <Avatar name={m.from.name} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-13 font-medium text-foreground">
                        {m.fromMe ? "You" : m.from.name} <span className="font-normal text-muted-foreground">{m.from.email}</span>
                      </span>
                      <span className="truncate text-11 text-muted-foreground group-open:hidden">{m.body.replace(/\s+/g, " ").slice(0, 120)}</span>
                      <span className="hidden truncate text-11 text-muted-foreground group-open:block">to {m.to.join(", ")}</span>
                    </div>
                    <time className="shrink-0 text-11 text-muted-foreground">{new Date(m.date).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
                  </summary>
                  <div className="whitespace-pre-wrap pt-3 pl-9 text-13 leading-relaxed text-foreground">{m.body}</div>
                </details>
              );
            })}
            {footer && <div className="px-4 py-3">{footer}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
