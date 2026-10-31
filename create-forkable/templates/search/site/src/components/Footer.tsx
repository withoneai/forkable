import { Logo } from "./Logo";
import { FORKABLE_URL, REPO_URL } from "../lib/links";

export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-6 text-13 text-muted-foreground sm:flex-row">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <Logo size={20} />
          Search
        </div>
        <div className="flex items-center gap-6">
          <a href={REPO_URL} className="transition-colors hover:text-foreground">
            GitHub
          </a>
          <a href={FORKABLE_URL} className="transition-colors hover:text-foreground">
            Part of Forkable
          </a>
          <span>Secured by One</span>
        </div>
      </div>
      {/* The wordmark, cut by the bottom of the page, the mark beside it. */}
      <div
        className="flex select-none items-end justify-center font-serif leading-none tracking-tight"
        style={{ fontSize: "clamp(8rem, 30vw, 26rem)", marginBottom: "-0.22em" }}
      >
        <span className="mr-[0.08em] mb-[0.2em]" aria-hidden>
          <Logo size="0.6em" />
        </span>
        <span className="pointer-events-none text-foreground/[0.06]" aria-hidden>
          Search
        </span>
      </div>
    </footer>
  );
}
