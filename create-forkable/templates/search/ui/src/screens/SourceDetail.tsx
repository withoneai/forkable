// Source detail (search-ux-mobbin.md 2.10): status pill before the name, the
// sync line, Sync now (R), and Overview, Fields, Runs, Errors. Live through
// the server's SSE "source" and "run" events (lib/events.tsx invalidates).
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Download, MoreHorizontal, RefreshCw, RotateCcw } from "lucide-react";
import type { ApiItemError, ApiRun, ApiSource, SourceStatus } from "@/contract/api-types";
import { api } from "@/lib/api";
import { useKeys } from "@/lib/keys";
import { keys, useErrors, usePatchSource, useProfiles, useRuns, useSource, useSources, useSyncSource } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn, fmtAgo, fmtClock, fmtNum, KIND_LABEL, platformName } from "@/lib/utils";
import { SourceLogo } from "@/components/SourceLogo";
import { HealthDot } from "@/components/Shell";
import { everyLabel, healthLine, isProblem, StatusPill, STATUS_WORD } from "@/components/profile/health";
import { profileToRows } from "@/components/profile/fieldmap";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Kbd } from "@/components/ui/Kbd";
import { Menu } from "@/components/ui/Menu";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";
import { Tabs } from "@/components/ui/Tabs";

type Tab = "overview" | "fields" | "runs" | "errors";
const DIMMED: SourceStatus[] = ["auth_needed", "grant_blocked"];

