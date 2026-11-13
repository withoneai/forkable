import { STATUS_WORD } from "@/lib/copy";
import { useEffect, useRef, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Bookmark, Bot, MessageCircle, PanelLeftClose, PanelLeftOpen, Search as SearchIcon, Settings, ShieldCheck } from "lucide-react";
import type { ApiSource, SourceStatus } from "@/contract/api-types";
import { EventsProvider } from "@/lib/events";
import { useKeys } from "@/lib/keys";
import { usePersistedBoolean, usePersistedChoice, usePersistedNumber } from "@/lib/persist";
import { useMe, useSaved, useSources } from "@/lib/queries";
import { useAccounts } from "@/lib/accounts";
import { toggleTheme } from "@/lib/theme";
import { cn, fmtNum, MOD, platformName, useMedia } from "@/lib/utils";
import { WorkspaceProvider, useWorkspace } from "@/lib/workspace";
import { Logo } from "./Logo";
import { SourceLogo } from "./SourceLogo";
import { Avatar } from "./ui/Avatar";
import { Kbd } from "./ui/Kbd";
import { Tooltip } from "./ui/Tooltip";
import { CommandPalette } from "./CommandPalette";
import { Cheatsheet } from "./Cheatsheet";
import { ChatDock } from "./chat/ChatDock";

export function Shell() {
  const me = useMe();
  if (me.isPending) return <Splash />;
  if (me.data && !me.data.signedIn) return <Navigate to="/start" replace />;
  return (
    <EventsProvider enabled={!!me.data?.signedIn}>
      <ShellFrame />
    </EventsProvider>
  );
}

export function Splash() {
  return (
    <div className="flex h-full items-center justify-center" role="status" aria-label="Loading">
      <Logo size={28} className="pulse-dot" />
    </div>
  );
}

const SIDEBAR_W = 220;
const DOCK_MIN = 300;
/** The narrowest the page between the sidebar and the assistant may get before the sidebar folds to icons. */
const PAGE_MIN = 560;

function useViewportWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => { const on = () => setW(window.innerWidth); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on); }, []);
  return w;
}

/** Where the assistant helps: searching and reading (results, an item, a person or company page). */
const readingPath = (p: string) => p === "/" || p.startsWith("/item/") || p.startsWith("/people/") || p.startsWith("/companies/");

function ShellFrame() {
  // The assistant stays as she left it while searching and reading (remembered), and is
  // closed everywhere else: on Settings, Access and sources it opens only when she asks,
  // and closes again when she moves to another page there.
  const loc = useLocation();
  const [readOpen, setReadOpen] = usePersistedBoolean("search.dock.open", false);
  const [elseOpen, setElseOpen] = useState(false);
  useEffect(() => { setElseOpen(false); }, [loc.pathname]);
  const reading = readingPath(loc.pathname);
  const dockOpen = reading ? readOpen : elseOpen;
  const setDockOpen = reading ? setReadOpen : setElseOpen;
  return (
    <WorkspaceProvider dockOpen={dockOpen} setDockOpen={setDockOpen}>
      <ShellInner />
    </WorkspaceProvider>
  );
}

/** Platform health rolled up from its sources: the worst status wins. */
const RANK: SourceStatus[] = ["auth_needed", "grant_blocked", "error", "rate_limited", "degraded", "syncing", "new", "awaiting_grant", "paused", "healthy"];
export function rollup(list: ApiSource[]): { status: SourceStatus; items: number } {
  const status = [...list].sort((a, b) => RANK.indexOf(a.health.status) - RANK.indexOf(b.health.status))[0]?.health.status ?? "new";
  return { status, items: list.reduce((n, s) => n + s.health.itemCount, 0) };
}

export function HealthDot({ status, className }: { status: SourceStatus; className?: string }) {
  const tone = status === "healthy" ? "bg-success-text"
    : status === "syncing" || status === "new" ? "bg-accent pulse-dot"
    : status === "degraded" || status === "rate_limited" ? "bg-warning-text"
    : status === "paused" || status === "awaiting_grant" ? "bg-muted-foreground/50"
    : "bg-destructive-text";
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full", tone, className)} />;
}

