// The Access tab: what the app asks for, the app's own One
// Connect and your sign-in to it in preview, the ask for publishing, the
// Activity record, receipts and a refusal test. Receipt lines come formatted from the server (one format per source);
// this file renders them and never rebuilds them.

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronRight, Copy, ExternalLink, FileCode2, FlaskConical, Info, Plug, Settings2, ShieldCheck, Users } from "lucide-react";
import type { AccessTestResponse, ActivityResponse, ScopesResponse } from "@builder/core/api-types";
import type { ActionLevel, ActivityRow, CatalogPlatform, ManifestAction, Receipt } from "@builder/core/types";
import { api, humanError } from "@/lib/api";
import { keys, useActivity, useOneCli, useProjectConnect, useScopes, useSetVisitors } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn, copyText } from "@/lib/utils";
import { BRAND_NAME } from "@/lib/brand";
import { Badge, Button, EmptyState, ListSkeleton, LoadError, Switch, type BadgeTone } from "@/components/ui";
import { runsAsOwner, runsAsUser } from "@builder/core/visitors";
import { EnvironmentSection } from "@/components/env/EnvironmentSection";

const LEVEL_TONE: Record<ActionLevel, BadgeTone> = { read: "neutral", write: "warning", delete: "destructive" };
const SOURCE_BADGE: Record<ActivityRow["source"], { label: string; tone: BadgeTone }> = {
  one: { label: "One", tone: "success" },
  sample: { label: "Sample", tone: "outline" },
  local: { label: "Local", tone: "neutral" },
  held: { label: "Paused", tone: "warning" },
  platform: { label: BRAND_NAME, tone: "outline" },
};

function Section({ n, title, hint, children, aside }: { n: number; title: string; hint?: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby={`access-${n}`}>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 id={`access-${n}`} className="text-13 font-semibold tracking-tight">{title}</h2>
          {hint && <p className="mt-0.5 max-w-[620px] text-xs text-muted-foreground">{hint}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>{children}</div>
);

function Logo({ p, size = "size-6" }: { p?: CatalogPlatform; size?: string }) {
  const [broken, setBroken] = useState(false);
  if (!p?.image || broken) return <span className={cn("flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground", size)}><Plug className="size-3.5" /></span>;
  return <img src={p.image} alt="" className={cn("shrink-0 rounded-md bg-white object-contain p-0.5 ring-1 ring-border", size)} onError={() => setBroken(true)} />;
}

const nameOf = (s: ScopesResponse | undefined, slug: string) => s?.platforms[slug]?.name ?? slug;
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });

function ReceiptView({ r }: { r: Receipt }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-faint px-3 py-2">
      <div className="flex items-center gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs">{r.line}</pre>
        <Badge tone={SOURCE_BADGE[r.source].tone}>{r.badge}</Badge>
      </div>
      <p className="text-11 text-muted-foreground">{r.caption}</p>
    </div>
  );
}

/** One manifest action: verb, title, method, level, id and its call sites. */
function ActionRow({ s, a, onOpenFile, only, aside }: { s: ScopesResponse; a: ManifestAction; onOpenFile: (path: string, line: number) => void; only: "user" | "owner"; aside?: React.ReactNode }) {
  const slug = a.platform;
  const sites = s.callSites.filter((c) => c.actionId === a.actionId && (only === "owner" ? c.as === "owner" : c.as !== "owner"));
  const warn = s.warnings.find((w) => w.actionId === a.actionId)?.message;
  return (
    <div className="flex flex-col gap-1 border-b border-border px-3 py-2 last:border-b-0">
      <div className="flex items-center gap-2">
        {aside}
        <span className="min-w-0 flex-1 truncate text-13">
          {s.verbs?.[a.actionId] && <span className="font-medium">{nameOf(s, slug)} · {s.verbs[a.actionId]}</span>}
          <span className={cn(s.verbs?.[a.actionId] && "ml-2 text-muted-foreground")}>{a.title}</span>
        </span>
        <Badge mono tone="outline">{a.method}</Badge>
        <Badge tone={LEVEL_TONE[a.level]}>{a.level}</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-11 text-muted-foreground">
        <span className="font-mono">{a.actionId}</span>
        {sites.map((c) => (
          <button key={`${c.file}:${c.line}`} type="button" onClick={() => onOpenFile(c.file, c.line)} className="inline-flex items-center gap-0.5 rounded-sm px-1 font-mono text-foreground/80 underline-offset-2 hover:bg-muted hover:underline">
            <FileCode2 className="size-3" />{c.file}:{c.line}
          </button>
        ))}
      </div>
      {warn && <p className="text-11 text-warning-text">{warn}</p>}
    </div>
  );
}

