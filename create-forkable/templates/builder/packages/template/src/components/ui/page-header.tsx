import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The top of every page: a title, one line on what the page is for, and the
 * page's actions on the right (the main one last, filled).
 *
 *   <PageHeader title="Expenses" description="Everything the team spent this month."
 *     actions={<Button onClick={...}><Plus /> New expense</Button>} />
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** A small link above the title, for detail pages ("← All expenses"). */
  back?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0 space-y-1">
        {back && <div className="mb-2 text-13 text-muted-foreground [&_a:hover]:text-foreground">{back}</div>}
        <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="max-w-2xl text-13 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A titled block inside a page. Sections sit space-y-6 apart. */
export function Section({
  title,
  description,
  actions,
  className,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      {(title || actions) && (
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            {title && <h2 className="text-15 font-semibold">{title}</h2>}
            {description && <p className="text-13 text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Search and filters above a list or table: h-8 controls, gap-2. */
export function Toolbar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)} {...props} />;
}
