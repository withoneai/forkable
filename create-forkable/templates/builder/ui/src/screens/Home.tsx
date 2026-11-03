import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUp, ChevronDown, Copy, ExternalLink, ImagePlus, LayoutTemplate, Plug, RefreshCw, Search, Settings as SettingsIcon, Terminal, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { HarnessId, HarnessInfo, Permission } from "@builder/harness/types";
import type { ProjectSummary } from "@builder/core/types";
import { api, humanError, shotUrl } from "@/lib/api";
import { keys, useCreateProject, useHarnesses, useOneCli, usePatchSettings, useProjects, useSettings } from "@/lib/queries";
import { BRAND_NAME } from "@/lib/brand";
import { cn, copyText, fmtAgo, MOD } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { emitPreviewKey } from "@/lib/previewKeys";
import { Logo } from "@/components/Logo";
import { AgentChips, PermissionChip } from "@/components/AgentChips";
import { Badge, Button, IconButton, Keys, Menu, Skeleton, Spinner, Tooltip } from "@/components/ui";
import { AttachedThumbs, IMAGE_ACCEPT, imageFiles, type Attached } from "@/components/chat/Composer";

export function TopNav({ children }: { children?: React.ReactNode }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 px-4">
      <Link to="/" className="flex items-center gap-2 rounded-md px-1 py-1" aria-label={`${BRAND_NAME} home`}>
        <Logo size={20} />
        <span className="text-13 font-semibold tracking-tight">{BRAND_NAME}</span>
      </Link>
      <div className="flex-1">{children}</div>
      <button
        type="button"
        onClick={() => emitPreviewKey("mod+k")}
        className="hidden h-7 items-center gap-2 rounded-md border border-border bg-card px-2 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground sm:inline-flex"
      >
        <Search className="size-3.5 stroke-[1.75]" />
        Search
        <Keys combo={`${MOD} K`} />
      </button>
      <Link to="/settings" aria-label="Settings" className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground">
        <SettingsIcon className="size-4 stroke-[1.75]" />
      </Link>
    </header>
  );
}

const INSTALL: Record<string, { label: string; href: string; cmd: string }> = {
  "claude-code": { label: "Claude Code", href: "https://docs.anthropic.com/en/docs/claude-code/quickstart", cmd: "npm install -g @anthropic-ai/claude-code" },
  codex: { label: "Codex", href: "https://github.com/openai/codex", cmd: "npm install -g @openai/codex" },
  openclaw: { label: "OpenClaw", href: "https://docs.openclaw.ai", cmd: "brew install openclaw" },
};

const SIGN_IN_CMD: Partial<Record<HarnessId, string>> = { "claude-code": "claude", codex: "codex login", openclaw: "openclaw onboard" };

function SetupCard({ icon, title, children, action }: { icon: React.ReactNode; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div role="status" className="slide-up flex gap-3 rounded-lg border border-border bg-card p-3 shadow-pop">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&>svg]:size-4 [&>svg]:stroke-[1.75]">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-13 font-semibold">{title}</p>
          {action}
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * The One CLI: how Builder knows One (the catalog, your
 * connections, publishing). Skippable; plain apps work without it. Each
 * app's own login is its One Connect, in the project's Settings.
 */
function OneCliCard() {
  const qc = useQueryClient();
  const cli = useOneCli();
  const [skipped, setSkipped] = useState(() => localStorage.getItem("builder.onecli.skip") === "1");
  const [starting, setStarting] = useState(false);
  const c = cli.data;
  if (skipped || !c || c.mode === "sample" || (c.installed && c.signedIn && !c.error)) return null;
  const skip = () => { localStorage.setItem("builder.onecli.skip", "1"); setSkipped(true); };
  const login = async () => {
    setStarting(true);
    try { qc.setQueryData(keys.oneCli, (await api.oneCliLogin()).cli); }
    catch (e) { toast({ title: "Could not start the sign-in", detail: humanError(e), tone: "destructive" }); }
    finally { setStarting(false); }
  };
  return (
    <SetupCard icon={<Plug />} title={!c.installed ? "Add the One CLI" : "Sign in with the One CLI"} action={<IconButton label="Skip for now" onClick={skip}><X /></IconButton>}>
      <p className="text-xs text-muted-foreground">
        {BRAND_NAME} reads One's catalog and publishes through the One CLI on this computer. Apps that only keep their own data work without it.
      </p>
      <div className="flex flex-wrap items-center gap-2 pt-1" data-testid="onecli-card">
        {!c.installed ? (
          <Command cmd={c.installHint} />
        ) : c.loginRunning ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Spinner className="size-3" />Finish signing in in your browser</span>
        ) : (
          <Button size="sm" variant="primary" loading={starting} onClick={() => void login()}>Sign in with the One CLI</Button>
        )}
        <Link to="/settings/one" className="text-11 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Details</Link>
      </div>
    </SetupCard>
  );
}

