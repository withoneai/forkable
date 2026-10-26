import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus, X } from "lucide-react";
import type { ChatContextInput } from "@rill/core/api-types";
import type { ChatBlocks } from "@rill/core/types";
import type { Lane } from "@rill/core/types";
import {
  keys, useChat, useChats, useCreateChat, useEngines, useGoals, useInbox, useThread, useVips,
} from "@/lib/queries";
import { streamChatMessage } from "@/lib/chatStream";
import { toast } from "@/lib/toast";
import { cn, LANE_LABEL, TIER_LABEL } from "@/lib/utils";
import type { ChatRouteContext } from "@/lib/chatPanel";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { IconButton } from "@/components/ui/IconButton";
import { Menu } from "@/components/ui/Menu";
import { Composer } from "./Composer";
import type { EngineChoice } from "./ModelPicker";
import { MessageList } from "./Messages";

const MIN_WIDTH = 280;
const MAX_WIDTH = 420;

function engineStorageKey(mailboxId: string) { return `rill.chat.engine.${mailboxId}`; }
function readEngine(mailboxId: string): EngineChoice | null {
  try {
    const raw = localStorage.getItem(engineStorageKey(mailboxId));
    return raw ? (JSON.parse(raw) as EngineChoice) : null;
  } catch {
    return null;
  }
}

