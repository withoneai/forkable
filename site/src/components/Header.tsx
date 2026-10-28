import { useEffect, useState } from "react";
import clsx from "clsx";
import { Github, Menu, Moon, Sun, X } from "lucide-react";
import { Logo } from "./Logo";
import { useTheme } from "../lib/hooks";

type NavLink = { href: string; label: string; isNew?: boolean };

const LINKS: NavLink[] = [
  { href: "#integrations", label: "Integrations" },
  { href: "#templates", label: "Templates" },
  { href: "#blocks", label: "Blocks" },
  { href: "/mcp", label: "MCP", isNew: true },
  { href: "#fork", label: "How it works" },
  { href: "#publish", label: "Publish" },
  { href: "/contribute", label: "Contribute" },
];

// A floating pill, centred, glass over whatever scrolls under it.
// The lime "New" chip beside the MCP link, so the page is easy to find.
function NewChip() {
  return <span className="rounded-full bg-accent-fill px-1.5 py-px text-10 font-medium leading-4 text-accent-ink">New</span>;
}

export function Header({ home = true, current }: { home?: boolean; current?: string }) {
  const [theme, toggle] = useTheme();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
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
              aria-current={current === l.href ? "page" : undefined}
              className={clsx(
                "flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-13 transition-colors hover:text-foreground",
                current === l.href ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {l.label}
              {l.isNew && <NewChip />}
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
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close the menu" : "Open the menu"}
            className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground lg:hidden"
          >
            {open ? <X className="size-4" strokeWidth={1.75} /> : <Menu className="size-4" strokeWidth={1.75} />}
          </button>
        </div>
      </nav>
      {open && (
        <div
          id="mobile-nav"
          className="motion-in mx-auto mt-2 max-w-5xl rounded-2xl border border-border bg-background/90 p-2 backdrop-blur-xl lg:hidden"
        >
          <ul className="flex flex-col">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={to(l.href)}
                  onClick={() => setOpen(false)}
                  aria-current={current === l.href ? "page" : undefined}
                  className={clsx(
                    "flex items-center gap-2 rounded-xl px-3 py-2.5 text-15 transition-colors hover:bg-foreground/[0.04] hover:text-foreground",
                    current === l.href ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {l.label}
                  {l.isNew && <NewChip />}
                </a>
              </li>
            ))}
            <li>
              <a
                href="https://github.com/withoneai/forkable"
                className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-15 text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
              >
                <Github className="size-4" strokeWidth={1.75} />
                GitHub
              </a>
            </li>
          </ul>
        </div>
      )}
    </header>
  );
}
