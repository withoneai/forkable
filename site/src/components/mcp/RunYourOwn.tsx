import clsx from "clsx";
import type { ReactNode } from "react";
import { Blocks, Github, Globe, KeyRound, Server, Users } from "lucide-react";
import { AppWindow } from "../AppWindow";
import { LearnMore } from "../LearnMore";
import { CopyButton } from "./CopyButton";
import { ChatGptMark, ClaudeMark, PlatformLogo } from "./logos";
import { useReveal } from "../../lib/hooks";
import count from "../../generated/platform-count.json";

// The second headline on /mcp, after the hero. agent/mcp.md carries it as
// plain text too (marked RUN_HEADLINE), so change both together.
export const RUN_HEADLINE = "Run your own MCP";
export const RUN_ANCHOR = "run-your-own";
const CODE = "https://github.com/withoneai/forkable/tree/main/mcp";
const SETUP = "https://github.com/withoneai/forkable/tree/main/mcp#run-it-on-the-sample";
// Acme Inc stands in for the builder's own domain.
const HOST = "mcp.acme.com";

const SAMPLE_COMMANDS = [
  "git clone https://github.com/withoneai/forkable.git",
  "cd forkable/mcp && pnpm install",
  "cp .dev.vars.example .dev.vars",
  "pnpm dev",
];

function Cmd({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className="whitespace-pre-wrap break-all sm:whitespace-pre sm:break-normal">
      <span className="select-none text-muted-foreground">$ </span>
      <span className="text-foreground">{children}</span>
      {note && <span className="select-none text-muted-foreground">{`   # ${note}`}</span>}
    </div>
  );
}

function Step({ n, title, note, children, action }: { n: string; title: string; note: string; children: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex flex-col gap-2.5 px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-border font-mono text-10 text-muted-foreground">{n}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h4 className="text-13 font-medium">{title}</h4>
          <p className="text-11 text-muted-foreground">{note}</p>
        </div>
        {action}
      </div>
      <div className="overflow-x-auto sm:ml-8 rounded-lg border border-border bg-background/60 px-3 py-2.5 font-mono text-11 leading-5 sm:text-13 sm:leading-6">
        {children}
      </div>
    </li>
  );
}

// The four steps from the README, with the real commands.
function SetupCard() {
  return (
    <AppWindow className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
        </span>
        <span className="ml-2 font-mono text-11 text-muted-foreground">forkable/mcp</span>
        <span className="flex-1" />
        <span className="text-11 text-muted-foreground">MIT</span>
      </header>
      <ol className="flex flex-col divide-y divide-border">
        <Step
          n="1"
          title="Run it on the sample"
          note="The Acme Inc sample on :52290. No account, no keys."
          action={
            <CopyButton text={SAMPLE_COMMANDS.join("\n")} label="Copy the sample commands" className="shrink-0 rounded-md px-2 py-1 text-11 text-muted-foreground hover:text-foreground">
              Copy
            </CopyButton>
          }
        >
          {SAMPLE_COMMANDS.map((c) => (
            <Cmd key={c}>{c}</Cmd>
          ))}
        </Step>
        <Step n="2" title="Make one Connect app" note="In the One dashboard, Developers, Connect, New app. It is your login.">
          <div className="whitespace-pre-wrap break-all sm:whitespace-pre sm:break-normal">
            <span className="select-none text-muted-foreground">redirect  </span>
            <span className="text-foreground">https://{HOST}/api/one/callback</span>
          </div>
        </Step>
        <Step n="3" title="Deploy the Worker" note="The client id, secret and Connect key go in as Worker secrets.">
          <Cmd>npx wrangler secret put ONE_CONNECT_KEY</Cmd>
          <Cmd note="wrangler deploy">pnpm deploy</Cmd>
        </Step>
        <Step n="4" title="Add it to Claude or ChatGPT" note="As a custom connector. Your users sign in with One.">
          <div className="whitespace-pre-wrap break-all sm:whitespace-pre sm:break-normal">
            <span className="select-none text-muted-foreground">connector  </span>
            <span className="text-foreground">https://{HOST}/mcp</span>
          </div>
        </Step>
      </ol>
    </AppWindow>
  );
}

function Node({ icon, title, body, accent }: { icon: ReactNode; title: ReactNode; body: string; accent?: boolean }) {
  return (
    <div
      className={clsx(
        "squircle relative flex items-center gap-3 rounded-xl border p-3",
        accent ? "border-accent-fg/40 bg-card shadow-[0_0_0_4px_var(--accent-glow)]" : "border-border bg-card",
      )}
    >
      <div className="flex shrink-0 items-center">{icon}</div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-13 font-medium">{title}</span>
        <span className="text-11 text-muted-foreground">{body}</span>
      </div>
    </div>
  );
}

