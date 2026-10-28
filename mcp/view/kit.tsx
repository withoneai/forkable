import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import clsx from "clsx";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import AlertCircle from "lucide-react/dist/esm/icons/alert-circle";
import TrendingUp from "lucide-react/dist/esm/icons/trending-up";
import TrendingDown from "lucide-react/dist/esm/icons/trending-down";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import Inbox from "lucide-react/dist/esm/icons/inbox";
import { callTool, post } from "./runner-bridge";

// What a UI the agent writes can import as "@forkable/ui". Data comes only
// from runAction, which the server checks against the actions this render
// declared, on the user's grant. Writes wait for the person's confirmation
// in the shell around this frame; if they cancel, the call throws "cancelled".
//
// Every component sits on the tokens in runner.html and the ladder in
// design/SPACING.md: type 11/13/15 (+ text-lg, text-28 for numbers), spacing
// 0.5/1/1.5/2/2.5/3/4/6. Light and dark come from the tokens, never from here.

// ---- Data ---------------------------------------------------------------

export class ActionError extends Error {
  constructor(readonly status: number, readonly refused: string | null, message: string) {
    super(message);
  }
}

export type ActionInput = { query?: Record<string, string>; body?: unknown; pathParams?: Record<string, string | number | boolean>; headers?: Record<string, string> };

export async function runAction<T = any>(actionId: string, input: ActionInput = {}): Promise<T> {
  const res = await callTool("run_action", { actionId, input });
  const out = (res.structuredContent ?? {}) as { status?: number; data?: T; refused?: string | null; message?: string };
  if ((out.status ?? 500) >= 400) throw new ActionError(out.status ?? 500, out.refused ?? null, out.message ?? `Action failed (${out.status})`);
  return out.data as T;
}

