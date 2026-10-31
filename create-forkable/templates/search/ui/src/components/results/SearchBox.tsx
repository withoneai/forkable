import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { CornerDownLeft, Search as SearchIcon, X } from "lucide-react";
import type { SuggestResponse } from "@/contract/api-types";
import { partialOperator } from "@/contract/query";
import { api } from "@/lib/api";
import { cn, MOD, useDebounced } from "@/lib/utils";
import { SourceLogo } from "@/components/SourceLogo";
import { Avatar } from "@/components/ui/Avatar";
import { Kbd } from "@/components/ui/Kbd";

export interface SearchBoxHandle { focus: () => void; blur: () => void }

// Home and the results page each render their own box; the first keystroke on
// home swaps one for the other. This carries focus (and the caret) across.
let hadFocus = false;

/**
 * The box. Typing writes the URL after 120 ms (replace, so history keeps one
 * entry per search); Enter commits. While an operator is half typed, up to five
 * completions show under it; Tab accepts the first. On an empty suggestion,
 * Tab asks the assistant.
 */
export const SearchBox = forwardRef<SearchBoxHandle, {
  value: string;
  onCommit: (q: string, opts?: { replace?: boolean }) => void;
  onAsk: (q: string) => void;
  onDown?: () => void;
  size?: "home" | "bar";
  autoFocus?: boolean;
}>(function SearchBox({ value, onCommit, onAsk, onDown, size = "bar", autoFocus }, ref) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const [sug, setSug] = useState<SuggestResponse | null>(null);
  const [si, setSi] = useState(0);
  // Enter or Esc closes the list for the text as it stands; a late answer must not reopen it.
  const [dismissed, setDismissed] = useState<string | null>(null);
  // Suggestions follow typing only: text that arrives from the URL (chips, Apply, the
  // palette) never opens the list over the chip bar.
  const [edited, setEdited] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const typed = useRef(false);
  useImperativeHandle(ref, () => ({ focus: () => { input.current?.focus(); input.current?.select(); }, blur: () => input.current?.blur() }), []);
  useEffect(() => {
    if (!hadFocus || !input.current) return;
    const el = input.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // The URL is the truth: follow it when it changes from outside (chips, Apply,
  // palette), but never over what is being typed, which the URL trails by 120 ms.
  const committed = useRef(value);
  useEffect(() => {
    if (value !== committed.current) setText(value);
    committed.current = value;
  }, [value]);
  const commit = (q: string, opts?: { replace?: boolean }) => { committed.current = q.trim(); onCommit(q, opts); };

  const debounced = useDebounced(text, 120);
  useEffect(() => {
    if (!typed.current || debounced.trim() === value) return;
    commit(debounced, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  // Completions for a half-typed operator, or a person or company name.
  const partial = partialOperator(text, input.current?.selectionStart ?? text.length);
  useEffect(() => {
    if (!focused || !text.trim() || edited !== text) { setSug(null); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api.suggest(text, ctl.signal).then((s) => { setSug(s); setSi(0); }).catch(() => {});
    }, 80);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [text, focused, edited]);

  const rows = [
    ...(sug?.operators ?? []).map((o) => ({ key: o.insert, label: o.label, insert: o.insert, logo: o.logoUrl, person: null as string | null })),
    ...(partial ? [] : (sug?.entities ?? []).map((e) => ({ key: e.id, label: `${e.name}${e.subtitle ? `  ·  ${e.subtitle}` : ""}`, insert: `with:"${e.name}"`, logo: undefined, person: e.name }))),
  ].slice(0, 5);
  const lastToken = text.trimEnd().split(/\s+/).pop() ?? "";
  const useful = rows.filter((r) => r.insert.toLowerCase() !== lastToken.toLowerCase());
  const showSug = focused && useful.length > 0 && text.trim().length > 0 && dismissed !== text && edited === text;

  const accept = (insert: string) => {
    let next: string;
    if (partial) next = `${text.slice(0, partial.start)}${insert} `;
    else { const words = text.trimEnd().split(/\s+/); words.pop(); next = `${[...words, insert].join(" ")} `; }
    typed.current = true;
    setText(next);
    commit(next.trim(), { replace: true });
    setSug(null);
  };

  const home = size === "home";
  return (
    <div className="relative w-full">
      <div className={cn(
        "flex w-full items-center gap-2.5 border bg-card transition-[border-color,box-shadow] duration-100",
        home ? "h-12 rounded-lg border-border-strong px-4 shadow-pop" : "h-10 rounded-md border-border px-3",
        focused && "border-ring shadow-[0_0_0_3px_color-mix(in_oklch,var(--ring)_18%,transparent)]",
      )}>
        <SearchIcon className={cn("shrink-0 stroke-[1.75] text-muted-foreground", home ? "size-[18px]" : "size-4")} />
        <input
          ref={input}
          value={text}
          autoFocus={autoFocus}
          spellCheck={false}
          autoComplete="off"
          aria-label="Search"
          data-testid="search-box"
          placeholder="Search everything, or ask a question"
          onFocus={() => { hadFocus = true; setFocused(true); }}
          onBlur={() => { hadFocus = false; setTimeout(() => setFocused(false), 120); }}
          onChange={(e) => { typed.current = true; setText(e.target.value); setEdited(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && showSug) { setSi((v) => Math.min(useful.length - 1, v + 1)); e.preventDefault(); return; }
            if (e.key === "ArrowUp" && showSug) { setSi((v) => Math.max(0, v - 1)); e.preventDefault(); return; }
            if (e.key === "Tab" && !e.shiftKey) {
              if (showSug && useful[si]) { accept(useful[si]!.insert); e.preventDefault(); return; }
              if (text.trim()) { onAsk(text.trim()); e.preventDefault(); }
              return;
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { onAsk(text.trim()); e.preventDefault(); e.stopPropagation(); return; }
            if (e.key === "Enter") {
              if (showSug && si > 0 && useful[si]) { accept(useful[si]!.insert); e.preventDefault(); return; }
              typed.current = true;
              commit(text.trim());
              setSug(null);
              setDismissed(text);
              e.preventDefault();
              return;
            }
            if (e.key === "ArrowDown") { onDown?.(); e.preventDefault(); return; }
            if (e.key === "Escape") {
              if (showSug) { setSug(null); setDismissed(text); e.preventDefault(); e.stopPropagation(); return; }
              if (text) { typed.current = true; setText(""); commit("", { replace: true }); }
              else input.current?.blur();
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          className={cn("h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60", home ? "text-15" : "text-13")}
        />
        {text && !home && (
          <button type="button" aria-label="Clear the search" onClick={() => { typed.current = true; setText(""); commit(""); input.current?.focus(); }} className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-card-hover hover:text-foreground">
            <X className="size-3.5" />
          </button>
        )}
        <span className="flex shrink-0 items-center gap-1.5 text-11 text-muted-foreground">
          {focused ? (<><Kbd>Tab</Kbd><span>Ask</span></>) : (<><Kbd>/</Kbd>{home && <span className="ml-1.5 flex items-center gap-1"><Kbd>{MOD}</Kbd><Kbd>K</Kbd></span>}</>)}
        </span>
      </div>
      {showSug && (
        <div role="listbox" aria-label="Suggestions" className="pop-in absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-card p-1 shadow-pop">
          {useful.map((r, i) => (
            <button key={r.key} type="button" role="option" aria-selected={i === si} onMouseEnter={() => setSi(i)} onMouseDown={(e) => { e.preventDefault(); accept(r.insert); }}
              className={cn("flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-13", i === si && "bg-muted")}>
              {r.person ? <Avatar name={r.person} size="sm" /> : /^(from|to|with|about):/.test(r.insert) ? <Avatar name={r.label.split(": ")[1]?.replace(" (you)", "") ?? "?"} size="sm" /> : r.logo ? <SourceLogo platform={r.insert.split(":")[1] ?? ""} src={r.logo} size={16} /> : <span className="flex size-5 items-center justify-center font-mono text-11 text-muted-foreground">:</span>}
              <span className="truncate">{r.label}</span>
              <span className="ml-auto shrink-0 text-11 text-muted-foreground">{i === si ? (i === 0 ? <Kbd>Tab</Kbd> : <CornerDownLeft className="size-3" />) : null}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
