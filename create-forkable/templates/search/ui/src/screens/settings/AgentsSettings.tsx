// Settings, Agents (SPEC 16.5): use Search from the AI apps already on this
// computer. Written for someone who knows Claude as the app they chat with: the
// Claude app leads, then the coding tools; each card says what Connect does and
// what to do next. Paths stay behind Details. Everything a developer needs (the
// sentence for a coding agent, the address, setup text for other apps, the
// command line, the signed-in apps by their technical names) sits under "For
// developers", closed by default.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, ExternalLink, MessageCircle, MousePointer2, Plug, SquareTerminal, Terminal } from "lucide-react";
import type { AgentId, AgentRow } from "@/contract/api-types";
import { api } from "@/lib/api";
import { keys, useAgents, useOAuthClients } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn, fmtAgo } from "@/lib/utils";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";
import { SectionTitle } from "./SettingsLayout";

/** How each app is shown: the name people know it by, what it is, what Connect does, where to get it. */
const APP: Record<AgentId, { name: string; kind: string; icon: React.ReactNode; does: string; get: { label: string; href: string } }> = {
  "claude-desktop": {
    name: "Claude", kind: "The Claude app on your computer", icon: <MessageCircle />,
    does: "Press Connect and Search is added to Claude. Then quit Claude, open it again, and ask it about your mail, meetings or deals.",
    get: { label: "claude.ai/download", href: "https://claude.ai/download" },
  },
  "claude-code": {
    name: "Claude Code", kind: "Coding tool in the terminal", icon: <Terminal />,
    does: "Adds Search to Claude Code for every project, with a short guide on when to use it. Then open a new session.",
    get: { label: "claude.com/claude-code", href: "https://claude.com/claude-code" },
  },
  codex: {
    name: "Codex", kind: "Coding tool", icon: <SquareTerminal />,
    does: "Adds Search to Codex. Codex then asks you to allow it in your browser.",
    get: { label: "developers.openai.com/codex", href: "https://developers.openai.com/codex" },
  },
  cursor: {
    name: "Cursor", kind: "Code editor", icon: <MousePointer2 />,
    does: "Adds Search to Cursor, already signed in. Nothing else to do.",
    get: { label: "cursor.com", href: "https://cursor.com" },
  },
};
const EVERYDAY: AgentId[] = ["claude-desktop"];
const CODING: AgentId[] = ["claude-code", "codex", "cursor"];

const STATUS: Record<AgentRow["state"], { label: string; tone: BadgeTone }> = {
  connected: { label: "Connected", tone: "success" },
  added: { label: "One step left", tone: "warning" },
  not_connected: { label: "Not connected", tone: "outline" },
  not_found: { label: "Not installed", tone: "neutral" },
};