function Command({ cmd }: { cmd: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-faint py-0.5 pl-2 pr-0.5 font-mono text-xs">
      {cmd}
      <IconButton size="sm" label="Copy command" onClick={async () => { if (await copyText(cmd)) toast({ title: "Copied" }); }}><Copy /></IconButton>
    </span>
  );
}

function SetupCards({ harnesses, chosen, onRetry, retrying }: { harnesses: HarnessInfo[]; chosen: HarnessInfo | undefined; onRetry: () => void; retrying: boolean }) {
  const [details, setDetails] = useState(false);
  const installed = harnesses.filter((h) => h.bin && h.id !== "replay");
  const retry = <Button size="sm" icon={retrying ? undefined : <RefreshCw />} loading={retrying} onClick={onRetry}>Retry</Button>;
  if (installed.length === 0) {
    const searched = [...new Set(harnesses.flatMap((h) => h.searched ?? []))];
    return (
      <SetupCard icon={<Terminal />} title="No coding agent found" action={retry}>
        <p className="text-xs text-muted-foreground">{BRAND_NAME} builds with the coding agent you already use. Install one, sign in once, then press Retry. Your prompt stays here.</p>
        <div className="flex flex-col gap-1.5 pt-1">
          {(["claude-code", "codex", "openclaw"] as const).map((id) => (
            <div key={id} className="flex flex-wrap items-center gap-2 text-xs">
              <a href={INSTALL[id]!.href} target="_blank" rel="noreferrer" className="inline-flex w-24 items-center gap-1 font-medium hover:underline">{INSTALL[id]!.label}<ExternalLink className="size-3 opacity-60" /></a>
              <Command cmd={INSTALL[id]!.cmd} />
            </div>
          ))}
        </div>
        {searched.length > 0 && (
          <div className="pt-1">
            <button type="button" className="text-11 font-medium text-muted-foreground hover:text-foreground" onClick={() => setDetails((v) => !v)}>{details ? "Hide details" : "Details"}</button>
            {details && <p className="mt-1 break-all font-mono text-11 text-muted-foreground">Looked in {searched.join(", ")}</p>}
          </div>
        )}
      </SetupCard>
    );
  }
  if (chosen && chosen.signedIn === false) {
    const cmd = SIGN_IN_CMD[chosen.id];
    return (
      <SetupCard icon={<Terminal />} title={`Sign in to ${chosen.label}`} action={retry}>
        <p className="text-xs text-muted-foreground">{chosen.note ?? `${chosen.label} is installed but not signed in. Run this in a terminal, follow the steps, then press Retry. Your own plan pays for the work; ${BRAND_NAME} never sees your login.`}</p>
        {cmd && <div className="pt-1"><Command cmd={cmd} /></div>}
      </SetupCard>
    );
  }
  return null;
}

function ProjectCard({ p }: { p: ProjectSummary }) {
  const [failed, setFailed] = useState(false);
  return (
    <Link to={`/p/${p.id}`} className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-[border-color,box-shadow] duration-100 hover:border-border-strong hover:shadow-pop">
      <div className="relative aspect-[16/10] overflow-hidden border-b border-border bg-frame">
        {p.lastShot && !failed ? (
          <img src={shotUrl(p.id, p.lastShot)} alt="" loading="lazy" onError={() => setFailed(true)} className="size-full object-cover object-top transition-transform duration-200 ease-out-quart group-hover:scale-[1.015]" />
        ) : (
          <div className="flex size-full items-center justify-center"><Logo size={22} className="opacity-25" /></div>
        )}
      </div>
      <div className="flex flex-col gap-1 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-13 font-medium">{p.name}</p>
          {p.published && <Badge tone="success">Published</Badge>}
        </div>
        <p className="truncate text-11 text-muted-foreground">Edited {fmtAgo(p.updatedAt)} · {p.slug}</p>
      </div>
    </Link>
  );
}

