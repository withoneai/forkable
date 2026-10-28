import { Check } from "lucide-react";
import { useReveal } from "../lib/hooks";
import { LearnMore } from "./LearnMore";
import { DotFloor } from "./art/DotFloor";

const CHECKS = [
  "Every business and the starter",
  "The blocks and the forkable CLI",
  "The blocks MCP and blocks.forkable.dev",
  "An MCP starter with Sign in with One",
  "forkable.dev, this site",
  "MIT licensed, built on One Connect",
];

export function Closing() {
  const [ref, shown] = useReveal<HTMLDivElement>(0.3);
  return (
    <section id="open-source" className="relative overflow-hidden pb-24 pt-24 sm:pt-36">
      <DotFloor />
      <div ref={ref} className={`t-stagger relative mx-auto max-w-3xl px-6 text-center ${shown ? "is-shown" : ""}`}>
        <div className="t-stagger-line t-stagger-line--1 flex items-center justify-center gap-2 font-mono text-11 uppercase tracking-wide">
          <span className="text-foreground">07</span>
          <span className="h-px w-6 bg-border" aria-hidden />
          <span className="text-muted-foreground">Open source</span>
        </div>
        <h2 className="t-stagger-line t-stagger-line--2 text-gradient-headline mt-4 pb-2 font-serif text-56 tracking-tight text-balance sm:text-80">
          Fork the
          <br />
          whole thing
        </h2>
        <p className="t-stagger-line t-stagger-line--3 mx-auto mt-6 max-w-md text-15 text-muted-foreground">
          All of Forkable is open source. Read the code, run your own copy and send a PR.
        </p>
        <div className="t-stagger-line t-stagger-line--4 mt-12 flex flex-col items-center gap-6">
          <a
            href="#templates"
            className="rounded-full bg-foreground px-6 py-3 text-13 font-medium text-background transition-[box-shadow,transform] duration-300 hover:shadow-[0_0_0_4px_var(--accent-glow),0_0_40px_var(--accent-glow)] active:scale-[0.98]"
          >
            Browse templates
          </a>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-2 text-left sm:grid-cols-2">
            {CHECKS.map((item) => (
              <li key={item} className="flex items-center gap-2 text-13 text-muted-foreground">
                <Check className="size-3.5 shrink-0 text-foreground" strokeWidth={2.5} />
                {item}
              </li>
            ))}
          </ul>
          <LearnMore href="https://github.com/withoneai/forkable">
            Read the source on GitHub
          </LearnMore>
        </div>
      </div>
      <div className="h-72 sm:h-96" aria-hidden />
    </section>
  );
}
