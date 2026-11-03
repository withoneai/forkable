import { CircleAlert, RotateCw } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/** Plain words for an error a person can act on. Never show a stack or a raw status alone. */
export function errorText(error: unknown): string {
  const e = error as { status?: number; message?: string } | null;
  if (!e) return "Something went wrong.";
  if (e.status === 401) return "Sign in to see this.";
  if (e.status === 403) return "You do not have access to this.";
  if (e.status === 404) return "This could not be found. It may have been deleted.";
  if (e.status && e.status >= 500) return "The server had a problem. Try again in a moment.";
  if (e.message === "Failed to fetch") return "Could not reach the server. Check your connection and try again.";
  return e.message || "Something went wrong.";
}

/**
 * A failed load: what happened and a way out (Retry). Use it where the
 * content would have been, so the page keeps its layout.
 */
export function ErrorState({
  title = "Could not load this",
  error,
  onRetry,
  action,
  className,
}: {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("flex items-start gap-3 rounded-lg border border-destructive-text/25 bg-destructive-text/5 p-4", className)}>
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive-text" />
      <div className="min-w-0 flex-1">
        <p className="text-13 font-medium">{title}</p>
        <p className="mt-0.5 text-13 text-muted-foreground">{errorText(error)}</p>
        {(onRetry || action) && (
          <div className="mt-3 flex items-center gap-2">
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                <RotateCw /> Try again
              </Button>
            )}
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

/** A one-line inline error under a form or next to a button. */
export function InlineError({ children, className }: { children: React.ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <p role="alert" className={cn("flex items-center gap-1.5 text-13 text-destructive-text", className)}>
      <CircleAlert className="size-3.5 shrink-0" />
      {children}
    </p>
  );
}