export function ChatPanel({ mailboxId, width, onWidthChange, onClose, route, focusRef, overlay = false }: {
  overlay?: boolean;
  mailboxId: string;
  width: number;
  onWidthChange: (w: number) => void;
  onClose: () => void;
  route: ChatRouteContext;
  focusRef: React.RefObject<(() => void) | null>;
}) {
  const nav = useNavigate();
  const qc = useQueryClient();

  const chatsQ = useChats(mailboxId);
  const [chatId, setChatId] = useState<string | null>(() => {
    try { return localStorage.getItem(`rill.chat.current.${mailboxId}`); } catch { return null; }
  });
  const pickChat = (id: string | null) => {
    setChatId(id);
    try { if (id) localStorage.setItem(`rill.chat.current.${mailboxId}`, id); else localStorage.removeItem(`rill.chat.current.${mailboxId}`); } catch { /* ignore */ }
  };
  const createChat = useCreateChat(mailboxId);
  useEffect(() => {
    if (!chatsQ.data) return;
    if (chatId && chatsQ.data.some((c) => c.id === chatId)) return;
    if (chatsQ.data.length > 0) { pickChat(chatsQ.data[0]!.id); return; }
    if (!createChat.isPending) createChat.mutate(undefined, { onSuccess: (c) => pickChat(c.id) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatsQ.data, chatId]);
  const chatQ = useChat(mailboxId, chatId);

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [dropped, setDropped] = useState(false);
  const routeKey = route.kind === "thread" ? route.threadId : route.lane;
  useEffect(() => setDropped(false), [routeKey]);
  const effectiveRoute: ChatRouteContext = dropped
    ? { kind: "lane", lane: ((sessionStorage.getItem("rill.lane") as Lane | null) ?? "vip") }
    : route;

  const threadQ = useThread(mailboxId, effectiveRoute.kind === "thread" ? effectiveRoute.threadId : null);
  const inboxQ = useInbox(mailboxId, effectiveRoute.kind === "lane" ? effectiveRoute.lane : "vip");
  const goalsQ = useGoals(mailboxId);
  const vipsQ = useVips(mailboxId);

  const contextInput = useMemo<ChatContextInput>(() => {
    const goals = (goalsQ.data ?? []).filter((g) => !g.paused).map((g) => ({ id: g.id, title: g.title }));
    const vips = (vipsQ.data ?? []).map((v) => ({ id: v.id, name: v.name }));
    if (effectiveRoute.kind === "thread") {
      const d = threadQ.data;
      if (!d) return { route: effectiveRoute, goals, vips };
      return {
        route: effectiveRoute,
        goals,
        vips,
        thread: {
          subject: d.thread.subject,
          participants: d.thread.participants,
          messages: d.messages.slice(-6).map((m) => ({ from: m.isFromMe ? "me" : `${m.from.name} <${m.from.email}>`, date: m.date, body: m.body })),
          why: d.why,
          draft: d.draft && d.draft.status !== "sent" && d.draft.status !== "discarded" ? d.draft.body : null,
        },
      };
    }
    const rows = inboxQ.data?.rows ?? [];
    return {
      route: effectiveRoute,
      goals,
      vips,
      laneRows: rows.slice(0, 20).map((r) => ({ threadId: r.threadId, subject: r.subject, from: r.from.name || r.from.email, summary: r.summary })),
    };
  }, [effectiveRoute, threadQ.data, inboxQ.data, goalsQ.data, vipsQ.data]);

  const [value, setValue] = useState("");
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [streaming, setStreaming] = useState<{ text: string; blocks: ChatBlocks } | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [engineValue, setEngineValueState] = useState<EngineChoice | null>(() => readEngine(mailboxId));
  const setEngineValue = (v: EngineChoice | null) => {
    setEngineValueState(v);
    try { if (v) localStorage.setItem(engineStorageKey(mailboxId), JSON.stringify(v)); else localStorage.removeItem(engineStorageKey(mailboxId)); } catch { /* ignore */ }
  };
  const enginesQ = useEngines();

  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [chatQ.data?.messages.length, streaming?.text, pendingUser]);

  const send = (text: string) => {
    const content = text.trim();
    if (!content || isStreaming || !chatId) return;
    setValue("");
    setPendingUser(content);
    setStreaming({ text: "", blocks: {} });
    setIsStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    void streamChatMessage(
      mailboxId,
      chatId,
      { content, context: contextInput, engine: engineValue ?? undefined },
      (ev) => {
        if (ev.type === "delta") {
          setStreaming((s) => (s ? { ...s, text: s.text + ev.text } : s));
        } else if (ev.type === "blocks") {
          setStreaming((s) => (s ? { ...s, blocks: { proposals: ev.proposals, citations: ev.citations } } : s));
        } else if (ev.type === "done") {
          setIsStreaming(false);
          setPendingUser(null);
          setStreaming(null);
          qc.invalidateQueries({ queryKey: keys.chat(mailboxId, chatId) });
          qc.invalidateQueries({ queryKey: keys.chats(mailboxId) });
        } else if (ev.type === "error") {
          setIsStreaming(false);
          setStreaming(null);
          toast({ title: "The assistant didn't answer", detail: ev.message, tone: "destructive" });
        }
      },
      controller.signal,
    );
  };
  const stop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
  };

  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: e.clientX, startWidth: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    onWidthChange(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(d.startWidth + (d.startX - e.clientX)))));
  };
  const onHandleUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <aside
      style={overlay ? undefined : { width }}
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden border-l border-border bg-card",
        overlay ? "slide-in-right fixed inset-y-0 right-0 z-40 w-full max-w-[420px] shadow-float" : "relative",
      )}
      aria-label="Inbox assistant"
    >
      {!overlay && (
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize the assistant"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={width}
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
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
          open={switcherOpen}
          onClose={() => setSwitcherOpen(false)}
          items={(chatsQ.data ?? []).map((c) => ({ key: c.id, label: c.title, onSelect: () => pickChat(c.id) }))}
          anchor={
            <button
              type="button"
              onClick={() => setSwitcherOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={switcherOpen}
              className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 text-left text-13 font-medium transition-colors hover:bg-card-hover"
            >
              <span className="min-w-0 flex-1 truncate">{chatQ.data?.chat.title ?? "Assistant"}</span>
              <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
            </button>
          }
        />
        <IconButton label="New chat" size="sm" onClick={() => createChat.mutate(undefined, { onSuccess: (c) => pickChat(c.id) })}><Plus /></IconButton>
        <IconButton label="Close panel" hint="⌘J" size="sm" onClick={onClose}><X /></IconButton>
      </div>

      {effectiveRoute.kind === "thread" && threadQ.data && (
        <div className="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
          <Avatar name={threadQ.data.person.name} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{threadQ.data.person.name}</p>
            <p className="truncate text-11 text-muted-foreground">{threadQ.data.person.email}</p>
          </div>
          {threadQ.data.person.vip ? <Badge>VIP · {TIER_LABEL[threadQ.data.person.vip.tier]}</Badge> : <Badge tone="outline">Not a VIP</Badge>}
        </div>
      )}

      <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-11 text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {effectiveRoute.kind === "thread"
            ? `Reading this thread: ${threadQ.data?.thread.subject ?? "…"}`
            : `Reading ${LANE_LABEL[effectiveRoute.lane]}${inboxQ.data ? `, first ${Math.min(20, inboxQ.data.rows.length)} threads` : ""}`}
        </span>
        {route.kind === "thread" && !dropped && (
          <button
            type="button"
            onClick={() => setDropped(true)}
            aria-label="Stop using this thread as context"
            title="Stop using this thread. Answers then use the current lane."
            className={cn("shrink-0 rounded p-0.5 transition-colors hover:bg-card-hover hover:text-foreground")}
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto">
        {chatQ.isPending ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading…</div>
        ) : (
          <MessageList
            messages={chatQ.data?.messages ?? []}
            pendingUser={pendingUser}
            streaming={streaming}
            mailboxId={mailboxId}
            onSendMessage={send}
            onOpenThread={(threadId) => nav(`/thread/${threadId}`)}
          />
        )}
      </div>

      <Composer
        value={value}
        onChange={setValue}
        onSubmit={() => send(value)}
        canSend={value.trim().length > 0 && !!chatId}
        isStreaming={isStreaming}
        onStop={stop}
        engineValue={engineValue}
        onEngineChange={setEngineValue}
        engineOptions={enginesQ.data?.options ?? []}
        enginesCurrent={enginesQ.data?.current ?? null}
        focusRef={focusRef}
      />
    </aside>
  );
}
