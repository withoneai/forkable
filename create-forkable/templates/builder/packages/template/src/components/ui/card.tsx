import * as React from "react";
import { cn } from "@/lib/utils";

type DivProps = React.HTMLAttributes<HTMLDivElement>;

/** A bordered surface. Borders, not shadows, separate things on a page. */
export function Card({ className, ...props }: DivProps) {
  return <div className={cn("rounded-lg border border-border bg-card", className)} {...props} />;
}
export function CardHeader({ className, ...props }: DivProps) {
  return <div className={cn("flex flex-col gap-1 p-4 pb-3", className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-13 font-semibold", className)} {...props} />;
}
export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-13 text-muted-foreground", className)} {...props} />;
}
export function CardContent({ className, ...props }: DivProps) {
  return <div className={cn("px-4 pb-4", className)} {...props} />;
}
export function CardFooter({ className, ...props }: DivProps) {
  return <div className={cn("flex items-center justify-end gap-2 border-t border-border px-4 py-3", className)} {...props} />;
}
