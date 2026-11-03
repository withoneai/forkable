// A project's Settings tab: One Connect (CONTRACT 18). Off by
// default. When on, the app's login is Sign in with One on its own Connect
// app, and in preview its calls run on the developer's own sign-in to it.
// Three ways to get a Connect app: a new one made for this project (the
// secure setup screen at project scope), a saved template, or another
// project's, each linked (follows its changes) or copied (its own values).
// Only the editor changes this; a turn can only ask, with the turn-end card.

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, Check, Copy as CopyIcon, FolderGit2, KeyRound, Link2, Plug, Plus, PowerOff, ShieldCheck } from "lucide-react";
import type { ConnectCheckResponse, ConnectSetupInfo, ProjectConnectBody, ProjectConnectResponse } from "@builder/core/api-types";
import { api, humanError } from "@/lib/api";
import { BRAND_NAME } from "@/lib/brand";
import { useProjectConnect, useSetProjectConnect } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Badge, Button, ListSkeleton, LoadError, Switch, Tooltip } from "@/components/ui";
import { CheckResult, CopyValue, SetupBadges, SetupMeta } from "@/components/connect/parts";

type Choice = "off" | "new" | "template" | "project";

const listNames = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

function Section({ id, title, hint, children, aside }: { id: string; title: string; hint?: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby={`ps-${id}`}>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h3 id={`ps-${id}`} className="text-13 font-semibold tracking-tight">{title}</h3>
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

function viaLabel(d: ProjectConnectResponse): string {
  if (!d.setup) return "";
  if (d.owned) return "This project's own";
  if (d.setup.kind === "template") return "Linked to a template";
  return d.setup.ownerProjectName ? `Linked from ${d.setup.ownerProjectName}` : "Linked from another project";
}

function statusOf(d: ProjectConnectResponse): { label: string; tone: "success" | "warning" | "neutral" } {
  if (d.connect.enabled) return { label: "On", tone: "success" };
  if (d.setup && !d.ready) return { label: "Needs values", tone: "warning" };
  return { label: "Off", tone: "neutral" };
}

/** The Connect app this project points at, its switch and Check. */
function Current({ projectId, d }: { projectId: string; d: ProjectConnectResponse }) {
  const nav = useNavigate();
  const set = useSetProjectConnect(projectId);
  const [check, setCheck] = useState<ConnectCheckResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const s = d.setup!;
  const runCheck = async () => {
    setChecking(true);
    try { setCheck(await api.checkSetup(s.id)); }
    catch (e) { toast({ title: "Could not check", detail: humanError(e), tone: "destructive" }); }
    finally { setChecking(false); }
  };
  const saveTemplate = async () => {
    setSaving(true);
    try { await api.saveProjectConnectAsTemplate(projectId, s.name); toast({ title: "Saved as a template", detail: "Other projects can use it now, linked or copied." }); }
    catch (e) { toast({ title: "Could not save it", detail: humanError(e), tone: "destructive" }); }
    finally { setSaving(false); }
  };
  const toggle = (on: boolean) =>
    set.mutate({ enabled: on }, {
      onSuccess: () => toast({ title: on ? "One Connect is on" : "One Connect is off", detail: on ? "The app signs in with One now. Its preview restarted." : "The app has no One login now. Its preview restarted." }),
      onError: (e) => toast({ title: "Could not change it", detail: humanError(e), tone: "destructive" }),
    });
  return (
    <div className="flex flex-col gap-2">
      <Card>
        <div className="flex items-center gap-3 px-4 py-3">
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", d.connect.enabled ? "bg-success-text/12 text-success-text" : "bg-muted text-muted-foreground")}><KeyRound className="size-4 stroke-[1.75]" /></span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <p className="truncate text-13 font-semibold" data-testid="connect-setup-name">{s.name}</p>
              <SetupBadges s={s} />
            </div>
            <p className="text-11 text-muted-foreground">{viaLabel(d)}</p>
            <SetupMeta s={s} />
          </div>
          {d.ready ? (
            <Switch label="One Connect for this app" checked={d.connect.enabled} disabled={set.isPending} onChange={toggle} />
          ) : (
            <Button size="sm" variant="primary" onClick={() => nav(`/setup/connect/${s.id}?project=${projectId}`)}>Add its values</Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border bg-faint px-4 py-2">
          <Button size="sm" icon={<ShieldCheck />} loading={checking} disabled={!d.ready} onClick={() => void runCheck()}>Check</Button>
          {!s.sample && <Button size="sm" variant="ghost" onClick={() => nav(`/setup/connect/${s.id}?project=${projectId}`)}>{d.owned ? "Edit values" : "Edit the shared values"}</Button>}
          {d.owned && s.configured && <Button size="sm" variant="ghost" loading={saving} onClick={() => void saveTemplate()}>Save as template</Button>}
          <span className="ml-auto text-11 text-muted-foreground">
            {s.sample ? "The keyless sample answers sign-in and calls. Nothing leaves this computer." : d.connect.enabled ? "Sign in with One works in preview." : "Off: the app has no One login."}
          </span>
        </div>
      </Card>
      {check && <CheckResult r={check} />}
    </div>
  );
}

function ChoiceCard({ value, cur, icon, title, detail, onPick, disabled }: { value: Choice; cur: Choice; icon: React.ReactNode; title: string; detail: string; onPick: (c: Choice) => void; disabled?: boolean }) {
  const on = value === cur;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onPick(value)}
      data-testid={`connect-choice-${value}`}
      className={cn(
        "flex min-w-0 items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        on ? "border-ring bg-card shadow-[0_0_0_3px_color-mix(in_oklch,var(--ring)_14%,transparent)]" : "border-border bg-card hover:bg-card-hover",
      )}
    >
      <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md [&>svg]:size-3.5 [&>svg]:stroke-[1.75]", on ? "bg-accent/12 text-accent" : "bg-muted text-muted-foreground")}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs font-medium">{title}</span>
        <span className="block text-11 text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}

/** A template or another project's Connect app, with Link and Copy. */
function ReuseRow({ s, title, sub, current, busy, onUse }: { s: ConnectSetupInfo; title: string; sub?: string; current: boolean; busy: "link" | "copy" | null; onUse: (copy: boolean) => void }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0" data-testid={`reuse-${s.id}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <p className="truncate text-13 font-medium">{title}</p>
          <SetupBadges s={s} />
          {current && <Badge tone="outline">In use here</Badge>}
        </div>
        {sub && <p className="text-11 text-muted-foreground">{sub}</p>}
        <SetupMeta s={s} />
      </div>
      {!current && (
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip label="Follows it: a change to its values reaches this app too.">
            <span><Button size="sm" icon={<Link2 />} loading={busy === "link"} disabled={!s.configured || busy !== null} onClick={() => onUse(false)}>Link</Button></span>
          </Tooltip>
          <Tooltip label="This app gets its own copy of the values. Later changes do not reach it.">
            <span><Button size="sm" variant="ghost" icon={<CopyIcon />} loading={busy === "copy"} disabled={!s.configured || busy !== null} onClick={() => onUse(true)}>Copy</Button></span>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

export function ProjectSettingsPane({ projectId, slug }: { projectId: string; slug: string }) {
  const q = useProjectConnect(projectId);
  const d = q.data;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background" data-testid="project-settings">
      <div className="mx-auto flex max-w-[860px] flex-col gap-6 px-6 pb-16 pt-5">
        {q.isLoading ? <ListSkeleton rows={4} /> : !d ? <LoadError what="This project's settings" error={q.error} onRetry={() => q.refetch()} /> : <OneConnect projectId={projectId} slug={slug} d={d} />}
      </div>
    </div>
  );
}

function OneConnect({ projectId, slug, d }: { projectId: string; slug: string; d: ProjectConnectResponse }) {
  const nav = useNavigate();
  const set = useSetProjectConnect(projectId);
  const initial: Choice = !d.connect.setupId ? "off" : d.owned ? "new" : d.setup?.kind === "template" ? "template" : "project";
  const [choice, setChoice] = useState<Choice>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const st = statusOf(d);
  const uses = listNames(d.usesOne.map((u) => u.name));
  const templates = d.templates.filter((t) => !t.sample || d.sample);

  const apply = async (body: ProjectConnectBody, key: string, done?: (r: ProjectConnectResponse) => void) => {
    setBusy(key);
    try {
      const r = await set.mutateAsync(body);
      done?.(r);
    } catch (e) {
      toast({ title: "Could not change One Connect", detail: humanError(e), tone: "destructive" });
    } finally {
      setBusy(null);
    }
  };
  const makeNew = () => apply({ use: "new" }, "new", (r) => { if (r.setup) nav(`/setup/connect/${r.setup.id}?project=${projectId}`); });
  const use = (body: ProjectConnectBody, key: string, label: string) =>
    apply(body, key, () => toast({ title: "One Connect is on", detail: `${label}. The preview restarted with it.` }));

  return (
    <>
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className="text-15 font-semibold tracking-tight">One Connect</h2>
          <Badge tone={st.tone} data-testid="connect-status">{st.label}</Badge>
        </div>
        <p className="max-w-[640px] text-xs text-muted-foreground">
          Optional. When it is on, this app's login is Sign in with One on its own Connect app, and the people who use it grant it their own tools. In preview its calls run on your own sign-in to it. {BRAND_NAME} itself reaches One through the One CLI and never through this.
        </p>
      </header>

      {d.usesOne.length > 0 && !d.connect.enabled && (
        <div className="flex items-start gap-2 rounded-md border border-warning-text/30 bg-warning-text/8 px-3 py-2 text-xs" role="status">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-text" />
          <span>This app uses {uses}. Its One calls are refused on this computer until One Connect is on.</span>
        </div>
      )}

      {d.setup && <Current projectId={projectId} d={d} />}

      <Section id="choose" title={d.setup ? "Change the Connect app" : "Choose a Connect app"} hint="Make one for this app, or reuse one you already have. Every project on this computer shares one preview redirect URI, so reuse needs no new registration.">
        <div role="radiogroup" aria-label="Connect app" className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          <ChoiceCard value="off" cur={choice} onPick={setChoice} icon={<PowerOff />} title="Off" detail="No One login. The app keeps its own data." />
          <ChoiceCard value="new" cur={choice} onPick={setChoice} icon={<Plus />} title="New Connect app" detail="Made in the One dashboard for this app." />
          <ChoiceCard value="template" cur={choice} onPick={setChoice} icon={<KeyRound />} title="Use a template" detail={templates.length ? `${templates.length} saved` : "None saved yet"} />
          <ChoiceCard value="project" cur={choice} onPick={setChoice} icon={<FolderGit2 />} title="Use another project's" detail={d.others.length ? `${d.others.length} project${d.others.length === 1 ? "" : "s"}` : "None yet"} />
        </div>

        <div className="slide-up" key={choice}>
          {choice === "off" && (
            <Card className="flex items-center gap-3 px-4 py-3">
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                {d.connect.setupId ? `Off unlinks ${d.setup?.name ?? "the Connect app"} from this app. Its values stay where they are.` : "One Connect is off. Plain apps need nothing more."}
              </p>
              {d.connect.setupId && <Button size="sm" loading={busy === "none"} onClick={() => void apply({ use: "none" }, "none", () => toast({ title: "One Connect is off", detail: "The app has no One login now." }))}>Turn off and unlink</Button>}
            </Card>
          )}
          {choice === "new" && (
            d.owned ? (
              <p className="text-xs text-muted-foreground">This project has its own Connect app, above. Edit its values there.</p>
            ) : (
              <Card className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">A Connect app for this app alone</p>
                  <p className="text-11 text-muted-foreground">Make it in the One dashboard, then paste its values on the secure setup screen. About five minutes. Save it as a template after, to reuse it.</p>
                </div>
                <Button size="sm" variant="primary" loading={busy === "new"} onClick={() => void makeNew()} data-testid="connect-new">Set it up</Button>
              </Card>
            )
          )}
          {choice === "template" && (
            templates.length ? (
              <Card>
                {templates.map((t) => (
                  <ReuseRow
                    key={t.id}
                    s={t}
                    title={t.name}
                    current={d.connect.setupId === t.id}
                    busy={busy === `t:${t.id}:link` ? "link" : busy === `t:${t.id}:copy` ? "copy" : null}
                    onUse={(copy) => void use({ use: "template", setupId: t.id, copy }, `t:${t.id}:${copy ? "copy" : "link"}`, copy ? `Copied ${t.name}` : `Linked to ${t.name}`)}
                  />
                ))}
                <div className="border-t border-border px-4 py-2 text-11 text-muted-foreground"><Link to="/settings/templates" className="font-medium text-foreground underline-offset-2 hover:underline">Manage templates</Link> in {BRAND_NAME}'s Settings.</div>
              </Card>
            ) : (
              <Card className="px-4 py-3 text-xs text-muted-foreground">No templates yet. Save one in <Link to="/settings/templates" className="font-medium text-foreground underline-offset-2 hover:underline">Settings, Connect templates</Link>, or set up a new Connect app here and save it as a template.</Card>
            )
          )}
          {choice === "project" && (
            d.others.length ? (
              <Card>
                {d.others.map((o) => (
                  <ReuseRow
                    key={o.setup.id}
                    s={o.setup}
                    title={o.name}
                    sub={o.setup.name}
                    current={d.connect.setupId === o.setup.id}
                    busy={busy === `p:${o.projectId}:link` ? "link" : busy === `p:${o.projectId}:copy` ? "copy" : null}
                    onUse={(copy) => void use({ use: "project", projectId: o.projectId, copy }, `p:${o.projectId}:${copy ? "copy" : "link"}`, copy ? `Copied ${o.name}'s Connect app` : `Linked to ${o.name}'s Connect app`)}
                  />
                ))}
              </Card>
            ) : (
              <Card className="px-4 py-3 text-xs text-muted-foreground">No other project has a Connect app of its own yet.</Card>
            )
          )}
        </div>
      </Section>

      <Section id="redirect" title="Redirect URIs" hint="The addresses this app's Connect app lists under Where users return, exactly as shown.">
        <Card>
          <div className="flex flex-col gap-1.5 border-b border-border px-4 py-3">
            <div className="flex items-center gap-2"><p className="text-xs font-medium">Preview</p><Badge tone="outline">Every project</Badge></div>
            <CopyValue value={d.redirectUris.preview} label="Copy the preview redirect URI" />
            <p className="text-11 text-muted-foreground">One address for every project on this computer. {BRAND_NAME} sends each sign-in back to the app that started it.</p>
          </div>
          <div className="flex flex-col gap-1.5 px-4 py-3">
            <div className="flex items-center gap-2"><p className="text-xs font-medium">Published</p><Badge tone={d.redirectUris.productionSource === "deployed" ? "success" : "outline"}>{d.redirectUris.productionSource === "deployed" ? "Deployed" : "After you publish"}</Badge></div>
            {d.redirectUris.production && <CopyValue value={d.redirectUris.production} label="Copy the production redirect URI" testId="redirect-uri-production" />}
            <p className="text-11 text-muted-foreground">{d.redirectUris.productionSource === "deployed" ? "From the last Vercel deploy." : `The address ${slug} gets on Vercel. Publish shows it again.`}</p>
          </div>
        </Card>
      </Section>

      <Section id="preview" title="In preview" hint="You sign in to the app like its users will. What you grant its Connect app is what its calls can reach, and One's own refusals show up in Access.">
        <Card className="flex items-center gap-3 px-4 py-3">
          <Plug className="size-4 shrink-0 stroke-[1.75] text-muted-foreground" />
          <p className="min-w-0 flex-1 text-xs">{d.connect.enabled ? <>Sign in with One opens One's consent for <span className="font-medium">{d.setup?.name}</span>. Three short steps.</> : <span className="text-muted-foreground">Turn on One Connect first.</span>}</p>
          <Button size="sm" icon={d.connect.enabled ? <Check /> : undefined} disabled={!d.connect.enabled} onClick={() => window.open(d.previewSignIn, "_blank", "noopener")}>Sign in with One</Button>
        </Card>
      </Section>
    </>
  );
}