function GroupHead({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mt-1 flex flex-col gap-0.5">
      <h3 className="text-xs font-semibold">{title}</h3>
      <p className="max-w-[620px] text-11 text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Runs on your grant for visitors: off by default, the builder ticks each action. */
function VisitorGroup({ projectId, s, actions, onOpenFile }: { projectId: string; s: ScopesResponse; actions: ManifestAction[]; onOpenFile: (path: string, line: number) => void }) {
  const set = useSetVisitors(projectId);
  const v = s.visitors;
  const allowed = new Set(v.enabled ? v.actions : []);
  const save = (body: Parameters<typeof set.mutate>[0]) => set.mutate(body, { onError: (e) => toast({ title: "Could not save", detail: humanError(e), tone: "destructive" }) });
  const writes = actions.filter((a) => allowed.has(a.actionId) && a.level !== "read");
  const notAllowed = actions.filter((a) => !allowed.has(a.actionId));
  return (
    <div className="flex flex-col gap-2" data-testid="visitor-group">
      <GroupHead title="Runs on your grant for visitors" hint={'Code that calls one(c, { as: "owner" }). People who are not signed in trigger these on your own account. Only you can allow them, one action at a time.'} />
      <Card>
        <div className="flex items-center gap-3 border-b border-border px-3 py-2.5">
          <Users className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-13 font-medium">Let visitors trigger actions on your grant</p>
            <p className="text-11 text-muted-foreground">{v.enabled ? `${allowed.size ? `${actions.filter((a) => allowed.has(a.actionId)).length} of ${actions.length}` : "None"} allowed. Everything else needs sign-in.` : "Off. Every call here is refused on your computer until you turn it on."}</p>
          </div>
          <Switch label="Let visitors trigger actions on your grant" checked={v.enabled} disabled={set.isPending} onChange={(on) => save({ enabled: on })} />
        </div>
        {actions.map((a) => (
          <ActionRow
            key={a.actionId}
            s={s}
            a={a}
            only="owner"
            onOpenFile={onOpenFile}
            aside={
              <input
                type="checkbox"
                aria-label={`Visitors may trigger ${nameOf(s, a.platform)} · ${s.verbs?.[a.actionId] ?? a.title}`}
                checked={v.actions.includes(a.actionId)}
                disabled={!v.enabled || set.isPending}
                onChange={(e) => save(e.target.checked ? { allow: [a.actionId] } : { disallow: [a.actionId] })}
                className="size-3.5 shrink-0 accent-[var(--color-accent)] disabled:opacity-40"
              />
            }
          />
        ))}
      </Card>
      {notAllowed.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" />Not allowed yet, so publish waits: {notAllowed.map((a) => `${nameOf(s, a.platform)} · ${s.verbs?.[a.actionId] ?? a.title}`).join(", ")}.</p>
      )}
      {writes.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-warning-text"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />Anyone who opens the app can trigger {writes.length === 1 ? "this write" : "these writes"} on your account: {writes.map((a) => `${nameOf(s, a.platform)} · ${s.verbs?.[a.actionId] ?? a.title}`).join(", ")}.</p>
      )}
      <p className="text-11 text-muted-foreground">Publish sets <span className="font-mono">APP_VISITOR_ACTIONS={s.visitorEnv}</span> on Vercel. Hosting the GitHub export yourself? Set the same variable there.</p>
    </div>
  );
}

