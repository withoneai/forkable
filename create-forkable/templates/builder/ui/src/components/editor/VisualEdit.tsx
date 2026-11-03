// Visual edit: the style panel for one selected
// element, the comment box, and the bar that applies pending edits in one go.
import { useEffect, useRef, useState } from "react";
import { MessageSquare, Paintbrush, Type, X } from "lucide-react";
import type { DirectEdit, Selection } from "@builder/core/types";
import { currentIn, TOKEN_GROUPS } from "@/lib/styleTokens";
import { cn, MOD } from "@/lib/utils";
import { Button, IconButton, Keys } from "@/components/ui";

const shortLoc = (loc: string) => {
  const [file, line] = loc.split(":");
  return `${file?.replace(/^src\//, "")}:${line}`;
};

/** The element's classes as the preview would show them now: its own, with the pending swap applied. */
export function liveClasses(sel: Selection, pending: { remove: string[]; add: string[] } | undefined): string[] {
  const own = (sel.classes ?? "").split(/\s+/).filter(Boolean);
  const kept = own.filter((c) => !pending?.remove.includes(c));
  for (const a of pending?.add ?? []) if (!kept.includes(a)) kept.push(a);
  return kept;
}

export function StylePanel({ selection, pending, onSwap, onClose }: {
  selection: Selection;
  pending: { remove: string[]; add: string[] } | undefined;
  onSwap: (remove: string[], add: string[]) => void;
  onClose: () => void;
}) {
  const classes = liveClasses(selection, pending);
  const [custom, setCustom] = useState("");
  return (
    <div role="dialog" aria-label="Style" className="slide-up absolute right-3 top-3 z-20 flex max-h-[calc(100%-5rem)] w-64 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-float">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border pl-3 pr-1.5">
        <Paintbrush className="size-3.5 stroke-[1.75] text-muted-foreground" />
        <span className="text-13 font-medium">Style</span>
        <span className="min-w-0 flex-1 truncate font-mono text-11 text-muted-foreground" title={selection.loc}>&lt;{selection.tag}&gt; {shortLoc(selection.loc)}</span>
        <IconButton size="sm" label="Close the style panel" onClick={onClose}><X /></IconButton>
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
        {TOKEN_GROUPS.map((g) => {
          const cur = currentIn(g, classes);
          return (
            <div key={g.id} className="flex flex-col gap-1.5">
              <span className="text-11 font-medium text-muted-foreground">{g.label}</span>
              <div className="flex flex-wrap gap-1">
                {g.options.map((o) => {
                  const on = cur.includes(o.cls);
                  return (
                    <button
                      key={o.cls}
                      type="button"
                      title={o.cls}
                      aria-pressed={on}
                      onClick={() => onSwap(on ? [o.cls] : cur, on ? [] : [o.cls])}
                      className={cn(
                        "h-6 min-w-7 rounded-md border px-1.5 text-11 font-medium transition-colors duration-100",
                        on ? "border-accent bg-accent text-accent-foreground" : "border-border bg-background text-foreground hover:border-border-strong hover:bg-card-hover",
                      )}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
              {cur.some((c) => !g.options.some((o) => o.cls === c)) && (
                <span className="text-11 text-muted-foreground">Now {cur.join(" ")}, outside the ladder</span>
              )}
            </div>
          );
        })}
        <label className="flex flex-col gap-1.5">
          <span className="text-11 font-medium text-muted-foreground">Custom classes</span>
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && custom.trim()) {
                onSwap([], custom.trim().split(/\s+/));
                setCustom("");
              }
            }}
            placeholder="shadow-sm italic"
            spellCheck={false}
            className="h-7 rounded-md border border-border bg-background px-2 font-mono text-11 outline-none transition-colors focus:border-ring"
          />
        </label>
      </div>
    </div>
  );
}

export function CommentBox({ selection, onAdd, onCancel }: { selection: Selection; onAdd: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, [selection.loc]);
  return (
    <div role="dialog" aria-label="Comment" className="pop-in absolute bottom-14 left-1/2 z-20 flex w-[min(420px,calc(100%-2rem))] -translate-x-1/2 flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-float">
      <div className="flex items-center gap-2 text-11 text-muted-foreground">
        <MessageSquare className="size-3.5 stroke-[1.75]" />
        <span className="font-mono">&lt;{selection.tag}&gt; {shortLoc(selection.loc)}</span>
        {selection.text && <span className="min-w-0 flex-1 truncate">"{selection.text}"</span>}
      </div>
      <textarea
        ref={ref}
        value={text}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        placeholder="What should change here?"
        aria-label="Comment"
        className="min-h-14 resize-none rounded-md border border-border bg-background px-2.5 py-2 text-13 outline-none transition-colors focus:border-ring"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) { e.preventDefault(); onAdd(text.trim()); }
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
      />
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1 text-11 text-muted-foreground"><Keys combo={`${MOD} Enter`} /> to add</span>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!text.trim()} onClick={() => onAdd(text.trim())}>Add comment</Button>
        </div>
      </div>
    </div>
  );
}

const describe = (edits: DirectEdit[]) => {
  const t = edits.filter((e) => e.kind === "text").length;
  const s = edits.filter((e) => e.kind === "class").length;
  const c = edits.filter((e) => e.kind === "comment").length;
  return [t && `${t} text`, s && `${s} style`, c && `${c} comment${c === 1 ? "" : "s"}`].filter(Boolean).join(", ");
};

export function EditsBar({ edits, busy, applying, onApply, onDiscard, onRemove }: {
  edits: DirectEdit[];
  busy: boolean;
  applying: boolean;
  onApply: () => void;
  onDiscard: () => void;
  onRemove: (i: number) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!edits.length) return null;
  return (
    <div className="slide-up absolute bottom-14 left-1/2 z-10 flex -translate-x-1/2 flex-col items-stretch">
      {open && (
        <ul className="mb-1.5 flex max-h-56 w-80 flex-col overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-float" aria-label="Pending edits">
          {edits.map((e, i) => (
            <li key={`${e.kind}-${e.loc}-${i}`} className="group flex items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-card-hover">
              {e.kind === "text" ? <Type className="mt-0.5 size-3.5 shrink-0 stroke-[1.75] text-muted-foreground" /> : e.kind === "class" ? <Paintbrush className="mt-0.5 size-3.5 shrink-0 stroke-[1.75] text-muted-foreground" /> : <MessageSquare className="mt-0.5 size-3.5 shrink-0 stroke-[1.75] text-muted-foreground" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {e.kind === "text" ? `"${e.after}"` : e.kind === "class" ? [...e.remove.map((c) => `-${c}`), ...e.add.map((c) => `+${c}`)].join(" ") : e.text}
                </span>
                <span className="block truncate font-mono text-11 text-muted-foreground">{shortLoc(e.loc)}</span>
              </span>
              <IconButton size="sm" label="Remove this edit" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => onRemove(i)}><X /></IconButton>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-1.5 rounded-full border border-border bg-card/95 py-1 pl-3 pr-1 shadow-float backdrop-blur">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-xs font-medium text-foreground hover:underline">
          {describe(edits)}
        </button>
        <Button size="sm" variant="ghost" className="rounded-full" onClick={onDiscard}>Discard</Button>
        <Button size="sm" variant="primary" className="rounded-full" loading={applying} disabled={busy} title={busy ? "The agent is working. Apply when this step ends." : undefined} onClick={onApply}>
          Apply {edits.length} edit{edits.length === 1 ? "" : "s"}
        </Button>
      </div>
    </div>
  );
}
