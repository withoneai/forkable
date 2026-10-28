import { useState } from "react";
import { ChevronRight } from "lucide-react";
import clsx from "clsx";
import { useOneQuery } from "../lib/one-client";
import { ErrorState, Skeleton, SourceChip } from "../lib/one-ui";
import type { ReportResponse } from "../brief/types";

export interface BriefCitationsProps {
  days?: number;
  limit?: number;
  className?: string;
}

/** The domains AI answers cite, ranked, with owned and competitor sites marked. */
export function BriefCitations({ days = 7, limit = 12, className }: BriefCitationsProps) {
  const { data, meta, loading, error, reload } = useOneQuery<ReportResponse>(`/api/brief/report?days=${days}`);
  const [open, setOpen] = useState<string | null>(null);
  const rows = data?.citations.slice(0, limit) ?? [];
  const top = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div data-block="brief-citations" className={clsx("flex min-h-0 flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-13 font-semibold text-foreground">Cited sources</span>
          <span className="text-11 text-muted-foreground">{data ? `${data.citations.length} domains across ${data.runs} answers` : " "}</span>
        </div>
        <span className="ml-auto">
          <SourceChip meta={meta} />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !data ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="p-3">
            <ErrorState error={error} onRetry={reload} />
          </div>
        ) : rows.length === 0 ? (
          <p className="p-3 text-13 text-muted-foreground">No cited sources yet.</p>
        ) : (
          <ul>
            {rows.map((r, i) => (
              <li key={r.domain} className="border-b border-border">
                <button onClick={() => setOpen(open === r.domain ? null : r.domain)} className="grid w-full grid-cols-[1.25rem_1fr_6rem_2.5rem_1rem] items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-card">
                  <span className="font-mono text-10 tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-13 text-foreground">{r.domain}</span>
                    {r.owned && <Tag tone="primary">Yours</Tag>}
                    {r.competitor && <Tag>{r.competitor}</Tag>}
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-foreground/6">
                    <span className={clsx("block h-full rounded-full", r.owned ? "bg-accent" : "bg-foreground/25")} style={{ width: `${(r.count / top) * 100}%` }} />
                  </span>
                  <span className="text-right font-mono text-11 tabular-nums text-muted-foreground">{r.count}</span>
                  <ChevronRight className={clsx("size-3.5 text-muted-foreground transition-transform", open === r.domain && "rotate-90")} />
                </button>
                {open === r.domain && (
                  <ul className="flex flex-col gap-1 px-3 pb-2.5 pl-11">
                    {r.pages.map((p) => (
                      <li key={p.url} className="flex items-center gap-2 text-xs">
                        <a href={p.url} target="_blank" rel="noreferrer" className="truncate text-muted-foreground hover:text-foreground">
                          {p.url.replace(/^https?:\/\/(www\.)?/, "")}
                        </a>
                        <span className="ml-auto shrink-0 font-mono text-10 text-muted-foreground">{p.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Tag({ children, tone }: { children: string; tone?: "primary" }) {
  return <span className={clsx("inline-flex h-4 shrink-0 items-center rounded-sm px-1 text-10 font-medium", tone === "primary" ? "bg-primary text-primary-foreground" : "bg-foreground/8 text-foreground/80")}>{children}</span>;
}
