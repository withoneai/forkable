import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Inbox as InboxIcon, PenSquare, RefreshCw } from "lucide-react";
import type { InboxResponse, InboxRow, ThreadAction } from "@rill/core/api-types";
import { LANES, type Lane } from "@rill/core/types";
import { useMailbox, useMailboxId } from "@/lib/mailbox";
import { useChatOpen } from "@/lib/chatPanel";
import { useAllInbox, useInbox, useSettings, useSettingsMutation, useSync, useSyncAll, useThread, useThreadAction } from "@/lib/queries";
import { TodayRail } from "@/components/calendar/TodayRail";
import { useKeys } from "@/lib/keys";
import { toast } from "@/lib/toast";
import { cn, LANE_LABEL, useMedia } from "@/lib/utils";
import { Row, rowDomId } from "@/components/inbox/Row";
import { Reader } from "@/components/inbox/Reader";
import { ComposeDialog } from "@/components/inbox/ComposeDialog";
import { RowSkeleton } from "@/components/ui/Skeleton";
import { EmptyState, LoadError } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Keys } from "@/components/ui/Kbd";

const LANE_HINT: Record<Lane, string> = {
  vip: "People on your VIP list, and any thread a VIP joined.",
  goals: "Emails that move one of your goals. The chip says which.",
  reply: "Needs a reply from you, no goal match. Drafts are ready.",
  other: "Newsletters, receipts, notifications. Nothing waits here.",
  screener: "First-time senders. Let in or screen out once, remembered.",
};

const LANE_EMPTY: Record<Lane, string> = {
  vip: "No VIP is waiting on you.",
  goals: "Nothing moved a goal today.",
  reply: "Nobody is waiting on a reply.",
  other: "No newsletters or receipts right now.",
  screener: "No first-time senders to decide on.",
};

function isLane(v: string | undefined): v is Lane { return !!v && (LANES as readonly string[]).includes(v); }

/**
 * One lane. `all` is All inboxes: the same lane across every live mailbox,
 * where each thread opens and acts in its own account (its mailbox comes on
 * the row, or from the thread id, which is `${mailboxId}:${providerThreadId}`).
 */
