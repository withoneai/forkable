import { BookOpen, KeyRound, ListChecks, Braces } from "lucide-react";
import { SectionHead } from "./SectionHead";
import { connectorLogo } from "./icons";
import { useReveal } from "../lib/hooks";
import counts from "../generated/platform-count.json";

// A slice of One's catalog. The counts above it are fetched at build time.
const LOGOS = [
  "gmail", "slack", "stripe", "hubspot", "notion", "linear", "github", "google-calendar",
  "attio", "outlook-mail", "shopify", "salesforce", "airtable", "google-sheets", "google-drive", "jira",
  "asana", "zoom", "intercom", "zendesk", "twilio", "whatsapp-business", "openai", "anthropic",
  "quickbooks", "xero", "mailchimp", "calendly", "dropbox", "discord", "square", "figma",
  "pipedrive", "trello", "resend", "vercel",
];

const CARDS = [
  {
    icon: BookOpen,
    title: "The agent reads the catalog",
    body: "Your coding agent looks actions up in One's catalog as it builds, so the calls it writes use real action ids and real parameters, not guesses.",
  },
  {
    icon: Braces,
    title: "A typed client per action",
    body: "Every action the app uses gets a typed wrapper generated from its schema. A wrong field is a type error before it is a failed call.",
  },
  {
    icon: KeyRound,
    title: "Sign in with One, prewired",
    body: "Every app ships with the sign-in button and its two routes. People sign in and connect their own Gmail, Slack or Stripe. No provider keys in the code.",
  },
  {
    icon: ListChecks,
    title: "Asks for what the code calls",
    body: "The app's access list is read from the actions in its code, so the consent screen asks for exactly what the app uses and nothing more.",
  },
];

export function IntegrationsSection() {
  const [ref, shown] = useReveal<HTMLDivElement>(0.15);
  return (
    <section id="integrations" className="relative scroll-mt-24 px-6 pb-24 pt-12 sm:pb-36">
      <SectionHead index="01" label="Integrations" title={<>Every app comes<br />connected</>}>
        Building an app that touches Gmail or Stripe used to mean an OAuth app per tool, tokens to store and
        refresh, and a login to build.{" "}
        <span className="text-foreground">
          Here every app starts with {counts.platforms} apps and {counts.tools} actions one prompt away.
        </span>
      </SectionHead>

      <div className="fade-edges mx-auto mt-12 grid max-w-3xl grid-cols-6 gap-2 sm:grid-cols-9 sm:gap-3">
        {LOGOS.map((s) => (
          <span key={s} className="grid aspect-square place-items-center rounded-xl border border-border bg-card/50">
            <img src={connectorLogo(s)} alt="" className={`size-6 sm:size-7 ${s === "vercel" || s === "github" ? "dark:invert" : ""}`} loading="lazy" />
          </span>
        ))}
      </div>
      <p className="mt-4 text-center font-mono text-11 uppercase tracking-wide text-muted-foreground">
        {counts.platforms} apps · {counts.tools} actions
      </p>

      <div ref={ref} className={`t-stagger mx-auto mt-16 grid max-w-6xl grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] ${shown ? "is-shown" : ""}`}>
        <div className="t-stagger-line t-stagger-line--1 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CARDS.map((c) => (
            <div key={c.title} className="flex flex-col gap-2 rounded-xl border border-border bg-card/50 p-4">
              <c.icon className="size-4 text-accent-fg" strokeWidth={1.75} />
              <h3 className="text-13 font-medium">{c.title}</h3>
              <p className="text-13 text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
        <CodeCard />
      </div>
    </section>
  );
}

// What the agent writes, from the replay fixture the keyless demo runs.
function CodeCard() {
  return (
    <div className="t-stagger-line t-stagger-line--2 squircle flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-[var(--window-shadow)]">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 font-mono text-11 text-muted-foreground">
        <img src={connectorLogo("gmail")} alt="" className="size-3.5" />
        server/inbox.ts
        <span className="ml-auto">written by the agent</span>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-11 leading-relaxed text-muted-foreground">
        <code>
          <span className="text-foreground">import</span> {"{ one, requireUser }"} <span className="text-foreground">from</span> "./one";{"\n"}
          <span className="text-foreground">import</span> {"{ gmail }"} <span className="text-foreground">from</span> "./one/actions.gen";{"\n\n"}
          inbox.get(<span className="text-accent-fg">"/threads"</span>, <span className="text-foreground">async</span> (c) {"=> {"}{"\n"}
          {"  "}<span className="text-foreground">await</span> requireUser(c);{"\n"}
          {"  "}<span className="text-foreground">const</span> r = <span className="text-foreground">await</span> one(c).run(<span className="text-foreground">gmail.listAndViewEmailThreads</span>, {"{"}{"\n"}
          {"    "}body: {"{ numberOfThreads: "}<span className="text-accent-fg">10</span>, label: <span className="text-accent-fg">"INBOX"</span> {"},"}{"\n"}
          {"  });"}{"\n"}
          {"  "}<span className="text-foreground">if</span> (!r.ok) <span className="text-foreground">return</span> c.json(r, r.status);{"\n"}
          {"  "}<span className="text-foreground">return</span> c.json({"{ threads: r.data.threads }"});{"\n"}
          {"});"}
        </code>
      </pre>
      <div className="mt-auto border-t border-border px-4 py-3 text-11 text-muted-foreground">
        Runs on the signed-in person's own Gmail. Their grant, their data.
      </div>
    </div>
  );
}
