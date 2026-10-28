import { Check, Code2, FileCode2, Route, Plug } from "lucide-react";
import { SectionHead } from "./SectionHead";
import { Terminal } from "./Terminal";
import { LearnMore } from "./LearnMore";
import { AppWindow } from "./AppWindow";
import { connectorLogo } from "./icons";
import { useReveal } from "../lib/hooks";

const CELLS = [
  { icon: Code2, title: "The interface", body: "React on plain tokens, so it takes your fork's colors and type." },
  { icon: Route, title: "The route behind it", body: "A Hono route, mounted with every other block by one mountForkable()." },
  { icon: Plug, title: "The actions it needs", body: "add writes them into connect.manifest.json, so your Connect app asks for exactly that." },
  { icon: FileCode2, title: "Yours after that", body: "It's plain code in your repo. Every block runs on the Acme Inc sample until you make a Connect app." },
];

// Block list, from components/registry. Grouped the way the gallery groups them.
const GROUPS = [
  { logo: null, name: "Auth", blocks: ["Sign in with One"] },
  { logo: "gmail", name: "Gmail", blocks: ["Inbox", "Thread", "Thread Actions", "Compose", "AI Reply"] },
  { logo: "google-calendar", name: "Google Calendar", blocks: ["Agenda", "Week", "Event", "New Event", "Offer Times"] },
  { logo: null, name: "Apps", blocks: ["Mail app", "Calendar app"] },
  { logo: null, name: "Rill", blocks: ["Lane inbox", "Morning brief", "Ask your inbox", "VIP suggestions"] },
  { logo: null, name: "Brief", blocks: ["Visibility check", "Share of voice", "Citations"] },
  { logo: null, name: "Lead", blocks: ["People search", "Enrich", "Email finder"] },
  { logo: null, name: "Builder", blocks: ["Action search", "Manifest", "Publish to GitHub"] },
];

// What `add` prints, trimmed: the real file targets and route from mail-app's
// requires chain.
const ADD_OUTPUT = [
  "ui/src/components/forkable/MailApp.tsx",
  "ui/src/components/forkable/GmailInbox.tsx",
  "server/src/routes/forkable/gmail-inbox.ts",
  "connect.manifest.json, 6 actions added",
  "mountForkable(), 6 routes",
];

function AddWindow() {
  return (
    <AppWindow className="flex flex-col">
      <header className="flex h-10 items-center gap-2 border-b border-border px-3 font-mono text-11 text-muted-foreground">
        <span className="size-2 rounded-full bg-border" aria-hidden />
        <span className="size-2 rounded-full bg-border" aria-hidden />
        <span className="size-2 rounded-full bg-border" aria-hidden />
        <span className="ml-2">acme-mail</span>
      </header>
      <div className="flex flex-col gap-1.5 p-4 font-mono text-11">
        <p className="text-foreground">
          <span className="select-none text-muted-foreground">$ </span>npx @withone/forkable add mail-app
        </p>
        {ADD_OUTPUT.map((line, i) => (
          <p
            key={line}
            className="flex items-center gap-2 text-muted-foreground animate-[row-in_360ms_var(--stagger-ease)_both]"
            style={{ animationDelay: `${200 + i * 90}ms` }}
          >
            <Check className="size-3 shrink-0 text-accent-fg" strokeWidth={2.5} />
            {line}
          </p>
        ))}
        <p className="mt-1.5 text-foreground">Added mail-app and the 5 blocks it needs.</p>
      </div>
    </AppWindow>
  );
}

export function BlocksSection() {
  const [ref, shown] = useReveal<HTMLDivElement>(0.15);
  return (
    <section id="blocks" className="relative px-6 pb-24 pt-12 sm:pb-36">
      <SectionHead index="03" label="Forkable blocks" title={<>Take one piece<br />of a business</>}>
        A block is one feature pulled out of a Forkable business. It brings its interface, the route behind it and the
        actions it needs from your users' accounts.{" "}
        <span className="text-foreground">Add it to any app with one command, and the code is yours.</span>
      </SectionHead>

      <div className="mt-8 flex justify-center">
        <Terminal command="npx @withone/forkable add mail-app" />
      </div>

      <div ref={ref} className={`t-stagger mx-auto mt-12 max-w-6xl ${shown ? "is-shown" : ""}`}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[3fr_2fr]">
          <div className="t-stagger-line t-stagger-line--1">
            <AddWindow />
          </div>
          <div className="t-stagger-line t-stagger-line--2 flex flex-col gap-4 rounded-xl border border-border bg-card/50 p-6">
            <div>
              <h3 className="text-15 font-medium">Pulled from real businesses</h3>
              <p className="mt-1.5 text-13 text-muted-foreground">Rill, Brief, Lead and the Builder so far. Every new business adds its own.</p>
            </div>
            {GROUPS.map((g) => (
              <div key={g.name} className="flex flex-col gap-2">
                <span className="flex items-center gap-1.5 text-11 text-muted-foreground">
                  {g.logo && <img src={connectorLogo(g.logo)} alt="" className="size-3.5" />}
                  {g.name}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {g.blocks.map((b) => (
                    <span key={b} className="rounded-full border border-border px-2.5 py-1 text-11 text-foreground/90">
                      {b}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CELLS.map((c, i) => (
            <div
              key={c.title}
              className={`t-stagger-line t-stagger-line--${Math.min(i + 1, 4)} flex flex-col gap-2 rounded-xl border border-border bg-card/50 p-4`}
            >
              <c.icon className="size-4 text-accent-fg" strokeWidth={1.75} />
              <h3 className="text-13 font-medium">{c.title}</h3>
              <p className="text-13 text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 flex justify-center">
        <LearnMore href="/blocks/">Browse every block, running live</LearnMore>
      </div>
    </section>
  );
}
