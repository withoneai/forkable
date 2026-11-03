import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  ArrowUp,
  Check,
  Code2,
  FileCode2,
  GitCommitHorizontal,
  History,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  MessageSquare,
  Monitor,
  MousePointer2,
  Plug,
  RotateCcw,
  Rocket,
  Search,
  ShieldCheck,
  SquareTerminal,
  Type,
  Play,
  ExternalLink,
} from "lucide-react";
import { connectorLogo } from "./icons";
import { Logo } from "./Logo";
import { CHECKS, CUSTOMERS, DEMOS, PAYMENTS, type Demo, type Step } from "../lib/demo";

// The hero: Builder's editor, chat on the left and the live preview on the
// right, run on a clock. A prompt types itself, the agent's tool cards land
// one by one, the app shows up in the preview, the person connects the tool
// the app uses, then Publish runs its checks and the app goes live.

const TYPE_MS = 32;
const STEP_MS = 560;
const CHECK_MS = 320;

function timeline(d: Demo) {
  const typed = d.prompt.length * TYPE_MS;
  const t0 = typed + 450; // first tool card
  const t1 = t0 + d.steps.length * STEP_MS + 200; // app ready, version card
  const t2 = t1 + 800; // connect card
  const t3 = t2 + 1500; // connected
  const t4 = t3 + 1500; // publish opens
  const t5 = t4 + CHECKS.length * CHECK_MS + 350; // deploying
  const t6 = t5 + 1300; // live
  const end = t6 + 3600;
  return { t0, t1, t2, t3, t4, t5, t6, end };
}

const STEP_ICON: Record<Step["kind"], typeof Search> = {
  find: Search,
  add: Plug,
  write: FileCode2,
  run: SquareTerminal,
};

