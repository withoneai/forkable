import { ArrowRight, Check } from "lucide-react";
import { LearnMore } from "./LearnMore";
import { Horizon } from "./art/Horizon";
import { Terminal } from "./Terminal";
import { TemplatePreview } from "./TemplatePreview";
import { useReveal, useScrollVars } from "../lib/hooks";
import type { Template } from "../lib/templates";

// The second door: one block added to an app you already have.
function AddedMini() {
  const added = ["MailApp.tsx and its route", "6 actions in your manifest", "Runs on the Acme Inc sample"];
  return (
    <div className="rounded-lg border border-border bg-card/95 p-3 text-left shadow-[var(--window-shadow)] backdrop-blur-xl">
      <p className="font-mono text-11 uppercase tracking-wide text-muted-foreground">Added mail-app</p>
      <ul className="mt-2 flex flex-col gap-1">
        {added.map((f) => (
          <li key={f} className="flex items-center gap-2 font-mono text-13 text-foreground">
            <Check className="size-3.5 shrink-0 text-accent-fg" strokeWidth={2.5} />
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

// What the fork command leaves you with, once it finishes.
function ForkedMini({ template }: { template: Template }) {
  const shipped = [
    `${template.name}, running on the Acme Inc sample`,
    "agents/, the team that runs it",
    "gtm/, the launch kit",
    "Sign in with One, wired",
  ];
  return (
    <div className="rounded-lg border border-border bg-card/95 p-3 text-left shadow-[var(--window-shadow)] backdrop-blur-xl">
      <p className="font-mono text-11 uppercase tracking-wide text-muted-foreground">Forked {template.slug}</p>
      <ul className="mt-2 flex flex-col gap-1">
        {shipped.map((f) => (
          <li key={f} className="flex items-center gap-2 font-mono text-13 text-foreground">
            <Check className="size-3.5 shrink-0 text-accent-fg" strokeWidth={2.5} />
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Hero({ template }: { template: Template }) {
  const [ref, shown] = useReveal<HTMLDivElement>(0);
  const stage = useScrollVars<HTMLDivElement>(0.35);
  return (
    <section id="top" className="relative overflow-hidden pt-36">
      <div
        ref={ref}
        className={`t-stagger relative mx-auto max-w-4xl px-6 text-center ${shown ? "is-shown" : ""}`}
      >
        <div className="t-stagger-line t-stagger-line--1 flex justify-center">
          <a
            href="/mcp"
            className="group inline-flex items-center gap-2 rounded-full border border-border bg-card/60 py-1 pl-1 pr-3 text-13 text-muted-foreground backdrop-blur transition-colors hover:border-foreground/25 hover:text-foreground"
          >
            <span className="rounded-full bg-accent-fill px-2 py-0.5 text-11 font-medium text-accent-ink">New</span>
            <span className="font-medium text-foreground">Apps inside Claude and ChatGPT</span>
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
          </a>
        </div>
        <h1 className="t-stagger-line t-stagger-line--2 text-gradient-headline mt-6 pb-2 font-serif text-56 tracking-tight sm:text-80">
          Fork a business,
          <br />
          not a blank page
        </h1>
        <p className="t-stagger-line t-stagger-line--3 mx-auto mt-6 max-w-lg text-17 text-muted-foreground">
          Every business comes with its integrations and sign-in already wired.{" "}
          <span className="text-foreground">Fork the whole thing, add one block of it to your app, or use it right in chat.</span>
        </p>
        <div className="t-stagger-line t-stagger-line--4 mt-12 flex flex-col items-center justify-center gap-3">
          <Terminal command="npm create forkable@latest rill" />
          <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row">
            <a
              href="#templates"
              className="rounded-full bg-foreground px-6 py-3 text-13 font-medium text-background transition-[box-shadow,transform] duration-300 hover:shadow-[0_0_0_4px_var(--accent-glow),0_0_40px_var(--accent-glow)] active:scale-[0.98]"
            >
              Browse templates
            </a>
            <LearnMore href="https://github.com/withoneai/forkable">
              View on GitHub
            </LearnMore>
          </div>
        </div>
      </div>

      {/* Three live surfaces stacked in depth on the horizon: the template
          preview, one block added to an app on the left, and what the fork
          leaves you with on the right. Each layer drifts at its own speed. */}
      <div ref={stage} className="stage relative mt-24 pb-36">
        <Horizon />
        <div className="relative mx-auto max-w-6xl px-6">
          <div className="stage-tilt relative">
            <div className="mx-auto max-w-xl">
              <TemplatePreview template={template} />
            </div>
            <div className="layer-fast absolute -left-2 top-[58%] hidden w-[19rem] lg:block xl:-left-12">
              <AddedMini />
            </div>
            <div className="layer-faster absolute -bottom-8 -right-2 hidden w-[24rem] lg:block xl:-right-12">
              <ForkedMini template={template} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
