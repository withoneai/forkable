import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "default" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  trailing?: ReactNode;
  loading?: boolean;
}

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-foreground border-transparent hover:brightness-[1.08] active:brightness-95 shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]",
  default: "bg-card text-foreground border-border hover:bg-card-hover hover:border-border-strong active:bg-muted shadow-[0_1px_1px_rgb(0_0_0/0.03)]",
  ghost: "bg-transparent text-foreground border-transparent hover:bg-card-hover active:bg-muted",
  destructive: "bg-card text-destructive-text border-border hover:bg-card-hover hover:border-border-strong active:bg-muted",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5 rounded-md",
  md: "h-8 px-3 text-13 gap-2 rounded-md",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", size = "md", icon, trailing, loading, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap border font-medium transition-[background-color,border-color,filter] duration-100",
        "disabled:pointer-events-none disabled:opacity-45",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon ? <span className="shrink-0 opacity-90 [&>svg]:size-3.5 [&>svg]:stroke-[1.75]">{icon}</span> : null}
      {children}
      {trailing ? <span className="shrink-0 opacity-70">{trailing}</span> : null}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("size-3.5 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
