// The answer strip (SPEC 14, search-ux-mobbin.md 2.3 item 4): a question-shaped
// query gets a short cited answer above the list. It loads on its own and
// never holds the rows back. A saved answer (lib/searchCache) renders at once with no
// call; `rev` changes on Refresh so the answer is asked again.
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AnswerResponse } from "@/contract/api-types";
import { MessageCircle, Sparkles } from "lucide-react";
import { isQuestion } from "@/contract/query";
import { api, ApiError } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import { MOD } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";
import { LogoStack } from "@/components/SourceLogo";
import { CitedText, modelLabel, useOpenCitation } from "@/components/chat/citations";

export const answerKey = (query: string, rev: number) => ["answer", query, rev] as const;

export function AnswerStrip({ query, queryId, rev = 0, cached = null, onAnswer }: {
  query: string; queryId: string | null; rev?: number; cached?: AnswerResponse | null; onAnswer?: (a: AnswerResponse) => void;
}) {
  const ws = useWorkspace();
  const open = useOpenCitation();
  const enabled = isQuestion(query);
  const q = useQuery({
    queryKey: answerKey(query, rev),
    queryFn: () => api.answer({ q: query, queryId: queryId ?? undefined }),
    enabled,
    initialData: cached ?? undefined,
    staleTime: cached ? Infinity : 60_000,
    retry: false,
  });
  useEffect(() => { if (q.data && q.data !== cached) onAnswer?.(q.data); }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!enabled) return null;
  if (q.isError) {
    const e = q.error;
    if (e instanceof ApiError && e.code === "model_unavailable") {
      return <p className="mx-3 my-2 text-11 text-muted-foreground">{e.message} The results below are unaffected.</p>;
    }
    return null;
  }
  return (
    <section aria-label="Answer" data-testid="answer-strip" className="fade-in mx-3 my-2 flex flex-col gap-2 rounded-lg border border-border bg-faint px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-11 text-muted-foreground">
        <Sparkles className="size-3" />
        <span className="font-medium">Answer</span>
        {q.data && <span className="truncate">· {modelLabel(q.data.model)}</span>}
      </div>
      {!q.data ? (
        <div className="flex flex-col gap-1.5 py-0.5" role="status" aria-label="Reading the results">
          <Skeleton className="h-2.5 w-[92%]" />
          <Skeleton className="h-2.5 w-[78%]" />
          <Skeleton className="h-2.5 w-[54%]" />
        </div>
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
