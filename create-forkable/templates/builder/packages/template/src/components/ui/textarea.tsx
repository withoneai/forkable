import * as React from "react";
import { cn } from "@/lib/utils";
import { controlClass } from "./input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(controlClass, "h-auto min-h-20 py-2 leading-relaxed", className)} {...props} />
));
Textarea.displayName = "Textarea";
