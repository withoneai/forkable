import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, CalendarClock, Check, ChevronDown, ChevronRight, Clock, Crown, Hourglass, LogIn, PenLine, RefreshCw, Save, Send, ShieldOff, Trash2,
} from "lucide-react";
import type { ApiMessage, ThreadAction } from "@rill/core/api-types";
import type { Judgment } from "@rill/core/types";
import { useDraftMutations, useSettings, useThread, useThreadHtml } from "@/lib/queries";
import { api } from "@/lib/api";
import { useKeys } from "@/lib/keys";
import { useMailbox } from "@/lib/mailbox";
import { toast } from "@/lib/toast";
import { cn, fmtDateTime, fmtRelative, LANE_LABEL, MOD, pct, snoozeTargets } from "@/lib/utils";
import { Avatar } from "../ui/Avatar";
import { EmailBody } from "./EmailBody";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { ConfirmButton } from "../ui/ConfirmButton";
import { Input, Textarea } from "../ui/Input";
import { Menu } from "../ui/Menu";
import { Skeleton } from "../ui/Skeleton";
import { Kbd } from "../ui/Kbd";
import { PersonRail } from "./PersonRail";
import { InviteCard } from "../calendar/InviteCard";
import { OfferTimesPanel } from "../calendar/OfferTimesPanel";

export interface ReaderProps {
  mailboxId: string;
  threadId: string;
  onBack: () => void;
  onAct: (action: ThreadAction, label: string) => void;
  snoozeOpen: boolean;
  setSnoozeOpen: (v: boolean) => void;
  showPerson: boolean;
}

