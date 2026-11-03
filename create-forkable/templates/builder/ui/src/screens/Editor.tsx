import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, Code2, Copy, ExternalLink, Eye, FolderOpen, History, Laptop, Monitor, Play, RefreshCw, RotateCcw, Rocket, Settings2, ShieldCheck, Smartphone, Tablet, Wrench } from "lucide-react";
import type { PreviewMode, PreviewToEditor } from "@builder/core/api-types";
import type { Checkpoint, DirectEdit, Selection } from "@builder/core/types";
import { ACTIVE_STATUSES } from "@builder/core/types";
import { api, humanError } from "@/lib/api";
import { usePreviewChannel } from "@/lib/channel";
import { useCommands } from "@/lib/commands";
import { useKeys } from "@/lib/keys";
import { bind, hint, KEY } from "@/lib/keymap";
import { emitPreviewKey } from "@/lib/previewKeys";
import { keys, useCheckpoints, useHarnesses, usePatchProject, useProject, useTurns, useVersion } from "@/lib/queries";
import { useProjectEvents } from "@/lib/sse";
import { toast } from "@/lib/toast";
import { cn, copyText, usePersisted } from "@/lib/utils";
import { TopBar } from "@/components/editor/TopBar";
import { PreviewPane, type Device } from "@/components/editor/PreviewPane";
import { ConsoleStrip } from "@/components/editor/ConsoleStrip";
import type { CodeTarget } from "@/components/editor/CodePane";

const CodePane = lazy(() => import("@/components/editor/CodePane").then((m) => ({ default: m.CodePane })));
import { HistoryPane } from "@/components/editor/HistoryPane";
import { VersionPane } from "@/components/editor/VersionPane";
import { RestoreDialog } from "@/components/editor/RestoreDialog";
import { PublishDialog } from "@/components/editor/PublishDialog";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { AccessPane, type PreviewAnswer } from "@/components/editor/AccessPane";
import { ProjectSettingsPane } from "@/components/editor/ProjectSettingsPane";
import { CommentBox, EditsBar, StylePanel } from "@/components/editor/VisualEdit";
import { fold } from "@/lib/styleTokens";
import { Button, IconButton, LoadError, Segmented, Skeleton, Spinner } from "@/components/ui";

type Tab = "preview" | "code" | "history" | "access" | "settings";
const TABS: { key: Tab; label: string; icon: React.ReactNode; keyId: "tabPreview" | "tabCode" | "tabHistory" | "tabAccess" | "tabSettings" }[] = [
  { key: "preview", label: "Preview", icon: <Play />, keyId: "tabPreview" },
  { key: "code", label: "Code", icon: <Code2 />, keyId: "tabCode" },
  { key: "history", label: "History", icon: <History />, keyId: "tabHistory" },
  { key: "access", label: "Access", icon: <ShieldCheck />, keyId: "tabAccess" },
  { key: "settings", label: "Settings", icon: <Settings2 />, keyId: "tabSettings" },
];

function PathField({ base, path, onGo }: { base: string; path: string; onGo: (p: string) => void }) {
  const [v, setV] = useState(path);
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setV(path); }, [path, focus]);
  const host = base.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <label className="flex h-7 min-w-0 max-w-[420px] flex-1 items-center rounded-md border border-border bg-card px-2 text-xs transition-colors focus-within:border-ring hover:border-border-strong">
      <span className="min-w-0 shrink truncate text-muted-foreground/70 @max-[44rem]:hidden" title={host}>{host}</span>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        size={1}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { onGo(v.startsWith("/") ? v : `/${v}`); (e.target as HTMLInputElement).blur(); }
          if (e.key === "Escape") { e.stopPropagation(); setV(path); (e.target as HTMLInputElement).blur(); }
        }}
        aria-label="Preview path"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent font-mono outline-none"
      />
    </label>
  );
}

