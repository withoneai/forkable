import * as React from "react";
import { cn } from "@/lib/utils";

export const controlClass =
  "h-8 w-full rounded-md border border-border bg-card px-2.5 text-13 text-foreground shadow-none transition-colors placeholder:text-muted-foreground hover:border-border-strong focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive-text aria-invalid:ring-destructive-text/15";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(controlClass, className)} {...props} />
));
Input.displayName = "Input";
