import type { LucideIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * "Nothing here yet", with what to do about it. Never leave a list or page
 * blank, and give it one next action (the button that makes the first item,
 * or Clear filters when a search matched nothing).
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center", className)}>
      {Icon && (
        <div className="mb-3 flex size-9 items-center justify-center rounded-md border border-border bg-faint text-muted-foreground">
          <Icon className="size-4" />
        </div>
      )}
      <p className="text-15 font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-sm text-13 text-muted-foreground">{description}</p>}
      {action && <div className="mt-4 flex items-center gap-2">{action}</div>}
    </div>
  );
}
