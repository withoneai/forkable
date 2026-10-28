import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@modelcontextprotocol/ext-apps";
import runnerHtml from "../dist-view/runner.html?raw";
import markSvg from "../brand/forkable-mark-current.svg?raw";
import lockupSvg from "../brand/forkable-lockup-horizontal-current.svg?raw";
import "./canvas.css";

// The trusted shell around a UI the agent wrote. The agent's code runs in a
// sandboxed frame inside this page (opaque origin, no host bridge, no
// network) and can only ask this shell to call a tool. Every write waits
// here for the person's Confirm, in a dialog the frame cannot see, click or
// redraw. The same shell runs in a chat app (MCP Apps) and on
// blocks.forkable.dev (web), where window.__FB_WEB__ carries the render.

interface RenderPayload {
  renderId: string;
  uiId: string;
  version: number;
  title: string;
  js: string;
  saved: boolean;
  url: string | null;
  actions: { actionId: string; title: string; platform: string; write: boolean }[];
}
interface WebBoot {
  render: RenderPayload;
  versions: number[];
  user: string | null;
}
type ToolResult = { structuredContent?: any; content?: { type: string; text: string }[]; isError?: boolean };
type Confirm = { token: string; headline: string; fields: { label: string; value: string }[] };

const boot = (window as any).__FB_WEB__ as WebBoot | undefined;

interface Host {
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  ask(text: string): void;
  open(url: string): void;
  reportError(title: string, message: string): void;
}

const app = boot ? null : new App({ name: "forkable-blocks", version: "0.1.0" }, {}, { autoResize: true });

const host: Host = app
  ? {
      callTool: (name, args) => app.callServerTool({ name, arguments: args }) as Promise<ToolResult>,
      ask: (text) => void app.sendMessage({ role: "user", content: [{ type: "text", text }] }).catch(() => {}),
      open: (url) => void app.openLink({ url }).catch(() => {}),
      reportError: (title, message) =>
        void app
          .updateModelContext({ content: [{ type: "text", text: `The UI "${title}" failed in the chat: ${message}. Fix the code with update_ui.` }] })
          .catch(() => {}),
    }
  : {
      callTool: async (name, args) => {
        const r = await fetch("/api/web/tool", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, args }) });
        if (r.status === 401) location.href = "/login";
        return (await r.json()) as ToolResult;
      },
      ask: () => {},
      open: (url) => {
        if (/^https?:\/\//.test(url)) window.open(url, "_blank", "noopener,noreferrer");
      },
      reportError: () => {},
    };

// Theme. In a chat the host decides. On the web: the remembered choice
// (localStorage fb-theme, shared with the rest of the site), else the system.
const THEME_KEY = "fb-theme";
const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
const isDark = (theme?: string) => (theme ? theme === "dark" : systemDark());
function storedTheme(): "light" | "dark" | null {
  try {
    const s = localStorage.getItem(THEME_KEY);
    return s === "light" || s === "dark" ? s : null;
  } catch {
    return null; // a sandboxed host frame has no storage
  }
}
const initialDark = () => (boot ? (storedTheme() ?? (systemDark() ? "dark" : "light")) === "dark" : isDark());

