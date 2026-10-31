// Source health in words (search-ux-mobbin.md 2.8): always dot + word, never colour alone.
import type { ApiSource, SourceHealth, SourceStatus } from "@/contract/api-types";
import { HealthDot } from "@/components/Shell";
import { cn, fmtAgo, fmtIn, fmtNum } from "@/lib/utils";

export const STATUS_WORD: Record<SourceStatus, string> = {
  healthy: "Healthy", syncing: "Syncing", new: "Starting", degraded: "Needs attention", rate_limited: "Rate limited",
  auth_needed: "Needs sign-in", grant_blocked: "Not in grant", awaiting_grant: "Waiting for grant", paused: "Paused", error: "Failed",
};

export const STATUS_TONE: Record<SourceStatus, string> = {
  healthy: "text-success-text", syncing: "text-foreground", new: "text-foreground", degraded: "text-warning-text", rate_limited: "text-warning-text",
  auth_needed: "text-destructive-text", grant_blocked: "text-destructive-text", awaiting_grant: "text-muted-foreground", paused: "text-muted-foreground", error: "text-destructive-text",
};

export function everyLabel(every: string): string {
  const m = /^(\d+)([mhd])$/.exec(every);
  if (!m) return every === "1d" ? "daily" : every;
  const n = Number(m[1]);
  if (m[2] === "m") return `every ${n} min`;
  if (m[2] === "h") return n === 1 ? "hourly" : `every ${n}h`;
  return n === 1 ? "daily" : `every ${n} days`;
}

/** "Synced 4 min ago · next in 11 min", or the live progress while a run is going. */
export function healthLine(h: SourceHealth): string {
  if ((h.status === "syncing" || h.status === "new") && h.progress) {
    const est = h.progress.estimate;
    return est && est >= h.progress.done ? `${fmtNum(h.progress.done)} of about ${fmtNum(est)}` : `${fmtNum(h.progress.done)} so far`;
  }
  if (h.status === "rate_limited" && h.retryAt) return `Trying again at ${new Date(h.retryAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  if (h.status === "paused") return h.lastSuccessAt ? `Last synced ${fmtAgo(h.lastSuccessAt)}` : "Not synced yet";
  if (h.status === "auth_needed") return `Indexing stopped ${fmtAgo(h.lastSuccessAt)}`;
  return `Synced ${fmtAgo(h.lastSuccessAt)}${h.nextRunAt ? ` · next ${fmtIn(h.nextRunAt)}` : ""}`;
}

export function StatusCell({ health, className }: { health: SourceHealth; className?: string }) {
  return (
    <span className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className={cn("flex items-center gap-1.5 text-13 font-medium", STATUS_TONE[health.status])}>
        <HealthDot status={health.status} />
        {STATUS_WORD[health.status]}
      </span>
      <span className="truncate text-11 text-muted-foreground">{healthLine(health)}</span>
    </span>
  );
}

export function StatusPill({ status }: { status: SourceStatus }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-xs font-medium", STATUS_TONE[status])}>
      <HealthDot status={status} />
      {STATUS_WORD[status]}
    </span>
  );
}

export const isProblem = (s: SourceStatus) => s === "auth_needed" || s === "grant_blocked" || s === "error" || s === "rate_limited" || s === "degraded";

/** Group sources by platform and connection (SPEC D27). */
export function groupSources(list: ApiSource[]): { key: string; platform: string; name: string; connectionLabel: string; sources: ApiSource[] }[] {
  const m = new Map<string, { key: string; platform: string; name: string; connectionLabel: string; sources: ApiSource[] }>();
  for (const s of list) {
    const key = `${s.platform}|${s.connectionLabel}`;
    if (!m.has(key)) m.set(key, { key, platform: s.platform, name: s.name, connectionLabel: s.connectionLabel, sources: [] });
    m.get(key)!.sources.push(s);
  }
  return [...m.values()];
}
