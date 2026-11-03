import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A number that matters, in a row of 2 to 4 above the content.
 *
 *   <div className="grid gap-3 sm:grid-cols-3">
 *     <Stat label="Last 7 days" value={formatMoney(cents)} hint="12 charges" />
 *   </div>
 */
export function Stat({
  label,
  value,
  hint,
  tone,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "success" | "warning" | "danger";
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-card p-4", className)}>
      <p className="text-13 text-muted-foreground">{label}</p>
      <p className="tnum mt-1 text-28 font-semibold tracking-tight">{value}</p>
      {hint && (
        <p className={cn("tnum mt-1 text-11 text-muted-foreground", tone === "success" && "text-success-text", tone === "warning" && "text-warning-text", tone === "danger" && "text-destructive-text")}>{hint}</p>
      )}
    </div>
  );
}