// Brand kit files as they ship, cropped to their drawn bounds so they size like type.
const MARK = markSvg.replace(/<svg [^>]*?>/, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="138 104 234 304" height="100%" aria-hidden="true" focusable="false">');
const LOCKUP = lockupSvg.replace(/<svg [^>]*?>/, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="51 45 239.5 56.2" height="100%" role="img" aria-label="Forkable">');
const Mark = ({ className }: { className?: string }) => <span className={`block shrink-0 [&>svg]:h-full [&>svg]:w-auto ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: MARK }} />;
const Lockup = ({ className }: { className?: string }) => <span className={`block shrink-0 [&>svg]:h-full [&>svg]:w-auto ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: LOCKUP }} />;

const Icon = ({ d, className = "size-4" }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${className}`}>
    <path d={d} />
  </svg>
);
const SUN = "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41";
const MOON = "M20.5 14.1A8.5 8.5 0 1 1 9.9 3.5a6.6 6.6 0 0 0 10.6 10.6Z";
const TRASH = "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2";
const SHIELD = "M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3ZM9 12l2 2 4-4";
const ARROW = "M7 17 17 7M8 7h9v9";
const CHEVRON = "m7 10 5 5 5-5";

const btn = "squircle inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-13 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green";
const ghost = `${btn} text-muted-foreground hover:bg-card hover:text-foreground`;
const outline = `${btn} border border-border bg-raised text-foreground hover:border-strong`;
const primary = `${btn} bg-fill text-black hover:bg-fill-hover active:bg-fill-press`;

function Shell() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [render, setRender] = useState<RenderPayload | null>(boot?.render ?? null);
  const [dark, setDark] = useState(initialDark);
  const [height, setHeight] = useState(160);
  const [ready, setReady] = useState(false);
  const [confirm, setConfirm] = useState<(Confirm & { resolve: (ok: boolean) => void }) | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const renderRef = useRef(render);
  renderRef.current = render;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    frame.current?.contentWindow?.postMessage({ fb: 1, type: "theme", dark }, "*");
  }, [dark]);

  useEffect(() => {
    if (!app) {
      const mq = matchMedia("(prefers-color-scheme: dark)");
      const on = () => !storedTheme() && setDark(mq.matches);
      mq.addEventListener("change", on);
      return () => mq.removeEventListener("change", on);
    }
    app.onhostcontextchanged = (ctx) => ctx.theme && setDark(ctx.theme === "dark");
    app.ontoolresult = (result) => {
      const r = result.structuredContent as RenderPayload | undefined;
      if (r?.js && r.renderId) setRender(r);
    };
    app.connect().then(() => setDark(isDark(app.getHostContext()?.theme)));
  }, []);

  const toggleTheme = useCallback(() => {
    setDark((d) => {
      try {
        localStorage.setItem(THEME_KEY, d ? "light" : "dark");
      } catch {
        // not remembered, still switched
      }
      return !d;
    });
  }, []);

  // One confirmation at a time, in order.
  const askToConfirm = useCallback(
    (c: Confirm) =>
      new Promise<boolean>((resolve) => {
        queue.current = queue.current.then(() => new Promise<void>((done) => setConfirm({ ...c, resolve: (ok) => (resolve(ok), setConfirm(null), done()) })));
      }),
    [],
  );

  const call = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
      const r = renderRef.current;
      if (name !== "run_action" || !r) return { structuredContent: { status: 400, refused: "not_allowed", message: "Not allowed." } };
      const base = { renderId: r.renderId, actionId: args.actionId, input: args.input ?? {} };
      const first = await host.callTool("run_action", base);
      const out = first.structuredContent;
      if (out?.status !== 428 || !out.confirm) return first;
      const ok = await askToConfirm(out.confirm as Confirm);
      if (!ok) return { structuredContent: { status: 499, refused: "cancelled", message: "You cancelled this. Nothing was sent or changed." } };
      return host.callTool("run_action", { ...base, confirmToken: out.confirm.token });
    },
    [askToConfirm],
  );

  // Messages from the frame. Only from our own frame, and only these kinds.
  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || e.source !== win || !e.data || e.data.fb !== 1) return;
      const m = e.data;
      if (m.type === "ready") setReady(true);
      else if (m.type === "size") setHeight(Math.max(80, Math.min(4000, Number(m.height) || 0)));
      else if (m.type === "call") {
        const result = await call(String(m.name), (m.args ?? {}) as Record<string, unknown>);
        win.postMessage({ fb: 1, type: "result", id: m.id, result }, "*");
      } else if (m.type === "ask") {
        if (app) host.ask(String(m.text ?? "").slice(0, 2000));
        else setNotice("Asking the agent works when this UI is open in a chat.");
      } else if (m.type === "open") host.open(String(m.url ?? ""));
      else if (m.type === "error") host.reportError(renderRef.current?.title ?? "UI", String(m.message ?? "").slice(0, 1000));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [call]);

  // Hand the module to the frame once both are ready.
  useEffect(() => {
    if (ready && render) frame.current?.contentWindow?.postMessage({ fb: 1, type: "load", js: render.js, dark }, "*");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, render?.renderId]);

  const iframe = render ? (
    <iframe
      ref={frame}
      title={render.title}
      sandbox="allow-scripts"
      srcDoc={runnerHtml}
      className="block w-full border-0 bg-background transition-opacity duration-150"
      style={{ height, opacity: ready ? 1 : 0, colorScheme: dark ? "dark" : "light" }}
    />
  ) : (
    <div className="flex items-center gap-2 p-3 text-13 text-muted-foreground">
      <span className="size-1.5 animate-pulse rounded-full bg-fill" />
      Building the UI
    </div>
  );

  const noticeBar = notice && (
    <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-13 text-muted-foreground" role="status">
      <span>{notice}</span>
      <button className="ml-auto rounded-md px-1.5 hover:text-foreground" onClick={() => setNotice(null)}>
        Dismiss
      </button>
    </div>
  );

  const dialog = confirm && <ConfirmDialog c={confirm} platform={render?.actions.find((a) => confirm.headline.includes(a.title))?.platform} />;

  if (boot && render)
    return (
      <div className="flex min-h-screen flex-col bg-background text-foreground" style={{ minHeight: confirm ? 420 : undefined }}>
        <WebBar render={render} versions={boot.versions} dark={dark} onToggleTheme={toggleTheme} />
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-3 px-4 py-6">
          <div className="squircle overflow-hidden rounded-xl border border-border bg-background shadow-soft">
            <div className="flex h-9 items-center gap-2 border-b border-border bg-card px-3 text-11 text-muted-foreground">
              <span className="size-1.5 rounded-full bg-fill" />
              <span>Live on your accounts</span>
            </div>
            {iframe}
            {noticeBar}
          </div>
          <ActionList actions={render.actions} />
        </main>
        {dialog}
      </div>
    );

  return (
    <div className="flex flex-col" style={{ minHeight: confirm ? 420 : undefined }}>
      {iframe}
      {app && render?.saved && render.url && (
        <div className="flex items-center gap-1.5 border-t border-border px-3 py-2 text-11 text-muted-foreground">
          <Mark className="h-3 text-foreground" />
          <span>Saved to your blocks, v{render.version}.</span>
          <button
            className="ml-auto inline-flex items-center gap-0.5 rounded-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-green"
            onClick={() => host.open(render.url!)}
          >
            Open on the web
            <Icon d={ARROW} className="size-3" />
          </button>
        </div>
      )}
      {noticeBar}
      {dialog}
    </div>
  );
}

const platformName = (p?: string) => (p ? p.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : "");

/** The app's logo from One's connector set; hidden if it cannot load (chat apps may block outside images). */
function AppLogo({ platform }: { platform: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return <span>{platformName(platform)} ·</span>;
  return (
    <img
      src={`https://assets.withone.ai/connectors/${encodeURIComponent(platform)}.svg`}
      alt={platformName(platform)}
      title={platformName(platform)}
      className="size-3.5 shrink-0 object-contain"
      onError={() => setOk(false)}
    />
  );
}

