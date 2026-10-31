// Which account a thing belongs to when a platform has two (two Gmails): a letter
// and the short label, muted, the same in results, preview, sidebar and settings.
import { cn } from "@/lib/utils";

export function AccountMark({ text, className }: { text: string; className?: string }) {
  return (
    <span aria-hidden className={cn("flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-10 font-semibold uppercase text-muted-foreground", className)}>
      {text.length === 1 ? text : text.replace(/^[^a-z0-9]+/i, "")[0] ?? "?"}
    </span>
  );
}

export function AccountChip({ short, label, mark, className }: { short: string; label: string; mark?: string; className?: string }) {
  return (
    <span title={label} className={cn("inline-flex h-5 max-w-[160px] shrink-0 items-center gap-1 rounded-full border border-border pl-0.5 pr-2 text-11 text-muted-foreground", className)} data-testid="account-chip">
      <AccountMark text={mark ?? short} className="size-3.5" />
      <span className="truncate">{short}</span>
    </span>
  );
}
