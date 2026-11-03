// Publish: one dialog, checks first, then the target. The scan
// runs on the version being published; publish stays disabled until
// nothing blocks. GitHub exports a private repository unless the builder
// picks public on purpose. Both run on the builder's own One account through
// the One CLI. Vercel gets the app's own One Connect (its Connect app, the
// secrets as sensitive variables) and the app's Environment; the builder adds
// the production redirect URI to that Connect app.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Copy, Database, ExternalLink, FileCode2, GitBranch, Globe, KeyRound, Lock, Minus, RefreshCw, Rocket, ShieldCheck, Wrench, X } from "lucide-react";
import type { ProjectEnvVar, GitHubPublishResult, PublishesResponse, PublishRecord, PublishStep, ScanFinding, ScanResult, VercelPublishResult } from "@builder/core/api-types";
import { api, ApiError, humanError } from "@/lib/api";
import { useProjectEnv, usePublishes, usePublishSteps } from "@/lib/queries";
import { EnvRow } from "@/components/env/EnvRow";
import { CopyValue } from "@/components/connect/parts";
import { toast } from "@/lib/toast";
import { cn, copyText, fmtAgo, usePersisted } from "@/lib/utils";
import { Badge, Button, Dialog, Field, Input, Segmented, Spinner } from "@/components/ui";

type Target = "github" | "vercel";

