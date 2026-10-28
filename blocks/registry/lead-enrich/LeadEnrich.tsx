import { useState } from "react";
import clsx from "clsx";
import { OneClientError, oneFetch, type OneMeta } from "../lib/one-client";
import { Avatar, Button, ErrorState, Skeleton, SourceChip } from "../lib/one-ui";
import { LeadReceipt } from "../lead/Receipt";
import { PROVIDER_LABELS, type EnrichResponse } from "../lead/types";

export interface LeadEnrichProps {
  defaultEmail?: string;
  onResult?: (r: EnrichResponse) => void;
  className?: string;
}

/** An email or LinkedIn URL in, a profile out, through the enrich waterfall. */
export function LeadEnrich({ defaultEmail = "", onResult, className }: LeadEnrichProps) {
  const [value, setValue] = useState(defaultEmail);
  const [res, setRes] = useState<{ data: EnrichResponse; meta: OneMeta } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<OneClientError | null>(null);

  const run = async () => {
    const v = value.trim();
    setBusy(true);
    setErr(null);
    try {
      const r = await oneFetch<EnrichResponse>("/api/lead/enrich", { method: "POST", body: /linkedin\.com\//i.test(v) ? { linkedinUrl: v } : { email: v } });
      setRes(r);
      onResult?.(r.data);
    } catch (e) {
      setErr(e instanceof OneClientError ? e : new OneClientError(0, "network", String(e)));
    } finally {
      setBusy(false);
    }
  };
  const p = res?.data.person;

  return (
    <div data-block="lead-enrich" className={clsx("flex min-h-0 flex-col gap-4 overflow-y-auto p-4 [&>*]:shrink-0", className)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) run();
        }}
        className="flex items-center gap-2"
      >
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Work email or LinkedIn URL" className="h-8 min-w-0 flex-1 rounded-md border border-border bg-raised px-2.5 text-13 text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-strong focus:border-strong" />
        <Button type="submit" variant="primary" disabled={!value.trim() || busy}>
          {busy ? "Looking up" : "Enrich"}
        </Button>
      </form>
      {err && <ErrorState error={err} onRetry={run} />}
      {busy && <Skeleton className="h-36 w-full" />}
      {res && !busy && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-13 text-foreground">{p ? "Found" : "No profile found. A miss costs nothing."}</span>
            <span className="ml-auto">
              <SourceChip meta={res.meta} />
            </span>
          </div>
          {p && (
            <div className="flex items-start gap-3 rounded-lg border border-border bg-raised p-3">
              <Avatar name={p.name ?? "?"} className="size-9 text-11" />
              <dl className="grid min-w-0 flex-1 grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Name</dt>
                <dd className="truncate font-medium text-foreground">{p.name}</dd>
                <dt className="text-muted-foreground">Title</dt>
                <dd className="truncate text-foreground">{p.title ?? "Not known"}</dd>
                <dt className="text-muted-foreground">Company</dt>
                <dd className="truncate text-foreground">{[p.company?.name, p.company?.domain].filter(Boolean).join(" · ") || "Not known"}</dd>
                <dt className="text-muted-foreground">Location</dt>
                <dd className="truncate text-foreground">{[p.location?.city, p.location?.region, p.location?.country].filter(Boolean).join(", ") || "Not known"}</dd>
                <dt className="text-muted-foreground">LinkedIn</dt>
                <dd className="truncate">{p.linkedinUrl ? <a href={p.linkedinUrl} target="_blank" rel="noreferrer" className="text-foreground hover:text-accent">{p.linkedinUrl.replace(/^https?:\/\/(www\.)?/, "")}</a> : <span className="text-foreground">Not known</span>}</dd>
                <dt className="text-muted-foreground">Source</dt>
                <dd className="truncate text-foreground">{p.sources.map((s) => PROVIDER_LABELS[s]).join(", ")}</dd>
              </dl>
            </div>
          )}
          <LeadReceipt receipt={res.data.receipt} />
        </div>
      )}
    </div>
  );
}