export function Reader({ mailboxId, threadId, onBack, onAct, snoozeOpen, setSnoozeOpen, showPerson }: ReaderProps) {
  const mailName = useMailbox().mailbox?.mailProvider === "outlook-mail" ? "Outlook" : "Gmail";
  const q = useThread(mailboxId, threadId);
  const htmlQ = useThreadHtml(mailboxId, threadId);
  const settingsQ = useSettings(mailboxId);
  const showImages = settingsQ.data?.showImages ?? true;
  const drafts = useDraftMutations(mailboxId, threadId);
  const [whyOpen, setWhyOpen] = useState(false);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [body, setBody] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const textarea = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const sentBodies = useRef<Set<string>>(new Set());
  const pendingSave = useRef<{ draftId: string; body: string } | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [sendFailed, setSendFailed] = useState<string | null>(null);
  const [offerOpen, setOfferOpen] = useState(false);
  const data = q.data;
  const draft = data?.draft ?? null;
  const draftLive = !!draft && draft.status !== "sent" && draft.status !== "discarded";

  useEffect(() => { setWhyOpen(false); setRewriteOpen(false); setInstruction(""); setExpanded(new Set()); setSaveState("idle"); setSendFailed(null); sentBodies.current.clear(); scroller.current?.scrollTo({ top: 0 }); }, [threadId]);
  // Adopt the server's body unless it is the echo of an edit we sent, so typing during a save is never overwritten.
  useEffect(() => {
    if (!draft) return;
    if (sentBodies.current.has(draft.body)) return;
    setBody(draft.body);
  }, [draft?.id, draft?.updatedAt, draft?.body]); // eslint-disable-line react-hooks/exhaustive-deps
  // Leaving the thread mid-edit still saves the last keystrokes.
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const p = pendingSave.current;
    if (p) void api.updateDraft(mailboxId, p.draftId, p.body).catch(() => undefined);
  }, [mailboxId, threadId]);

  const focusDraft = () => {
    const el = textarea.current;
    if (!el) return false;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.scrollIntoView({ block: "nearest" });
    return true;
  };
  useKeys({
    r: () => { if (!focusDraft()) { if (!draftLive) drafts.write.mutate(undefined); } },
    // Send only from the reply box itself, never from another input or overlay.
    "mod+shift+a": () => {
      if (!draftLive) { toast({ title: "Write a draft first", detail: "Press R, then offer times into it." }); return; }
      setOfferOpen(true);
    },
    "mod+enter": () => {
      if (!draftLive || !draft || document.activeElement !== textarea.current) return false;
      void send();
    },
  }, { priority: 5 });

  /** Saves run one at a time, in order, so a slow save can never land after a newer one. */
  const persist = (draftId: string, v: string) => {
    pendingSave.current = null;
    sentBodies.current.add(v);
    setSaveState("saving");
    const run = saveChain.current.then(() => drafts.update.mutateAsync({ draftId, body: v }));
    saveChain.current = run.then(
      () => { setSaveState("saved"); },
      () => { setSaveState("error"); },
    );
    return run;
  };
  const onBodyChange = (v: string) => {
    setBody(v);
    setSendFailed(null);
    if (!draft) return;
    pendingSave.current = { draftId: draft.id, body: v };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; void persist(draft.id, v).catch(() => undefined); }, 600);
  };
  /** Puts offered times into the draft at the cursor, or at the end. */
  const insertIntoDraft = (text: string) => {
    const el = textarea.current;
    const at = el && document.activeElement === el ? el.selectionStart : body.length;
    const before = body.slice(0, at).replace(/\s*$/, "");
    const next = `${before}${before ? "\n\n" : ""}${text}\n\n${body.slice(at).replace(/^\s*/, "")}`.replace(/\n{3,}/g, "\n\n").trimEnd();
    onBodyChange(next);
    setTimeout(() => focusDraft(), 0);
  };
  const flush = async () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (draft && pendingSave.current) await persist(draft.id, body);
    else await saveChain.current;
  };
  const send = async () => {
    if (!draft || drafts.send.isPending) return;
    try { await flush(); } catch (e) { setSendFailed(`Not sent. The edit could not be saved first: ${(e as Error).message}`); return; }
    drafts.send.mutate(draft.id, {
      onSuccess: () => { toast({ title: "Sent", detail: `to ${draft.to.join(", ")}` }); onBack(); },
      onError: (e) => setSendFailed(`Not sent. ${e.message} Your draft is unchanged.`),
    });
  };
  const save = async () => {
    if (!draft) return;
    try { await flush(); } catch { return; }
    drafts.save.mutate(draft.id, {
      onSuccess: () => toast({ title: `Saved to ${mailName} Drafts`, detail: data?.thread.subject }),
      onError: (e) => toast({ title: `Not saved to ${mailName}`, detail: e.message, tone: "destructive" }),
    });
  };
  const rewrite = () => {
    drafts.write.mutate(instruction.trim() || undefined, {
      onSuccess: () => { setRewriteOpen(false); setInstruction(""); },
      onError: (e) => toast({ title: "Could not rewrite", detail: `${e.message} Your draft and instruction are kept.`, tone: "destructive" }),
    });
  };

  const messages = data?.messages ?? [];
  const latest = messages[messages.length - 1];
  const snooze = useMemo(() => snoozeTargets(), [threadId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isPending) return <ReaderSkeleton />;
  if (q.isError || !data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-13 font-medium">This thread could not be loaded.</p>
        <p className="text-xs text-muted-foreground">{q.error?.message}</p>
        <Button size="sm" onClick={onBack}>Back</Button>
      </div>
    );
  }
  const { state, thread, person } = data;
  const isScreener = state.lane === "screener";
  const hasSummary = !!(state.summary || (data.ask && !data.invite));
  const engineName = draft ? (draft.engine === "local" ? "Claude Code" : draft.engine) : "";
  const modelName = draft ? draft.model.replace(/^claude-code · /, "") : "";

  return (
    <div className="flex min-w-0 flex-1 overflow-hidden">
      <section className="flex min-w-0 flex-1 flex-col" aria-label="Thread">
        <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-3">
          <IconButton label="Back to the list" hint="Esc" size="sm" onClick={onBack} className="lg:hidden"><ArrowLeft /></IconButton>
          <div className="flex min-w-0 flex-1 items-center gap-2 pl-1">
            <span className="text-xs font-medium text-muted-foreground">{LANE_LABEL[state.lane]}</span>
            <span className="text-xs text-muted-foreground/60">·</span>
            <span className="tnum text-xs text-muted-foreground">{messages.length} {messages.length === 1 ? "message" : "messages"}</span>
            {state.goal && <span className="truncate text-xs text-muted-foreground" title={`Goal · ${state.goal.title}`}>· Goal · {state.goal.title}</span>}
            {state.check && <Badge tone="warning">Check</Badge>}
            {state.screen === "quarantine" && <Badge tone="destructive">Quarantined</Badge>}
            {state.replyLater && <Badge tone="outline">Reply later</Badge>}
          </div>
          <div className="flex items-center gap-0.5">
            <IconButton label="Done" hint="E" onClick={() => onAct({ action: "done" }, "Done")}><Check /></IconButton>
            <Menu
              open={snoozeOpen}
              onClose={() => setSnoozeOpen(false)}
              align="end"
              items={snooze.map((s, i) => ({ key: s.key, label: s.label, hint: String(i + 1), onSelect: () => onAct({ action: "snooze", until: s.until }, `Snoozed until ${s.label.toLowerCase()}`) }))}
              anchor={<IconButton label="Snooze" hint="H" active={snoozeOpen} onClick={() => setSnoozeOpen(!snoozeOpen)} aria-haspopup="menu" aria-expanded={snoozeOpen}><Clock /></IconButton>}
            />
            <IconButton label={state.replyLater ? "Remove from reply later" : "Reply later"} hint="L" active={state.replyLater} onClick={() => onAct({ action: "reply_later" }, state.replyLater ? "Removed from reply later" : "Reply later")}><Hourglass /></IconButton>
            {!state.vip && <IconButton label="Add as a VIP" hint="V" onClick={() => onAct({ action: "add_vip", tier: "key" }, `${person.name} is a VIP`)}><Crown /></IconButton>}
            {isScreener && (
              <>
                <span className="mx-1.5 h-4 w-px bg-border" />
                <Button size="sm" icon={<LogIn />} onClick={() => onAct({ action: "let_in" }, `Let in ${person.name}`)}>Let in</Button>
                <Button size="sm" variant="ghost" icon={<ShieldOff />} onClick={() => onAct({ action: "screen_out" }, `Screened out ${person.name}`)}>Screen out</Button>
              </>
            )}
          </div>
        </header>

        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5 px-6 pb-10 pt-5">
            <div className="flex flex-col gap-1">
              <h1 className="text-xl font-semibold leading-tight tracking-tight">{thread.subject}</h1>
              <p className="truncate text-xs text-muted-foreground">{thread.participants.map((p) => p.name || p.email).filter(Boolean).join(", ")}</p>
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-card">
              {hasSummary && (
                <div className="flex flex-col gap-2 px-4 py-3.5">
                  {state.summary && <p className="text-13 leading-relaxed">{state.summary}</p>}
                  {data.ask && !data.invite && (
                    <p className="text-13">
                      <span className="mr-1.5 rounded-sm bg-muted px-1.5 py-0.5 text-11 font-medium text-muted-foreground">They want</span>
                      {data.ask}
                    </p>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={() => setWhyOpen((v) => !v)}
                aria-expanded={whyOpen}
                className={cn("flex h-8 w-full items-center gap-2 px-3 text-left text-xs transition-colors hover:bg-card-hover", hasSummary && "border-t border-border")}
              >
                <span className="text-muted-foreground [&>svg]:size-3.5">{whyOpen ? <ChevronDown /> : <ChevronRight />}</span>
                <span className="shrink-0 whitespace-nowrap font-medium">Why it's here</span>
                <span className="min-w-0 truncate text-muted-foreground">{data.rule}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted-foreground">
                  {state.check && <span className="font-medium text-warning-text">Review suggested</span>}
                  {data.judgedBy && <span className="hidden sm:inline">{state.check ? "· " : ""}{data.judgedBy}</span>}
                </span>
              </button>
              {whyOpen && (
                <div className="fade-in flex flex-col border-t border-border px-3 py-2">
                  {data.why.length > 0 && <p className="pb-1 text-11 text-muted-foreground">Jev's answers, with how strongly it leaned each way. Overall: <span className="tnum">{pct(state.confidence)}</span>.</p>}
                  {data.why.map((j) => <JudgmentLine key={j.question} j={j} />)}
                  {data.why.length === 0 && <p className="py-1 text-xs text-muted-foreground">Not judged yet.</p>}
                </div>
              )}
            </div>

            {data.invite && <InviteCard mailboxId={mailboxId} threadId={threadId} invite={data.invite} />}

            <div className="flex flex-col">
              {messages.map((m) => (
                <Message
                  key={m.id}
                  m={m}
                  html={htmlQ.data?.html[m.id] ?? null}
                  showImages={showImages}
                  expanded={m.id === latest?.id || expanded.has(m.id)}
                  onToggle={() => setExpanded((s) => { const n = new Set(s); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n; })}
                />
              ))}
            </div>

            <section aria-label="Draft" className="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.03)]">
              <div className="flex h-9 items-center gap-2 border-b border-border px-4 text-xs">
                <PenLine className="size-3.5 text-muted-foreground" />
                <span className="font-medium">Reply</span>
                {draft && <span className="min-w-0 truncate text-muted-foreground">to {draft.to.join(", ")}</span>}
                <span className="ml-auto flex items-center gap-2">
                  {draftLive && <SaveState state={saveState} onRetry={() => { if (draft) void persist(draft.id, body).catch(() => undefined); }} />}
                  {draft && !draftLive && <Badge tone="outline" className="capitalize">{draft.status}</Badge>}
                  {draftLive && saveState === "idle" && <span className="hidden text-11 text-muted-foreground sm:inline"><Kbd>R</Kbd> to edit</span>}
                </span>
              </div>
              {draft && draftLive ? (
                <Textarea
                  ref={textarea}
                  value={body}
                  onChange={(e) => onBodyChange(e.target.value)}
                  onBlur={() => void flush()}
                  aria-label="Draft reply"
                  rows={Math.min(16, Math.max(6, body.split("\n").length + 1))}
                  className="min-h-[140px] rounded-none border-0 bg-transparent px-4 py-3 text-13 leading-relaxed hover:border-0 focus:border-0"
                />
              ) : (
                <div className="flex items-center justify-between gap-3 px-4 py-4 text-13 text-muted-foreground">
                  <span>{draft?.status === "sent" ? "Sent. Your keypress did that." : state.needsReply ? "Nothing written yet. Press R and a draft appears." : "No reply needed. Ask for one anyway."}</span>
                  <Button size="sm" icon={<PenLine />} loading={drafts.write.isPending} onClick={() => drafts.write.mutate(undefined)}>Write a draft</Button>
                </div>
              )}
              {draftLive && draft.validator && !draft.validator.ok && (
                <div role="note" className="flex items-start gap-2 border-t border-border bg-warning-text/[0.06] px-4 py-2 text-xs">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-text" />
                  <span><span className="font-medium">Check before sending.</span> {draft.validator.reasons.join(" ")}</span>
                </div>
              )}
              {sendFailed && (
                <div role="alert" className="flex items-start gap-2 border-t border-border bg-destructive-text/[0.06] px-4 py-2 text-xs text-destructive-text">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{sendFailed}</span>
                </div>
              )}
              {rewriteOpen && (
                <form className="fade-in flex items-center gap-2 border-t border-border bg-faint p-2" onSubmit={(e) => { e.preventDefault(); rewrite(); }}>
                  <Input autoFocus value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Shorter. Warmer. Say no, kindly." aria-label="Rewrite instruction" />
                  <Button size="sm" type="submit" loading={drafts.write.isPending}>Rewrite</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRewriteOpen(false)}>Cancel</Button>
                </form>
              )}
              {draftLive && (
                <footer className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2">
                  <Button variant="primary" size="sm" icon={<Send />} loading={drafts.send.isPending} onClick={() => void send()} title={`Send (${MOD} Enter)`}
                    trailing={<span className="font-normal opacity-80">{MOD} ↵</span>}>
                    Send
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Save />} loading={drafts.save.isPending} onClick={() => void save()}>Save to Drafts</Button>
                  <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={() => setRewriteOpen((v) => !v)} aria-expanded={rewriteOpen}>Rewrite</Button>
                  <Button size="sm" variant="ghost" icon={<CalendarClock />} onClick={() => setOfferOpen(true)} title={`Offer times (${MOD} Shift A)`}>Offer times</Button>
                  <ConfirmButton size="sm" variant="ghost" icon={<Trash2 />} confirmLabel="Discard this draft?" onConfirm={() => { pendingSave.current = null; if (saveTimer.current) clearTimeout(saveTimer.current); drafts.discard.mutate(draft!.id); }}>Discard</ConfirmButton>
                  <span className="ml-auto flex min-w-0 items-center gap-2 text-11 text-muted-foreground">
                    <span className="truncate">Written by {engineName} · <span className="font-mono">{modelName}</span></span>
                    {draft.validator?.ok && <span className="flex items-center gap-1" title="Checked against the thread. Still read it before you send."><Check className="size-3" /> Checked</span>}
                  </span>
                </footer>
              )}
            </section>
            <p className="text-11 text-muted-foreground">Only your keypress sends. The writer has no tools and no way to send.</p>
          </div>
        </div>
      </section>
      {showPerson && <PersonRail person={person} currentThreadId={threadId} />}
      <OfferTimesPanel mailboxId={mailboxId} threadId={threadId} open={offerOpen} onClose={() => setOfferOpen(false)} mode="offer" onInsert={insertIntoDraft} />
    </div>
  );
}

function SaveState({ state, onRetry }: { state: "idle" | "saving" | "saved" | "error"; onRetry: () => void }) {
  if (state === "idle") return null;
  if (state === "error") {
    return (
      <span role="alert" className="flex items-center gap-1.5 text-11 text-destructive-text">
        Could not save
        <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2">Retry</button>
      </span>
    );
  }
  return <span aria-live="polite" className="text-11 text-muted-foreground">{state === "saving" ? "Saving…" : "Saved"}</span>;
}

function JudgmentLine({ j }: { j: Judgment }) {
  const low = j.confidence < 0.6;
  return (
    <div className="grid h-7 grid-cols-[minmax(0,180px)_minmax(0,1fr)_64px_40px] items-center gap-3 text-xs">
      <span className="truncate text-muted-foreground">{j.label}</span>
      <span className="truncate">{j.answer}</span>
      <span className="relative h-[3px] overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={cn("absolute inset-y-0 left-0 rounded-full", low ? "bg-warning-text" : "bg-foreground/60")} style={{ width: `${Math.round(j.probability * 100)}%` }} />
      </span>
      <span className={cn("tnum text-right", low ? "text-warning-text" : "text-muted-foreground")}>{pct(j.probability)}</span>
    </div>
  );
}

function Message({ m, html, showImages, expanded, onToggle }: { m: ApiMessage; html: string | null; showImages: boolean; expanded: boolean; onToggle: () => void }) {
  const name = m.isFromMe ? "You" : m.from.name;
  return (
    <article className={cn("border-t border-border first:border-t-0", m.screen === "quarantine" && "rounded-md border border-destructive-text/40 bg-destructive-text/[0.04] px-3")}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="-mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-faint">
        <Avatar name={m.from.name} size="md" />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-13 font-medium">{name}</span>
            <span className="hidden truncate text-11 text-muted-foreground sm:inline">{m.from.email}</span>
            {m.screen !== "pass" && <Badge tone={m.screen === "quarantine" ? "destructive" : "warning"}>{m.screen === "quarantine" ? "Quarantined" : "Stripped"}</Badge>}
          </span>
          {expanded
            ? (m.to.length > 0 || m.cc.length > 0) && <span className="truncate text-11 text-muted-foreground">to {m.to.join(", ")}{m.cc.length ? ` · cc ${m.cc.join(", ")}` : ""}</span>
            : <span className="truncate text-xs text-muted-foreground">{m.body.replace(/\s+/g, " ").slice(0, 140)}</span>}
        </span>
        <time dateTime={m.date} title={fmtDateTime(m.date)} className="tnum shrink-0 text-11 text-muted-foreground">{fmtRelative(m.date)}</time>
      </button>
      {expanded && (
        <div className="fade-in pb-4 pl-9 pt-0.5">
          <EmailBody text={m.body} html={html} showImages={showImages} />
        </div>
      )}
    </article>
  );
}

function ReaderSkeleton() {
  return (
    <div className="flex flex-1 flex-col" aria-busy>
      <div className="flex h-11 items-center border-b border-border px-4"><Skeleton className="h-2.5 w-32" /></div>
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5 px-6 py-5">
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-2.5 w-48" />
        <Skeleton className="h-[88px] w-full rounded-lg" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-36 w-full rounded-lg" />
      </div>
    </div>
  );
}
