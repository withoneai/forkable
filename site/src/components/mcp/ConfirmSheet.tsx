import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import clsx from "clsx";
import { ArrowUp, ShieldCheck } from "lucide-react";
import { Glyph } from "../Glyph";
import { LOGOS } from "./logos";
import type { ConfirmRequest } from "../../flows/host";

// The connector's Confirm, as the blocks MCP canvas draws it. It belongs to
// the trusted shell around the generated UI, not to the UI: the server
// writes the summary from the request itself, the shell shows it, and a
// one-time token bound to the user, the UI, the action and its input runs
// that exact request once. So it docks to the chat window's own frame, below
// and outside the generated UI, and says so.

type Pending = ConfirmRequest & { resolve: (ok: boolean) => void };

export function ConfirmSheet({ c, className, interactive = true }: { c: Pending; className?: string; interactive?: boolean }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!interactive) return;
    cancelRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && c.resolve(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [c, interactive]);
  const trap = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const f = [...e.currentTarget.querySelectorAll<HTMLElement>("button")];
    const i = f.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length]?.focus();
  };
  const platform = LOGOS[c.platform]?.name ?? c.platform;
  return (
    <div
      onKeyDown={interactive ? trap : undefined}
      role={interactive ? "dialog" : undefined}
      aria-modal={interactive ? true : undefined}
      aria-labelledby={interactive ? "mcp-confirm-title" : undefined}
      className={clsx("confirm-sheet @container relative flex max-h-full flex-col overflow-hidden rounded-t-xl border-x border-t border-foreground/20 bg-card shadow-[0_-24px_60px_-30px_rgb(0_0_0/0.5)]", className)}
    >
      {/* Whose dialog this is: the connector's frame, not the agent's UI. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-foreground/[0.03] px-4 py-2">
        <Glyph id="F6" className="size-3 shrink-0 text-accent-fg" />
        <span className="whitespace-nowrap text-11 font-medium text-foreground">Forkable blocks<span className="hidden @md:inline"> connector</span></span>
        <span className="flex-1" />
        <span className="truncate text-11 text-muted-foreground"><span className="hidden @lg:inline">From the connector, not</span><span className="@lg:hidden">Not</span> the generated UI</span>
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="squircle grid size-8 shrink-0 place-items-center rounded-lg bg-accent-fill text-accent-ink">
            <ShieldCheck className="size-4" strokeWidth={2} />
          </span>
          <div className="flex min-w-0 flex-col">
            <span id={interactive ? "mcp-confirm-title" : undefined} className="text-15 font-semibold">{c.headline}</span>
            <span className="text-11 text-muted-foreground">On your {platform} account. Only this exact request runs, once.</span>
          </div>
        </div>
        {c.fields.length > 0 && (
          <dl className="m-0 flex flex-col rounded-lg border border-border bg-background/60">
            {c.fields.map((f, i) => (
              <div key={i} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 border-b border-border px-3 py-1.5 last:border-b-0">
                <dt className="pt-px text-11 text-muted-foreground">{f.label}</dt>
                <dd className="m-0 line-clamp-2 whitespace-pre-line break-words text-13">{f.value.replace(/\n{2,}/g, "\n")}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
        <span className="mr-auto w-full text-11 text-muted-foreground @md:w-auto">The agent's code can't press this.</span>
        <button
          ref={cancelRef}
          type="button"
          tabIndex={interactive ? undefined : -1}
          onClick={() => c.resolve(false)}
          className="rounded-md border border-border px-3 py-1.5 text-13 font-medium transition-colors hover:border-foreground/30"
        >
          Cancel
        </button>
        <button
          type="button"
          tabIndex={interactive ? undefined : -1}
          onClick={() => c.resolve(true)}
          className="rounded-md bg-accent-fill px-3 py-1.5 text-13 font-medium text-accent-ink transition-transform active:scale-[0.97]"
        >
          Confirm
        </button>
      </div>
    </div>
  );
}

// Laid over a chat window: the chat dims, the sheet docks to the window's
// bottom edge, full width, so it reads as part of the frame.
export function ConfirmLayer({ c }: { c: Pending }) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end bg-background/35 px-2 pt-6 sm:px-3">
      <span className="sheet-in mb-2 ml-1 inline-flex w-max items-center gap-1.5 rounded-md border border-dashed border-foreground/40 bg-card px-2 py-0.5 text-11 text-muted-foreground">
        <ArrowUp className="size-3" strokeWidth={2} />
        Generated UI, paused
      </span>
      <ConfirmSheet c={c} className="sheet-in max-h-[80%]" />
    </div>
  );
}
