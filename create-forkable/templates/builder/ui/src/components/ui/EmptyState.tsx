import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({ icon, title, detail, children, className }: {
  icon?: ReactNode; title: string; detail?: string; children?: ReactNode; className?: string;
}) {
  return (
    <div className={cn("fade-in flex flex-col items-center justify-center gap-1.5 px-6 py-16 text-center", className)}>
      {icon && (
        <span className="mb-2 flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground [&>svg]:size-4 [&>svg]:stroke-[1.5]">{icon}</span>
      )}
      <p className="text-13 font-medium text-foreground">{title}</p>
      {detail && <p className="max-w-[300px] text-xs leading-snug text-muted-foreground">{detail}</p>}
      {children}
    </div>
  );
}

export function LoadError({ what, error, onRetry, retrying, className }: {
  what: string; error?: Error | null; onRetry: () => void; retrying?: boolean; className?: string;
}) {
  return (
    <div role="alert" className={cn("fade-in flex flex-col items-center justify-center gap-1.5 px-6 py-16 text-center", className)}>
      <p className="text-13 font-medium text-foreground">{what} could not be loaded.</p>
      {error?.message && <p className="max-w-[320px] text-xs leading-snug text-muted-foreground">{error.message}</p>}
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="mt-2 inline-flex h-7 items-center rounded-md border border-border bg-card px-2.5 text-xs font-medium transition-colors hover:border-border-strong hover:bg-card-hover disabled:opacity-60"
      >
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