export function Editor() {
  const { projectId = "", tab: tabParam } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const project = useProject(projectId);
  const harnessesQ = useHarnesses();
  const turnsQ = useTurns(projectId);
  const cps = useCheckpoints(projectId);
  const patch = usePatchProject(projectId);
  // A turn that changed files, or a preview that just came up, gets a fresh load:
  // a page that crashed mid-turn does not recover through HMR alone.
  const lastPreview = useRef<string | null>(null);
  const { connected } = useProjectEvents(projectId, (ev) => {
    if (ev.type === "turn.ended" && ev.turn.checkpointSha && (ev.turn.kind === "user" || ev.turn.kind === "fix" || ev.turn.kind === "restore")) setReloadKey((k) => k + 1);
    // Done while the tab is hidden: a browser notification, when the builder allowed them.
    if (ev.type === "turn.ended" && (ev.turn.kind === "user" || ev.turn.kind === "plan") && document.hidden && "Notification" in window && Notification.permission === "granted") {
      const ok = ev.turn.status === "done";
      const n = new Notification(ok ? (ev.turn.kind === "plan" ? "The plan is ready" : "Your app is updated") : "The agent stopped", { body: ev.turn.prompt.slice(0, 120), tag: ev.turn.id });
      n.onclick = () => { window.focus(); n.close(); };
    }
    if (ev.type === "preview.status") {
      if (ev.state === "ready" && lastPreview.current && lastPreview.current !== "ready") setReloadKey((k) => k + 1);
      lastPreview.current = ev.state;
    }
  });

  const tab: Tab = (TABS.some((t) => t.key === tabParam) ? tabParam : "preview") as Tab;
  const setTab = useCallback((t: Tab) => nav(t === "preview" ? `/p/${projectId}` : `/p/${projectId}/${t}`, { replace: true }), [nav, projectId]);

  const [chatOpen, setChatOpen] = usePersisted("builder.chat.open", true);
  const [chatWidth, setChatWidth] = usePersisted("builder.chat.width", 420);
  const [device, setDevice] = usePersisted<Device>("builder.device", "desktop");
  const [srcPath, setSrcPath] = useState("/");
  const [livePath, setLivePath] = useState("/");
  const [reloadKey, setReloadKey] = useState(0);
  const [mode, setModeState] = useState<PreviewMode>("none");
  const [pending, setPending] = useState<DirectEdit[]>([]);
  const [commentOn, setCommentOn] = useState<Selection | null>(null);
  const [applying, setApplying] = useState(false);
  const [styleOpen, setStyleOpen] = useState(true);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [codeTarget, setCodeTarget] = useState<CodeTarget | null>(null);
  const [historyFocus, setHistoryFocus] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<Checkpoint | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const composerFocus = useRef<(() => void) | null>(null);
  const stopTurn = useRef<(() => void) | null>(null);

  const p = project.data;
  const harnesses = harnessesQ.data?.harnesses ?? [];
  const harness = harnesses.find((h) => h.id === p?.harness);
  const turns = useMemo(() => (turnsQ.data?.pages ?? []).flatMap((x) => x.turns), [turnsQ.data]);
  const active = turns.find((t) => ACTIVE_STATUSES.includes(t.status) && t.status !== "queued") ?? null;
  const busy = !!active || !!p?.activeTurnId;
  const activeStep = useQuery({ queryKey: keys.turnStep(active?.id ?? "_"), queryFn: () => null as string | null, enabled: false, initialData: null }).data;

  const previewBase = p?.previewUrl ?? "about:blank";
  const src = useMemo(() => {
    try { return new URL(srcPath, previewBase).toString(); } catch { return previewBase; }
  }, [previewBase, srcPath]);

  // Preview this version: an older checkpoint on its own host, shown in the Preview pane.
  const versionQ = useVersion(projectId);
  const version = versionQ.data ?? null;
  const versionSrc = useMemo(() => {
    if (!version) return null;
    try { return new URL(srcPath, version.url).toString(); } catch { return version.url; }
  }, [version, srcPath]);
  const shownSrc = versionSrc ?? src;
  const openVersion = async (cp: Checkpoint) => {
    if (cps.data?.[0]?.sha === cp.sha) { toast({ title: "This is the current version", detail: "Pick an older one to preview it." }); return; }
    setOpening(true);
    try {
      const r = await api.previewVersion(projectId, cp.sha);
      qc.setQueryData(keys.version(projectId), r.version);
      setModeState("none");
      post({ kind: "mode", mode: "none" });
      setTab("preview");
    } catch (e) {
      toast({ title: "Could not preview that version", detail: humanError(e), tone: "destructive" });
    } finally {
      setOpening(false);
    }
  };
  const closeVersion = () => {
    qc.setQueryData(keys.version(projectId), null);
    void api.closeVersion(projectId).catch(() => {});
    setReloadKey((k) => k + 1);
  };
  // Leaving the editor (another project, Home, closing the tab) stops the version's server.
  const openSha = useRef<string | null>(null);
  openSha.current = version?.sha ?? null;
  useEffect(() => {
    const leave = () => { if (openSha.current) void fetch(`/api/projects/${encodeURIComponent(projectId)}/version`, { method: "DELETE", keepalive: true, credentials: "same-origin" }).catch(() => {}); };
    window.addEventListener("pagehide", leave);
    return () => { window.removeEventListener("pagehide", leave); leave(); };
  }, [projectId]);
  const versionCp = version ? (cps.data ?? []).find((c) => c.sha === version.sha) ?? null : null;

  const receiptWaiters = useRef(new Map<string, (a: PreviewAnswer) => void>());
  const { frame, post } = usePreviewChannel(previewBase, (m: PreviewToEditor) => {
    switch (m.kind) {
      case "hello":
        setLivePath(m.path);
        post({ kind: "mode", mode });
        syncPending(pending);
        for (const e of pending) if (e.kind === "class") post({ kind: "apply-class", loc: e.loc, remove: e.remove, add: e.add });
        break;
      case "route": setLivePath(m.path); break;
      case "mode": setModeState(m.mode); break;
      case "edit-text":
        setPending((cur) => {
          const prev = cur.find((e) => e.kind === "text" && e.loc === m.loc);
          const before = prev && prev.kind === "text" ? prev.before : m.before;
          const rest = cur.filter((e) => !(e.kind === "text" && e.loc === m.loc));
          return before === m.after ? rest : [...rest, { kind: "text", loc: m.loc, before, after: m.after }];
        });
        break;
      case "comment":
        setCommentOn(m.selection);
        break;
      case "receipt-test": {
        const done = receiptWaiters.current.get(m.ticket);
        receiptWaiters.current.delete(m.ticket);
        done?.({ status: m.status, blockedByGrant: m.blockedByGrant, message: m.message });
        break;
      }
      case "select":
        setSelections((cur) => {
          if (!m.additive) return m.selections;
          const next = [...cur];
          for (const s of m.selections) if (!next.some((x) => x.loc === s.loc)) next.push(s);
          return next;
        });
        if (!m.additive) {
          setModeState("none");
          setStyleOpen(true);
          post({ kind: "mode", mode: "none" });
          setTimeout(() => composerFocus.current?.(), 0);
        }
        break;
      case "key": {
        const chord = `${m.meta ? "mod+" : ""}${m.key.toLowerCase()}`;
        if (version && (chord === "s" || chord === "t" || chord === "c")) break;
        if (chord === "s") toggleMode("select");
        else if (chord === "t") toggleMode("text");
        else if (chord === "c") toggleMode("comment");
        else if (chord === "escape") clearSelect();
        else emitPreviewKey(chord);
        break;
      }
      default: break;
    }
  });

  const setMode = (next: PreviewMode) => {
    setModeState(next);
    post({ kind: "mode", mode: next });
    if (next !== "comment") setCommentOn(null);
  };
  const toggleMode = (m: PreviewMode) => {
    setTab("preview");
    setMode(mode === m ? "none" : m);
  };
  const clearSelect = () => {
    if (commentOn) { setCommentOn(null); return; }
    if (mode !== "none") { setMode("none"); return; }
    if (selections.length) { setSelections([]); post({ kind: "clear" }); }
  };
  const syncPending = (list: DirectEdit[]) => post({ kind: "pending", locs: [...new Set(list.filter((e) => e.kind !== "comment").map((e) => e.loc))] });
  useEffect(() => { syncPending(pending); }, [pending]);
  const swapClass = (loc: string, remove: string[], add: string[]) => {
    post({ kind: "apply-class", loc, remove, add });
    setPending((cur) => {
      const prev = cur.find((e) => e.kind === "class" && e.loc === loc);
      const next = fold(prev && prev.kind === "class" ? prev : undefined, remove, add);
      const rest = cur.filter((e) => !(e.kind === "class" && e.loc === loc));
      return next.remove.length || next.add.length ? [...rest, { kind: "class", loc, ...next }] : rest;
    });
  };
  const discardEdits = () => { setPending([]); setReloadKey((k) => k + 1); };
  const applyEdits = async () => {
    if (!pending.length) return;
    setApplying(true);
    try {
      const r = await api.applyEdits(projectId, { edits: pending });
      setPending([]);
      setSelections([]);
      const sent = r.deferred.length;
      toast({
        title: r.applied ? `Applied ${r.applied} edit${r.applied === 1 ? "" : "s"} as a version` : sent ? "Sent to the agent" : "Nothing changed",
        detail: sent ? `${sent} ${sent === 1 ? "edit needs" : "edits need"} the agent (${r.deferred[0]!.reason}${sent > 1 ? ", and more" : ""}). It is working on ${sent === 1 ? "it" : "them"} now.` : undefined,
      });
      void cps.refetch();
      void qc.invalidateQueries({ queryKey: keys.turns(projectId) });
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ title: "Could not apply the edits", detail: humanError(e), tone: "destructive" });
    } finally {
      setApplying(false);
    }
  };
  const reload = () => setReloadKey((k) => k + 1);
  /** Access, Ask One live: the preview runs the ticket's call on your sign-in to the app and answers over the channel. */
  const askPreview = (ticket: string) =>
    new Promise<PreviewAnswer>((resolve) => {
      receiptWaiters.current.set(ticket, resolve);
      post({ kind: "receipt-test", ticket });
      setTimeout(() => {
        if (!receiptWaiters.current.delete(ticket)) return;
        resolve({ status: 504, blockedByGrant: false, message: "The preview did not answer. Open the Preview tab, wait for the app, then try again." });
      }, 20_000);
    });
  const openFile = (path: string, line?: number | null) => { setCodeTarget({ path, line, nonce: Date.now() }); setTab("code"); };
  const viewVersion = (sha: string) => { setHistoryFocus(sha); setTab("history"); };

  useKeys(bind({
    stop: () => { if (busy) stopTurn.current?.(); },
    toggleChat: () => setChatOpen(!chatOpen),
    tabPreview: () => { setTab("preview"); },
    tabCode: () => { setTab("code"); },
    tabHistory: () => { setTab("history"); },
    tabAccess: () => { setTab("access"); },
    tabSettings: () => { setTab("settings"); },
    publish: () => { setPublishOpen(true); },
    reload: () => reload(),
    // The preview tools work on the live app only, not on a version preview.
    select: () => { if (tab === "preview" && !version) toggleMode("select"); else return false; },
    editText: () => { if (tab === "preview" && !version) toggleMode("text"); else return false; },
    comment: () => { if (tab === "preview" && !version) toggleMode("comment"); else return false; },
    previewVersion: () => { if (version) closeVersion(); else return false; },
    escape: () => { if (mode !== "none" || selections.length || commentOn) clearSelect(); else return false; },
  }));

  useCommands([
    ...TABS.map((t) => ({ id: `tab-${t.key}`, group: "Project" as const, label: `Show ${t.label}`, icon: t.icon, keys: KEY[t.keyId].display, run: () => setTab(t.key) })),
    { id: "reload", group: "Project", label: "Reload the preview", icon: <RefreshCw />, keys: "Alt R", run: reload },
    { id: "restart", group: "Project", label: "Restart the preview server", icon: <RefreshCw />, run: () => void api.restartPreview(projectId).then((r) => qc.setQueryData(keys.project(projectId), r.project), (e) => toast({ title: "Could not restart", detail: humanError(e), tone: "destructive" })) },
    { id: "copy-url", group: "Project", label: "Copy preview URL", icon: <Copy />, run: async () => { if (await copyText(src)) toast({ title: "Copied", detail: src }); } },
    { id: "open-tab", group: "Project", label: "Open the preview in a new tab", icon: <ExternalLink />, run: () => window.open(src, "_blank", "noopener") },
    { id: "open-editor", group: "Project", label: "Copy the project folder path", detail: "Open it in your editor", icon: <FolderOpen />, run: async () => { if (p && (await copyText(p.path))) toast({ title: "Path copied", detail: p.path }); } },
    { id: "autofix", group: "Agent", label: p?.autoFix ? "Turn auto-fix off" : "Turn auto-fix on", icon: <Wrench />, run: () => patch.mutate({ autoFix: !p?.autoFix }, { onSuccess: (r) => toast({ title: r.project.autoFix ? "Auto-fix is on" : "Auto-fix is off" }) }) },
    ...harnesses.filter((h) => h.bin && h.id !== p?.harness).map((h) => ({ id: `h-${h.id}`, group: "Agent" as const, label: `Switch to ${h.label}`, detail: h.status === "preview" ? "Preview" : undefined, icon: <Bot />, run: () => patch.mutate({ harness: h.id, model: null }) })),
    ...(version ? [{ id: "version-back", group: "Versions" as const, label: "Back to the current version", detail: `Leave ${version.shortSha}`, icon: <ArrowLeft />, keys: KEY.previewVersion.display, run: closeVersion }] : []),
    ...(cps.data ?? []).slice(1, 6).filter((c) => c.sha !== version?.sha).map((c) => ({ id: `v-${c.sha}`, group: "Versions" as const, label: `Preview ${c.subject}`, detail: `${c.shortSha}, without restoring`, icon: <Eye />, run: () => void openVersion(c) })),
    ...(cps.data ?? []).slice(1, 6).map((c) => ({ id: `r-${c.sha}`, group: "Versions" as const, label: `Restore ${c.subject}`, detail: c.shortSha, icon: <RotateCcw />, run: () => setRestoring(c) })),
    { id: "publish", group: "Project", label: "Publish", detail: "GitHub or Vercel", icon: <Rocket />, keys: KEY.publish.display, run: () => setPublishOpen(true) },
  ], [p, harnesses, cps.data, src, version]);

  // Getting ready: the dev server is starting, or the first version is still being written.
  const firstBuild = !!active && !!cps.data?.length && cps.data.every((c) => c.kind === "template");
  const readyStep =
    p && p.preview === "starting" ? p.previewStep ?? "Starting preview"
    : firstBuild ? activeStep ?? "The agent is writing your first version"
    : null;

  if (project.isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-12 items-center gap-3 border-b border-border px-3"><Skeleton className="h-4 w-40" /><Skeleton className="ml-auto h-7 w-56 rounded-md" /></div>
        <div className="flex min-h-0 flex-1">
          <div className="w-[420px] border-r border-border p-4"><Skeleton className="ml-auto h-12 w-3/4 rounded-xl" /></div>
          <div className="flex flex-1 items-center justify-center bg-frame"><Spinner /></div>
        </div>
      </div>
    );
  }
  if (project.isError || !p) {
    return <div className="flex h-full items-center justify-center"><LoadError what="This project" error={project.error} onRetry={() => project.refetch()} /></div>;
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <TopBar project={p} harnesses={harnesses} chatOpen={chatOpen} onToggleChat={() => setChatOpen(!chatOpen)} connected={connected} onPublish={() => setPublishOpen(true)} />
      <div className="flex min-h-0 flex-1">
        {chatOpen && (
          <aside className="relative flex shrink-0 flex-col border-r border-border bg-background" style={{ width: chatWidth }} aria-label="Chat">
            <ChatPanel
              project={p}
              harness={harness}
              selections={selections}
              onClearSelections={() => { setSelections([]); post({ kind: "clear" }); }}
              onRemoveSelection={(loc) => setSelections((s) => s.filter((x) => x.loc !== loc))}
              onViewVersion={viewVersion}
              focusRef={composerFocus}
              stopRef={stopTurn}
            />
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize chat"
              className="absolute -right-1 top-0 z-20 h-full w-2 cursor-col-resize hover:bg-accent/20"
              onPointerDown={(e) => {
                const start = e.clientX;
                const w0 = chatWidth;
                const move = (ev: PointerEvent) => setChatWidth(Math.min(640, Math.max(320, w0 + ev.clientX - start)));
                const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); document.body.style.userSelect = ""; };
                document.body.style.userSelect = "none";
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
              }}
            />
          </aside>
        )}
        <section className="flex min-w-0 flex-1 flex-col" aria-label="Workspace">
          <div className="@container flex h-11 shrink-0 items-center gap-2 border-b border-border px-2">
            <div role="tablist" className="flex items-center gap-0.5">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  title={`${t.label} (${hint(t.keyId)})`}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-13 font-medium transition-colors duration-100 [&>svg]:size-3.5 [&>svg]:stroke-[1.75]",
                    tab === t.key ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-card-hover hover:text-foreground",
                  )}
                >
                  {t.icon}<span className="@max-[32rem]:sr-only">{t.label}</span>
                </button>
              ))}
            </div>
            {tab === "preview" && (
              <div className="ml-2 flex min-w-0 flex-1 items-center justify-end gap-1.5">
                <PathField base={version?.url ?? previewBase} path={livePath} onGo={(path) => { setSrcPath(path); setLivePath(path); if (path === srcPath) reload(); }} />
                <Segmented
                  label="Device"
                  value={device}
                  onChange={setDevice}
                  options={[
                    { key: "desktop", label: <Monitor />, title: "Desktop, full width" },
                    { key: "tablet", label: <Tablet />, title: "Tablet, 768" },
                    { key: "mobile", label: <Smartphone />, title: "Mobile, 390" },
                  ]}
                />
                <IconButton label="Reload" hint={hint("reload")} onClick={reload}><RefreshCw /></IconButton>
                <IconButton label="Open in a new tab" onClick={() => window.open(shownSrc, "_blank", "noopener")}><ExternalLink /></IconButton>
              </div>
            )}
            {tab === "code" && (
              <div className="ml-auto flex items-center gap-2 pr-1 text-11 text-muted-foreground">
                <Laptop className="size-3.5 stroke-[1.75]" />
                <span className="max-w-[360px] truncate font-mono" title={p.path}>{p.path}</span>
                <IconButton size="sm" label="Copy path" onClick={async () => { if (await copyText(p.path)) toast({ title: "Path copied" }); }}><Copy /></IconButton>
              </div>
            )}
            {tab === "history" && (
              <div className="ml-auto pr-1">
                <Button size="sm" variant="ghost" onClick={() => api.checkpointNow(projectId).then((r) => { if (r.checkpoint) { toast({ title: "Saved a version", detail: r.checkpoint.shortSha }); void cps.refetch(); } else toast({ title: "Nothing new to save" }); }, (e) => toast({ title: "Could not save a version", detail: humanError(e), tone: "destructive" }))}>Save a version now</Button>
              </div>
            )}
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            {tab === "preview" && version && versionSrc && (
              <VersionPane
                version={version}
                src={versionSrc}
                reloadKey={reloadKey}
                device={device}
                restoreDisabled={!versionCp}
                onRestore={() => { if (versionCp) setRestoring(versionCp); }}
                onBack={closeVersion}
                onRetry={() => { if (versionCp) void openVersion(versionCp); }}
              />
            )}
            <div className={cn("min-h-0 flex-1 flex-col", tab === "preview" && !version ? "flex" : "hidden")}>
              <PreviewPane
                project={p}
                frame={frame}
                src={src}
                reloadKey={reloadKey}
                device={device}
                mode={mode}
                onMode={(m) => { setTab("preview"); setMode(m); }}
                readyStep={readyStep}
                onLoad={() => post({ kind: "mode", mode })}
                overlay={
                  <>
                    {selections.length === 1 && styleOpen && mode === "none" && !commentOn && (
                      <StylePanel
                        selection={selections[0]!}
                        pending={(() => { const e = pending.find((x) => x.kind === "class" && x.loc === selections[0]!.loc); return e && e.kind === "class" ? e : undefined; })()}
                        onSwap={(remove, add) => swapClass(selections[0]!.loc, remove, add)}
                        onClose={() => setStyleOpen(false)}
                      />
                    )}
                    {commentOn && (
                      <CommentBox
                        selection={commentOn}
                        onCancel={() => setCommentOn(null)}
                        onAdd={(text) => { setPending((cur) => [...cur, { kind: "comment", loc: commentOn.loc, text, tag: commentOn.tag, excerpt: commentOn.text }]); setCommentOn(null); }}
                      />
                    )}
                    {!commentOn && (
                      <EditsBar
                        edits={pending}
                        busy={busy}
                        applying={applying}
                        onApply={() => void applyEdits()}
                        onDiscard={discardEdits}
                        onRemove={(i) => {
                          const e = pending[i];
                          if (e?.kind === "class") post({ kind: "apply-class", loc: e.loc, remove: e.add, add: e.remove });
                          setPending((cur) => cur.filter((_, j) => j !== i));
                          if (e?.kind === "text") setReloadKey((k) => k + 1);
                        }}
                      />
                    )}
                  </>
                }
              />
            </div>
            {tab === "code" && <Suspense fallback={<div className="flex flex-1 items-center justify-center"><Spinner /></div>}><CodePane projectId={projectId} target={codeTarget} onTarget={setCodeTarget} /></Suspense>}
            {tab === "history" && <HistoryPane projectId={projectId} busy={busy} focusSha={historyFocus} onPreview={(c) => void openVersion(c)} previewingSha={version?.sha ?? null} opening={opening} />}
            {tab === "access" && <AccessPane projectId={projectId} onOpenFile={openFile} onOpenSettings={() => setTab("settings")} askPreview={askPreview} />}
            {tab === "settings" && <ProjectSettingsPane projectId={projectId} slug={p.slug} />}
            <ConsoleStrip projectId={projectId} busy={busy} onOpenFile={openFile} />
          </div>
        </section>
      </div>
      <RestoreDialog projectId={projectId} checkpoint={restoring} onClose={() => setRestoring(null)} busy={busy} onRestored={() => { if (version && restoring?.sha === version.sha) closeVersion(); }} />
      <PublishDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        projectId={projectId}
        projectName={p.name}
        projectSlug={p.slug}
        busy={busy}
        onOpenFile={openFile}
        onOpenAccess={() => setTab("access")}
        onOpenSettings={() => setTab("settings")}
      />
    </div>
  );
}
