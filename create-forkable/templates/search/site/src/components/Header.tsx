import { Github, Moon, Sun } from "lucide-react";
import { Logo } from "./Logo";
import { useTheme } from "../lib/hooks";
import { FORKABLE_URL, REPO_URL } from "../lib/links";

const LINKS = [
  { href: "#integrations", label: "Integrations" },
  { href: "#search", label: "Search" },
  { href: "#surfaces", label: "CLI, API, MCP" },
  { href: "#fork", label: "Fork it" },
];

// A floating pill, centred, glass over whatever scrolls under it. Same
// shape as Rill's and Forkable's header.
export function Header() {
  const [theme, toggle] = useTheme();
  return (
    <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4">
      <nav className="mx-auto flex max-w-4xl items-center justify-between gap-4 rounded-full border border-border bg-background/70 py-2 pl-4 pr-2 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <a href="#top" className="flex items-center gap-2" aria-label="Search home">
            <Logo size={24} />
            <span className="text-15 font-semibold tracking-tight">Search</span>
          </a>
          <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />
          <a
            href={FORKABLE_URL}
            className="hidden text-11 text-muted-foreground transition-colors hover:text-foreground sm:block"
          >
            Part of Forkable
          </a>
        </div>
        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-full px-3 py-1.5 text-13 text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <a
            href={REPO_URL}
            aria-label="Search on GitHub"
            className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
          >
            <Github className="size-4" strokeWidth={1.75} />
          </a>
          <button
            type="button"
            data-theme-toggle
            onClick={toggle}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="t-icon-swap" data-state={theme === "dark" ? "a" : "b"}>
              <span className="t-icon" data-icon="a">
                <Sun className="size-4" strokeWidth={1.75} />
              </span>
              <span className="t-icon" data-icon="b">
                <Moon className="size-4" strokeWidth={1.75} />
              </span>
            </span>
          </button>
          <a
            href="#fork"
            className="ml-1 rounded-full bg-foreground px-4 py-1.5 text-13 font-medium text-background transition-opacity hover:opacity-90"
          >
            Get Search
          </a>
        </div>
      </nav>
    </header>
  );
}
