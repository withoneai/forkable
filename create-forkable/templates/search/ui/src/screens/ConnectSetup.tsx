// Set up Sign in with One (local mode). Write-only: a saved value never comes
// back to this page, only that it is saved, where, and its last four. What
// you type is cleared from the page the moment the server has it.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Copy, ExternalLink, Lock, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import type { ConnectSetupResponse } from "@/contract/api-types";
import { api, ApiError, type FieldName } from "@/lib/api";
import { keys } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import { Badge } from "@/components/ui/Badge";
import { Button, Spinner } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";

const DASHBOARD = "https://app.withone.ai/connect";

interface Spec { name: FieldName; label: string; secret: boolean; required: boolean; placeholder: string; where: string }
const FIELDS: Spec[] = [
  { name: "ONE_CLIENT_ID", label: "Client ID", secret: false, required: true, placeholder: "oc_...", where: "Credentials, Client ID. pnpm connect writes it for you." },
  { name: "ONE_PERMISSION_SET", label: "Permission set", secret: false, required: false, placeholder: "ps_...", where: "Optional. The ask this app makes at sign-in." },
  { name: "ONE_CLIENT_SECRET", label: "Client secret", secret: true, required: true, placeholder: "Shown once in the dashboard", where: "Credentials, Client secret. Shown once." },
  { name: "ONE_CONNECT_KEY", label: "Connect key", secret: true, required: true, placeholder: "Shown once in the dashboard", where: "Connect keys, Create key on Production. Shown once." },
];

export function checkField(spec: Spec, v: string): { ok: boolean; message: string } {
  const t = v.trim();
  if (!t) return { ok: false, message: "Paste a value first." };
  if (/\s/.test(t)) return { ok: false, message: "No spaces. Paste it exactly as One shows it." };
  if (spec.secret && t.length < 16) return { ok: false, message: "That looks too short for this value." };
  return { ok: true, message: "Looks right." };
}

const setupKey = keys.setup;
type Draft = Partial<Record<FieldName, string>>;

