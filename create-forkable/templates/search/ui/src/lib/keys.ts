// One global key handler. Bindings: "j", "shift+?", "mod+k", "g v" (sequence), "escape".
import { useEffect, useRef } from "react";

export type KeyHandler = (e: KeyboardEvent) => void | boolean;
export type KeyMap = Record<string, KeyHandler>;

type Entry = { map: KeyMap; priority: number; whileTyping: boolean };
const entries = new Set<Entry>();
let pending: string | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let installed = false;

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

function chord(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  let k = e.key;
  // Option on a Mac turns digits and letters into other glyphs (alt+1 is "¡"); read the physical key instead.
  if (e.altKey && /^(Digit|Key)/.test(e.code)) k = e.code.replace(/^(Digit|Key)/, "");
  if (k === " ") k = "space";
  k = k.toLowerCase();
  // Shift counts for named keys, letters and chords; not for symbols it is needed to type ("?").
  if (e.shiftKey && k !== "shift" && (k.length > 1 || /^[a-z]$/.test(k) || e.metaKey || e.ctrlKey || e.altKey)) parts.push("shift");
  parts.push(k);
  return parts.join("+");
}

function dispatch(e: KeyboardEvent) {
  if (e.defaultPrevented) return;
  if (e.key === "Shift" || e.key === "Meta" || e.key === "Control" || e.key === "Alt") return;
  const typing = isTyping(e);
  const c = chord(e);
  // An open modal owns the keyboard: only bindings registered while typing (the palette's) still run.
  const modal = document.querySelector('[aria-modal="true"]');
  const blocked = (en: Entry) => !!modal && !en.whileTyping;
  const sorted = [...entries].sort((a, b) => b.priority - a.priority);

  // Pending sequence ("g" then "v").
  if (pending && !typing) {
    const seq = `${pending} ${c}`;
    pending = null;
    if (pendingTimer) clearTimeout(pendingTimer);
    for (const en of sorted) {
      if (blocked(en)) continue;
      const h = en.map[seq];
      if (h) { if (h(e) !== false) { e.preventDefault(); return; } }
    }
    // fall through to single key
  }

  for (const en of sorted) {
    if (blocked(en)) continue;
    if (typing && !en.whileTyping && c !== "escape" && !c.startsWith("mod+")) continue;
    // A sequence prefix?
    if (!typing && Object.keys(en.map).some((k) => k.startsWith(`${c} `))) {
      pending = c;
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => { pending = null; }, 1200);
      e.preventDefault();
      return;
    }
    const h = en.map[c];
    if (h) {
      const r = h(e);
      if (r !== false) { e.preventDefault(); return; }
    }
  }
}

function install() {
  if (installed) return;
  installed = true;
  window.addEventListener("keydown", dispatch);
}

/**
 * Register key bindings while the component is mounted. Handlers never fire
 * while the user types in an input, except "escape" and "mod+…" chords, or
 * when `whileTyping` is set (used by the palette).
 */
export function useKeys(map: KeyMap, opts: { enabled?: boolean; priority?: number; whileTyping?: boolean } = {}) {
  const ref = useRef(map);
  ref.current = map;
  const { enabled = true, priority = 0, whileTyping = false } = opts;
  useEffect(() => {
    if (!enabled) return;
    install();
    const entry: Entry = {
      get map() { return ref.current; },
      priority,
      whileTyping,
    };
    entries.add(entry);
    return () => { entries.delete(entry); };
  }, [enabled, priority, whileTyping]);
}
