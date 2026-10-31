import clsx from "clsx";
import type { ReactNode } from "react";
import { useReveal } from "../lib/hooks";

// Mono index and label, a serif headline, one muted line under it. Shared
// across every section so the page reads as one system.
export function SectionHead({
  index,
  label,
  title,
  children,
  align = "center",
}: {
  index: string;
  label: string;
  title: ReactNode;
  children?: ReactNode;
  align?: "center" | "left";
}) {
  const [ref, shown] = useReveal<HTMLDivElement>(0.4);
  return (
    <div
      ref={ref}
      className={clsx("t-stagger max-w-2xl", align === "center" ? "mx-auto text-center" : "text-left", shown && "is-shown")}
    >
      <div className={clsx("t-stagger-line t-stagger-line--1 flex items-center gap-2 font-mono text-11 uppercase tracking-wide", align === "center" && "justify-center")}>
        <span className="text-foreground">{index}</span>
        <span className="h-px w-6 bg-border" aria-hidden />
        <span className="text-muted-foreground">{label}</span>
      </div>
      <h2 className="t-stagger-line t-stagger-line--2 text-gradient-headline mt-4 pb-1 font-serif text-44 tracking-tight text-balance sm:text-56">
        {title}
      </h2>
      {children && (
        <p className={clsx("t-stagger-line t-stagger-line--3 mt-4 max-w-lg text-15 text-muted-foreground", align === "center" && "mx-auto")}>
          {children}
        </p>
      )}
    </div>
  );
}