export function ConnectSetup() {
  const q = useQuery({ queryKey: setupKey, queryFn: api.connectSetup });
  const qc = useQueryClient();
  const nav = useNavigate();
  const [draft, setDraft] = useState<Draft>({});
  const [editing, setEditing] = useState<Set<FieldName>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<FieldName | null>(null);
  const [creating, setCreating] = useState(false);

  const apply = async (next: ConnectSetupResponse) => {
    qc.setQueryData(setupKey, next);
    await qc.invalidateQueries({ queryKey: keys.me });
  };

  const s = q.data;
  const waiting = s?.create.state === "waiting";
  // Poll while One waits for the human to approve in the browser.
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => { void api.pollConnectApp().then((r) => { void apply(r); if (r.create.state === "approved") toast({ title: "Approved", detail: "Now paste the secret and the Connect key." }); }).catch(() => undefined); }, 1500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  const typed = Object.entries(draft).filter(([, v]) => v?.trim()) as [FieldName, string][];
  const invalid = typed.some(([n, v]) => !checkField(FIELDS.find((f) => f.name === n)!, v).ok);

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      const next = await api.saveConnectSetup(Object.fromEntries(typed));
      setDraft({});
      setEditing(new Set());
      await apply(next);
      toast({ title: next.configured ? "Saved. Sign in with One is on" : "Saved", detail: next.storage === "keychain" ? "In your macOS Keychain" : "In a file only you can read" });
    } catch (e) {
      const fields = e instanceof ApiError ? (e.data as { fields?: Record<string, string> } | null)?.fields : undefined;
      if (fields) setErrors(fields);
      else toast({ title: "Did not save", detail: (e as Error).message, tone: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (name: FieldName) => {
    setRemoving(name);
    try { await apply(await api.removeConnectSetup(name)); }
    catch (e) { toast({ title: "Could not remove it", detail: (e as Error).message, tone: "destructive" }); }
    finally { setRemoving(null); }
  };

  const create = async () => {
    setCreating(true);
    try { await apply(await api.createConnectApp()); }
    catch (e) { toast({ title: "Could not start it", detail: (e as Error).message, tone: "destructive" }); }
    finally { setCreating(false); }
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 px-5">
        <Logo size={18} />
        <span className="text-13 font-semibold tracking-tight">Search</span>
        <span className="text-13 text-muted-foreground">/ Set up Sign in with One</span>
      </header>
      <main className="flex min-h-0 flex-1 justify-center overflow-y-auto px-5 py-8">
        <div className="slide-up flex w-full max-w-[920px] flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Link to="/start" className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3" /> Back</Link>
            <h1 className="text-xl font-semibold tracking-tight">Set up Sign in with One</h1>
            <p className="max-w-[620px] text-13 text-muted-foreground">
              Search signs people in with your Connect app. Paste its credentials here once. They go to your macOS Keychain, never to a file in this repo, and this page never shows them again.
            </p>
          </div>

          {q.isError && <LoadError what="Connect setup" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} className="rounded-lg border border-border bg-card" />}
          {!s && !q.isError && <Skeleton className="h-72 w-full rounded-lg" />}
          {s && !s.available && (
            <p className="rounded-lg border border-border bg-card p-4 text-13 text-muted-foreground" data-testid="setup-unavailable">Connect setup runs on this computer only. A hosted Search reads its Connect app from the host's secrets.</p>
          )}
          {s?.available && (
            <>
              <Status s={s} onOpen={() => nav("/start")} />
              <CreateCard s={s} busy={creating} onCreate={() => void create()} />
              <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                <Steps redirectUri={s.redirectUri} />
                <form className="flex flex-col self-start rounded-lg border border-border bg-card" autoComplete="off" onSubmit={(e) => { e.preventDefault(); if (typed.length && !invalid) void save(); }}>
                  {FIELDS.map((f) => {
                    const st = s.fields.find((x) => x.name === f.name) ?? { name: f.name, saved: false, where: null, updatedAt: null, last4: null };
                    const open = !st.saved || editing.has(f.name);
                    return (
                      <FieldRow
                        key={f.name} spec={f} status={st} open={open} value={draft[f.name] ?? ""} error={errors[f.name] ?? null} removing={removing === f.name}
                        onChange={(v) => { setDraft((d) => ({ ...d, [f.name]: v })); setErrors((e) => { const { [f.name]: _, ...rest } = e; return rest; }); }}
                        onReplace={() => setEditing((x) => new Set(x).add(f.name))}
                        onKeep={() => { setEditing((x) => { const n = new Set(x); n.delete(f.name); return n; }); setDraft((d) => ({ ...d, [f.name]: "" })); }}
                        onRemove={() => void remove(f.name)}
                      />
                    );
                  })}
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="flex items-center gap-1.5 text-11 text-muted-foreground">
                      <Lock className="size-3" />
                      {s.storage === "keychain" ? "Saved to your macOS Keychain" : "Saved to a file only you can read"}
                    </span>
                    <Button type="submit" variant="primary" loading={saving} disabled={!typed.length || invalid}>Save</Button>
                  </div>
                </form>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Status({ s, onOpen }: { s: ConnectSetupResponse; onOpen: () => void }) {
  const missing = FIELDS.filter((f) => f.required && !s.fields.find((x) => x.name === f.name)?.saved).map((f) => f.label.replace(/^C/, "c"));
  if (s.configured) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3" data-testid="setup-status">
        <span className="flex size-6 items-center justify-center rounded-full bg-success-text/12 text-success-text"><Check className="size-3.5 stroke-[2.5]" /></span>
        <span className="flex-1 text-13"><span className="font-medium">Sign in with One is on.</span> <span className="text-muted-foreground">Search uses this app for every sign-in on this computer.</span></span>
        <Button variant="primary" trailing={<ArrowRight className="size-3.5" />} onClick={onOpen}>Sign in</Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3" data-testid="setup-status">
      <span className="flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground"><ShieldCheck className="size-3.5" /></span>
      <span className="flex-1 text-13">
        {s.source === "env" ? (
          <><span className="font-medium">Your Connect app is set by pnpm connect.</span> <span className="text-muted-foreground">{missing.length ? `Paste its ${missing.join(" and ")} below to turn Sign in with One on.` : "Sign in with One is off."}</span></>
        ) : (
          <><span className="font-medium">Sign in with One is off.</span> <span className="text-muted-foreground">Still needed: {missing.join(", ")}.</span></>
        )}
      </span>
    </div>
  );
}

/** The approval link is a few hundred characters: a button, a copy, and only its host and start shown. */
export function ApprovalLink({ url }: { url: string }) {
  const short = (() => { try { const u = new URL(url); return `${u.host}${u.pathname.slice(0, 24)}...`; } catch { return `${url.slice(0, 40)}...`; } })();
  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
      <Button size="sm" variant="primary" icon={<ExternalLink />} onClick={() => window.open(url, "_blank", "noopener")} data-testid="approval-open">Open in One to approve</Button>
      <Button size="sm" icon={<Copy />} onClick={() => { void navigator.clipboard.writeText(url).then(() => toast({ title: "Link copied" })); }}>Copy link</Button>
      <span className="min-w-0 truncate font-mono text-11 text-muted-foreground" title={url}>{short}</span>
    </div>
  );
}

/** "Create my Connect app": runs `one connect create` on this computer and waits for the approval. */
function CreateCard({ s, busy, onCreate }: { s: ConnectSetupResponse; busy: boolean; onCreate: () => void }) {
  const st = s.create.state;
  const hasApp = s.fields.find((f) => f.name === "ONE_CLIENT_ID")?.saved;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3" data-testid="create-card">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Sparkles className="size-3.5" /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {st === "waiting" ? (
          <>
            <p className="flex items-center gap-2 text-13 font-medium"><Spinner /> Waiting for you to approve in One</p>
            <p className="text-xs text-muted-foreground">Open the link, check the platforms Search asks for, and approve. This page notices on its own.</p>
            {s.create.approvalUrl && <ApprovalLink url={s.create.approvalUrl} />}
          </>
        ) : st === "approved" ? (
          <>
            <p className="text-13 font-medium">Approved, now paste the secret and the Connect key.</p>
            <p className="text-xs text-muted-foreground">The client ID and permission set are saved. One shows the secret and the key once on the approval page.</p>
          </>
        ) : st === "failed" ? (
          <>
            <p className="text-13 font-medium text-destructive-text">Creating the app did not finish.</p>
            <p className="text-xs text-muted-foreground">{s.create.message ?? "Try again, or make it in the dashboard with the steps below."}</p>
          </>
        ) : (
          <>
            <p className="text-13 font-medium">{hasApp ? "Your Connect app" : "Make the Connect app from code"}</p>
            <p className="text-xs text-muted-foreground">
              {hasApp
                ? "When you add a platform in New profile, the app has to ask for it too. Update the Connect app, approve, then sign in again."
                : "Search reads its manifest, asks One to create the app with exactly those read actions, and you approve it in your browser."}
            </p>
          </>
        )}
      </div>
      {st !== "waiting" && (
        <Button size="sm" variant={hasApp ? "default" : "primary"} icon={hasApp ? <RefreshCw /> : undefined} loading={busy} onClick={onCreate}>
          {hasApp ? "Update the Connect app" : "Create my Connect app"}
        </Button>
      )}
    </div>
  );
}

