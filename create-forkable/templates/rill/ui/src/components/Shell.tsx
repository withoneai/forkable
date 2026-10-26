import { useCallback, useEffect, useRef, useState } from "react";
import { matchPath, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Calendar, ChevronsUpDown, Crown, Inbox, Mail, MessageCircle, MessageSquareReply, Search, Settings, ShieldCheck, Sun, Target, UserPlus } from "lucide-react";
import { LANES } from "@rill/core/types";
import type { Lane } from "@rill/core/types";
import { useMailbox } from "@/lib/mailbox";
import { useKeys } from "@/lib/keys";
import { toggleTheme } from "@/lib/theme";
import { cn, LANE_LABEL, LANE_KEY, MOD, useMedia } from "@/lib/utils";
import { ChatOpenProvider, usePersistedBoolean, usePersistedNumber, type ChatRouteContext } from "@/lib/chatPanel";
import { Splash } from "./Splash";
import { Logo } from "./Logo";
import { LiveProvider, useLive } from "./Live";
import { Menu } from "./ui/Menu";
import { Kbd } from "./ui/Kbd";
import { Avatar } from "./ui/Avatar";
import { CommandPalette } from "./CommandPalette";
import { Cheatsheet } from "./Cheatsheet";
import { StatusChip } from "./StatusChip";
import { ChatPanel } from "./chat/ChatPanel";

const LANE_ICON: Record<Lane, React.ReactNode> = {
  vip: <Crown />, goals: <Target />, reply: <MessageSquareReply />, other: <Inbox />, screener: <UserPlus />,
};

export function Shell() {
  const { loading, mailbox, mailboxId } = useMailbox();
  if (loading) return <Splash />;
  if (!mailbox || !mailboxId) return <Navigate to="/start" replace />;
  return (
    <LiveProvider mailboxId={mailboxId}>
      <ShellInner />
    </LiveProvider>
  );
}

