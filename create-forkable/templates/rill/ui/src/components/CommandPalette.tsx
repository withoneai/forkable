import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Calendar as CalendarIcon, CornerDownLeft, Moon, Plus, Receipt, ShieldCheck, Sun, MessageCircleQuestion, Keyboard, Video } from "lucide-react";
import type { AskResponse } from "@rill/core/api-types";
import { LANES } from "@rill/core/types";
import { useMailbox } from "@/lib/mailbox";
import { useAsk, useBrief, usePalette } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn, fmtRelative, LANE_KEY, LANE_LABEL, MOD, TIER_LABEL } from "@/lib/utils";
import { Avatar } from "./ui/Avatar";
import { Badge } from "./ui/Badge";
import { Keys } from "./ui/Kbd";
import { Spinner } from "./ui/Button";

interface Item { id: string; group: "Actions" | "Contacts" | "Threads" | "Ask"; label: string; detail?: string; icon?: React.ReactNode; keys?: string; run: () => void; avatar?: string }

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export function CommandPalette({ open, onClose, onToggleTheme, onCheatsheet }: { open: boolean; onClose: () => void; onToggleTheme: () => void; onCheatsheet: () => void }) {
  const nav = useNavigate();
  const { mailboxId } = useMailbox();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const dq = useDebounced(q, 120);
  const isAsk = /^ask:/i.test(q.trim()) || (/\?\s*$/.test(q.trim()) && q.trim().length > 8);
  const askText = q.trim().replace(/^ask:\s*/i, "");
  const pal = usePalette(mailboxId ?? "", dq, open && !!mailboxId && dq.length > 0 && !isAsk);
  const ask = useAsk(mailboxId ?? "");
  const brief = useBrief(mailboxId ?? "");
  const nextJoinUrl = brief.data?.today.meetings.find((m) => m.joinUrl && new Date(m.end).getTime() > Date.now())?.joinUrl ?? null;

  useEffect(() => {
    if (open) { setQ(""); setI(0); setAnswer(null); setTimeout(() => input.current?.focus(), 0); }
  }, [open]);
  useEffect(() => { setI(0); }, [dq]);

  const items = useMemo<Item[]>(() => {
    const ql = q.trim().toLowerCase();
    const actions: Item[] = [
      { id: "snooze-receipts", group: "Actions", label: "Snooze all receipts", detail: "Until tomorrow", icon: <Receipt />, run: () => toast({ title: "Snoozed 3 receipts", detail: "until tomorrow 8:00" }) },
      ...LANES.map((lane) => ({ id: `lane-${lane}`, group: "Actions" as const, label: `Go to ${LANE_LABEL[lane]}`, keys: `G ${LANE_KEY[lane]}`, icon: <ArrowRight />, run: () => nav(`/inbox/${lane}`) })),
      { id: "brief", group: "Actions", label: "Open brief", keys: "G B", icon: <Sun />, run: () => nav("/brief") },
      { id: "calendar", group: "Actions", label: "Show calendar", keys: "G C", icon: <CalendarIcon />, run: () => nav("/calendar") },
      { id: "new-event", group: "Actions", label: "New event", icon: <Plus />, run: () => nav("/calendar?create=1") },
      { id: "today", group: "Actions", label: "Go to today", icon: <CalendarIcon />, run: () => nav("/calendar") },
      ...(nextJoinUrl ? [{ id: "join-next", group: "Actions" as const, label: "Join next meeting", icon: <Video />, run: () => window.open(nextJoinUrl, "_blank") }] : []),
      { id: "access", group: "Actions", label: "Open access", keys: "G A", icon: <ShieldCheck />, run: () => nav("/access") },
      { id: "theme", group: "Actions", label: "Toggle dark mode", icon: <Moon />, run: onToggleTheme },
      { id: "keys", group: "Actions", label: "Keyboard shortcuts", keys: "?", icon: <Keyboard />, run: onCheatsheet },
    ];
    const out: Item[] = [];
    if (isAsk && askText) {
      out.push({ id: "ask", group: "Ask", label: `Ask your inbox: ${askText}`, icon: <MessageCircleQuestion />, keys: "Enter", run: () => { ask.mutate(askText, { onSuccess: setAnswer }); } });
      return out;
    }
    out.push(...actions.filter((a) => !ql || a.label.toLowerCase().includes(ql)));
    for (const c of pal.data?.contacts ?? []) {
      out.push({ id: `c-${c.email}`, group: "Contacts", label: c.name, detail: c.vip ? TIER_LABEL[c.vip] : c.email, avatar: c.name, run: () => { setQ(c.name.split(" ")[0]!); } });
    }
    for (const t of pal.data?.threads ?? []) {
      out.push({ id: `t-${t.threadId}`, group: "Threads", label: t.subject, detail: `${t.from} · ${LANE_LABEL[t.lane]} · ${fmtRelative(t.lastMessageAt)}`, run: () => nav(`/thread/${t.threadId}`) });
    }
    if (ql && ql.length > 3) out.push({ id: "ask-any", group: "Ask", label: `Ask your inbox: ${q.trim()}`, icon: <MessageCircleQuestion />, run: () => { ask.mutate(q.trim(), { onSuccess: setAnswer }); } });
    return out;
  }, [q, isAsk, askText, pal.data, nav, onToggleTheme, onCheatsheet, ask, nextJoinUrl]);

  if (!open) return null;
  const groups = ["Ask", "Actions", "Contacts", "Threads"] as const;
  const sel = items[i];

  return (
    <div className="fade-in fixed inset-0 z-50 flex items-start justify-center bg-foreground/15 px-4 pt-[10vh] dark:bg-background/70" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="pop-in w-full max-w-[600px] overflow-hidden rounded-xl border border-border bg-card shadow-float">
        <div className="flex h-12 items-center gap-2 border-b border-border px-4">
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type a command, a name, or ask: what did Globex say about pricing?"
            aria-label="Command"
            className="h-full flex-1 bg-transparent text-13 outline-none placeholder:text-muted-foreground/60"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { setI((v) => Math.min(items.length - 1, v + 1)); e.preventDefault(); }
              else if (e.key === "ArrowUp") { setI((v) => Math.max(0, v - 1)); e.preventDefault(); }
              else if (e.key === "Enter") { e.preventDefault(); if (sel) { sel.run(); if (sel.group !== "Ask" && sel.group !== "Contacts") onClose(); } }
              else if (e.key === "Escape") { e.preventDefault(); if (answer) setAnswer(null); else onClose(); }
            }}
          />
          <Keys combo={`${MOD} K`} />
        </div>

        {answer ? (
          <div className="fade-in flex flex-col gap-3 p-4">
            <p className="text-13">{answer.answer}</p>
            {answer.citations.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="label-caps">Cited</p>
                {answer.citations.map((c) => (
                  <button key={c.threadId} type="button" onClick={() => { nav(`/thread/${c.threadId}`); onClose(); }} className="flex flex-col gap-0.5 rounded-md border border-border bg-faint px-3 py-2 text-left transition-colors hover:bg-card-hover">
                    <span className="flex items-center justify-between gap-3 text-xs"><span className="font-medium">{c.subject}</span><span className="text-muted-foreground">{c.from} · {fmtRelative(c.date)}</span></span>
                    <span className="truncate text-xs text-muted-foreground">“{c.quote}”</span>
                  </button>
                ))}
              </div>
            )}
            <p className="text-11 text-muted-foreground">Answered by {answer.model}. Retrieval ran in code; the model only saw the cited messages.</p>
          </div>
        ) : ask.isPending ? (
          <div className="flex items-center gap-2 p-4 text-13 text-muted-foreground"><Spinner /> Reading the cited threads…</div>
        ) : (
          <div className="max-h-[52vh] overflow-y-auto p-1.5" role="listbox">
            {items.length === 0 && <p className="px-3 py-6 text-center text-13 text-muted-foreground">Nothing matches.</p>}
            {groups.map((g) => {
              const rows = items.filter((it) => it.group === g);
              if (!rows.length) return null;
              return (
                <div key={g} className="mb-1">
                  <p className="label-caps px-2 pb-1 pt-2">{g === "Ask" ? "Ask your inbox" : g}</p>
                  {rows.map((it) => {
                    const idx = items.indexOf(it);
                    const active = idx === i;
                    return (
                      <button
                        key={it.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setI(idx)}
                        onClick={() => { it.run(); if (it.group !== "Ask" && it.group !== "Contacts") onClose(); }}
                        className={cn("flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-13 transition-colors duration-75", active ? "bg-muted" : "")}
                      >
                        {it.avatar ? <Avatar name={it.avatar} size="sm" /> : it.icon ? <span className="flex size-5 items-center justify-center text-muted-foreground [&>svg]:size-3.5 [&>svg]:stroke-[1.75]">{it.icon}</span> : <span className="size-5" />}
                        <span className="truncate">{it.label}</span>
                        {it.detail && <span className="truncate text-xs text-muted-foreground">{it.detail}</span>}
                        <span className="ml-auto shrink-0">{it.keys ? <Keys combo={it.keys} /> : active ? <CornerDownLeft className="size-[12px] text-muted-foreground" /> : null}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
        <div className="flex h-8 items-center gap-3 border-t border-border bg-faint px-4 text-11 text-muted-foreground">
          <span>Start with <span className="font-mono">ask:</span> or end with a question mark to ask your inbox.</span>
          <span className="ml-auto"><Badge tone="outline">Esc</Badge> close</span>
        </div>
      </div>
    </div>
  );
}
