import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "warning" | "destructive" | "success" | "outline";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  outline: "border border-border text-muted-foreground",
  warning: "bg-warning-text/12 text-warning-text",
  destructive: "bg-destructive-text/12 text-destructive-text",
  success: "bg-success-text/12 text-success-text",
};

export function Badge({ tone = "neutral", mono, className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; mono?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-[1.125rem] shrink-0 items-center whitespace-nowrap rounded-sm px-1.5 text-11 font-medium leading-none",
        mono && "font-mono font-normal tracking-tight",
        tones[tone],
        className,
      )}
      {...rest}
    />
  );
}