const SCAN_STEPS: { step: string; label: string }[] = [
  { step: "typecheck", label: "Typecheck" },
  { step: "build", label: "Build" },
  { step: "secrets", label: "No secrets in the code or the bundle" },
  { step: "manifest", label: "Manifest matches the code" },
  { step: "audit", label: "pnpm audit" },
];
const STEP_LABEL: Record<string, string> = {
  repo: "Repository", ref: "Read main", blobs: "Files", tree: "Tree", commit: "Commit", branch: "Branch",
  project: "Vercel project", env: "Variables", deployment: "Deployment", health: "App health",
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "app";

function StateIcon({ status }: { status: PublishStep["status"] | "idle" }) {
  if (status === "running") return <Spinner className="text-muted-foreground" />;
  if (status === "done") return <Check className="size-3.5 stroke-[2.25] text-success-text" />;
  if (status === "failed") return <X className="size-3.5 stroke-[2.25] text-destructive-text" />;
  if (status === "skipped") return <Minus className="size-3.5 text-muted-foreground" />;
  return <span className="size-3.5 rounded-full border border-border" aria-hidden />;
}

function PlatformMark({ image, name }: { image: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  if (!image || broken) return <span className="flex size-4 items-center justify-center rounded-sm bg-muted text-11 font-semibold">{name[0]}</span>;
  return <img src={image} alt="" className="size-4 shrink-0 rounded-sm bg-white object-contain p-px ring-1 ring-border" onError={() => setBroken(true)} />;
}

function Finding({ f, onOpenFile }: { f: ScanFinding; onOpenFile: (path: string, line?: number | null) => void }) {
  return (
    <div className="flex items-start gap-2 border-b border-border px-3 py-2 last:border-b-0">
      {f.level === "block" ? <X className="mt-0.5 size-3.5 shrink-0 stroke-[2.25] text-destructive-text" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-text" />}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium leading-snug">{f.title}</p>
        {f.detail && <p className="mt-0.5 whitespace-pre-wrap text-11 text-muted-foreground">{f.detail}</p>}
      </div>
      {f.file && (
        <button type="button" onClick={() => onOpenFile(f.file!, f.line)} className="inline-flex shrink-0 items-center gap-0.5 rounded-sm px-1 font-mono text-11 text-foreground/80 hover:bg-muted hover:underline">
          <FileCode2 className="size-3" />{f.file}{f.line ? `:${f.line}` : ""}
        </button>
      )}
    </div>
  );
}

/** 1. Checks */
function Checks({ scan, running, error, live, onRerun, onFix, onOpenFile }: {
  scan: ScanResult | null; running: boolean; error: string | null; live: PublishStep[];
  onRerun: () => void; onFix: (s: ScanResult) => void; onOpenFile: (path: string, line?: number | null) => void;
}) {
  const [warnOpen, setWarnOpen] = useState(false);
  const state = (step: string): PublishStep["status"] | "idle" => {
    if (running) return live.find((s) => s.step === step)?.status ?? "idle";
    if (!scan) return "idle";
    const c = scan.checks;
    switch (step) {
      case "typecheck": return c.typecheck === "ok" ? "done" : c.typecheck === "failed" ? "failed" : "skipped";
      case "build": return c.build === "ok" ? "done" : c.build === "failed" ? "failed" : "skipped";
      case "secrets": return c.secrets ? "failed" : "done";
      case "manifest": return c.manifest === "matches" ? "done" : "failed";
      case "audit": return c.audit === "ok" ? (scan.warns.some((w) => w.code === "audit") ? "failed" : "done") : "skipped";
      default: return "idle";
    }
  };
  const detail = (step: string): string | null => {
    if (running) return live.find((s) => s.step === step)?.detail ?? null;
    if (!scan) return null;
    if (step === "secrets" && scan.checks.secrets) return `${scan.checks.secrets} found`;
    if (step === "audit" && scan.checks.audit !== "ok") return "not run";
    return null;
  };
  return (
    <section aria-labelledby="pub-checks" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 id="pub-checks" className="text-13 font-semibold">Checks</h3>
        {scan && !running && <span className="text-11 text-muted-foreground">{scan.files} files, {(scan.ms / 1000).toFixed(1)} s</span>}
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-background">
        {SCAN_STEPS.map((s) => (
          <div key={s.step} className="flex h-8 items-center gap-2 border-b border-border px-3 text-xs last:border-b-0">
            <StateIcon status={state(s.step)} />
            <span className={cn(state(s.step) === "idle" && "text-muted-foreground")}>{s.label}</span>
            {detail(s.step) && <span className="ml-auto text-11 text-muted-foreground">{detail(s.step)}</span>}
          </div>
        ))}
      </div>
      {error && <p className="rounded-md border border-destructive-text/30 bg-destructive-text/8 px-3 py-2 text-xs text-destructive-text">{error}</p>}
      {scan && !running && scan.blocks.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-destructive-text/30">
          <div className="flex items-center gap-2 border-b border-destructive-text/20 bg-destructive-text/8 px-3 py-2">
            <p className="flex-1 text-xs font-medium">{scan.blocks.length === 1 ? "One thing to fix before publishing" : `${scan.blocks.length} things to fix before publishing`}</p>
            <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={onRerun}>Check again</Button>
            <Button size="sm" variant="primary" icon={<Wrench />} onClick={() => onFix(scan)}>Fix with the agent</Button>
          </div>
          {scan.blocks.map((f, i) => <Finding key={`${f.code}${i}`} f={f} onOpenFile={onOpenFile} />)}
        </div>
      )}
      {scan && !running && scan.warns.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <button type="button" onClick={() => setWarnOpen((v) => !v)} aria-expanded={warnOpen} className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium hover:bg-card-hover">
            <ChevronRight className={cn("size-3.5 transition-transform", warnOpen && "rotate-90")} />
            <AlertTriangle className="size-3.5 text-warning-text" />
            {scan.warns.length === 1 ? "1 warning" : `${scan.warns.length} warnings`}
            <span className="font-normal text-muted-foreground">, publishing still works</span>
          </button>
          {warnOpen && <div className="border-t border-border">{scan.warns.map((f, i) => <Finding key={`${f.code}${i}`} f={f} onOpenFile={onOpenFile} />)}</div>}
        </div>
      )}
      {scan && !running && scan.ok && scan.warns.length === 0 && <p className="text-11 text-muted-foreground">Nothing to fix. {scan.notes.join(" ")}</p>}
    </section>
  );
}

function Steps({ steps }: { steps: PublishStep[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      {steps.length === 0 && <div className="flex h-8 items-center gap-2 px-3 text-xs text-muted-foreground"><Spinner />Starting</div>}
      {steps.map((s) => (
        <div key={s.step} className="flex min-h-8 items-center gap-2 border-b border-border px-3 py-1.5 text-xs last:border-b-0">
          <StateIcon status={s.status} />
          <span className="font-medium">{STEP_LABEL[s.step] ?? s.step}</span>
          {s.detail && <span className={cn("ml-auto min-w-0 truncate text-right text-11", s.status === "failed" ? "text-destructive-text" : "text-muted-foreground")} title={s.detail}>{s.detail}</span>}
        </div>
      ))}
    </div>
  );
}

function GitHubResult({ r }: { r: GitHubPublishResult }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-success-text/30 bg-success-text/6 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Check className="size-3.5 stroke-[2.25] text-success-text" />
        <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-13 font-semibold hover:underline">{r.owner}/{r.repo}</a>
        <Badge tone={r.private ? "outline" : "warning"}>{r.private ? "Private" : "Public"}</Badge>
        <span className="ml-auto inline-flex items-center gap-1 font-mono text-11 text-muted-foreground"><GitBranch className="size-3" />{r.branch} · {r.commitSha.slice(0, 7)}</span>
      </div>
      <p className="text-11 text-muted-foreground">{r.counts.blobs} files in one commit{r.firstExport ? ", a new repository" : ""}.{r.skipped.length ? ` ${r.skipped.length} over 10 MB left out.` : ""}</p>
      {r.conflict && <p className="text-11 text-warning-text">GitHub's main changed since the last export, so this went to {r.branch}. Merge it on GitHub when you are ready.</p>}
    </div>
  );
}

function VercelResult({ r }: { r: VercelPublishResult }) {
  const missing = r.health.checklist.filter((c) => !c.ok);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-success-text/30 bg-success-text/6 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Check className="size-3.5 stroke-[2.25] text-success-text" />
        <a href={r.productionUrl} target="_blank" rel="noopener noreferrer" className="text-13 font-semibold hover:underline">{r.productionUrl.replace(/^https:\/\//, "")}</a>
        <Badge tone="outline">{r.readyState.toLowerCase()}</Badge>
      </div>
      <p className="text-11 text-muted-foreground">{r.health.reached ? (missing.length ? `The app answers. ${missing.length} of ${r.health.checklist.length} settings are still missing, so sign-in waits on them.` : "The app answers and every setting is in place.") : "The app did not answer /api/one/health yet. It may still be starting."}</p>
      <div className="overflow-hidden rounded-md border border-border bg-card">
        {r.health.checklist.map((c) => (
          <div key={c.key} className="flex items-start gap-2 border-b border-border px-2.5 py-1.5 last:border-b-0">
            {c.ok ? <Check className="mt-px size-3.5 shrink-0 stroke-[2.25] text-success-text" /> : <span className="mt-1 size-2 shrink-0 rounded-full border border-warning-text" aria-hidden />}
            <div className="min-w-0 flex-1">
              <p className="font-mono text-11">{c.label}</p>
              {!c.ok && <p className="text-11 text-muted-foreground">{c.how}</p>}
            </div>
            <span className={cn("shrink-0 text-11", c.ok ? "text-success-text" : "text-muted-foreground")}>{c.ok ? "set" : "missing"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function History({ list }: { list: PublishRecord[] }) {
  const done = list.filter((p) => p.status !== "running").slice(0, 6);
  if (!done.length) return null;
  return (
    <section aria-labelledby="pub-history" className="flex flex-col gap-2">
      <h3 id="pub-history" className="text-13 font-semibold">Published before</h3>
      <div className="overflow-hidden rounded-lg border border-border">
        {done.map((p) => (
          <div key={p.id} className="flex h-8 items-center gap-2 border-b border-border px-3 text-xs last:border-b-0">
            {p.target === "github" ? <GitBranch className="size-3.5 text-muted-foreground" /> : <Globe className="size-3.5 text-muted-foreground" />}
            <span className="w-14 font-medium">{p.target === "github" ? "GitHub" : "Vercel"}</span>
            <span className="font-mono text-11 text-muted-foreground">{p.shortSha}</span>
            {p.status === "ok" ? (
              p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-11 hover:underline">{p.repo ?? p.url}</a> : <span className="text-11">{p.repo}</span>
            ) : (
              <span className="min-w-0 truncate text-11 text-destructive-text" title={p.error ?? ""}>{p.error ?? "Failed"}</span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {p.grant === "sample" && <Badge tone="outline">Sample</Badge>}
              {p.result?.kind === "github" && <Badge tone={p.result.private ? "outline" : "warning"}>{p.result.private ? "Private" : "Public"}</Badge>}
              <span className="text-11 text-muted-foreground">{fmtAgo(p.at)}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The CLI is missing or signed out, or the target is not connected to the One account. */
function NotReady({ data, name, onLogin, starting }: { data: PublishesResponse; name: string; onLogin: () => void; starting: boolean }) {
  const cli = data.cli;
  const slug = name.toLowerCase();
  const [copied, setCopied] = useState(false);
  const cliReady = cli.mode === "sample" || (cli.installed && cli.signedIn);
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-faint px-3 py-2.5 text-xs" data-testid="publish-not-ready">
      <KeyRound className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        {!cli.installed && cli.mode !== "sample" ? (
          <>
            <p className="font-medium">The One CLI is not on this computer</p>
            <p className="mt-0.5 text-11 text-muted-foreground">Publishing runs on your own One account through the One CLI. Install it with <span className="font-mono">{cli.installHint}</span>, then open Publish again.</p>
          </>
        ) : !cliReady ? (
          <>
            <p className="font-medium">Sign in with the One CLI first</p>
            <p className="mt-0.5 text-11 text-muted-foreground">Publishing runs on your own One account through the One CLI. It opens One's sign-in in your browser.</p>
          </>
        ) : (
          <>
            <p className="font-medium">{name} is not connected to your One account</p>
            <p className="mt-0.5 text-11 text-muted-foreground">Publishing runs on your own {name} account, through the One CLI. Connect it in a terminal, then open Publish again.</p>
            <button
              type="button"
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 font-mono text-11 hover:border-border-strong"
              onClick={async () => { if (await copyText(`one add ${slug}`)) { setCopied(true); setTimeout(() => setCopied(false), 1600); } }}
            >
              one add {slug}{copied ? <Check className="size-3 text-success-text" /> : <Copy className="size-3 text-muted-foreground" />}
            </button>
          </>
        )}
      </div>
      {cli.installed && !cliReady && <Button size="sm" variant="primary" loading={starting || cli.loginRunning} onClick={onLogin}>Sign in with the One CLI</Button>}
    </div>
  );
}

export function PublishDialog({ open, onClose, projectId, projectName, projectSlug, busy, onOpenFile, onOpenAccess, onOpenSettings }: {
  open: boolean; onClose: () => void; projectId: string; projectName: string; projectSlug: string; busy: boolean;
  onOpenFile: (path: string, line?: number | null) => void; onOpenAccess: () => void; onOpenSettings: () => void;
}) {
  const q = usePublishes(projectId, open);
  const live = usePublishSteps(projectId);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [target, setTarget] = usePersisted<Target>("builder.publish.target", "github");
  const [publishId, setPublishId] = useState<number | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const data: PublishesResponse | undefined = q.data;

  // Forms, seeded from the last publish (never a token).
  const [repo, setRepo] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [confirmPublic, setConfirmPublic] = useState(false);
  const [vProject, setVProject] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [askId, setAskId] = useState("");
  const [dbUrl, setDbUrl] = useState("");
  const env = useProjectEnv(projectId);
  /** A name's status, or a not-set row for a name the app has not stored yet. */
  const envVar = (name: string): ProjectEnvVar =>
    env.data?.vars.find((v) => v.name === name) ?? { name, present: false, secret: true, required: false, where: null, whereLabel: "Not set", updatedAt: null, hint: null, target: "publish", why: null, sites: [], client: false, needed: false };
  const appVars = (env.data?.vars ?? []).filter((v) => !v.name.startsWith("ONE_") && !v.name.startsWith("DATABASE_"));
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!data || seeded) return;
    const gl = data.targets.github.last?.options;
    const vl = data.targets.vercel.last?.options;
    setRepo(String(gl?.repo ?? slugify(projectSlug)));
    setVisibility(gl?.visibility === "public" ? "public" : "private");
    setVProject(String(vl?.project ?? slugify(projectSlug)));
    setAskId(String(vl?.permissionSet ?? ""));
    setSeeded(true);
  }, [data, seeded, projectSlug]);

  const runScan = async () => {
    setScanning(true);
    setScanError(null);
    try {
      setScan((await api.scan(projectId)).scan);
    } catch (e) {
      setScanError(humanError(e));
    } finally {
      setScanning(false);
    }
  };
  useEffect(() => {
    if (!open) return;
    setPublishId(null);
    setPublishError(null);
    setConfirmPublic(false);
    if (!busy) void runScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const record = useMemo(() => (publishId ? data?.publishes.find((p) => p.id === publishId) ?? null : null), [data, publishId]);
  const steps = publishId && live[target]?.publishId === publishId ? live[target]!.steps : record?.steps ?? [];
  const running = !!publishId && (!record || record.status === "running");
  useEffect(() => {
    if (!running || !publishId) return;
    const t = setInterval(() => void q.refetch(), 2500);
    return () => clearInterval(t);
  }, [running, publishId, q]);

  const info = data?.targets[target];
  const head = data?.head;
  const stale = scan && head && scan.sha !== head.sha;
  const cliReady = !!data && (data.cli.mode === "sample" || (data.cli.installed && data.cli.signedIn));
  const canPublish = !!scan?.ok && !scanning && !stale && !busy && !running && cliReady && !!info?.connected
    && (target === "github" ? repo.trim().length > 0 && (visibility === "private" || confirmPublic) : vProject.trim().length > 0);

  const start = async () => {
    setStarting(true);
    setPublishError(null);
    try {
      const body = target === "github"
        ? { target, options: { repo: repo.trim(), visibility, confirmPublic: visibility === "public" ? confirmPublic : undefined } } as const
        : { target, options: { project: vProject.trim(), permissionSet: askId.trim() || undefined, databaseUrl: dbUrl.trim() || undefined } } as const;
      const r = await api.publish(projectId, body);
      setPublishId(r.publish.id);
      void q.refetch();
    } catch (e) {
      if (e instanceof ApiError && e.extra.scan) setScan(e.extra.scan as ScanResult);
      setPublishError(humanError(e));
    } finally {
      setStarting(false);
    }
  };

  const fix = async (s: ScanResult) => {
    const lines = s.blocks.map((b) => `- ${b.title}${b.file && !b.title.includes(b.file) ? ` (${b.file}${b.line ? `:${b.line}` : ""})` : ""}${b.detail && b.code !== "build" && b.code !== "typecheck" ? `. ${b.detail}` : ""}${b.code === "build" || b.code === "typecheck" ? `\n${(b.detail ?? "").split("\n").map((l) => `  ${l}`).join("\n")}` : ""}`);
    const prompt = `Publishing is blocked. Fix these, then stop:\n${lines.join("\n")}\nDo not paste any secret back into code. Move it out and say what the user should rotate.`;
    try {
      await api.createTurn(projectId, { prompt });
      toast({ title: "The agent is on it", detail: `${s.blocks.length} thing${s.blocks.length === 1 ? "" : "s"} to fix. Publish again when it is done.` });
      onClose();
    } catch (e) {
      toast({ title: "Could not start the fix", detail: humanError(e), tone: "destructive" });
    }
  };

  const login = async () => {
    setLoggingIn(true);
    try { await api.oneCliLogin(); toast({ title: "Finish in your browser", detail: "One's sign-in page opened. Open Publish again when it is done." }); void q.refetch(); }
    catch (e) { toast({ title: "Could not start the sign-in", detail: humanError(e), tone: "destructive" }); }
    finally { setLoggingIn(false); }
  };
  const redirectUri = (data?.targets.vercel.redirectUriFor ?? "https://{project}.vercel.app/api/one/callback").replace("{project}", vProject.trim() || "your-project");
  const result = record?.status === "ok" ? record.result : null;

  return (
    <Dialog open={open} onClose={onClose} size="lg" title={`Publish ${projectName}`}>
      <div className="flex max-h-[74vh] flex-col gap-5 overflow-y-auto px-4 py-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Version</span>
          <span className="font-mono">{scan?.shortSha ?? head?.shortSha ?? "..."}</span>
          <span className="min-w-0 max-w-[420px] truncate text-muted-foreground">{scan?.subject ?? head?.subject ?? ""}</span>
          {data?.grant === "sample" && (
            <span className="ml-auto" title="GitHub and Vercel answer from fixtures. Nothing leaves this computer."><Badge tone="outline">Sample, nothing leaves this computer</Badge></span>
          )}
        </div>
        {busy && <p className="rounded-md border border-border bg-faint px-3 py-2 text-xs">The agent is working on this project. Checks and publishing wait until the turn ends.</p>}
        {stale && <p className="rounded-md border border-warning-text/30 bg-warning-text/8 px-3 py-2 text-xs">A newer version exists. <button type="button" className="font-medium underline" onClick={() => void runScan()}>Check it</button> before publishing.</p>}

        <Checks scan={scan} running={scanning} error={scanError} live={live.scan?.steps ?? []} onRerun={() => void runScan()} onFix={(s) => void fix(s)} onOpenFile={(f, l) => { onClose(); onOpenFile(f, l); }} />

        <section aria-labelledby="pub-where" className={cn("flex flex-col gap-3", !scan?.ok && !running && !result && "opacity-55")}>
          <div className="flex items-center justify-between gap-3">
            <h3 id="pub-where" className="text-13 font-semibold">Where to</h3>
            <Segmented
              label="Publish target"
              value={target}
              onChange={(t) => { if (!running) { setTarget(t); setPublishId(null); setPublishError(null); } }}
              options={[
                { key: "github", label: <><PlatformMark image={data?.targets.github.image ?? null} name="GitHub" />GitHub</> },
                { key: "vercel", label: <><PlatformMark image={data?.targets.vercel.image ?? null} name="Vercel" />Vercel</> },
              ]}
            />
          </div>

          {publishId ? (
            <div className="flex flex-col gap-2">
              <Steps steps={steps} />
              {record?.status === "failed" && <p className="rounded-md border border-destructive-text/30 bg-destructive-text/8 px-3 py-2 text-xs text-destructive-text">{record.error}</p>}
              {result?.kind === "github" && <GitHubResult r={result} />}
              {result?.kind === "vercel" && <VercelResult r={result} />}
            </div>
          ) : data && info && (!cliReady || !info.connected) ? (
            <NotReady data={data} name={info.name} onLogin={() => void login()} starting={loggingIn} />
          ) : target === "github" ? (
            <div className="flex flex-col gap-3">
              <Field label="Repository name" hint={data?.targets.github.last?.result?.kind === "github" && (data.targets.github.last.result as GitHubPublishResult).repo.toLowerCase() === repo.trim().toLowerCase() ? `Updates ${(data.targets.github.last.result as GitHubPublishResult).owner}/${repo.trim()} with a new commit on main.` : "A new repository on your GitHub account. No remote is added to the project."}>
                <Input value={repo} onChange={(e) => setRepo(e.target.value)} mono spellCheck={false} aria-label="Repository name" />
              </Field>
              <div role="radiogroup" aria-label="Visibility" className="grid grid-cols-2 gap-2">
                {([
                  { key: "private", icon: <Lock />, title: "Private", detail: "Only you and people you invite can see it." },
                  { key: "public", icon: <Globe />, title: "Public", detail: "Anyone on the internet can see it." },
                ] as const).map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    role="radio"
                    aria-checked={visibility === o.key}
                    onClick={() => { setVisibility(o.key); if (o.key === "private") setConfirmPublic(false); }}
                    className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors [&>svg]:mt-0.5 [&>svg]:size-3.5 [&>svg]:shrink-0",
                      visibility === o.key ? "border-ring bg-card shadow-[0_0_0_3px_color-mix(in_oklch,var(--ring)_14%,transparent)]" : "border-border hover:bg-card-hover")}
                  >
                    {o.icon}
                    <span>
                      <span className="block text-xs font-medium">{o.title}{o.key === "private" && <span className="ml-1.5 font-normal text-muted-foreground">recommended</span>}</span>
                      <span className="block text-11 text-muted-foreground">{o.detail}</span>
                    </span>
                  </button>
                ))}
              </div>
              {visibility === "public" && (
                <div className="flex flex-col gap-2 rounded-md border border-warning-text/40 bg-warning-text/8 px-3 py-2.5 text-xs">
                  <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="size-3.5 text-warning-text" />Anyone can see this code</p>
                  <p className="text-11 text-muted-foreground">Every file at this version goes up, with the checkpoint subjects in the commit message. The checks found no secrets, but a public repository cannot be made unseen.</p>
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={confirmPublic} onChange={(e) => setConfirmPublic(e.target.checked)} className="size-3.5 accent-warning-text" />
                    Make this repository public
                  </label>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Field label="Vercel project" hint="Created on your Vercel account the first time, reused after.">
                <Input value={vProject} onChange={(e) => setVProject(e.target.value.toLowerCase())} mono spellCheck={false} aria-label="Vercel project" />
              </Field>
              {data?.connect.enabled ? (
                <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5" data-testid="publish-connect">
                  <p className="flex items-center gap-1.5 text-xs font-medium"><ShieldCheck className="size-3.5 text-muted-foreground" />Sign in with One on the published app<span className="font-normal text-muted-foreground">through {data.connect.setupName ?? "its Connect app"}</span></p>
                  <ol className="flex list-decimal flex-col gap-2 pl-4 text-11 text-muted-foreground marker:text-muted-foreground">
                    <li><span className="text-foreground">Add this production redirect URI to {data.connect.setupName ?? "the Connect app"}</span> in the One dashboard, under Where users return.<div className="mt-1"><CopyValue value={redirectUri} label="Copy the production redirect URI" /></div></li>
                    <li><span className="text-foreground">Create the ask from the Access tab's JSON</span>, so consent asks for exactly what the code calls. <button type="button" onClick={() => { onClose(); onOpenAccess(); }} className="font-medium text-foreground underline-offset-2 hover:underline">Open Access</button>
                      <div className="mt-1.5"><Input value={askId} onChange={(e) => setAskId(e.target.value)} placeholder="Ask id (optional)" mono spellCheck={false} aria-label="Ask id" autoComplete="off" /></div>
                    </li>
                  </ol>
                  <p className="flex items-start gap-1.5 text-11 text-muted-foreground"><Lock className="mt-0.5 size-3 shrink-0" />The client ID goes as a plain variable, the client secret and connect key as sensitive ones, straight from where they are saved. You never paste them here.</p>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-lg border border-border px-3 py-2.5 text-xs" data-testid="publish-connect">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">One Connect is off for this app</p>
                    <p className="mt-0.5 text-11 text-muted-foreground">The published app has no One login, and the checks block any One call in its code. Turn it on in the project's Settings to publish with Sign in with One.</p>
                  </div>
                  <Button size="sm" onClick={() => { onClose(); onOpenSettings(); }}>Open Settings</Button>
                </div>
              )}
              <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-xs font-medium"><Database className="size-3.5 text-muted-foreground" />Database<span className="font-normal text-muted-foreground">{data?.hasAppTables ? "for this app's tables and sign-in" : "for sign-in, which keeps its users there"}</span></p>
                <p className="text-11 text-muted-foreground">On Vercel the app runs on libSQL with the same schema. The build applies the migrations.</p>
                {envVar("DATABASE_URL").present ? (
                  <div className="overflow-hidden rounded-md border border-border bg-card"><EnvRow projectId={projectId} v={envVar("DATABASE_URL")} compact /></div>
                ) : (
                  <Input value={dbUrl} onChange={(e) => setDbUrl(e.target.value)} placeholder="libsql://acme-db.example.io" mono spellCheck={false} aria-label="Database URL" autoComplete="off" />
                )}
                <div className="overflow-hidden rounded-md border border-border bg-card"><EnvRow projectId={projectId} v={envVar("DATABASE_AUTH_TOKEN")} compact /></div>
                <p className="text-11 text-muted-foreground">The token is saved in this app's Environment, outside the project, and goes to Vercel as a sensitive variable at deploy. Or set DATABASE_AUTH_TOKEN in Vercel yourself.</p>
              </div>
              {appVars.length > 0 && (
                <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5" data-testid="publish-env">
                  <p className="flex items-center gap-1.5 text-xs font-medium"><KeyRound className="size-3.5 text-muted-foreground" />App environment<span className="font-normal text-muted-foreground">{appVars.some((v) => v.needed && !v.present) ? "some values are missing" : "sent as sensitive variables"}</span></p>
                  <div className="overflow-hidden rounded-md border border-border bg-card">
                    {appVars.map((v) => <EnvRow key={v.name} projectId={projectId} v={v} compact />)}
                  </div>
                </div>
              )}
            </div>
          )}
          {publishError && <p className="rounded-md border border-destructive-text/30 bg-destructive-text/8 px-3 py-2 text-xs text-destructive-text">{publishError}</p>}
        </section>

        {data && <History list={data.publishes} />}
      </div>
      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <p className="min-w-0 flex-1 truncate text-11 text-muted-foreground">
          {running ? "Publishing on your One account. You can close this; it keeps going." : result ? "Done. The version is badged in History." : !scan?.ok && scan ? "Fix what the checks found first." : "Runs on your One account through the One CLI."}
        </p>
        <Button variant="ghost" onClick={onClose}>{result || running ? "Close" : "Cancel"}</Button>
        {!running && !result && (
          <Button variant="primary" icon={target === "github" ? <GitBranch /> : <Rocket />} disabled={!canPublish} loading={starting} onClick={() => void start()}>
            {target === "github" ? (visibility === "public" ? "Export public repository" : "Export to GitHub") : "Deploy to Vercel"}
          </Button>
        )}
        {result && <Button variant="primary" icon={<ExternalLink />} onClick={() => window.open(record!.url ?? "", "_blank", "noopener")}>{target === "github" ? "Open repository" : "Open app"}</Button>}
      </div>
    </Dialog>
  );
}