function ShellInner() {
  const ws = useWorkspace();
  const me = useMe();
  const nav = useNavigate();
  const loc = useLocation();
  const saved = useSaved();
  const sources = useSources();
  const accounts = useAccounts();
  const [palette, setPalette] = useState(false);
  const [cheat, setCheat] = useState(false);
  const [dockWidth, setDockWidth] = usePersistedNumber("search.dock.width", 360);
  const large = useMedia("(min-width: 1024px)");
  const viewport = useViewportWidth();
  // "auto" keeps the names whenever the page still has room: with the assistant open it
  // first narrows the assistant (down to DOCK_MIN), and folds to icons only when even
  // then the page would be narrower than PAGE_MIN. She can pin names or icons.
  const [sidebar, setSidebar] = usePersistedChoice("search.sidebar", ["auto", "labels", "icons"] as const, "auto");
  const dockFit = ws.dockOpen && large ? Math.max(DOCK_MIN, Math.min(dockWidth, viewport - SIDEBAR_W - PAGE_MIN)) : dockWidth;
  const roomForNames = viewport - SIDEBAR_W - (ws.dockOpen && large ? dockFit : 0) >= PAGE_MIN;
  const rail = sidebar === "icons" ? true : sidebar === "labels" ? false : !large || !roomForNames;
  // with icons only, names show on hover or keyboard focus, over the page, without moving it
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPeek = () => { if (!rail) return; if (peekTimer.current) clearTimeout(peekTimer.current); peekTimer.current = setTimeout(() => setPeek(true), 350); };
  const endPeek = () => { if (peekTimer.current) clearTimeout(peekTimer.current); setPeek(false); };
  useEffect(() => { if (!rail) setPeek(false); }, [rail]);
  useEffect(() => { setPeek(false); }, [loc.pathname]);
  const folded = rail && !peek;

  const user = me.data?.user ?? null;
  const goHome = () => { nav("/"); setTimeout(() => ws.boxFocus.current?.(), 0); };
  const savedList = saved.data ?? [];

  useKeys({ "mod+k": () => setPalette((v) => !v) }, { whileTyping: true });
  useKeys({
    "mod+j": () => ws.setDockOpen(!ws.dockOpen),
    "mod+shift+j": () => ws.askAbout(),
    "shift+?": () => setCheat((v) => !v),
    "?": () => setCheat((v) => !v),
    "/": () => { if (loc.pathname !== "/") nav(`/${ws.query ? `?q=${encodeURIComponent(ws.query)}` : ""}`); setTimeout(() => ws.boxFocus.current?.(), 0); },
    "g h": goHome,
    "g i": () => { nav("/settings/integrations"); },
    "g a": () => { nav("/access"); },
    "g ,": () => { nav("/settings/general"); },
    "g p": () => ws.setQuery("type:person"),
    ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`g ${i + 1}`, () => { const s = savedList[i]; if (s) ws.setQuery(s.query); else return false; }])),
  });
  useEffect(() => { setPalette(false); }, [loc.pathname]);

  // Sources grouped by platform for the sidebar.
  const byPlatform = new Map<string, ApiSource[]>();
  for (const s of sources.data?.sources ?? []) byPlatform.set(s.platform, [...(byPlatform.get(s.platform) ?? []), s]);
  const indexing = (sources.data?.sources ?? []).find((s) => s.health.status === "syncing");

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground">
      <div className={cn("relative shrink-0 transition-[width] duration-150 ease-out-quart", rail ? "w-[52px]" : "w-[220px]")} data-testid="sidebar-slot">
      <aside
        className={cn("absolute inset-y-0 left-0 flex flex-col border-r border-border bg-faint transition-[width] duration-150 ease-out-quart", folded ? "w-[52px]" : "w-[220px]", rail && peek && "z-40 shadow-[4px_0_24px_rgb(0_0_0/0.12)]")}
        aria-label="Sidebar" data-folded={folded ? "1" : undefined} data-peek={rail && peek ? "1" : undefined}
        onMouseEnter={startPeek} onMouseLeave={endPeek}
        onFocus={(e) => { if (rail && e.target instanceof HTMLElement && e.target.matches(":focus-visible")) setPeek(true); }}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) endPeek(); }}
      >
        <div className={cn("flex shrink-0 items-center gap-2", folded ? "h-auto flex-col justify-center gap-1 pb-1 pt-3" : "h-11 pl-4 pr-2")}>
          <Logo size={18} />
          {!folded && <span className="flex-1 text-13 font-semibold tracking-tight">Search</span>}
          <Tooltip label={rail ? "Keep the names showing" : "Show icons only"}>
            <button type="button" onClick={() => { endPeek(); setSidebar(rail ? "labels" : "icons"); }} aria-label={rail ? "Keep the names showing" : "Show icons only"} aria-expanded={!folded} data-testid="sidebar-toggle"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground [&>svg]:size-4 [&>svg]:stroke-[1.75]">
              {rail ? <PanelLeftOpen /> : <PanelLeftClose />}
            </button>
          </Tooltip>
        </div>
        <div className={cn("flex flex-col gap-px pb-2", folded ? "items-center px-1.5" : "px-2")}>
          <RailButton rail={folded} icon={<SearchIcon />} label="Search" hint="/" onClick={goHome} active={loc.pathname === "/" || loc.pathname.startsWith("/item/")} />
          <RailButton rail={folded} icon={<MessageCircle />} label="Ask" hint={`${MOD}J`} onClick={() => ws.setDockOpen(!ws.dockOpen)} active={ws.dockOpen} pressed={ws.dockOpen} />
        </div>
        <nav className={cn("flex min-h-0 flex-1 flex-col gap-px overflow-y-auto pt-1 scrollbar-none", folded ? "items-center px-1.5" : "px-2")} aria-label="Saved searches and sources">
          {savedList.length > 0 && (
            <>
              {!folded && <p className="label-caps px-2 pb-1 pt-1">Saved searches</p>}
              {savedList.map((s, i) => (
                <button key={s.id} type="button" onClick={() => ws.setQuery(s.query)} title={folded ? `${s.name}  (G ${i + 1})` : s.query} aria-label={s.name}
                  className={cn("group flex h-8 shrink-0 items-center gap-2.5 rounded-md text-13 transition-colors duration-100", folded ? "w-10 justify-center" : "px-2",
                    ws.query === s.query && loc.pathname === "/" ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-card-hover hover:text-foreground")}>
                  <Bookmark className="size-4 shrink-0 stroke-[1.75]" />
                  {!folded && <><span className="min-w-0 flex-1 truncate text-left">{s.name}</span>{i < 9 && <span className="hidden text-11 text-muted-foreground/70 group-hover:inline">G {i + 1}</span>}</>}
                </button>
              ))}
              <div className={cn("my-2 h-px shrink-0 bg-border", folded ? "w-6" : "mx-2")} />
            </>
          )}
          {!folded && <p className="label-caps px-2 pb-1 pt-1">Sources</p>}
          {[...byPlatform.entries()].map(([platform, list]) => {
            const r = rollup(list);
            const to = `/sources/${list[0]!.id}`;
            return (
              <RailTip key={platform} rail={folded} label={`${platformName(platform)}, ${STATUS_WORD[r.status].toLowerCase()}, ${fmtNum(r.items)} items`}>
              <NavLink to={to} aria-label={`${platformName(platform)}, ${STATUS_WORD[r.status]}, ${r.items} items`}
                className={() => cn("group flex h-8 shrink-0 items-center gap-2.5 rounded-md text-13 transition-colors duration-100", folded ? "relative w-10 justify-center" : "px-2",
                  !accounts.isMulti(platform) && list.some((s) => loc.pathname === `/sources/${s.id}`) ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-card-hover hover:text-foreground")}>
                <SourceLogo platform={platform} size={16} />
                {folded ? (r.status !== "healthy" && <HealthDot status={r.status} className="absolute right-1.5 top-1.5" />) : (
                  <>
                    <span className="min-w-0 flex-1 truncate">{platformName(platform)}</span>
                    <HealthDot status={r.status} />
                    <span className="tnum w-9 text-right text-11 text-muted-foreground">{fmtNum(r.items)}</span>
                  </>
                )}
              </NavLink>
              </RailTip>
            );
          }).flatMap((link, idx) => {
            // two accounts on one platform: each one under it, with its own count
            const platform = [...byPlatform.keys()][idx]!;
            const accts = folded ? [] : accounts.byPlatform.get(platform) ?? [];
            if (accts.length < 2) return [link];
            return [link, ...accts.map((a) => (
              <NavLink key={`${platform}|${a.label}`} to={`/sources/${a.sourceIds[0]}`} title={a.label} aria-label={`${platformName(platform)}, ${a.label}, ${a.items} items`} data-testid={`sidebar-account-${a.short}`}
                className={() => cn("flex h-7 shrink-0 items-center gap-2 rounded-md pl-9 pr-2 text-xs transition-colors duration-100",
                  a.sourceIds.some((id) => loc.pathname === `/sources/${id}`) ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-card-hover hover:text-foreground")}>
                <span className="min-w-0 flex-1 truncate">{a.label}</span>
                <span className="tnum w-9 text-right text-11 text-muted-foreground">{fmtNum(a.items)}</span>
              </NavLink>
            ))];
          })}
          <div className={cn("my-2 h-px shrink-0 bg-border", folded ? "w-6" : "mx-2")} />
          <RailLink rail={folded} to="/settings/agents" label="Agents" icon={<Bot />} />
          <RailLink rail={folded} to="/settings" label="Settings" icon={<Settings />} keyHint="G ," notUnder="/settings/agents" />
          <RailLink rail={folded} to="/access" label="Access" icon={<ShieldCheck />} keyHint="G A" />
        </nav>
        <div className={cn("flex shrink-0 flex-col gap-1.5 p-2", folded && "items-center px-1.5")}>
          {!folded && (
            <NavLink to={indexing ? `/sources/${indexing.id}` : "/settings/integrations"} className="flex h-7 items-center gap-2 rounded-md px-2 text-11 text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground" data-testid="indexing-chip">
              <HealthDot status={indexing ? "syncing" : rollup(sources.data?.sources ?? []).status === "healthy" ? "healthy" : "degraded"} />
              <span className="truncate">
                {indexing
                  ? `Updating ${indexing.name} ${indexing.health.progress?.estimate ? `${Math.round(((indexing.health.progress.done ?? 0) / indexing.health.progress.estimate) * 100)}%` : ""}`
                  : `${fmtNum((sources.data?.sources ?? []).reduce((n, s) => n + s.health.itemCount, 0))} items found`}
              </span>
            </NavLink>
          )}
          {user && (
            <NavLink to="/settings/general" aria-label={`Signed in as ${user.name ?? user.email}`} title={folded ? `${user.name} · ${user.email}` : undefined}
              className={cn("flex h-10 items-center gap-2.5 rounded-md text-left transition-colors hover:bg-card-hover", folded ? "w-10 justify-center" : "px-2")}>
              <Avatar name={user.name ?? user.email ?? "You"} src={user.avatarUrl} size="md" />
              {!folded && (
                <span className="flex min-w-0 flex-1 flex-col leading-none">
                  <span className="truncate text-xs font-medium">{user.name ?? user.email}</span>
                  <span className="mt-0.5 truncate text-11 text-muted-foreground">{user.isSample ? "Acme sample" : user.email}</span>
                </span>
              )}
            </NavLink>
          )}
        </div>
      </aside>
      </div>

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>

      {ws.dockOpen && !large && <div className="fade-in fixed inset-0 z-30 bg-foreground/15 dark:bg-background/70" onMouseDown={() => ws.setDockOpen(false)} aria-hidden />}
      {ws.dockOpen && <ChatDock overlay={!large} width={dockFit} onWidthChange={setDockWidth} onClose={() => ws.setDockOpen(false)} />}

      <CommandPalette open={palette} onClose={() => setPalette(false)} onToggleTheme={toggleTheme} onCheatsheet={() => setCheat(true)} />
      <Cheatsheet open={cheat} onClose={() => setCheat(false)} />
    </div>
  );
}

function RailLink({ to, label, icon, keyHint, rail, notUnder }: { to: string; label: string; icon: React.ReactNode; keyHint?: string; rail: boolean; notUnder?: string }) {
  const loc = useLocation();
  const excluded = !!notUnder && loc.pathname.startsWith(notUnder);
  return (
    <RailTip rail={rail} label={`${label}${keyHint ? `  (${keyHint})` : ""}`}>
    <NavLink to={to} aria-label={rail ? label : undefined}
      className={({ isActive }) => cn("group flex h-8 shrink-0 items-center gap-2.5 rounded-md text-13 transition-colors duration-100", rail ? "w-10 justify-center" : "px-2",
        isActive && !excluded ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-card-hover hover:text-foreground")}>
      <span className="[&>svg]:size-4 [&>svg]:stroke-[1.75]">{icon}</span>
      {!rail && (
        <>
          <span className="flex-1 truncate">{label}</span>
          {keyHint && <span className="hidden text-11 text-muted-foreground/70 group-hover:inline">{keyHint}</span>}
        </>
      )}
    </NavLink>
    </RailTip>
  );
}

function RailButton({ icon, label, hint, onClick, active, pressed, rail }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void; active?: boolean; pressed?: boolean; rail: boolean }) {
  return (
    <RailTip rail={rail} label={`${label}  (${hint})`}>
    <button type="button" onClick={onClick} aria-pressed={pressed} aria-label={label}
      className={cn("group flex h-8 items-center gap-2.5 rounded-md text-13 transition-colors duration-100", rail ? "w-10 justify-center" : "px-2",
        active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-card-hover hover:text-foreground")}>
      <span className="[&>svg]:size-4 [&>svg]:stroke-[1.75]">{icon}</span>
      {!rail && (
        <>
          <span className="flex-1 text-left">{label}</span>
          <Kbd className="h-4 min-w-4 bg-transparent px-1 text-10 shadow-none">{hint}</Kbd>
        </>
      )}
    </button>
    </RailTip>
  );
}

/** In the icon rail every item names itself on hover and focus; with labels showing it needs nothing. */
function RailTip({ rail, label, children }: { rail: boolean; label: string; children: React.ReactElement<Record<string, unknown>> }) {
  return rail ? <Tooltip label={label}>{children}</Tooltip> : children;
}
