import type { ReactNode } from "react";
import clsx from "clsx";
import type { OneClientError, OneMeta } from "./one-client";

// Small shared pieces every component uses. Plain Tailwind on the tokens in
// blocks.css (background, foreground, muted-foreground, card, raised, border,
// strong, accent, primary, danger, shadow-soft, shadow-overlay), so a fork
// restyles them by changing CSS variables, not these files.

export function SourceChip({ meta }: { meta: OneMeta | null }) {
  if (!meta) return null;
  const sample = meta.mode === "sample";
  return (
    <span
      title={sample ? "Sign in with One is not set up yet, so this is the Acme sample." : `Live, on your ${meta.platform} grant.`}
      className="inline-flex h-5 items-center gap-1 rounded-sm border border-border bg-raised px-1.5 font-mono text-10 uppercase tracking-[0.05em] text-muted-foreground"
    >
      <span className={clsx("size-1.5 rounded-full", sample ? "bg-muted-foreground/60" : "bg-accent")} />
      {sample ? "Sample" : "Live"}
    </span>
  );
}

export function ErrorState({ error, onRetry }: { error: OneClientError; onRetry?: () => void }) {
  const copy =
    error.code === "not_connected"
      ? "Sign in with One and add this account to use it here."
      : error.code === "outside_grant"
        ? "Your grant does not cover this. Widen it in One to turn it on."
        : error.message;
  return (
    <div className="flex flex-col items-start gap-2 text-13 text-muted-foreground">
      <p>{copy}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-sm bg-foreground/6", className)} />;
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
  return (
    <span className={clsx("inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-card text-10 font-semibold text-muted-foreground", className)}>
      {initials || "?"}
    </span>
  );
}

const BUTTON = {
  primary: "border-transparent bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-press",
  outline: "border-border bg-raised text-foreground hover:border-strong",
  ghost: "border-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
  danger: "border-border bg-raised text-danger hover:border-danger",
};

/** primary: the one main action (lime fill, black ink). outline: bordered, raised. ghost: quiet. danger: destructive. */
export function Button({
  children,
  variant = "outline",
  size = "md",
  icon = false,
  className,
  type = "button",
  ...rest
}: { children: ReactNode; variant?: keyof typeof BUTTON; size?: "sm" | "md"; icon?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      type={type}
      className={clsx(
        "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&>svg]:shrink-0",
        size === "sm" ? "h-7 gap-1 text-xs" : "h-8 gap-1.5 text-13",
        icon ? (size === "sm" ? "w-7" : "w-8") : size === "sm" ? "px-2.5" : "px-3",
        BUTTON[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}
