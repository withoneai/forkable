import { useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import { Bot, Check, Copy, HardDrive, KeyRound, Palette, Plug, Plus, RefreshCw, SlidersHorizontal, Terminal } from "lucide-react";
import type { ConnectSetupInfo } from "@builder/core/api-types";
import type { OneCliStatus } from "@builder/core/types";
import { useQueryClient } from "@tanstack/react-query";
import type { HarnessInfo } from "@builder/harness/types";
import { api, humanError } from "@/lib/api";
import { keys, useConnectTemplates, useHarnesses, useOneCli, usePatchSettings, useSettings } from "@/lib/queries";
import { useTheme, type Theme } from "@/lib/theme";
import { useSize, type UiSize } from "@/lib/scale";
import { BRAND_NAME } from "@/lib/brand";
import { cn, copyText } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { Badge, Button, ConfirmButton, EmptyState, IconButton, Input, ListSkeleton, LoadError, Segmented, Spinner, Switch, Tooltip } from "@/components/ui";
import { CopyValue, SetupBadges, SetupMeta } from "@/components/connect/parts";
import { FULL_ACCESS_COPY } from "@/components/AgentChips";
import { TopNav } from "./Home";

const SECTIONS = [
  { key: "agents", label: "Agents", icon: <Bot /> },
  { key: "general", label: "Building", icon: <SlidersHorizontal /> },
  { key: "one", label: "One CLI", icon: <Terminal /> },
  { key: "templates", label: "Connect templates", icon: <Plug /> },
  { key: "appearance", label: "Appearance", icon: <Palette /> },
  { key: "storage", label: "Storage and ports", icon: <HardDrive /> },
] as const;
type Section = (typeof SECTIONS)[number]["key"];

function SectionTitle({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-15 font-semibold tracking-tight">{title}</h2>
        {hint && <p className="mt-0.5 max-w-[520px] text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Row({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-6 border-b border-border px-4 py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div className="text-13 font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>{children}</div>
);

function statusOf(h: HarnessInfo): { label: string; tone: "success" | "warning" | "neutral" | "destructive" } {
  if (h.id === "replay") return { label: "Built in", tone: "neutral" };
  if (!h.bin) return { label: "Not installed", tone: "neutral" };
  if (h.signedIn === false) return { label: "Signed out", tone: "warning" };
  if (h.signedIn === null) return { label: "Installed", tone: "neutral" };
  return { label: "Ready", tone: "success" };
}

function Agents() {
  const qc = useQueryClient();
  const harnesses = useHarnesses();
  const settings = useSettings();
  const patch = usePatchSettings();
  const [checking, setChecking] = useState(false);
  const recheck = async () => {
    setChecking(true);
    try { qc.setQueryData(keys.harnesses, await api.harnesses(true)); }
    catch (e) { toast({ title: "Could not check again", detail: humanError(e), tone: "destructive" }); }
    finally { setChecking(false); }
  };
  const def = settings.data?.settings.defaultHarness ?? harnesses.data?.defaultId ?? null;
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle title="Coding agents" hint={`${BRAND_NAME} drives the agent you already have installed. Your own plan pays for the work, and the CLI's cost estimate is shown when it reports one.`}>
        <Button size="sm" icon={<RefreshCw />} loading={checking} onClick={recheck}>Check again</Button>
      </SectionTitle>
      {harnesses.isLoading ? <ListSkeleton rows={3} /> : harnesses.isError ? <LoadError what="Your agents" error={harnesses.error} onRetry={() => harnesses.refetch()} /> : (
        <div className="flex flex-col gap-2">
          {(harnesses.data?.harnesses ?? []).map((h) => {
            const st = statusOf(h);
            const isDefault = def === h.id;
            return (
              <Card key={h.id}>
                <div className="flex items-start gap-3 p-4">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Bot className="size-4 stroke-[1.75]" /></span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-13 font-semibold">{h.label}</p>
                      {h.status === "preview" && <Badge tone="warning">Preview</Badge>}
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {isDefault && <Badge tone="outline">Default</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {h.id === "replay" ? "Plays recorded turns for the demo and the tests. Spends nothing." : h.bin ? <><span className="font-mono">{h.bin}</span>{h.version && <> · {h.version}</>}</> : `Looked in ${(h.searched ?? []).slice(0, 4).join(", ")}${(h.searched?.length ?? 0) > 4 ? " and more" : ""}`}
                    </p>
                    {h.status === "preview" && <p className="text-xs text-muted-foreground">Runs one step at a time. You see the result when it finishes.</p>}
                    {h.note && !(h.status === "preview" && h.note.startsWith("Runs one step")) && <p className="text-xs text-warning-text">{h.note}</p>}
                    {h.models.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {h.models.slice(0, 8).map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            title={m.hint ?? m.id}
                            onClick={() => patch.mutate({ defaultHarness: h.id, defaultModel: m.id })}
                            className={cn(
                              "inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-11 font-medium transition-colors",
                              isDefault && settings.data?.settings.defaultModel === m.id ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
                            )}
                          >
                            {isDefault && settings.data?.settings.defaultModel === m.id && <Check className="size-3" />}
                            {m.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button size="sm" disabled={!h.bin || isDefault} onClick={() => patch.mutate({ defaultHarness: h.id, defaultModel: null })}>{isDefault ? "Default" : "Use by default"}</Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}

function General() {
  const settings = useSettings();
  const patch = usePatchSettings();
  const s = settings.data?.settings;
  if (settings.isLoading) return <ListSkeleton rows={2} />;
  if (!s) return <LoadError what="Settings" error={settings.error} onRetry={() => settings.refetch()} />;
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle title="Building" hint="Defaults for new projects. Each project can change them in its top bar." />
      <Card>
        <Row label="Default permission" hint={s.defaultPermission === "full" ? FULL_ACCESS_COPY : "Build edits files and runs checks. The platform runs installs, dev servers and commits."}>
          <Segmented
            label="Default permission"
            value={s.defaultPermission === "plan" ? "build" : s.defaultPermission}
            onChange={(v) => patch.mutate({ defaultPermission: v })}
            options={[{ key: "build", label: "Build" }, { key: "full", label: "Full access" }]}
          />
        </Row>
        <Row label="Auto-fix" hint="After a turn, errors it caused go back to the agent, up to three times.">
          <Switch label="Auto-fix" checked={s.autoFix} onChange={(v) => patch.mutate({ autoFix: v })} />
        </Row>
      </Card>
    </section>
  );
}

function cliState(c: OneCliStatus): { label: string; tone: "success" | "warning" | "neutral" | "outline" } {
  if (c.mode === "sample") return { label: "Sample", tone: "outline" };
  if (!c.installed) return { label: "Not installed", tone: "neutral" };
  if (!c.version) return { label: "Does not start", tone: "warning" };
  if (!c.signedIn) return { label: "Signed out", tone: "warning" };
  return { label: "Ready", tone: "success" };
}

const USES: { title: string; detail: React.ReactNode }[] = [
  { title: "Finding actions", detail: <>The agent looks actions up in One's catalog and reads their docs: <span className="font-mono">one actions find</span> and <span className="font-mono">actions load</span>, with typed wrappers from what it loads.</> },
  { title: "Your connections", detail: <><span className="font-mono">one list</span> tells Publish whether GitHub and Vercel are connected to your One account.</> },
  { title: "Publishing", detail: "GitHub export and Vercel deploy run on your own One account, one action at a time, with no body or secret on a command line." },
  { title: "Not your apps' sign-in", detail: "Each app signs its users in with its own One Connect, set in the project's Settings. The CLI's account never reaches an app." },
];

function OneCli() {
  const qc = useQueryClient();
  const cli = useOneCli();
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const c = cli.data;
  if (cli.isLoading) return <ListSkeleton rows={3} />;
  if (!c) return <LoadError what="The One CLI" error={cli.error} onRetry={() => cli.refetch()} />;
  const st = cliState(c);
  const recheck = async () => {
    setChecking(true);
    try { qc.setQueryData(keys.oneCli, (await api.oneCliRefresh()).cli); void qc.invalidateQueries({ queryKey: keys.me }); }
    catch (e) { toast({ title: "Could not check again", detail: humanError(e), tone: "destructive" }); }
    finally { setChecking(false); }
  };
  const login = async () => {
    setStarting(true);
    try { qc.setQueryData(keys.oneCli, (await api.oneCliLogin()).cli); toast({ title: "Finish in your browser", detail: "One's sign-in page opened. This page updates when it is done." }); }
    catch (e) { toast({ title: "Could not start the sign-in", detail: humanError(e), tone: "destructive" }); }
    finally { setStarting(false); }
  };
  return (
    <section className="flex flex-col gap-6" data-testid="settings-onecli">
      <div className="flex flex-col gap-3">
        <SectionTitle title="One CLI" hint={`${BRAND_NAME} knows One through the One CLI on this computer. It runs the CLI and reads its answers; it never opens the CLI's own files.`}>
          <Button size="sm" icon={<RefreshCw />} loading={checking} onClick={recheck}>Check again</Button>
        </SectionTitle>
        <Card>
          <div className="flex items-start gap-3 border-b border-border p-4">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Terminal className="size-4 stroke-[1.75]" /></span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-13 font-semibold">One CLI</p>
                <Badge tone={st.tone}>{st.label}</Badge>
                {c.version && <Badge mono tone="outline">{c.version}</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">
                {c.mode === "sample" ? "The keyless sample stands in for the CLI. Answers come from fixtures and nothing leaves this computer." : c.path ? <span className="font-mono">{c.path}</span> : "Not found on this computer."}
              </p>
              {c.node && c.mode !== "sample" && <p className="text-11 text-muted-foreground">Runs with the Node in <span className="font-mono">{c.node}</span></p>}
              {c.error && c.mode !== "sample" && c.installed && !(!c.signedIn && c.version) && <p className="text-xs text-warning-text">{c.error}</p>}
            </div>
          </div>
          {!c.installed && c.mode !== "sample" ? (
            <Row label="Install it" hint="Then press Check again.">
              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-faint py-0.5 pl-2 pr-0.5 font-mono text-xs">
                {c.installHint}
                <IconButton size="sm" label="Copy command" onClick={async () => { if (await copyText(c.installHint)) toast({ title: "Copied" }); }}><Copy /></IconButton>
              </span>
            </Row>
          ) : (
            <Row
              label="Signed in as"
              hint={c.signedIn && c.account ? c.account.email ?? undefined : c.loginRunning ? "One's sign-in is open in your browser." : "Not signed in. The catalog and publishing wait for it."}
            >
              {c.signedIn && c.account ? (
                <span className="text-13" data-testid="onecli-account">{c.account.name ?? c.account.email}</span>
              ) : c.loginRunning ? (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Spinner />Waiting for your browser</span>
              ) : (
                <Button size="sm" variant="primary" loading={starting} disabled={!c.version} onClick={() => void login()} data-testid="onecli-login">Sign in with the One CLI</Button>
              )}
            </Row>
          )}
          {c.signedIn && c.mode !== "sample" && (
            <Row label="Switch account" hint={<>Runs <span className="font-mono">one login</span> again in your browser.</>}>
              <Button size="sm" variant="ghost" loading={starting || c.loginRunning} onClick={() => void login()}>Sign in again</Button>
            </Row>
          )}
        </Card>
      </div>
      <div className="flex flex-col gap-3">
        <SectionTitle title={`What ${BRAND_NAME} uses it for`} />
        <Card>
          {USES.map((u) => (
            <div key={u.title} className="flex gap-6 border-b border-border px-4 py-2.5 last:border-b-0">
              <p className="w-36 shrink-0 text-13 font-medium">{u.title}</p>
              <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">{u.detail}</p>
            </div>
          ))}
        </Card>
      </div>
    </section>
  );
}

/** A saved Connect app's row: rename in place, edit values, remove when nothing uses it. */
function SetupRow({ s, kind }: { s: ConnectSetupInfo; kind: "template" | "project" }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(s.name);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: keys.connectTemplates });
  const rename = async () => {
    const n = name.trim();
    if (!n || n === s.name) { setRenaming(false); setName(s.name); return; }
    setBusy("rename");
    try { await api.renameSetup(s.id, n); await refresh(); setRenaming(false); }
    catch (e) { toast({ title: "Could not rename it", detail: humanError(e), tone: "destructive" }); }
    finally { setBusy(null); }
  };
  const remove = async () => {
    setBusy("remove");
    try { qc.setQueryData(keys.connectTemplates, await api.removeSetup(s.id)); toast({ title: `Removed ${s.name}`, detail: "Its values were taken off this computer. The app itself stays in the One dashboard." }); }
    catch (e) { toast({ title: "Could not remove it", detail: humanError(e), tone: "destructive" }); }
    finally { setBusy(null); }
  };
  const saveAsTemplate = async () => {
    setBusy("save");
    try { await api.createTemplate({ name: s.name, fromSetupId: s.id }); await refresh(); toast({ title: "Saved as a template", detail: "Any project can use it now." }); }
    catch (e) { toast({ title: "Could not save it", detail: humanError(e), tone: "destructive" }); }
    finally { setBusy(null); }
  };
  const inUse = s.usedBy.length > 0;
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0" data-testid={`setup-${s.id}`}>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><KeyRound className="size-3.5 stroke-[1.75]" /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {renaming ? (
          <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setRenaming(false); setName(s.name); } }} aria-label="Template name" className="h-7 max-w-[280px]" maxLength={80} />
            <Button size="sm" type="submit" loading={busy === "rename"}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setRenaming(false); setName(s.name); }}>Cancel</Button>
          </form>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <p className="truncate text-13 font-medium">{s.name}</p>
            <SetupBadges s={s} />
          </div>
        )}
        <SetupMeta s={s} />
        {kind === "project" && s.ownerProjectName && <p className="text-11 text-muted-foreground">Made for {s.ownerProjectName}</p>}
      </div>
      {!renaming && (
        <div className="flex shrink-0 items-center gap-1">
          {kind === "template" ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>Rename</Button>
              {!s.sample && <Button size="sm" variant="ghost" onClick={() => nav(`/setup/connect/${s.id}`)}>Values</Button>}
              {inUse ? (
                <Tooltip label={`${s.usedBy.map((u) => u.name).join(", ")} ${s.usedBy.length === 1 ? "uses" : "use"} it. Point ${s.usedBy.length === 1 ? "it" : "them"} elsewhere first.`}>
                  <span><Button size="sm" variant="ghost" disabled>Remove</Button></span>
                </Tooltip>
              ) : (
                <ConfirmButton size="sm" variant="ghost" confirmLabel="Remove it" loading={busy === "remove"} onConfirm={() => void remove()}>Remove</ConfirmButton>
              )}
            </>
          ) : (
            <>
              {s.configured && <Button size="sm" variant="ghost" loading={busy === "save"} onClick={() => void saveAsTemplate()}>Save as template</Button>}
              {s.ownerProjectId && <Button size="sm" variant="ghost" onClick={() => nav(`/p/${s.ownerProjectId}/settings`)}>Open project</Button>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Templates() {
  const t = useConnectTemplates();
  const nav = useNavigate();
  const d = t.data;
  return (
    <section className="flex flex-col gap-6" data-testid="settings-templates">
      <div className="flex flex-col gap-3">
        <SectionTitle title="Connect templates" hint="Connect apps you made in the One dashboard, saved once so any project can use them. A project that links one follows its changes; a project that copies one keeps its own.">
          <Button size="sm" variant="primary" icon={<Plus />} onClick={() => nav("/setup/connect?new=template")}>New template</Button>
        </SectionTitle>
        {t.isLoading ? <ListSkeleton rows={2} /> : !d ? <LoadError what="Your templates" error={t.error} onRetry={() => t.refetch()} /> : (
          <Card>
            {d.templates.length === 0 ? (
              <EmptyState className="py-10" icon={<KeyRound />} title="No templates yet" detail="Save a Connect app here once, then turn on One Connect in any project with it, linked or copied." />
            ) : d.templates.map((s) => <SetupRow key={s.id} s={s} kind="template" />)}
          </Card>
        )}
      </div>
      {d && d.projectSetups.length > 0 && (
        <div className="flex flex-col gap-3">
          <SectionTitle title="Projects' own Connect apps" hint="Made for one project. Another project can link or copy it from its own Settings, or save it here as a template." />
          <Card>{d.projectSetups.map((s) => <SetupRow key={s.id} s={s} kind="project" />)}</Card>
        </div>
      )}
      {d && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium">The preview redirect URI</p>
          <p className="max-w-[560px] text-xs text-muted-foreground">Every Connect app lists this one address for preview, and it works for every project on this computer.</p>
          <CopyValue value={d.redirectUri} label="Copy the preview redirect URI" className="max-w-[560px]" />
        </div>
      )}
    </section>
  );
}

function Appearance() {
  const [theme, setTheme] = useTheme();
  const [size, setSize] = useSize();
  const patch = usePatchSettings();
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle title="Appearance" />
      <Card>
        <Row label="Theme">
          <Segmented<Theme> label="Theme" value={theme} onChange={(t) => { setTheme(t); patch.mutate({ theme: t }); }} options={[{ key: "system", label: "System" }, { key: "light", label: "Light" }, { key: "dark", label: "Dark" }]} />
        </Row>
        <Row label="Size" hint="Scales text, spacing and corners together.">
          <Segmented<UiSize> label="Size" value={size} onChange={(s) => { setSize(s); patch.mutate({ size: s }); }} options={[{ key: "small", label: "Small" }, { key: "default", label: "Default" }, { key: "large", label: "Large" }]} />
        </Row>
      </Card>
    </section>
  );
}

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <Row label={label} hint={<span className="font-mono">{value}</span>}>
      <IconButton label={`Copy ${label.toLowerCase()} path`} onClick={async () => { if (await copyText(value)) toast({ title: "Path copied" }); }}><Copy /></IconButton>
    </Row>
  );
}

function Storage() {
  const settings = useSettings();
  const d = settings.data;
  if (settings.isLoading) return <ListSkeleton rows={4} />;
  if (!d) return <LoadError what="Settings" error={settings.error} onRetry={() => settings.refetch()} />;
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <SectionTitle title="Storage" hint="Every project is a plain git repo in the projects folder. It opens in any editor." />
        <Card>
          <PathRow label="Home" value={d.paths.home} />
          <PathRow label="Projects" value={d.paths.projects} />
          <PathRow label="Database" value={d.paths.db} />
          <PathRow label="Cache" value={d.paths.cache} />
        </Card>
      </div>
      <div className="flex flex-col gap-3">
        <SectionTitle title="Ports" hint="Pinned so the preview redirect URI every Connect app lists never changes." />
        <Card>
          <Row label="Server" hint="API, events and this editor"><span className="font-mono text-13">{d.ports.server}</span></Row>
          <Row label="Previews" hint="Every app at its own address on this port"><span className="font-mono text-13">{d.ports.proxy}</span></Row>
          <Row label="Dev servers" hint="One per running project"><span className="font-mono text-13">{d.ports.devRange[0]} to {d.ports.devRange[1]}</span></Row>
        </Card>
      </div>
    </section>
  );
}

export function Settings() {
  const { section = "agents" } = useParams();
  const cur = (SECTIONS.some((s) => s.key === section) ? section : "agents") as Section;
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopNav />
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[960px] gap-8 px-6 pb-16 pt-6">
          <nav className="flex w-[180px] shrink-0 flex-col gap-px" aria-label="Settings sections">
            <h1 className="mb-3 px-2 text-xl font-semibold tracking-tight">Settings</h1>
            {SECTIONS.map((s) => (
              <NavLink
                key={s.key}
                to={`/settings/${s.key}`}
                className={() => cn(
                  "flex h-8 items-center gap-2 rounded-md px-2 text-13 transition-colors [&>svg]:size-4 [&>svg]:stroke-[1.75]",
                  cur === s.key ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-card-hover hover:text-foreground",
                )}
              >
                {s.icon}{s.label}
              </NavLink>
            ))}
          </nav>
          <main className="min-w-0 flex-1 pt-11">
            {cur === "agents" && <Agents />}
            {cur === "general" && <General />}
            {cur === "one" && <OneCli />}
            {cur === "templates" && <Templates />}
            {cur === "appearance" && <Appearance />}
            {cur === "storage" && <Storage />}
          </main>
        </div>
      </div>
    </div>
  );
}
