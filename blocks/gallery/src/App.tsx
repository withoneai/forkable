import { CodeBlock, langOf, type CodeLang } from "./CodeBlock";
import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, Github, Moon, Sun } from "lucide-react";
import clsx from "clsx";
import markSvg from "../../brand/forkable-mark-current.svg?raw";
import { BLOCKS, BUSINESS_GROUPS, GROUP_LOGO, GROUP_MARK, NAV, closure, grantOf, previewOf, routesOf, source, type Block } from "./registry";

function useRoute() {
  const read = () => location.hash.replace(/^#\/?/, "") || "introduction";
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      setRoute(read());
      document.getElementById("main")?.scrollTo(0, 0);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function App() {
  const route = useRoute();
  const block = BLOCKS[route];
  return (
    <div className="flex h-screen flex-col">
      <Header />
      <div className="flex min-h-0 flex-1">
        <Sidebar route={route} />
        <main id="main" className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-8 py-10">{block ? <BlockPage block={block} /> : <Introduction />}</div>
        </main>
      </div>
    </div>
  );
}

// Served under forkable.dev/blocks/, the site is one level up. In `pnpm dev`
// (base "/") there is no site next to it, so the links go to forkable.dev.
const SITE = import.meta.env.BASE_URL === "/" ? "https://forkable.dev" : "";
const SITE_LINKS = [
  { label: "Templates", href: `${SITE}/#templates` },
  { label: "Blocks", href: "#/introduction", current: true },
  { label: "In chat", href: `${SITE}/#chat` },
  { label: "MCP", href: "https://blocks.forkable.dev" },
  { label: "Contribute", href: `${SITE}/contribute` },
];

function Header() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("forkable-site-theme", dark ? "dark" : "light");
    } catch {}
  }, [dark]);
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
      <a href={SITE + "/"} className="flex items-center gap-2 text-foreground" aria-label="Forkable home">
        <span className="size-5 text-foreground dark:text-accent [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: markSvg }} />
        <span className="text-13 font-semibold">Forkable</span>
      </a>
      <span className="text-13 text-muted-foreground">/</span>
      <a href="#/introduction" className="text-13 text-muted-foreground hover:text-foreground">
        blocks
      </a>
      <nav className="ml-6 hidden items-center gap-1 lg:flex">
        {SITE_LINKS.map((l) => (
          <a
            key={l.label}
            href={l.href}
            aria-current={l.current ? "page" : undefined}
            className={clsx(
              "rounded-md px-2.5 py-1 text-13 transition-colors",
              l.current ? "bg-foreground/6 font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {l.label}
          </a>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-1">
        <a
          href="https://github.com/withoneai/forkable"
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground"
          aria-label="Forkable on GitHub"
        >
          <Github className="size-4" />
        </a>
        <button onClick={() => setDark((d) => !d)} className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground" aria-label="Toggle theme">
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>
    </header>
  );
}

function Sidebar({ route }: { route: string }) {
  const link = (id: string, label: string) => (
    <a
      key={id}
      href={`#/${id}`}
      className={clsx("flex h-7 items-center rounded-md px-2 text-13", route === id ? "bg-foreground/6 font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
    >
      {label}
    </a>
  );
  return (
    <nav className="hidden w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border p-3 md:flex">
      <div className="flex flex-col gap-0.5">
        <span className="px-2 pb-1 text-11 font-medium text-muted-foreground">Get started</span>
        {link("introduction", "Introduction")}
      </div>
      {NAV.map((g, i) => (
        <div key={g.group} className="flex flex-col gap-0.5">
          {BUSINESS_GROUPS.has(g.group) && !BUSINESS_GROUPS.has(NAV[i - 1]?.group ?? "") && (
            <span className="px-2 pb-2 pt-1 font-mono text-10 uppercase tracking-[0.05em] text-muted-foreground">From Forkable businesses</span>
          )}
          <span className="flex items-center gap-1.5 px-2 pb-1 text-11 font-medium text-muted-foreground">
            {GROUP_MARK[g.group] ? (
              <span className="size-3 text-foreground [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: GROUP_MARK[g.group]! }} />
            ) : (
              GROUP_LOGO[g.group] && <img src={`https://assets.withone.ai/connectors/${GROUP_LOGO[g.group]}.svg`} alt="" className="size-3" />
            )}
            {g.group}
          </span>
          {g.items.map((id) => link(id, BLOCKS[id]?.title.replace(new RegExp(`^${g.group} `), "") ?? id))}
        </div>
      ))}
      <div className="flex flex-col gap-0.5">
        <span className="px-2 pb-1 text-11 font-medium text-muted-foreground">Next</span>
        {["Slack", "Stripe", "Notion"].filter((x) => !NAV.some((g) => g.group === x)).map((x) => (
          <span key={x} className="flex h-7 items-center px-2 text-13 text-muted-foreground/60">
            {x}
          </span>
        ))}
      </div>
    </nav>
  );
}

function CopyLine({ text, prefix = "$" }: { text: string; prefix?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-raised px-3 font-mono text-xs">
      <span className="text-muted-foreground">{prefix}</span>
      <span className="flex-1 truncate text-foreground">{text}</span>
      <button
        onClick={() => {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="text-muted-foreground hover:text-foreground"
        aria-label="Copy"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

function Code({ children, className, lang = "ts", lineNumbers }: { children: string; className?: string; lang?: CodeLang; lineNumbers?: boolean }) {
  return <CodeBlock code={children} lang={lang} lineNumbers={lineNumbers} className={className} />;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-15 font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function BlockPage({ block }: { block: Block }) {
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const files = closure(block.name).filter((b) => b.kind !== "lib").flatMap((b) => b.files);
  const [file, setFile] = useState(0);
  useEffect(() => {
    setTab("preview");
    setFile(0);
  }, [block.name]);
  const grant = grantOf(block.name);
  const routes = routesOf(block.name);
  const Preview = previewOf(block.name);
  const ownFiles = block.files;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-1.5 text-11 text-muted-foreground">
          <span>{block.group ?? "Blocks"}</span>
          <span>/</span>
          <span>{block.title}</span>
        </div>
        <h1 className="text-28 font-semibold tracking-[-0.01em] text-foreground">{block.title}</h1>
        <p className="max-w-2xl text-15 text-muted-foreground">{block.description}</p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-1 border-b border-border">
          {(["preview", "code"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx("-mb-px h-9 border-b-2 px-3 text-13 capitalize", tab === t ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {t}
            </button>
          ))}
          <span className="ml-auto pb-2 text-11 text-muted-foreground">Live, on the real route, with the Acme sample</span>
        </div>
        {tab === "preview" ? (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">{Preview && <Preview />}</div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1">
              {files.map((f, i) => (
                <button key={f.from} onClick={() => setFile(i)} className={clsx("h-7 rounded-md px-2 font-mono text-11", file === i ? "bg-foreground/6 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {f.from.split("/").pop()}
                  <span className="ml-1.5 text-muted-foreground">{f.from.endsWith("route.ts") ? "server" : "ui"}</span>
                </button>
              ))}
            </div>
            <Code className="max-h-[32rem]" lang={langOf(files[file]?.from ?? "")} lineNumbers>{source(files[file]?.from ?? "")}</Code>
          </div>
        )}
      </div>

      <Section title="Add it to your fork">
        <CopyLine text={`npx @withone/forkable add ${block.name}`} />
        <p className="text-13 text-muted-foreground">
          Copies the files into your fork, adds the routes to <code className="font-mono text-xs text-foreground">mountForkable</code>, and adds the actions below to{" "}
          <code className="font-mono text-xs text-foreground">connect.manifest.json</code>. The code is yours from then on.
        </p>
      </Section>

      <Section title="What comes with it">
        <div className="grid gap-3 md:grid-cols-3">
          <Card label="Interface" sub="React, Tailwind">
            {ownFiles.filter((f) => f.to.startsWith("ui/")).map((f) => (
              <Path key={f.to}>{f.to}</Path>
            ))}
          </Card>
          <Card label="Backend" sub="Hono route">
            {routes.length ? (
              routes.map((r) => (
                <span key={r.method + r.path} className="flex gap-1.5 font-mono text-11">
                  <span className="w-9 shrink-0 text-muted-foreground">{r.method}</span>
                  <span className="truncate text-foreground">{r.path}</span>
                </span>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">Uses the routes of the blocks it is made of.</span>
            )}
          </Card>
          <Card label="Sign-in and access" sub="One Connect">
            {grant.length ? (
              grant.map((a) => (
                <span key={a.actionId} className="flex items-center gap-1.5 text-xs" title={a.reason}>
                  <img src={`https://assets.withone.ai/connectors/${a.platform}.svg`} alt="" className="size-3.5" />
                  <span className="truncate text-foreground">{a.title}</span>
                  <span className="ml-auto shrink-0 font-mono text-10 uppercase text-muted-foreground">{a.optional ? "opt" : a.access}</span>
                </span>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">The Sign in with One flow and the user's grant.</span>
            )}
          </Card>
        </div>
        <p className="text-11 text-muted-foreground">
          Secured by One. Each user signs in and connects their own {platformsOf(grant)}. The app never holds a token.
        </p>
      </Section>

      <Section title="Use it">
        {block.usage && <Code lang="tsx">{`// ui\nimport { ${componentName(block)} } from "@/components/forkable/${componentName(block)}";\n\n${block.usage}`}</Code>}
        <Code>{`// server, once for every block you add\nimport { mountForkable } from "./routes/forkable/index.js";\n\nmountForkable(app, {\n  connect: () => oneConnect,          // your Connect client, or null before setup\n  userId: (c) => session(c).userId,   // your session lookup\n});`}</Code>
      </Section>

      {grant.length > 0 && (
        <Section title="Adds to connect.manifest.json">
          <Code lang="json">{JSON.stringify({ actions: grant.map((a) => ({ platform: a.platform, actionId: a.actionId, access: a.access, usedBy: block.name, reason: a.reason })) }, null, 2)}</Code>
        </Section>
      )}
    </div>
  );
}

const platformsOf = (grant: { platform: string }[]) => {
  const names = [...new Set(grant.map((a) => PLATFORM_NAMES[a.platform] ?? a.platform))];
  return names.length === 0 ? "accounts" : names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};
const PLATFORM_NAMES: Record<string, string> = { gmail: "Gmail", "google-calendar": "Google Calendar", anthropic: "Anthropic", typesafe: "TypeSafe (Jev)", openai: "OpenAI", gemini: "Gemini", perplexity: "Perplexity", "people-data-labs": "People Data Labs", coresignal: "Coresignal", hunter: "Hunter", findymail: "Findymail", clearout: "Clearout", github: "GitHub", zoom: "Zoom" };

const componentName = (b: Block) => b.files.find((f) => f.from.endsWith(".tsx"))?.from.split("/").pop()?.replace(".tsx", "") ?? b.title;

function Card({ label, sub, children }: { label: string; sub: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-13 font-medium text-foreground">{label}</span>
        <span className="text-11 text-muted-foreground">{sub}</span>
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

const Path = ({ children }: { children: string }) => <span className="truncate font-mono text-11 text-foreground">{children}</span>;

function Introduction() {
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <h1 className="text-28 font-semibold tracking-[-0.01em] text-foreground">Blocks that come with their backend</h1>
        <p className="max-w-2xl text-15 text-muted-foreground">
          A Forkable block is the interface, the server route behind it, and the sign-in that lets it act in your user's own account. Add one to your fork and it works on the first run. Then the code is yours.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card label="Interface" sub="Copied into your fork">
          <span className="text-xs text-muted-foreground">React and Tailwind on plain CSS variables. Restyle it like any file you wrote.</span>
        </Card>
        <Card label="Backend" sub="A route, already wired">
          <span className="text-xs text-muted-foreground">A Hono route that calls Gmail, Claude and the rest through One. No SDK per provider, no webhook glue.</span>
        </Card>
        <Card label="Sign-in and access" sub="Built in">
          <span className="text-xs text-muted-foreground">Each user signs in with One and connects their own Gmail. The component asks for exactly the actions it uses.</span>
        </Card>
      </div>

      <Section title="One command">
        <CopyLine text="npx @withone/forkable add mail-app" />
        <Code lang="text">{`✓ lib                    one-server.ts, one-client.ts, one-ui.tsx
✓ gmail                  actions, types, mappers, Acme sample inbox
✓ gmail-inbox            GmailInbox.tsx  + GET  /api/gmail/threads
✓ gmail-thread           GmailThread.tsx + GET  /api/gmail/threads/:id
✓ gmail-thread-actions   archive, unread, star  + POST /api/gmail/threads/:id/modify
✓ gmail-compose          GmailCompose.tsx + POST /api/gmail/drafts
✓ gmail-ai-reply         GmailAiReply.tsx + POST /api/gmail/threads/:id/assist
✓ mail-app               MailApp.tsx

connect.manifest.json   +6 actions (gmail read 2, gmail write 3, anthropic 1)
server/src/routes/forkable/index.ts   mountForkable() now mounts 6 routes`}</Code>
        <p className="text-13 text-muted-foreground">
          Before you make a Connect app, every route answers from the Acme sample inbox, so the page works on the first <code className="font-mono text-xs text-foreground">pnpm dev</code>. Sign in with One and the same routes run on the user's real Gmail. Each answer says which in{" "}
          <code className="font-mono text-xs text-foreground">meta.mode</code>.
        </p>
      </Section>

      <Section title="Start here">
        <div className="grid gap-3 md:grid-cols-2">
          {["mail-app", "gmail-inbox", "gmail-ai-reply", "sign-in-with-one"].map((id) => (
            <a key={id} href={`#/${id}`} className="flex flex-col gap-1.5 rounded-lg border border-border p-3 hover:bg-card">
              <span className="text-13 font-medium text-foreground">{BLOCKS[id]!.title}</span>
              <span className="text-xs text-muted-foreground">{BLOCKS[id]!.description}</span>
            </a>
          ))}
        </div>
      </Section>
    </div>
  );
}
