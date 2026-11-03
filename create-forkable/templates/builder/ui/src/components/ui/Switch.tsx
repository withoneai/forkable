import { cn } from "@/lib/utils";

export function Switch({ checked, onChange, disabled, label, className }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-[34px] shrink-0 items-center rounded-full border transition-colors duration-100",
        checked ? "border-foreground bg-foreground" : "border-border-strong bg-muted hover:border-muted-foreground/50",
        "disabled:opacity-50",
        className,
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 size-3.5 rounded-full shadow-[0_1px_2px_rgb(0_0_0/0.2)] transition-transform duration-100 ease-out-quart",
          checked ? "translate-x-[14px] bg-background" : "translate-x-0 bg-card",
        )}
      />
    </button>
  );
}