export function Home() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const harnesses = useHarnesses();
  const settings = useSettings();
  const projects = useProjects();
  const create = useCreateProject();
  const patchSettings = usePatchSettings();
  const [prompt, setPrompt] = useState("");
  const [look, setLook] = useState<Record<LookKey, string | null>>({ accent: null, type: null, density: null });
  const [planFirst, setPlanFirst] = useState(false);
  const [harness, setHarness] = useState<HarnessId | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [permission, setPermission] = useState<Permission>("build");
  const [templateOpen, setTemplateOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const seeded = useRef(false);
  // Images on Home are staged on the server (no project yet); the create call moves them into the project for its first turn.
  const [images, setImages] = useState<Attached[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const attach = async (files: File[]) => {
    setAttaching(true);
    try {
      for (const f of files.slice(0, Math.max(0, 6 - images.length))) {
        const r = await api.stage(f);
        setImages((cur) => [...cur, { file: r.file, url: r.url, name: f.name || "image" }]);
      }
    } catch (e) {
      toast({ title: "Could not attach the image", detail: humanError(e), tone: "destructive" });
    } finally {
      setAttaching(false);
    }
  };
  const removeImage = (file: string) => {
    setImages((cur) => cur.filter((i) => i.file !== file));
    void api.unstage(file).catch(() => {});
  };

  const list = harnesses.data?.harnesses ?? [];
  useEffect(() => {
    if (seeded.current || !harnesses.data || !settings.data) return;
    seeded.current = true;
    const s = settings.data.settings;
    setHarness(s.defaultHarness ?? harnesses.data.defaultId ?? harnesses.data.harnesses.find((h) => h.bin)?.id ?? null);
    setModel(s.defaultModel);
    setPermission(s.defaultPermission === "plan" ? "build" : s.defaultPermission);
    if (s.pendingPrompt) setPrompt(s.pendingPrompt);
    if (s.pendingImages?.length) setImages(s.pendingImages.map((file) => ({ file, url: `/api/attachments/${encodeURIComponent(file)}`, name: "Attached image" })));
  }, [harnesses.data, settings.data]);

  useEffect(() => { area.current?.focus(); }, []);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(320, Math.max(96, el.scrollHeight))}px`;
  }, [prompt]);

  const chosen = list.find((h) => h.id === harness);
  // The replay harness (dev and tests only) is built in: no binary to find.
  const blocked = harnesses.isSuccess && (!chosen || (!chosen.bin && chosen.id !== "replay") || chosen.signedIn === false);
  const recent = useMemo(() => (projects.data?.projects ?? []).filter((p) => !p.archivedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [projects.data]);

  const retry = async () => {
    setRetrying(true);
    try {
      const r = await api.harnesses(true);
      qc.setQueryData(keys.harnesses, r);
      if (!r.harnesses.find((h) => h.id === harness)?.bin) setHarness(r.defaultId ?? r.harnesses.find((h) => h.bin)?.id ?? null);
    } catch (e) {
      toast({ title: "Could not check again", detail: humanError(e), tone: "destructive" });
    } finally {
      setRetrying(false);
    }
  };

  // Sent before the agents finished loading: go out as soon as they have.
  const [sendWhenReady, setSendWhenReady] = useState(false);
  useEffect(() => {
    if (sendWhenReady && harnesses.isSuccess && seeded.current) {
      setSendWhenReady(false);
      submit();
    }
  });

  const submit = () => {
    const text = prompt.trim();
    if (!text || create.isPending) return;
    if (!harnesses.isSuccess || !seeded.current) {
      setSendWhenReady(true);
      return;
    }
    if (attaching) return;
    if (blocked || !harness) {
      patchSettings.mutate({ pendingPrompt: text, pendingImages: images.length ? images.map((i) => i.file) : null });
      toast({ title: "Your prompt is saved", detail: images.length ? `It goes out with ${images.length === 1 ? "its image" : `its ${images.length} images`} once your agent is ready` : "It goes out once your agent is ready" });
      return;
    }
    create.mutate(
      { prompt: withLook(text, look), harness, model, permission, template: "blank", mode: planFirst ? "plan" : "build", images: images.length ? images.map((i) => i.file) : undefined },
      {
        onSuccess: (r) => {
          setImages([]);
          if (settings.data?.settings.pendingPrompt) qc.invalidateQueries({ queryKey: keys.settings });
          nav(`/p/${r.project.id}`);
        },
        onError: (e) => toast({ title: "Could not start the project", detail: humanError(e), tone: "destructive" }),
      },
    );
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <TopNav />
      <main className="mx-auto flex w-full max-w-[1040px] flex-col gap-10 px-6 pb-16">
        <section className="flex flex-col items-center gap-6 pt-[12vh]">
          <h1 className="text-center text-3xl font-semibold tracking-tight">What should we build?</h1>
          <div className="flex w-full max-w-[720px] flex-col gap-3">
            <div
              className={cn("flex flex-col rounded-xl border bg-card shadow-pop transition-[border-color,box-shadow] duration-100 focus-within:border-border-strong focus-within:shadow-float", drag ? "border-accent" : "border-border")}
              onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                setDrag(false);
                const files = imageFiles(e.dataTransfer.files);
                if (files.length) { e.preventDefault(); void attach(files); }
              }}
            >
              {images.length > 0 && <div className="px-4 pt-3.5"><AttachedThumbs images={images} onRemove={removeImage} size="md" /></div>}
              <textarea
                ref={area}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
                }}
                onPaste={(e) => {
                  const files = imageFiles(e.clipboardData.files);
                  if (files.length) { e.preventDefault(); void attach(files); }
                }}
                placeholder="A booking page for Acme Inc's design studio, with a calendar and a confirmation screen"
                aria-label="Describe your app"
                className="min-h-24 w-full resize-none bg-transparent px-4 pb-2 pt-3.5 text-15 leading-relaxed outline-none placeholder:text-muted-foreground/55"
              />
              <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
                <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; if (f.length) void attach(f); e.target.value = ""; }} />
                <Tooltip side="bottom" label="Attach an image (or paste or drop one)">
                  <button type="button" aria-label="Attach an image" disabled={attaching || images.length >= 6} onClick={() => fileRef.current?.click()} className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground disabled:opacity-40">
                    {attaching ? <Spinner className="size-3.5" /> : <ImagePlus className="size-4 stroke-[1.75]" />}
                  </button>
                </Tooltip>
                <Menu
                  open={templateOpen}
                  onClose={() => setTemplateOpen(false)}
                  className="w-[220px]"
                  items={[
                    { key: "blank", label: "Blank app", hint: "React, Hono, D1", onSelect: () => {} },
                    { key: "rill", label: "Email client", hint: "Later", disabled: true, onSelect: () => {} },
                    { key: "brief", label: "AI visibility", hint: "Later", disabled: true, onSelect: () => {} },
                  ]}
                  anchor={
                    <button type="button" aria-label="Template" aria-haspopup="menu" aria-expanded={templateOpen} onClick={() => setTemplateOpen((v) => !v)} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-xs font-medium transition-colors hover:border-border-strong hover:bg-card-hover">
                      <LayoutTemplate className="size-3.5 stroke-[1.75]" />Blank app<ChevronDown className="size-3 opacity-60" />
                    </button>
                  }
                />
                {harnesses.isLoading ? <Skeleton className="h-7 w-32 rounded-md" /> : (
                  <AgentChips harnesses={list} harness={harness} model={model} onChange={(v) => { setHarness(v.harness); setModel(v.model); }} />
                )}
                <PermissionChip value={permission} onChange={setPermission} />
                <div className="ml-auto flex items-center gap-2">
                  <span className="hidden text-11 text-muted-foreground sm:inline"><Keys combo={`${MOD} Enter`} /></span>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={!prompt.trim() || create.isPending || sendWhenReady || attaching}
                    aria-label="Start building"
                    className="inline-flex size-8 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-25"
                  >
                    {create.isPending || sendWhenReady ? <Spinner /> : <ArrowUp className="size-4" strokeWidth={2} />}
                  </button>
                </div>
              </div>
            </div>
            <LookRow value={look} onChange={setLook} planFirst={planFirst} onPlanFirst={setPlanFirst} />
            {harnesses.isError && (
              <SetupCard icon={<Terminal />} title={`${BRAND_NAME} is not answering`} action={<Button size="sm" icon={<RefreshCw />} onClick={() => harnesses.refetch()}>Retry</Button>}>
                <p className="text-xs text-muted-foreground">Start it with <span className="font-mono">pnpm dev</span> in the repo, then press Retry.</p>
              </SetupCard>
            )}
            {harnesses.data && <SetupCards harnesses={list} chosen={chosen} onRetry={retry} retrying={retrying} />}
            <OneCliCard />
            {create.isPending && (
              <p className="fade-in flex items-center justify-center gap-2 text-xs text-muted-foreground"><Spinner className="size-3" /> Copying the template and starting your preview</p>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-end justify-between">
            <h2 className="text-13 font-semibold">Recent projects</h2>
            {recent.length > 0 && <span className="text-11 text-muted-foreground">{recent.length} in {settings.data?.paths.projects ?? "your projects folder"}</span>}
          </div>
          {projects.isLoading ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="aspect-[16/12] rounded-lg" />)}
            </div>
          ) : recent.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">Your apps show up here. Each one is a git repo on this computer that opens in any editor.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {recent.map((p) => <ProjectCard key={p.id} p={p} />)}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

// Design questions before the first build: three optional
// picks that ride along with the first prompt. Skipping them is the default.
type LookKey = "accent" | "type" | "density";
const LOOK: { key: LookKey; label: string; options: { v: string; label: string; swatch?: string }[] }[] = [
  { key: "accent", label: "Accent", options: [{ v: "blue", label: "Blue", swatch: "oklch(0.58 0.17 255)" }, { v: "green", label: "Green", swatch: "oklch(0.62 0.15 150)" }, { v: "violet", label: "Violet", swatch: "oklch(0.56 0.2 290)" }, { v: "orange", label: "Orange", swatch: "oklch(0.68 0.17 55)" }, { v: "neutral", label: "Neutral", swatch: "oklch(0.35 0 0)" }] },
  { key: "type", label: "Type", options: [{ v: "sans", label: "Sans" }, { v: "serif headings", label: "Serif" }, { v: "mono accents", label: "Mono" }] },
  { key: "density", label: "Density", options: [{ v: "compact", label: "Compact" }, { v: "comfortable", label: "Comfortable" }] },
];

function withLook(prompt: string, look: Record<LookKey, string | null>): string {
  const parts = [look.accent && `${look.accent} accent`, look.type && `${look.type} type`, look.density && `${look.density} density`].filter(Boolean);
  if (!parts.length) return prompt;
  return `${prompt}\n\nLook: ${parts.join(", ")}. Set it in the tokens in src/index.css (accent color, font family, the spacing scale), not per component.`;
}

function LookRow({ value, onChange, planFirst, onPlanFirst }: { value: Record<LookKey, string | null>; onChange: (v: Record<LookKey, string | null>) => void; planFirst: boolean; onPlanFirst: (v: boolean) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-11 text-muted-foreground" aria-label="Look, optional">
      {LOOK.map((g) => (
        <div key={g.key} className="flex items-center gap-1" role="group" aria-label={g.label}>
          <span className="mr-0.5">{g.label}</span>
          {g.options.map((o) => {
            const on = value[g.key] === o.v;
            return (
              <button
                key={o.v}
                type="button"
                aria-pressed={on}
                title={o.label}
                onClick={() => onChange({ ...value, [g.key]: on ? null : o.v })}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-full border px-2 font-medium transition-colors duration-100",
                  on ? "border-foreground/40 bg-muted text-foreground" : "border-transparent hover:bg-card-hover hover:text-foreground",
                )}
              >
                {o.swatch && <span className="size-2.5 rounded-full" style={{ background: o.swatch }} />}
                {g.key === "accent" ? <span className="sr-only">{o.label}</span> : o.label}
              </button>
            );
          })}
        </div>
      ))}
      <button
        type="button"
        aria-pressed={planFirst}
        onClick={() => onPlanFirst(!planFirst)}
        className={cn("ml-auto inline-flex h-6 items-center gap-1 rounded-full border px-2 font-medium transition-colors duration-100", planFirst ? "border-accent/40 bg-accent/10 text-accent" : "border-transparent hover:bg-card-hover hover:text-foreground")}
      >
        Plan first
      </button>
    </div>
  );
}
