import { useState } from "react";
import { Check, SlidersHorizontal } from "lucide-react";
import type { QueryProposal } from "@/contract/api-types";
import { useWorkspace } from "@/lib/workspace";
import { cn, MOD } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

/**
 * A better query, proposed by the assistant. Nothing changes until a keypress:
 * Apply rewrites the box, "Search in chat only" runs it here without touching
 * the page. After Apply the card turns into a receipt line.
 */
export function ProposalCard({ proposal, onSearchInChat, applied, onApplied }: {
  proposal: QueryProposal;
  onSearchInChat: (query: string) => void;
  applied: boolean;
  onApplied: () => void;
}) {
  const ws = useWorkspace();
  const [ranHere, setRanHere] = useState(false);
  const apply = () => { ws.setQuery(proposal.query); onApplied(); };
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2.5" data-testid="proposal">
      <div className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><SlidersHorizontal className="size-[13px] stroke-[1.75]" /></span>
        <span className="min-w-0 flex-1 text-xs font-medium">A sharper search</span>
        <span className="tnum shrink-0 text-11 text-muted-foreground">{proposal.count} {proposal.count === 1 ? "result" : "results"}</span>
      </div>
      <div className="flex flex-wrap gap-1 pl-8">
        {proposal.diff.length === 0 && <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-11">{proposal.query}</code>}
        {proposal.diff.map((d) => (
          <span key={`${d.op}${d.clause}`} className={cn("inline-flex h-5 items-center gap-1 rounded-sm px-1.5 font-mono text-11", d.op === "+" ? "bg-accent/12 text-foreground ring-1 ring-inset ring-accent/30" : "bg-muted text-muted-foreground line-through decoration-muted-foreground/60")}>
            <span aria-hidden className={d.op === "+" ? "text-accent" : ""}>{d.op === "+" ? "+" : "−"}</span>
            {d.clause}
          </span>
        ))}
      </div>
      {proposal.reason && <p className="pl-8 text-11 text-muted-foreground">{proposal.reason}</p>}
      {applied ? (
        <p className="flex items-center gap-1.5 pl-8 text-xs text-muted-foreground"><Check className="size-3 text-success-text" /> Applied to the search box</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5 pl-8">
          <Button size="sm" variant="primary" onClick={apply} trailing={<span className="text-11">{MOD}↵</span>}>Apply</Button>
          <Button size="sm" variant="ghost" disabled={ranHere} onClick={() => { setRanHere(true); onSearchInChat(proposal.query); }}>Search in chat only</Button>
        </div>
      )}
    </div>
  );
}
