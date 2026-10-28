import type { ReactNode } from "react";
import { SectionHead } from "./SectionHead";
import { Terminal } from "./Terminal";
import { LearnMore } from "./LearnMore";
import { ConnectConsent } from "./ConnectConsent";
import { useReveal } from "../lib/hooks";
import { ArrowUpRight } from "lucide-react";
import { BoltIcon, LovableIcon, ReplitIcon } from "./icons";
import { builderUrl, type Builder, type Template } from "../lib/templates";

function Cell({
  title,
  body,
  i,
  children,
}: {
  title: string;
  body: string;
  i: number;
  children?: ReactNode;
}) {
  return (
    <div className={`t-stagger-line t-stagger-line--${Math.min(i, 4)} flex flex-col rounded-xl border border-border bg-card/50 p-6`}>
      <h3 className="text-15 font-medium">{title}</h3>
      <p className="mt-1.5 max-w-sm text-13 text-muted-foreground">{body}</p>
      {children && <div className="mt-6">{children}</div>}
    </div>
  );
}

const STEPS = [
  { n: "1", title: "Pick", body: "An official, verified or community template, or name one directly." },
  { n: "2", title: "Copy", body: "Clones the template at a pinned version and installs." },
  { n: "3", title: "Run", body: "Starts on the keyless Acme Inc sample. No account yet." },
  { n: "4", title: "Connect", body: "One Connect app covers every tool the business uses. forkable connect walks you through it." },
];

const PROOF = [
  { title: "The team comes with it", body: "agents/ holds the agents that run the business, each with its own job written down." },
  { title: "A go-to-market kit", body: "gtm/ has draft-only skills for positioning, launch and the first 50 customers." },
  { title: "Yours to change", body: "MIT licensed code and an AGENTS.md, so your coding agent knows the business from day one." },
];

const BUILDERS: { id: Builder; label: string; icon: typeof ReplitIcon }[] = [
  { id: "replit", label: "Replit", icon: ReplitIcon },
  { id: "bolt", label: "Bolt", icon: BoltIcon },
  { id: "lovable", label: "Lovable", icon: LovableIcon },
];

function KeepBuilding({ template }: { template: Template & { repo: string } }) {
  const builders = BUILDERS.filter((b) => template.builders.includes(b.id));
  const names = builders.map((b) => b.label);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names[0];
  return (
    <div className="t-stagger-line t-stagger-line--1 mt-3 flex flex-col gap-4 rounded-xl border border-border bg-card/50 p-4 sm:flex-row sm:items-center">
      <div className="flex-1">
        <h3 className="text-15 font-medium">Keep building it where you build</h3>
        <p className="mt-1.5 max-w-xl text-13 text-muted-foreground">
          Open {template.name} in {list} and keep building. Your users still sign in with One
          and connect their own accounts.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {builders.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            href={builderUrl(id, template)}
            target="_blank"
            rel="noopener"
            className="group inline-flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-13 transition-colors hover:border-foreground/20"
          >
            <Icon className="size-4" />
            Open in {label}
            <ArrowUpRight className="size-3 text-muted-foreground transition-colors group-hover:text-foreground" strokeWidth={2} />
          </a>
        ))}
      </div>
    </div>
  );
}

export function ForkSection({ template }: { template: Template }) {
  const [ref, shown] = useReveal<HTMLDivElement>(0.15);
  return (
    <section id="fork" className="relative px-6 pb-24 pt-12 sm:pb-36">
      <SectionHead index="05" label="Fork it" title="One command, a full business">
        {`npm create forkable@latest ${template.slug}`} clones {template.name} and starts it on the Acme Inc sample.{" "}
        <code className="font-mono text-foreground">forkable connect</code> then walks you through one Connect app,
        and your users connect their own accounts.
      </SectionHead>
      <div ref={ref} className={`t-stagger mx-auto mt-12 max-w-6xl ${shown ? "is-shown" : ""}`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STEPS.map((s, i) => (
            <div key={s.n} className={`t-stagger-line t-stagger-line--${i + 1} rounded-xl border border-border bg-card/50 p-4`}>
              <span className="font-mono text-11 text-muted-foreground">{s.n}</span>
              <h3 className="mt-1 text-15 font-medium">{s.title}</h3>
              <p className="mt-1 text-13 text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
        {/* Replit and Bolt import a whole repo, so this row waits until a
            template has a standalone one. Rill lives inside withoneai/forkable. */}
        {template.repo && <KeepBuilding template={{ ...template, repo: template.repo }} />}
        {template.code && (
          <div className="mt-3 flex justify-center">
            <LearnMore href={template.code}>Read {template.name}&apos;s code on GitHub</LearnMore>
          </div>
        )}
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Cell i={1} title="Try it on sample data, no account needed" body={`${template.name} starts on the Acme Inc sample the moment it installs. No account needed to see it work.`}>
            <Terminal command={`npm create forkable@latest ${template.slug}`} />
          </Cell>
          <Cell i={2} title="How your users connect" body="The real consent flow, mocked on the Acme Inc sample.">
            <ConnectConsent template={template} />
          </Cell>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {PROOF.map((p, i) => (
            <Cell key={p.title} i={i + 1} title={p.title} body={p.body} />
          ))}
        </div>
      </div>
    </section>
  );
}
