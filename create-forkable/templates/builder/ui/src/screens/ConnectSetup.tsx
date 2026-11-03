// Set up a Connect app (CONTRACT 18): the steps in the One
// dashboard on the left, the values on the right. Three scopes, one screen:
//   /setup/connect/:setupId?project=:id   a project's own Connect app
//   /setup/connect/:setupId               a saved template
//   /setup/connect?new=template           a new template
// Paste a whole block of NAME=value lines and it fills every field; each
// field checks its own format as you type; Check asks One about the client
// id and secret; Save stores them (macOS Keychain, or a file only you can
// read). Nothing on this page ever shows a saved value again: secrets show
// as saved, ids by their last four. The redirect URIs are the platform's,
// shown to register, never typed.

import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowRight, Check, ExternalLink, KeyRound, Lock, Plug, ShieldCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { ConnectCheckResponse, ConnectSetupInfo, EnvVarStatus } from "@builder/core/api-types";
import { CONNECT_VAR_SPECS, ONE_DASHBOARD_URL, guessConnectName, parseEnvBlock, validateConnectVar, type ConnectVarSpec } from "@builder/core/envvars";
import { api, fieldErrors, humanError } from "@/lib/api";
import { BRAND_NAME } from "@/lib/brand";
import { keys, useConnectTemplates, useProject, useProjectConnect, useSetProjectConnect } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn, fmtAgo } from "@/lib/utils";
import { Badge, Button, ConfirmButton, EmptyState, Input, ListSkeleton, LoadError, Spinner } from "@/components/ui";
import { CheckResult, CopyValue, usedByLabel } from "@/components/connect/parts";
import { SecretInput } from "@/components/env/SecretInput";
import { TopNav } from "./Home";

type Values = Record<string, string>;

