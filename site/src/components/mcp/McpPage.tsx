import { useState, type ReactNode } from "react";
import { CopyButton } from "./CopyButton";
import { RunYourOwn, RUN_ANCHOR } from "./RunYourOwn";
import clsx from "clsx";
import { BookmarkCheck, Check, MousePointerClick, PlugZap, Sparkles } from "lucide-react";
import { Header } from "../Header";
import { Footer } from "../Footer";
import { SectionHead } from "../SectionHead";
import { LearnMore } from "../LearnMore";
import { Horizon } from "../art/Horizon";
import { DotFloor } from "../art/DotFloor";
import { ChatReplay } from "./ChatReplay";
import { PlatformLogo } from "./logos";
import { FLOWS } from "../../flows";
import { useReveal, useScrollVars } from "../../lib/hooks";
import count from "../../generated/platform-count.json";
import blocksDark from "../../assets/mcp/dark/blocks.webp";
import blocksLight from "../../assets/mcp/light/blocks.webp";
import uiDark from "../../assets/mcp/dark/ui.webp";
import uiLight from "../../assets/mcp/light/ui.webp";
import { ConfirmSheet } from "./ConfirmSheet";

// Working headline; the name of this page is not locked yet. The hero reads
// it from here. mcp/index.html and agent/mcp.md carry it as plain text, so
// change those too (both are marked with MCP_HEADLINE).
export const MCP_HEADLINE = "Apps inside your chat";
export const MCP_URL = "https://blocks.forkable.dev/mcp";
const CODE = "https://github.com/withoneai/forkable/tree/main/mcp";

function ConnectorUrl() {
  return (
    <CopyButton
      text={MCP_URL}
      label="Copy the connector URL"
      className="max-w-full rounded-full border border-border bg-card/80 px-5 py-3 font-mono text-13 text-foreground backdrop-blur-xl hover:border-foreground/20"
    >
      <span className="truncate">{MCP_URL}</span>
    </CopyButton>
  );
}

function Hero() {
  const [ref, shown] = useReveal<HTMLDivElement>(0);
  const stage = useScrollVars<HTMLDivElement>(0.35);
  return (
    <section id="top" className="relative overflow-hidden pt-36">
      <div ref={ref} className={clsx("t-stagger relative mx-auto max-w-4xl px-6 text-center", shown && "is-shown")}>
        <div className="t-stagger-line t-stagger-line--1 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 py-1 pl-2 pr-3 text-11 text-muted-foreground backdrop-blur">
            <span className="live-dot size-1.5 rounded-full bg-accent-fill" aria-hidden />
            <span className="font-medium text-foreground">A connector for Claude and ChatGPT</span>
          </span>
        </div>
        <h1 className="t-stagger-line t-stagger-line--2 text-gradient-headline mt-6 pb-2 font-serif text-56 tracking-tight text-balance sm:text-80">
          {MCP_HEADLINE}
        </h1>
        <p className="t-stagger-line t-stagger-line--3 mx-auto mt-6 max-w-lg text-17 text-muted-foreground">
          Ask your chat for an app. It builds it right there, on your own accounts.{" "}
          <span className="text-foreground">Then it keeps it, so you can open it again tomorrow.</span>
        </p>
        <div className="t-stagger-line t-stagger-line--4 mt-12 flex flex-col items-center gap-3">
          <ConnectorUrl />
          <p className="text-11 text-muted-foreground">Add it as a custom connector. That is the whole setup.</p>
          <div className="mt-2 flex flex-col items-center gap-2 sm:flex-row">
            <a
              href="#flows"
              className="rounded-full bg-foreground px-6 py-3 text-13 font-medium text-background transition-[box-shadow,transform] duration-300 hover:shadow-[0_0_0_4px_var(--accent-glow),0_0_40px_var(--accent-glow)] active:scale-[0.98]"
            >
              See six apps to ask for
            </a>
            <a
              href={`#${RUN_ANCHOR}`}
              className="rounded-full border border-border bg-card/60 px-6 py-3 text-13 font-medium text-foreground backdrop-blur transition-colors hover:border-foreground/30"
            >
              Run your own MCP
            </a>
            <LearnMore href="#how">How to add it</LearnMore>
          </div>
        </div>
      </div>

      <div ref={stage} className="stage relative mt-24 pb-24 sm:pb-36">
        <Horizon />
        <div className="relative mx-auto max-w-3xl px-4 sm:px-6">
          <div className="stage-tilt">
            <ChatReplay flow={FLOWS[0]!} bodyClassName="h-[34rem] sm:h-[38rem]" />
          </div>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Add one URL",
    body: (
      <>
        In Claude or ChatGPT, add <span className="font-mono text-foreground">blocks.forkable.dev/mcp</span> as a custom connector. Sign in with One and pick the accounts it may use.
      </>
    ),
  },
  { n: "02", title: "Ask for a screen", body: "Say what you want to see. The agent finds the actions on your accounts, writes the UI and runs it in the chat." },
  { n: "03", title: "Keep it", body: "Every UI is saved with its versions. Open it again in either chat app, or on the web at blocks.forkable.dev." },
];

