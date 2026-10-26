import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Dialog({ open, onClose, title, children, className, size = "md" }: {
  open: boolean; onClose: () => void; title?: string; children: ReactNode; className?: string; size?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Read through a ref so a parent re-render (a new inline onClose) never re-runs the
  // effect below, which would move focus back to the first field mid-typing.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input,textarea,button,[tabindex]:not([tabindex='-1'])");
    (first ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // An open combobox (the attendee suggestions) closes itself first.
        if ((e.target as HTMLElement | null)?.getAttribute?.("aria-expanded") === "true") return;
        e.stopPropagation(); closeRef.current(); return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const els = [...ref.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex='-1'])")];
      if (els.length === 0) { e.preventDefault(); return; }
      const first = els[0]!, last = els[els.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !ref.current.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !ref.current.contains(active))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); prev?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fade-in fixed inset-0 z-50 flex items-start justify-center bg-foreground/15 px-4 pt-[12vh] dark:bg-background/70" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "pop-in w-full overflow-hidden rounded-xl border border-border bg-card shadow-float outline-none",
          size === "sm" ? "max-w-[380px]" : size === "lg" ? "max-w-[720px]" : "max-w-[520px]",
          className,
        )}
      >
        {title && <div className="border-b border-border px-4 py-3 text-13 font-semibold">{title}</div>}
        {children}
      </div>
    </div>
  );
}
