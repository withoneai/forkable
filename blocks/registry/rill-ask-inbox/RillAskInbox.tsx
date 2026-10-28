import { useState } from "react";
import { ArrowUp } from "lucide-react";
import clsx from "clsx";
import { OneClientError, oneFetch, timeAgo, type OneMeta } from "../lib/one-client";
import { Button, ErrorState, Skeleton, SourceChip } from "../lib/one-ui";
import type { AskResponse } from "../rill/types";

export interface RillAskInboxProps {
  /** Open a cited thread. */
  onOpen?: (threadId: string) => void;
  suggestions?: string[];
  className?: string;
}

const DEFAULT_SUGGESTIONS = ["What did Priya ask about the term sheet?", "When is Omar's onsite?", "Who is waiting on the security questionnaire?"];

/** Ask a question of the user's own mail. Answers cite exact quotes, checked against the thread. */
export function RillAskInbox({ onOpen, suggestions = DEFAULT_SUGGESTIONS, className }: RillAskInboxProps) {
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [res, setRes] = useState<{ data: AskResponse; meta: OneMeta } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<OneClientError | null>(null);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setAsked(question);
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      setRes(await oneFetch<AskResponse>("/api/rill/ask", { method: "POST", body: { q: question } }));
    } catch (e) {
      setErr(e instanceof OneClientError ? e : new OneClientError(0, "network", String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-block="rill-ask-inbox" className={clsx("flex min-h-0 flex-col gap-4 p-4", className)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        className="flex items-center gap-2 rounded-lg border border-border bg-raised p-1.5 pl-3 transition-colors focus-within:border-strong"
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask your inbox" className="min-w-0 flex-1 bg-transparent text-13 text-foreground outline-none placeholder:text-muted-foreground" />
        <Button type="submit" variant="primary" icon disabled={!q.trim() || busy} aria-label="Ask">
          <ArrowUp className="size-4" />
        </Button>
      </form>

      {!asked && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <Button
              key={s}
              size="sm"
              onClick={() => {
                setQ(s);
                ask(s);
              }}
            >
              {s}
            </Button>
          ))}
        </div>
      )}

      {asked && (
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <div className="flex items-center gap-2">
            <span className="text-11 text-muted-foreground">{asked}</span>
            <span className="ml-auto">
              <SourceChip meta={res?.meta ?? null} />
            </span>
          </div>
          {busy ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          ) : err ? (
            <ErrorState error={err} onRetry={() => ask(asked)} />
          ) : res ? (
            <>
              <p className="text-sm leading-relaxed text-foreground">{res.data.answer}</p>
              {res.data.citations.length > 0 && (
                <ol className="flex flex-col gap-1.5">
                  {res.data.citations.map((c, i) => (
                    <li key={i}>
                      <button onClick={() => onOpen?.(c.threadId)} className="flex w-full gap-2.5 rounded-md border border-border bg-raised p-2.5 text-left transition-colors hover:border-strong">
                        <span className="font-mono text-10 text-muted-foreground">{i + 1}</span>
                        <span className="flex min-w-0 flex-col gap-1">
                          <span className="text-xs text-foreground">"{c.quote}"</span>
                          <span className="truncate text-11 text-muted-foreground">
                            {c.subject} · {c.from.replace(/ <.*/, "")} · {timeAgo(c.date)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <span className="text-11 text-muted-foreground">Searched {res.data.searched} threads. Every quote above was checked against its thread.</span>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
