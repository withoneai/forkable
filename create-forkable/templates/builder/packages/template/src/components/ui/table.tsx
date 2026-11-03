import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Rows of records with the same fields. Put the main field first (medium
 * weight), numbers right aligned with `tnum`, row actions in the last column
 * as ghost icon buttons with an aria-label.
 */
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-border bg-card">
      <table className={cn("w-full border-collapse text-13", className)} {...props} />
    </div>
  );
}
export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-faint", className)} {...props} />;
}
export function TableBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}
export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("group border-b border-border transition-colors last:border-0 hover:bg-faint", className)} {...props} />;
}
export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("h-9 whitespace-nowrap px-4 text-left align-middle text-xs font-medium text-muted-foreground", className)} {...props} />;
}
export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("h-11 px-4 align-middle", className)} {...props} />;
}
