import { Check } from "lucide-react";
import { useReveal } from "../lib/hooks";
import { LearnMore } from "./LearnMore";
import { Terminal } from "./Terminal";
import { REPO_URL } from "../lib/links";

const CHECKS = [
  "Runs on your Claude Code or Codex",
  "Every app connected through One",
  "Sign in with One in every app",
  "One-click publish to Vercel or GitHub",
];

export function Closing() {
  const [ref, shown] = useReveal<HTMLDivElement>(0.3);
  return (
    <section id="fork" className="relative scroll-mt-24 overflow-hidden pb-24 pt-24 sm:pt-36">
      <div className="horizon-halo" aria-hidden />
      <div ref={ref} className={`t-stagger relative mx-auto max-w-3xl px-6 text-center ${shown ? "is-shown" : ""}`}>
        <div className="t-stagger-line t-stagger-line--1 flex items-center justify-center gap-2 font-mono text-11 uppercase tracking-wide">
          <span className="text-foreground">05</span>
          <span className="h-px w-6 bg-border" aria-hidden />
          <span className="text-muted-foreground">Fork it</span>
        </div>
        <h2 className="t-stagger-line t-stagger-line--2 text-gradient-headline mt-4 pb-2 font-serif text-56 tracking-tight sm:text-80">
          Fork it and
          <br />
          make it yours
        </h2>
        <p className="t-stagger-line t-stagger-line--3 mx-auto mt-6 max-w-md text-15 text-muted-foreground">
          One line gives you the whole builder and its code, running on your computer. Watch the keyless
          demo first, then describe your first app.
        </p>
        <div className="t-stagger-line t-stagger-line--4 mt-12 flex flex-col items-center gap-6">
          <Terminal />
          <ul className="grid grid-cols-1 gap-x-6 gap-y-2 text-left sm:grid-cols-2">
            {CHECKS.map((item) => (
              <li key={item} className="flex items-center gap-2 text-13 text-muted-foreground">
                <Check className="size-3.5 shrink-0 text-foreground" strokeWidth={2.5} />
                {item}
              </li>
            ))}
          </ul>
          <p className="text-13 text-muted-foreground">
            Secured by One. Each user connects their own accounts and can revoke them any time.
          </p>
          <div className="flex flex-col items-center gap-1 sm:flex-row">
            <LearnMore href={REPO_URL}>Read the source on GitHub</LearnMore>
          </div>
        </div>
      </div>
      <div className="h-24 sm:h-36" aria-hidden />
    </section>
  );
}
