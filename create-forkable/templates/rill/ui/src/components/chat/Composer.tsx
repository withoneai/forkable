import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import type { EngineOption, EnginesResponse } from "@rill/core/api-types";
import { cn } from "@/lib/utils";
import { AgentPicker, ModelPicker, type EngineChoice } from "./ModelPicker";

const SLASH_COMMANDS: { name: string; hint: string; template: string }[] = [
  { name: "summarize", hint: "Summarize the open thread", template: "Summarize this thread." },
  { name: "reply", hint: "Draft a reply to the open thread", template: "Draft a reply to this thread." },
  { name: "clean", hint: "Propose cleanup for this lane", template: "Clean up this lane: propose what to mark done, screen out, or snooze, and say why." },
  { name: "search", hint: "Search your inbox", template: "/search " },
  { name: "brief", hint: "This morning's brief", template: "Give me this morning's brief in a few sentences." },
];

const MAX_HEIGHT = 168; // ~8 lines of 13px/20px text plus padding

export function Composer({
  value, onChange, onSubmit, canSend, isStreaming, onStop,
  engineValue, onEngineChange, engineOptions, enginesCurrent, focusRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  canSend: boolean;
  isStreaming: boolean;
  onStop: () => void;
  engineValue: EngineChoice | null;
  onEngineChange: (v: EngineChoice | null) => void;
  engineOptions: EngineOption[];
  enginesCurrent: EnginesResponse["current"];
  focusRef: React.RefObject<(() => void) | null>;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashSel, setSlashSel] = useState(0);

  useEffect(() => {
    focusRef.current = () => ref.current?.focus();
  }, [focusRef]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(MAX_HEIGHT, el.scrollHeight)}px`;
  }, [value]);

  const slashQuery = /^\/([a-z]*)$/i.exec(value)?.[1] ?? null;
  const matches = slashQuery !== null ? SLASH_COMMANDS.filter((c) => c.name.startsWith(slashQuery.toLowerCase())) : [];
  const showSlash = slashOpen && matches.length > 0;

  useEffect(() => {
    setSlashOpen(slashQuery !== null);
    setSlashSel(0);
  }, [slashQuery]);

  const pick = (cmd: (typeof SLASH_COMMANDS)[number]) => {
    onChange(cmd.template);
    setSlashOpen(false);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(cmd.template.length, cmd.template.length);
    });
  };

  const submit = () => {
    if (!canSend || isStreaming) return;
    onSubmit();
  };

  return (
    <div className="relative shrink-0 border-t border-border bg-card/60 p-2">
      {showSlash && (
        <div role="listbox" aria-label="Slash commands" className="pop-in absolute bottom-full left-2 right-2 z-20 mb-1 overflow-hidden rounded-lg border border-border bg-card p-1 shadow-pop">
          {matches.map((cmd, i) => (
            <button
              key={cmd.name}
              type="button"
              role="option"
              aria-selected={i === slashSel}
              onMouseEnter={() => setSlashSel(i)}
              onClick={() => pick(cmd)}
              className={cn("flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs", i === slashSel ? "bg-muted" : "")}
            >
              <span className="shrink-0 font-mono font-medium">/{cmd.name}</span>
              <span className="truncate text-muted-foreground">{cmd.hint}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-2.5 py-2 transition-colors focus-within:border-border-strong">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ask about your inbox, or try /summarize, /clean, /search…"
          aria-label="Message the assistant"
          rows={1}
          className="max-h-[168px] min-h-[20px] w-full resize-none bg-transparent text-13 outline-none placeholder:text-muted-foreground/60"
          onKeyDown={(e) => {
            if (showSlash) {
              if (e.key === "ArrowDown") { e.preventDefault(); setSlashSel((s) => (s + 1) % matches.length); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setSlashSel((s) => (s - 1 + matches.length) % matches.length); return; }
              if ((e.key === "Enter" || e.key === "Tab") && matches[slashSel]) { e.preventDefault(); e.stopPropagation(); pick(matches[slashSel]!); return; }
              if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setSlashOpen(false); return; }
            }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); submit(); return; }
            if (e.key === "Escape") {
              e.stopPropagation();
              if (value) { e.preventDefault(); onChange(""); }
              else (e.target as HTMLTextAreaElement).blur();
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-0.5">
            <AgentPicker value={engineValue} onChange={onEngineChange} options={engineOptions} current={enginesCurrent} />
            <span className="text-11 text-muted-foreground/50" aria-hidden>·</span>
            <ModelPicker value={engineValue} onChange={onEngineChange} options={engineOptions} current={enginesCurrent} />
          </div>
          {isStreaming ? (
            <button type="button" onClick={onStop} aria-label="Stop" className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90">
              <Square className="size-2.5" fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label="Send"
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              <ArrowUp className="size-3.5" strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
      <p className="mt-1.5 px-1 text-center text-11 text-muted-foreground/50">
        Reads your inbox. Proposes, never sends. <span className="font-mono">/</span> for commands.
      </p>
    </div>
  );
}
