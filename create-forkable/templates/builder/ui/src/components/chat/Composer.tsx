import { useEffect, useRef, useState } from "react";
import { ArrowUp, ImagePlus, ListChecks, Square, X } from "lucide-react";
import type { Selection } from "@builder/core/types";
import { cn, MOD } from "@/lib/utils";
import { Keys, Tooltip } from "@/components/ui";
import { SelectionChip } from "./TurnView";

const MAX_HEIGHT = 200;

export interface Attached { file: string; url: string; name: string }

export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
/** Image files from a paste or a drop (the server checks the type and the 8 MB limit). */
export const imageFiles = (list: FileList | null | undefined): File[] => [...(list ?? [])].filter((f) => f.type.startsWith("image/"));

/** Attached image thumbnails with a remove button each (composer and Home). */
export function AttachedThumbs({ images, onRemove, size = "sm" }: { images: Attached[]; onRemove: (file: string) => void; size?: "sm" | "md" }) {
  if (!images.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Attached images">
      {images.map((im) => (
        <span key={im.file} className={cn("group relative overflow-hidden rounded-md border border-border bg-muted", size === "md" ? "size-16" : "size-12")}>
          <img src={im.url} alt={im.name} className="size-full object-cover" />
          <button type="button" aria-label={`Remove ${im.name}`} onClick={() => onRemove(im.file)} className="absolute right-0.5 top-0.5 inline-flex size-4 items-center justify-center rounded-sm bg-background/90 text-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"><X className="size-3" /></button>
        </span>
      ))}
    </div>
  );
}

export function Composer({ value, onChange, onSubmit, busy, canSteer, onStop, stopping, selections, onRemoveSelection, focusRef, disabled, plan, onPlan, canPlan, images, onAttach, onRemoveImage, attaching }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  canSteer: boolean;
  onStop: () => void;
  stopping: boolean;
  selections: Selection[];
  onRemoveSelection: (loc: string) => void;
  focusRef: React.RefObject<(() => void) | null>;
  disabled?: string | null;
  /** Plan mode: the next message asks for a plan, nothing is edited. */
  plan: boolean;
  onPlan: (on: boolean) => void;
  canPlan: boolean;
  images: Attached[];
  onAttach: (files: File[]) => void;
  onRemoveImage: (file: string) => void;
  attaching: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { focusRef.current = () => ref.current?.focus(); }, [focusRef]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(MAX_HEIGHT, el.scrollHeight)}px`;
  }, [value]);

  const can = value.trim().length > 0 && !disabled;
  const placeholder = disabled ?? (busy ? (canSteer ? "Add something. The agent reads it after its next step" : "Queue a message for when this step ends") : plan ? "Describe what you want. The agent proposes a plan first" : selections.length ? "What should change here?" : "Ask for a change");

  return (
    <div className="shrink-0 px-3 pb-3 pt-1">
      <div
        className={cn("flex flex-col gap-1.5 rounded-xl border bg-card px-3 pb-2 pt-2.5 shadow-pop transition-colors focus-within:border-border-strong", drag ? "border-accent" : "border-border")}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          setDrag(false);
          const files = imageFiles(e.dataTransfer.files);
          if (files.length) { e.preventDefault(); onAttach(files); }
        }}
      >
        <AttachedThumbs images={images} onRemove={onRemoveImage} />
        {selections.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {selections.map((s) => <SelectionChip key={s.loc} tag={s.tag} loc={s.loc} onRemove={() => onRemoveSelection(s.loc)} />)}
          </div>
        )}
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label="Message the agent"
          rows={2}
          disabled={!!disabled}
          className="min-h-10 w-full resize-none bg-transparent text-13 leading-relaxed outline-none placeholder:text-muted-foreground/55 disabled:opacity-60"
          onPaste={(e) => {
            const files = imageFiles(e.clipboardData.files);
            if (files.length) { e.preventDefault(); onAttach(files); }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); if (can) onSubmit(); return; }
            if (e.key === "Escape") { e.stopPropagation(); (e.target as HTMLTextAreaElement).blur(); }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; if (f.length) onAttach(f); e.target.value = ""; }} />
            <Tooltip side="top" label="Attach an image (or paste one)">
              <button type="button" aria-label="Attach an image" disabled={attaching || !!disabled} onClick={() => fileRef.current?.click()} className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground disabled:opacity-40">
                <ImagePlus className="size-4 stroke-[1.75]" />
              </button>
            </Tooltip>
            {canPlan && (
              <Tooltip side="top" label={plan ? "Plan mode is on. The agent proposes, you approve" : "Plan first: the agent proposes, you edit and approve"}>
                <button type="button" aria-pressed={plan} onClick={() => onPlan(!plan)} className={cn("inline-flex h-7 items-center gap-1 rounded-full px-2 text-11 font-medium transition-colors", plan ? "bg-accent/12 text-accent" : "text-muted-foreground hover:bg-card-hover hover:text-foreground")}>
                  <ListChecks className="size-3.5 stroke-[1.75]" />Plan
                </button>
              </Tooltip>
            )}
          <span className="ml-1 truncate text-11 text-muted-foreground/70">
            {busy ? (canSteer ? "Messages reach the agent between steps" : "Messages wait for this step to end") : <span className="inline-flex items-center gap-1"><Keys combo={`${MOD} Enter`} /> to {plan ? "plan" : "send"}</span>}
          </span>
          </div>
          <div className="flex items-center gap-1.5">
            {busy && (
              <Tooltip side="top" label={<>Stop<span className="ml-0.5 rounded-sm bg-background/20 px-1 font-normal opacity-90">{MOD}.</span></>}>
                <button type="button" onClick={onStop} disabled={stopping} aria-label="Stop" className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-xs font-medium transition-colors hover:bg-card-hover disabled:opacity-50">
                  <Square className="size-2.5" fill="currentColor" strokeWidth={0} />{stopping ? "Stopping" : "Stop"}
                </button>
              </Tooltip>
            )}
            <button
              type="button"
              onClick={onSubmit}
              disabled={!can}
              aria-label={busy ? "Queue message" : "Send"}
              className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-25")}
            >
              <ArrowUp className="size-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