export function BuilderDemo() {
  const [index, setIndex] = useState(0);
  const [e, setE] = useState(0);
  const [still, setStill] = useState(false);
  const [frozen, setFrozen] = useState<number | null>(null);
  const d = DEMOS[index % DEMOS.length];
  const tl = timeline(d);

  useEffect(() => {
    // QA shots: ?frame=app|live&demo=0|1 holds the demo on one moment.
    const q = new URLSearchParams(location.search);
    const frame = q.get("frame");
    if (frame) {
      const i = Number(q.get("demo") ?? 0) % DEMOS.length;
      const t = timeline(DEMOS[i]);
      setIndex(i);
      setFrozen(frame === "live" ? t.t6 + 1 : t.t3 + 1200);
      return;
    }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStill(true);
      return;
    }
    if (frozen !== null) return;
    const start = performance.now();
    const id = setInterval(() => {
      const now = performance.now() - start;
      if (now >= tl.end) {
        clearInterval(id);
        setIndex((i) => i + 1);
        setE(0);
      } else setE(now);
    }, 40);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const at = frozen ?? (still ? tl.t6 + 1 : e);
  const typed = d.prompt.slice(0, Math.floor(at / TYPE_MS));
  const sent = at >= d.prompt.length * TYPE_MS + 200;
  const steps = at < tl.t0 ? 0 : Math.min(d.steps.length, Math.floor((at - tl.t0) / STEP_MS) + 1);
  const ready = at >= tl.t1;
  const connectShown = at >= tl.t2;
  const connected = at >= tl.t3;
  const publishing = at >= tl.t4;
  const checks = publishing ? Math.min(CHECKS.length, Math.floor((at - tl.t4) / CHECK_MS)) : 0;
  const deploying = at >= tl.t5;
  const live = at >= tl.t6;
  const working = sent && !ready;
  const writingFile = d.steps[Math.max(0, steps - 1)]?.detail;

  return (
    <div className="squircle overflow-hidden rounded-xl border border-border bg-background text-left shadow-[var(--window-shadow)]">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Logo size={18} />
        <span className="text-13 font-medium text-foreground">{d.project}</span>
        <span className={clsx("size-1.5 rounded-full", live ? "bg-accent-fg" : "bg-muted-foreground/50")} aria-hidden />
        <div className="ml-auto flex items-center gap-1.5">
          <Chip>
            <img src={connectorLogo("anthropic")} alt="" className="size-3" />
            Claude Code
          </Chip>
          <Chip className="hidden sm:inline-flex">Build</Chip>
          <span
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-11 font-medium transition-[background-color,box-shadow] duration-300",
              publishing ? "bg-accent-fill text-accent-ink shadow-[0_0_0_4px_var(--accent-glow)]" : "bg-foreground text-background",
            )}
          >
            <Rocket className="size-3" strokeWidth={2} />
            Publish
          </span>
        </div>
      </div>

      <div className="grid h-[28rem] grid-cols-1 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        {/* Chat */}
        <div className="hidden min-w-0 flex-col border-r border-border md:flex">
          <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-hidden p-3">
            {sent && (
              <p className="motion-in ml-auto max-w-[90%] rounded-lg bg-card px-3 py-2 text-13 text-foreground">{d.prompt}</p>
            )}
            {d.steps.slice(0, steps).map((s, i) => {
              const Icon = STEP_ICON[s.kind];
              return (
                <div key={i} className="motion-in flex min-w-0 items-center gap-2 text-13 text-muted-foreground">
                  <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
                  <span className="shrink-0 text-foreground">{s.verb}</span>
                  <span className="truncate font-mono text-11">{s.detail}</span>
                </div>
              );
            })}
            {working && steps > 0 && (
              <p className="flex items-center gap-1.5 text-11 text-muted-foreground">
                <Loader2 className="size-3 animate-spin" strokeWidth={2} />
                Working for {Math.max(1, Math.floor((at - tl.t0) / 1000) + 3)}s
              </p>
            )}
            {ready && (
              <>
                <p className="motion-in text-13 text-foreground">{d.summary}</p>
                <div className="motion-in flex items-center gap-2 rounded-lg border border-border p-2">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-card">
                    <GitCommitHorizontal className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-11 font-medium text-foreground">{d.version.subject}</span>
                    <span className="block font-mono text-11 text-muted-foreground">
                      {d.version.files} files <span className="text-accent-fg">+{d.version.plus}</span> −{d.version.minus}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 text-11 text-muted-foreground">
                    <RotateCcw className="size-3" strokeWidth={1.75} />
                    Restore
                  </span>
                </div>
              </>
            )}
            {connectShown && (
              <div className="motion-in flex items-center gap-2 rounded-lg border border-border bg-card/60 p-2">
                <span className="flex -space-x-1">
                  {d.connect.map((c) => (
                    <img key={c.slug} src={connectorLogo(c.slug)} alt="" className="size-5 rounded-full bg-background p-0.5 ring-1 ring-border" />
                  ))}
                </span>
                <span className="min-w-0 flex-1 text-11 text-muted-foreground">
                  {connected ? (
                    <span className="text-foreground">{d.connect.map((c) => c.name).join(" and ")} connected</span>
                  ) : (
                    <>This app uses {d.connect.map((c) => c.name).join(" and ")}. Connect yours to see it work.</>
                  )}
                </span>
                {connected ? (
                  <Check className="size-3.5 text-accent-fg" strokeWidth={2.5} />
                ) : (
                  <span className="rounded-md bg-foreground px-2 py-0.5 text-11 font-medium text-background">Connect</span>
                )}
              </div>
            )}
          </div>
          <div className="m-3 mt-0 rounded-lg border border-border bg-card/40 p-2">
            <p className="min-h-[2.5rem] text-13 text-foreground">
              {sent ? <span className="text-muted-foreground">Ask for a change</span> : typed}
              {!sent && !still && <span className="caret ml-px" aria-hidden />}
              {!sent && !typed && <span className="text-muted-foreground">What should we build?</span>}
            </p>
            <div className="flex items-center gap-3 text-11 text-muted-foreground">
              <ImageIcon className="size-3.5" strokeWidth={1.75} />
              <span className="flex items-center gap-1">
                <ListChecks className="size-3.5" strokeWidth={1.75} />
                Plan
              </span>
              <span className="ml-auto grid size-6 place-items-center rounded-full bg-foreground text-background">
                <ArrowUp className="size-3.5" strokeWidth={2} />
              </span>
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="relative flex min-w-0 flex-col">
          <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
            <Tab icon={Play} active>
              Preview
            </Tab>
            <Tab icon={Code2}>Code</Tab>
            <Tab icon={History} className="hidden lg:inline-flex">
              History
            </Tab>
            <Tab icon={ShieldCheck} className="hidden lg:inline-flex">
              Access
            </Tab>
            <span className="ml-auto hidden min-w-0 items-center gap-1.5 truncate rounded-md border border-border px-2 py-0.5 font-mono text-11 text-muted-foreground sm:flex">
              <Monitor className="size-3 shrink-0" strokeWidth={1.75} />
              {d.project}.localhost:51990/
            </span>
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden bg-card/30">
            {ready ? (
              d.app === "crm" ? (
                <CrmApp connected={connected} />
              ) : (
                <DigestApp connected={connected} />
              )
            ) : (
              <StartPage working={working} file={writingFile} sent={sent} />
            )}

            {/* Preview toolbar */}
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-background/90 px-3 py-1 text-11 text-muted-foreground backdrop-blur">
              <span className="flex items-center gap-1">
                <MousePointer2 className="size-3" strokeWidth={1.75} />
                Select
              </span>
              <span className="flex items-center gap-1">
                <Type className="size-3" strokeWidth={1.75} />
                Edit
              </span>
              <span className="flex items-center gap-1">
                <MessageSquare className="size-3" strokeWidth={1.75} />
                Comment
              </span>
            </div>

            {publishing && <PublishSheet d={d} checks={checks} deploying={deploying} live={live} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-11 text-muted-foreground", className)}>
      {children}
    </span>
  );
}

