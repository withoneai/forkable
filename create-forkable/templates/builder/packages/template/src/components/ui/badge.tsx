import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-11 font-medium leading-none", {
  variants: {
    tone: {
      neutral: "bg-muted text-muted-foreground",
      accent: "bg-accent/12 text-accent",
      success: "bg-success-text/12 text-success-text",
      warning: "bg-warning-text/14 text-warning-text",
      danger: "bg-destructive-text/12 text-destructive-text",
      outline: "border border-border text-muted-foreground",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** A small dot before the label, for statuses. */
  dot?: boolean;
}

/**
 * Statuses and tags. Tones carry meaning: success for done or approved,
 * warning for pending or due soon, danger for rejected, failed or overdue,
 * neutral for everything else. Map a status to a tone in one place.
 */
export function Badge({ className, tone, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
