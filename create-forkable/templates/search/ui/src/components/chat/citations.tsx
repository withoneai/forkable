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
  // one run of text: [n] markers become pills, ISO dates read the way the rest of the app writes them
  const inline = (s: string, key: string) => s.split(/(\[\d+\])/).map((part, i) => {
    const m = /^\[(\d+)\]$/.exec(part);
    const c = m ? byN.get(Number(m[1])) : undefined;
    if (m && c) return <CitationPill key={`${key}-${i}`} citation={c} onOpen={onOpen} />;
    if (m) return null; // an unknown marker is dropped, like the server does
    return <Fragment key={`${key}-${i}`}>{plainDates(part)}</Fragment>;
  });
  // paragraphs; inside one, lines that start with "- ", "* " or "1. " are a real list
  const blocks: { list: "ul" | "ol" | null; lines: string[] }[] = [];
  for (const para of text.split(/\n{2,}/)) {
    let prev: (typeof blocks)[number] | null = null;
    for (const line of para.split("\n")) {
      if (!line.trim()) continue;
      const kind = /^\s*[-*•]\s+/.test(line) ? "ul" : /^\s*\d+[.)]\s+/.test(line) ? "ol" : null;
      const body = kind ? line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "") : line;
      if (prev && prev.list === kind) prev.lines.push(body);
      else { prev = { list: kind, lines: [body] }; blocks.push(prev); }
    }
  }
  return (
    <div className={cn("flex flex-col gap-2 text-13 leading-relaxed", className)}>
      {blocks.map((b, bi) => b.list ? (
        b.list === "ul"
          ? <ul key={bi} className="flex list-disc flex-col gap-1 pl-5">{b.lines.map((l, li) => <li key={li} className="text-pretty">{inline(l, `${bi}-${li}`)}</li>)}</ul>
          : <ol key={bi} className="flex list-decimal flex-col gap-1 pl-5">{b.lines.map((l, li) => <li key={li} className="text-pretty">{inline(l, `${bi}-${li}`)}</li>)}</ol>
      ) : (
        <p key={bi} className="whitespace-pre-wrap text-pretty">{inline(b.lines.join("\n"), String(bi))}</p>
      ))}
    </div>
  );
}

/** "2026-11-11" (or a full timestamp) as the app writes a date elsewhere: "Nov 11", with the year when it is not this year. */
export function plainDates(s: string): string {
  return s.replace(/\b(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?\b/g, (whole, y: string, mo: string, d: string) => {
    const dt = new Date(Number(y), Number(mo) - 1, Number(d));
    if (Number.isNaN(dt.getTime()) || dt.getMonth() !== Number(mo) - 1) return whole;
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(dt.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  });
}

/** Who wrote this answer, in plain words ("Answered by Claude"); the exact engine and model go in `modelDetail`, for a tooltip. */
export function modelLabel(model: string): string {
  if (model === "extractive" || model === "fixture") return "Sample answer";
  const [engine, name = ""] = model.split(":");
  if (engine === "codex" || /^(gpt|o\d)/i.test(name)) return "Answered by Codex";
  if (engine === "claude-code" || engine === "anthropic" || /claude/i.test(model)) return "Answered by Claude";
  return model ? "Answered by the assistant" : "";
}
export function modelDetail(model: string): string {
  if (model === "fixture") return "A recorded answer that ships with the Acme sample";
  if (model === "extractive") return "Sample answer, no AI";
  const [engine, name] = model.split(":");
  const where = engine === "claude-code" ? "Claude Code on this computer" : engine === "codex" ? "Codex on this computer" : engine === "anthropic" ? "Claude through One" : engine;
  return name ? `${where}, model ${name}` : where ?? model;
}