export function AgentsSettings() {
  const q = useAgents();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<AgentId | null>(null);

  const act = async (a: AgentRow, remove: boolean) => {
    const name = APP[a.id].name;
    setBusy(a.id);
    try {
      const r = remove ? await api.removeAgent(a.id) : await api.connectAgent(a.id);
      await Promise.all([qc.invalidateQueries({ queryKey: keys.agents }), qc.invalidateQueries({ queryKey: keys.oauthClients })]);
      toast({ title: remove ? `Removed from ${name}` : r.changed ? `Added to ${name}` : `${name} already has Search`, detail: remove ? "It cannot reach Search any more." : r.agent.nextStep ?? undefined });
    } catch (e) {
      toast({ title: remove ? `Could not remove it from ${name}` : `Could not connect ${name}`, detail: (e as Error).message, tone: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const rows = q.data?.agents ?? [];
  const card = (id: AgentId) => {
    const a = rows.find((r) => r.id === id);
    return a ? <AgentCard key={id} a={a} busy={busy === id} onConnect={() => void act(a, false)} onRemove={() => void act(a, true)} /> : null;
  };

  return (
    <div className="flex flex-col gap-8" data-testid="agents-screen">
      <SectionTitle title="Use Search in your AI app" hint="Ask Claude about your own mail, meetings and deals. It can look things up for you, never change anything." />

      {q.isError ? <LoadError what="Your AI apps" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} className="rounded-lg border border-border bg-card py-8" />
        : !q.data ? <div className="flex flex-col gap-3">{[0, 1].map((i) => <Skeleton key={i} className="h-36 rounded-lg" />)}</div>
        : (
          <div className="flex flex-col gap-6" data-testid="agent-cards">
            {q.data.sampleNote && <p className="rounded-md border border-border bg-faint px-3 py-2 text-xs" data-testid="agents-sample-note">{q.data.sampleNote}</p>}
            <section className="flex flex-col gap-3" aria-labelledby="agents-everyday">
              <h3 id="agents-everyday" className="text-13 font-semibold">Your AI app</h3>
              <div className="grid grid-cols-1 gap-3">{EVERYDAY.map(card)}</div>
            </section>
            <section className="flex flex-col gap-3" aria-labelledby="agents-coding">
              <div className="flex flex-col gap-0.5">
                <h3 id="agents-coding" className="text-13 font-semibold">Coding tools</h3>
                <p className="text-xs text-muted-foreground">If you write code with one of these, it can use Search too.</p>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">{CODING.map(card)}</div>
            </section>
          </div>
        )}

      <ForDevelopers />
    </div>
  );
}

function AgentCard({ a, busy, onConnect, onRemove }: { a: AgentRow; busy: boolean; onConnect: () => void; onRemove: () => void }) {
  const app = APP[a.id];
  const s = a.needsConnect ? { label: "Connect again", tone: "warning" as BadgeTone } : STATUS[a.state];
  const [details, setDetails] = useState(false);
  const showConnect = !a.added || a.needsConnect;
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border bg-card p-3", a.state === "added" ? "border-warning-text/40" : "border-border")} data-testid={`agent-${a.id}`} data-state={a.state} data-needs-connect={a.needsConnect ? "1" : undefined}>
      <div className="flex items-start gap-2.5">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-md border border-border bg-faint [&>svg]:size-4 [&>svg]:stroke-[1.75]", !a.found && "text-muted-foreground")}>{app.icon}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-13 font-semibold">{app.name}</p>
            <Badge tone={s.tone} data-testid="agent-status">{s.label}</Badge>
          </div>
          <p className="text-11 text-muted-foreground">{app.kind}</p>
        </div>
      </div>

      {a.state === "not_found"
        ? (
          <p className="text-xs" data-testid="agent-get">
            Not on this computer yet. Install it from{" "}
            <a className="inline-flex items-center gap-0.5 font-medium underline underline-offset-2" href={app.get.href} target="_blank" rel="noreferrer">{app.get.label}<ExternalLink className="size-3" /></a> first, then come back.
          </p>
        )
        : a.state === "connected" ? <p className="text-xs" data-testid="agent-ready">{a.nextStep ?? `Ready. Ask ${app.name} about your mail, meetings or deals.`}</p>
        : a.state === "added" && a.nextStep ? (
          <div className="flex flex-col gap-1 rounded-md bg-warning-text/8 px-2.5 py-2" data-testid="agent-next-step">
            <p className="text-11 font-medium text-warning-text">{a.needsConnect ? "Signed out" : "One step left"}</p>
            <p className="text-xs">{a.nextStep}</p>
            {!a.needsConnect && <p className="text-11 text-muted-foreground">This card turns to Connected by itself once you do.</p>}
          </div>
        )
        : <p className="text-xs text-muted-foreground">{app.does}</p>}

      {a.note && <p className="rounded-md bg-faint px-2.5 py-2 text-xs text-muted-foreground" data-testid="agent-note">{a.note}</p>}

      <div className="mt-auto flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-11 text-muted-foreground">
            {a.found ? (
              <>
                <span>{a.state === "connected" && a.lastUsedAt ? `Last used ${fmtAgo(a.lastUsedAt)}` : "Found on this computer"}</span>
                <button type="button" className="underline-offset-2 hover:text-foreground hover:underline" aria-expanded={details} onClick={() => setDetails((v) => !v)} data-testid="agent-details-toggle">
                  {details ? "Hide details" : "Details"}
                </button>
              </>
            ) : null}
          </div>
          {a.added && <ConfirmButton size="sm" variant="ghost" confirmLabel="Remove it" disabled={busy} onConfirm={onRemove} data-testid="agent-remove">Remove</ConfirmButton>}
          {showConnect && <Button size="sm" variant={a.found ? "primary" : "default"} loading={busy} disabled={!a.found} onClick={onConnect} data-testid="agent-connect">Connect</Button>}
        </div>
        {details && a.found && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-faint px-2.5 py-2 text-11" data-testid="agent-details">
            <dt className="text-muted-foreground">Found at</dt><dd className="min-w-0 truncate font-mono" title={a.foundWhere ?? ""}>{shortPath(a.foundWhere ?? "")}</dd>
            <dt className="text-muted-foreground">Its settings</dt><dd className="min-w-0 truncate font-mono" title={a.configPath}>{shortPath(a.configPath)}</dd>
            {a.entryName && <><dt className="text-muted-foreground">Added as</dt><dd className="font-mono">{a.entryName}</dd></>}
          </dl>
        )}
      </div>
    </div>
  );
}

/** Everything for developers, closed by default. */
function ForDevelopers() {
  const q = useAgents();
  const [open, setOpen] = useState(false);
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-6" data-testid="for-developers">
      <button type="button" className="flex items-start gap-2 self-start text-left" aria-expanded={open} aria-controls="for-developers-body" onClick={() => setOpen((v) => !v)} data-testid="dev-toggle">
        <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} />
        <span className="flex flex-col">
          <span className="text-15 font-semibold tracking-tight">For developers</span>
          <span className="text-xs text-muted-foreground">Set up a coding agent with one sentence, connect any other app, use the command line, see every app that signed in.</span>
        </span>
      </button>
      {open && (
        <div id="for-developers-body" className="flex flex-col gap-8">
          {q.data && (
            <>
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3" data-testid="setup-sentence">
                <p className="text-13 font-medium">Paste this into a coding agent</p>
                <p className="text-xs text-muted-foreground">It reads the steps, adds Search to itself and checks that it works. You only approve the sign-in.</p>
                <CopyLine text={q.data.setupSentence} testId="copy-sentence" />
              </div>
              <OtherAgentCard mcpUrl={q.data.mcpUrl} json={q.data.genericJson} />
            </>
          )}
          <section className="flex flex-col gap-3">
            <SectionTitle title="Command line" hint="Run these in the Search folder. The first one signs you in with your browser once." />
            <Snippet code={`pnpm run search login\npnpm run search "globex renewal"\npnpm run search ask "Where are we with Globex?"`} />
          </section>
          <SignedInApps />
        </div>
      )}
    </section>
  );
}

