import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowUp, Check, ChevronRight, Loader2, RotateCcw } from "lucide-react";
import { AppWindow } from "../AppWindow";
import { Glyph } from "../Glyph";
import { PlatformLogo, LOGOS } from "./logos";
import { ConfirmLayer } from "./ConfirmSheet";
import { FlowHost, type ConfirmRequest } from "../../flows/host";
import type { Flow } from "../../flows";

// One flow, replayed as a chat: the prompt types into the composer and
// sends, the agent's tool calls tick off, then the UI it wrote renders in
// the conversation and works (tabs, filters, writes behind Confirm).
// Starts when it scrolls into view; with reduced motion it opens finished.

type Phase = {
  typed: number; // characters of the prompt in the composer
  sent: boolean;
  trail: number; // tool calls shown
  reply: boolean;
  ui: boolean;
};

const START = (len: number): Phase => ({ typed: len, sent: false, trail: 0, reply: false, ui: false });
const DONE = (flow: Flow): Phase => ({ typed: 0, sent: true, trail: flow.trail.length, reply: true, ui: true });

const reduced = () => typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function ChatReplay({ flow, className, bodyClassName }: { flow: Flow; className?: string; bodyClassName?: string }) {
  const [p, setP] = useState<Phase>(() => START(flow.prompt.length));
  const [open, setOpen] = useState(false); // tool list expanded after the UI lands
  const [run, setRun] = useState(0); // bumps on replay so the UI remounts fresh
  const [pending, setPending] = useState<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const seen = useRef(false);

  const clear = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  };

  const play = useCallback(() => {
    clear();
    setOpen(false);
    setPending(null);
    setRun((r) => r + 1);
    if (reduced()) {
      setP(DONE(flow));
      return;
    }
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    const n = flow.prompt.length;
    const per = Math.min(26, 1600 / n);
    setP({ typed: 0, sent: false, trail: 0, reply: false, ui: false });
    for (let i = 1; i <= n; i++) at(250 + i * per, () => setP((s) => ({ ...s, typed: i })));
    let t = 250 + n * per + 350;
    at(t, () => setP((s) => ({ ...s, typed: 0, sent: true })));
    t += 500;
    flow.trail.forEach((_, i) => at(t + i * 520, () => setP((s) => ({ ...s, trail: i + 1 }))));
    t += flow.trail.length * 520 + 300;
    at(t, () => setP((s) => ({ ...s, reply: true })));
    at(t + 350, () => setP((s) => ({ ...s, ui: true })));
  }, [flow]);

  // Start once the window is on screen; a new flow (the gallery) restarts.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (seen.current) {
      play();
      return clear;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          seen.current = true;
          io.disconnect();
          play();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clear();
    };
  }, [play]);

  // Keep the newest part of the conversation in view, inside the window only.
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const smooth = reduced() ? "auto" : "smooth";
    if (p.ui) box.scrollTo({ top: 0, behavior: smooth });
    else if (p.sent) box.scrollTo({ top: box.scrollHeight, behavior: smooth });
  }, [p.sent, p.trail, p.ui]);

  const confirm = useCallback((c: ConfirmRequest) => new Promise<boolean>((resolve) => setPending({ ...c, resolve: (ok) => (setPending(null), resolve(ok)) })), []);

  const done = p.ui;
  const writes = flow.actions.filter((a) => a.write).length;
  // A step's app lights once that step has its check mark: the next step
  // has started, or the trail is finished.
  const lit = new Set(
    flow.platforms.filter((pf) => {
      const i = flow.trail.findIndex((s) => s.platform === pf);
      return i < 0 ? p.ui : i < p.trail - 1 || (i < p.trail && p.reply);
    }),
  );

  return (
    <div ref={root} className={className}>
      <AppWindow className="flex flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-4">
          <span className="truncate text-13 font-medium">{flow.name}</span>
          <span className="flex-1" />
          <span className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-11 text-muted-foreground">
            <Glyph id="F6" className="size-3 text-accent-fg" />
            <span className="hidden sm:inline">Forkable blocks</span>
            <span className="size-1.5 rounded-full bg-accent-fill" aria-hidden />
          </span>
          <button
            type="button"
            onClick={play}
            aria-label="Replay this chat"
            className={clsx("grid size-7 place-items-center rounded-full text-muted-foreground transition-[opacity,color] hover:text-foreground", done ? "opacity-100" : "pointer-events-none opacity-0")}
          >
            <RotateCcw className="size-3.5" strokeWidth={2} />
          </button>
        </header>

        <div ref={scroller} className={clsx("relative overflow-y-auto overscroll-contain", bodyClassName ?? "h-[38rem]")}>
          <div className="flex min-h-full flex-col gap-4 p-3 sm:p-4">
            {!p.sent && (
              <div className="grid flex-1 place-items-center py-12 text-center">
                <p className="max-w-xs text-13 text-muted-foreground">Ask for the screen you want. It runs on your own accounts.</p>
              </div>
            )}
            {p.sent && (
              <div className="ml-auto max-w-[85%] motion-in rounded-2xl rounded-br-md bg-foreground/[0.07] px-3.5 py-2 text-13">
                {flow.prompt}
              </div>
            )}

            {p.trail > 0 && (done && !open ? (
              <button type="button" onClick={() => setOpen(true)} className="flex w-max items-center gap-1.5 rounded-md text-11 text-muted-foreground transition-colors hover:text-foreground">
                <Glyph id="F6" className="size-3 text-accent-fg" />
                Used {flow.trail.length} Forkable blocks tools
                <ChevronRight className="size-3" strokeWidth={2} />
              </button>
            ) : (
              <ol className="flex flex-col gap-1.5" aria-label="Tool calls">
                {flow.trail.slice(0, p.trail).map((s, i) => {
                  const running = i === p.trail - 1 && !p.reply;
                  return (
                    <li key={i} className="flex min-w-0 motion-in items-center gap-2 font-mono text-11">
                      <span className="grid size-4 shrink-0 place-items-center">
                        {running ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : <Check className="size-3 text-accent-fg" strokeWidth={2.5} />}
                      </span>
                      <span className="shrink-0 text-foreground">{s.tool}</span>
                      {s.platform && <PlatformLogo platform={s.platform} className="size-3.5 shrink-0" />}
                      <span className="min-w-0 truncate text-muted-foreground">
                        {s.detail}
                        {s.result && <span className="text-foreground/80"> → {s.result}</span>}
                      </span>
                    </li>
                  );
                })}
              </ol>
            ))}

            {p.reply && (
              <div ref={replyRef} className="motion-in text-13 text-foreground/90">
                {flow.reply}
              </div>
            )}

            {p.trail > 0 && (
              <div className="motion-in relative overflow-hidden rounded-lg border border-border" data-canvas>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-card/60 px-3 py-2">
                  <Sources flow={flow} lit={lit} />
                  <span className="flex-1" />
                  <span className="text-11 text-muted-foreground">Generated UI, sandboxed</span>
                </div>
                {p.ui ? (
                  <FlowHost key={run} declared={flow.actions.map((a) => a.actionId)} confirm={confirm}>
                    <flow.Component />
                  </FlowHost>
                ) : (
                  <div className="flex flex-col gap-2.5 p-4" aria-label="Writing the screen">
                    <span className="flex items-center gap-2 text-11 text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" />
                      {p.reply ? "Rendering" : "Writing the screen"}
                    </span>
                    <span className="h-3 w-2/5 rounded bg-foreground/[0.06]" />
                    <span className="grid grid-cols-3 gap-2">
                      <span className="h-12 rounded-md bg-foreground/[0.04]" />
                      <span className="h-12 rounded-md bg-foreground/[0.04]" />
                      <span className="h-12 rounded-md bg-foreground/[0.04]" />
                    </span>
                    <span className="h-16 rounded-md bg-foreground/[0.04]" />
                  </div>
                )}
                {p.ui && (
                  <footer className="flex flex-wrap items-center gap-1.5 border-t border-border bg-card/60 px-3 py-2 text-11 text-muted-foreground">
                    <span className="pr-0.5">Uses</span>
                    {flow.actions.map((a) => (
                      <span key={a.actionId} className={clsx("inline-flex h-5 items-center gap-1 rounded-md border px-1.5", a.write ? "border-foreground/30 text-foreground" : "border-border")}>
                        <PlatformLogo platform={a.platform} className="size-3" />
                        <span className="max-w-[14rem] truncate">{a.title}</span>
                        {a.write && <span className="font-medium">· asks first</span>}
                      </span>
                    ))}
                    <span className="flex-1" />
                    <span className="flex items-center gap-1">
                      <Glyph id="F6" className="size-3 text-accent-fg" />
                      Saved to your blocks, v1
                    </span>
                  </footer>
                )}
                {/* While the connector asks, the generated UI is paused under its own outline. */}
                {pending && (
                  <div className="pointer-events-none absolute inset-0 rounded-lg outline-2 -outline-offset-2 outline-dashed outline-foreground/40" aria-hidden />
                )}
              </div>
            )}
            {p.ui && <p className="text-11 text-muted-foreground">Acme Inc sample data. {writes ? "Writes stop at Confirm here and never leave the page." : "Read only."}</p>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-3 sm:px-4">
          <span className={clsx("min-w-0 flex-1 truncate text-13", p.typed ? "text-foreground" : "text-muted-foreground")}>
            {p.typed ? flow.prompt.slice(0, p.typed) : "Reply…"}
            {p.typed > 0 && p.typed < flow.prompt.length && <span className="caret ml-px" aria-hidden />}
          </span>
          <span className={clsx("grid size-7 shrink-0 place-items-center rounded-full transition-colors", p.typed ? "bg-foreground text-background" : "bg-foreground/[0.08] text-muted-foreground")}>
            <ArrowUp className="size-3.5" strokeWidth={2} />
          </span>
        </div>

        {pending && <ConfirmLayer c={pending} />}
      </AppWindow>
    </div>
  );
}

// The flow's apps, in a row on the canvas frame. Each starts dimmed and lights
// up when the agent's tool trail has found that app's action, in step with
// the check mark in the trail above.
function Sources({ flow, lit }: { flow: Flow; lit: Set<string> }) {
  return (
    <span className="flex items-center gap-1.5" aria-label="Sources">
      <span className="pr-0.5 text-11 text-muted-foreground">Sources</span>
      {flow.platforms.map((p) => {
        const on = lit.has(p);
        return (
          <span
            key={p}
            data-lit={on || undefined}
            title={`${LOGOS[p]?.name ?? p}${on ? "" : ", not yet"}`}
            className={clsx("source-logo grid size-6 place-items-center rounded-md border transition-[opacity,filter,border-color] duration-500", on ? "border-foreground/20 bg-background opacity-100" : "border-border bg-transparent opacity-35 grayscale")}
          >
            <PlatformLogo platform={p} className="size-3.5" />
          </span>
        );
      })}
    </span>
  );
}
