import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, Eye, FileCode2, GitCommitHorizontal, Info, KeyRound, Lock, Plug, RotateCcw, ShieldCheck, Users, Wrench } from "lucide-react";
import type { Checkpoint, ProjectError, Turn } from "@builder/core/types";
import { ACTIVE_STATUSES } from "@builder/core/types";
import { humanError } from "@/lib/api";
import { fold, totalTokens } from "@/lib/feed";
import { keys, useCreateTurn, useFix, useProjectConnect, useProjectEnv, useSetProjectConnect, useScopes, useSetVisitors, useTurnEvents } from "@/lib/queries";
import { EnvRow } from "@/components/env/EnvRow";
import { useSteered } from "@/lib/steered";
import { toast } from "@/lib/toast";
import { cn, fmtDuration, fmtTokens, fmtUsd, plural, useNow } from "@/lib/utils";
import { Badge, Button, Tooltip } from "@/components/ui";
import { DiffStat, Shot } from "@/components/editor/HistoryPane";
import { SOURCE_LABEL } from "@/components/editor/ConsoleStrip";
import { ActivityItem } from "./Activity";

const STATUS_STEP: Partial<Record<Turn["status"], string>> = {
  queued: "Waiting to start",
  running: "Working",
  settling: "Saving and checking types",
  verifying: "Checking the preview",
  fixing: "Fixing what broke",
};

export function SelectionChip({ tag, loc, onRemove }: { tag: string; loc: string; onRemove?: () => void }) {
  const short = loc.split(":").slice(0, 2).join(":");
  return (
    <span className="inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-accent/30 bg-accent/8 pl-1.5 pr-1 font-mono text-11 text-foreground">
      <span className="text-accent">&lt;{tag}&gt;</span>
      <span className="truncate">{short}</span>
      {onRemove && (
        <button type="button" aria-label={`Remove ${short}`} onClick={onRemove} className="ml-0.5 inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground">×</button>
      )}
    </span>
  );
}

function UserBubble({ turn, queuedNote }: { turn: Turn; queuedNote?: string }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className={cn("max-w-[88%] rounded-xl rounded-br-sm bg-muted px-3 py-2", queuedNote && "opacity-55")}>
        {turn.selections.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1">{turn.selections.map((s) => <SelectionChip key={s.loc} tag={s.tag} loc={s.loc} />)}</div>
        )}
        <p className="whitespace-pre-wrap text-13 leading-relaxed">{turn.prompt}</p>
      </div>
      {turn.kind === "plan" && <span className="text-11 font-medium text-muted-foreground">Plan mode, nothing is edited</span>}
      {queuedNote && <span className="text-11 text-muted-foreground">{queuedNote}</span>}
    </div>
  );
}

function SteeredBubbles({ projectId, turnId, live }: { projectId: string; turnId: string; live: boolean }) {
  const rows = useTurnEvents(projectId, turnId, live);
  const fromEvents = fold(rows.data, live).steers;
  // Sent a moment ago and not echoed by the server yet.
  const local = useSteered(turnId).filter((s) => !fromEvents.some((e) => e.text === s.text));
  const list = [...fromEvents, ...local.map((s) => ({ text: s.text, read: false }))];
  if (!list.length) return null;
  return (
    <div className="flex flex-col items-end gap-2">
      {list.map((s, i) => (
        <div key={i} className="flex flex-col items-end gap-1">
          <div className={cn("max-w-[88%] rounded-xl rounded-br-sm bg-muted px-3 py-2 transition-opacity", !s.read && live && "opacity-55")}>
            <p className="whitespace-pre-wrap text-13 leading-relaxed">{s.text}</p>
          </div>
          <span className="inline-flex items-center gap-1 text-11 text-muted-foreground">
            {s.read ? <><Check className="size-3" />Read by the agent</> : live ? "Will be read after the next step" : "Sent as the next message"}
          </span>
        </div>
      ))}
    </div>
  );
}

