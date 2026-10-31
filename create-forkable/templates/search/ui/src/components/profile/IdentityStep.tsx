// The parts of the Check step that are not the field map: the refresh and
// start-from controls, and Advanced (record id, link, title when empty). Every
// verdict reads the server's ValidationReport, so what shows is what Save enforces.
import { AlertTriangle, Check, ChevronDown, ExternalLink, X } from "lucide-react";
import { useState } from "react";
import type { ValidationIssue, ValidationReport } from "@/contract/api-types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Menu } from "@/components/ui/Menu";
import { fieldName, getPath, renderTpl, showValue } from "./fieldmap";

export interface Identity { idPath: string; urlTemplate: string; titleTemplate: string; every: string; cron: string; backfill: "30d" | "365d" | "all"; incremental: string | null }

export const SCHEDULES = [
  { key: "5m", label: "Every 5 min" }, { key: "15m", label: "15 min" }, { key: "60m", label: "Hourly" }, { key: "1d", label: "Daily" }, { key: "custom", label: "Custom" },
] as const;
export const BACKFILLS = [{ key: "30d", label: "30 days" }, { key: "365d", label: "1 year" }, { key: "all", label: "Everything" }] as const;

/** "Checks HubSpot once a day for new and changed leads." */
export function refreshSentence(id: Identity, platform: string, noun: string): string {
  const when = id.every === "custom" ? `on the schedule ${id.cron || "you set"}` : id.every === "1d" ? "once a day" : id.every === "60m" ? "every hour" : `every ${id.every.replace("m", "")} minutes`;
  return `Checks ${platform} ${when} for ${id.incremental ? "new and changed" : "all"} ${noun}s.`;
}

export function Segmented<K extends string>({ value, options, onChange, label }: { value: K; options: readonly { key: K; label: string }[]; onChange: (k: K) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-border bg-faint p-0.5">
      {options.map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={value === o.key} onClick={() => onChange(o.key)}
          className={cn("h-full rounded-md px-2.5 text-xs font-medium transition-colors", value === o.key ? "bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-muted-foreground hover:text-foreground")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-[180px_minmax(0,1fr)] md:gap-6">
      <div>
        <p className="text-13 font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const issueFor = (r: ValidationReport | null, check: ValidationIssue["check"], pid: string) => r?.issues.find((i) => i.check === check && (!i.profileId || i.profileId === pid));

/** Advanced: the record id, the link and the title when a record has none. Most people never open it. */
export function AdvancedFields({ pid, identity, onChange, samples, paths, report, checking, platform, noun }: {
  pid: string; identity: Identity; onChange: (p: Partial<Identity>) => void; samples: unknown[]; paths: string[];
  report: ValidationReport | null; checking: boolean; platform: string; noun: string;
}) {
  const [idMenu, setIdMenu] = useState(false);
  const resolved = renderTpl(identity.urlTemplate, samples[0]);
  const idIssue = issueFor(report, "id", pid);
  const linkIssue = issueFor(report, "link", pid);
  return (
    <div className="flex flex-col gap-5">
      <Row label="Record id" hint={`How Search tells ${noun}s apart. Leave it as is.`}>
        <div className="flex items-center gap-3">
          <Menu open={idMenu} onClose={() => setIdMenu(false)} className="max-h-[260px] w-[280px] overflow-y-auto"
            items={paths.map((p) => ({ key: p, label: <span className="text-xs">{fieldName(p)} <span className="font-mono text-11 text-muted-foreground">{p}</span></span>, hint: showValue(getPath(samples[0], p), 18), onSelect: () => onChange({ idPath: p }) }))}
            anchor={
              <button type="button" aria-haspopup="menu" aria-expanded={idMenu} onClick={() => setIdMenu((v) => !v)} data-testid="id-field"
                className="flex h-8 w-[240px] items-center gap-2 rounded-md border border-border bg-card px-2.5 text-left text-xs hover:border-border-strong">
                <span className="flex-1 truncate">{identity.idPath ? fieldName(identity.idPath) : "Pick a field"}</span>
                <ChevronDown className="size-3 text-muted-foreground" />
              </button>
            } />
          <Verdict issue={idIssue} checking={checking} />
        </div>
      </Row>

      <Row label={`Open in ${platform}`} hint="Where a result goes when you open it.">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Input mono value={identity.urlTemplate} onChange={(e) => onChange({ urlTemplate: e.target.value })} placeholder="No link" aria-label="Link template" data-testid="link-template" />
            <Button size="sm" icon={<ExternalLink />} disabled={!resolved?.startsWith("https://")} onClick={() => resolved && window.open(resolved, "_blank", "noopener")}>Try it</Button>
            {identity.urlTemplate && <Button size="sm" variant="ghost" onClick={() => onChange({ urlTemplate: "" })}>Clear</Button>}
          </div>
          {identity.urlTemplate && (
            <p className="flex min-w-0 items-center gap-1.5 text-11 text-muted-foreground">
              <span className="shrink-0">First {noun}:</span>
              <span className={cn("truncate font-mono", resolved ? "text-foreground" : "text-destructive-text")}>{resolved ?? "does not resolve"}</span>
            </p>
          )}
          <Verdict issue={linkIssue} checking={checking} />
        </div>
      </Row>

      <Row label="Title when empty" hint={`Used when a ${noun} has no title of its own. Optional.`}>
        <Input mono value={identity.titleTemplate} onChange={(e) => onChange({ titleTemplate: e.target.value })} placeholder={`${noun[0]!.toUpperCase()}${noun.slice(1)} {{ item.id }}`} aria-label="Title template" />
      </Row>
    </div>
  );
}

export function Verdict({ issue, checking }: { issue: ValidationIssue | undefined; checking: boolean }) {
  if (checking && !issue) return <span className="text-11 text-muted-foreground">Checking...</span>;
  if (!issue) return null;
  const tone = issue.level === "ok" ? "text-success-text" : issue.level === "warn" ? "text-warning-text" : "text-destructive-text";
  const Icon = issue.level === "ok" ? Check : issue.level === "warn" ? AlertTriangle : X;
  return <span className={cn("flex items-center gap-1 text-11 font-medium", tone, checking && "opacity-60")}><Icon className="size-3" />{issue.message}</span>;
}
