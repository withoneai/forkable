import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { ApiContact } from "@rill/core/api-types";
import { useContacts } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Avatar } from "../ui/Avatar";

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export interface Attendee { email: string; name: string | null }

/**
 * Chips plus a suggestion list, the way Notion Calendar's "Add participant"
 * works: type a name, an address or a company, pick with arrows and Enter (or
 * Tab), and a typed address that is not a known contact becomes a chip on
 * Enter, comma or space. Backspace on an empty field removes the last chip.
 * The list floats under the field in a portal, so a dialog never clips it and
 * opening or closing it never moves the buttons below.
 */
export function AttendeeInput({ mailboxId, value, onChange, autoFocus }: {
  mailboxId: string; value: Attendee[]; onChange: (next: Attendee[]) => void; autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const [browsing, setBrowsing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const q = useContacts(mailboxId, text.trim(), focused);

  const chosen = useMemo(() => new Set(value.map((a) => a.email.toLowerCase())), [value]);
  const suggestions = (q.data?.contacts ?? []).filter((c) => !chosen.has(c.email)).slice(0, 6);
  const typed = text.trim().replace(/[,;]$/, "");
  const typedIsNew = EMAIL.test(typed) && !chosen.has(typed.toLowerCase()) && !suggestions.some((s) => s.email === typed.toLowerCase());
  const rows: (ApiContact | { email: string; name: null; typed: true })[] = typedIsNew ? [{ email: typed.toLowerCase(), name: null, typed: true }, ...suggestions] : suggestions;
  // Opens once you type, or on ↓ for recent people; an empty field never covers the buttons below.
  const open = focused && (text.trim().length > 0 || browsing) && rows.length > 0;
  const idx = Math.min(active, Math.max(0, rows.length - 1));
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => setRect(box.current?.getBoundingClientRect() ?? null);
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, value.length]);

  const add = (a: Attendee) => {
    if (chosen.has(a.email.toLowerCase())) return;
    onChange([...value, { email: a.email.toLowerCase(), name: a.name }]);
    setText("");
    setActive(0);
    setBrowsing(false);
    input.current?.focus();
  };
  const remove = (email: string) => onChange(value.filter((a) => a.email !== email));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && !open && !text) { e.preventDefault(); setBrowsing(true); return; }
    if (e.key === "ArrowDown" && open) { e.preventDefault(); setActive((i) => (i + 1) % rows.length); return; }
    if (e.key === "ArrowUp" && open) { e.preventDefault(); setActive((i) => (i - 1 + rows.length) % rows.length); return; }
    if ((e.key === "Enter" || e.key === "Tab") && open && (text.trim() || e.key === "Enter")) {
      if (e.key === "Tab" && !text.trim()) return;
      e.preventDefault();
      e.stopPropagation();
      const r = rows[idx]!;
      add({ email: r.email, name: r.name });
      return;
    }
    if ((e.key === "," || e.key === ";" || e.key === " ") && EMAIL.test(typed)) { e.preventDefault(); add({ email: typed, name: null }); return; }
    if (e.key === "Backspace" && !text && value.length) { e.preventDefault(); onChange(value.slice(0, -1)); return; }
    if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setText(""); setBrowsing(false); }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    const emails = pasted.split(/[\s,;]+/).map((s) => s.replace(/^.*<|>$/g, "").trim()).filter((s) => EMAIL.test(s));
    if (emails.length > 1) {
      e.preventDefault();
      const next = [...value];
      for (const em of emails) if (!next.some((a) => a.email === em.toLowerCase())) next.push({ email: em.toLowerCase(), name: null });
      onChange(next);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={box}
        onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); input.current?.focus(); } }}
        className={cn(
          "flex min-h-8 w-full cursor-text flex-wrap items-center gap-1 rounded-md border border-border bg-card px-1.5 py-1 transition-[border-color,box-shadow] duration-100 hover:border-border-strong",
          focused && "border-ring shadow-[0_0_0_3px_color-mix(in_oklch,var(--ring)_18%,transparent)] hover:border-ring",
        )}
      >
        {value.map((a) => (
          <span key={a.email} className="inline-flex h-6 max-w-full items-center gap-1 rounded-sm bg-muted pl-1 pr-0.5 text-xs text-foreground" title={a.email}>
            <Avatar name={a.name ?? a.email} size="xs" />
            <span className="truncate">{a.name ?? a.email}</span>
            <button type="button" aria-label={`Remove ${a.name ?? a.email}`} onClick={() => remove(a.email)} className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={input}
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => { setText(e.target.value); setActive(0); }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); setBrowsing(false); if (EMAIL.test(typed)) add({ email: typed, name: null }); }}
          placeholder={value.length ? "" : "Name, email or company"}
          aria-label="Add attendee"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          className="h-6 min-w-24 flex-1 bg-transparent px-1 text-13 text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        />
      </div>
      {open && rect && createPortal(
        <ul role="listbox" style={{ position: "fixed", top: rect.bottom + 4, left: rect.left, width: rect.width }} className="pop-in z-[60] flex flex-col overflow-hidden rounded-md border border-border bg-card py-1 shadow-float">
          {rows.map((r, i) => (
            <li key={r.email} role="option" aria-selected={i === idx}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); add({ email: r.email, name: r.name }); }}
                onMouseEnter={() => setActive(i)}
                className={cn("flex h-8 w-full items-center gap-2 px-2 text-left", i === idx && "bg-muted")}
              >
                <Avatar name={r.name ?? r.email} size="sm" />
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                  {"typed" in r ? (
                    <span className="truncate text-13">Invite <span className="font-medium">{r.email}</span></span>
                  ) : (
                    <>
                      <span className="truncate text-13 font-medium">{r.name ?? r.email}</span>
                      {r.name && <span className="truncate text-11 text-muted-foreground">{r.email}</span>}
                    </>
                  )}
                </span>
                {!("typed" in r) && <span className="shrink-0 text-10 text-muted-foreground">{r.source === "event" ? "Met recently" : r.source === "both" ? "Mail and meetings" : "Mail"}</span>}
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}
