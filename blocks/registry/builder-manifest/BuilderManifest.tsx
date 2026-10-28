import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import clsx from "clsx";
import { OneClientError, oneFetch, type OneMeta } from "../lib/one-client";
import { Button, ErrorState, Skeleton, SourceChip } from "../lib/one-ui";
import type { ManifestResponse, SourceFile } from "../builder/types";

export interface BuilderManifestProps {
  /** The files to scan. Leave out to scan the Acme sample app (sample mode only). */
  files?: SourceFile[];
  className?: string;
}

/** connect.manifest.json from code, and everything that goes around the grant. */
export function BuilderManifest({ files, className }: BuilderManifestProps) {
  const [res, setRes] = useState<{ data: ManifestResponse; meta: OneMeta } | null>(null);
  const [err, setErr] = useState<OneClientError | null>(null);
  const [tab, setTab] = useState<"actions" | "json">("actions");
  const [copied, setCopied] = useState(false);
  const key = JSON.stringify(files?.map((f) => [f.path, f.content.length]) ?? null);

  const run = () => {
    setErr(null);
    oneFetch<ManifestResponse>("/api/builder/manifest", { method: "POST", body: { files: files ?? [] } })
      .then(setRes)
      .catch((e) => setErr(e instanceof OneClientError ? e : new OneClientError(0, "network", String(e))));
  };
  useEffect(run, [key]);

  const json = res ? JSON.stringify({ $schema: res.data.manifest.$schema, actions: res.data.manifest.actions.map(({ usedBy: _u, title: _t, method: _m, ...a }) => a) }, null, 2) : "";
  const errors = res?.data.issues.filter((i) => i.severity === "error").length ?? 0;

  return (
    <div data-block="builder-manifest" className={clsx("flex min-h-0 flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div role="tablist" className="inline-flex items-center gap-0.5 rounded-md border border-border bg-foreground/4 p-0.5">
          {(["actions", "json"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx("h-6 rounded-sm px-2 text-xs font-medium transition-colors", tab === t ? "bg-raised text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground")}>
              {t === "actions" ? "Actions" : "connect.manifest.json"}
            </button>
          ))}
        </div>
        {res && <span className="text-11 text-muted-foreground">{res.data.files} files, {res.data.manifest.actions.length} actions</span>}
        <span className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!res}
            onClick={() => {
              navigator.clipboard.writeText(json);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            Copy
          </Button>
          <SourceChip meta={res?.meta ?? null} />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {err ? (
          <div className="p-3">
            <ErrorState error={err} onRetry={run} />
          </div>
        ) : !res ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : tab === "json" ? (
          <pre className="p-3 font-mono text-11 leading-relaxed text-foreground">{json}</pre>
        ) : (
          <div className="flex flex-col gap-4 p-3">
            <ul className="overflow-hidden rounded-lg border border-border">
              {res.data.manifest.actions.map((a) => (
                <li key={a.actionId} className="flex items-center gap-2.5 border-b border-border px-3 py-2 last:border-b-0">
                  <img src={`https://assets.withone.ai/connectors/${a.platform}.svg`} alt="" className="size-4 shrink-0" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-13 text-foreground">{a.title ?? a.actionId}</span>
                    <span className="truncate font-mono text-10 text-muted-foreground">{a.usedBy.join(", ")}</span>
                  </span>
                  <span className={clsx("shrink-0 rounded-sm px-1.5 font-mono text-10 uppercase tracking-[0.05em]", a.access === "write" ? "bg-primary text-primary-foreground" : "bg-foreground/8 text-muted-foreground")}>{a.access}</span>
                </li>
              ))}
            </ul>
            {res.data.issues.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-11 font-medium text-muted-foreground">
                  {errors ? `${errors} to fix before publishing` : "Warnings"}
                </span>
                {res.data.issues.map((i, n) => (
                  <div key={n} className="flex items-start gap-2 rounded-md border border-border bg-raised px-2.5 py-2 text-xs">
                    <span className={clsx("mt-1 size-1.5 shrink-0 rounded-full", i.severity === "error" ? "bg-danger" : "bg-foreground/30")} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-foreground">{i.message}</span>
                      <span className="font-mono text-10 text-muted-foreground">
                        {i.code} · {i.file}:{i.line}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
