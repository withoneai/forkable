import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "general", label: "General" },
  { to: "goals", label: "Goals" },
  { to: "vips", label: "VIPs" },
  { to: "calendars", label: "Calendars" },
  { to: "engine", label: "Engine" },
  { to: "database", label: "Database" },
];

export function SettingsLayout() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-6 pb-12 pt-7">
        <header className="flex flex-col gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <nav className="flex items-center gap-0.5 border-b border-border" aria-label="Settings sections">
            {TABS.map((t) => (
              <NavLink key={t.to} to={t.to} className={({ isActive }) => cn("relative -mb-px inline-flex h-8 items-center px-2.5 text-13 font-medium transition-colors", isActive ? "text-foreground after:absolute after:inset-x-2.5 after:bottom-0 after:h-[2px] after:rounded-t-full after:bg-foreground" : "text-muted-foreground hover:text-foreground")}>
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

export function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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
