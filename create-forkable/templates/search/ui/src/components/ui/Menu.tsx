import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface MenuItem { key: string; label: ReactNode; hint?: ReactNode; onSelect: () => void; disabled?: boolean; tone?: "default" | "destructive" }

/**
 * A small dropdown menu. Controlled: the parent owns `open` so a keyboard
 * shortcut (H for snooze) can open it. Arrow keys move, Enter picks, Esc closes.
 */
export function Menu({ open, onClose, items, anchor, align = "start", className }: {
  open: boolean; onClose: () => void; items: MenuItem[]; anchor: ReactNode; align?: "start" | "end"; className?: string;
}) {
  const [i, setI] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) setI(0); }, [open]);
  useLayoutEffect(() => { if (open) listRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose]);

  const enabled = items.filter((it) => !it.disabled);
  return (
    <div ref={ref} className="relative inline-flex">
      {anchor}
      {open && (
        <div
          ref={listRef}
          role="menu"
          tabIndex={-1}
          className={cn(
            "pop-in absolute top-full z-40 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-border bg-card p-1 shadow-pop outline-none",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { setI((v) => (v + 1) % enabled.length); e.preventDefault(); e.stopPropagation(); }
            else if (e.key === "ArrowUp") { setI((v) => (v - 1 + enabled.length) % enabled.length); e.preventDefault(); e.stopPropagation(); }
            else if (e.key === "Enter") { enabled[i]?.onSelect(); onClose(); e.preventDefault(); e.stopPropagation(); }
            else if (e.key === "Escape") { onClose(); e.preventDefault(); e.stopPropagation(); }
            else {
              const n = Number(e.key);
              if (n >= 1 && n <= enabled.length) { enabled[n - 1]!.onSelect(); onClose(); e.preventDefault(); e.stopPropagation(); }
            }
          }}
        >
          {items.map((it) => {
            const idx = enabled.indexOf(it);
            return (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onMouseEnter={() => idx >= 0 && setI(idx)}
                onClick={() => { it.onSelect(); onClose(); }}
                className={cn(
                  "flex h-7 w-full items-center justify-between gap-4 rounded-md px-2 text-left text-13",
                  idx === i && !it.disabled ? "bg-muted" : "",
                  it.tone === "destructive" ? "text-destructive-text" : "text-foreground",
                  "disabled:opacity-40",
                )}
              >
                <span className="truncate">{it.label}</span>
                {it.hint && <span className="shrink-0 text-11 text-muted-foreground">{it.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
