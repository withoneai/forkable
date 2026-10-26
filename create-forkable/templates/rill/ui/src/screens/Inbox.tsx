import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Inbox as InboxIcon, PenSquare, RefreshCw } from "lucide-react";
import type { InboxRow, ThreadAction } from "@rill/core/api-types";
import { LANES, type Lane } from "@rill/core/types";
import { useMailboxId } from "@/lib/mailbox";
import { useChatOpen } from "@/lib/chatPanel";
import { useInbox, useSettings, useSettingsMutation, useSync, useThread, useThreadAction } from "@/lib/queries";
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

export function Inbox() {
  const mailboxId = useMailboxId();
  const nav = useNavigate();
  const params = useParams<{ lane?: string; threadId?: string }>();
  const openId = params.threadId ?? null;
  const openThread = useThread(mailboxId, openId);
  const lane: Lane = isLane(params.lane) ? params.lane
    : openThread.data?.state.lane ?? ((sessionStorage.getItem("rill.lane") as Lane | null) ?? "vip");
  useEffect(() => { sessionStorage.setItem("rill.lane", lane); }, [lane]);

  const inbox = useInbox(mailboxId, lane);
  const rows = inbox.data?.rows ?? [];
  const act = useThreadAction(mailboxId);
  const sync = useSync(mailboxId);

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

  useEffect(() => {
    if (!selId) return;
    listRef.current?.querySelector<HTMLElement>(`[data-thread="${selId}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selId]);

  const open = useCallback((id: string) => nav(`/thread/${id}`), [nav]);
  const back = useCallback(() => nav(`/inbox/${lane}`), [nav, lane]);

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
  const busy = sync.isPending || !!inbox.data?.syncing;

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
          {!openId && <span className="ml-2 hidden min-w-0 truncate text-xs text-muted-foreground md:inline">{LANE_HINT[lane]}</span>}
          <span className="flex-1" />
          {!openId && <span className="hidden items-center gap-1.5 text-11 text-muted-foreground lg:flex"><Keys combo="?" /> shortcuts</span>}
          <IconButton label={busy ? "Syncing" : "Sync now"} size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw className={cn(busy && "animate-spin")} />
          </IconButton>
          {!openId && (
            <Button variant="primary" size="sm" icon={<PenSquare />} onClick={() => setComposeOpen(true)} title="Compose (W)">
              Compose
            </Button>
          )}
        </header>
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
              />
            ))
          )}
        </div>
      </section>

      {openId ? (
        <Reader
          mailboxId={mailboxId}
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
