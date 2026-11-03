import { Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { AccountMenu } from "@/components/connect/AccountMenu";
import { Button } from "@/components/ui/button";
import { useMe } from "@/lib/me";
import { NAV } from "@/lib/nav";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * The frame of every signed-in page: the app name, the links from
 * src/lib/nav.ts, the account and the theme toggle. Pages put a PageHeader
 * first, then their sections.
 *
 *   <AppShell><PageHeader title="Notes" ... />...</AppShell>
 *
 * `width="narrow"` for forms and reading pages, "wide" for big tables.
 */
export function AppShell({ children, width = "default" }: { children: ReactNode; width?: "narrow" | "default" | "wide" }) {
  const me = useMe();
  const signedIn = Boolean(me.data?.user);
  const links = NAV.filter((n) => !n.signedIn || signedIn);
  return (
    <div className="flex min-h-full flex-col">
      <header className="hairline-b sticky top-0 z-20 bg-background/85 backdrop-blur">
        <div className={cn("mx-auto flex h-12 items-center gap-6 px-6", width === "wide" ? "max-w-6xl" : "max-w-5xl")}>
          <Brand />
          {links.length > 1 && (
            <nav aria-label="Main" className="-mx-1 flex min-w-0 items-center gap-0.5 overflow-x-auto scrollbar-none">
              {links.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.to === "/"}
                  className={({ isActive }) =>
                    cn("whitespace-nowrap rounded-md px-2.5 py-1 text-13 transition-colors", isActive ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {n.label}
                </NavLink>
              ))}
            </nav>
          )}
          <div className="ml-auto flex items-center gap-1">
            <AccountMenu />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className={cn("mx-auto w-full flex-1 px-6 py-8", width === "narrow" ? "max-w-2xl" : width === "wide" ? "max-w-6xl" : "max-w-5xl")}>{children}</main>
    </div>
  );
}

/**
 * The frame for pages visitors use without signing in (a signup, a contact
 * or support form, a public board): a light header and a centered column.
 * Visitors see no staff links. A signed-in person (staff on the public home
 * page) also gets the `signedIn: true` links from src/lib/nav.ts and the
 * account, so the staff pages are always one click away.
 */
export function PublicShell({ children, width = "narrow" }: { children: ReactNode; width?: "narrow" | "default" }) {
  const me = useMe();
  const signedIn = Boolean(me.data?.user);
  const staff = signedIn ? NAV.filter((n) => n.signedIn) : [];
  return (
    <div className="flex min-h-full flex-col">
      <header className="mx-auto flex h-14 w-full max-w-5xl items-center gap-6 px-6">
        <Brand />
        {staff.length > 0 && (
          <nav aria-label="Staff" className="-mx-1 flex min-w-0 items-center gap-0.5 overflow-x-auto scrollbar-none">
            {staff.map((n) => (
              <NavLink key={n.to} to={n.to} className="whitespace-nowrap rounded-md px-2.5 py-1 text-13 text-muted-foreground transition-colors hover:text-foreground">
                {n.label}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-1">
          {signedIn && <AccountMenu />}
          <ThemeToggle />
        </div>
      </header>
      <main className={cn("mx-auto w-full flex-1 px-6 pb-16 pt-8", width === "narrow" ? "max-w-xl" : "max-w-3xl")}>{children}</main>
      <footer className="mx-auto w-full max-w-5xl px-6 pb-8 text-11 text-muted-foreground">Acme Inc</footer>
    </div>
  );
}

function Brand() {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2 font-semibold">
      <span className="flex size-6 items-center justify-center rounded-md bg-foreground text-11 font-bold text-background">A</span>
      <span className="text-13">Acme Inc</span>
    </Link>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  return (
    <Button variant="ghost" size="icon" aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}
