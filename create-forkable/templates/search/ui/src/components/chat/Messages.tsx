import { useState } from "react";
import { Check, ChevronRight, Copy, TriangleAlert } from "lucide-react";
import type { ChatStep, Citation, QueryProposal } from "@/contract/api-types";
import { useWorkspace } from "@/lib/workspace";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/Button";
import { LogoStack } from "@/components/SourceLogo";
import { CitedText, modelLabel } from "./citations";
import { ProposalCard } from "./ProposalCard";

/** What one assistant turn has, whether it is still streaming or stored. */
export interface Turn {
  id: string;
  question: string;
  steps: ChatStep[];
  read: number;
  text: string | null;
  citations: Citation[];
  grounded: boolean;
  model: string;
  proposal: QueryProposal | null;
  error: string | null;
  streaming: boolean;
}

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[88%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-muted px-3 py-2 text-13">{text}</p>
    </div>
  );
}

/** "Searched 2 ways · read 12 items ›", live while streaming, a list when opened. */
function StepLine({ steps, read, streaming }: { steps: ChatStep[]; read: number; streaming: boolean }) {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const running = steps.find((s) => s.state === "running");
  const searches = steps.filter((s) => s.query);
  if (!steps.length) {
    return streaming ? <p className="flex items-center gap-1.5 text-11 text-muted-foreground"><Spinner className="size-3" /> Reading your results</p> : null;
  }
  const summary = running
    ? running.label
    : `${searches.length ? `Searched ${searches.length} ${searches.length === 1 ? "way" : "ways"} · read` : "Read"} ${read} ${read === 1 ? "item" : "items"}`;
  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-fit items-center gap-1.5 text-11 text-muted-foreground transition-colors hover:text-foreground">
        {running ? <Spinner className="size-3" /> : null}
        <span className={cn(running && "pulse-dot")}>{summary}</span>
        {!running && <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />}
      </button>
      {open && !running && (
        <ul className="fade-in flex flex-col gap-1 border-l border-border pl-2.5">
          {steps.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5 text-11 text-muted-foreground">
              {s.query ? (
                <>
                  <span>Searched</span>
                  <button type="button" onClick={() => ws.setQuery(s.query!)} title="Run this search on the page" className="truncate rounded-sm bg-muted px-1 font-mono text-foreground hover:bg-border-strong/60">{s.query}</button>
                  {s.count != null && <span className="tnum shrink-0">{s.count}</span>}
                </>
              ) : <span>{s.label}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AssistantTurn({ turn, onOpen, onSearchInChat, onShowSources, applied, onApplied }: {
  turn: Turn;
  onOpen: (c: Citation) => void;
  onSearchInChat: (q: string) => void;
  onShowSources: () => void;
  applied: boolean;
  onApplied: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const sources = turn.citations.map((c) => `[${c.n}] ${c.title}${c.url ? ` ${c.url}` : ""}`).join("\n");
    void navigator.clipboard.writeText(`${turn.text ?? ""}${sources ? `\n\n${sources}` : ""}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); });
  };
  return (
    <div className="flex flex-col gap-2" aria-live={turn.streaming ? "polite" : undefined} data-testid="answer">
      <StepLine steps={turn.steps} read={turn.read} streaming={turn.streaming} />
      {turn.error ? (
        <p role="alert" className="text-13 text-destructive-text">{turn.error}</p>
      ) : turn.text != null ? (
        <>
          <CitedText text={turn.text} citations={turn.citations} onOpen={onOpen} />
          {!turn.grounded && (
            <p className="flex items-center gap-1.5 text-11 text-warning-text"><TriangleAlert className="size-3" /> Not grounded in your results</p>
          )}
          <div className="flex items-center gap-2 text-11 text-muted-foreground">
            {turn.citations.length > 0 && (
              <button type="button" onClick={onShowSources} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md py-0.5 pr-1 transition-colors hover:text-foreground">
                <LogoStack platforms={turn.citations.map((c) => c.platform)} size={12} />
                <span className="tnum">{turn.citations.length} {turn.citations.length === 1 ? "source" : "sources"}</span>
              </button>
            )}
            <span className="min-w-0 truncate">{modelLabel(turn.model)}</span>
            <span className="ml-auto flex shrink-0 items-center gap-0.5">
              <button type="button" onClick={copy} className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 transition-colors hover:bg-card-hover hover:text-foreground">
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}{copied ? "Copied" : "Copy"}
              </button>
              {turn.citations.length > 0 && <button type="button" onClick={onShowSources} className="inline-flex h-6 items-center rounded-md px-1.5 transition-colors hover:bg-card-hover hover:text-foreground">Sources</button>}
            </span>
          </div>
          {turn.proposal && <ProposalCard proposal={turn.proposal} onSearchInChat={onSearchInChat} applied={applied} onApplied={onApplied} />}
        </>
      ) : null}
    </div>
  );
}
