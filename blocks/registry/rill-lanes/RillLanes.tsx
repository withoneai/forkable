import { useState } from "react";
import clsx from "clsx";
import { timeAgo, useOneQuery } from "../lib/one-client";
import { ErrorState, Skeleton, SourceChip } from "../lib/one-ui";
import { LANES, LANE_LABELS, type Lane, type LaneThread, type LanesResponse } from "../rill/types";

export interface RillLanesProps {
  selectedId?: string | null;
  onSelect?: (thread: LaneThread) => void;
  /** The lane to open on. VIPs by default. */
  lane?: Lane;
  limit?: number;
  className?: string;
}

const URGENCY = ["", "This week", "Today", "Within the hour"];

/** Rill's five lanes over the user's Gmail. Jev judges each thread; Rill's policy picks the lane. */
export function RillLanes({ selectedId, onSelect, lane: initial = "vip", limit = 25, className }: RillLanesProps) {
  const [lane, setLane] = useState<Lane>(initial);
  const { data, meta, loading, error, reload } = useOneQuery<LanesResponse>(`/api/rill/lanes?limit=${limit}`);
  const rows = data?.threads.filter((t) => t.lane === lane) ?? [];

  return (
    <div data-block="rill-lanes" className={clsx("flex min-h-0 flex-col", className)}>
      <div className="flex items-center gap-2 overflow-x-auto border-b border-border px-3 py-2">
        <div role="tablist" aria-label="Lanes" className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-foreground/4 p-0.5">
          {LANES.map((l) => (
            <button
              key={l}
              role="tab"
              aria-selected={lane === l}
              onClick={() => setLane(l)}
              className={clsx("flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-2 text-xs font-medium transition-colors", lane === l ? "bg-raised text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground")}
            >
              {LANE_LABELS[l]}
              {data && <span className="font-mono text-10 tabular-nums text-muted-foreground">{data.counts[l]}</span>}
            </button>
          ))}
        </div>
        <span className="ml-auto shrink-0">
          <SourceChip meta={meta} />
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !data ? (
          <div className="flex flex-col gap-3 p-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-5/6" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="p-3">
            <ErrorState error={error} onRetry={reload} />
          </div>
        ) : rows.length === 0 ? (
          <p className="p-3 text-13 text-muted-foreground">Nothing in {LANE_LABELS[lane]}.</p>
        ) : (
          <ul>
            {rows.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => onSelect?.(t)}
                  title={t.rule}
                  className={clsx("flex w-full flex-col gap-1 border-b border-border px-3 py-2.5 text-left transition-colors", selectedId === t.id ? "bg-card" : "hover:bg-card/60")}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={clsx("size-1.5 shrink-0 rounded-full", t.unread ? "bg-accent" : "bg-transparent")} />
                    <span className={clsx("truncate text-13 text-foreground", t.unread && "font-semibold")}>{t.from.name}</span>
                    <Chip thread={t} />
                    <span className="ml-auto shrink-0 text-11 text-muted-foreground">{timeAgo(t.date)}</span>
                  </div>
                  <div className="truncate pl-3 text-13">
                    <span className={clsx("text-foreground", t.unread && "font-medium")}>{t.subject}</span>
                    <span className="text-muted-foreground"> {t.summary ?? t.snippet}</span>
                  </div>
                  {selectedId === t.id && (
                    <div className="flex items-center gap-1.5 pl-3 text-11 text-muted-foreground">
                      <span>{t.rule}</span>
                      {t.urgency > 0 && <span>· {URGENCY[t.urgency]}</span>}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {data && (
        <div className="border-t border-border px-3 py-1.5 text-10 text-muted-foreground">
          {data.judgedBy === "jev" ? "Judged by Jev on your grant" : "Rill's recorded Jev answers for the Acme sample"} · lanes from rill/policy.ts
        </div>
      )}
    </div>
  );
}

function Chip({ thread: t }: { thread: LaneThread }) {
  const label = t.followUp ? "Follow up" : t.lane === "vip" ? (t.vip && t.vip !== t.from.name ? t.vip : "VIP") : t.goal ? "Goal" : t.lane === "reply" ? "Needs reply" : t.lane === "screener" ? (t.kind === "cold_pitch" ? "Cold pitch" : "New sender") : null;
  if (!label) return null;
  return (
    <span title={t.goal?.title ?? t.rule} className="inline-flex h-4 shrink-0 items-center rounded-sm bg-foreground/8 px-1 text-10 font-medium text-foreground/80">
      {label}
    </span>
  );
}
