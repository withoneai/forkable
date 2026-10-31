// Numbered citation pills shared by the dock and the answer strip. Hover or
// focus shows the quoted span; a click selects the item in the results list
// and opens the preview at the quote, so the dock and the list are one workspace.
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { CornerDownLeft } from "lucide-react";
import type { Citation } from "@/contract/api-types";
import { freeText, parseQuery } from "@/contract/query";
import { useWorkspace } from "@/lib/workspace";
import { cn, fmtRelative, platformName } from "@/lib/utils";
import { SourceLogo } from "@/components/SourceLogo";

/** Opens a citation: back to the results page (query kept), select, preview at the quote. */
export function useOpenCitation() {
  const ws = useWorkspace();
  const nav = useNavigate();
  const loc = useLocation();
  return (c: Citation) => {
    if (loc.pathname !== "/") nav(ws.query ? `/?q=${encodeURIComponent(ws.query)}` : "/");
    ws.select(c.itemId, { quote: c.quote, open: true });
  };
}

function highlight(text: string, query: string): ReactNode {
  const words = freeText(parseQuery(query)).toLowerCase().replace(/"/g, "").split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return text;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>));
}

export function CitationPill({ citation, onOpen, active }: { citation: Citation; onOpen: (c: Citation) => void; active?: boolean }) {
  const ws = useWorkspace();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => { if (hideTimer.current) clearTimeout(hideTimer.current); setOpen(true); };
  const hide = () => { hideTimer.current = setTimeout(() => setOpen(false), 120); };
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  const rect = open ? ref.current?.getBoundingClientRect() : null;
  const W = 300;
  const left = rect ? Math.max(8, Math.min(rect.left - 12, window.innerWidth - W - 8)) : 0;
  const below = rect ? rect.bottom + 180 < window.innerHeight : true;

  return (
    <>
      <button
        ref={ref}
        type="button"
        data-citation={citation.n}
        aria-label={`Source ${citation.n}: ${citation.title}`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => { setOpen(false); onOpen(citation); }}
        className={cn(
          "tnum mx-0.5 inline-flex h-4 min-w-4 -translate-y-px items-center justify-center rounded-sm px-1 align-middle text-10 font-medium leading-none transition-colors",
          active || open ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-border-strong/60 hover:text-foreground",
        )}
      >
        {citation.n}
      </button>
      {open && rect && createPortal(
        <div
          role="tooltip"
          onMouseEnter={show}
          onMouseLeave={hide}
          style={{ left, width: W, ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }) }}
          className="pop-in fixed z-[60] flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-float"
        >
          <div className="flex items-center gap-1.5 text-11 text-muted-foreground">
            <SourceLogo platform={citation.platform} size={14} />
            <span>{platformName(citation.platform)}</span>
            <span aria-hidden>·</span>
            <span>{fmtRelative(citation.occurredAt)}</span>
            <span className="tnum ml-auto">[{citation.n}]</span>
          </div>
          <p className="text-13 font-medium leading-snug">{citation.title}</p>
          {citation.quote && <p className="border-l-2 border-border-strong pl-2 text-xs leading-relaxed text-muted-foreground">{highlight(citation.quote, ws.query)}</p>}
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(false); onOpen(citation); }} className="flex h-6 w-fit items-center gap-1.5 rounded-md px-1.5 text-11 font-medium text-foreground hover:bg-card-hover">
            <CornerDownLeft className="size-3" /> Open
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

/** Plain answer text with [n] markers turned into pills. Paragraphs on blank lines. */
export function CitedText({ text, citations, onOpen, className }: { text: string; citations: Citation[]; onOpen: (c: Citation) => void; className?: string }) {
  const byN = new Map(citations.map((c) => [c.n, c]));
  return (
    <div className={cn("flex flex-col gap-2 text-13 leading-relaxed", className)}>
      {text.split(/\n{2,}/).map((para, pi) => (
        <p key={pi} className="whitespace-pre-wrap text-pretty">
          {para.split(/(\[\d+\])/).map((part, i) => {
            const m = /^\[(\d+)\]$/.exec(part);
            const c = m ? byN.get(Number(m[1])) : undefined;
            if (m && c) return <CitationPill key={i} citation={c} onOpen={onOpen} />;
            if (m) return null; // an unknown marker is dropped, like the server does
            return <Fragment key={i}>{part}</Fragment>;
          })}
        </p>
      ))}
    </div>
  );
}

/** "Sample answer, replayed" and friends: who wrote this answer. */
export function modelLabel(model: string): string {
  if (model === "extractive") return "Sample answer, no model";
  if (model === "fixture") return "Sample answer, replayed";
  return `Answered by ${model}`;
}
