import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const base =
  "w-full rounded-md border border-border bg-card px-2.5 text-13 text-foreground placeholder:text-muted-foreground/60 transition-[border-color,box-shadow] duration-100 " +
  "hover:border-border-strong focus:border-ring focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--ring)_18%,transparent)] focus:outline-none focus-visible:outline-none disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }>(function Input(
  { className, mono, ...rest }, ref,
) {
  return <input ref={ref} className={cn(base, "h-8", mono && "font-mono text-xs", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest }, ref,
) {
  return <textarea ref={ref} className={cn(base, "min-h-[72px] resize-y py-1.5 leading-5", className)} {...rest} />;
});

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-11 font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-11 text-muted-foreground/80">{hint}</span>}
    </label>
  );
}
