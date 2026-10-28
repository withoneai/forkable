import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { oneFetch, type OneClientError, type OneMeta } from "../lib/one-client";
import { Button, ErrorState, Skeleton, SourceChip } from "../lib/one-ui";

interface ReplyAssist {
  summary: string;
  ask: string | null;
  draft: string | null;
}

export interface GmailAiReplyProps {
  threadId: string;
  /** Who the reply goes to, for the saved draft. */
  replyTo?: string;
  subject?: string;
  /** Run as soon as the thread opens, or wait for a click. */
  auto?: boolean;
}

/** A summary, the ask, and a drafted reply the user edits and saves to Gmail Drafts. */
export function GmailAiReply({ threadId, replyTo, subject, auto = true }: GmailAiReplyProps) {
  const [state, setState] = useState<{ loading: boolean; data: ReplyAssist | null; meta: OneMeta | null; error: OneClientError | null }>({ loading: false, data: null, meta: null, error: null });
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | string>("idle");

  async function run() {
    setState({ loading: true, data: null, meta: null, error: null });
    setSaved("idle");
    try {
      const r = await oneFetch<ReplyAssist>(`/api/gmail/threads/${encodeURIComponent(threadId)}/assist`, { method: "POST" });
      setState({ loading: false, data: r.data, meta: r.meta, error: null });
      setDraft(r.data.draft ?? "");
    } catch (e) {
      setState({ loading: false, data: null, meta: null, error: e as OneClientError });
    }
  }

  useEffect(() => {
    setState({ loading: false, data: null, meta: null, error: null });
    if (auto) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  async function save() {
    if (!replyTo) return;
    setSaved("saving");
    try {
      await oneFetch("/api/gmail/drafts", { method: "POST", body: { to: [replyTo], subject: subject?.startsWith("Re:") ? subject : `Re: ${subject ?? ""}`, body: draft, threadId } });
      setSaved("saved");
    } catch (e) {
      setSaved((e as OneClientError).message);
    }
  }

  if (!state.data && !state.loading && !state.error) {
    return (
      <Button data-block="gmail-ai-reply" onClick={run}>
        <Sparkles className="size-3.5" /> Draft a reply
      </Button>
    );
  }

  return (
    <div data-block="gmail-ai-reply" className="flex flex-col gap-3 rounded-lg border border-border bg-foreground/3 p-3">
      <div className="flex items-center gap-1.5">
        <Sparkles className="size-3.5 text-accent" />
        <span className="text-xs font-medium text-foreground">Assistant</span>
        <SourceChip meta={state.meta} />
      </div>
      {state.error ? (
        <ErrorState error={state.error} onRetry={run} />
      ) : state.loading ? (
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="mt-2 h-16 w-full" />
        </div>
      ) : (
        state.data && (
          <>
            <div className="flex flex-col gap-1.5">
              <p className="text-13 leading-relaxed text-foreground">{state.data.summary}</p>
              {state.data.ask && <p className="text-xs text-muted-foreground">To do: {state.data.ask}</p>}
            </div>
            {state.data.draft !== null ? (
              <div className="flex flex-col gap-2">
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={7} className="w-full resize-y rounded-md border border-border bg-raised px-2.5 py-2 text-13 leading-relaxed text-foreground outline-none transition-colors hover:border-strong focus:border-strong focus:ring-3 focus:ring-primary/35" />
                <div className="flex items-center gap-2">
                  <span className="text-11 text-muted-foreground">{saved === "saving" ? "Saving..." : saved === "saved" ? "Saved to Gmail Drafts" : saved !== "idle" ? saved : "Edit it, then save. Nothing sends on its own."}</span>
                  <div className="ml-auto flex gap-2">
                    <Button variant="ghost" onClick={run}>
                      Redo
                    </Button>
                    <Button variant="primary" onClick={save} disabled={!replyTo || saved === "saving"}>
                      Save draft
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No reply needed.</p>
            )}
          </>
        )
      )}
    </div>
  );
}
