import { useState } from "react";
import { Check, Plus } from "lucide-react";
import clsx from "clsx";
import { useOneQuery } from "../lib/one-client";
import { Avatar, Button, ErrorState, Skeleton, SourceChip } from "../lib/one-ui";
import type { VipSuggestion } from "../rill/types";

export interface RillVipSuggestionsProps {
  /** Your app stores the VIP; this block never writes anywhere. */
  onAdd?: (person: VipSuggestion) => void;
  max?: number;
  className?: string;
}

/** Who the user writes to most, from Sent mail. Code only, no model. */
export function RillVipSuggestions({ onAdd, max = 8, className }: RillVipSuggestionsProps) {
  const { data, meta, loading, error, reload } = useOneQuery<VipSuggestion[]>(`/api/rill/vip-suggestions?max=${max}`);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const top = Math.max(1, ...(data ?? []).map((p) => p.sentCount));

  return (
    <div data-block="rill-vip-suggestions" className={clsx("flex min-h-0 flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-13 font-semibold text-foreground">Suggested VIPs</span>
          <span className="text-11 text-muted-foreground">The people you write to most, last 90 days</span>
        </div>
        <span className="ml-auto">
          <SourceChip meta={meta} />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !data ? (
          <div className="flex flex-col gap-3 p-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="p-3">
            <ErrorState error={error} onRetry={reload} />
          </div>
        ) : data?.length === 0 ? (
          <p className="p-3 text-13 text-muted-foreground">No sent mail to learn from yet.</p>
        ) : (
          <ul>
            {data?.map((p) => {
              const vip = p.alreadyVip || added.has(p.email);
              return (
                <li key={p.email} className="flex items-center gap-2.5 border-b border-border px-3 py-2">
                  <Avatar name={p.name} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="truncate text-13 font-medium text-foreground">{p.name}</span>
                      <span className="truncate text-11 text-muted-foreground">{p.email}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-1 w-24 overflow-hidden rounded-full bg-foreground/8">
                        <span className="block h-full rounded-full bg-accent" style={{ width: `${(p.sentCount / top) * 100}%` }} />
                      </span>
                      <span className="text-11 text-muted-foreground">{p.reason}</span>
                    </div>
                  </div>
                  {vip ? (
                    <span className="inline-flex h-7 items-center gap-1 px-2 text-xs text-muted-foreground">
                      <Check className="size-3.5" />
                      VIP
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => {
                        setAdded((s) => new Set(s).add(p.email));
                        onAdd?.(p);
                      }}
                    >
                      <Plus className="size-3.5" />
                      Add as VIP
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
