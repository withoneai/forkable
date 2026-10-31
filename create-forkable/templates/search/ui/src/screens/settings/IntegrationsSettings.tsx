// Settings, Integrations (search-ux-mobbin.md 2.8): the sources table with
// health, the one banner that counts what is wrong, what else the grant allows,
// and New profile (N), which opens the sheet at /settings/integrations/new.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Link2, MoreHorizontal, Plus, RefreshCw } from "lucide-react";
import { useConnectMore } from "@/lib/connectMore";
import { api } from "@/lib/api";
import { useKeys } from "@/lib/keys";
import { keys, useSources } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn, fmtNum } from "@/lib/utils";
import { rollup } from "@/components/Shell";
import { SourceLogo } from "@/components/SourceLogo";
import { AccountMark } from "@/components/AccountChip";
import { markFor } from "@/lib/accounts";
import { groupSources, StatusCell } from "@/components/profile/health";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { Menu } from "@/components/ui/Menu";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";
import { NewProfileSheet } from "./NewProfileSheet";

export function IntegrationsSettings() {
  const splat = useParams()["*"] ?? "";
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useSources();
  const [sel, setSel] = useState(0);
  const [menu, setMenu] = useState<string | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const sheetOpen = splat === "new";
  const groups = groupSources(q.data?.sources ?? []);

  useKeys({
    n: () => { nav("/settings/integrations/new"); },
    j: () => setSel((i) => Math.min(groups.length - 1, i + 1)),
    k: () => setSel((i) => Math.max(0, i - 1)),
    arrowdown: () => setSel((i) => Math.min(groups.length - 1, i + 1)),
    arrowup: () => setSel((i) => Math.max(0, i - 1)),
    enter: () => { const g = groups[sel]; if (g) nav(`/sources/${g.sources[0]!.id}`); else return false; },
  }, { enabled: !sheetOpen });
  useEffect(() => { rowRefs.current[sel]?.scrollIntoView({ block: "nearest" }); }, [sel]);

  const refresh = () => qc.invalidateQueries({ queryKey: keys.sources });
  const syncAll = async (ids: string[]) => {
    try { await Promise.all(ids.map((id) => api.syncSource(id))); toast({ title: ids.length > 1 ? `Syncing ${ids.length} models` : "Syncing", detail: "Watch it in the status column" }); }
    catch (e) { toast({ title: "Could not start a sync", detail: (e as Error).message, tone: "destructive" }); }
    void refresh();
  };
  const setPaused = async (ids: string[], paused: boolean) => {
    try { await Promise.all(ids.map((id) => api.patchSource(id, { paused }))); toast({ title: paused ? "Paused" : "Resumed", detail: paused ? "Nothing is fetched until you resume" : "Back on its schedule" }); }
    catch (e) { toast({ title: "Did not change", detail: (e as Error).message, tone: "destructive" }); }
    void refresh();
  };
  const remove = async (ids: string[], name: string) => {
    try { await Promise.all(ids.map((id) => api.deleteSource(id))); toast({ title: `Removed ${name}`, detail: "Its items are gone from your index. The connection stays in One." }); }
    catch (e) { toast({ title: "Could not remove it", detail: (e as Error).message, tone: "destructive" }); }
    void refresh();
  };

  const connect = useConnectMore();
  const data = q.data;
  const banner = data?.banner;
  return (
    <div className="flex flex-col gap-6" data-testid="integrations">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-15 font-semibold tracking-tight">Sources</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Each source is a profile on one of your One connections.</p>
        </div>
        <div className="flex items-center gap-2">
        <Button variant="default" icon={<Link2 />} loading={connect.open} onClick={connect.start} data-testid="connect-more">
          Connect accounts
        </Button>
        <Button variant="primary" icon={<Plus />} trailing={<Kbd className="border-primary-foreground/20 bg-transparent text-primary-foreground/70 shadow-none">N</Kbd>} onClick={() => nav("/settings/integrations/new")} data-testid="new-profile">
          New profile
        </Button>
        </div>
      </div>

      {banner && (
        <div role="alert" className="flex items-center gap-3 rounded-lg border border-warning-text/30 bg-warning-text/[0.07] px-3 py-2.5 text-13">
          <AlertTriangle className="size-4 shrink-0 text-warning-text" />
          <span className="min-w-0 flex-1">{banner.text}</span>
          <Button size="sm" variant="default" onClick={() => {
            if (banner.action === "retry") void syncAll(banner.sourceId ? [banner.sourceId] : []);
            else if (banner.action === "reconnect") nav("/start");
            else window.open("https://app.withone.ai", "_blank", "noopener");
          }}>
            {banner.action === "retry" ? "Retry now" : banner.action === "reconnect" ? "Reconnect" : "Manage in One"}
          </Button>
        </div>
      )}

      {q.isError && !data ? (
        <LoadError what="Sources" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} className="rounded-lg border border-border bg-card" />
      ) : !data ? (
        <ListSkeleton rows={6} />
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong p-6 text-center text-13 text-muted-foreground">
          Search reads the tools you connect. Add one to start.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card" role="table" aria-label="Sources">
          <div role="row" className="flex h-8 items-center gap-3 border-b border-border bg-faint px-3 text-11 font-medium text-muted-foreground">
            <span role="columnheader" className="min-w-0 flex-[1.4]">Source</span>
            <span role="columnheader" className="hidden min-w-0 flex-1 md:block">Models</span>
            <span role="columnheader" className="w-[180px] shrink-0">Status</span>
            <span role="columnheader" className="w-14 shrink-0 text-right">Items</span>
            <span className="w-7 shrink-0" />
          </div>
          {groups.map((g, i) => {
            // two accounts on one platform: a platform header once, then each account nested under it
            const siblings = groups.filter((x) => x.platform === g.platform);
            const multi = siblings.length > 1;
            const firstOfPlatform = siblings[0] === g;
            const header = multi && firstOfPlatform ? (
              <div key={`${g.platform}-header`} role="row" className="flex h-10 items-center gap-3 border-b border-border bg-faint px-3" data-testid={`platform-group-${g.platform}`}>
                <span className="flex min-w-0 flex-[1.4] items-center gap-2.5">
                  <SourceLogo platform={g.platform} size={20} />
                  <span className="truncate text-13 font-medium">{g.name}</span>
                  <span className="rounded-full border border-border px-1.5 text-11 text-muted-foreground">{siblings.length} accounts</span>
                </span>
                <span className="hidden min-w-0 flex-1 md:block" />
                <span className="w-[180px] shrink-0" />
                <span className="tnum w-14 shrink-0 text-right text-13 text-muted-foreground">{fmtNum(siblings.reduce((n, x) => n + rollup(x.sources).items, 0))}</span>
                <span className="w-7 shrink-0" />
              </div>
            ) : null;
            const r = rollup(g.sources);
            const live = g.sources.find((s) => s.health.status === "syncing" || s.health.status === "new");
            const shown = live?.health ?? g.sources.find((s) => s.health.status === r.status)!.health;
            const ids = g.sources.map((s) => s.id);
            const paused = g.sources.every((s) => s.health.status === "paused");
            const models = g.sources.map((s) => s.profile.title);
            return [header, (
              <div
                key={g.key}
                ref={(el) => { rowRefs.current[i] = el; }}
                role="row"
                tabIndex={-1}
                aria-selected={sel === i}
                data-testid={`source-row-${g.platform}`}
                onClick={() => { setSel(i); nav(`/sources/${g.sources[0]!.id}`); }}
                className={cn("relative flex h-12 items-center gap-3 border-b border-border px-3 transition-colors duration-100 last:border-b-0 hover:bg-card-hover", sel === i && "bg-muted hover:bg-muted")}
              >
                {sel === i && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[2px] rounded-r bg-accent" />}
                {/* nested accounts indent inside the cell (a margin), so the other columns stay aligned */}
                <span role="cell" className="flex min-w-0 flex-[1.4] items-center gap-2.5">
                  {multi && <span aria-hidden className="w-4.5 shrink-0" />}
                  {multi ? <AccountMark text={markFor(g.connectionLabel, siblings.map((x) => x.connectionLabel))} className="size-5 text-11" /> : <SourceLogo platform={g.platform} size={20} />}
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1.5 truncate text-13 font-medium">
                      {multi ? g.connectionLabel : g.name}
                      {g.sources.some((s) => s.profile.origin !== "builtin") && <span className="rounded-sm bg-muted px-1 text-10 font-medium text-muted-foreground">Custom</span>}
                    </span>
                    <span className="truncate text-11 text-muted-foreground">{multi ? `${g.name} account` : g.connectionLabel}</span>
                  </span>
                </span>
                <span role="cell" className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground md:block" title={models.join(", ")}>
                  {models.length > 3 ? `${models.length} models` : models.join(", ")}
                </span>
                <span role="cell" className="w-[180px] shrink-0"><StatusCell health={shown} /></span>
                <span role="cell" className="tnum w-14 shrink-0 text-right text-13">{fmtNum(r.items)}</span>
                <span className="w-7 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Menu
                    open={menu === g.key}
                    onClose={() => setMenu(null)}
                    align="end"
                    items={[
                      { key: "sync", label: "Sync now", onSelect: () => void syncAll(ids) },
                      { key: "pause", label: paused ? "Resume" : "Pause", onSelect: () => void setPaused(ids, !paused) },
                      { key: "edit", label: "Edit profile", onSelect: () => nav(`/sources/${ids[0]}?tab=fields`) },
                      { key: "reconnect", label: "Reconnect", onSelect: () => nav("/start"), disabled: r.status !== "auth_needed" },
                      { key: "remove", label: "Remove", tone: "destructive", onSelect: () => void remove(ids, g.name) },
                    ]}
                    anchor={
                      <button type="button" aria-label={`Actions for ${g.name}`} aria-haspopup="menu" aria-expanded={menu === g.key} onClick={() => setMenu((m) => (m === g.key ? null : g.key))}
                        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground">
                        <MoreHorizontal className="size-4" />
                      </button>
                    }
                  />
                </span>
              </div>
            )];
          })}
        </div>
      )}

      {data && data.available.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-13 font-semibold">Available in your grant</h3>
          <p className="-mt-1 text-xs text-muted-foreground">Connected in One, with no profile yet. Add one and Search starts indexing it.</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {data.available.map((a) => (
              <div key={a.connectionKey} className="flex h-12 items-center gap-2.5 rounded-lg border border-border bg-card px-3">
                <SourceLogo platform={a.platform} size={20} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-13 font-medium">{a.name}</span>
                  <span className="truncate text-11 text-muted-foreground">{a.connectionLabel}</span>
                </span>
                <Button size="sm" icon={<Plus />} onClick={() => nav(`/settings/integrations/new?platform=${a.platform}`)}>Add</Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {data && data.notInApp.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-13 font-semibold">Not in this app yet</h3>
          <p className="-mt-1 text-xs text-muted-foreground">These need adding to the Connect app's ask first. New profile walks you through it.</p>
          <div className="flex flex-wrap gap-2">
            {data.notInApp.map((a) => (
              <button key={a.platform} type="button" onClick={() => nav(`/settings/integrations/new?platform=${a.platform}`)}
                className="group flex h-8 items-center gap-2 rounded-md border border-border bg-faint px-2.5 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground">
                <SourceLogo platform={a.platform} size={14} className="opacity-70 grayscale group-hover:opacity-100 group-hover:grayscale-0" />
                {a.name}
                <ExternalLink className="size-3 opacity-60" />
              </button>
            ))}
          </div>
        </section>
      )}

      <p className="flex items-center gap-1.5 text-11 text-muted-foreground">
        <RefreshCw className="size-3" />
        Search only reads. Every call runs on your grant and shows up in Access.
      </p>

      {sheetOpen && <NewProfileSheet onClose={() => nav("/settings/integrations")} />}
    </div>
  );
}
