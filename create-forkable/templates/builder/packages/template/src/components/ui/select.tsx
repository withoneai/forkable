import { ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { controlClass } from "./input";

/**
 * A native select that matches Input (same height, border, focus ring, dark
 * mode). Use it for every dropdown in a form instead of styling <select>.
 *
 *   <Select value={topic} onChange={(e) => setTopic(e.target.value)}>
 *     <option value="" disabled>Choose a topic</option>
 *     <option value="billing">Billing</option>
 *   </Select>
 */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <div className={cn("relative w-full", className)}>
    <select ref={ref} className={cn(controlClass, "appearance-none pr-8")} {...props}>
      {children}
    </select>
    <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
  </div>
));
Select.displayName = "Select";
