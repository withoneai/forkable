import clsx from "clsx";
import type { ReactNode } from "react";

// The frame every live surface sits in: one hairline, a lit top edge, a
// deep shadow.
export function AppWindow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        "relative overflow-hidden rounded-xl border border-border bg-card text-left shadow-[var(--window-shadow)]",
        className,
      )}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-foreground/30 to-transparent"
        aria-hidden
      />
      {children}
    </div>
  );
}