function Wire({ label, delay }: { label: string; delay: string }) {
  return (
    <div className="relative ml-[1.875rem] flex h-10 items-center">
      <span className="absolute inset-y-0 left-0 w-px bg-border" aria-hidden />
      <span className="wire-dot absolute -left-[2.5px] size-1.5 rounded-full bg-accent-fill" style={{ animationDelay: delay }} aria-hidden />
      <span className="pl-4 font-mono text-10 uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

const tile = "grid size-9 place-items-center rounded-lg border border-border bg-background";

// Who talks to whom: the chat app, your Worker, Sign in with One, and each
// person's own accounts at the end of it.
function Diagram() {
  return (
    <div className="squircle flex h-full flex-col rounded-xl border border-border bg-card/50 p-4 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3 font-mono text-11 uppercase tracking-wide text-muted-foreground">
        <span>What you run</span>
        <span className="text-accent-fg">Live on your domain</span>
      </div>
      <div className="flex flex-1 flex-col justify-center">
      <Node
        icon={
          <span className="flex -space-x-1.5">
            <span className={tile}>
              <ClaudeMark className="size-4" />
            </span>
            <span className={tile}>
              <ChatGptMark className="size-4 text-foreground" />
            </span>
          </span>
        }
        title="Claude or ChatGPT"
        body={`Adds ${HOST}/mcp and registers itself.`}
      />
      <Wire label="OAuth, DCR and PKCE" delay="0s" />
      <Node
        accent
        icon={<span className="grid size-9 place-items-center rounded-lg bg-accent-fill font-serif text-17 text-accent-ink">A</span>}
        title={<span className="font-mono">{HOST}</span>}
        body="Your MCP. One Cloudflare Worker, your brand."
      />
      <Wire label="Hands off to" delay="0.6s" />
      <Node
        icon={
          <span className={tile}>
            <KeyRound className="size-4 text-accent-fg" strokeWidth={1.75} />
          </span>
        }
        title="Sign in with One"
        body="Each person picks their accounts and how far."
      />
      <Wire label="Every call on their grant" delay="1.2s" />
      <Node
        icon={
          <span className="flex -space-x-1.5">
            {["gmail", "google-calendar", "stripe", "github"].map((p) => (
              <span key={p} className={clsx(tile, "size-8")}>
                <PlatformLogo platform={p} className="size-3.5" />
              </span>
            ))}
          </span>
        }
        title="Their own accounts"
        body={`Any of the ${count.platforms} apps in One's catalog.`}
      />
      </div>
      <p className="mt-5 border-t border-border pt-4 text-11 text-muted-foreground">
        mcp.acme.com stands in for your host. A workers.dev URL works too.
      </p>
    </div>
  );
}

const CELLS = [
  { icon: Globe, title: "Your domain, your brand", body: "Fork it, swap the name and marks, put it on your own domain. The code is MIT." },
  { icon: Users, title: "Each user, their own accounts", body: `Sign in with One is the login. Every person connects their own tools, from the ${count.platforms} apps in One's catalog.` },
  { icon: Server, title: "One Worker, its own OAuth", body: "The MCP endpoint, an OAuth server with dynamic client registration and PKCE, and the website. Claude and ChatGPT add it directly." },
  { icon: Blocks, title: "A start for any MCP", body: "Keep the UI tools or swap them. Add your own in src/tools.ts, each one called on the person's grant." },
];

export function RunYourOwn() {
  const [head, headShown] = useReveal<HTMLDivElement>(0.3);
  const [body, bodyShown] = useReveal<HTMLDivElement>(0.1);
  return (
    <section id={RUN_ANCHOR} className="relative scroll-mt-24 overflow-hidden px-6 py-24 sm:py-36">
      <div className="glow-accent pointer-events-none absolute left-1/2 top-10 h-[36rem] w-[min(70rem,140vw)] -translate-x-1/2 opacity-70" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-px max-w-5xl bg-gradient-to-r from-transparent via-foreground/20 to-transparent" aria-hidden />

      <div ref={head} className={clsx("t-stagger relative mx-auto max-w-3xl text-center", headShown && "is-shown")}>
        <div className="t-stagger-line t-stagger-line--1 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 py-1 pl-2 pr-3 text-11 text-muted-foreground backdrop-blur">
            <span className="live-dot size-1.5 rounded-full bg-accent-fill" aria-hidden />
            <span className="font-medium text-foreground">Open source</span>
            <span>The code behind blocks.forkable.dev</span>
          </span>
        </div>
        <h2 className="t-stagger-line t-stagger-line--2 text-gradient-headline mt-6 pb-2 font-serif text-56 tracking-tight text-balance sm:text-80">
          {RUN_HEADLINE}
        </h2>
        <p className="t-stagger-line t-stagger-line--3 mx-auto mt-6 max-w-xl text-17 text-muted-foreground">
          Fork it and you have an MCP server on your own domain, under your own brand, with Sign in with One as its
          login.{" "}
          <span className="text-foreground">Every tool call runs on that person's own accounts, not a shared key.</span>
        </p>
        <div className="t-stagger-line t-stagger-line--4 mt-10 flex flex-col items-center justify-center gap-1 sm:flex-row">
          <a
            href={CODE}
            className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-13 font-medium text-background transition-[box-shadow,transform] duration-300 hover:shadow-[0_0_0_4px_var(--accent-glow),0_0_40px_var(--accent-glow)] active:scale-[0.98]"
          >
            <Github className="size-4" strokeWidth={1.75} />
            Get the code
          </a>
          <LearnMore href={SETUP}>Read the setup</LearnMore>
        </div>
      </div>

      <div ref={body} className={clsx("t-stagger relative mx-auto mt-16 max-w-6xl sm:mt-20", bodyShown && "is-shown")}>
        <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="t-stagger-line t-stagger-line--1 min-w-0">
            <SetupCard />
          </div>
          <div className="t-stagger-line t-stagger-line--2 min-w-0">
            <Diagram />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CELLS.map((c, i) => (
            <div key={c.title} className={`t-stagger-line t-stagger-line--${Math.min(i + 2, 4)} squircle flex flex-col gap-1.5 rounded-xl border border-border bg-card/50 p-5`}>
              <c.icon className="size-4 text-accent-fg" strokeWidth={1.75} />
              <h3 className="mt-2 text-15 font-medium">{c.title}</h3>
              <p className="text-13 text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
