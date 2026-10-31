import type { ReactNode } from "react";

export function LearnMore({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="t-learn inline-flex items-center gap-0.5 rounded-md px-3 py-2 text-13 text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
      <span className="t-learn-chevron">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
          <path className="t-learn-arm t-learn-arm-top" d="M6 4L10 8" />
          <path className="t-learn-arm t-learn-arm-bot" d="M10 8L6 12" />
        </svg>
      </span>
    </a>
  );
}
