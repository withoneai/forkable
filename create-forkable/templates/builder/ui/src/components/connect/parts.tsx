// Shared pieces of One Connect (CONTRACT 18): the copyable redirect URI, the
// Check result, and a saved Connect app's one-line summary. A Connect app is
// shown by its name, whether its values are set, the last four of its client
// id and the projects that use it, never a value.

import { useState } from "react";
import { AlertTriangle, Check, Copy, ShieldCheck, X } from "lucide-react";
import type { ConnectCheckResponse, ConnectSetupInfo } from "@builder/core/api-types";
import { CONNECT_VAR_SPECS } from "@builder/core/envvars";
import { cn, copyText } from "@/lib/utils";
import { Badge, Button } from "@/components/ui";

export function CopyValue({ value, label, testId = "redirect-uri", className }: { value: string; label: string; testId?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-faint py-1 pl-2.5 pr-1", className)}>
      <code className="min-w-0 flex-1 select-all truncate font-mono text-xs" data-testid={testId} title={value}>{value}</code>
      <Button
        size="sm"
        variant="ghost"
        icon={done ? <Check /> : <Copy />}
        aria-label={label}
        onClick={async () => {
          if (await copyText(value)) {
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          }
        }}
      >
        {done ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function CheckResult({ r, className }: { r: ConnectCheckResponse; className?: string }) {
  const tone = r.online === "accepted" ? "ok" : r.online === "refused" ? "error" : r.ok ? "ok" : "error";
  return (
    <div className={cn("slide-up overflow-hidden rounded-lg border border-border bg-card", className)} data-testid="check-result" role="status">
      <div className={cn("flex items-start gap-2 border-b border-border px-4 py-2.5", tone === "error" ? "bg-destructive-text/8" : "bg-success-text/8")}>
        {tone === "error" ? <X className="mt-0.5 size-3.5 shrink-0 stroke-[2.25] text-destructive-text" /> : <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success-text" />}
        <div className="min-w-0">
          <p className="text-xs font-medium">{r.ok ? (r.online === "accepted" ? "Ready to sign in" : "The values look right") : "Not ready yet"}</p>
          {r.onlineMessage && <p className="text-11 text-muted-foreground">{r.onlineMessage}</p>}
        </div>
      </div>
      {r.items.map((i) => {
        const spec = CONNECT_VAR_SPECS.find((s) => s.name === i.name);
        return (
          <div key={i.name} className="flex items-center gap-2 border-b border-border px-4 py-1.5 text-11 last:border-b-0">
            {i.level === "ok" ? <Check className="size-3.5 shrink-0 stroke-[2.25] text-success-text" /> : i.level === "warn" ? <AlertTriangle className="size-3.5 shrink-0 text-warning-text" /> : <X className="size-3.5 shrink-0 stroke-[2.25] text-destructive-text" />}
            <span className="w-24 shrink-0 font-medium">{spec?.label ?? i.name}</span>
            <span className="min-w-0 truncate text-muted-foreground">{i.message}</span>
          </div>
        );
      })}
    </div>
  );
}

/** "used by 2 projects": the names in the title, the count on screen. */
export function usedByLabel(s: ConnectSetupInfo): string {
  const n = s.usedBy.length;
  return n === 0 ? "Not used yet" : `Used by ${n} project${n === 1 ? "" : "s"}`;
}

export function clientHint(s: ConnectSetupInfo): string | null {
  return s.vars.find((v) => v.name === "ONE_CLIENT_ID")?.hint ?? null;
}

/** Ready / Needs values, and Sample for the keyless stand-in. */
export function SetupBadges({ s }: { s: ConnectSetupInfo }) {
  return (
    <>
      <Badge tone={s.configured ? "success" : "warning"}>{s.configured ? "Ready" : "Needs values"}</Badge>
      {s.sample && <Badge tone="outline">Sample</Badge>}
    </>
  );
}

/** The meta line under a Connect app's name. */
export function SetupMeta({ s, className }: { s: ConnectSetupInfo; className?: string }) {
  const hint = clientHint(s);
  return (
    <p className={cn("flex min-w-0 flex-wrap items-center gap-x-1.5 text-11 text-muted-foreground", className)}>
      {hint ? <span>Client ID <span className="font-mono">{hint}</span></span> : <span>No client ID yet</span>}
      <span aria-hidden>·</span>
      <span title={s.usedBy.map((u) => u.name).join(", ") || undefined} data-testid="used-by">{usedByLabel(s)}</span>
    </p>
  );
}