export function VersionCard({ projectId, cp, fallback, onRestore, onView, widened }: {
  projectId: string;
  cp: Checkpoint | undefined;
  fallback: { sha: string; subject: string; additions: number; deletions: number; files: number } | null;
  onRestore: (cp: Checkpoint) => void;
  onView: (sha: string) => void;
  widened?: string | null;
}) {
  const subject = cp?.subject ?? fallback?.subject ?? "";
  const sha = cp?.sha ?? fallback?.sha ?? "";
  const short = cp?.shortSha ?? sha.slice(0, 7);
  const files = cp?.files.length ?? fallback?.files ?? 0;
  return (
    <div className="slide-up flex items-stretch gap-3 rounded-lg border border-border bg-card p-2 shadow-[0_1px_1px_rgb(0_0_0/0.03)]">
      <button type="button" onClick={() => onView(sha)} aria-label="View this version" className="shrink-0">
        <Shot projectId={projectId} file={cp?.shot ?? null} className="h-[54px] w-[86px]" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-1 py-0.5">
        <div className="flex items-center gap-1.5">
          <GitCommitHorizontal className="size-3.5 shrink-0 stroke-[1.75] text-muted-foreground" />
          <p className="truncate text-xs font-medium">{subject}</p>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap text-11 text-muted-foreground">
          <span className="font-mono">{short}</span>
          <span aria-hidden>·</span>
          <span>{plural(files, "file")}</span>
          <DiffStat add={cp?.additions ?? fallback?.additions ?? 0} del={cp?.deletions ?? fallback?.deletions ?? 0} />
          <span className="ml-auto flex items-center gap-0.5">
            <Tooltip side="top" label="View the diff"><button type="button" aria-label="View the diff" onClick={() => onView(sha)} className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground"><Eye className="size-3.5 stroke-[1.75]" /></button></Tooltip>
            <button type="button" disabled={!cp} onClick={() => cp && onRestore(cp)} className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 font-medium text-foreground transition-colors hover:bg-card-hover disabled:opacity-40"><RotateCcw className="size-3 stroke-[1.75]" />Restore</button>
          </span>
        </div>
        {widened && <p className="text-11 text-warning-text">{widened}</p>}
      </div>
    </div>
  );
}

function Working({ since, step }: { since: string | null; step: string }) {
  const now = useNow(1000);
  const ms = since ? now - new Date(since).getTime() : 0;
  return (
    <div className="flex h-7 items-center gap-2 px-2 text-xs" role="status" aria-live="polite">
      <span className="relative flex size-4 items-center justify-center"><span className="pulse-dot size-1.5 rounded-full bg-accent" /></span>
      <span className="shimmer-text font-medium">{step}</span>
      <span className="tnum text-muted-foreground">for {fmtDuration(ms)}</span>
    </div>
  );
}

const EXIT_COPY: Record<string, (h: string) => string> = {
  signed_out: (h) => `${h} is signed out. Sign in from a terminal, then send your message again.`,
  limit: (h) => `${h} hit your plan's usage limit. Send again once it resets.`,
  timeout: (h) => `${h} ran out of time before finishing. The files it changed are saved; send a follow up to continue.`,
  error: (h) => `${h} stopped with an error.`,
};

function CouldntFix({ projectId, errors, busy }: { projectId: string; errors: ProjectError[]; busy: boolean }) {
  const fix = useFix(projectId);
  return (
    <div className="slide-up flex flex-col gap-2 rounded-lg border border-destructive-text/25 bg-destructive-text/5 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive-text"><AlertTriangle className="size-3.5 stroke-[1.75]" />Couldn't fix this. Here is what is still wrong</p>
      <ul className="flex flex-col gap-1">
        {errors.slice(0, 5).map((e) => (
          <li key={e.id} className="flex items-start gap-1.5 text-11">
            <Badge tone="outline">{SOURCE_LABEL[e.source]}</Badge>
            <span className="min-w-0 flex-1 break-words font-mono leading-4">{e.file ? `${e.file}${e.line ? `:${e.line}` : ""} ` : ""}{e.message}</span>
          </li>
        ))}
        {errors.length === 0 && <li className="text-11 text-muted-foreground">The errors cleared after the last attempt.</li>}
        {errors.length > 5 && <li className="text-11 text-muted-foreground">and {errors.length - 5} more in the console</li>}
      </ul>
      <div className="flex gap-2">
        <Button size="sm" icon={<Wrench />} disabled={busy} loading={fix.isPending} onClick={() => fix.mutate(undefined, { onError: (e) => toast({ title: "Could not start a fix", detail: humanError(e), tone: "destructive" }) })}>Try again</Button>
      </div>
    </div>
  );
}

