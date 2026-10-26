// Set up Sign in with One (local mode). The steps in the One dashboard on the
// left, the values on the right. Write-only: a saved value never comes back
// to this page, only that it is saved, where, and its last four. What you
// type is cleared from the page the moment it is saved.

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Copy, ExternalLink, Lock, ShieldCheck } from "lucide-react";
import { CONNECT_FIELDS, ONE_DASHBOARD_URL, checkConnectField, type ConnectFieldName, type ConnectFieldSpec, type ConnectFieldStatus, type ConnectSetupResponse } from "@rill/core/connect-setup";
import { api, ApiError } from "@/lib/api";
import { keys } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";

const setupKey = ["setup", "connect"] as const;
type Draft = Partial<Record<ConnectFieldName, string>>;

export function ConnectSetup() {
  const q = useQuery({ queryKey: setupKey, queryFn: api.connectSetup });
  const qc = useQueryClient();
  const nav = useNavigate();
  const [draft, setDraft] = useState<Draft>({});
  const [editing, setEditing] = useState<Set<ConnectFieldName>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<ConnectFieldName | null>(null);

  const apply = async (next: ConnectSetupResponse) => {
    qc.setQueryData(setupKey, next);
    await qc.invalidateQueries({ queryKey: keys.me });
  };

  const typed = Object.entries(draft).filter(([, v]) => v?.trim()) as [ConnectFieldName, string][];
  const invalid = typed.some(([n, v]) => !checkConnectField(n, v).ok);

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      const next = await api.saveConnectSetup(Object.fromEntries(typed));
      // Gone from the page the moment the server has it.
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

  const remove = async (name: ConnectFieldName) => {
    setRemoving(name);
    try {
      await apply(await api.removeConnectSetup(name));
    } catch (e) {
      toast({ title: "Could not remove it", detail: (e as Error).message, tone: "destructive" });
    } finally {
      setRemoving(null);
    }
  };

  const s = q.data;
  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 px-5">
        <Logo size={16} />
        <span className="text-13 font-semibold tracking-tight">Rill</span>
        <span className="text-13 text-muted-foreground">/ Set up Sign in with One</span>
      </header>
      <main className="flex min-h-0 flex-1 justify-center overflow-y-auto px-5 py-8">
        <div className="slide-up flex w-full max-w-[920px] flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Link to="/start" className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3" /> Back</Link>
            <h1 className="text-xl font-semibold tracking-tight">Set up Sign in with One</h1>
            <p className="max-w-[620px] text-13 text-muted-foreground">
              Rill signs people in with your Connect app. Paste its credentials here once. They go to your macOS Keychain, never to a file in this repo, and this page never shows them again.
            </p>
          </div>

          {q.isError && <LoadError what="Connect setup" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} className="rounded-lg border border-border bg-card" />}
          {!s && !q.isError && <Skeleton className="h-72 w-full rounded-lg" />}
          {s && !s.available && (
            <p className="rounded-lg border border-border bg-card p-4 text-13 text-muted-foreground">Connect setup runs in local mode only. A hosted Rill reads its Connect app from the host's secrets.</p>
          )}
          {s?.available && (
            <>
              <Status s={s} onOpen={() => nav("/start")} />
              <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                <Steps redirectUri={s.redirectUri} />
                <form
                  className="flex flex-col self-start rounded-lg border border-border bg-card"
                  autoComplete="off"
                  onSubmit={(e) => { e.preventDefault(); if (typed.length && !invalid) void save(); }}
                >
                  {CONNECT_FIELDS.map((f) => {
                    const st = s.fields.find((x) => x.name === f.name)!;
                    const open = !st.saved || editing.has(f.name);
                    return (
                      <FieldRow
                        key={f.name}
                        spec={f}
                        status={st}
                        open={open}
                        value={draft[f.name] ?? ""}
                        error={errors[f.name] ?? null}
                        removing={removing === f.name}
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
  const missing = CONNECT_FIELDS.filter((f) => f.required && !s.fields.find((x) => x.name === f.name)?.saved).map((f) => f.label.toLowerCase());
  if (s.configured && s.source === "store") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3" data-testid="setup-status">
        <span className="flex size-6 items-center justify-center rounded-full bg-success-text/12 text-success-text"><Check className="size-3.5 stroke-[2.5]" /></span>
        <span className="flex-1 text-13"><span className="font-medium">Sign in with One is on.</span> <span className="text-muted-foreground">Rill uses this app for every sign-in on this computer.</span></span>
        <Button variant="primary" trailing={<ArrowRight className="size-3.5" />} onClick={onOpen}>Sign in</Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3" data-testid="setup-status">
      <span className="flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground"><ShieldCheck className="size-3.5" /></span>
      <span className="flex-1 text-13">
        {s.source === "env" ? (
          <><span className="font-medium">Sign in runs on the app in .env today.</span> <span className="text-muted-foreground">Save a client ID here and this app replaces it.</span></>
        ) : (
          <><span className="font-medium">Sign in with One is off.</span> <span className="text-muted-foreground">Still needed: {missing.join(", ")}.</span></>
        )}
      </span>
    </div>
  );
}

function Steps({ redirectUri }: { redirectUri: string }) {
  return (
    <ol className="flex flex-col gap-5" aria-label="Steps in the One dashboard">
      <Step n={1} title="Open your Connect app">
        <p>In the One dashboard, open <span className="text-foreground">Developers, Connect</span> and pick the app, or make one with <span className="text-foreground">New app</span>.</p>
        <div><Button size="sm" icon={<ExternalLink />} onClick={() => window.open(ONE_DASHBOARD_URL, "_blank", "noopener")}>Open the One dashboard</Button></div>
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
  spec: ConnectFieldSpec;
  status: ConnectFieldStatus;
  open: boolean;
  value: string;
  error: string | null;
  removing: boolean;
  onChange: (v: string) => void;
  onReplace: () => void;
  onKeep: () => void;
  onRemove: () => void;
}) {
  const id = `f-${spec.name}`;
  const check = value.trim() ? checkConnectField(spec.name, value) : null;
  const message = error ?? (check ? check.message : spec.where);
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
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">••••{status.hint}</span>
          <span className="hidden shrink-0 text-11 text-muted-foreground sm:inline">
            {status.where === "keychain" ? "Keychain" : "Private file"}{status.updatedAt ? ` · ${new Date(status.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
          </span>
          <Button size="sm" variant="ghost" onClick={onReplace}>Replace</Button>
          <ConfirmButton size="sm" variant="ghost" confirmLabel="Remove it" loading={removing} onConfirm={onRemove}>Remove</ConfirmButton>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <Input
            id={id}
            type={spec.secret ? "password" : "text"}
            mono
            value={value}
            placeholder={spec.placeholder}
            autoComplete={spec.secret ? "new-password" : "off"}
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            aria-invalid={!!error || (check ? !check.ok : undefined)}
            aria-describedby={`${id}-hint`}
            onChange={(e) => onChange(e.target.value)}
          />
          {status.saved && <Button size="sm" variant="ghost" onClick={onKeep}>Keep saved</Button>}
        </div>
      )}
      <p id={`${id}-hint`} className={cn("text-11", tone)} role={error ? "alert" : undefined}>{message}</p>
    </div>
  );
}
