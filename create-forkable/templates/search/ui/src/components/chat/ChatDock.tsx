// The assistant dock (SPEC 14, search-ux-mobbin.md 2.6). Grounded only in what
// Search returned: it reads the page's query and results, cites every claim
// with numbered pills that select the item in the list, and proposes better
// queries the user applies with a keypress. Streams steps over SSE (CONTRACT 7.1).
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, CornerDownRight, ExternalLink, Plus, X } from "lucide-react";
import type { ChatContext, ChatMessage, Citation, ResultRow } from "@/contract/api-types";
import { api } from "@/lib/api";
import { streamChat } from "@/lib/chatStream";
import { keys, useChats } from "@/lib/queries";
import { useWorkspace } from "@/lib/workspace";
import { cn, fmtRelative, MOD, platformName } from "@/lib/utils";
import { IconButton } from "@/components/ui/IconButton";
import { Menu } from "@/components/ui/Menu";
import { SourceLogo } from "@/components/SourceLogo";
import { useOpenCitation } from "./citations";
import { AssistantTurn, UserBubble, type Turn } from "./Messages";
import { Composer, type ContextChip } from "./Composer";

const MIN_WIDTH = 280;
const MAX_WIDTH = 420;
const CURRENT = "search.chat.current";

function readCurrent(): string | null { try { return localStorage.getItem(CURRENT); } catch { return null; } }
function writeCurrent(id: string | null) { try { if (id) localStorage.setItem(CURRENT, id); else localStorage.removeItem(CURRENT); } catch { /* ignore */ } }

/** Stored messages as question + answer pairs. */
function toTurns(messages: ChatMessage[]): { question: string; turn: Turn }[] {
  const out: { question: string; turn: Turn }[] = [];
  let q = "";
  for (const m of messages) {
    if (m.role === "user") { q = m.content; continue; }
    out.push({
      question: q,
      turn: {
        id: m.id, question: q, steps: m.steps, read: m.steps.reduce((n, s) => n + (s.query ? 0 : s.count ?? 0), 0) || m.citations.length,
        text: m.content, citations: m.citations, grounded: m.grounded, model: m.model, proposal: m.proposal, error: null, streaming: false,
      },
    });
    q = "";
  }
  return out;
}