function TurnMeta({ turn }: { turn: Turn }) {
  if (!turn.startedAt || !turn.endedAt) return null;
  const ms = new Date(turn.endedAt).getTime() - new Date(turn.startedAt).getTime();
  const tokens = totalTokens(turn.usage);
  return (
    <div className="flex items-center gap-1.5 px-2 text-11 text-muted-foreground">
      <span>Worked for {fmtDuration(ms)}</span>
      {tokens > 0 && <><span aria-hidden>·</span><span className="tnum">{fmtTokens(tokens)} tokens</span></>}
      {turn.costUsd != null && (
        <Tooltip side="top" label="Your provider bills you directly. This is the CLI's estimate">
          <span className="inline-flex items-center gap-0.5 tnum"><span aria-hidden>·</span> {fmtUsd(turn.costUsd)} est.<Info className="size-3 opacity-60" /></span>
        </Tooltip>
      )}
    </div>
  );
}

const listNames = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/**
 * The turn ended with One calls in an app that has no One Connect yet. Only
 * the builder turns it on: with the Connect app already linked, from the one
 * saved template in a click, or in the project's Settings. Not now keeps it
 * off; the agent keeps building either way.
 */
function ConnectOfferCard({ projectId, turnId, platforms, answer }: { projectId: string; turnId: string; platforms: { platform: string; name: string }[]; answer: "on" | "later" | null }) {
  const c = useProjectConnect(projectId);
  const set = useSetProjectConnect(projectId);
  const [busy, setBusy] = useState<"on" | "later" | null>(null);
  const names = listNames(platforms.map((p) => p.name));
  const d = c.data;
  if (!d) return null;
  const settings = `/p/${projectId}/settings`;
  if (answer === "on" || d.connect.enabled) {
    return (
      <div className="mt-1 flex items-center gap-2 rounded-md border border-border bg-faint px-2.5 py-1.5 text-xs" data-testid="connect-offer">
        <Check className="size-3.5 shrink-0 text-success-text" />
        <span className="min-w-0 flex-1">One Connect is on{d.setup ? <> with <span className="font-medium">{d.setup.name}</span></> : null}. Sign in with One in the preview to see {names} work.</span>
      </div>
    );
  }
  if (answer === "later") {
    return (
      <div className="mt-1 flex items-center gap-2 rounded-md border border-border bg-faint px-2.5 py-1.5 text-xs" data-testid="connect-offer">
        <Plug className="size-3.5 shrink-0 stroke-[1.75] text-muted-foreground" />
        <span className="min-w-0 flex-1 text-muted-foreground">One Connect stays off, so {names} calls are refused on this computer.</span>
        <Link to={settings} className="shrink-0 text-11 font-medium text-foreground underline-offset-2 hover:underline">Settings</Link>
      </div>
    );
  }
  const err = (title: string) => (e: unknown) => toast({ title, detail: humanError(e), tone: "destructive" });
  const only = !d.ready && d.templates.filter((t) => t.configured).length === 1 && d.others.length === 0 ? d.templates.find((t) => t.configured)! : null;
  const turnOn = async () => {
    setBusy("on");
    try {
      if (only) await set.mutateAsync({ use: "template", setupId: only.id });
      await set.mutateAsync({ enabled: true, answer: { turnId } });
    } catch (e) {
      err("Could not turn on One Connect")(e);
    } finally {
      setBusy(null);
    }
  };
  const later = () => {
    setBusy("later");
    set.mutate({ answer: { turnId, choice: "later" } }, { onError: err("Could not save that"), onSettled: () => setBusy(null) });
  };
  return (
    <div className="mt-1 flex flex-col gap-2 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-2 text-xs" data-testid="connect-offer" role="group" aria-label="Turn on One Connect">
      <div className="flex items-start gap-2">
        <Plug className="mt-0.5 size-3.5 shrink-0 stroke-[1.75] text-accent" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">This app uses {names}. Turn on One Connect for it?</p>
          <p className="mt-0.5 text-muted-foreground">
            Its login becomes Sign in with One, on {d.ready && d.setup ? <span className="text-foreground">{d.setup.name}</span> : only ? <span className="text-foreground">{only.name}</span> : "a Connect app of its own"}, and in preview its calls run on your own sign-in to it. Until then they are refused on this computer.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 pl-5">
        {d.ready || only ? (
          <Button size="sm" variant="primary" loading={busy === "on"} disabled={busy !== null} onClick={() => void turnOn()}>Turn on</Button>
        ) : (
          <Link to={settings} className="inline-flex h-7 items-center rounded-md border border-transparent bg-accent px-2.5 text-xs font-medium text-accent-foreground hover:brightness-[1.08]">Set up One Connect</Link>
        )}
        {(d.ready || only) && <Link to={settings} className="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-card-hover hover:text-foreground">Choose another</Link>}
        <Button size="sm" variant="ghost" loading={busy === "later"} disabled={busy !== null} onClick={later}>Not now</Button>
      </div>
    </div>
  );
}

