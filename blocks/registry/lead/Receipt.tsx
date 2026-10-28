import clsx from "clsx";
import { PROVIDER_LABELS, type Receipt } from "./types";

const OUTCOME: Record<string, string> = { hit: "Hit", miss: "Miss, free", failure: "Failed, free", blocked: "Stopped", skipped: "Off" };

/** Every provider the waterfall tried, in order, with what it cost. */
export function LeadReceipt({ receipt, className }: { receipt: Receipt; className?: string }) {
  return (
    <div className={clsx("flex flex-col gap-1.5 rounded-lg border border-border bg-raised p-3", className)}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-10 uppercase tracking-[0.05em] text-muted-foreground">{receipt.op}</span>
        <span className="ml-auto font-mono text-11 tabular-nums text-foreground">{receipt.charged} credits</span>
      </div>
      <ol className="flex flex-col gap-1">
        {receipt.attempts.map((a, i) => (
          <li key={i} className="grid grid-cols-[1rem_8rem_1fr_auto] items-center gap-2 text-xs" title={a.actionId}>
            <span className="font-mono text-10 text-muted-foreground">{i + 1}</span>
            <span className="truncate text-foreground">{PROVIDER_LABELS[a.provider]}</span>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={clsx("size-1.5 shrink-0 rounded-full", a.outcome === "hit" ? "bg-accent" : a.outcome === "blocked" || a.outcome === "failure" ? "bg-danger" : "bg-foreground/25")} />
              <span className="shrink-0 text-foreground">{OUTCOME[a.outcome]}</span>
              {a.detail && <span className="truncate text-muted-foreground">{a.detail}</span>}
            </span>
            <span className="font-mono text-11 tabular-nums text-muted-foreground">{a.cost === null ? "no cost set" : a.cost}</span>
          </li>
        ))}
      </ol>
      <span className="text-11 text-muted-foreground">
        {receipt.costsAre === "sample" ? "Sample costs. Each provider needs a data contract before it can serve real lookups; turn it on in lead/config.ts with the cost from that contract." : "Costs from your provider contracts in lead/config.ts. Misses and failures are free."}
      </span>
    </div>
  );
}