function ShellInner() {
  const { me, mailbox, mailboxes, select } = useMailbox();
  // Named only once One has told us who this is (whoami); the sample alone stays anonymous.
  const user = me?.user && (me.user.name || me.user.email) ? me.user : null;
  const live = useLive();
  const nav = useNavigate();
  const loc = useLocation();
  const [palette, setPalette] = useState(false);
  const [cheat, setCheat] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const mb = mailbox!;
  const reconnect = mb.status === "reconnect_required" || live.reconnectRequired;

  const [chatOpen, setChatOpen] = usePersistedBoolean("rill.chat.open", false);
  const [chatWidth, setChatWidth] = usePersistedNumber("rill.chat.width", 360);
  const composerFocusRef = useRef<(() => void) | null>(null);
  const large = useMedia("(min-width: 1024px)");
  const roomy = useMedia("(min-width: 1536px)");
  // The nav folds to icons when the screen is small, or when the docked assistant needs its width.
  const rail = !large || (chatOpen && !roomy);

  const go = useCallback((lane: Lane) => { nav(`/inbox/${lane}`); }, [nav]);
  useKeys({ "mod+k": () => setPalette((v) => !v) }, { whileTyping: true });
  useKeys({
    "mod+j": () => setChatOpen(!chatOpen),
    "mod+shift+j": () => { setChatOpen(true); setTimeout(() => composerFocusRef.current?.(), 0); },
    "shift+?": () => setCheat((v) => !v),
    "?": () => setCheat((v) => !v),
    "g v": () => { go("vip"); },
    "g g": () => { go("goals"); },
    "g r": () => { go("reply"); },
    "g o": () => { go("other"); },
    "g s": () => { go("screener"); },
    "g b": () => { nav("/brief"); },
    "g c": () => { nav("/calendar"); },
    "g a": () => { nav("/access"); },
    "g ,": () => { nav("/settings"); },
  });
  useEffect(() => { setPalette(false); }, [loc.pathname]);

  const threadMatch = matchPath("/thread/:threadId", loc.pathname);
  const laneMatch = matchPath("/inbox/:lane?", loc.pathname);
  const routeContext: ChatRouteContext = threadMatch?.params.threadId
    ? { kind: "thread", threadId: threadMatch.params.threadId }
    : { kind: "lane", lane: (laneMatch?.params.lane as Lane | undefined) ?? ((sessionStorage.getItem("rill.lane") as Lane | null) ?? "vip") };

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground">
      <aside className={cn("flex shrink-0 flex-col border-r border-border bg-faint transition-[width] duration-150 ease-out-quart", rail ? "w-[52px]" : "w-[220px]")}>
        <div className={cn("flex h-11 items-center gap-2", rail ? "justify-center" : "px-4")}>
          <Logo size={16} />
          {!rail && <span className="text-13 font-semibold tracking-tight">Rill</span>}
        </div>
        <div className={cn("flex flex-col gap-px pb-2", rail ? "items-center px-1.5" : "px-2")}>
          <RailButton rail={rail} icon={<Search />} label="Search" hint={`${MOD}K`} onClick={() => setPalette(true)} />
          <RailButton rail={rail} icon={<MessageCircle />} label="Ask your inbox" hint={`${MOD}J`} active={chatOpen} onClick={() => setChatOpen(!chatOpen)} pressed={chatOpen} />
        </div>
        <nav className={cn("flex flex-1 flex-col gap-px pt-1", rail ? "items-center px-1.5" : "px-2")} aria-label="Lanes">
          {!rail && <p className="label-caps px-2 pb-1 pt-1">Inbox</p>}
          {LANES.map((lane) => (
            <RailLink key={lane} rail={rail} to={`/inbox/${lane}`} label={LANE_LABEL[lane]} icon={LANE_ICON[lane]} count={mb.counts[lane]} keyHint={`G ${LANE_KEY[lane]}`}
              active={loc.pathname.startsWith(`/inbox/${lane}`) || (loc.pathname.startsWith("/thread/") && sessionStorage.getItem("rill.lane") === lane)} />
          ))}
          <div className={cn("my-2 h-px bg-border", rail ? "w-6" : "mx-2")} />
          <RailLink rail={rail} to="/brief" label="Brief" icon={<Sun />} keyHint="G B" />
          <RailLink rail={rail} to="/calendar" label="Calendar" icon={<Calendar />} keyHint="G C" />
          <RailLink rail={rail} to="/access" label="Access" icon={<ShieldCheck />} keyHint="G A" />
          <RailLink rail={rail} to="/settings" label="Settings" icon={<Settings />} keyHint="G ," />
        </nav>
        <div className={cn("flex flex-col gap-2 p-2", rail && "items-center px-1.5")}>
          {!rail && <StatusChip />}
          <Menu
            open={switcher}
            onClose={() => setSwitcher(false)}
            className="bottom-full top-auto mb-1 w-[204px]"
            items={mailboxes.map((m) => ({
              key: m.id,
              label: m.label,
              hint: m.source === "sample" ? "sample" : m.mode,
              onSelect: () => { select(m.id); nav("/inbox/vip"); },
            })).concat([{ key: "add", label: "Sign in with One", hint: "Gmail or Outlook", onSelect: () => nav("/start") }])}
            anchor={
              <button
                type="button"
                onClick={() => setSwitcher((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={switcher}
                aria-label={`Mailbox: ${mb.label}`}
                title={rail ? mb.label : undefined}
                className={cn(
                  "flex h-10 items-center gap-2.5 rounded-md text-left transition-colors hover:bg-card-hover",
                  rail ? "w-10 justify-center" : "w-[204px] border border-border bg-card px-2 hover:border-border-strong",
                )}
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Mail className="size-[13px] stroke-[1.75]" /></span>
                {!rail && (
                  <>
                    <span className="flex min-w-0 flex-1 flex-col leading-none">
                      <span className="truncate text-xs font-medium">{mb.label}</span>
                      <span className="mt-0.5 truncate text-11 text-muted-foreground">{mb.source === "sample" ? "Sample · replayed" : mb.address ?? "Connected"}</span>
                    </span>
                    <ChevronsUpDown className="size-3 text-muted-foreground" />
                  </>
                )}
              </button>
            }
          />
          {user && <AccountLink rail={rail} name={user.name ?? user.email ?? "You"} email={user.name ? user.email : null} avatarUrl={user.avatarUrl} />}
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {reconnect && (
          <div role="alert" className="flex h-9 items-center justify-between gap-3 border-b border-border bg-muted px-4 text-xs">
            <span>Your access was revoked in One. Sign in with One again to continue. Nothing here was deleted.</span>
            <button type="button" className="shrink-0 font-medium underline-offset-2 hover:underline" onClick={() => nav("/start")}>Sign in with One</button>
          </div>
        )}
        <main className="flex min-h-0 flex-1 flex-col">
          <ChatOpenProvider value={chatOpen}>
            <Outlet />
          </ChatOpenProvider>
        </main>
      </div>

      {chatOpen && !large && <div className="fade-in fixed inset-0 z-30 bg-foreground/15 dark:bg-background/70" onMouseDown={() => setChatOpen(false)} aria-hidden />}
      {chatOpen && (
        <ChatPanel
          overlay={!large}
          mailboxId={mb.id}
          width={chatWidth}
          onWidthChange={setChatWidth}
          onClose={() => setChatOpen(false)}
          route={routeContext}
          focusRef={composerFocusRef}
        />
      )}

      <CommandPalette open={palette} onClose={() => setPalette(false)} onToggleTheme={toggleTheme} onCheatsheet={() => setCheat(true)} />
      <Cheatsheet open={cheat} onClose={() => setCheat(false)} />
    </div>
  );
}

/** Who is signed in with One. Opens Settings, where "Signed in as" lives. */
function AccountLink({ rail, name, email, avatarUrl }: { rail: boolean; name: string; email: string | null; avatarUrl: string | null }) {
  return (
    <NavLink
      to="/settings"
      aria-label={`Signed in as ${name}`}
      title={rail ? `${name}${email ? ` · ${email}` : ""}` : undefined}
      className={cn("flex h-10 items-center gap-2.5 rounded-md text-left transition-colors hover:bg-card-hover", rail ? "w-10 justify-center" : "w-[204px] px-2")}
    >
      <Avatar name={name} src={avatarUrl} size="md" />
      {!rail && (
        <span className="flex min-w-0 flex-1 flex-col leading-none">
          <span className="truncate text-xs font-medium">{name}</span>
          {email && <span className="mt-0.5 truncate text-11 text-muted-foreground">{email}</span>}
        </span>
      )}
    </NavLink>
  );
}

function RailLink({ to, label, count, icon, keyHint, active, rail }: { to: string; label: string; count?: number; icon: React.ReactNode; keyHint?: string; active?: boolean; rail: boolean }) {
  const shown = count !== undefined && count > 0;
  return (
    <NavLink
      to={to}
      aria-label={rail ? `${label}${shown ? `, ${count}` : ""}` : undefined}
      title={rail ? `${label}${shown ? ` · ${count}` : ""}${keyHint ? `  (${keyHint})` : ""}` : undefined}
      className={({ isActive }) =>
        cn(
          "group flex h-8 items-center gap-2.5 rounded-md text-13 transition-colors duration-100",
          rail ? "w-10 justify-center" : "px-2",
          isActive || active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-card-hover hover:text-foreground",
        )}
    >
      <span className="[&>svg]:size-4 [&>svg]:stroke-[1.75]">{icon}</span>
      {rail ? null : (
        <>
          <span className="flex-1 truncate">{label}</span>
          {shown && <span className="tnum text-11 text-muted-foreground group-hover:hidden">{count}</span>}
          {keyHint && <span className={cn("hidden text-11 text-muted-foreground/70 group-hover:inline", !shown && "group-hover:inline")}>{keyHint}</span>}
        </>
      )}
    </NavLink>
  );
}

function RailButton({ icon, label, hint, onClick, active, pressed, rail }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void; active?: boolean; pressed?: boolean; rail: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      title={rail ? `${label}  (${hint})` : undefined}
      className={cn(
        "group flex h-8 items-center gap-2.5 rounded-md text-13 transition-colors duration-100",
        rail ? "w-10 justify-center" : "px-2",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-card-hover hover:text-foreground",
      )}
    >
      <span className="[&>svg]:size-4 [&>svg]:stroke-[1.75]">{icon}</span>
      {!rail && (
        <>
          <span className="flex-1 text-left">{label}</span>
          <Kbd className="h-4 min-w-4 bg-transparent px-1 text-10 shadow-none">{hint}</Kbd>
        </>
      )}
    </button>
  );
}
