import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-6 text-13 text-muted-foreground sm:flex-row">
        <div className="group flex items-center gap-2 font-medium text-foreground">
          <Logo size={28} />
          Forkable
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <a href="https://github.com/withoneai/forkable" className="transition-colors hover:text-foreground">
            GitHub
          </a>
          <a href="/blocks/" className="transition-colors hover:text-foreground">
            Blocks
          </a>
          <a href="/mcp" className="transition-colors hover:text-foreground">
            MCP
          </a>
          <a href="/contribute" className="transition-colors hover:text-foreground">
            Contribute
          </a>
          <span>Built on One Connect</span>
        </div>
      </div>
      {/* The wordmark, cut by the bottom of the page, the F6 mark beside it. */}
      <div
        className="flex select-none items-end justify-center font-serif leading-none tracking-tight"
        style={{ fontSize: "clamp(5rem, 19vw, 18rem)", marginBottom: "-0.22em" }}
      >
        <span className="mr-[0.06em] mb-[0.16em]" aria-hidden>
          <Logo size="0.62em" />
        </span>
        <span className="pointer-events-none text-foreground/[0.06]" aria-hidden>
          Forkable
        </span>
      </div>
    </footer>
  );
}
