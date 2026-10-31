import { useEffect, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Bookmark, MessageCircle, Search as SearchIcon, Settings, ShieldCheck } from "lucide-react";
import type { ApiSource, SourceStatus } from "@/contract/api-types";
import { EventsProvider } from "@/lib/events";
import { useKeys } from "@/lib/keys";
import { usePersistedBoolean, usePersistedNumber } from "@/lib/persist";
import { useMe, useSaved, useSources } from "@/lib/queries";
import { useAccounts } from "@/lib/accounts";
import { AccountMark } from "@/components/AccountChip";
import { toggleTheme } from "@/lib/theme";
import { cn, fmtNum, MOD, platformName, useMedia } from "@/lib/utils";
import { WorkspaceProvider, useWorkspace } from "@/lib/workspace";
import { Logo } from "./Logo";
import { SourceLogo } from "./SourceLogo";
import { Avatar } from "./ui/Avatar";
import { Kbd } from "./ui/Kbd";
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

function ShellFrame() {
  const [dockOpen, setDockOpen] = usePersistedBoolean("search.dock.open", false);
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
  const roomy = useMedia("(min-width: 1536px)");
  const rail = !large || (ws.dockOpen && !roomy);

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
      <aside className={cn("flex shrink-0 flex-col border-r border-border bg-faint transition-[width] duration-150 ease-out-quart", rail ? "w-[52px]" : "w-[220px]")} aria-label="Sidebar">
        <div className={cn("flex h-11 shrink-0 items-center gap-2", rail ? "justify-center" : "px-4")}>
          <Logo size={18} />
          {!rail && <span className="text-13 font-semibold tracking-tight">Search</span>}
        </div>
        <div className={cn("flex flex-col gap-px pb-2", rail ? "items-center px-1.5" : "px-2")}>
          <RailButton rail={rail} icon={<SearchIcon />} label="Search" hint="/" onClick={goHome} active={loc.pathname === "/" || loc.pathname.startsWith("/item/")} />
          <RailButton rail={rail} icon={<MessageCircle />} label="Ask" hint={`${MOD}J`} onClick={() => ws.setDockOpen(!ws.dockOpen)} active={ws.dockOpen} pressed={ws.dockOpen} />
        </div>
        <nav className={cn("flex min-h-0 flex-1 flex-col gap-px overflow-y-auto pt-1 scrollbar-none", rail ? "items-center px-1.5" : "px-2")} aria-label="Saved searches and sources">
          {savedList.length > 0 && (
            <>
              {!rail && <p className="label-caps px-2 pb-1 pt-1">Saved searches</p>}
              {savedList.map((s, i) => (
                <button key={s.id} type="button" onClick={() => ws.setQuery(s.query)} title={rail ? `${s.name}  (G ${i + 1})` : s.query} aria-label={s.name}
                  className={cn("group flex h-8 shrink-0 items-center gap-2.5 rounded-md text-13 transition-colors duration-100", rail ? "w-10 justify-center" : "px-2",
                    ws.query === s.query && loc.pathname === "/" ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-card-hover hover:text-foreground")}>
                  <Bookmark className="size-4 shrink-0 stroke-[1.75]" />
                  {!rail && <><span className="min-w-0 flex-1 truncate text-left">{s.name}</span>{i < 9 && <span className="hidden text-11 text-muted-foreground/70 group-hover:inline">G {i + 1}</span>}</>}
                </button>
              ))}
              <div className={cn("my-2 h-px shrink-0 bg-border", rail ? "w-6" : "mx-2")} />
            </>
          )}
          {!rail && <p className="label-caps px-2 pb-1 pt-1">Sources</p>}
          {[...byPlatform.entries()].map(([platform, list]) => {
            const r = rollup(list);
            const to = `/sources/${list[0]!.id}`;
            return (
              <NavLink key={platform} to={to} title={rail ? `${platformName(platform)} · ${fmtNum(r.items)}` : undefined} aria-label={`${platformName(platform)}, ${r.status}, ${r.items} items`}
                className={() => cn("group flex h-8 shrink-0 items-center gap-2.5 rounded-md text-13 transition-colors duration-100", rail ? "relative w-10 justify-center" : "px-2",
                  !accounts.isMulti(platform) && list.some((s) => loc.pathname === `/sources/${s.id}`) ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-card-hover hover:text-foreground")}>
                <SourceLogo platform={platform} size={16} />
                {rail ? (r.status !== "healthy" && <HealthDot status={r.status} className="absolute right-1.5 top-1.5" />) : (
                  <>
                    <span className="min-w-0 flex-1 truncate">{platformName(platform)}</span>
                    <HealthDot status={r.status} />
                    <span className="tnum w-9 text-right text-11 text-muted-foreground">{fmtNum(r.items)}</span>
                  </>
                )}
              </NavLink>
            );
          }).flatMap((link, idx) => {
            // two accounts on one platform: each one under it, with its own count
            const platform = [...byPlatform.keys()][idx]!;
            const accts = rail ? [] : accounts.byPlatform.get(platform) ?? [];
            if (accts.length < 2) return [link];
            return [link, ...accts.map((a) => (
              <NavLink key={`${platform}|${a.label}`} to={`/sources/${a.sourceIds[0]}`} title={a.label} aria-label={`${platformName(platform)}, ${a.label}, ${a.items} items`} data-testid={`sidebar-account-${a.short}`}
                className={() => cn("flex h-7 shrink-0 items-center gap-2 rounded-md pl-7 pr-2 text-xs transition-colors duration-100",
                  a.sourceIds.some((id) => loc.pathname === `/sources/${id}`) ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-card-hover hover:text-foreground")}>
                <AccountMark text={a.mark} />
                <span className="min-w-0 flex-1 truncate">{a.short}</span>
                <span className="tnum w-9 text-right text-11 text-muted-foreground">{fmtNum(a.items)}</span>
              </NavLink>
            ))];
          })}
          <div className={cn("my-2 h-px shrink-0 bg-border", rail ? "w-6" : "mx-2")} />
          <RailLink rail={rail} to="/settings" label="Settings" icon={<Settings />} keyHint="G ," />
          <RailLink rail={rail} to="/access" label="Access" icon={<ShieldCheck />} keyHint="G A" />
        </nav>
        <div className={cn("flex shrink-0 flex-col gap-1.5 p-2", rail && "items-center px-1.5")}>
          {!rail && (
            <NavLink to={indexing ? `/sources/${indexing.id}` : "/settings/integrations"} className="flex h-7 items-center gap-2 rounded-md px-2 text-11 text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground" data-testid="indexing-chip">
              <HealthDot status={indexing ? "syncing" : rollup(sources.data?.sources ?? []).status === "healthy" ? "healthy" : "degraded"} />
              <span className="truncate">
                {indexing
                  ? `Indexing ${indexing.name} ${indexing.health.progress?.estimate ? `${Math.round(((indexing.health.progress.done ?? 0) / indexing.health.progress.estimate) * 100)}%` : ""}`
                  : `${fmtNum((sources.data?.sources ?? []).reduce((n, s) => n + s.health.itemCount, 0))} items indexed`}
              </span>
            </NavLink>
          )}
          {user && (
            <NavLink to="/settings/general" aria-label={`Signed in as ${user.name ?? user.email}`} title={rail ? `${user.name} · ${user.email}` : undefined}
              className={cn("flex h-10 items-center gap-2.5 rounded-md text-left transition-colors hover:bg-card-hover", rail ? "w-10 justify-center" : "px-2")}>
              <Avatar name={user.name ?? user.email ?? "You"} src={user.avatarUrl} size="md" />
              {!rail && (
                <span className="flex min-w-0 flex-1 flex-col leading-none">
                  <span className="truncate text-xs font-medium">{user.name ?? user.email}</span>
                  <span className="mt-0.5 truncate text-11 text-muted-foreground">{user.isSample ? "Acme sample" : user.email}</span>
                </span>
              )}
            </NavLink>
          )}
        </div>
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>

      {ws.dockOpen && !large && <div className="fade-in fixed inset-0 z-30 bg-foreground/15 dark:bg-background/70" onMouseDown={() => ws.setDockOpen(false)} aria-hidden />}
      {ws.dockOpen && <ChatDock overlay={!large} width={dockWidth} onWidthChange={setDockWidth} onClose={() => ws.setDockOpen(false)} />}

      <CommandPalette open={palette} onClose={() => setPalette(false)} onToggleTheme={toggleTheme} onCheatsheet={() => setCheat(true)} />
      <Cheatsheet open={cheat} onClose={() => setCheat(false)} />
    </div>
  );
}

function RailLink({ to, label, icon, keyHint, rail }: { to: string; label: string; icon: React.ReactNode; keyHint?: string; rail: boolean }) {
  return (
    <NavLink to={to} aria-label={rail ? label : undefined} title={rail ? `${label}${keyHint ? `  (${keyHint})` : ""}` : undefined}
      className={({ isActive }) => cn("group flex h-8 shrink-0 items-center gap-2.5 rounded-md text-13 transition-colors duration-100", rail ? "w-10 justify-center" : "px-2",
        isActive ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-card-hover hover:text-foreground")}>
      <span className="[&>svg]:size-4 [&>svg]:stroke-[1.75]">{icon}</span>
      {!rail && (
        <>
          <span className="flex-1 truncate">{label}</span>
          {keyHint && <span className="hidden text-11 text-muted-foreground/70 group-hover:inline">{keyHint}</span>}
        </>
      )}
    </NavLink>
  );
}

function RailButton({ icon, label, hint, onClick, active, pressed, rail }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void; active?: boolean; pressed?: boolean; rail: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={pressed} aria-label={label} title={rail ? `${label}  (${hint})` : undefined}
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
  );
}
