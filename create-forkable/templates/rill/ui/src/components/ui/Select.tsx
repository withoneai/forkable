import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search as SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: ReactNode;
  /** Plain text for type-ahead and search filtering when `label` isn't a string. */
  text?: string;
  disabled?: boolean;
}

const optionText = (o: SelectOption) => (o.text ?? (typeof o.label === "string" ? o.label : "")).toLowerCase();

/**
 * A styled dropdown: trigger matches Input/Button, popover has arrow and
 * type-ahead keyboard support, a search box once the list is long, and a
 * check mark on the selected row. Drop-in for a native <select> bound to
 * value/onChange.
 */
export function Select({
  value,
  onChange,
  options,
  label,
  placeholder = "Select…",
  className,
  searchable,
  searchPlaceholder = "Search…",
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  label: string;
  placeholder?: string;
  className?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeBuf = useRef("");
  const typeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const withSearch = searchable ?? options.length > 8;
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    if (!withSearch || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => optionText(o).includes(q));
  }, [options, query, withSearch]);
  const enabled = filtered.filter((o) => !o.disabled);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const idx = enabled.findIndex((o) => o.value === value);
    setHi(idx === -1 ? 0 : idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    (withSearch ? searchRef.current : listRef.current)?.focus();
  }, [open, withSearch]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // The menu lives in a portal with fixed positioning, so a card with
  // overflow-hidden can never clip it. Flips above when there is no room below.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const h = popRef.current?.offsetHeight ?? 0;
      const below = window.innerHeight - r.bottom;
      const up = below < h + 8 && r.top > below;
      const left = Math.min(r.left, window.innerWidth - (popRef.current?.offsetWidth ?? 0) - 8);
      setPos({ left: Math.max(8, left), minWidth: r.width, ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) });
    };
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, filtered.length]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") { setHi((v) => (enabled.length ? (v + 1) % enabled.length : 0)); e.preventDefault(); }
    else if (e.key === "ArrowUp") { setHi((v) => (enabled.length ? (v - 1 + enabled.length) % enabled.length : 0)); e.preventDefault(); }
    else if (e.key === "Enter") { if (enabled[hi]) pick(enabled[hi]!.value); e.preventDefault(); }
    else if (e.key === "Escape") { close(); e.preventDefault(); }
    else if (e.key === "Tab") { setOpen(false); }
    else if (!withSearch && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      clearTimeout(typeTimer.current);
      typeBuf.current += e.key.toLowerCase();
      const idx = enabled.findIndex((o) => optionText(o).startsWith(typeBuf.current));
      if (idx >= 0) setHi(idx);
      typeTimer.current = setTimeout(() => { typeBuf.current = ""; }, 600);
    }
  }

  return (
    <div ref={rootRef} className={cn("relative inline-block", className)}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) { setOpen(true); e.preventDefault(); } }}
        className={cn(
          "flex h-7 w-full min-w-0 items-center justify-between gap-1.5 rounded-md border border-border bg-card px-2 text-left text-xs text-foreground",
          "transition-[border-color,box-shadow] duration-100 hover:border-border-strong focus:border-ring focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--ring)_18%,transparent)] focus:outline-none focus-visible:outline-none",
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>{selected ? selected.label : placeholder}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-100", open && "rotate-180")} />
      </button>
      {open && createPortal(
        <div ref={popRef} data-select-menu style={pos} className="pop-in fixed z-[60] max-w-[min(22rem,90vw)] overflow-hidden rounded-lg border border-border bg-card shadow-pop">
          {withSearch && (
            <div className="flex items-center gap-1.5 border-b border-border px-2">
              <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setHi(0); }}
                onKeyDown={onKeyDown}
                placeholder={searchPlaceholder}
                className="h-8 w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
              />
            </div>
          )}
          <div
            ref={listRef}
            role="listbox"
            tabIndex={withSearch ? -1 : 0}
            onKeyDown={withSearch ? undefined : onKeyDown}
            className="max-h-64 overflow-y-auto p-1 outline-none"
          >
            {filtered.length === 0 && <p className="px-2 py-3 text-center text-11 text-muted-foreground">No matches.</p>}
            {filtered.map((o) => {
              const idx = enabled.indexOf(o);
              const isSel = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  data-idx={idx}
                  disabled={o.disabled}
                  onMouseEnter={() => idx >= 0 && setHi(idx)}
                  onClick={() => pick(o.value)}
                  className={cn(
                    "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-foreground",
                    idx === hi && !o.disabled ? "bg-muted" : "",
                    "disabled:opacity-40",
                  )}
                >
                  <Check className={cn("size-3.5 shrink-0", isSel ? "text-foreground" : "text-transparent")} />
                  <span className="truncate">{o.label}</span>
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
