import { cloneElement, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const EDGE = 8;
const GAP = 6;

/**
 * Shows on hover and focus; never traps the pointer. Renders in a portal with
 * fixed positioning so a scroll pane or overflow-hidden card cannot clip it,
 * stays inside the viewport, and flips side when there is no room.
 */
export function Tooltip({ label, children, side = "bottom", className }: {
  label: ReactNode; children: ReactElement<Record<string, unknown>>; side?: "top" | "bottom"; className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({ visibility: "hidden" });
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open) { setPos({ visibility: "hidden" }); return; }
    const a = anchorRef.current?.getBoundingClientRect();
    const t = tipRef.current;
    if (!a || !t) return;
    const w = t.offsetWidth, h = t.offsetHeight;
    const fitsBelow = a.bottom + GAP + h <= window.innerHeight - EDGE;
    const fitsAbove = a.top - GAP - h >= EDGE;
    const below = side === "bottom" ? fitsBelow || !fitsAbove : !fitsAbove && fitsBelow;
    const left = Math.min(Math.max(EDGE, a.left + a.width / 2 - w / 2), window.innerWidth - EDGE - w);
    setPos({ left, top: below ? a.bottom + GAP : a.top - GAP - h });
  }, [open, side, label]);

  useLayoutEffect(() => {
    if (!open) return;
    const hide = () => setOpen(false);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => { window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); };
  }, [open]);

  const child = cloneElement(children, {
    "aria-describedby": open ? id : undefined,
    onMouseEnter: (e: React.MouseEvent) => { setOpen(true); (children.props.onMouseEnter as ((e: React.MouseEvent) => void) | undefined)?.(e); },
    onMouseLeave: (e: React.MouseEvent) => { setOpen(false); (children.props.onMouseLeave as ((e: React.MouseEvent) => void) | undefined)?.(e); },
    onFocus: (e: React.FocusEvent) => { setOpen(true); (children.props.onFocus as ((e: React.FocusEvent) => void) | undefined)?.(e); },
    onBlur: (e: React.FocusEvent) => { setOpen(false); (children.props.onBlur as ((e: React.FocusEvent) => void) | undefined)?.(e); },
  });
  return (
    <span ref={anchorRef} className="inline-flex">
      {child}
      {open && createPortal(
        <span
          ref={tipRef}
          role="tooltip"
          id={id}
          style={pos}
          className={cn(
            "fade-in pointer-events-none fixed z-[70] inline-flex max-w-[min(20rem,calc(100vw-1rem))] items-center gap-1.5 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-11 font-medium text-background shadow-pop",
            className,
          )}
        >
          {label}
        </span>,
        document.body,
      )}
    </span>
  );
}
