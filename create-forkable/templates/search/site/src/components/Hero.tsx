import { Terminal } from "./Terminal";
import { LearnMore } from "./LearnMore";
import { SearchDemo } from "./SearchDemo";
import { useReveal } from "../lib/hooks";
import { REPO_URL } from "../lib/links";

export function Hero() {
  const [ref, shown] = useReveal<HTMLDivElement>(0);
  return (
    <section id="top" className="relative overflow-hidden pt-36">
      <div className="horizon-halo" aria-hidden />
      <div ref={ref} className={`t-stagger relative mx-auto max-w-4xl px-6 text-center ${shown ? "is-shown" : ""}`}>
        <div className="t-stagger-line t-stagger-line--1 flex justify-center">
          <a
            href="#fork"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 py-1 pl-2 pr-3 text-11 text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
          >
            <span className="live-dot size-1.5 rounded-full bg-accent-fg" aria-hidden />
            <span className="font-medium text-foreground">Free and open source</span>
            <span className="h-3 w-px bg-border" aria-hidden />
            A Forkable business
          </a>
        </div>
        <h1 className="t-stagger-line t-stagger-line--2 text-gradient-headline mt-6 pb-2 font-serif text-56 tracking-tight text-balance sm:text-80">
          Search, one search box
          <br className="hidden sm:block" /> for everything you connect
        </h1>
        <p className="t-stagger-line t-stagger-line--3 mx-auto mt-6 max-w-lg text-17 text-muted-foreground">
          Search indexes your CRM, mail, calendars, docs, issues, chat and meeting notes, ranks them by
          keyword and meaning, and docks an AI on the right that cites what it finds.{" "}
          <span className="text-foreground">It's a Forkable business, so you can fork it and run your own.</span>
        </p>
        <div className="t-stagger-line t-stagger-line--4 mt-12 flex flex-col items-center justify-center gap-3 lg:flex-row">
          <Terminal />
          <LearnMore href={REPO_URL}>View on GitHub</LearnMore>
        </div>
        <p className="t-stagger-line t-stagger-line--4 mt-4 text-13 text-muted-foreground">
          Try it on the Acme sample first. No account needed.
        </p>
      </div>

      <div className="relative mt-16 pb-24 sm:pb-36">
        <div className="horizon" aria-hidden />
        <div className="relative mx-auto max-w-5xl px-6">
          <SearchDemo />
        </div>
      </div>
    </section>
  );
}
