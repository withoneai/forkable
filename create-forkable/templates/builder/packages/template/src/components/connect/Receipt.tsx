import { cn } from "@/lib/utils";

// The receipt line for a refused call. Who refused it decides the words, and
// the words are never mixed: only One's own refusal (or the sample grant's,
// labeled Sample) reads "declined, 403". A call stopped before it reached One
// says so.

export interface RefusalLike {
  source: "one" | "sample" | "local" | "held";
  code?: string;
  message?: string;
}

export function receiptLine(platform: string, verb: string, refusal: RefusalLike): string {
  const head = `${platform} · ${verb}`;
  if (refusal.source === "one" || refusal.source === "sample") return `${head}   declined, 403`;
  if (refusal.source === "held") return `${head}   paused while the agent works`;
  if (refusal.code === "not_connected") return `${head}   held locally, ${platform} is not connected`;
  if (refusal.code === "signed_out") return `${head}   held locally, sign in with One to run it`;
  if (refusal.code === "connect_off") return `${head}   held locally, One Connect is off for this app`;
  return `${head}   held locally, not in this app's manifest`;
}

const BADGE: Record<RefusalLike["source"], string> = { one: "One", sample: "Sample", local: "Local", held: "Paused" };

function caption(platform: string, refusal: RefusalLike): string {
  if (refusal.source === "one") return `One refused this call. ${platform} was never called.`;
  if (refusal.source === "sample") return "Replayed from fixtures in the shape One returns. Not a live call.";
  if (refusal.source === "held") return "Writes pause while the app is being changed.";
  return "Stopped before it reached One.";
}

export function Receipt({ platform, verb, refusal, className }: { platform: string; verb: string; refusal: RefusalLike; className?: string }) {
  return (
    <div className={cn("rounded-md border border-border bg-faint px-3 py-2", className)}>
      <div className="flex items-center gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs">{receiptLine(platform, verb, refusal)}</pre>
        <span className="shrink-0 rounded-sm border border-border px-1.5 text-11 font-medium text-muted-foreground">{BADGE[refusal.source]}</span>
      </div>
      <p className="mt-1 text-11 text-muted-foreground">{caption(platform, refusal)}</p>
    </div>
  );
}