function ActionList({ actions }: { actions: RenderPayload["actions"] }) {
  if (!actions.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-11 text-muted-foreground">
      <span className="pr-0.5">Uses</span>
      {actions.map((a) => (
        <span key={a.actionId} className={`squircle inline-flex h-5 items-center gap-1 rounded-md border px-1.5 ${a.write ? "border-strong text-foreground" : "border-border"}`}>
          <AppLogo platform={a.platform} />
          {a.title}
          {a.write && <span className="font-medium">· asks first</span>}
        </span>
      ))}
    </div>
  );
}

/** Keeps Tab inside a dialog. */
function trapTab(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "Tab") return;
  const f = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled])")];
  if (!f.length) return;
  const i = f.indexOf(document.activeElement as HTMLElement);
  const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i === f.length - 1 ? 0 : i + 1;
  e.preventDefault();
  f[next].focus();
}

function Dialog({ children, labelledBy, testId, onCancel }: { children: React.ReactNode; labelledBy: string; testId: string; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <div className="squircle flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-raised shadow-2xl" data-testid={testId} onKeyDown={trapTab}>
        {children}
      </div>
    </div>
  );
}

function ConfirmDialog({ c, platform }: { c: Confirm & { resolve: (ok: boolean) => void }; platform?: string }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), [c]);
  const cancel = useCallback(() => c.resolve(false), [c]);
  return (
    <Dialog labelledBy="fb-confirm-title" testId="fb-confirm" onCancel={cancel}>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <span className="squircle grid size-8 place-items-center rounded-lg bg-fill text-black">
            <Icon d={SHIELD} />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="font-mono text-11 uppercase tracking-wider text-muted-foreground">Check before it runs</span>
            {platform && <span className="text-11 text-muted-foreground">On your {platformName(platform)} account</span>}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span id="fb-confirm-title" className="text-15 font-semibold">
            {c.headline}
          </span>
          <span className="text-13 text-muted-foreground">This UI wants to make a change on your account. Nothing happens until you confirm, and only this exact request runs, once.</span>
        </div>
        {c.fields.length > 0 && (
          <dl className="squircle m-0 flex max-h-56 flex-col overflow-y-auto rounded-lg border border-border bg-card">
            {c.fields.map((f, i) => (
              <div key={i} className="flex flex-col gap-0.5 border-b border-border px-3 py-2 last:border-b-0">
                <dt className="text-11 text-muted-foreground">{f.label}</dt>
                <dd className="m-0 whitespace-pre-wrap break-words text-13">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border bg-card px-4 py-3">
        <span className="mr-auto text-11 text-muted-foreground">Esc cancels</span>
        <button ref={cancelRef} className={outline} onClick={cancel}>
          Cancel
        </button>
        <button className={primary} onClick={() => c.resolve(true)} data-testid="fb-confirm-ok">
          Confirm
        </button>
      </div>
    </Dialog>
  );
}

function DeleteDialog({ title, busy, onCancel, onDelete }: { title: string; busy: boolean; onCancel: () => void; onDelete: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  return (
    <Dialog labelledBy="fb-delete-title" testId="fb-delete" onCancel={onCancel}>
      <div className="flex flex-col gap-1.5 p-4">
        <span id="fb-delete-title" className="text-15 font-semibold">
          Delete this block
        </span>
        <span className="text-13 text-muted-foreground">
          <span className="font-medium text-foreground">{title}</span> and all its versions leave your blocks. Your accounts and their data stay as they are.
        </span>
      </div>
      <div className="flex justify-end gap-2 border-t border-border bg-card px-4 py-3">
        <button ref={cancelRef} className={outline} onClick={onCancel}>
          Cancel
        </button>
        <button className={`${btn} bg-foreground text-background hover:opacity-90 disabled:opacity-50`} onClick={onDelete} disabled={busy} data-testid="fb-delete-ok">
          Delete block
        </button>
      </div>
    </Dialog>
  );
}

function WebBar({ render, versions, dark, onToggleTheme }: { render: RenderPayload; versions: number[]; dark: boolean; onToggleTheme: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const latest = Math.max(...versions, render.version);
  const remove = async () => {
    setBusy(true);
    const r = await fetch(`/u/${encodeURIComponent(render.uiId)}/delete`, { method: "POST" });
    if (r.ok || r.redirected) location.href = "/";
    else setBusy(false);
  };
  return (
    <>
    <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4 text-13">
        <a href="/" aria-label="Forkable blocks, home" className="rounded-md text-foreground focus-visible:outline-2 focus-visible:outline-green">
          <Lockup className="h-6" />
        </a>
        <span className="text-strong">/</span>
        <a href="/" className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-green">
          Your blocks
        </a>
        <span className="text-strong">/</span>
        <span className="min-w-0 truncate font-semibold">{render.title}</span>
        {versions.length > 1 ? (
          <span className="relative inline-flex shrink-0 items-center">
            <select
              aria-label="Version"
              className="squircle h-6 cursor-pointer appearance-none rounded-md border border-border bg-raised pr-6 pl-2 font-mono text-11 text-foreground hover:border-strong focus-visible:outline-2 focus-visible:outline-green"
              value={render.version}
              onChange={(e) => (location.search = `?v=${e.target.value}`)}
            >
              {versions.map((v) => (
                <option key={v} value={v}>
                  v{v}
                  {v === latest ? " · latest" : ""}
                </option>
              ))}
            </select>
            <Icon d={CHEVRON} className="pointer-events-none absolute right-1.5 size-3 text-muted-foreground" />
          </span>
        ) : (
          <span className="squircle inline-flex h-6 shrink-0 items-center rounded-md border border-border px-2 font-mono text-11 text-muted-foreground">v{render.version}</span>
        )}
        <span className="ml-auto" />
        <button className={`${ghost} w-8 px-0`} onClick={onToggleTheme} aria-label="Switch light or dark theme" title="Switch theme">
          <Icon d={dark ? SUN : MOON} />
        </button>
        <button className={`${ghost} px-2`} onClick={() => setAsking(true)}>
          <Icon d={TRASH} className="size-3.5" />
          <span className="max-sm:sr-only">Delete</span>
        </button>
      </div>
    </header>
    {asking && <DeleteDialog title={render.title} busy={busy} onCancel={() => setAsking(false)} onDelete={remove} />}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
