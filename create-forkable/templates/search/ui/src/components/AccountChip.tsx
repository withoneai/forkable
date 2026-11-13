// Which account a thing belongs to when a platform has two (two Gmails): the part of the
// address that tells them apart ("acme.dev"), in words, with the full address on hover.
// No letter mark: a single letter says nothing to someone reading it cold. With one
// account per tool, callers show nothing at all.
import { cn } from "@/lib/utils";

/** `mark` is still accepted from older callers and ignored. */
/** The chip's tooltip: "From your acme.com account (dana@acme.com)". Result rows use the same words. */
export const accountChipTip = (short: string, label: string) => `From your ${short} account${label && label !== short ? ` (${label})` : ""}`;

export function AccountChip({ short, label, className }: { short: string; label: string; mark?: string; className?: string }) {
  return (
    <span title={accountChipTip(short, label)} aria-label={accountChipTip(short, label)} className={cn("inline-flex h-5 max-w-[11rem] shrink-0 items-center rounded-full border border-border px-2 text-11 text-muted-foreground", className)} data-testid="account-chip">
      <span className="truncate">{short}</span>
    </span>
  );
}