export function ChatDock({ overlay = false, width, onWidthChange, onClose }: { overlay?: boolean; width: number; onWidthChange: (w: number) => void; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const openCitation = useOpenCitation();
  const chatsQ = useChats();
  const [chatId, setChatId] = useState<string | null>(readCurrent);
  const pickChat = (id: string | null) => { setChatId(id); writeCurrent(id); };
  const chatQ = useQuery({ queryKey: keys.chat(chatId ?? ""), queryFn: () => api.chat(chatId!), enabled: !!chatId, retry: false });
  useEffect(() => { if (chatQ.isError) pickChat(null); }, [chatQ.isError]);

  const [tab, setTab] = useState<"chat" | "sources">("chat");
  const [menu, setMenu] = useState(false);
  const [value, setValue] = useState("");
  const [live, setLive] = useState<Turn | null>(null);
  const [liveFollowups, setLiveFollowups] = useState<string[] | null>(null);
  const [needsModel, setNeedsModel] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [detached, setDetached] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => { setDetached(false); }, [ws.query]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const stored = useMemo(() => (chatId ? toTurns(chatQ.data?.messages ?? []) : []), [chatId, chatQ.data]);
  const turns = live ? [...stored, { question: live.question, turn: live }] : stored;
  const lastTurn = turns[turns.length - 1]?.turn ?? null;
  const followups = live ? liveFollowups ?? [] : (chatQ.data?.messages.filter((m) => m.role === "assistant").at(-1)?.followups ?? []);
  const streaming = !!live?.streaming;

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [turns.length, live?.text, live?.steps.length]);

  const results = ws.results;
  const context = (): ChatContext => {
    if (detached) return ws.dockPins.length ? { itemIds: ws.dockPins.map((r) => r.id) } : {};
    return {
      query: ws.query || undefined,
      queryId: results?.queryId,
      itemIds: ws.dockPins.length ? ws.dockPins.map((r) => r.id) : results?.results.slice(0, 12).map((r) => r.id),
      selectedItemId: ws.selectedId ?? undefined,
    };
  };

  const send = (text: string, override?: ChatContext) => {
    const message = text.trim();
    if (!message || streaming) return;
    setValue("");
    setTab("chat");
    setNeedsModel(null);
    setLiveFollowups(null);
    const turn: Turn = { id: "live", question: message, steps: [], read: 0, text: null, citations: [], grounded: true, model: "", proposal: null, error: null, streaming: true };
    setLive(turn);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let id = chatId;
    let acc = turn;
    let followupsAcc: string[] = [];
    const update = (patch: Partial<Turn>) => { acc = { ...acc, ...patch }; setLive(acc); };
    void streamChat({ chatId: chatId ?? undefined, message, context: override ?? context() }, (ev) => {
      switch (ev.type) {
        case "chat":
          id = ev.chatId;
          acc = { ...acc, id: ev.messageId };
          if (ev.chatId !== chatId) { setChatId(ev.chatId); writeCurrent(ev.chatId); }
          break;
        case "step": {
          const i = acc.steps.findIndex((s) => s.id === ev.step.id);
          update({ steps: i >= 0 ? acc.steps.map((s, j) => (j === i ? ev.step : s)) : [...acc.steps, ev.step] });
          break;
        }
        case "results": update({ read: acc.read + ev.items.length }); break;
        case "answer": update({ text: ev.text, citations: ev.citations, grounded: ev.grounded, model: ev.model }); break;
        case "proposal": update({ proposal: ev.proposal }); break;
        case "followups": followupsAcc = ev.items; setLiveFollowups(ev.items); break;
        case "error":
          if (ev.error.code === "model_unavailable") setNeedsModel(ev.error.message);
          update({ error: ev.error.message, streaming: false });
          break;
        case "done": {
          const finished = { ...acc, streaming: false };
          if (id && !finished.error) {
            const now = new Date().toISOString();
            qc.setQueryData(keys.chat(id), (old: { id: string; title: string; messages: ChatMessage[] } | undefined) => ({
              id: id!, title: old?.title ?? message,
              messages: [...(old?.messages ?? []),
                { id: `${finished.id}_q`, role: "user", content: message, citations: [], steps: [], proposal: null, followups: [], grounded: true, model: "", createdAt: now },
                { id: finished.id, role: "assistant", content: finished.text ?? "", citations: finished.citations, steps: finished.steps, proposal: finished.proposal, followups: followupsAcc, grounded: finished.grounded, model: finished.model, createdAt: now },
              ],
            }));
            setLive(null);
            void qc.invalidateQueries({ queryKey: keys.chats });
          } else {
            setLive(finished);
          }
          break;
        }
      }
    }, ctrl.signal);
  };
  const stop = () => { abortRef.current?.abort(); setLive((t) => (t ? { ...t, streaming: false, error: t.text ? null : "Stopped." } : t)); };

  // A question handed over by the page (Tab in the box, "Continue in chat", Cmd+Enter).
  useEffect(() => {
    if (!ws.pendingQuestion) return;
    const q = ws.takePendingQuestion();
    if (q) send(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.pendingQuestion]);

  // Alt+1..9 opens citation n of the latest answer. e.code, since Option+digit types a symbol on a Mac.
  const latestCitations = lastTurn?.citations ?? [];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      const m = /^Digit([1-9])$/.exec(e.code);
      if (!m || document.querySelector('[aria-modal="true"]')) return;
      const c = latestCitations.find((x) => x.n === Number(m[1]));
      if (!c) return;
      e.preventDefault();
      openCitation(c);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const applyLatest = (): boolean => {
    const t = lastTurn;
    if (!t?.proposal || applied.has(t.id)) return false;
    ws.setQuery(t.proposal.query);
    setApplied((s) => new Set(s).add(t.id));
    return true;
  };

  const allCitations = useMemo(() => {
    const seen = new Map<string, Citation>();
    for (const { turn } of turns) for (const c of turn.citations) if (!seen.has(c.itemId)) seen.set(c.itemId, c);
    return [...seen.values()];
  }, [turns]);

  // Context chips: the page's query (detachable) and any pinned items.
  const chips: ContextChip[] = [
    ...(!detached && ws.query ? [{ key: "q", label: ws.query, mono: true, onRemove: () => setDetached(true) }] : []),
    ...ws.dockPins.map((r) => ({ key: r.id, label: r.title, platform: r.platform, onRemove: () => ws.setDockPins(ws.dockPins.filter((p) => p.id !== r.id)) })),
  ];

  const suggestions = suggestionsFor(detached ? null : results?.results ?? null, ws.query);

  // Resize handle, Rill's separator.
  const drag = useRef<{ x: number; w: number } | null>(null);

  return (
    <aside
      style={overlay ? undefined : { width }}
      className={cn("flex h-full shrink-0 flex-col overflow-hidden border-l border-border bg-card", overlay ? "slide-in-right fixed inset-y-0 right-0 z-40 w-full max-w-[420px] shadow-float" : "relative")}
      aria-label="Assistant"
      data-testid="dock"
    >
      {!overlay && (
        <div
          role="separator" tabIndex={0} aria-orientation="vertical" aria-label="Resize the assistant" aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={width}
          onPointerDown={(e) => { drag.current = { x: e.clientX, w: width }; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { const d = drag.current; if (d) onWidthChange(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(d.w + (d.x - e.clientX))))); }}
          onPointerUp={(e) => { drag.current = null; e.currentTarget.releasePointerCapture(e.pointerId); }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 40 : 16;
            if (e.key === "ArrowLeft") { e.preventDefault(); onWidthChange(Math.min(MAX_WIDTH, width + step)); }
            else if (e.key === "ArrowRight") { e.preventDefault(); onWidthChange(Math.max(MIN_WIDTH, width - step)); }
          }}
          className="group absolute inset-y-0 left-0 z-10 w-2 -translate-x-1/2 cursor-col-resize touch-none outline-none"
        >
          <div className="mx-auto h-full w-[2px] bg-transparent transition-colors group-hover:bg-foreground/20 group-focus-visible:bg-ring group-active:bg-foreground/30" />
        </div>
      )}

      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        <Menu
          open={menu}
          onClose={() => setMenu(false)}
          className="w-[240px]"
          items={[
            { key: "new", label: "New chat", onSelect: () => { pickChat(null); setLive(null); } },
            ...(chatsQ.data ?? []).map((c) => ({ key: c.id, label: c.title, hint: fmtRelative(c.updatedAt), onSelect: () => { setLive(null); pickChat(c.id); } })),
          ]}
          anchor={
            <button type="button" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu}
              className="flex h-7 min-w-0 max-w-[150px] items-center gap-1 rounded-md px-1.5 text-left text-13 font-medium transition-colors hover:bg-card-hover">
              <span className="min-w-0 flex-1 truncate">{chatQ.data?.title ?? (live ? live.question : "Assistant")}</span>
              <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
            </button>
          }
        />
        <div role="tablist" aria-label="Assistant view" className="ml-auto flex h-6 items-center rounded-md bg-muted p-0.5">
          {(["chat", "sources"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={cn("flex h-5 items-center gap-1 rounded-sm px-2 text-11 font-medium transition-colors", tab === t ? "bg-card text-foreground shadow-[0_1px_1px_rgb(0_0_0/0.06)]" : "text-muted-foreground hover:text-foreground")}>
              {t === "chat" ? "Chat" : "Sources"}
              {t === "sources" && allCitations.length > 0 && <span className="tnum text-muted-foreground">{allCitations.length}</span>}
            </button>
          ))}
        </div>
        <IconButton label="New chat" size="sm" onClick={() => { pickChat(null); setLive(null); }}><Plus /></IconButton>
        <IconButton label="Close the assistant" hint={`${MOD}J`} size="sm" onClick={onClose}><X /></IconButton>
      </div>

      <div className="flex min-h-7 shrink-0 items-center gap-1.5 border-b border-border px-3 py-1.5 text-11 text-muted-foreground" data-testid="dock-context">
        {!detached && ws.query ? (
          <>
            <span className="shrink-0">Looking at</span>
            <code className="min-w-0 truncate rounded-sm bg-muted px-1 font-mono text-foreground">{ws.query}</code>
            {results && <span className="tnum shrink-0">· {results.total} {results.total === 1 ? "result" : "results"}</span>}
            <button type="button" onClick={() => setDetached(true)} aria-label="Stop using this search as context" title="Answer without the page's search" className="ml-auto shrink-0 rounded p-0.5 transition-colors hover:bg-card-hover hover:text-foreground">
              <X className="size-3" />
            </button>
          </>
        ) : (
          <span className="truncate">{ws.dockPins.length ? `Looking at ${ws.dockPins.length} pinned ${ws.dockPins.length === 1 ? "item" : "items"}` : "Searching everything you connected"}</span>
        )}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        {tab === "sources" ? (
          <SourcesList citations={allCitations} onOpen={openCitation} />
        ) : needsModel ? (
          <NeedsModel message={needsModel} />
        ) : turns.length === 0 ? (
          <div className="flex h-full flex-col justify-end gap-3 px-3 pb-3">
            <div className="flex flex-col gap-1 px-1">
              <p className="text-13 font-medium">Ask about {ws.query && !detached ? "these results" : "anything you connected"}</p>
              <p className="text-xs text-muted-foreground">Answers cite the items they come from. A better search shows up as a proposal you apply.</p>
            </div>
            <div className="flex flex-col">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="flex min-h-8 items-center gap-2 rounded-md px-1.5 py-1 text-left text-13 transition-colors hover:bg-card-hover">
                  <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />
                  <span>{s}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5 px-3 py-3">
            {turns.map(({ question, turn }) => (
              <div key={turn.id} className="flex flex-col gap-3">
                {question && <UserBubble text={question} />}
                <AssistantTurn
                  turn={turn}
                  onOpen={openCitation}
                  onSearchInChat={(q) => send(`Search for: ${q}`, { query: q })}
                  onShowSources={() => setTab("sources")}
                  applied={applied.has(turn.id)}
                  onApplied={() => setApplied((s) => new Set(s).add(turn.id))}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {tab === "chat" && followups.length > 0 && !streaming && (
        <div className="flex shrink-0 flex-col border-t border-border px-2 py-1.5" aria-label="Follow-up questions">
          {followups.slice(0, 3).map((f) => (
            <button key={f} type="button" onClick={() => send(f)} className="flex h-7 items-center gap-2 rounded-md px-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground">
              <CornerDownRight className="size-3 shrink-0" /><span className="truncate">{f}</span>
            </button>
          ))}
        </div>
      )}

      <Composer
        value={value}
        onChange={setValue}
        onSubmit={() => send(value)}
        onApply={applyLatest}
        canSend={value.trim().length > 0}
        isStreaming={streaming}
        onStop={stop}
        chips={chips}
        focusRef={ws.composerFocus}
        onEscape={() => ws.boxFocus.current?.()}
      />
    </aside>
  );
}

/** Three questions built from what is on the page. */
function suggestionsFor(rows: ResultRow[] | null, query: string): string[] {
  if (!rows || rows.length === 0) return ["Where are we with Globex?", "What is blocking the Initech pilot?", "What needs a reply from me this week?"];
  const out: string[] = [`Summarize what these ${rows.length} results say`];
  const person = rows.flatMap((r) => r.people).find((p) => p.entityId !== "ent_dana" && p.role !== "to");
  if (person) out.push(`What did ${person.name.split(" ")[0]} ask for most recently?`);
  if (rows.some((r) => r.kind === "deal")) out.push("Which of these deals close this month?");
  else if (rows.some((r) => r.kind === "event" || r.kind === "meeting_note")) out.push("What was decided in these meetings?");
  else if (query) out.push(`What is still open about ${query.replace(/\w+:\S+/g, "").trim() || "this"}?`);
  return out.slice(0, 3);
}

function SourcesList({ citations, onOpen }: { citations: Citation[]; onOpen: (c: Citation) => void }) {
  if (!citations.length) {
    return <p className="px-4 py-10 text-center text-xs text-muted-foreground">Every item the assistant cites in this chat shows up here.</p>;
  }
  return (
    <ul className="flex flex-col p-1.5" data-testid="dock-sources">
      {citations.map((c) => (
        <li key={c.itemId}>
          <button type="button" onClick={() => onOpen(c)} className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-card-hover">
            <SourceLogo platform={c.platform} size={16} className="mt-0.5" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-13 font-medium">{c.title}</span>
              <span className="truncate text-11 text-muted-foreground">{platformName(c.platform)} · {fmtRelative(c.occurredAt)}</span>
              {c.quote && <span className="line-clamp-2 text-xs text-muted-foreground">“{c.quote}”</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The server says what is missing: locally Claude Code or Codex would do, hosted it is Anthropic in the grant. */
function NeedsModel({ message }: { message: string }) {
  const local = /Claude Code|Codex/.test(message);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center" role="alert">
      <SourceLogo platform="anthropic" size={24} />
      <p className="text-13 font-medium">{message}</p>
      <p className="text-xs text-muted-foreground">{local ? "Install Claude Code or Codex and sign in to it, or add Anthropic in One, then ask again. Search itself keeps working." : "Search runs the assistant on your own One connection. Add Anthropic, then ask again. Search itself keeps working."}</p>
      <a href="https://app.withone.ai" target="_blank" rel="noreferrer" className="mt-1 inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium transition-colors hover:border-border-strong hover:bg-card-hover">
        Add in One <ExternalLink className="size-3" />
      </a>
    </div>
  );
}

