// The mapping assistant: a chat docked beside the New profile steps. It sees the
// whole draft (actions, docs, samples, the map as it is now, the checks), answers
// anything about it, and changes the setup directly. Each change lands through the
// sheet's own setters, so the preview and checks refresh; the latest change can be
// undone from its message. A fresh proposal replaces the map and has no Undo.
import { useEffect, useRef, useState } from "react";
import { ArrowUp, RotateCcw, Sparkles, X } from "lucide-react";
import { cn, MOD } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { targetLabel, type MapRow, type Target } from "./fieldmap";
import type { Identity } from "./IdentityStep";

export type AssistOp =
  | { op: "map"; model: string; path: string; target: Target }
  | { op: "identity"; model: string; idPath?: string; urlTemplate?: string; titleTemplate?: string; every?: string; backfill?: Identity["backfill"] }
  | { op: "select"; model: string }
  | { op: "unselect"; model: string }
  | { op: "name"; value: string }
  | { op: "repropose"; hint: string };

export interface AssistMessage { id: number; role: "user" | "assistant"; text: string; changes?: string[]; undoable?: boolean; undone?: boolean; error?: boolean }

const SINGLE = (t: Target) => t !== "skip" && t !== "property" && t !== "labels";

/** The sheet's map rows and identity with the ops laid over them (pure; the sheet keeps the snapshot for Undo). */
export function applyMapOps(rows: Record<string, MapRow[]>, identity: Record<string, Identity>, ops: AssistOp[]): { rows: Record<string, MapRow[]>; identity: Record<string, Identity> } {
  const r: Record<string, MapRow[]> = { ...rows };
  const id: Record<string, Identity> = { ...identity };
  const map = (p: string, path: string, target: Target) => {
    let list = (r[p] ?? []).map((x) => (SINGLE(target) && x.target === target && x.path !== path ? { ...x, target: "skip" as Target, by: "user" as const } : x));
    if (list.some((x) => x.path === path)) list = list.map((x) => (x.path === path ? { ...x, target, by: "user" as const, reason: "Set by the assistant", confidence: null } : x));
    else list = [...list, { path, target, confidence: null, reason: "Set by the assistant", by: "user" }];
    r[p] = list;
    if (target === "id" && id[p]) id[p] = { ...id[p]!, idPath: path };
    if (target === "url" && id[p]) id[p] = { ...id[p]!, urlTemplate: `{{ item.${path} }}` };
  };
  for (const o of ops) {
    if (o.op === "map") map(o.model, o.path, o.target);
    if (o.op === "identity" && id[o.model]) {
      const cur = id[o.model]!;
      id[o.model] = {
        ...cur,
        ...(o.urlTemplate !== undefined ? { urlTemplate: o.urlTemplate } : {}),
        ...(o.titleTemplate !== undefined ? { titleTemplate: o.titleTemplate } : {}),
        ...(o.every ? { every: o.every } : {}),
        ...(o.backfill ? { backfill: o.backfill } : {}),
      };
      if (o.idPath) map(o.model, o.idPath, "id");
    }
  }
  return { rows: r, identity: id };
}

/** One line per change, for the message. */
export function describeOp(o: AssistOp, modelTitle: (pid: string) => string): string {
  switch (o.op) {
    case "map": return o.target === "skip" ? `Skipped ${o.path}` : `${o.path} is now ${targetLabel(o.target)}`;
    case "identity": return [o.idPath && `id is ${o.idPath}`, o.urlTemplate !== undefined && "new link", o.titleTemplate !== undefined && "new title template", o.every && `refresh every ${o.every}`, o.backfill && `backfill ${o.backfill}`].filter(Boolean).join(", ");
    case "select": return `Picked ${modelTitle(o.model)}`;
    case "unselect": return `Dropped ${modelTitle(o.model)}`;
    case "name": return `Renamed to ${o.value}`;
    case "repropose": return "Asked for a fresh proposal";
  }
}

export function MappingAssistant({ messages, busy, onSend, onUndo, onClose, starters = [] }: {
  messages: AssistMessage[];
  busy: boolean;
  onSend: (text: string) => void;
  onUndo: (id: number) => void;
  onClose: () => void;
  /** Prompts from the draft's open problems ("Fix: ..."); none when nothing is wrong. */
  starters?: string[];
}) {
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [messages.length, busy]);
  useEffect(() => { box.current?.focus(); }, []);
  const send = (t = text) => { const v = t.trim(); if (!v || busy) return; onSend(v); setText(""); };

  return (
    <aside aria-label="Mapping assistant" data-testid="mapping-assistant" className="flex h-full w-full flex-col border-l border-border bg-faint">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border px-3">
        <Sparkles className="size-3.5 text-muted-foreground" />
        <span className="flex-1 text-13 font-semibold">Assistant</span>
        <button type="button" aria-label="Close the assistant" onClick={onClose} className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-card-hover hover:text-foreground"><X className="size-3.5" /></button>
      </div>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-13 text-muted-foreground">Ask anything about this setup. I can see the docs, the sample records and your map, and I change the map for you when you ask.</p>
            <div className="flex flex-col gap-1.5">
              {starters.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} disabled={busy} className="rounded-md border border-border bg-card px-2.5 py-1.5 text-left text-xs transition-colors hover:border-border-strong hover:bg-card-hover">{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
            {messages.map((m) => (
              <li key={m.id} className={cn("flex flex-col gap-1.5", m.role === "user" && "items-end")}>
                <div className={cn("max-w-[92%] whitespace-pre-wrap break-words rounded-lg px-2.5 py-2 text-13 [overflow-wrap:anywhere]", m.role === "user" ? "bg-muted" : "border border-border bg-card", m.error && "text-destructive-text")}>{m.text}</div>
                {m.changes && m.changes.length > 0 && (
                  <div className={cn("flex w-full flex-col gap-1 rounded-md border border-border px-2.5 py-2 text-11 [overflow-wrap:anywhere]", m.undone ? "text-muted-foreground line-through" : "text-foreground")} data-testid="assist-changes">
                    {m.changes.map((c, i) => <span key={i}>{c}</span>)}
                    {m.undoable && !m.undone && (
                      <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => onUndo(m.id)} className="mt-1 w-fit" data-testid="assist-undo">Undo</Button>
                    )}
                  </div>
                )}
              </li>
            ))}
            {busy && <li className="text-11 text-muted-foreground">Thinking...</li>}
          </ol>
        )}
      </div>
      <div className="shrink-0 border-t border-border p-2">
        <div className="flex items-end gap-1.5 rounded-lg border border-border bg-card px-2.5 py-2 focus-within:border-border-strong">
          <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Ask or tell it what to change" aria-label="Message the mapping assistant" data-testid="assist-input"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); send(); } else if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
            className="max-h-40 min-h-0 flex-1 resize-none bg-transparent text-13 outline-none placeholder:text-muted-foreground" />
          <button type="button" onClick={() => send()} disabled={!text.trim() || busy} aria-label="Send" className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground text-background disabled:opacity-40"><ArrowUp className="size-3.5" /></button>
        </div>
        <p className="mt-1 px-1 text-10 text-muted-foreground">Enter sends. {MOD} J shows or hides this panel.</p>
      </div>
    </aside>
  );
}