function Tab({ icon: Icon, children, active, className }: { icon: typeof Play; children: React.ReactNode; active?: boolean; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-11",
        active ? "bg-card text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3" strokeWidth={1.75} />
      {children}
    </span>
  );
}

function StartPage({ working, file, sent }: { working: boolean; file?: string; sent: boolean }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="grid size-10 place-items-center rounded-xl border border-border bg-background">
          <Logo size={20} />
        </span>
        <p className="text-13 text-muted-foreground">{sent ? "Your app will show up here" : "A new project, ready in seconds"}</p>
        {working && (
          <span className="motion-in inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-11 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" strokeWidth={2} />
            Agent is writing <span className="font-mono text-foreground">{file}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function AppHeader({ connected, title }: { connected: boolean; title: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-background px-4 py-2">
      <span className="flex items-center gap-2 text-11 font-medium text-foreground">
        <span className="grid size-5 place-items-center rounded-md bg-foreground text-11 text-background">A</span>
        Acme Inc <span className="font-normal text-muted-foreground">· {title}</span>
      </span>
      {connected ? (
        <span className="motion-in flex items-center gap-1.5 text-11 text-muted-foreground">
          <span className="grid size-5 place-items-center rounded-full border border-border text-11 text-foreground">D</span>
          Dana
        </span>
      ) : (
        <span className="rounded-md border border-border px-2 py-0.5 text-11 text-foreground">Sign in with One</span>
      )}
    </div>
  );
}

function CrmApp({ connected }: { connected: boolean }) {
  return (
    <div className="motion-in h-full">
      <AppHeader connected={connected} title="Customers" />
      <div className="p-4">
        <p className="font-serif text-28 text-foreground">Customers</p>
        <p className="text-11 text-muted-foreground">Each one's latest Gmail thread, from your own inbox.</p>
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-background">
          {CUSTOMERS.map((c, i) => (
            <li key={c.name} className="grid grid-cols-[1.5rem_minmax(0,0.8fr)_minmax(0,1.2fr)_auto] items-center gap-2 px-3 py-2">
              <span className="grid size-6 place-items-center rounded-full border border-border text-11 text-muted-foreground">{c.initials}</span>
              <span className="min-w-0">
                <span className="block truncate text-11 font-medium text-foreground">{c.name}</span>
                <span className="block truncate text-11 text-muted-foreground">{c.company}</span>
              </span>
              {connected ? (
                <span className="motion-in flex min-w-0 items-center gap-1.5" style={{ animationDelay: `${i * 70}ms` }}>
                  <img src={connectorLogo("gmail")} alt="" className="size-3 shrink-0" />
                  <span className="truncate text-11 text-foreground">{c.thread}</span>
                </span>
              ) : (
                <span className="h-2 w-3/4 rounded-full bg-card" />
              )}
              <span className="text-11 text-muted-foreground">{connected ? c.time : ""}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DigestApp({ connected }: { connected: boolean }) {
  return (
    <div className="motion-in h-full">
      <AppHeader connected={connected} title="Revenue digest" />
      <div className="p-4">
        <p className="font-serif text-28 text-foreground">Yesterday</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border bg-background p-2">
            <p className="text-11 text-muted-foreground">Collected</p>
            <p className="text-17 font-medium text-foreground">{connected ? "$8,880.00" : "Connect Stripe"}</p>
          </div>
          <div className="rounded-lg border border-border bg-background p-2">
            <p className="flex items-center gap-1 text-11 text-muted-foreground">
              <img src={connectorLogo("slack")} alt="" className="size-3" />
              Next post
            </p>
            <p className="text-17 font-medium text-foreground">8:00 AM · #revenue</p>
          </div>
        </div>
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-background">
          {PAYMENTS.map((p, i) => (
            <li key={p.who} className="flex items-center gap-2 px-3 py-2 text-11">
              <img src={connectorLogo("stripe")} alt="" className="size-3" />
              {connected ? (
                <span className="motion-in flex flex-1 items-center gap-2" style={{ animationDelay: `${i * 70}ms` }}>
                  <span className="flex-1 text-foreground">{p.who}</span>
                  <span className="text-muted-foreground">{p.time}</span>
                  <span className="font-medium text-foreground">{p.amount}</span>
                </span>
              ) : (
                <span className="h-2 w-1/2 rounded-full bg-card" />
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PublishSheet({ d, checks, deploying, live }: { d: Demo; checks: number; deploying: boolean; live: boolean }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-background/25 p-4">
      <div className="motion-in w-full max-w-xs rounded-xl border border-border bg-background p-3 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.5),0_0_0_1px_var(--border)]">
        <div className="flex items-center justify-between">
          <p className="text-13 font-medium text-foreground">Publish {d.project}</p>
          <span className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-11 text-foreground">
            <img src={connectorLogo("vercel")} alt="" className="size-3 dark:invert" />
            Vercel
          </span>
        </div>
        <ul className="mt-2 flex flex-col gap-1">
          {CHECKS.map((c, i) => (
            <li key={c} className="flex items-center gap-2 text-11">
              {i < checks ? (
                <Check className="size-3 text-accent-fg" strokeWidth={2.5} />
              ) : i === checks ? (
                <Loader2 className="size-3 animate-spin text-muted-foreground" strokeWidth={2} />
              ) : (
                <span className="size-3 rounded-full border border-border" />
              )}
              <span className={i < checks ? "text-foreground" : "text-muted-foreground"}>{c}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 border-t border-border pt-2">
          {live ? (
            <p className="motion-in flex items-center gap-1.5 text-11">
              <span className="live-dot size-1.5 rounded-full bg-accent-fg" />
              <span className="text-muted-foreground">Live at</span>
              <span className="font-mono text-foreground">{d.url}</span>
              <ExternalLink className="ml-auto size-3 text-muted-foreground" strokeWidth={1.75} />
            </p>
          ) : deploying ? (
            <p className="flex items-center gap-1.5 text-11 text-muted-foreground">
              <Loader2 className="size-3 animate-spin" strokeWidth={2} />
              Deploying to Vercel
            </p>
          ) : (
            <p className="text-11 text-muted-foreground">Checking the version before it ships</p>
          )}
        </div>
      </div>
    </div>
  );
}
