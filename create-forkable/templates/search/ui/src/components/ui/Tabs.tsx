import { useId } from "react";
import { cn } from "@/lib/utils";

export interface TabOption<K extends string> { key: K; label: string; count?: number; disabled?: boolean }

export function Tabs<K extends string>({ value, onChange, options, className, size = "md" }: {
  value: K; onChange: (k: K) => void; options: TabOption<K>[]; className?: string; size?: "sm" | "md";
}) {
  const id = useId();
  return (
    <div role="tablist" aria-orientation="horizontal" className={cn("flex items-center gap-0.5", className)}
      onKeyDown={(e) => {
        const i = options.findIndex((o) => o.key === value);
        if (e.key === "ArrowRight") { onChange(options[(i + 1) % options.length]!.key); e.preventDefault(); }
        if (e.key === "ArrowLeft") { onChange(options[(i - 1 + options.length) % options.length]!.key); e.preventDefault(); }
      }}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            id={`${id}-${o.key}`}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.key)}
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-md font-medium transition-colors duration-100",
              size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-13",
              active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-card-hover hover:text-foreground",
              "disabled:opacity-40",
            )}
          >
            {o.label}
            {o.count !== undefined && o.count > 0 && (
              <span className={cn("tnum text-11", active ? "text-muted-foreground" : "text-muted-foreground/70")}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
