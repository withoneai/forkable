import { Github, Moon, Sun } from "lucide-react";
import { Logo } from "./Logo";
import { useTheme } from "../lib/hooks";

const LINKS = [
  { href: "#integrations", label: "Integrations" },
  { href: "#templates", label: "Templates" },
  { href: "#blocks", label: "Blocks" },
  { href: "#chat", label: "In chat" },
  { href: "#fork", label: "How it works" },
  { href: "#publish", label: "Publish" },
  { href: "/contribute", label: "Contribute" },
];

// A floating pill, centred, glass over whatever scrolls under it.
export function Header({ home = true }: { home?: boolean }) {
  const [theme, toggle] = useTheme();
  // Off the home page, the section anchors point back at it.
  const to = (href: string) => (home || !href.startsWith("#") ? href : `/${href}`);
  return (
    <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4">
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-4 rounded-full border border-border bg-background/70 py-2 pl-4 pr-2 backdrop-blur-xl">
        <a href={home ? "#top" : "/"} className="group flex items-center gap-2" aria-label="Forkable home">
          <Logo size={36} className="-my-1.5" />
          <span className="text-15 font-semibold tracking-tight">Forkable</span>
        </a>
        <div className="hidden items-center gap-1 lg:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={to(l.href)}
              className="whitespace-nowrap rounded-full px-3 py-1.5 text-13 text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <a
            href="https://github.com/withoneai/forkable"
            aria-label="Forkable on GitHub"
            className="hidden size-8 sm:grid place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
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
            href={to("#templates")}
            className="ml-1 whitespace-nowrap rounded-full bg-foreground px-4 py-1.5 text-13 font-medium text-background transition-opacity hover:opacity-90"
          >
            Browse templates
          </a>
        </div>
      </nav>
    </header>
  );
}
