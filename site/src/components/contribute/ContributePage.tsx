import { useState, type ReactNode } from "react";
import { ArrowUpRight, Check, Copy, GitPullRequest } from "lucide-react";
import clsx from "clsx";
import { Header } from "../Header";
import { Footer } from "../Footer";
import { SectionHead } from "../SectionHead";
import { Terminal } from "../Terminal";
import { LearnMore } from "../LearnMore";
import { useReveal } from "../../lib/hooks";

const REPO = "https://github.com/withoneai/forkable";
const GUIDE = `${REPO}/blob/main/CONTRIBUTING.md`;

// A multi-line command block with a copy button. Lines starting with # are
// comments and stay muted.
function Code({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copyable = code
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#") && !l.trimStart().startsWith("//"))
    .join("\n")
    .trim();
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background/60">
      {label && (
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="font-mono text-11 text-muted-foreground">{label}</span>
        </div>
      )}
      <div className="group relative">
        <pre className="overflow-x-auto p-3 pr-10 font-mono text-13 leading-relaxed">
          {code.split("\n").map((line, i) => (
            <div
              key={i}
              className={
                line.trimStart().startsWith("#") || line.trimStart().startsWith("//")
                  ? "text-muted-foreground"
                  : "text-foreground"
              }
            >
              {line || " "}
            </div>
          ))}
        </pre>
        <button
          type="button"
          aria-label="Copy"
          onClick={() => {
            navigator.clipboard.writeText(copyable).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="absolute right-2 top-2 grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="t-icon-swap" data-state={copied ? "b" : "a"}>
            <span className="t-icon" data-icon="a">
              <Copy className="size-3.5" strokeWidth={2} />
            </span>
            <span className="t-icon" data-icon="b">
              <Check className="size-3.5 text-accent-fg" strokeWidth={2.5} />
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

function Card({ title, body, children, className }: { title: string; body?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex flex-col rounded-xl border border-border bg-card/50 p-6", className)}>
      <h3 className="text-15 font-medium">{title}</h3>
      {body && <p className="mt-1.5 max-w-md text-13 text-muted-foreground">{body}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const [ref, shown] = useReveal<HTMLDivElement>(0.1);
  return (
    <div ref={ref} className={clsx("t-stagger mx-auto mt-12 max-w-6xl", shown && "is-shown", className)}>
      {children}
    </div>
  );
}

function Hero() {
  const [ref, shown] = useReveal<HTMLDivElement>(0);
  return (
    <section id="top" className="relative px-6 pb-12 pt-36">
      <div ref={ref} className={clsx("t-stagger mx-auto max-w-3xl text-center", shown && "is-shown")}>
        <div className="t-stagger-line t-stagger-line--1 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 py-1 pl-2 pr-3 text-11 text-muted-foreground backdrop-blur">
            <span className="live-dot size-1.5 rounded-full bg-accent-fill" aria-hidden />
            <span className="font-medium text-foreground">Contribute</span>
            <span className="h-3 w-px bg-border" aria-hidden />
            MIT licensed
          </span>
        </div>
        <h1 className="t-stagger-line t-stagger-line--2 text-gradient-headline mt-6 pb-2 font-serif text-56 tracking-tight sm:text-80">
          Build the business,
          <br />
          skip the plumbing
        </h1>
        <p className="t-stagger-line t-stagger-line--3 mx-auto mt-6 max-w-lg text-17 text-muted-foreground">
          Every template starts from one starter with sign-in, user consent and integrations already wired.{" "}
          <span className="text-foreground">Build a business on it, then publish it for anyone to fork.</span>
        </p>
        <div className="t-stagger-line t-stagger-line--4 mt-12 flex flex-col items-center gap-3">
          <Terminal command="npm create forkable@latest my-business" />
          <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row">
            <a
              href={GUIDE}
              className="rounded-full bg-foreground px-6 py-3 text-13 font-medium text-background transition-[box-shadow,transform] duration-300 hover:shadow-[0_0_0_4px_var(--accent-glow),0_0_40px_var(--accent-glow)] active:scale-[0.98]"
            >
              Read the contributing guide
            </a>
            <LearnMore href="#agent">Set up your agent first</LearnMore>
          </div>
        </div>
      </div>
    </section>
  );
}

const DONE = [
  { title: "Sign in with One", body: "The authorize and callback routes, PKCE, state and the code exchange.", where: "src/connect.ts" },
  { title: "Each user's own grant", body: "Every call runs on the signed-in user's Connect grant. No shared admin key.", where: "runAction" },
  { title: "The consent ask", body: "Each action, its access level and the line your user reads before they agree.", where: "connect.manifest.json" },
  { title: "A demo with no keys", body: "Runs on the Acme Inc sample with no account and exits 0.", where: "npm start" },
  { title: "Grant enforcement", body: "A call outside the user's grant is refused with a 403 before the provider sees it.", where: "403" },
  { title: "Notes for your agent", body: "AGENTS.md, build skills, a runtime agent to copy and a go-to-market kit.", where: "AGENTS.md" },
];

function StarterSection() {
  return (
    <section id="starter" className="relative px-6 py-24">
      <SectionHead index="01" label="Start" title="Auth comes done">
        <code className="font-mono text-foreground">npm create forkable@latest</code> copies the starter, installs it
        and runs the demo. Here is what is already handled before you write a line.
      </SectionHead>
      <Reveal>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DONE.map((d, i) => (
            <div key={d.title} className={`t-stagger-line t-stagger-line--${Math.min(i + 1, 4)} rounded-xl border border-border bg-card/50 p-4`}>
              <div className="flex items-center gap-2">
                <Check className="size-3.5 shrink-0 text-accent-fg" strokeWidth={2.5} />
                <h3 className="text-15 font-medium">{d.title}</h3>
              </div>
              <p className="mt-1.5 text-13 text-muted-foreground">{d.body}</p>
              <span className="mt-3 inline-block rounded-sm border border-border px-1.5 py-0.5 font-mono text-11 text-muted-foreground">
                {d.where}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card title="Try it now" body="No account and no keys. It installs and runs the demo on the Acme Inc sample.">
            <Code
              code={`npm create forkable@latest my-business -- \\
  --for "dental clinics" --in "Madrid"`}
            />
          </Card>
          <Card
            title="Go live with real sign-in"
            body={
              <>
                Make one Connect app in the One dashboard (Developers, Connect, New app). Set its values in your
                environment, then run <code className="font-mono text-foreground">npm run dev</code>. Never commit them.
              </>
            }
          >
            <Code code={`ONE_CLIENT_ID\nONE_CLIENT_SECRET\nONE_CONNECT_KEY\nONE_REDIRECT_URI`} label="environment" />
          </Card>
        </div>
      </Reveal>
    </section>
  );
}

const AGENTS = [
  {
    id: "cli",
    label: "One CLI",
    body: (
      <>
        Install it once, globally. <code className="font-mono text-foreground">one init</code> signs you in and
        installs the One skill into Claude Code, Claude Desktop and Codex, or Cursor, Windsurf, Kiro and others if
        you pick them. Works with any agent that can run a shell.
      </>
    ),
    code: `npm install -g @withone/cli\none init\n# then tell your agent:\n# Please run "one onboard"`,
    label2: "terminal",
  },
  {
    id: "claude",
    label: "MCP: Claude Code",
    body: "Adds One's hosted MCP server. A browser opens so you can sign in and choose what Claude Code can reach.",
    code: `claude mcp add --transport http one https://mcp.withone.ai/mcp`,
    label2: "terminal",
  },
  {
    id: "codex",
    label: "MCP: Codex",
    body: (
      <>
        Add the server to <code className="font-mono text-foreground">~/.codex/config.toml</code>, then sign in.
      </>
    ),
    code: `[mcp_servers.one]\nurl = "https://mcp.withone.ai/mcp"\n\n# then: codex mcp login one`,
    label2: "~/.codex/config.toml",
  },
  {
    id: "cursor",
    label: "MCP: Cursor and others",
    body: (
      <>
        Any MCP client that takes a config file. In Cursor that is{" "}
        <code className="font-mono text-foreground">~/.cursor/mcp.json</code>.
      </>
    ),
    code: `{\n  "mcpServers": {\n    "one": {\n      "type": "http",\n      "url": "https://mcp.withone.ai/mcp"\n    }\n  }\n}`,
    label2: "mcp.json",
  },
] as const;

const LOOP = [
  { n: "1", cmd: 'one actions find <platform> "<intent>"', body: "Finds the exact action, with its docs." },
  { n: "2", cmd: "one actions load <actionId>", body: "Reads any part of the docs it still needs." },
  { n: "3", cmd: "connect.manifest.json", body: "Adds the action with the narrowest access and a reason your user reads." },
  { n: "4", cmd: "oneConnect.runAction(...)", body: "Calls it on the user's grant. Never a hand-built request." },
];

function AgentSection() {
  const [tab, setTab] = useState<(typeof AGENTS)[number]["id"]>("cli");
  const active = AGENTS.find((a) => a.id === tab)!;
  return (
    <section id="agent" className="relative px-6 py-24">
      <SectionHead index="02" label="Your agent" title="Give your agent every integration">
        Install the One CLI globally, or add One's MCP server if you'd rather not install anything. Either one
        connects your coding agent to One's knowledge base of thousands of integrations, so it writes each one
        correctly the first time.
      </SectionHead>
      <Reveal>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[3fr_2fr]">
          <div className="t-stagger-line t-stagger-line--1 flex flex-col rounded-xl border border-border bg-card/50 p-6">
            <div role="tablist" className="flex flex-wrap gap-1">
              {AGENTS.map((a) => (
                <button
                  key={a.id}
                  role="tab"
                  type="button"
                  aria-selected={tab === a.id}
                  onClick={() => setTab(a.id)}
                  className={clsx(
                    "rounded-full px-3 py-1.5 text-13 transition-colors",
                    tab === a.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <p className="mt-4 max-w-md text-13 text-muted-foreground">{active.body}</p>
            <div className="mt-4">
              <Code code={active.code} label={active.label2} />
            </div>
            <p className="mt-4 text-13 text-muted-foreground">
              Only want docs and code, never a live call? Turn on{" "}
              <span className="text-foreground">Knowledge only mode</span> on the sign-in screen.
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              <LearnMore href="https://withone.ai/docs/cli">CLI docs</LearnMore>
              <LearnMore href="https://withone.ai/docs/mcp">MCP docs</LearnMore>
            </div>
          </div>
          <div className="t-stagger-line t-stagger-line--2 flex flex-col rounded-xl border border-border bg-card/50 p-6">
            <h3 className="text-15 font-medium">How your agent adds a tool</h3>
            <p className="mt-1.5 text-13 text-muted-foreground">
              The starter's add-integration skill, which your agent follows on its own.
            </p>
            <ol className="mt-4 flex flex-col gap-3">
              {LOOP.map((s) => (
                <li key={s.n} className="flex gap-3">
                  <span className="font-mono text-11 leading-5 text-muted-foreground">{s.n}</span>
                  <div className="min-w-0">
                    <code className="block break-all font-mono text-13 text-foreground">{s.cmd}</code>
                    <p className="mt-0.5 text-13 text-muted-foreground">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

const CHECKLIST = [
  "npm start runs the demo with no .env and exits 0",
  "npm run typecheck passes",
  "The manifest matches every runAction call, each with access and a reason",
  "Access is the narrowest that does the job",
  "No secrets, keys or .env anywhere, git history included",
  "Sample data is Acme Inc only",
  "AGENTS.md, agents/, gtm/positioning.md and forkable.json describe this business",
  "MIT, with a LICENSE file",
];

const SEND = [
  { n: "1", title: "Fork the repo", body: "withoneai/forkable on GitHub, on a new branch." },
  { n: "2", title: "Add your template", body: "Copy it into create-forkable/templates/<id>. The id is what people type." },
  { n: "3", title: "Fork it once", body: "Run the CLI from your clone and check the copy works on its own." },
  { n: "4", title: "Open a pull request", body: "The PR template has the checklist. Add who it is for, its tools and a screenshot." },
];

function PublishSection() {
  return (
    <section id="publish" className="relative px-6 py-24">
      <SectionHead index="03" label="Publish" title="Send it as a template">
        Templates ship in <code className="font-mono text-foreground">create-forkable</code>, so anyone can fork yours
        by name. A maintainer reviews each pull request against the same checklist.
      </SectionHead>
      <Reveal>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SEND.map((s, i) => (
            <div key={s.n} className={`t-stagger-line t-stagger-line--${i + 1} rounded-xl border border-border bg-card/50 p-4`}>
              <span className="font-mono text-11 text-muted-foreground">{s.n}</span>
              <h3 className="mt-1 text-15 font-medium">{s.title}</h3>
              <p className="mt-1 text-13 text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[3fr_2fr]">
          <Card title="The checklist" body={<>forkable check will run this for you. Until it ships, run it by hand.</>}>
            <ul className="flex flex-col gap-2">
              {CHECKLIST.map((c) => (
                <li key={c} className="flex items-start gap-2 text-13 text-muted-foreground">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-foreground" strokeWidth={2.5} />
                  {c}
                </li>
              ))}
            </ul>
          </Card>
          <div className="flex flex-col gap-3">
            <Card title="Check the fork from your clone">
              <Code code={`cd /tmp\nnode ~/forkable/create-forkable/bin/create-forkable.mjs \\\n  try-it --template <id>`} />
            </Card>
            <Card title="Not sure yet?" body="Open a Template idea issue first. Say what it does, who it is for and what it never does.">
              <a
                href={`${REPO}/issues/new?template=template-idea.md`}
                className="group inline-flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-13 transition-colors hover:border-foreground/20"
              >
                <GitPullRequest className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
                Propose a template
                <ArrowUpRight className="size-3 text-muted-foreground transition-colors group-hover:text-foreground" strokeWidth={2} />
              </a>
            </Card>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

const OTHER = [
  { title: "Improve the starter", body: "Fixes and small, general additions in starter/ reach every future fork.", href: `${REPO}/tree/main/starter` },
  { title: "Improve the CLI", body: "create-forkable copies, fills in, installs and runs. Make it better at that.", href: `${REPO}/tree/main/create-forkable` },
  { title: "Report a problem", body: "Say what you ran and what you saw. Remove any keys from the output first.", href: `${REPO}/issues/new?template=bug.md` },
];

function OtherSection() {
  return (
    <section id="more" className="relative px-6 pb-24 pt-12 sm:pb-36">
      <SectionHead index="04" label="More" title="Other ways to help" />
      <Reveal>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {OTHER.map((o, i) => (
            <a
              key={o.title}
              href={o.href}
              className={`t-stagger-line t-stagger-line--${i + 1} group flex flex-col rounded-xl border border-border bg-card/50 p-6 transition-colors hover:border-foreground/20`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-15 font-medium">{o.title}</h3>
                <ArrowUpRight className="size-3.5 text-muted-foreground transition-colors group-hover:text-foreground" strokeWidth={2} />
              </div>
              <p className="mt-1.5 text-13 text-muted-foreground">{o.body}</p>
            </a>
          ))}
        </div>
        <div className="mt-6 flex justify-center">
          <LearnMore href={GUIDE}>Read CONTRIBUTING.md on GitHub</LearnMore>
        </div>
      </Reveal>
    </section>
  );
}

export function ContributePage() {
  return (
    <div className="grain min-h-full overflow-x-clip bg-background">
      <Header home={false} />
      <main>
        <Hero />
        <StarterSection />
        <AgentSection />
        <PublishSection />
        <OtherSection />
      </main>
      <Footer />
    </div>
  );
}