export function Inbox({ all = false }: { all?: boolean }) {
  const mailboxId = useMailboxId();
  const { mailboxes } = useMailbox();
  const nav = useNavigate();
  const params = useParams<{ lane?: string; threadId?: string }>();
  const openId = params.threadId ?? null;
  const laneParam: Lane | null = isLane(params.lane) ? params.lane : null;
  const storedLane = (sessionStorage.getItem("rill.lane") as Lane | null) ?? "vip";

  const single = useInbox(mailboxId, laneParam ?? storedLane, !all);
  const allQ = useAllInbox(laneParam ?? storedLane, all);
  const inbox = all ? allQ : single;
  const rows = inbox.data?.rows ?? [];
  const mailboxOf = useCallback((threadId: string | null): string => {
    if (!all || !threadId) return mailboxId;
    const row = rows.find((r) => r.threadId === threadId);
    if (row?.mailbox) return row.mailbox.id;
    const prefix = threadId.split(":")[0]!;
    return mailboxes.some((m) => m.id === prefix) ? prefix : mailboxId;
  }, [all, rows, mailboxId, mailboxes]);

  const openMailboxId = mailboxOf(openId);
  const openThread = useThread(openMailboxId, openId);
  const lane: Lane = laneParam ?? openThread.data?.state.lane ?? storedLane;
  useEffect(() => { sessionStorage.setItem("rill.lane", lane); }, [lane]);
  const sync = useSync(mailboxId);
  const syncAll = useSyncAll();
  const liveIds = mailboxes.filter((m) => m.source === "live" && m.status === "active").map((m) => m.id);

  const [selected, setSelected] = useState<string | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const wide = useMedia("(min-width: 1280px)");
  const chatOpen = useChatOpen();
  const settingsQ = useSettings(mailboxId);
  const settingsMut = useSettingsMutation(mailboxId);
  const showTodayRail = wide && !chatOpen && (settingsQ.data?.todayRail ?? true);
  const listRef = useRef<HTMLDivElement>(null);
  const lastUndo = useRef<{ threadId: string; label: string } | null>(null);

  const selId = (openId && rows.some((r) => r.threadId === openId)) ? openId
    : (selected && rows.some((r) => r.threadId === selected)) ? selected
    : rows[0]?.threadId ?? null;
  const selIndex = rows.findIndex((r) => r.threadId === selId);
  // Actions run on the selected thread's own mailbox.
  const act = useThreadAction(mailboxOf(selId ?? openId));

  useEffect(() => {
    if (!selId) return;
    listRef.current?.querySelector<HTMLElement>(`[data-thread="${selId}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selId]);

  const open = useCallback((id: string) => nav(all ? `/all/thread/${id}` : `/thread/${id}`), [nav, all]);
  const back = useCallback(() => nav(all ? `/all/${lane}` : `/inbox/${lane}`), [nav, lane, all]);

  const move = useCallback((d: 1 | -1) => {
    if (rows.length === 0) return;
    const next = Math.max(0, Math.min(rows.length - 1, (selIndex < 0 ? 0 : selIndex) + d));
    const id = rows[next]!.threadId;
    setSelected(id);
    if (openId) open(id);
  }, [rows, selIndex, openId, open]);

  const perform = useCallback((threadId: string, action: ThreadAction, label: string) => {
    const row = rows.find((r) => r.threadId === threadId) ?? openThread.data?.state;
    const subject = row?.subject ?? "";
    const leaves = action.action === "done" || action.action === "snooze" || action.action === "screen_out" || action.action === "let_in";
    act.mutate({ threadId, action }, {
      onError: (e) => toast({ title: "That did not stick", detail: e.message, tone: "destructive" }),
    });
    const undo = () => { act.mutate({ threadId, action: { action: "undo" } }); lastUndo.current = null; };
    if (leaves) {
      lastUndo.current = { threadId, label };
      toast({ title: label, detail: subject, action: { label: "Undo", onClick: undo } });
      if (openId === threadId) {
        const i = rows.findIndex((r) => r.threadId === threadId);
        const next = rows[i + 1] ?? rows[i - 1];
        if (next) { setSelected(next.threadId); open(next.threadId); } else back();
      } else {
        const i = rows.findIndex((r) => r.threadId === threadId);
        const next = rows[i + 1] ?? rows[i - 1];
        setSelected(next?.threadId ?? null);
      }
    } else {
      toast({ title: label, detail: subject });
    }
  }, [rows, openThread.data, act, openId, open, back]);

  useKeys({
    j: () => move(1),
    arrowdown: () => move(1),
    k: () => move(-1),
    arrowup: () => move(-1),
    enter: () => { if (selId && !openId) open(selId); },
    escape: () => { if (snoozeOpen) setSnoozeOpen(false); else if (openId) back(); },
    e: () => { if (selId) perform(selId, { action: "done" }, "Done"); },
    h: () => { if (selId) { if (!openId) open(selId); setSnoozeOpen(true); } },
    l: () => { if (selId) perform(selId, { action: "reply_later" }, "Reply later"); },
    v: () => { if (selId) perform(selId, { action: "add_vip", tier: "key" }, "Added as a VIP"); },
    z: () => { const u = lastUndo.current; if (u) { act.mutate({ threadId: u.threadId, action: { action: "undo" } }); toast({ title: "Undone", detail: u.label }); lastUndo.current = null; } },
    "shift+u": () => { if (selId) perform(selId, { action: "move", lane: "other" }, "Moved to Other"); },
    "\\": () => settingsMut.mutate({ todayRail: !(settingsQ.data?.todayRail ?? true) }),
    // "C" is Calendar's New event; Compose uses W (Write) so the two never share a letter.
    w: () => setComposeOpen(true),
  });

  const count = inbox.data?.counts?.[lane] ?? rows.length;
  const syncing = all ? syncAll.isPending : sync.isPending;
  const busy = syncing || !!inbox.data?.syncing;
  const runSync = () => (all ? syncAll.mutate(liveIds) : sync.mutate());

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <section
        aria-label={`${LANE_LABEL[lane]} lane`}
        className={cn(
          "@container flex min-h-0 min-w-0 flex-col",
          openId ? "hidden w-[340px] shrink-0 border-r border-border lg:flex xl:w-[380px]" : "flex flex-1",
        )}
      >
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
          <h1 className="flex items-baseline gap-1.5 text-13 font-semibold tracking-tight">
            {LANE_LABEL[lane]}
            {count > 0 && <span className="tnum text-xs font-normal text-muted-foreground">{count}</span>}
          </h1>
          {all && <span className="shrink-0 text-xs text-muted-foreground">All inboxes</span>}
          {!openId && <span className="ml-2 hidden min-w-0 truncate text-xs text-muted-foreground md:inline">{LANE_HINT[lane]}</span>}
          <span className="flex-1" />
          {!openId && <span className="hidden items-center gap-1.5 text-11 text-muted-foreground lg:flex"><Keys combo="?" /> shortcuts</span>}
          <IconButton label={busy ? "Syncing" : "Sync now"} size="sm" onClick={runSync} disabled={syncing}>
            <RefreshCw className={cn(busy && "animate-spin")} />
          </IconButton>
          {!openId && (
            <Button variant="primary" size="sm" icon={<PenSquare />} onClick={() => setComposeOpen(true)} title="Compose (W)">
              Compose
            </Button>
          )}
        </header>
        {!all && <HealthLine health={single.data?.health} onSettings={() => nav("/settings")} />}
        {inbox.isError && rows.length > 0 && (
          <div role="status" className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-faint px-3 text-11 text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">Could not refresh. Showing what was loaded before.</span>
            <button type="button" onClick={() => void inbox.refetch()} className="font-medium text-foreground underline-offset-2 hover:underline">Retry</button>
          </div>
        )}
        <div
          ref={listRef}
          role="listbox"
          tabIndex={0}
          aria-label={`${LANE_LABEL[lane]} threads. J and K to move, Enter to open.`}
          aria-activedescendant={selId ? rowDomId(selId) : undefined}
          className="min-h-0 flex-1 overflow-y-auto py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {inbox.isPending ? (
            <RowSkeleton count={10} />
          ) : inbox.isError && rows.length === 0 ? (
            <LoadError what="This lane" error={inbox.error} onRetry={() => void inbox.refetch()} retrying={inbox.isFetching} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<InboxIcon />}
              title={inbox.data?.judging ? `Sorting ${inbox.data.judging} more` : LANE_EMPTY[lane]}
              detail={inbox.data?.judging ? "Rows land here as Jev judges them." : LANE_HINT[lane]}
            />
          ) : (
            rows.map((r: InboxRow) => (
              <Row
                key={r.threadId}
                row={r}
                selected={r.threadId === selId}
                open={r.threadId === openId}
                onSelect={() => setSelected(r.threadId)}
                onOpen={() => open(r.threadId)}
                account={all ? r.mailbox?.address ?? r.mailbox?.label : undefined}
              />
            ))
          )}
        </div>
      </section>

      {openId ? (
        <Reader
          key={openMailboxId}
          mailboxId={openMailboxId}
          threadId={openId}
          onBack={back}
          onAct={(action, label) => perform(openId, action, label)}
          snoozeOpen={snoozeOpen}
          setSnoozeOpen={setSnoozeOpen}
          showPerson={wide && !chatOpen}
        />
      ) : showTodayRail ? (
        <TodayRail mailboxId={mailboxId} />
      ) : null}
      <ComposeDialog mailboxId={mailboxId} open={composeOpen} onClose={() => setComposeOpen(false)} />
    </div>
  );
}

/** One quiet line when the pipeline is behind: no sync in two hours, Jev down, or the reconcile found a gap. */
function HealthLine({ health, onSettings }: { health: InboxResponse["health"] | undefined; onSettings: () => void }) {
  if (!health) return null;
  const r = health.reconcile;
  const text = health.jevDownSince
    ? health.jevFallback
      ? "Jev has been down for over an hour. Your writer is judging new mail, with no drafts and Check on every row."
      : `Jev is not answering. ${health.held ? `${health.held} new ${health.held === 1 ? "email waits" : "emails wait"}` : "New mail waits"} unjudged instead of being guessed.`
    : health.stale
      ? "No sync has finished in over two hours. New mail may be missing."
      : r && (r.missing || r.stuck)
        ? `The last check found ${[r.missing && `${r.missing} missing`, r.stuck && `${r.stuck} stuck`].filter(Boolean).join(" and ")}. Rill is retrying.`
        : null;
  if (!text) return null;
  return (
    <div role="status" className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-warning-text/10 px-3 text-11 text-warning-text">
      <span className="min-w-0 flex-1 truncate" title={text}>{text}</span>
      <button type="button" onClick={onSettings} className="font-medium underline-offset-2 hover:underline">Details</button>
    </div>
  );
}
