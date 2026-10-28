import { Check, GitPullRequest } from "lucide-react";
import { SectionHead } from "./SectionHead";
import { Glyph } from "./Glyph";
import { LearnMore } from "./LearnMore";
import { useReveal } from "../lib/hooks";

const CHECKS = [
  "The keyless demo exits 0",
  "The manifest matches the runAction calls in the code",
  "No secrets or .env values are committed",
  "The sample is Acme Inc only",
  "AGENTS.md, agents/ and gtm/positioning.md are there",
];

const TIERS = [
  { name: "Official", body: "Built by One. A new one every 10 days." },
  { name: "Verified", body: "Passed forkable check, plus a human review of the code and its integrations." },
  { name: "Community", body: "Passed forkable check. Anyone can publish one." },
];

function LineageChip({ name, dim }: { name: string; dim?: boolean }) {
  return (
    <span
      className={`whitespace-nowrap rounded-full border border-border px-3 py-1.5 font-mono text-11 ${dim ? "text-muted-foreground" : "bg-foreground text-background"}`}
    >
      {name}
    </span>
  );
}

export function PublishSection() {
  const [ref, shown] = useReveal<HTMLDivElement>(0.2);
  return (
    <section id="publish" className="relative px-6 py-24 sm:py-36">
      <SectionHead index="06" label="Publish" title="Fork it again, keep the credit">
        Anyone can publish a template built on the starter. <code className="font-mono text-foreground">forkable check</code>{" "}
        runs before it lists, and every fork remembers where it came from.
      </SectionHead>

      <div
        ref={ref}
        className={`t-stagger mx-auto mt-12 grid max-w-6xl grid-cols-1 gap-3 lg:grid-cols-[3fr_2fr] ${shown ? "is-shown" : ""}`}
      >
        <div className="t-stagger-line t-stagger-line--1 flex flex-col rounded-xl border border-border bg-card/50 p-6">
          <div className="flex items-center gap-2">
            <GitPullRequest className="size-4 text-muted-foreground" strokeWidth={1.75} />
            <h3 className="text-15 font-medium">forkable publish</h3>
          </div>
          <p className="mt-1.5 max-w-sm text-13 text-muted-foreground">
            Pushes to your own GitHub on your grant, then opens a PR to the registry with your template's name, vertical,
            platforms, agents and screenshots.
          </p>
          <ul className="mt-4 flex flex-col gap-2">
            {CHECKS.map((c) => (
              <li key={c} className="flex items-start gap-2 text-13 text-muted-foreground">
                <Check className="mt-0.5 size-3.5 shrink-0 text-foreground" strokeWidth={2.5} />
                {c}
              </li>
            ))}
          </ul>
        </div>

        <div className="t-stagger-line t-stagger-line--2 flex flex-col gap-3">
          <div className="rounded-xl border border-border bg-card/50 p-6">
            <h3 className="text-15 font-medium">Three tiers</h3>
            <div className="mt-3 flex flex-col gap-3">
              {TIERS.map((t) => (
                <div key={t.name} className="flex items-start gap-3">
                  <span className="mt-0.5 rounded-sm border border-border px-1.5 py-0.5 text-11 text-muted-foreground">
                    {t.name}
                  </span>
                  <p className="text-13 text-muted-foreground">{t.body}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card/50 p-6">
            <h3 className="text-15 font-medium">Lineage is the feature</h3>
            <p className="mt-1.5 text-13 text-muted-foreground">
              Every template names its parent, so the site can draw the tree.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Glyph id="R" className="size-4 text-accent-fg" />
              <LineageChip name="rill" />
              <span className="text-muted-foreground" aria-hidden>
                →
              </span>
              <LineageChip name="rill-for-recruiters" dim />
            </div>
          </div>
        </div>
      </div>
      <div className="mt-6 flex justify-center">
        <LearnMore href="/contribute">How to build and publish a template</LearnMore>
      </div>
    </section>
  );
}
