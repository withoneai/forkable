import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A list of items in one card, rows divided by hairlines. Use it when items
 * have a title and a line of detail (threads, notes, requests); use Table
 * when they share columns.
 *
 *   <List>
 *     {items.map((x) => (
 *       <ListItem key={x.id} title={x.subject} meta={x.from} trailing={<span className="text-11 text-muted-foreground">{formatRelative(x.at)}</span>} />
 *     ))}
 *   </List>
 */
export function List({ className, ...props }: React.HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn("divide-y divide-border overflow-hidden rounded-lg border border-border bg-card", className)} {...props} />;
}

export function ListItem({
  title,
  meta,
  leading,
  trailing,
  onClick,
  href,
  className,
  children,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
  /** Makes the row a link (use with react-router's Link through `asLink`, or a plain href). */
  href?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const body = (
    <>
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate text-13 font-medium">{title}</div>
        {meta && <div className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</div>}
        {children}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-2">{trailing}</div>}
    </>
  );
  const row = "flex min-h-11 items-center gap-3 px-4 py-2.5";
  const interactive = "transition-colors hover:bg-faint focus-visible:bg-faint focus-visible:outline-none";
  return (
    <li className={cn("group", className)}>
      {href ? (
        <a href={href} className={cn(row, interactive)}>{body}</a>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={cn(row, interactive, "w-full text-left")}>{body}</button>
      ) : (
        <div className={row}>{body}</div>
      )}
    </li>
  );
}
