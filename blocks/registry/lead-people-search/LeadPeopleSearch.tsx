import { useState } from "react";
import { Search } from "lucide-react";
import clsx from "clsx";
import { OneClientError, oneFetch, type OneMeta } from "../lib/one-client";
import { Avatar, Button, ErrorState, Skeleton, SourceChip } from "../lib/one-ui";
import { LeadReceipt } from "../lead/Receipt";
import type { Person, SearchResponse } from "../lead/types";

export interface LeadPeopleSearchProps {
  defaults?: { title?: string; company?: string; domain?: string; location?: string };
  onPick?: (person: Person) => void;
  className?: string;
}

const FIELDS = [
  { key: "title", label: "Title", placeholder: "VP Sales" },
  { key: "domain", label: "Company domain", placeholder: "acme-inc.example" },
  { key: "location", label: "Location", placeholder: "Austin" },
] as const;

/** People by title, company and place through a provider waterfall, with a receipt. */
export function LeadPeopleSearch({ defaults = {}, onPick, className }: LeadPeopleSearchProps) {
  const [f, setF] = useState<Record<string, string>>({ title: defaults.title ?? "", domain: defaults.domain ?? "", location: defaults.location ?? "", company: defaults.company ?? "" });
  const [res, setRes] = useState<{ data: SearchResponse; meta: OneMeta } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<OneClientError | null>(null);
  const any = Object.values(f).some((v) => v.trim());

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setRes(await oneFetch<SearchResponse>("/api/lead/search", { method: "POST", body: Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim())) }));
    } catch (e) {
      setErr(e instanceof OneClientError ? e : new OneClientError(0, "network", String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-block="lead-people-search" className={clsx("flex min-h-0 flex-col gap-4 overflow-y-auto p-4 [&>*]:shrink-0", className)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (any) run();
        }}
        className="flex flex-wrap items-end gap-2"
      >
        {FIELDS.map((x) => (
          <label key={x.key} className="flex min-w-32 flex-1 flex-col gap-1">
            <span className="text-11 text-muted-foreground">{x.label}</span>
            <input value={f[x.key]} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} placeholder={x.placeholder} className="h-8 rounded-md border border-border bg-raised px-2.5 text-13 text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-strong focus:border-strong" />
          </label>
        ))}
        <Button type="submit" variant="primary" disabled={!any || busy}>
          <Search className="size-3.5" />
          {busy ? "Searching" : "Search"}
        </Button>
      </form>

      {err && <ErrorState error={err} onRetry={run} />}
      {busy && <Skeleton className="h-40 w-full" />}
      {res && !busy && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-13 text-foreground">{res.data.people.length ? `${res.data.people.length} people` : "Nobody matched. A miss costs nothing."}</span>
            <span className="ml-auto">
              <SourceChip meta={res.meta} />
            </span>
          </div>
          {res.data.people.length > 0 && (
            <ul className="overflow-hidden rounded-lg border border-border">
              {res.data.people.map((p) => (
                <li key={p.id} className="border-b border-border last:border-b-0">
                  <button onClick={() => onPick?.(p)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-card">
                    <Avatar name={p.name ?? "?"} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-13 font-medium text-foreground">{p.name}</span>
                      <span className="truncate text-11 text-muted-foreground">
                        {[p.title, p.company?.name, [p.location?.city, p.location?.region].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {p.emails[0] && <span className="hidden truncate font-mono text-11 text-muted-foreground md:block">{p.emails[0].address}</span>}
                    {p.matchConfidence !== null && <span className="shrink-0 font-mono text-10 text-muted-foreground">{Math.round(p.matchConfidence * 100)}%</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <LeadReceipt receipt={res.data.receipt} />
        </div>
      )}
    </div>
  );
}
