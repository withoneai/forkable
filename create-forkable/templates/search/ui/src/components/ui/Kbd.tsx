import { cn } from "@/lib/utils";

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-sm border border-border bg-card px-1 font-sans text-11 font-medium leading-none text-muted-foreground shadow-[0_1px_0_var(--border)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

const MODIFIERS = new Set(["⌘", "⇧", "⌥", "⌃", "Ctrl", "Shift", "Alt"]);

/** "G V" rendered as "G then V"; a modifier is held with the next key ("⌘ K"), so no "then" after it. */
export function Keys({ combo, className }: { combo: string; className?: string }) {
  const parts = combo.split(" ");
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && !MODIFIERS.has(parts[i - 1]!) && <span className="text-11 text-muted-foreground/60">then</span>}
          <Kbd>{p}</Kbd>
        </span>
      ))}
    </span>
  );
}