function Step({ n, title, children, done, last }: { n: number; title: string; children: React.ReactNode; done?: boolean; last?: boolean }) {
  return (
    <li className="relative flex gap-3 pb-6 last:pb-0">
      {!last && <span className="absolute bottom-0 left-3 top-7 w-px -translate-x-1/2 bg-border" aria-hidden />}
      <span className={cn("relative flex size-6 shrink-0 items-center justify-center rounded-full border text-11 font-semibold tnum", done ? "border-success-text/40 bg-success-text/12 text-success-text" : "border-border bg-card text-muted-foreground")}>
        {done ? <Check className="size-3.5 stroke-[2.5]" /> : n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
        <p className="text-13 font-semibold">{title}</p>
        <div className="flex flex-col gap-2 text-xs leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

function Steps({ redirectUri, production, projectName, done }: { redirectUri: string; production: string | null; projectName: string | null; done: boolean }) {
  const dashboardUrl = ONE_DASHBOARD_URL;
  return (
    <ol className="flex flex-col" aria-label="Steps in the One dashboard">
      <Step n={1} title="Create the app in One" done={done}>
        <p>In the One dashboard, open <span className="text-foreground">Developers, Connect, New app</span>. Name it so you know it later, for example "{projectName ?? "Acme Inc apps"}".</p>
        <div><Button size="sm" icon={<ExternalLink />} onClick={() => window.open(dashboardUrl, "_blank", "noopener")}>Open the One dashboard</Button></div>
      </Step>
      <Step n={2} title={production ? "Add these redirect URIs" : "Add this redirect URI"} done={done}>
        <p>Under <span className="text-foreground">Where users return</span>, paste {production ? "each" : "it"} exactly. The match is character for character: scheme, host, port and path.</p>
        <div className="flex flex-col gap-1">
          <span className="text-11 font-medium text-foreground">Preview</span>
          <CopyValue value={redirectUri} label="Copy the preview redirect URI" />
          <span className="text-11">The same address for every project on this computer, so one Connect app can serve them all.</span>
        </div>
        {production ? (
          <div className="flex flex-col gap-1">
            <span className="text-11 font-medium text-foreground">Published on Vercel</span>
            <CopyValue value={production} label="Copy the production redirect URI" testId="redirect-uri-production" />
            <span className="text-11">Add it now or when you publish. Publish shows it again.</span>
          </div>
        ) : (
          <p>Each app you publish adds its own address too. Publish shows it.</p>
        )}
      </Step>
      <Step n={3} title="Choose what it asks for" done={done}>
        <p>Pick the tools {projectName ? "this app" : "the apps using it"} call{projectName ? "s" : ""}, at <span className="text-foreground">Read &amp; write</span> where {projectName ? "it writes" : "they write"}. {projectName ? "Its Access tab" : "Each project's Access tab"} lists exactly what the code calls. What you grant it in preview is what runs.</p>
      </Step>
      <Step n={4} title="Copy the credentials" last done={done}>
        <p>Click <span className="text-foreground">Create app</span>, then under <span className="text-foreground">Credentials</span> copy the client ID and the client secret, which is shown once. Then <span className="text-foreground">Connect keys, Create key</span>, with the dashboard on Production. Copy the Ask id too if the app has one.</p>
        <p className="rounded-md border border-dashed border-border px-2.5 py-1.5">Paste them one by one, or all at once as <span className="font-mono text-foreground">NAME=value</span> lines. The form splits them.</p>
      </Step>
    </ol>
  );
}

/** A saved value: never the value, only that it is set, where, and the last four of an id. */
function Saved({ s, onReplace, onRemove, removing }: { s: EnvVarStatus; onReplace: () => void; onRemove: () => void; removing: boolean }) {
  return (
    <div className="flex h-8 items-center gap-2 rounded-md border border-border bg-faint pl-2.5 pr-1" data-testid={`saved-${s.name}`}>
      <Lock className="size-3.5 shrink-0 text-success-text" />
      <span className={cn("min-w-0 flex-1 truncate text-xs text-muted-foreground", s.hint && "font-mono")} title={s.hint ?? undefined}>{s.hint ?? "Saved, hidden"}</span>
      <span className="hidden shrink-0 text-11 text-muted-foreground sm:inline">{s.whereLabel}{s.updatedAt ? ` · ${fmtAgo(s.updatedAt)}` : s.manual ? " · set by hand" : ""}</span>
      <Button size="sm" variant="ghost" onClick={onReplace}>Replace</Button>
      <ConfirmButton size="sm" variant="ghost" confirmLabel="Remove it" loading={removing} onConfirm={onRemove}>Remove</ConfirmButton>
    </div>
  );
}

function FieldRow({ spec, status, value, editing, error, redirectUri, onChange, onBlock, onReplace, onCancel, onRemove, onMove, removing, inputRef }: {
  spec: ConnectVarSpec;
  status: EnvVarStatus | undefined;
  value: string;
  editing: boolean;
  error: string | null;
  redirectUri: string;
  onChange: (v: string) => void;
  onBlock: (text: string) => void;
  onReplace: () => void;
  onCancel: () => void;
  onRemove: () => void;
  onMove: (to: string) => void;
  removing: boolean;
  inputRef?: (el: HTMLInputElement | null) => void;
}) {
  const check = value.trim() ? validateConnectVar(spec.name, value, { redirectUri }) : null;
  const elsewhere = value.trim() ? guessConnectName(value) : null;
  const canMove = check?.level === "error" && elsewhere && elsewhere !== spec.name;
  const message = error ?? (check && check.level !== "ok" ? check.message : null);
  const id = `f-${spec.name}`;
  return (
    <div className="flex flex-col gap-1 border-b border-border px-4 py-3 last:border-b-0" data-testid={`field-${spec.name}`}>
      <div className="flex items-baseline gap-2">
        <label htmlFor={id} className="text-xs font-medium">{spec.label}</label>
        <span className="font-mono text-11 text-muted-foreground">{spec.name}</span>
        <span className="ml-auto">
          {status?.present && !editing ? <Badge tone="success">Saved</Badge> : !spec.required ? <Badge tone="outline">Optional</Badge> : spec.secret ? <Badge tone="neutral">Secret</Badge> : null}
        </span>
      </div>
      {status?.present && !editing ? (
        <Saved s={status} onReplace={onReplace} onRemove={onRemove} removing={removing} />
      ) : (
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <SecretInput id={id} ref={inputRef} value={value} onChange={onChange} onBlock={onBlock} secret={spec.secret} check={check} placeholder={spec.placeholder || undefined} aria-describedby={`${id}-hint`} />
          </div>
          {status?.present && <Button size="sm" variant="ghost" onClick={onCancel}>Keep saved</Button>}
        </div>
      )}
      <p id={`${id}-hint`} className={cn("flex flex-wrap items-center gap-x-1.5 text-11", message ? (error || check?.level === "error" ? "text-destructive-text" : "text-warning-text") : "text-muted-foreground")} role={error ? "alert" : undefined}>
        {message ?? spec.where}
        {canMove && (
          <button type="button" className="font-medium text-foreground underline underline-offset-2" onClick={() => onMove(elsewhere!)}>
            Move it to {CONNECT_VAR_SPECS.find((s) => s.name === elsewhere)!.label}
          </button>
        )}
      </p>
    </div>
  );
}

/** Keyed by the setup, so a new template that was just saved opens fresh on its own page. */
export function ConnectSetup() {
  const { setupId } = useParams();
  return <ConnectSetupScreen key={setupId ?? "new"} />;
}

function ConnectSetupScreen() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { setupId } = useParams();
  const [params] = useSearchParams();
  const projectId = params.get("project");
  const isNew = !setupId && params.get("new") === "template";
  const t = useConnectTemplates();
  const pc = useProjectConnect(projectId ?? "");
  const project = useProject(projectId ?? "");
  const setConnect = useSetProjectConnect(projectId ?? "");
  const d = t.data;
  const setup: ConnectSetupInfo | null = setupId ? [...(d?.templates ?? []), ...(d?.projectSetups ?? [])].find((x) => x.id === setupId) ?? null : null;
  const [values, setValues] = useState<Values>({});
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [check, setCheck] = useState<ConnectCheckResponse | null>(null);
  const [saved, setSaved] = useState<string[] | null>(() => (params.get("saved") ? [] : null));
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const statusOf = (n: string) => setup?.vars.find((v) => v.name === n);
  const redirectUri = d?.redirectUri ?? "";
  const typed = useMemo(() => Object.fromEntries(Object.entries(values).filter(([k, v]) => v.trim() && (!statusOf(k)?.present || editing[k]))), [values, editing, setup]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = Object.keys(typed).length > 0;
  const formErrors = Object.entries(typed).some(([k, v]) => validateConnectVar(k, v, { redirectUri }).level === "error");
  const missing = CONNECT_VAR_SPECS.filter((s) => s.required && !statusOf(s.name)?.present && !typed[s.name]);
  const configured = Boolean(setup?.configured);
  const projectName = projectId ? project.data?.name ?? null : null;
  const scope = projectId ? "project" : "template";
  const back = projectId ? { to: `/p/${projectId}/settings`, label: `${projectName ?? "Project"}, Settings` } : { to: "/settings/templates", label: "Settings, Connect templates" };

  const set = (n: string, v: string) => {
    setValues((x) => ({ ...x, [n]: v }));
    setErrors((e) => ({ ...e, [n]: "" }));
    setCheck(null);
    setSaved(null);
  };

  const splitBlock = (text: string) => {
    const { entries } = parseEnvBlock(text);
    const known = entries.filter((e) => CONNECT_VAR_SPECS.some((s) => s.name === e.name));
    const ignored = entries.filter((e) => !CONNECT_VAR_SPECS.some((s) => s.name === e.name)).map((e) => e.name);
    if (!known.length) {
      toast({ title: "Nothing to fill in", detail: "The paste has no ONE_ settings in it." });
      return;
    }
    setValues((x) => ({ ...x, ...Object.fromEntries(known.map((e) => [e.name, e.value])) }));
    setEditing((x) => ({ ...x, ...Object.fromEntries(known.filter((e) => statusOf(e.name)?.present).map((e) => [e.name, true])) }));
    setErrors({});
    setCheck(null);
    setSaved(null);
    toast({ title: `Filled ${known.length} field${known.length === 1 ? "" : "s"}`, detail: ignored.length ? `Left out ${ignored.join(", ")}: ${ignored.includes("ONE_REDIRECT_URI") ? `${BRAND_NAME} sets the redirect URI itself` : "not a Connect app setting"}.` : "Check the marks next to each field, then save." });
  };

  const move = (from: string, to: string) => {
    const v = values[from] ?? "";
    setValues((x) => ({ ...x, [from]: "", [to]: v }));
    if (statusOf(to)?.present) setEditing((x) => ({ ...x, [to]: true }));
    setTimeout(() => inputs.current[to]?.focus(), 0);
  };

  const runCheck = async () => {
    setChecking(true);
    try {
      setCheck(setup ? await api.checkSetup(setup.id, typed) : await api.checkNewSetup(typed));
    } catch (e) {
      toast({ title: "Could not check", detail: humanError(e), tone: "destructive" });
    } finally {
      setChecking(false);
    }
  };

  const after = () => {
    void qc.invalidateQueries({ queryKey: keys.connectTemplates });
    if (projectId) void qc.invalidateQueries({ queryKey: keys.projectConnect(projectId) });
    setValues({});
    setEditing({});
    setErrors({});
    setCheck(null);
  };

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      if (setup) {
        await api.saveSetupEnv(setup.id, typed);
        setSaved(Object.keys(typed));
        after();
      } else {
        const r = await api.createTemplate({ name: name.trim() || "Connect app", values: typed });
        after();
        nav(`/setup/connect/${r.setup.id}?saved=1`, { replace: true });
      }
    } catch (e) {
      const f = fieldErrors(e);
      if (Object.keys(f).length) setErrors(f);
      else toast({ title: "Could not save", detail: humanError(e), tone: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (n: string) => {
    if (!setup) return;
    setRemoving(n);
    try {
      await api.removeSetupEnv(setup.id, n);
      after();
      setSaved(null);
      toast({ title: `${n} removed`, detail: "Taken off this computer." });
    } catch (e) {
      toast({ title: "Could not remove it", detail: humanError(e), tone: "destructive" });
    } finally {
      setRemoving(null);
    }
  };

  const turnOn = () =>
    setConnect.mutate({ enabled: true }, {
      onSuccess: () => { toast({ title: "One Connect is on", detail: `${projectName ?? "The app"} signs in with One now. Its preview restarted.` }); nav(`/p/${projectId}/settings`); },
      onError: (e) => toast({ title: "Could not turn it on", detail: humanError(e), tone: "destructive" }),
    });

  const title = isNew ? "New Connect template" : projectId ? `A Connect app for ${projectName ?? "this project"}` : setup?.name ?? "Connect app";
  const lead = isNew
    ? "Save a Connect app you made in the One dashboard once, then use it in any project, linked or copied. About five minutes."
    : projectId
      ? `When One Connect is on, ${projectName ?? "this app"} signs its users in with One through this Connect app, and in preview its calls run on your own sign-in to it. About five minutes.`
      : `A saved template. ${setup ? usedByLabel(setup) : ""}${setup?.usedBy.length ? `: ${setup.usedBy.map((u) => u.name).join(", ")}` : ""}. A change here reaches every project that links it.`;
  const loading = t.isLoading || (projectId && (pc.isLoading || project.isLoading));
  const missingSetup = !isNew && !loading && d && !setup;
  const linkedElsewhere = projectId && setup && pc.data && pc.data.setup?.id === setup.id && !pc.data.owned;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopNav />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-6 px-6 pb-16 pt-6">
          <header className="flex flex-col gap-1">
            <Link to={back.to} className="w-fit text-11 font-medium text-muted-foreground hover:text-foreground">{back.label}</Link>
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            <p className="max-w-[640px] text-13 text-muted-foreground">{lead}</p>
          </header>

          {loading ? <ListSkeleton rows={5} /> : !d ? <LoadError what="This Connect app" error={t.error} onRetry={() => t.refetch()} /> : missingSetup ? (
            <EmptyState icon={<KeyRound />} title="This Connect app is gone" detail="It was removed, or the link is old.">
              <Link to={back.to} className="mt-2 text-xs font-medium underline-offset-2 hover:underline">Back</Link>
            </EmptyState>
          ) : (
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
              <section className="flex flex-col gap-4" aria-labelledby="steps-title">
                <h2 id="steps-title" className="text-11 font-medium uppercase tracking-wide text-muted-foreground">In the One dashboard</h2>
                <Steps redirectUri={redirectUri} production={projectId ? pc.data?.redirectUris.production ?? null : null} projectName={projectName} done={configured} />
              </section>

              <section className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start" aria-labelledby="values-title">
                <div className="flex items-center justify-between gap-2">
                  <h2 id="values-title" className="text-11 font-medium uppercase tracking-wide text-muted-foreground">Paste the values here</h2>
                  <Badge tone={configured ? "success" : "outline"}>{configured ? "Set up" : `${missing.length} to go`}</Badge>
                </div>

                {linkedElsewhere && (
                  <p className="flex items-start gap-2 rounded-md border border-warning-text/30 bg-warning-text/8 px-3 py-2 text-xs"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-text" />This project links {setup!.name}. A change here reaches the {setup!.usedBy.length} project{setup!.usedBy.length === 1 ? "" : "s"} that use it.</p>
                )}

                {saved && configured ? (
                  <div className="slide-up flex flex-col gap-3 rounded-lg border border-success-text/30 bg-success-text/8 p-4" data-testid="saved-banner" role="status">
                    <div className="flex items-start gap-2.5">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-success-text/15 text-success-text"><Check className="size-4 stroke-[2.25]" /></span>
                      <div className="min-w-0">
                        <p className="text-13 font-semibold">{scope === "project" ? "The Connect app is ready" : "Template saved"}</p>
                        <p className="text-xs text-muted-foreground">Saved to {d.store.preferred === "keychain" ? "the macOS Keychain" : "a file only you can read"}. {scope === "project" ? (pc.data?.connect.enabled ? "The preview picked it up." : "Turn on One Connect to use it.") : "Any project can use it from its Settings, One Connect."}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pl-9">
                      {scope === "project" && !pc.data?.connect.enabled ? (
                        <Button variant="primary" icon={<Plug />} loading={setConnect.isPending} onClick={turnOn} data-testid="turn-on">Turn on One Connect</Button>
                      ) : (
                        <Button icon={<ArrowRight />} onClick={() => nav(back.to)}>{scope === "project" ? `Back to ${projectName ?? "the project"}` : "Back to templates"}</Button>
                      )}
                      {scope === "project" && !pc.data?.connect.enabled && <span className="text-11 text-muted-foreground">The app's login becomes Sign in with One. Its preview restarts.</span>}
                    </div>
                  </div>
                ) : null}

                <form
                  className="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_1px_rgb(0_0_0/0.03)]"
                  onSubmit={(e) => { e.preventDefault(); void save(); }}
                  autoComplete="off"
                  data-testid="connect-form"
                >
                  {isNew && (
                    <div className="flex flex-col gap-1 border-b border-border px-4 py-3">
                      <label htmlFor="f-name" className="text-xs font-medium">Template name</label>
                      <Input id="f-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc apps" maxLength={80} className="h-8" />
                      <p className="text-11 text-muted-foreground">What projects see when they pick a template. Only on this computer.</p>
                    </div>
                  )}
                  {CONNECT_VAR_SPECS.map((spec) => (
                    <FieldRow
                      key={spec.name}
                      spec={spec}
                      status={statusOf(spec.name)}
                      value={values[spec.name] ?? ""}
                      editing={Boolean(editing[spec.name])}
                      error={errors[spec.name] || null}
                      redirectUri={redirectUri}
                      onChange={(v) => set(spec.name, v)}
                      onBlock={splitBlock}
                      onReplace={() => { setEditing((x) => ({ ...x, [spec.name]: true })); setTimeout(() => inputs.current[spec.name]?.focus(), 0); }}
                      onCancel={() => { setEditing((x) => ({ ...x, [spec.name]: false })); set(spec.name, ""); }}
                      onRemove={() => void remove(spec.name)}
                      onMove={(to) => move(spec.name, to)}
                      removing={removing === spec.name}
                      inputRef={(el) => { inputs.current[spec.name] = el; }}
                    />
                  ))}
                  <div className="flex flex-wrap items-center gap-2 border-t border-border bg-faint px-4 py-3">
                    <p className="flex min-w-0 flex-1 items-center gap-1.5 text-11 text-muted-foreground">
                      <KeyRound className="size-3.5 shrink-0" />
                      <span className="min-w-0 truncate" title={`Saves to ${d.store.label}`}>Saves to {d.store.preferred === "keychain" ? "the macOS Keychain" : "a file only you can read"}</span>
                    </p>
                    <Button type="button" icon={checking ? undefined : <ShieldCheck />} loading={checking} disabled={(formErrors && dirty) || (!setup && !dirty)} onClick={() => void runCheck()}>Check</Button>
                    <Button type="submit" variant="primary" loading={saving} disabled={!dirty || formErrors} trailing={!saving ? <ArrowRight className="size-3.5" /> : undefined}>Save</Button>
                  </div>
                </form>

                {checking && !check && <p className="flex items-center gap-2 text-11 text-muted-foreground"><Spinner />Checking with One</p>}
                {check && <CheckResult r={check} />}

                <p className="text-11 leading-relaxed text-muted-foreground">
                  Values go from this page to {BRAND_NAME} on this computer only. They are never shown again, never written to a log, and never reach a coding agent, a prompt or an app's files. The app gets them when its preview starts. Replace or remove them here any time.
                </p>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
