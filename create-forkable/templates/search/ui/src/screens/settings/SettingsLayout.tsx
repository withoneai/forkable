import { NavLink, Outlet, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

export { Select } from "@/components/ui/Select";

const TABS = [
  { to: "general", label: "General" },
  { to: "integrations", label: "Integrations" },
  { to: "search", label: "Search" },
  { to: "assistant", label: "Assistant" },
  { to: "database", label: "Database" },
  { to: "api", label: "API" },
];

export function SettingsLayout() {
  const loc = useLocation();
  const wide = loc.pathname.startsWith("/settings/integrations");
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cn("mx-auto flex w-full flex-col gap-6 px-6 pb-12 pt-7", wide ? "max-w-[960px]" : "max-w-[760px]")}>
        <header className="flex flex-col gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <nav className="flex items-center gap-0.5 border-b border-border" aria-label="Settings sections">
            {TABS.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) => cn(
                  "relative -mb-px inline-flex h-8 items-center px-2.5 text-13 font-medium transition-colors",
                  isActive ? "text-foreground after:absolute after:inset-x-2.5 after:bottom-0 after:h-[2px] after:rounded-t-full after:bg-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <Outlet />
      </div>
    </div>
  );
}

export function SectionTitle({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-15 font-semibold tracking-tight">{title}</h2>
        {hint && <p className="mt-0.5 max-w-[520px] text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function SettingRow({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-6 border-b border-border py-2.5 last:border-b-0">
      <div className="min-w-0">
        <p className="text-13 font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** A bordered card that holds SettingRows. */
export function SettingsCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-lg border border-border bg-card px-4", className)}>{children}</div>;
}

/** Segmented control for short choices (theme, size, tier). */
export function Segmented<K extends string>({ value, options, onChange, label }: { value: K; options: { key: K; label: string }[]; onChange: (k: K) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-7 items-center rounded-md border border-border bg-faint p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn("h-full rounded-sm px-2.5 text-xs font-medium transition-colors", value === o.key ? "bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-muted-foreground hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
