import { cloneElement, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useKeepInView } from "@/lib/keepInView";

/** A plain CSS tooltip. Shows on hover and focus; never traps the pointer. Stays inside the window. */
export function Tooltip({ label, children, side = "bottom", className }: {
  label: ReactNode; children: ReactElement<Record<string, unknown>>; side?: "top" | "bottom"; className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const tip = useRef<HTMLSpanElement>(null);
  const fit = useKeepInView(tip, open, side, [label]);

  const child = cloneElement(children, {
    "aria-describedby": open ? id : undefined,
    onMouseEnter: (e: React.MouseEvent) => { setOpen(true); (children.props.onMouseEnter as ((e: React.MouseEvent) => void) | undefined)?.(e); },
    onMouseLeave: (e: React.MouseEvent) => { setOpen(false); (children.props.onMouseLeave as ((e: React.MouseEvent) => void) | undefined)?.(e); },
    onFocus: (e: React.FocusEvent) => { setOpen(true); (children.props.onFocus as ((e: React.FocusEvent) => void) | undefined)?.(e); },
    onBlur: (e: React.FocusEvent) => { setOpen(false); (children.props.onBlur as ((e: React.FocusEvent) => void) | undefined)?.(e); },
  });
  const below = fit.flip ? side !== "bottom" : side === "bottom";
  return (
    <span className="relative inline-flex">
      {child}
      {open && (
        <span
          ref={tip}
          role="tooltip"
          id={id}
          style={fit.style}
          className={cn(
            "fade-in pointer-events-none absolute left-1/2 z-50 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-11 font-medium text-background shadow-pop",
            below ? "top-full mt-1.5" : "bottom-full mb-1.5",
            className,
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