function OtherAgentCard({ mcpUrl, json }: { mcpUrl: string; json: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border-strong bg-card p-3" data-testid="agent-other">
      <div className="flex items-start gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-faint [&>svg]:size-4 [&>svg]:stroke-[1.75]"><Plug /></span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="text-13 font-semibold">Any other app</p>
          <p className="text-xs text-muted-foreground">Any app that connects to MCP servers over HTTP can use this address. It asks you to allow it in your browser the first time.</p>
        </div>
      </div>
      <CopyLine text={mcpUrl} testId="copy-mcp-url" />
      <div className="flex flex-col gap-2">
        <button type="button" className="self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Hide the setup text" : "Show the setup text for other apps"}
        </button>
        {open && <Snippet code={json} />}
      </div>
    </div>
  );
}

function SignedInApps() {
  const q = useOAuthClients();
  const qc = useQueryClient();
  const signOut = async (id: string, name: string) => {
    try {
      await api.revokeClient(id);
      await Promise.all([qc.invalidateQueries({ queryKey: keys.oauthClients }), qc.invalidateQueries({ queryKey: keys.agents })]);
      toast({ title: `${name} is signed out`, detail: "It cannot reach Search until it signs in again." });
    } catch (e) {
      toast({ title: "Could not sign it out", detail: (e as Error).message, tone: "destructive" });
    }
  };
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle title="Signed-in apps" hint="Every agent, script and command line that signed in to this Search. Sign one out and it stops working right away." />
      {q.isError ? <LoadError what="Apps" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} className="rounded-lg border border-border bg-card py-8" />
        : !q.data ? <Skeleton className="h-24 w-full rounded-lg" />
        : q.data.length === 0 ? <p className="rounded-lg border border-dashed border-border-strong p-4 text-13 text-muted-foreground">Nothing has signed in yet. Connect an app above to start.</p>
        : (
          <div className="overflow-hidden rounded-lg border border-border bg-card text-xs" data-testid="oauth-clients">
            <div aria-hidden className="flex h-8 items-center gap-3 border-b border-border bg-faint px-3 text-11 font-medium text-muted-foreground">
              <span className="min-w-0 flex-1">App</span><span className="w-[110px] shrink-0">Can</span><span className="w-[96px] shrink-0">Last used</span><span className="w-[96px] shrink-0" />
            </div>
            {q.data.map((c) => (
              <div key={c.clientId} className={cn("flex h-12 items-center gap-3 border-b border-border px-3 last:border-b-0", !c.activeTokens && "text-muted-foreground")} data-active={c.activeTokens > 0}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-13 font-medium">{c.name}</span>
                  <span className="text-11 text-muted-foreground">{c.activeTokens ? "Signed in" : "Signed out"}</span>
                </span>
                <span className="w-[110px] shrink-0 text-muted-foreground">{canDo(c.scopes)}</span>
                <span className="w-[96px] shrink-0 text-muted-foreground">{fmtAgo(c.lastUsedAt)}</span>
                <span className="flex w-[96px] shrink-0 justify-end">{c.activeTokens > 0 && <ConfirmButton size="sm" variant="ghost" confirmLabel="Sign it out" onConfirm={() => void signOut(c.clientId, c.name)}>Sign out</ConfirmButton>}</span>
              </div>
            ))}
          </div>
        )}
    </section>
  );
}

/** Scopes in plain words. */
function canDo(scopes: string[]): string {
  const parts = [scopes.includes("search:read") && "search", scopes.includes("search:ask") && "ask", scopes.includes("sources:write") && "update sources"].filter(Boolean);
  return parts.length ? parts.join(", ") : "nothing";
}

function shortPath(p: string): string {
  return p.replace(/^\/(Users|home)\/[^/]+/, "~");
}

function CopyLine({ text, testId }: { text: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-faint py-1 pl-3 pr-1">
      <code className="min-w-0 flex-1 truncate font-mono text-xs" title={text}>{text}</code>
      <Button size="sm" variant="ghost" data-testid={testId} icon={copied ? <Check /> : <Copy />} onClick={() => void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? "Copied" : "Copy"}</Button>
    </div>
  );
}

function Snippet({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-faint py-2 pl-3 pr-1.5">
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs leading-5">{code}</pre>
      <Button size="sm" variant="ghost" icon={copied ? <Check /> : <Copy />} onClick={() => void navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? "Copied" : "Copy"}</Button>
    </div>
  );
}
