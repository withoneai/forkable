import { useState } from "react";
import { AlertTriangle, ChevronUp, CircleX, Wrench } from "lucide-react";
import type { ErrorSource, ProjectError } from "@builder/core/types";
import { humanError } from "@/lib/api";
import { useErrors, useFix } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn, fmtAgo, plural } from "@/lib/utils";
import { Badge, Button } from "@/components/ui";

export const SOURCE_LABEL: Record<ErrorSource, string> = {
  build: "Build", types: "Types", runtime: "Runtime", network: "Network", install: "Install", server: "Server", manifest: "Manifest", one: "One",
};

export function ConsoleStrip({ projectId, busy, onOpenFile }: { projectId: string; busy: boolean; onOpenFile: (path: string, line?: number | null) => void }) {
  const errors = useErrors(projectId);
  const fix = useFix(projectId);
  const [open, setOpen] = useState(false);
  const list: ProjectError[] = errors.data ?? [];
  const errs = list.filter((e) => e.severity === "error").length;
  const warns = list.length - errs;
  const fixable = list.filter((e) => e.source !== "one");

  const runFix = () =>
    fix.mutate(undefined, {
      onSuccess: () => { setOpen(false); toast({ title: "Fixing", detail: plural(fixable.length, "problem") }); },
      onError: (e) => toast({ title: "Could not start a fix", detail: humanError(e), tone: "destructive" }),
    });

  return (
    <div className={cn("shrink-0 border-t border-border bg-card", open && "shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.18)]")}>
      {open && list.length > 0 && (
        <div className="slide-up max-h-[38vh] overflow-y-auto border-b border-border" role="list" aria-label="Problems">
          {list.map((e) => (
            <div key={e.id} role="listitem" className="flex items-start gap-2.5 border-b border-border px-3 py-2 last:border-b-0">
              {e.severity === "error" ? <CircleX className="mt-0.5 size-3.5 shrink-0 stroke-[1.75] text-destructive-text" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0 stroke-[1.75] text-warning-text" />}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="break-words font-mono text-xs leading-5">{e.message}</p>
                <div className="flex flex-wrap items-center gap-1.5 text-11 text-muted-foreground">
                  <Badge tone="outline">{SOURCE_LABEL[e.source]}</Badge>
                  {e.file && (
                    <button type="button" onClick={() => onOpenFile(e.file!, e.line)} className="font-mono text-foreground underline-offset-2 hover:underline">
                      {e.file}{e.line ? `:${e.line}` : ""}{e.col ? `:${e.col}` : ""}
                    </button>
                  )}
                  {e.count > 1 && <span>{e.count} times</span>}
                  <span>{fmtAgo(e.lastSeen)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex h-8 items-center gap-3 px-3 text-xs">
        <button
          type="button"
          onClick={() => list.length && setOpen((v) => !v)}
          aria-expanded={open}
          className={cn("flex items-center gap-3 rounded-sm text-muted-foreground transition-colors", list.length && "hover:text-foreground")}
        >
          <span className={cn("inline-flex items-center gap-1", errs > 0 && "text-destructive-text")}><CircleX className="size-3.5 stroke-[1.75]" /><span className="tnum">{errs}</span></span>
          <span className={cn("inline-flex items-center gap-1", warns > 0 && "text-warning-text")}><AlertTriangle className="size-3.5 stroke-[1.75]" /><span className="tnum">{warns}</span></span>
          <span>{list.length === 0 ? "No problems" : plural(list.length, "problem")}</span>
          {list.length > 0 && <ChevronUp className={cn("size-3.5 transition-transform duration-100", !open && "rotate-180")} />}
        </button>
        {fixable.length > 0 && (
          <Button size="sm" className="ml-auto h-6" icon={<Wrench />} loading={fix.isPending} disabled={busy} title={busy ? "Wait for the agent to finish" : undefined} onClick={runFix}>
            Fix these
          </Button>
        )}
      </div>
    </div>
  );
}
