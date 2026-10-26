import { useState } from "react";
import { cn } from "@/lib/utils";

export function Slider({ value, min = 0, max = 10, step = 1, onChange, onCommit, disabled, label, className, format }: {
  value: number; min?: number; max?: number; step?: number; format?: (v: number) => string;
  onChange?: (v: number) => void; onCommit?: (v: number) => void; disabled?: boolean; label: string; className?: string;
}) {
  const [local, setLocal] = useState<number | null>(null);
  const v = local ?? value;
  const pctv = ((v - min) / (max - min)) * 100;
  const commit = () => { if (local !== null) { onCommit?.(local); setLocal(null); } };
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="relative flex h-5 flex-1 items-center">
        <div className="absolute inset-x-0 h-[3px] rounded-full bg-muted" />
        <div className="absolute left-0 h-[3px] rounded-full bg-foreground/80" style={{ width: `${pctv}%` }} />
        <input
          type="range"
          aria-label={label}
          aria-valuetext={format?.(v)}
          min={min} max={max} step={step} value={v} disabled={disabled}
          onChange={(e) => { const n = Number(e.target.value); setLocal(n); onChange?.(n); }}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          className={cn(
            "relative z-10 h-5 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed",
            "[&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-border [&::-webkit-slider-thumb]:bg-card [&::-webkit-slider-thumb]:shadow-[0_1px_2px_rgba(0,0,0,0.12)]",
            "[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-border [&::-moz-range-thumb]:bg-card",
          )}
        />
      </div>
      <span className={cn("tnum text-right text-13 text-foreground", format ? "w-14" : "w-5")}>{format ? format(v) : v}</span>
    </div>
  );
}
