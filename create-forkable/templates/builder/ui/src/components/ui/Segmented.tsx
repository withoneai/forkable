import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "./Tooltip";

export interface SegOption<K extends string> { key: K; label: ReactNode; title?: string; disabled?: boolean }

/** A compact segmented control (device toggle, theme, size). */
export function Segmented<K extends string>({ value, onChange, options, label, className, size = "md" }: {
  value: K; onChange: (k: K) => void; options: SegOption<K>[]; label: string; className?: string; size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex items-center gap-px rounded-md border border-border bg-muted/60 p-px", className)}>
      {options.map((o) => {
        const active = o.key === value;
        const btn = (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.title}
            disabled={o.disabled}
            onClick={() => onChange(o.key)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-sm font-medium transition-colors duration-100 [&>svg]:size-3.5 [&>svg]:stroke-[1.75]",
              size === "sm" ? "h-5 min-w-6 px-1.5 text-11" : "h-6 min-w-7 px-2 text-xs",
              active ? "bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-muted-foreground hover:text-foreground",
              "disabled:opacity-40",
            )}
          >
            {o.label}
          </button>
        );
        return o.title ? <Tooltip key={o.key} label={o.title}>{btn}</Tooltip> : btn;
      })}
    </div>
  );
}