/**
 * The code runs actions on the builder's grant for visitors who are not
 * signed in, and the builder has not allowed them. Only the builder decides:
 * Allow ticks them in Access; Keep sign-in required asks the agent to move
 * them behind sign-in. The agent's own message above says why it needs them.
 */
function VisitorsCard({ projectId, turnId, actions, answer, busy }: { projectId: string; turnId: string; actions: { actionId: string; line: string }[]; answer: "allow" | "keep" | null; busy: boolean }) {
  const set = useSetVisitors(projectId);
  const create = useCreateTurn(projectId);
  const s = useScopes(projectId);
  const v = s.data?.visitors;
  const ids = actions.map((a) => a.actionId);
  const allowedNow = !!v?.enabled && ids.every((id) => v.actions.includes(id));
  const err = (title: string) => (e: unknown) => toast({ title, detail: humanError(e), tone: "destructive" });
  if (answer === "allow" || (allowedNow && answer !== "keep")) {
    return (
      <div className="mt-1 flex items-center gap-2 rounded-md border border-border bg-faint px-2.5 py-1.5 text-xs" data-testid="visitors-card">
        <Check className="size-3.5 shrink-0 text-success-text" />
        <span>Visitors can trigger {actions.length === 1 ? "this" : "these"} on your grant. <span className="font-mono text-muted-foreground">{actions.map((a) => a.line).join(", ")}</span></span>
      </div>
    );
  }
  if (answer === "keep") {
    return (
      <div className="mt-1 flex items-center gap-2 rounded-md border border-border bg-faint px-2.5 py-1.5 text-xs" data-testid="visitors-card">
        <Lock className="size-3.5 shrink-0 text-muted-foreground" />
        <span>Sign-in stays required. The agent was asked to move {actions.length === 1 ? "it" : "them"} behind sign-in.</span>
      </div>
    );
  }
  const keepPrompt = `Keep sign-in required for ${actions.map((a) => a.line).join(", ")}. Don't run ${actions.length === 1 ? "it" : "them"} on my grant for visitors: put ${actions.length === 1 ? "it" : "them"} behind requireUser(c) and one(c).run, and tell me what changes for visitors.`;
  return (
    <div className="mt-1 flex flex-col gap-2 rounded-md border border-warning-text/30 bg-warning-text/8 px-2.5 py-2 text-xs" data-testid="visitors-card" role="group" aria-label="Allow visitors on your grant">
      <div className="flex items-start gap-2">
        <Users className="mt-0.5 size-3.5 shrink-0 stroke-[1.75] text-warning-text" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Let visitors trigger {actions.length === 1 ? "this" : "these"} on your grant?</p>
          <p className="mt-0.5 text-muted-foreground">People who are not signed in would run {actions.length === 1 ? "it" : "them"} on your own account. Until you allow it, the app refuses the call on your computer.</p>
          <ul className="mt-1 flex flex-col gap-0.5 font-mono text-11">{actions.map((a) => <li key={a.actionId}>{a.line}</li>)}</ul>
        </div>
      </div>
      <div className="flex items-center gap-1.5 pl-5">
        <Button size="sm" variant="primary" loading={set.isPending} disabled={create.isPending} onClick={() => set.mutate({ enabled: true, allow: ids, answer: { turnId, choice: "allow", actionIds: ids } }, { onError: err("Could not allow it") })}>Allow</Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || set.isPending}
          loading={create.isPending}
          onClick={() =>
            set.mutate(
              { answer: { turnId, choice: "keep", actionIds: ids } },
              { onSuccess: () => create.mutate({ prompt: keepPrompt, mode: "build" }, { onError: err("Could not start the change") }), onError: err("Could not save your answer") },
            )
          }
        >
          Keep sign-in required
        </Button>
      </div>
    </div>
  );
}