function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const [ref, shown] = useReveal<HTMLDivElement>(0.1);
  return (
    <div ref={ref} className={clsx("t-stagger", shown && "is-shown", className)}>
      {children}
    </div>
  );
}

function How() {
  return (
    <section id="how" className="relative scroll-mt-24 px-6 py-24">
      <SectionHead index="01" label="How it works" title="One URL, then just ask">
        To use ours, there is no repo, no terminal and no deploy. It works in the chat app you already use.
      </SectionHead>
      <Reveal className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-3 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <div key={s.n} className={`t-stagger-line t-stagger-line--${i + 1} squircle flex flex-col gap-1.5 rounded-xl border border-border bg-card/50 p-6`}>
            <span className="font-mono text-11 text-muted-foreground">{s.n}</span>
            <h3 className="mt-2 text-15 font-medium">{s.title}</h3>
            <p className="text-13 text-muted-foreground">{s.body}</p>
          </div>
        ))}
      </Reveal>
    </section>
  );
}

function FlowCard({ flow, selected, onSelect }: { flow: (typeof FLOWS)[number]; selected: boolean; onSelect: () => void }) {
  return (
    <div
      className={clsx(
        "squircle relative flex w-[17rem] shrink-0 snap-start flex-col gap-3 rounded-xl border p-4 transition-colors lg:w-auto",
        selected ? "border-foreground/30 bg-card" : "border-border bg-card/30 hover:bg-card/60",
      )}
    >
      <button type="button" role="tab" aria-selected={selected} onClick={onSelect} className="flex flex-col gap-1.5 text-left after:absolute after:inset-0 after:content-['']">
        <span className="flex items-center gap-2">
          <span className={clsx("size-1.5 shrink-0 rounded-full transition-colors", selected ? "bg-accent-fill" : "bg-border")} aria-hidden />
          <span className="text-15 font-medium">{flow.name}</span>
        </span>
        <span className="line-clamp-2 text-13 text-muted-foreground">{flow.description}</span>
      </button>
      <div className="relative z-10 flex items-center gap-1.5">
        {flow.platforms.map((p) => (
          <span key={p} className="grid size-6 place-items-center rounded-md border border-border bg-background">
            <PlatformLogo platform={p} className="size-3.5" />
          </span>
        ))}
        <span className="flex-1" />
        <CopyButton text={flow.prompt} label={`Copy the prompt for ${flow.name}`} className="rounded-md px-2 py-1 text-11 text-muted-foreground hover:text-foreground">
          Try this prompt
        </CopyButton>
      </div>
    </div>
  );
}