export function useAction<T = any>(actionId: string | null, input: ActionInput = {}, deps: unknown[] = []) {
  const [state, set] = useState<{ data: T | null; loading: boolean; error: ActionError | null }>({ data: null, loading: !!actionId, error: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const key = JSON.stringify([actionId, input, deps]);
  useEffect(() => {
    if (!actionId) return;
    let live = true;
    set((s) => ({ ...s, loading: true, error: null }));
    runAction<T>(actionId, input)
      .then((data) => live && set({ data, loading: false, error: null }))
      .catch((e) => live && set({ data: null, loading: false, error: e instanceof ActionError ? e : new ActionError(0, null, String(e)) }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  return { ...state, reload };
}

export const cn = (...c: Parameters<typeof clsx>) => clsx(...c);

export const ask = (text: string) => post({ type: "ask", text: String(text) });
export const openLink = (url: string) => post({ type: "open", url: String(url) });

export function timeAgo(iso: string | number): string {
  const t = typeof iso === "number" ? (iso < 1e12 ? iso * 1000 : iso) : new Date(iso).getTime();
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d` : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const useLatest = <T,>(v: T) => {
  const r = useRef(v);
  r.current = v;
  return r;
};

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

// ---- Layout -------------------------------------------------------------

type Heading = { title?: ReactNode; description?: ReactNode; actions?: ReactNode };

/** The page title row: title, one line of description, actions on the right. */
export function Header({ title, description, actions, icon, className }: Heading & { icon?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start gap-3", className)}>
      {icon && <div className="flex shrink-0 pt-0.5">{icon}</div>}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title && <h1 className="m-0 truncate text-lg font-semibold tracking-tight">{title}</h1>}
        {description && <p className="m-0 text-13 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** The outer frame of a UI: padding, a Header when given a title, 16px between sections. */
export function Page({ title, description, actions, icon, className, children }: Heading & { icon?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-4 p-4", className)}>
      {(title || actions) && <Header title={title} description={description} actions={actions} icon={icon} />}
      {children}
    </div>
  );
}

/** A titled group inside a Page. */
export function Section({ title, description, actions, className, children }: Heading & { className?: string; children?: ReactNode }) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      {(title || actions) && (
        <div className="flex min-h-8 items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-col">
            {title && <h2 className="m-0 truncate text-13 font-semibold">{title}</h2>}
            {description && <p className="m-0 text-11 text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** A row of controls: filters, search, buttons. Put <Spacer /> before what goes right. */
export const Toolbar = ({ className, children }: { className?: string; children?: ReactNode }) => (
  <div role="toolbar" className={cn("flex flex-wrap items-center gap-2", className)}>
    {children}
  </div>
);
export const Spacer = () => <div className="flex-1" aria-hidden="true" />;

export function Card({ title, description, actions, className, children }: Heading & { className?: string; children?: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-lg border border-border bg-card p-3", className)}>
      {(title || actions) && (
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col">
            {title && <div className="truncate text-13 font-semibold">{title}</div>}
            {description && <div className="text-11 text-muted-foreground">{description}</div>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

// ---- Numbers ------------------------------------------------------------

/** One number with its label. tone colors the delta: positive, negative or neutral. */
export function Stat({
  label,
  value,
  delta,
  tone = "neutral",
  hint,
  icon,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  tone?: "positive" | "negative" | "neutral";
  hint?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  const Trend = tone === "positive" ? TrendingUp : tone === "negative" ? TrendingDown : null;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card p-3", className)}>
      <div className="flex items-center gap-1.5 text-11 text-muted-foreground">
        {icon && <span className="flex shrink-0 [&>svg]:size-3.5">{icon}</span>}
        <span className="truncate">{label}</span>
      </div>
      <div className="truncate text-28 font-semibold tracking-tight tabular-nums">{value}</div>
      {(delta || hint) && (
        <div className="flex items-center gap-1.5 text-11 text-muted-foreground">
          {delta && (
            <span className={cn("inline-flex items-center gap-0.5 font-medium tabular-nums", tone === "positive" && "text-accent", tone === "negative" && "text-danger")}>
              {Trend && <Trend className="size-3" aria-hidden="true" />}
              {delta}
            </span>
          )}
          {hint && <span className="truncate">{hint}</span>}
        </div>
      )}
    </div>
  );
}

const COLS: Record<number, string> = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 md:grid-cols-4" };
/** Stats side by side: two across on narrow frames, cols across from 640px. */
export const StatGrid = ({ cols = 3, className, children }: { cols?: 2 | 3 | 4; className?: string; children?: ReactNode }) => (
  <div className={cn("grid grid-cols-2 gap-3", COLS[cols], className)}>{children}</div>
);

// ---- Tables and lists ---------------------------------------------------

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell content; defaults to row[key]. */
  render?: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Takes the spare width and truncates. Give it to one text column. */
  grow?: boolean;
  className?: string;
}

/** A data table. Rows are keyboard reachable when onRowClick is set. */
export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading,
  empty,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey?: (row: T, i: number) => string | number;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: ReactNode;
  className?: string;
}) {
  const cell = (c: Column<T>) => cn("px-3", c.align === "right" ? "text-right" : "text-left", c.grow ? "w-full max-w-0" : "whitespace-nowrap", c.className);
  return (
    <div className={cn("overflow-x-auto rounded-lg border border-border", className)}>
      <table className="w-full border-collapse text-13">
        <thead className="bg-card">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn(cell(c), "h-8 text-11 font-medium text-muted-foreground")}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? [0, 1, 2].map((i) => (
                <tr key={i} className="border-t border-border">
                  {columns.map((c) => (
                    <td key={c.key} className={cn(cell(c), "h-10")}>
                      <Skeleton className="h-3 w-full min-w-8" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row, i) => (
                <tr
                  key={rowKey ? rowKey(row, i) : i}
                  className={cn("border-t border-border", onRowClick && cn("cursor-pointer hover:bg-card", focus, "focus-visible:-outline-offset-2"))}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onRowClick(row)) : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn(cell(c), "h-10")}>
                      <div className={cn(c.grow && "truncate")}>{c.render ? c.render(row) : String((row as any)[c.key] ?? "")}</div>
                    </td>
                  ))}
                </tr>
              ))}
          {!loading && rows.length === 0 && (
            <tr className="border-t border-border">
              <td colSpan={columns.length} className="p-0">
                {empty ?? <EmptyState title="Nothing here" compact />}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** A bordered list of Rows. Shows `empty` (or a plain EmptyState) when it has no children. */
export function List({ empty, className, children }: { empty?: ReactNode; className?: string; children?: ReactNode }) {
  const has = Children.toArray(children).some(isValidElement);
  if (!has) return <div className={cn("rounded-lg border border-border", className)}>{empty ?? <EmptyState title="Nothing here" compact />}</div>;
  return <ul className={cn("m-0 flex list-none flex-col divide-y divide-border overflow-hidden rounded-lg border border-border p-0", className)}>{children}</ul>;
}

/** One line in a List: leading (Avatar, AppLogo, icon), title, meta under it, trailing on the right. */
export function Row({
  leading,
  title,
  meta,
  trailing,
  onClick,
  selected,
  strong,
  className,
}: {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  /** Bold title, for unread or new items. */
  strong?: boolean;
  className?: string;
}) {
  const body = (
    <>
      {leading && <div className="flex shrink-0 items-center text-muted-foreground [&>svg]:size-4">{leading}</div>}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className={cn("truncate text-13", strong ? "font-semibold" : "font-medium")}>{title}</div>
        {meta && <div className="truncate text-11 text-muted-foreground">{meta}</div>}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-2 text-11 text-muted-foreground">{trailing}</div>}
    </>
  );
  const base = "flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left";
  return (
    <li className={cn("list-none", selected && "bg-card", className)}>
      {onClick ? (
        <button type="button" onClick={onClick} aria-pressed={selected} className={cn(base, "cursor-pointer border-0 bg-transparent text-foreground hover:bg-card", focus, "focus-visible:-outline-offset-2")}>
          {body}
        </button>
      ) : (
        <div className={base}>{body}</div>
      )}
    </li>
  );
}

/** The no-data state: an icon, one line, an optional next step. */
export function EmptyState({ icon, title, description, action, compact, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; compact?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-4 text-center", compact ? "py-6" : "py-12", className)}>
      <div className="grid size-8 place-items-center rounded-md border border-border bg-card text-muted-foreground [&>svg]:size-4">{icon ?? <Inbox aria-hidden="true" />}</div>
      <div className="flex flex-col gap-0.5">
        <div className="text-13 font-medium">{title}</div>
        {description && <div className="max-w-xs text-13 text-muted-foreground">{description}</div>}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

// ---- Forms --------------------------------------------------------------

const FieldCtx = createContext<{ id: string; describedBy?: string; invalid: boolean } | null>(null);

/** Label, control, hint or error. The control inside gets its id and aria wiring. */
export function Field({ label, hint, error, required, className, children }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; required?: boolean; className?: string; children: ReactNode }) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <FieldCtx.Provider value={{ id, describedBy: hint || error ? noteId : undefined, invalid: !!error }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label htmlFor={id} className="text-13 font-medium">
          {label}
          {required && <span className="text-muted-foreground"> (required)</span>}
        </label>
        {children}
        {(error || hint) && (
          <p id={noteId} className={cn("m-0 text-11", error ? "text-danger" : "text-muted-foreground")}>
            {error || hint}
          </p>
        )}
      </div>
    </FieldCtx.Provider>
  );
}

function useField(id?: string, invalid?: boolean) {
  const f = useContext(FieldCtx);
  return { id: id ?? f?.id, "aria-describedby": f?.describedBy, "aria-invalid": (invalid ?? f?.invalid) || undefined };
}
const control = cn(
  "w-full min-w-0 rounded-md border border-border bg-raised text-13 text-foreground placeholder:text-muted-foreground",
  "hover:border-strong focus:border-strong aria-[invalid=true]:border-danger disabled:opacity-50",
  focus,
);

/** A text input. `leading` puts an icon inside on the left (e.g. Search). */
export function Input({ leading, invalid, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { leading?: ReactNode; invalid?: boolean }) {
  const a = useField(p.id, invalid);
  const input = <input {...p} {...a} className={cn(control, "h-8 px-2.5", leading && "pl-8", !leading && className)} />;
  if (!leading) return input;
  return (
    <div className={cn("relative min-w-0", className)}>
      <span className="pointer-events-none absolute top-1/2 left-2.5 flex -translate-y-1/2 text-muted-foreground [&>svg]:size-3.5">{leading}</span>
      {input}
    </div>
  );
}

export function Textarea({ invalid, className, rows = 4, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  const a = useField(p.id, invalid);
  return <textarea rows={rows} {...p} {...a} className={cn(control, "resize-y px-2.5 py-1.5 leading-5", className)} />;
}

type Option = string | { value: string; label: string };
/** A native select, styled. Pass options, or <option> children. */
export function Select({ options, invalid, className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options?: Option[]; invalid?: boolean }) {
  const a = useField(p.id, invalid);
  return (
    <div className={cn("relative min-w-0", className)}>
      <select {...p} {...a} className={cn(control, "h-8 cursor-pointer appearance-none pr-8 pl-2.5")}>
        {options?.map((o) => (typeof o === "string" ? <option key={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    </div>
  );
}

// ---- Navigation ---------------------------------------------------------

/** Segmented tabs. Controlled: value + onChange. Arrow keys move between tabs. */
export function Tabs({ tabs, value, onChange, className }: { tabs: { id: string; label: ReactNode; count?: number }[]; value: string; onChange: (id: string) => void; className?: string }) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = tabs.findIndex((t) => t.id === value);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    onChange(next.id);
    (e.currentTarget.querySelector(`[data-tab="${next.id}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div role="tablist" onKeyDown={onKey} className={cn("inline-flex w-max max-w-full items-center gap-0.5 overflow-x-auto rounded-md border border-border bg-card p-0.5", className)}>
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-tab={t.id}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-sm border-0 px-2.5 text-13 font-medium",
              on ? "bg-raised text-foreground shadow-soft" : "bg-transparent text-muted-foreground hover:text-foreground",
              focus,
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="text-11 text-muted-foreground tabular-nums">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---- Small pieces -------------------------------------------------------

export const Skeleton = ({ className }: { className?: string }) => <div className={cn("animate-pulse rounded-md bg-card", className)} />;

export function ErrorState({ error, onRetry }: { error: { message: string; refused?: string | null } | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-border bg-card p-3 text-13">
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{error.refused === "outside_grant" ? "Outside your grant" : error.refused === "cancelled" ? "Cancelled" : "Could not load this"}</span>
        <span className="text-muted-foreground">{error.message}</span>
      </div>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

const BADGE = {
  neutral: "border-border text-muted-foreground",
  outline: "border-strong text-foreground",
  accent: "border-transparent bg-primary text-primary-foreground",
  danger: "border-danger text-danger",
};
export const Badge = ({ variant = "neutral", className, children }: { variant?: keyof typeof BADGE; className?: string; children?: ReactNode }) => (
  <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-11 leading-none font-medium whitespace-nowrap [&>svg]:size-3", BADGE[variant], className)}>{children}</span>
);

const BUTTON = {
  primary: "border-transparent bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-press",
  secondary: "border-border bg-raised text-foreground hover:border-strong",
  ghost: "border-transparent bg-transparent text-foreground hover:bg-card",
  danger: "border-border bg-raised text-danger hover:border-danger",
};
const SIZE = { sm: "h-7 gap-1 px-2.5 text-11 [&>svg]:size-3.5", md: "h-8 gap-1.5 px-3 text-13 [&>svg]:size-4", icon: "size-8 justify-center p-0 [&>svg]:size-4" };

/** primary: the one main action (lime fill). secondary: bordered. ghost (default): quiet. danger: destructive. */
export function Button({
  variant = "ghost",
  size = "md",
  loading,
  className,
  children,
  disabled,
  type = "button",
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON; size?: keyof typeof SIZE; loading?: boolean }) {
  return (
    <button
      {...p}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center rounded-md border font-medium whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-50",
        BUTTON[variant],
        SIZE[size],
        focus,
        className,
      )}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

const initials = (name: string) =>
  name
    .replace(/[<>"@].*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

const PX = { sm: "size-5 text-10", md: "size-7 text-11", lg: "size-9 text-13" };

/** A picture, or initials when there is none or it cannot load. */
export function Avatar({ name, src, size = "md", className }: { name: string; src?: string | null; size?: keyof typeof PX; className?: string }) {
  const [img, setImg] = useState<"loading" | "ok" | "failed">("loading");
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-card font-semibold text-muted-foreground", PX[size], className)} title={name} aria-label={name} role="img">
      {initials(name)}
      {src && img !== "failed" && (
        <img src={src} alt="" className={cn("absolute inset-0 size-full object-cover", img === "ok" ? "opacity-100" : "opacity-0")} onLoad={() => setImg("ok")} onError={() => setImg("failed")} />
      )}
    </span>
  );
}

const platformName = (p: string) => p.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
const TILE = { sm: "size-5 rounded-sm text-10", md: "size-7 rounded-md text-11", lg: "size-9 rounded-md text-13" };

/** A platform's logo (gmail, stripe, hubspot...). Shows its first letter when the image is blocked. */
export function AppLogo({ platform, size = "md", className }: { platform: string; size?: keyof typeof TILE; className?: string }) {
  // The letter stays until the logo has loaded; a blocked image never covers it.
  const [img, setImg] = useState<"loading" | "ok" | "failed">("loading");
  const name = platformName(platform);
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden border border-border bg-raised font-semibold text-foreground", TILE[size], className)} title={name} aria-label={name} role="img">
      {name.charAt(0) || "?"}
      {img !== "failed" && (
        <img
          src={`https://assets.withone.ai/connectors/${encodeURIComponent(platform)}.svg`}
          alt=""
          className={cn("absolute inset-0 size-full bg-raised object-contain p-px", img === "ok" ? "opacity-100" : "opacity-0")}
          onLoad={() => setImg("ok")}
          onError={() => setImg("failed")}
        />
      )}
    </span>
  );
}