/**
 * The code reads environment variables that have no value yet. The secure
 * input sits in the card; the value goes to the local server and the
 * agent only ever learns that the name is set.
 */
function EnvCard({ projectId, needed }: { projectId: string; needed: { name: string; why: string | null; sites: { file: string; line: number }[] }[] }) {
  const env = useProjectEnv(projectId);
  const vars = needed.map((n) => {
    const v = env.data?.vars.find((x) => x.name === n.name);
    return v ? { ...v, why: n.why ?? v.why, sites: v.sites.length ? v.sites : n.sites } : { name: n.name, present: false, secret: true, required: true, where: null, whereLabel: "Not set", updatedAt: null, hint: null, target: "both" as const, why: n.why, sites: n.sites, client: false, needed: true };
  });
  const open = vars.filter((v) => !v.present);
  if (!env.data) return null;
  if (!open.length) {
    return (
      <div className="mt-1 flex items-center gap-2 rounded-md border border-border bg-faint px-2.5 py-1.5 text-xs" data-testid="env-card">
        <Check className="size-3.5 shrink-0 text-success-text" />
        <span><span className="font-mono">{vars.map((v) => v.name).join(", ")}</span> {vars.length === 1 ? "is" : "are"} set. The preview runs with {vars.length === 1 ? "it" : "them"}.</span>
      </div>
    );
  }
  return (
    <div className="mt-1 flex flex-col gap-2 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-2 text-xs" data-testid="env-card" role="group" aria-label="Values this app needs">
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 size-3.5 shrink-0 stroke-[1.75] text-accent" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">This app needs {open.length === 1 ? <span className="font-mono">{open[0]!.name}</span> : `${open.length} values`}</p>
          <p className="mt-0.5 text-muted-foreground">Paste {open.length === 1 ? "it" : "each"} here, not in the chat. It goes to {env.data.store.label} on this computer, and the agent only learns that it is set.</p>
        </div>
      </div>
      <div className="overflow-hidden rounded-md border border-border bg-card">
        {open.map((v) => (
          <div key={v.name}>
            {(v.why || v.sites.length > 0) && (
              <p className="flex flex-wrap items-center gap-x-1.5 px-2.5 pt-2 text-11 text-muted-foreground">
                {v.why}
                {v.sites.slice(0, 2).map((s) => <span key={`${s.file}:${s.line}`} className="inline-flex items-center gap-0.5 font-mono text-foreground/80"><FileCode2 className="size-3" />{s.file}:{s.line}</span>)}
              </p>
            )}
            <EnvRow projectId={projectId} v={v} compact defaultOpen />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The activity of one turn: events, live state and its version card. */
function TurnBody({ projectId, turn, harnessLabel, checkpoints, onRestore, onView, busy = false }: {
  projectId: string; turn: Turn; harnessLabel: string; checkpoints: Map<string, Checkpoint>; onRestore: (c: Checkpoint) => void; onView: (sha: string) => void; busy?: boolean;
}) {
  const live = ACTIVE_STATUSES.includes(turn.status);
  const rows = useTurnEvents(projectId, turn.id, live);
  const step = useQuery({ queryKey: keys.turnStep(turn.id), queryFn: () => null as string | null, enabled: false, initialData: null }).data;
  const f = fold(rows.data, live);
  const cpSha = turn.checkpointSha ?? f.checkpoint?.sha ?? null;
  const cp = cpSha ? checkpoints.get(cpSha) : undefined;
  return (
    <div className="flex flex-col gap-0.5">
      {f.items.map((it) => <ActivityItem key={it.id} item={it} harnessLabel={harnessLabel} />)}
      {f.mcpFailed && (
        <p className="px-2 py-1 text-xs text-destructive-text">The catalog tool did not start. {f.mcpFailed}</p>
      )}
      {live && turn.status !== "queued" && <Working since={turn.startedAt ?? turn.createdAt} step={step ?? f.step ?? STATUS_STEP[turn.status] ?? "Working"} />}
      {cpSha && (
        <div className="pt-1.5"><VersionCard projectId={projectId} cp={cp} fallback={f.checkpoint} onRestore={onRestore} onView={onView} /></div>
      )}
      {f.asksMore.length > 0 && (
        <div className="mt-1 flex items-start gap-2 rounded-md border border-border bg-faint px-2.5 py-1.5 text-xs">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 stroke-[1.75] text-warning-text" />
          <span>This version asks for more. <span className="font-mono text-muted-foreground">{f.asksMore.join(", ")}</span></span>
        </div>
      )}
      {!live && f.envNeeded.length > 0 && <EnvCard projectId={projectId} needed={f.envNeeded} />}
      {!live && f.connectOffer && <ConnectOfferCard projectId={projectId} turnId={turn.id} platforms={f.connectOffer.platforms} answer={f.connectOffer.answer} />}
      {!live && f.visitors && <VisitorsCard projectId={projectId} turnId={turn.id} actions={f.visitors.actions} answer={f.visitors.answer} busy={busy} />}
      {!live && turn.exit && turn.exit !== "ok" && turn.exit !== "cancelled" && (
        <div className="mt-1 flex items-start gap-2 rounded-md border border-border bg-faint px-2.5 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 stroke-[1.75] text-warning-text" />
          <span>{(EXIT_COPY[turn.exit] ?? EXIT_COPY.error!)(harnessLabel)}{turn.error && turn.exit === "error" && <span className="text-muted-foreground"> {turn.error}</span>}</span>
        </div>
      )}
      {turn.status === "cancelled" && <p className="px-2 py-1 text-11 text-muted-foreground">You stopped this turn. Files it already changed are kept.</p>}
    </div>
  );
}

export function TurnView({ projectId, turn, fixes, harnessLabel, checkpoints, openErrors, busy, onRestore, onView }: {
  projectId: string;
  turn: Turn;
  fixes: Turn[];
  harnessLabel: string;
  checkpoints: Map<string, Checkpoint>;
  openErrors: ProjectError[];
  busy: boolean;
  onRestore: (c: Checkpoint) => void;
  onView: (sha: string) => void;
}) {
  const [showFixes, setShowFixes] = useState(true);
  const live = ACTIVE_STATUSES.includes(turn.status);
  const queued = turn.status === "queued";
  const bodyProps = { projectId, harnessLabel, checkpoints, onRestore, onView, busy };
  const failedAfterFixes = turn.status === "failed" && (!turn.exit || turn.exit === "ok") && fixes.length > 0;
  const lastFix = fixes[fixes.length - 1];

  if (turn.kind === "restore" || turn.kind === "manual" || turn.kind === "edit") {
    return (
      <div className="flex items-center gap-2 px-2 text-11 text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        <span>{turn.prompt}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }

  return (
    <article className="flex flex-col gap-2" aria-label={turn.kind === "fix" ? "Fix" : "Turn"}>
      {turn.kind === "fix" && !turn.parentTurnId ? (
        <div className="flex justify-end"><span className="rounded-full border border-border bg-card px-2.5 py-1 text-11 text-muted-foreground">Fix these errors</span></div>
      ) : (
        <UserBubble turn={turn} queuedNote={queued ? (turn.harness === "claude-code" ? "Will be read after the next step" : "Will be sent when this step ends") : undefined} />
      )}
      {!queued && <TurnBody turn={turn} {...bodyProps} />}
      <SteeredBubbles projectId={projectId} turnId={turn.id} live={live} />
      {fixes.length > 0 && (
        <div className="ml-2 flex flex-col gap-1.5 border-l-2 border-border pl-3">
          <button type="button" onClick={() => setShowFixes((v) => !v)} className="flex items-center gap-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
            <Wrench className="size-3.5 stroke-[1.75]" />
            {fixes.length === 1 && ACTIVE_STATUSES.includes(lastFix!.status) ? <FixTitle projectId={projectId} fx={lastFix!} /> : lastFix && ACTIVE_STATUSES.includes(lastFix.status) ? <FixTitle projectId={projectId} fx={lastFix} /> : turn.status === "failed" ? `Tried ${plural(fixes.length, "fix", "fixes")}` : fixes.length === 1 ? <FixTitle projectId={projectId} fx={lastFix!} /> : `Fixed in ${fixes.length} passes`}
            {lastFix && ACTIVE_STATUSES.includes(lastFix.status) && <span className="pulse-dot size-1.5 rounded-full bg-accent" />}
          </button>
          {showFixes && fixes.map((fx) => (
            <div key={fx.id} className="flex flex-col gap-0.5">
              {fixes.length > 1 && <p className="px-2 text-11 text-muted-foreground"><FixTitle projectId={projectId} fx={fx} /></p>}
              <TurnBody turn={fx} {...bodyProps} />
            </div>
          ))}
        </div>
      )}
      {turn.kind === "plan" && turn.status === "done" && turn.text && <PlanActions projectId={projectId} plan={turn.text} busy={busy} />}
      {failedAfterFixes && <CouldntFix projectId={projectId} errors={openErrors.filter((e) => e.source !== "one")} busy={busy} />}
      {!live && <TurnMeta turn={turn} />}
    </article>
  );
}

function FixTitle({ projectId, fx }: { projectId: string; fx: Turn }) {
  const live = ACTIVE_STATUSES.includes(fx.status);
  const rows = useTurnEvents(projectId, fx.id, live);
  const plan = fold(rows.data, live).fixPlan;
  const n = plan?.errors ?? 0;
  const attempt = plan?.attempt ?? fx.fixAttempt;
  const max = plan?.max ?? 3;
  if (live) return <>{n ? `Fixing ${plural(n, "error")}` : "Fixing errors"} ({attempt} of {max})</>;
  return <>Fix {attempt} of {max}{n ? ` · ${plural(n, "error")}` : ""}</>;
}

/** Plan mode's answer: build it as written, or pull it into the composer to edit first. */
function PlanActions({ projectId, plan, busy }: { projectId: string; plan: string; busy: boolean }) {
  const create = useCreateTurn(projectId);
  return (
    <div className="flex items-center gap-1.5 pl-1">
      <Button size="sm" variant="primary" loading={create.isPending} disabled={busy} onClick={() => create.mutate({ prompt: `Build this plan:\n\n${plan}`, mode: "build" }, { onError: (e) => toast({ title: "Could not start the build", detail: humanError(e), tone: "destructive" }) })}>
        Build this plan
      </Button>
      <Button size="sm" variant="ghost" onClick={() => window.dispatchEvent(new CustomEvent(COMPOSER_EVENT, { detail: `Build this plan, with these changes:\n\n${plan}` }))}>
        Edit the plan
      </Button>
    </div>
  );
}

/** Puts text into the composer (Plan mode's Edit the plan). */
export const COMPOSER_EVENT = "builder:composer";