function Steps({ redirectUri }: { redirectUri: string }) {
  return (
    <ol className="flex flex-col gap-5" aria-label="Steps in the One dashboard">
      <Step n={1} title="Open your Connect app">
        <p>In the One dashboard, open <span className="text-foreground">Developers, Connect</span> and pick the app, or use Create my Connect app above.</p>
        <div><Button size="sm" icon={<ExternalLink />} onClick={() => window.open(DASHBOARD, "_blank", "noopener")}>Open the One dashboard</Button></div>
      </Step>
      <Step n={2} title="Register this redirect URI">
        <p>Under <span className="text-foreground">Where users return</span>, it must match character for character.</p>
        <CopyValue value={redirectUri} />
      </Step>
      <Step n={3} title="Copy the credentials">
        <p>Under <span className="text-foreground">Credentials</span>, the client ID and the client secret, then <span className="text-foreground">Connect keys, Create key</span> on Production. The secret and the key are shown once.</p>
      </Step>
      <Step n={4} title="Paste them here and save">
        <p>Sign in with One turns on as soon as the client ID, secret and Connect key are saved. No restart.</p>
      </Step>
    </ol>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="tnum flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-card text-11 font-semibold text-muted-foreground">{n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
        <p className="text-13 font-semibold">{title}</p>
        <div className="flex flex-col gap-2 text-xs leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex h-8 items-center gap-2 rounded-md border border-border bg-faint pl-2.5 pr-1">
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" data-testid="redirect-uri">{value}</span>
      <Button size="sm" variant="ghost" icon={copied ? <Check /> : <Copy />} aria-label="Copy the redirect URI" onClick={() => {
        void navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
      }}>{copied ? "Copied" : "Copy"}</Button>
    </div>
  );
}

function FieldRow({ spec, status, open, value, error, removing, onChange, onReplace, onKeep, onRemove }: {
  spec: Spec; status: ConnectSetupResponse["fields"][number]; open: boolean; value: string; error: string | null; removing: boolean;
  onChange: (v: string) => void; onReplace: () => void; onKeep: () => void; onRemove: () => void;
}) {
  const id = `f-${spec.name}`;
  const check = value.trim() ? checkField(spec, value) : null;
  const fromEnv = status.where === "env" && !open;
  const message = error ?? (check ? check.message : fromEnv ? "In .env, written by pnpm connect. Run it again to change the app." : spec.where);
  const tone = error || (check && !check.ok) ? "text-destructive-text" : check?.ok ? "text-success-text" : "text-muted-foreground";
  return (
    <div className="flex flex-col gap-1.5 border-b border-border px-4 py-3" data-testid={`field-${spec.name}`}>
      <div className="flex items-baseline gap-2">
        <label htmlFor={id} className="text-xs font-medium">{spec.label}</label>
        <span className="font-mono text-11 text-muted-foreground">{spec.name}</span>
        <span className="ml-auto">
          {status.saved && !open ? <Badge tone="success">Saved</Badge> : !spec.required ? <Badge tone="outline">Optional</Badge> : spec.secret ? <Badge>Secret</Badge> : null}
        </span>
      </div>
      {status.saved && !open ? (
        <div className="flex h-8 items-center gap-2 rounded-md border border-border bg-faint pl-2.5 pr-1">
          <Lock className="size-3.5 shrink-0 text-success-text" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">••••{status.last4 ?? ""}</span>
          <span className="hidden shrink-0 text-11 text-muted-foreground sm:inline">
            {status.where === "keychain" ? "Keychain" : status.where === "env" ? "Set by pnpm connect" : "Private file"}{status.updatedAt ? ` · ${new Date(status.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
          </span>
          {status.where !== "env" && (
            <>
              <Button size="sm" variant="ghost" onClick={onReplace}>Replace</Button>
              <ConfirmButton size="sm" variant="ghost" confirmLabel="Remove it" loading={removing} onConfirm={onRemove}>Remove</ConfirmButton>
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <Input
            id={id} type={spec.secret ? "password" : "text"} mono value={value} placeholder={spec.placeholder}
            autoComplete={spec.secret ? "new-password" : "off"} spellCheck={false} data-1p-ignore data-lpignore="true"
            aria-invalid={!!error || (check ? !check.ok : undefined)} aria-describedby={`${id}-hint`}
            onChange={(e) => onChange(e.target.value)}
          />
          {status.saved && <Button size="sm" variant="ghost" onClick={onKeep}>Keep saved</Button>}
        </div>
      )}
      <p id={`${id}-hint`} className={cn("text-11", tone)} role={error ? "alert" : undefined}>{message}</p>
    </div>
  );
}