function Flows() {
  const [sel, setSel] = useState(1);
  const flow = FLOWS[sel]!;
  return (
    <section id="flows" className="relative scroll-mt-24 px-6 py-24">
      <SectionHead index="02" label="Flows" title="Six apps worth asking for">
        Each one starts as a single prompt. What renders below is the real code the agent writes, running here on the Acme Inc sample.
      </SectionHead>

      <Reveal className="mx-auto mt-12 max-w-6xl">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div role="tablist" aria-label="Flows" className="t-stagger-line t-stagger-line--1 -mx-6 flex snap-x gap-3 overflow-x-auto px-6 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
            {FLOWS.map((f, i) => (
              <FlowCard key={f.id} flow={f} selected={i === sel} onSelect={() => setSel(i)} />
            ))}
          </div>
          <div className="t-stagger-line t-stagger-line--2 flex min-w-0 flex-col gap-3">
            <ChatReplay flow={flow} bodyClassName="h-[36rem] sm:h-[42rem]" />
            <div className="squircle flex flex-col gap-3 rounded-xl border border-border bg-card/50 p-4 sm:flex-row sm:items-start">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="font-mono text-11 uppercase tracking-wide text-muted-foreground">Try this prompt</span>
                <p className="text-13 text-foreground">{flow.prompt}</p>
              </div>
              <CopyButton text={flow.prompt} label="Copy this prompt" className="shrink-0 self-start rounded-full border border-border px-3 py-1.5 text-11 text-foreground hover:border-foreground/30">
                Copy
              </CopyButton>
            </div>
            <p className="px-1 text-11 text-muted-foreground">
              Source: <a className="underline decoration-border underline-offset-2 hover:text-foreground" href={`https://github.com/withoneai/forkable/blob/main/site/src/flows/${flow.id}.tsx`}>site/src/flows/{flow.id}.tsx</a>, one TSX file on the kit the MCP gives every UI.
            </p>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

const SHOTS: { title: string; body: string; dark?: string; light?: string }[] = [
  { title: "Your blocks", body: "Every UI you asked for, in one list at blocks.forkable.dev.", dark: blocksDark, light: blocksLight },
  { title: "Open it anywhere", body: "On the web or in the other chat app, live on your accounts, any version.", dark: uiDark, light: uiLight },
  { title: "Writes ask first", body: "A send or a change stops at the connector's Confirm, outside the generated UI. The UI itself cannot press it." },
];

// The connector's Confirm on the Acme Inc sample: Follow-up radar nudging
// Leo at Vandelay, as the flow above asks for it. Static, for the picture.
function ConfirmPreview() {
  return (
    <div className="relative mx-auto flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-background" aria-label="The connector's Confirm before a Gmail send">
      <div className="flex flex-col gap-2 p-3 opacity-60" aria-hidden>
        <div className="rounded-md border-2 border-dashed border-foreground/30 p-2.5">
          <div className="flex items-center justify-between text-11 text-muted-foreground">
            <span>Follow-up radar</span>
            <span>Generated UI, paused</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-13">
            <span className="size-5 rounded-full bg-foreground/10" />
            <span className="truncate">Pricing for the Vandelay rollout</span>
            <span className="ml-auto text-11 text-muted-foreground">4d</span>
          </div>
        </div>
      </div>
      <ConfirmSheet
        interactive={false}
        className="mx-2"
        c={{
          headline: "Send with Gmail: Send Email",
          platform: "gmail",
          fields: [
            { label: "To", value: "leo@vandelay.com" },
            { label: "Subject", value: "Pricing for the Vandelay rollout" },
          ],
          resolve: () => {},
        }}
      />
    </div>
  );
}

function Shot({ dark, light, alt, className }: { dark: string; light: string; alt: string; className?: string }) {
  return (
    <div className={clsx("overflow-hidden rounded-lg border border-border bg-background", className)}>
      <img src={dark} alt={alt} loading="lazy" decoding="async" className="hidden w-full dark:block" />
      <img src={light} alt={alt} loading="lazy" decoding="async" className="block w-full dark:hidden" />
    </div>
  );
}

function Saved() {
  return (
    <section id="saved" className="relative scroll-mt-24 px-6 py-24">
      <SectionHead index="03" label="Saved" title="It lives past the chat">
        A chat answer usually scrolls away. These stay. Each one is saved with its versions and opens again wherever you are.
      </SectionHead>
      <Reveal className="mx-auto mt-12 grid max-w-6xl grid-cols-1 gap-3 lg:grid-cols-[3fr_2fr]">
        <div className="t-stagger-line t-stagger-line--1 squircle flex flex-col gap-4 rounded-xl border border-border bg-card/50 p-4 lg:row-span-2">
          <Shot dark={SHOTS[0]!.dark!} light={SHOTS[0]!.light!} alt="blocks.forkable.dev, the list of saved UIs" />
          <div className="flex flex-col gap-1.5 px-1">
            <h3 className="text-15 font-medium">{SHOTS[0]!.title}</h3>
            <p className="text-13 text-muted-foreground">{SHOTS[0]!.body}</p>
          </div>
          <Shot dark={SHOTS[1]!.dark!} light={SHOTS[1]!.light!} alt="A saved UI open on the web with its version picker" />
          <div className="flex flex-col gap-1.5 px-1">
            <h3 className="text-15 font-medium">{SHOTS[1]!.title}</h3>
            <p className="text-13 text-muted-foreground">{SHOTS[1]!.body}</p>
          </div>
        </div>
        <div className="t-stagger-line t-stagger-line--2 squircle flex flex-col gap-4 rounded-xl border border-border bg-card/50 p-4">
          <ConfirmPreview />
          <div className="flex flex-col gap-1.5 px-1">
            <h3 className="text-15 font-medium">{SHOTS[2]!.title}</h3>
            <p className="text-13 text-muted-foreground">{SHOTS[2]!.body}</p>
          </div>
        </div>
        <div className="t-stagger-line t-stagger-line--3 squircle flex flex-col justify-between gap-4 rounded-xl border border-border bg-card/50 p-6">
          <div className="flex flex-col gap-1.5">
            <h3 className="text-15 font-medium">Open your blocks</h3>
            <p className="text-13 text-muted-foreground">Sign in with One on the web to see, rename or delete everything you made.</p>
          </div>
          <LearnMore href="https://blocks.forkable.dev">blocks.forkable.dev</LearnMore>
        </div>
      </Reveal>
    </section>
  );
}

const WHY = [
  { icon: PlugZap, title: "Nothing to install", body: "One URL in the chat app people already use. No repo, no terminal, no deploy." },
  { icon: Sparkles, title: "Your accounts, not a demo", body: `Gmail, Calendar, Stripe, GitHub, any of the ${count.platforms} apps in One's catalog, each signed in by you.` },
  { icon: MousePointerClick, title: "Made to fit the ask", body: "Not a fixed widget. The agent writes the exact screen you asked for on a shared kit, so it still looks designed." },
  { icon: BookmarkCheck, title: "Yours after the chat", body: "Saved, versioned and reopened anywhere. A chat answer becomes a small app you keep." },
];

function Why() {
  return (
    <section id="why" className="relative scroll-mt-24 px-6 py-24">
      <SectionHead index="04" label="Why it's different" title="Software on request">
        A chat that answers with a working screen, wired to the tools you already use.
      </SectionHead>
      <Reveal className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2">
        {WHY.map((w, i) => (
          <div key={w.title} className={`t-stagger-line t-stagger-line--${i + 1} squircle flex flex-col gap-1.5 rounded-xl border border-border bg-card/50 p-6`}>
            <w.icon className="size-4 text-accent-fg" strokeWidth={1.75} />
            <h3 className="mt-2 text-15 font-medium">{w.title}</h3>
            <p className="text-13 text-muted-foreground">{w.body}</p>
          </div>
        ))}
        <p className="t-stagger-line t-stagger-line--4 flex items-start gap-2 text-13 text-muted-foreground sm:col-span-2 sm:justify-center">
          <Check className="mt-0.5 size-3.5 shrink-0 text-accent-fg" strokeWidth={2.5} />
          <span>
            The screen runs in a sandbox inside the connector's frame. A write stops at the frame's own Confirm, and only that exact request runs, once.
          </span>
        </p>
      </Reveal>
    </section>
  );
}

const TOOLS: [string, string][] = [
  ["list_connections", "what you connected"],
  ["find_actions", "search the catalog"],
  ["action_docs", "read one action"],
  ["ui_guide", "the kit and its rules"],
  ["render_ui", "write and run a screen"],
  ["update_ui", "save a new version"],
  ["list_my_uis", "your saved screens"],
  ["show_ui", "open one again"],
  ["rename_ui", "name it"],
  ["delete_ui", "remove it"],
  ["run_action", "the screen calls your tools"],
];

function Tools() {
  return (
    <section id="tools" className="relative scroll-mt-24 px-6 py-24">
      <SectionHead index="05" label="Under the hood" title={`${TOOLS.length} tools, one kit`}>
        The agent sees these tools. The screens it writes import one small React kit, so every UI looks right in light and dark.
      </SectionHead>
      <Reveal className="mx-auto mt-12 flex max-w-4xl flex-col items-center gap-6">
        <ul className="t-stagger-line t-stagger-line--1 flex flex-wrap justify-center gap-2">
          {TOOLS.map(([name, what]) => (
            <li key={name} className="squircle inline-flex items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2">
              <code className="font-mono text-13 text-foreground">{name}</code>
              <span className="text-11 text-muted-foreground">{what}</span>
            </li>
          ))}
        </ul>
        <p className="t-stagger-line t-stagger-line--2 flex items-center gap-2 text-13 text-muted-foreground">
          <Check className="size-3.5 shrink-0 text-accent-fg" strokeWidth={2.5} />
          Secured by One. You connect your own accounts and can revoke them any time.
        </p>
        <div className="t-stagger-line t-stagger-line--3">
          <LearnMore href={CODE}>Read the MCP code on GitHub</LearnMore>
        </div>
      </Reveal>
    </section>
  );
}

function Closing() {
  const [ref, shown] = useReveal<HTMLDivElement>(0.3);
  return (
    <section id="more" className="relative overflow-hidden pb-24 pt-24 sm:pt-36">
      <DotFloor />
      <div ref={ref} className={clsx("t-stagger relative mx-auto max-w-3xl px-6 text-center", shown && "is-shown")}>
        <h2 className="t-stagger-line t-stagger-line--1 text-gradient-headline pb-2 font-serif text-56 tracking-tight text-balance sm:text-80">
          Add it to your chat
        </h2>
        <p className="t-stagger-line t-stagger-line--2 mx-auto mt-6 max-w-md text-15 text-muted-foreground">
          Paste the URL, sign in with One, ask for your first screen. Want the whole app in your own repo instead? Fork the business it came from.
        </p>
        <div className="t-stagger-line t-stagger-line--3 mt-12 flex flex-col items-center gap-4">
          <ConnectorUrl />
          <div className="flex flex-col items-center gap-1 sm:flex-row">
            <a
              href="/"
              className="rounded-full bg-foreground px-6 py-3 text-13 font-medium text-background transition-[box-shadow,transform] duration-300 hover:shadow-[0_0_0_4px_var(--accent-glow),0_0_40px_var(--accent-glow)] active:scale-[0.98]"
            >
              Fork the whole business
            </a>
            <LearnMore href={CODE}>Run your own MCP</LearnMore>
          </div>
        </div>
      </div>
      <div className="h-72 sm:h-96" aria-hidden />
    </section>
  );
}

export function McpPage() {
  return (
    <div className="grain min-h-full overflow-x-clip bg-background">
      <Header home={false} current="/mcp" />
      <main>
        <Hero />
        <RunYourOwn />
        <How />
        <Flows />
        <Saved />
        <Why />
        <Tools />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}
