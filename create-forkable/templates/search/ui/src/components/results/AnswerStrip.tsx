// The answer strip (SPEC 14, search-ux-mobbin.md 2.3 item 4): a question-shaped
// query gets a short cited answer above the list. It loads on its own and
// never holds the rows back. A saved answer (lib/searchCache) renders at once with no
// call; `rev` changes on Refresh so the answer is asked again.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { AnswerResponse } from "@/contract/api-types";
import { MessageCircle, Sparkles } from "lucide-react";
import { isQuestion } from "@/contract/query";
import { ApiError } from "@/lib/api";
import { streamAnswer } from "@/lib/chatStream";
import { useWorkspace } from "@/lib/workspace";
import { MOD } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";
import { LogoStack } from "@/components/SourceLogo";
import { CitedText, modelDetail, modelLabel, useOpenCitation } from "@/components/chat/citations";

export const answerKey = (query: string, rev: number) => ["answer", query, rev] as const;

export function AnswerStrip({ query, queryId, rev = 0, cached = null, onAnswer }: {
  query: string; queryId: string | null; rev?: number; cached?: AnswerResponse | null; onAnswer?: (a: AnswerResponse) => void;
}) {
  const ws = useWorkspace();
  const open = useOpenCitation();
  const enabled = isQuestion(query);
  // what the answer is doing right now, in plain words, from the first second (never a bare grey bar)
  const [step, setStep] = useState<{ label: string; since: number }>({ label: "Reading the results", since: Date.now() });
  const q = useQuery({
    queryKey: answerKey(query, rev),
    queryFn: ({ signal }) => {
      setStep({ label: "Reading the results", since: Date.now() });
      return streamAnswer({ q: query, queryId: queryId ?? undefined }, (s) => { const l = progressLabel(s); if (l) setStep({ label: l, since: Date.now() }); }, signal);
    },
    enabled,
    initialData: cached ?? undefined,
    staleTime: cached ? Infinity : 60_000,
    retry: false,
  });
  useEffect(() => { if (q.data && q.data !== cached) onAnswer?.(q.data); }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!enabled) return null;
  if (q.isError) {
    const e = q.error;
    // no answer at all, said in one plain line with the way to set it up (never pasted snippets)
    if (e instanceof ApiError && e.code === "model_unavailable") {
      return (
        <p className="mx-3 my-2 text-11 text-muted-foreground" data-testid="answer-unavailable">
          {/Claude Code|Codex/.test(e.message) ? "No answer: the assistant is not set up on this computer yet." : e.message}{" "}
          <Link to="/settings/assistant" className="font-medium text-foreground underline-offset-2 hover:underline">Set up the assistant</Link>
        </p>
      );
    }
    return null;
  }
  return (
    <section aria-label="Answer" data-testid="answer-strip" className="fade-in mx-3 my-2 flex flex-col gap-2 rounded-lg border border-border bg-faint px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-11 text-muted-foreground">
        <Sparkles className="size-3" />
        <span className="font-medium">Answer</span>
        {q.data && modelLabel(q.data.model) && <span className="truncate" title={modelDetail(q.data.model)}>· {modelLabel(q.data.model)}</span>}
      </div>
      {!q.data ? (
        <AnswerProgress label={step.label} since={step.since} />
      ) : (
        <>
          <CitedText text={q.data.text} citations={q.data.citations} onOpen={open} />
          {!q.data.grounded && <p className="text-11 text-warning-text">Not grounded in your results</p>}
          <div className="flex items-center gap-2 text-11 text-muted-foreground">
            {q.data.citations.length > 0 && (
              <span className="flex items-center gap-1.5">
                <LogoStack platforms={q.data.citations.map((c) => c.platform)} size={12} />
                <span className="tnum">{q.data.citations.length} {q.data.citations.length === 1 ? "source" : "sources"}</span>
              </span>
            )}
            <button type="button" onClick={() => ws.askAbout(undefined, query)} className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-md px-1.5 font-medium text-foreground transition-colors hover:bg-card-hover">
              <MessageCircle className="size-3" /> Continue in chat <span className="text-muted-foreground">{MOD}J</span>
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** A step of the answer as the person reads it: "Reading 32 results", "Searching for ...", "Writing the answer". */
export function progressLabel(s: { id: string; label: string; state: string; count?: number; query?: string }): string | null {
  if (s.id === "read") return s.state === "done" ? (s.count ? `Read ${s.count} ${s.count === 1 ? "result" : "results"}, writing the answer` : "Writing the answer") : s.label;
  if (s.id === "write") return s.state === "done" ? null : "Writing the answer";
  if (s.query) return s.state === "done" ? "Writing the answer" : `Looking for ${s.query}`;
  return null;
}

/** The step in words, with the seconds it has taken once it takes a while; the list stays usable meanwhile. */
function AnswerProgress({ label, since }: { label: string; since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const secs = Math.max(0, Math.round((now - since) / 1000));
  return (
    <div className="flex flex-col gap-1.5 py-0.5" role="status" aria-label="Reading the results" aria-live="polite" data-testid="answer-progress">
      <p className="text-xs text-muted-foreground">{label}...{secs >= 5 && <span className="tnum"> {secs} s</span>}</p>
      <Skeleton className="h-2.5 w-[78%]" />
      <Skeleton className="h-2.5 w-[54%]" />
    </div>
  );
}