export function SourceDetail() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? "overview";
  const setTab = (t: Tab) => setParams(t === "overview" ? {} : { tab: t }, { replace: true });
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useSource(id);
  const all = useSources();
  const runs = useRuns(id);
  const errors = useErrors(id);
  const sync = useSyncSource();
  const patch = usePatchSource();
  const [menu, setMenu] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const s = q.data;
  const doSync = () => {
    if (!s) return;
    sync.mutate({ id: s.id }, {
      onSuccess: () => toast({ title: `Syncing ${sourceLabel(s)}` }),
      onError: (e) => toast({ title: "Did not start", detail: e.message, tone: "destructive" }),
    });
  };
  useKeys({
    r: () => { doSync(); },
    "1": () => setTab("overview"), "2": () => setTab("fields"), "3": () => setTab("runs"), "4": () => setTab("errors"),
  }, { enabled: !!s && !confirmRemove });

  if (q.isError && !s) return <div className="p-6"><LoadError what="This source" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} /></div>;
  if (!s) return <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-6 pt-7"><Skeleton className="h-10 w-80" /><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;

  const status = s.health.status;
  const siblings = (all.data?.sources ?? []).filter((x) => x.platform === s.platform && x.connectionLabel === s.connectionLabel);
  const dim = DIMMED.includes(status);
  const paused = status === "paused";
  const errCount = errors.data?.length ?? 0;
  const remove = async () => {
    try { await api.deleteSource(s.id); await qc.invalidateQueries({ queryKey: keys.sources }); toast({ title: `Removed ${sourceLabel(s)}` }); nav("/settings/integrations"); }
    catch (e) { toast({ title: "Could not remove it", detail: (e as Error).message, tone: "destructive" }); }
  };
  const updateProfile = async () => {
    try { await api.updateSourceProfile(s.id); await qc.invalidateQueries({ queryKey: keys.source(s.id) }); toast({ title: "Moved to the latest built-in version" }); }
    catch (e) { toast({ title: "Did not update", detail: (e as Error).message, tone: "destructive" }); }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="source-detail">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 px-6 pb-12 pt-6">
        <Link to="/settings/integrations" className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3" />Integrations</Link>
        <header className="flex flex-wrap items-start gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <StatusPill status={status} />
              <SourceLogo platform={s.platform} size={22} />
              <h1 className="truncate text-xl font-semibold tracking-tight">{s.name} <span className="text-muted-foreground">{modelLabel(s.name, s.profile.title)}</span></h1>
            </div>
            <p className="text-11 text-muted-foreground" data-testid="sync-line">
              {s.connectionLabel} · {healthLine(s.health)} · {everyLabel(s.scheduleEvery)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {s.profile.updateAvailable && <Button size="sm" variant="ghost" onClick={() => void updateProfile()}>Update available</Button>}
            <Button icon={<RefreshCw className={cn(status === "syncing" && "animate-spin")} />} onClick={doSync} disabled={status === "syncing" || dim} loading={sync.isPending} trailing={<Kbd>R</Kbd>} data-testid="sync-now">
              {status === "syncing" ? "Syncing" : "Sync now"}
            </Button>
            <Menu open={menu} onClose={() => setMenu(false)} align="end"
              items={[
                { key: "pause", label: paused ? "Resume" : "Pause", onSelect: () => patch.mutate({ id: s.id, paused: !paused }) },
                { key: "full", label: "Full re-sync", onSelect: () => sync.mutate({ id: s.id, full: true }) },
                { key: "edit", label: "Edit profile", onSelect: () => setTab("fields") },
                { key: "export", label: "Export profile", onSelect: () => window.open(api.exportProfileUrl(s.profile.id), "_blank") },
                { key: "reconnect", label: "Reconnect", onSelect: () => nav("/start"), disabled: !dim },
                { key: "remove", label: "Remove", tone: "destructive", onSelect: () => setConfirmRemove(true) },
              ]}
              anchor={<Button aria-label="More actions" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}><MoreHorizontal className="size-4" /></Button>}
            />
          </div>
        </header>

        {status === "awaiting_grant" && (
          <div role="status" className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-13">
            <span className="min-w-0 flex-1">Saved and waiting for {platformName(s.platform)} in your grant. Add it to the Connect app, then sign in again. Indexing starts on its own.</span>
            <Button size="sm" variant="primary" onClick={() => nav("/setup/connect")}>Update the Connect app</Button>
          </div>
        )}

        {s.refetchPending && status !== "awaiting_grant" && (
          <div role="status" className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-13" data-testid="refetch-note">
            <RotateCcw className={cn("size-4 shrink-0 text-muted-foreground", status === "syncing" && "animate-spin")} />
            <span className="min-w-0 flex-1">
              {status === "syncing" ? `Fetching all ${fmtNum(s.health.itemCount)} items again with the new settings.`
                : paused ? `Settings changed. All ${fmtNum(s.health.itemCount)} items are fetched again when you resume.`
                : `Settings changed. The next run fetches all ${fmtNum(s.health.itemCount)} items again.`}
            </span>
            {status !== "syncing" && !paused && <Button size="sm" onClick={doSync}>Run it now</Button>}
          </div>
        )}

        {s.health.lastError && isProblem(status) && (
          <div role="alert" className={cn("flex items-center gap-3 rounded-lg border px-3 py-2.5 text-13",
            status === "auth_needed" || status === "grant_blocked" ? "border-destructive-text/30 bg-destructive-text/[0.06]" : "border-warning-text/30 bg-warning-text/[0.07]")}>
            <AlertTriangle className={cn("size-4 shrink-0", status === "auth_needed" || status === "grant_blocked" ? "text-destructive-text" : "text-warning-text")} />
            <span className="min-w-0 flex-1">{s.health.lastError.message}</span>
            {status === "auth_needed" ? <Button size="sm" variant="primary" onClick={() => nav("/start")}>Reconnect</Button>
              : status === "grant_blocked" || s.health.lastError.code === "blocked_by_grant" ? <Button size="sm" onClick={() => window.open("https://app.withone.ai", "_blank", "noopener")}>Manage in One</Button>
              : <Button size="sm" onClick={doSync}>Retry now</Button>}
          </div>
        )}

        <div className={cn("flex flex-col gap-5 transition-opacity", dim && "pointer-events-none opacity-40")} aria-disabled={dim || undefined}>
          <div className="border-b border-border pb-1">
            <Tabs value={tab} onChange={setTab} options={[
              { key: "overview", label: "Overview" }, { key: "fields", label: "Fields" }, { key: "runs", label: "Runs", count: runs.data?.length },
              { key: "errors", label: "Errors", count: errCount },
            ]} />
          </div>
          {tab === "overview" && <Overview s={s} runs={runs.data} siblings={siblings} />}
          {tab === "fields" && <Fields s={s} />}
          {tab === "runs" && <Runs runs={runs.data} loading={runs.isPending} onRetry={doSync} />}
          {tab === "errors" && <Errors id={s.id} errors={errors.data} loading={errors.isPending} />}
        </div>
      </div>

      <Dialog open={confirmRemove} onClose={() => setConfirmRemove(false)} title={`Remove ${sourceLabel(s)}?`} size="sm">
        <div className="flex flex-col gap-4 p-4">
          <p className="text-13 text-muted-foreground">{fmtNum(s.health.itemCount)} items leave your index. The connection stays in your One account; revoke it there to end access.</p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirmRemove(false)}>Keep it</Button>
            <Button variant="destructive" onClick={() => void remove()}>Remove</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function Overview({ s, runs, siblings }: { s: ApiSource; runs: ApiRun[] | undefined; siblings: ApiSource[] }) {
  const h = s.health;
  const tiles = [
    { label: "Items indexed", value: fmtNum(h.itemCount), testid: "tile-items" },
    { label: "Added 24h", value: fmtNum(h.added24h) },
    { label: "Updated 24h", value: fmtNum(h.updated24h) },
    { label: "Failed 24h", value: fmtNum(h.failed24h), bad: h.failed24h > 0 },
  ];
  const strip = [...(runs ?? [])].slice(0, 24).reverse();
  const backfill = typeof s.settings.backfill === "string" ? s.settings.backfill : null;
  const progress = h.progress;
  // A first run on a small source can finish before this screen opens: keep its card up for two minutes, done.
  const first = runs?.[0]?.trigger === "first" ? runs[0] : undefined;
  const firstDone = !(progress && (h.status === "syncing" || h.status === "new")) && !!first && first.outcome !== "running" && Date.now() - Date.parse(first.finishedAt) < 120_000;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex flex-col gap-5">
        {((progress && (h.status === "syncing" || h.status === "new")) || firstDone) && (
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5" data-testid="first-run">
            <div className="flex items-center justify-between text-13">
              <span className="flex items-center gap-2 font-medium"><HealthDot status={firstDone ? h.status : "syncing"} />{firstDone ? "First run done" : h.status === "new" ? "First run" : "Indexing"}</span>
              <span className="tnum text-xs text-muted-foreground">{firstDone ? `${fmtNum(first!.upserted)} indexed` : healthLine(h)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out-quart" style={{ width: `${firstDone ? 100 : progress?.estimate ? Math.min(100, (progress.done / progress.estimate) * 100) : 30}%` }} />
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="flex h-16 flex-col justify-center gap-0.5 rounded-xl border border-border bg-card px-3.5" data-testid={t.testid}>
              <span className="text-11 text-muted-foreground">{t.label}</span>
              <span className={cn("tnum text-xl font-semibold tracking-tight", t.bad && "text-destructive-text")}>{t.value}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between"><p className="label-caps">Runs, last 24</p><span className="text-11 text-muted-foreground">oldest to newest</span></div>
          <div className="flex h-6 items-end gap-1" aria-label="Recent runs">
            {strip.length === 0 ? <span className="text-xs text-muted-foreground">No runs yet.</span> : strip.map((r) => (
              <span key={r.runId} title={`${new Date(r.finishedAt).toLocaleString()} · ${r.outcome} · +${r.upserted}`}
                className={cn("w-1.5 rounded-full", r.outcome === "ok" ? "h-full bg-success-text/70" : r.outcome === "running" ? "h-full bg-accent pulse-dot" : r.outcome === "rate_limited" || r.outcome === "partial" ? "h-3/5 bg-warning-text" : "h-3/5 bg-destructive-text")} />
            ))}
          </div>
        </div>
        {siblings.length > 1 && (
          <div className="flex flex-col gap-2">
            <p className="label-caps">Models on this connection</p>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {siblings.map((x) => (
                <Link key={x.id} to={`/sources/${x.id}`} className={cn("flex h-10 items-center gap-3 border-b border-border px-3 text-13 last:border-b-0 hover:bg-card-hover", x.id === s.id && "bg-muted")}>
                  <HealthDot status={x.health.status} />
                  <span className="min-w-0 flex-1 truncate font-medium">{x.profile.title}</span>
                  <span className="text-11 text-muted-foreground">{STATUS_WORD[x.health.status]}</span>
                  <span className="text-11 text-muted-foreground">{fmtAgo(x.health.lastSuccessAt)}</span>
                  <span className="tnum w-12 text-right">{fmtNum(x.health.itemCount)}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
      <aside className="flex flex-col gap-3 rounded-xl border border-border bg-faint p-4 text-xs xl:self-start" aria-label="Details">
        <p className="label-caps">Details</p>
        <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2.5">
          <Detail k="Connection" v={s.connectionLabel} />
          <Detail k="Mode" v={s.mode === "fixture" ? "Sample, replayed" : "Your grant"} />
          <Detail k="Type" v={KIND_LABEL[s.profile.kind]} />
          <Detail k="Profile" v={<span className="font-mono text-11">{s.profile.slug} v{s.profile.version}</span>} />
          <Detail k="Origin" v={s.profile.origin === "builtin" ? "Built in" : s.profile.origin === "user" ? "Yours" : "Imported"} />
          <Detail k="Verified" v={<Badge tone={s.profile.verified === "real" ? "success" : "outline"}>{s.profile.verified === "real" ? "Real grant" : s.profile.verified === "fixture" ? "Fixture-verified" : "Not verified"}</Badge>} />
          <Detail k="Schedule" v={<ScheduleSelect s={s} />} />
          {Object.entries(s.settingsSpec).filter(([, spec]) => spec.type === "choice").map(([k, spec]) => {
            const opt = spec.type === "choice" ? spec.options.find((o) => o.value === s.settings[k]) : undefined;
            return <Detail key={k} k={spec.label} v={opt?.label ?? String(s.settings[k] ?? "")} />;
          })}
          {backfill && <Detail k="Backfill" v={backfill === "all" ? "Everything" : backfill === "30d" ? "30 days" : backfill === "365d" ? "1 year" : backfill} />}
          <Detail k="Next run" v={s.health.nextRunAt ? new Date(s.health.nextRunAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "not scheduled"} />
        </dl>
        <ActionsUsed s={s} />
      </aside>
    </div>
  );
}

function ActionsUsed({ s }: { s: ApiSource }) {
  const profiles = useProfiles();
  const p = profiles.data?.find((x) => x.id === s.profile.id)?.json;
  const fallback = p ? [p.list.actionId, ...(p.partitions ? [p.partitions.actionId] : []), ...(p.hydrate ? [p.hydrate.request.actionId] : [])] : [];
  const rows = s.actions?.length ? s.actions : fallback.map((actionId) => ({ actionId, method: null as string | null, path: null as string | null }));
  // The truth from the methods: a Read only grant covers GET; anything else needs the
  // action named in a Custom ask, even when it only reads (a search or a query).
  const known = rows.filter((r) => r.method);
  const nonGet = known.filter((r) => r.method !== "GET");
  const footer = rows.length === 0 ? null
    : known.length < rows.length ? "Method not recorded for some actions."
    : nonGet.length === 0 ? "All GET, read only."
    : `${nonGet.length} of ${rows.length} use ${[...new Set(nonGet.map((r) => r.method))].join(", ")} to read. A Read only grant covers GET only, so these must be in the Connect app's ask by name.`;
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3">
      <p className="text-muted-foreground">Actions used</p>
      {rows.length === 0 ? <Skeleton className="h-4 w-full" /> : rows.map((a) => (
        <span key={a.actionId} className="flex min-w-0 items-baseline gap-1.5 font-mono text-11" title={a.path ?? undefined}>
          {a.method && <span className={cn("shrink-0 font-semibold", a.method === "GET" ? "text-muted-foreground" : "text-foreground")}>{a.method}</span>}
          <span className="break-all">{a.actionId}</span>
        </span>
      ))}
      {footer && <p className="text-11 text-muted-foreground">{footer}</p>}
    </div>
  );
}

/** "Attio" + "Attio companies" -> "companies": a model title that already names the tool. */
export function modelLabel(name: string, title: string): string {
  const t = title.trim();
  return t.toLowerCase().startsWith(`${name.toLowerCase()} `) ? t.slice(name.length + 1) : t;
}
const sourceLabel = (s: ApiSource) => `${s.name} ${modelLabel(s.name, s.profile.title)}`.trim();

const Detail = ({ k, v }: { k: string; v: React.ReactNode }) => (<><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 truncate">{v}</dd></>);

function Fields({ s }: { s: ApiSource }) {
  const profiles = useProfiles();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const ap = profiles.data?.find((x) => x.id === s.profile.id);
  const rows = useMemo(() => (ap?.json ? profileToRows(ap.json) : []), [ap]);
  if (profiles.isError) return <LoadError what="The profile" error={profiles.error} onRetry={() => void profiles.refetch()} />;
  if (!ap) return <Skeleton className="h-64 w-full rounded-xl" />;
  const reindex = async () => {
    if (!ap.json) return;
    setBusy(true);
    try {
      const r = await api.putProfile(ap.id, ap.json, "Edited in source detail");
      await qc.invalidateQueries({ queryKey: keys.profiles });
      toast({ title: r.effect === "remap" ? `Remapping ${fmtNum(r.affectedItems)} items` : r.effect === "refetch" ? "Fetching again from the start" : "Saved", detail: r.effect === "remap" ? "From stored records, no new calls on your grant" : undefined });
      setConfirm(false);
    } catch (e) { toast({ title: "Not saved", detail: (e as Error).message, tone: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">How each {s.name} record becomes a search result. {s.profile.origin === "builtin" ? "Editing a built-in makes it yours." : ""}</p>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" icon={<Download />} onClick={() => window.open(api.exportProfileUrl(ap.id), "_blank")}>Export</Button>
          <Button size="sm" onClick={() => setConfirm(true)} data-testid="edit-fields">Edit</Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card" role="table" aria-label="Field map">
        <div role="row" className="grid h-8 grid-cols-[180px_minmax(0,1fr)] items-center gap-3 border-b border-border bg-faint px-3 text-11 font-medium text-muted-foreground">
          <span>Search field</span><span>From</span>
        </div>
        {rows.map((r, i) => (
          <div key={i} role="row" className="grid h-10 grid-cols-[180px_minmax(0,1fr)] items-center gap-3 border-b border-border px-3 last:border-b-0">
            <span className="truncate text-13">{r.target}</span>
            <span className="truncate font-mono text-xs text-muted-foreground" title={r.expr}>{r.expr}</span>
          </div>
        ))}
      </div>
      <p className="font-mono text-11 text-muted-foreground">list {ap.json?.list.actionId} · results at {ap.json?.list.resultsPath} · {ap.json?.incremental.strategy}{ap.json?.incremental.strategy === "watermark" ? ` on ${ap.json.incremental.field}` : ""}</p>
      <Dialog open={confirm} onClose={() => setConfirm(false)} title={`Reindex ${fmtNum(s.health.itemCount)} items?`} size="sm">
        <div className="flex flex-col gap-4 p-4">
          <p className="text-13 text-muted-foreground">A change to the map re-reads the records Search already stored, so it makes no new calls. A change to what is fetched starts over from the first page.</p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => void reindex()}>Reindex</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

const TRIGGER: Record<string, string> = { schedule: "Scheduled", manual: "Manual", first: "First run", remap: "Remap", reindex: "Reindex", resume: "Resumed" };
function dur(r: ApiRun) {
  const ms = new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime();
  return r.outcome === "running" ? "running" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function Runs({ runs, loading, onRetry }: { runs: ApiRun[] | undefined; loading: boolean; onRetry: () => void }) {
  if (loading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (!runs?.length) return <p className="text-13 text-muted-foreground">No runs yet.</p>;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card" role="list" aria-label="Runs" data-testid="runs">
      {runs.map((r) => {
        const bad = r.outcome !== "ok" && r.outcome !== "running";
        return (
          <div key={r.runId} role="listitem" title={r.error?.message}
            className={cn("relative flex h-9 items-center gap-3 border-b border-border pl-4 pr-2 text-xs last:border-b-0 hover:bg-card-hover")}>
            <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", r.outcome === "ok" ? "bg-success-text" : r.outcome === "running" ? "bg-accent pulse-dot" : r.outcome === "rate_limited" || r.outcome === "partial" ? "bg-warning-text" : "bg-destructive-text")} />
            <span className="tnum w-[64px] shrink-0 font-mono text-11 text-muted-foreground">{fmtClock(r.startedAt)}</span>
            <span className="w-[84px] shrink-0 truncate">{TRIGGER[r.trigger] ?? r.trigger}</span>
            <span className={cn("min-w-0 flex-1 truncate", bad ? "text-warning-text" : "text-muted-foreground")}>
              {r.outcome === "running" ? `Running, ${fmtNum(r.fetched)} fetched` : bad ? r.error?.message ?? r.outcome : `+${fmtNum(r.upserted)} new, ${fmtNum(r.unchanged)} unchanged, ${fmtNum(r.tombstoned)} removed, 0 failed`}
            </span>
            <span className="tnum w-[60px] shrink-0 text-right text-11 text-muted-foreground">{r.calls} {r.calls === 1 ? "call" : "calls"}</span>
            <span className="tnum w-[56px] shrink-0 text-right text-11 text-muted-foreground">{dur(r)}</span>
            <span className="w-6 shrink-0">
              {bad && <button type="button" aria-label="Retry" onClick={onRetry} className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><RotateCcw className="size-3.5" /></button>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const BUCKET: Record<string, string> = { blocked_by_grant: "Not in grant", rate_limited: "Rate limited", reconnect_required: "Auth", unauthorized: "Auth", invalid_profile: "Mapping", upstream_error: "Provider", not_found: "Removed" };
function Errors({ id, errors, loading }: { id: string; errors: ApiItemError[] | undefined; loading: boolean }) {
  const [bucket, setBucket] = useState<string | null>(null);
  const qc = useQueryClient();
  if (loading) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (!errors?.length) return <p className="rounded-xl border border-dashed border-border-strong p-6 text-center text-13 text-muted-foreground">No errors. Every record in the last run made it into the index.</p>;
  const counts = new Map<string, number>();
  for (const e of errors) counts.set(BUCKET[e.code] ?? "Other", (counts.get(BUCKET[e.code] ?? "Other") ?? 0) + 1);
  const shown = errors.filter((e) => !bucket || (BUCKET[e.code] ?? "Other") === bucket);
  const retry = async (ids?: string[]) => {
    try { const r = await api.retryErrors(id, ids); toast({ title: `Queued ${r.queued} for retry` }); void qc.invalidateQueries({ queryKey: keys.errors(id) }); }
    catch (e) { toast({ title: "Could not retry", detail: (e as Error).message, tone: "destructive" }); }
  };
  return (
    <div className="flex flex-col gap-3" data-testid="errors">
      <div className="flex flex-wrap items-center gap-1.5">
        {[...counts.entries()].map(([b, n]) => (
          <button key={b} type="button" onClick={() => setBucket((x) => (x === b ? null : b))} aria-pressed={bucket === b}
            className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors", bucket === b ? "border-foreground/40 bg-muted" : "border-border bg-card hover:border-border-strong")}>
            {b}<span className="tnum text-muted-foreground">{n}</span>
          </button>
        ))}
        <Button size="sm" variant="ghost" className="ml-auto" icon={<RotateCcw />} onClick={() => void retry()}>Retry all</Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {shown.map((e) => (
          <div key={e.externalId} className="flex items-start gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-text" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-13">{e.message}</p>
              <p className="truncate font-mono text-11 text-muted-foreground">{e.code} · {e.stage} · {e.externalId} · {e.attempts} {e.attempts === 1 ? "try" : "tries"} · {fmtAgo(e.lastAt)}</p>
            </div>
            <Button size="sm" onClick={() => void retry([e.externalId])}>Retry</Button>
          </div>
        ))}
      </div>
    </div>
  );
}

const EVERY = [
  { value: "5m", label: "Every 5 min" }, { value: "15m", label: "Every 15 min" }, { value: "30m", label: "Every 30 min" },
  { value: "1h", label: "Hourly" }, { value: "6h", label: "Every 6 hours" }, { value: "1d", label: "Daily" }, { value: "7d", label: "Weekly" },
];

/** How often this source refreshes; saved at once (PATCH /sources/:id scheduleEvery). */
function ScheduleSelect({ s }: { s: ApiSource }) {
  const qc = useQueryClient();
  const known = EVERY.some((o) => o.value === s.scheduleEvery);
  const options = known ? EVERY : [{ value: s.scheduleEvery, label: everyLabel(s.scheduleEvery) }, ...EVERY];
  const change = async (v: string) => {
    if (v === s.scheduleEvery) return;
    try {
      await api.patchSource(s.id, { scheduleEvery: v });
      await qc.invalidateQueries({ queryKey: keys.source(s.id) });
      await qc.invalidateQueries({ queryKey: keys.sources });
      toast({ title: `Refreshes ${everyLabel(v)}` });
    } catch (e) { toast({ title: "Could not change the schedule", detail: (e as Error).message, tone: "destructive" }); }
  };
  return <Select label="Schedule" value={s.scheduleEvery} options={options} onChange={(v) => void change(v)} className="h-7 w-[150px] text-xs" />;
}
