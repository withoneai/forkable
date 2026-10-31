import { useEffect, useRef } from "react";
import { ArrowUp, Square, X } from "lucide-react";
import { cn, MOD } from "@/lib/utils";
import { SourceLogo } from "@/components/SourceLogo";

export interface ContextChip { key: string; label: string; mono?: boolean; platform?: string; onRemove: () => void }

const MAX_HEIGHT = 168;

/**
 * Enter or Cmd+Enter sends. With nothing typed, Cmd+Enter applies the latest
 * query proposal instead. Esc clears, then hands focus back to the results.
 */
export function Composer({ value, onChange, onSubmit, onApply, canSend, isStreaming, onStop, chips, focusRef, onEscape }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onApply: () => boolean;
  canSend: boolean;
  isStreaming: boolean;
  onStop: () => void;
  chips: ContextChip[];
  focusRef: React.MutableRefObject<(() => void) | null>;
  onEscape: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    focusRef.current = () => ref.current?.focus();
    return () => { focusRef.current = null; };
  }, [focusRef]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(MAX_HEIGHT, el.scrollHeight)}px`;
  }, [value]);

  const submit = () => { if (canSend && !isStreaming) onSubmit(); };

  return (
    <div className="shrink-0 border-t border-border p-2">
      <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-2.5 py-2 transition-colors focus-within:border-border-strong">
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1" aria-label="Context">
            {chips.map((c) => (
              <span key={c.key} className="inline-flex h-5 max-w-full items-center gap-1 rounded-sm bg-muted pl-1.5 pr-0.5 text-11 text-muted-foreground">
                {c.platform && <SourceLogo platform={c.platform} size={11} />}
                <span className={cn("max-w-[200px] truncate", c.mono && "font-mono text-foreground")}>{c.label}</span>
                <button type="button" onClick={c.onRemove} aria-label={`Remove ${c.label} from the context`} className="rounded-sm p-0.5 hover:bg-border-strong/60 hover:text-foreground"><X className="size-2.5" /></button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ask about your results"
          aria-label="Message the assistant"
          data-testid="composer"
          rows={1}
          className="max-h-[168px] min-h-5 w-full resize-none bg-transparent text-13 outline-none placeholder:text-muted-foreground/60"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault(); e.stopPropagation();
              if (!value.trim()) onApply(); else submit();
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); submit(); return; }
            if (e.key === "Escape") {
              e.preventDefault(); e.stopPropagation();
              if (value) onChange("");
              else { (e.target as HTMLTextAreaElement).blur(); onEscape(); }
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-11 text-muted-foreground/70">{MOD}↵ to send</span>
          {isStreaming ? (
            <button type="button" onClick={onStop} aria-label="Stop" className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90">
              <Square className="size-2.5" fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={!canSend} aria-label="Send" className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary-hover disabled:bg-muted disabled:text-muted-foreground">
              <ArrowUp className="size-3.5" strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
      <p className="mt-1.5 px-1 text-center text-11 text-muted-foreground/70">Answers come only from items Search found. Every claim links to one.</p>
    </div>
  );
}