/** 1. What this app asks for */
function Asks({ projectId, s, onOpenFile }: { projectId: string; s: ScopesResponse; onOpenFile: (path: string, line: number) => void }) {
  const [unusedOpen, setUnusedOpen] = useState(false);
  const userActions = useMemo(() => s.manifest.actions.filter(runsAsUser), [s.manifest.actions]);
  const ownerActions = useMemo(() => s.manifest.actions.filter(runsAsOwner), [s.manifest.actions]);
  const byPlatform = useMemo(() => {
    const m = new Map<string, ManifestAction[]>();
    for (const a of userActions) m.set(a.platform, [...(m.get(a.platform) ?? []), a]);
    return m;
  }, [userActions]);
  const warn = (id: string) => s.warnings.find((w) => w.actionId === id)?.message;
  const errors = s.issues.filter((i) => i.severity === "error");
  return (
    <div className="flex flex-col gap-2">
      {s.diff.widened && s.diff.lines.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-warning-text/30 bg-warning-text/8 px-3 py-2 text-xs">
          <Info className="mt-0.5 size-3.5 shrink-0 text-warning-text" />
          <div>
            <p className="font-medium">This version asks for more than {s.lastPublished ? "the published one" : "the last saved version"}</p>
            <ul className="mt-0.5 text-muted-foreground">{s.diff.lines.map((l) => <li key={l} className="font-mono">{l}</li>)}</ul>
          </div>
        </div>
      )}
      {s.diff.removed.length > 0 && (
        <p className="text-xs text-muted-foreground">No longer asked for: {s.diff.removed.map((a) => `${nameOf(s, a.platform)} · ${s.verbs?.[a.actionId] ?? a.title}`).join(", ")}</p>
      )}
      {ownerActions.length > 0 && userActions.length > 0 && <GroupHead title="Your users grant" hint="Signed-in users grant these on their own accounts." />}
      {[...byPlatform.entries()].map(([slug, actions]) => (
        <Card key={slug}>
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Logo p={s.platforms[slug]} />
            <span className="text-13 font-semibold">{nameOf(s, slug)}</span>
            <span className="text-11 text-muted-foreground">{actions.length} action{actions.length === 1 ? "" : "s"}</span>
          </div>
          {actions.map((a) => <ActionRow key={a.actionId} s={s} a={a} only="user" onOpenFile={onOpenFile} />)}
        </Card>
      ))}
      {ownerActions.length > 0 && <VisitorGroup projectId={projectId} s={s} actions={ownerActions} onOpenFile={onOpenFile} />}
      {s.issues.length > 0 && (
        <Card>
          <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-xs font-medium">
            <AlertTriangle className="size-3.5 text-warning-text" />
            {errors.length ? `${errors.length} manifest error${errors.length === 1 ? "" : "s"}, the agent fixes these and publish waits on them` : "Manifest warnings"}
          </div>
          {s.issues.map((i) => (
            <button key={`${i.code}${i.file}${i.line}${i.col}`} type="button" onClick={() => onOpenFile(i.file, i.line)} className="flex w-full items-start gap-2 border-b border-border px-3 py-1.5 text-left text-xs last:border-b-0 hover:bg-card-hover">
              <Badge mono tone={i.severity === "error" ? "destructive" : "warning"}>{i.code}</Badge>
              <span className="min-w-0 flex-1">{i.message}</span>
              <span className="shrink-0 font-mono text-11 text-muted-foreground">{i.file}:{i.line}</span>
            </button>
          ))}
        </Card>
      )}
      {s.manifest.unused.length > 0 && (
        <div>
          <button type="button" onClick={() => setUnusedOpen((v) => !v)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-expanded={unusedOpen}>
            <ChevronRight className={cn("size-3.5 transition-transform", unusedOpen && "rotate-90")} />
            Installed, not used ({s.manifest.unused.length}), left out of the ask
          </button>
          {unusedOpen && (
            <ul className="mt-1.5 flex flex-col gap-1 pl-5">
              {s.manifest.unused.map((id) => (
                <li key={id} className="text-11 text-muted-foreground"><span className="font-mono">{id}</span>{warn(id) && <span className="text-warning-text"> · {warn(id)}</span>}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** 2. Sign in with One: this app's own Connect app, and your sign-in to it in preview. */
function SignIn({ projectId, s, onOpenSettings }: { projectId: string; s: ScopesResponse; onOpenSettings: () => void }) {
  const c = useProjectConnect(projectId);
  const cli = useOneCli();
  if (c.isLoading) return <ListSkeleton rows={2} />;
  if (!c.data) return <LoadError what="This app's One Connect" error={c.error} onRetry={() => c.refetch()} />;
  const d = c.data;
  const platforms = [...new Set(s.manifest.actions.map((a) => a.platform))];
  const account = cli.data?.signedIn && cli.data.account ? cli.data.account : null;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5" data-testid="access-connect">
        <Badge tone={d.connect.enabled ? "success" : d.setup && !d.ready ? "warning" : "neutral"}>{d.connect.enabled ? "One Connect on" : d.setup && !d.ready ? "Needs values" : "One Connect off"}</Badge>
        {d.connect.enabled && d.setup ? (
          <span className="min-w-0 flex-1 truncate text-13"><span className="font-medium">{d.setup.name}</span><span className="text-muted-foreground"> · {d.owned ? "this project's own" : d.setup.kind === "template" ? "linked template" : `from ${d.setup.ownerProjectName ?? "another project"}`}</span></span>
        ) : (
          <span className="min-w-0 flex-1 text-13 text-muted-foreground">{platforms.length ? "Calls to One are refused on this computer until it is on." : "No One login. Turn it on when the app needs one."}</span>
        )}
        <Button size="sm" variant={d.connect.enabled ? "ghost" : "default"} icon={<Settings2 />} onClick={onOpenSettings}>{d.connect.enabled ? "Settings" : "Set up One Connect"}</Button>
      </div>
      {d.connect.enabled && (
        <div className="flex items-start gap-2 border-b border-border px-3 py-2.5 text-xs">
          <Users className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">In preview, you are the user</p>
            <p className="text-11 text-muted-foreground">Sign in with One in the preview. Calls run on your own sign-in to {d.setup?.name ?? "this Connect app"}: what you grant it there is what runs, and anything else gets One's own refusal.{d.sample ? " On the sample, a stand-in One answers with sample data." : ""}</p>
          </div>
          <Button size="sm" icon={<ExternalLink />} onClick={() => window.open(d.previewSignIn, "_blank", "noopener")}>Sign in with One</Button>
        </div>
      )}
      {platforms.map((slug) => (
        <div key={slug} className="flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0">
          <Logo p={s.platforms[slug]} size="size-5" />
          <span className="text-13">{nameOf(s, slug)}</span>
          <span className="ml-auto text-11 text-muted-foreground">{d.connect.enabled ? "Granted on the consent page when you sign in" : "Refused locally (One Connect is off)"}</span>
        </div>
      ))}
      <p className="px-3 py-2 text-11 text-muted-foreground">
        {account ? <>The catalog and publishing use the One CLI, signed in as {account.name ?? account.email}. That account never reaches this app.</> : <>The catalog and publishing use the One CLI on this computer, not this app's sign-in.</>}
      </p>
    </Card>
  );
}

/** 3. Ask for publishing */
function Ask({ s }: { s: ScopesResponse }) {
  const json = JSON.stringify(s.ask, null, 2);
  const [done, setDone] = useState<Set<string>>(new Set());
  return (
    <div className="flex flex-col gap-2">
      <Card>
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <span className="text-11 font-medium text-muted-foreground">Permission set JSON</span>
          <Button size="sm" variant="ghost" icon={<Copy />} onClick={async () => { if (await copyText(json)) toast({ title: "Ask copied" }); }}>Copy</Button>
        </div>
        <pre className="max-h-64 overflow-auto px-3 py-2 font-mono text-11 leading-relaxed">{json}</pre>
      </Card>
      {s.manifest.actions.length > 0 && (
        <Card>
          <p className="border-b border-border px-3 py-1.5 text-11 font-medium text-muted-foreground">Checklist for the dashboard</p>
          {s.manifest.actions.map((a) => {
            const on = done.has(a.actionId);
            return (
              <label key={a.actionId} className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-1.5 text-xs last:border-b-0 hover:bg-card-hover">
                <input type="checkbox" checked={on} onChange={() => setDone((d) => { const n = new Set(d); if (on) n.delete(a.actionId); else n.add(a.actionId); return n; })} className="size-3.5 accent-[var(--color-accent)]" />
                <span className={cn("flex-1", on && "text-muted-foreground line-through")}>{nameOf(s, a.platform)} · {s.verbs?.[a.actionId] ?? a.title} ({a.level})</span>
                <Badge mono tone="outline">{a.method}</Badge>
              </label>
            );
          })}
        </Card>
      )}
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" />One can't create this ask from here yet. Add it in the One dashboard under your Connect app, Asks, then paste its id at publish.</p>
      {s.askMissing.length > 0 && <p className="text-xs text-warning-text">Left out of the JSON because the catalog has no connector id for them yet: {s.askMissing.map((x) => nameOf(s, x)).join(", ")}.</p>}
    </div>
  );
}

/** 4. Activity */
function Activity({ projectId, s }: { projectId: string; s: ScopesResponse }) {
  const q = useActivity(projectId);
  const rows = (q.data?.pages ?? []).flatMap((p) => p.rows);
  if (q.isLoading) return <ListSkeleton rows={3} />;
  if (q.isError) return <LoadError what="Activity" error={q.error} onRetry={() => q.refetch()} />;
  if (!rows.length) return <p className="text-xs text-muted-foreground">Nothing yet. Every call the preview makes lands here, checked on this computer first, with who answered it.</p>;
  return (
    <Card>
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card text-left text-11 text-muted-foreground">
            <tr className="border-b border-border">
              {["Time", "Platform", "Action", "Method", "Source", "Status", "ms"].map((h) => <th key={h} className="px-3 py-1.5 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-b-0">
                <td className="whitespace-nowrap px-3 py-1.5 tnum text-muted-foreground">{time(r.at)}</td>
                <td className="px-3 py-1.5">{r.platform ? nameOf(s, r.platform) : ""}</td>
                <td className="max-w-[260px] truncate px-3 py-1.5" title={r.title ?? undefined}>{r.title}</td>
                <td className="px-3 py-1.5 font-mono text-11">{r.method}</td>
                <td className="px-3 py-1.5"><Badge tone={SOURCE_BADGE[r.source].tone}>{SOURCE_BADGE[r.source].label}</Badge></td>
                <td className={cn("px-3 py-1.5 tnum", r.ok === false && "text-destructive-text")}>{r.status ?? ""}</td>
                <td className="px-3 py-1.5 tnum text-muted-foreground">{r.ms ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {q.hasNextPage && (
        <div className="border-t border-border px-3 py-1.5"><Button size="sm" variant="ghost" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Load more</Button></div>
      )}
    </Card>
  );
}

/** 5. Receipts */
function Receipts({ projectId }: { projectId: string }) {
  const q = useActivity(projectId);
  const receipts = q.data?.pages[0]?.receipts ?? [];
  if (q.isLoading) return null;
  if (!receipts.length) return <p className="text-xs text-muted-foreground">No refusals yet. A refused call shows here with who refused it: One, or your computer before the call left it.</p>;
  return <div className="flex flex-col gap-1.5">{receipts.map((r, i) => <ReceiptView key={`${r.at}${i}`} r={r} />)}</div>;
}

/** What the preview answered for an Ask One ticket (the channel's receipt-test). */
export interface PreviewAnswer {
  status: number;
  blockedByGrant: boolean;
  message?: string;
}

function answerNote(name: string, a: PreviewAnswer): string {
  if (a.blockedByGrant) return "";
  if (a.status === 401) return "Sign in with One in the preview first. This test runs on your own sign-in to the app.";
  if (a.status === 404) return `Your grant allows it. One sent the test on and ${name} found nothing to delete. Narrow what you granted the app in One to see the refusal.`;
  if (a.message) return a.message;
  return `One sent the test on and ${name} answered ${a.status}. Your grant allows it; narrow it in One to see the refusal.`;
}

/** 6. Test a refusal */
function TestRefusal({ projectId, s, askPreview }: { projectId: string; s: ScopesResponse; askPreview: (ticket: string) => Promise<PreviewAnswer> }) {
  const qc = useQueryClient();
  const platforms = [...new Set(s.manifest.actions.map((a) => a.platform))];
  const [busy, setBusy] = useState<string | null>(null);
  const [out, setOut] = useState<Record<string, { kind: "local" | "one"; r: AccessTestResponse }>>({});
  const run = async (slug: string, kind: "local" | "one") => {
    setBusy(`${slug}:${kind}`);
    try {
      let r = kind === "local" ? await api.testLocal(projectId, slug) : await api.testOne(projectId, slug);
      if (r.ticket) {
        // Live: the app in the preview makes the call on your sign-in and reports One's answer; the receipt arrives with Activity.
        const a = await askPreview(r.ticket);
        await qc.invalidateQueries({ queryKey: keys.activity(projectId) });
        const fresh = qc.getQueryData<{ pages: ActivityResponse[] }>(keys.activity(projectId))?.pages[0]?.receipts.find((x) => x.actionId === r.action?.actionId) ?? null;
        r = { ...r, receipt: a.blockedByGrant ? fresh : null, note: a.blockedByGrant ? (fresh ? null : "One refused it. The receipt is in Receipts below.") : answerNote(nameOf(s, slug), a) };
      }
      setOut((o) => ({ ...o, [slug]: { kind, r } }));
    } catch (e) {
      toast({ title: "The test did not run", detail: humanError(e), tone: "destructive" });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      {platforms.map((slug) => {
        const res = out[slug];
        return (
          <Card key={slug} className="flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Logo p={s.platforms[slug]} size="size-5" />
              <span className="mr-auto text-13 font-medium">{nameOf(s, slug)}</span>
              <Button size="sm" icon={<FlaskConical />} loading={busy === `${slug}:local`} onClick={() => run(slug, "local")}>Try a call this app doesn't make</Button>
              <Button size="sm" icon={<ShieldCheck />} loading={busy === `${slug}:one`} onClick={() => run(slug, "one")}>Ask One</Button>
            </div>
            {res && (
              <div className="flex flex-col gap-1.5">
                {res.r.action && <p className="text-11 text-muted-foreground">Sent {res.r.action.method} {res.r.action.title} {res.kind === "local" ? "to the preview's local check" : "to One on your sign-in, with an id that cannot exist"}.</p>}
                {res.r.receipt && <ReceiptView r={res.r.receipt} />}
                {res.r.note && <p className="flex items-start gap-1.5 text-xs"><Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />{res.r.note}</p>}
              </div>
            )}
          </Card>
        );
      })}
      <p className="text-11 text-muted-foreground">The local check is not a security boundary against this project's own code, which runs on your computer. The boundary that holds is One, on what you granted the app's Connect app.</p>
    </div>
  );
}

export function AccessPane({ projectId, onOpenFile, onOpenSettings, askPreview }: { projectId: string; onOpenFile: (path: string, line: number) => void; onOpenSettings: () => void; askPreview: (ticket: string) => Promise<PreviewAnswer> }) {
  const s = useScopes(projectId);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto flex max-w-[860px] flex-col gap-6 px-6 pb-16 pt-5">
        {s.isLoading ? <ListSkeleton rows={4} /> : !s.data ? <LoadError what="This app's access" error={s.error} onRetry={() => s.refetch()} /> : (
          <>
            <Section n={1} title="What this app asks for" hint="Read from the code: every wrapper passed to one(c).run. Consent asks for exactly this, for your users and for you as the owner.">
              {s.data.manifest.actions.length === 0 && s.data.issues.length === 0 && s.data.manifest.unused.length === 0 ? (
                <Card>
                  <EmptyState
                    className="py-10"
                    icon={<ShieldCheck />}
                    title="This app calls no platform yet"
                    detail="Ask for a feature that uses Gmail, Slack or another tool. The agent looks the action up in One's catalog, adds a typed wrapper, and the ask appears here."
                  />
                </Card>
              ) : (
                <Asks projectId={projectId} s={s.data} onOpenFile={onOpenFile} />
              )}
            </Section>
            <Section n={2} title="Sign in with One" hint="This app's own One Connect. Your users grant it their own tools; in preview you sign in like they will.">
              <SignIn projectId={projectId} s={s.data} onOpenSettings={onOpenSettings} />
            </Section>
            <Section n={3} title="Environment" hint="Values the code reads that are not platform calls: a key One does not cover, a webhook secret, the owner's email. Write-only: never shown again, never seen by the agent.">
              <EnvironmentSection projectId={projectId} onOpenFile={onOpenFile} />
            </Section>
            {s.data.manifest.actions.length > 0 && (
              <Section n={4} title="Ask for publishing" hint="The same list as a Connect permission set, one rule per connector.">
                <Ask s={s.data} />
              </Section>
            )}
            <Section n={5} title="Activity" hint="Every call from the preview and every catalog read, newest first.">
              <Activity projectId={projectId} s={s.data} />
            </Section>
            <Section n={6} title="Receipts" hint="The latest refusals, each labeled with who refused it.">
              <Receipts projectId={projectId} />
            </Section>
            {s.data.manifest.actions.length > 0 && (
              <Section n={7} title="Test a refusal" hint="Send a delete this app never makes and see who stops it.">
                <TestRefusal projectId={projectId} s={s.data} askPreview={askPreview} />
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
