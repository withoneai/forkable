import clsx from "clsx";
import { useOneQuery } from "../lib/one-client";
import { ErrorState, Skeleton, SourceChip } from "../lib/one-ui";
import { ENGINE_LABELS, type ReportResponse } from "../brief/types";

export interface BriefShareOfVoiceProps {
  days?: number;
  className?: string;
}

/** Share of voice, visibility per engine and its trend, over the runs your app stored. */
export function BriefShareOfVoice({ days = 7, className }: BriefShareOfVoiceProps) {
  const { data, meta, loading, error, reload } = useOneQuery<ReportResponse>(`/api/brief/report?days=${days}`);
  const brandShare = data?.shareOfVoice.find((s) => s.isBrand)?.share ?? 0;
  const top = Math.max(1, ...(data?.shareOfVoice.map((s) => s.share) ?? [1]));

  return (
    <div data-block="brief-share-of-voice" className={clsx("flex min-h-0 flex-col gap-4 overflow-y-auto p-4 [&>*]:shrink-0", className)}>
      <div className="flex items-center gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-10 uppercase tracking-[0.05em] text-muted-foreground">Share of voice</span>
          <span className="text-13 text-muted-foreground">{data ? `${data.prompts} prompts, ${data.runs} answers, last ${data.days.length} days` : " "}</span>
        </div>
        <span className="ml-auto">
          <SourceChip meta={meta} />
        </span>
      </div>

      {loading && !data ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data && data.runs === 0 ? (
        <p className="text-13 text-muted-foreground">No runs yet. Ask a prompt with the visibility check and it shows up here.</p>
      ) : data ? (
        <>
          <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-border bg-raised">
            <Stat label="Visibility" value={`${Math.round(data.visibility)}%`} hint="Answers naming any tracked brand that name yours" />
            <Stat label={`${data.brand.name} share`} value={`${Math.round(brandShare)}%`} hint="Of every brand mention" border />
            <Stat label="Order mentioned" value={data.averagePosition?.toFixed(1) ?? "n/a"} hint="1 is named first. Lower is better" border />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-11 font-medium text-muted-foreground">Mentions, by brand</span>
            {data.shareOfVoice.map((s) => (
              <div key={s.id} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-3">
                <span className={clsx("truncate text-13", s.isBrand ? "font-semibold text-foreground" : "text-foreground")}>{s.name}</span>
                <span className="h-2 overflow-hidden rounded-full bg-foreground/6">
                  <span className={clsx("block h-full rounded-full", s.isBrand ? "bg-accent" : "bg-foreground/25")} style={{ width: `${(s.share / top) * 100}%` }} />
                </span>
                <span className="text-right font-mono text-11 tabular-nums text-muted-foreground">{s.share.toFixed(1)}%</span>
              </div>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <span className="text-11 font-medium text-muted-foreground">Visibility, by engine</span>
              {data.perEngine.map((e) => (
                <div key={e.engine} className="grid grid-cols-[5.5rem_1fr_2.5rem] items-center gap-3">
                  <span className="truncate text-xs text-foreground">{ENGINE_LABELS[e.engine]}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-foreground/6">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${e.visibility}%` }} />
                  </span>
                  <span className="text-right font-mono text-11 tabular-nums text-muted-foreground">{Math.round(e.visibility)}%</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-11 font-medium text-muted-foreground">Visibility, by day</span>
              <Trend points={data.trend.map((t) => t.brand)} labels={data.trend.map((t) => t.day.slice(5))} />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value, hint, border }: { label: string; value: string; hint: string; border?: boolean }) {
  return (
    <div title={hint} className={clsx("flex flex-col gap-0.5 px-3 py-2.5", border && "border-l border-border")}>
      <span className="text-28 font-semibold tabular-nums tracking-[-0.01em] text-foreground">{value}</span>
      <span className="truncate text-11 text-muted-foreground">{label}</span>
    </div>
  );
}

function Trend({ points, labels }: { points: number[]; labels: string[] }) {
  const w = 240;
  const h = 64;
  const max = Math.max(10, ...points);
  const x = (i: number) => (points.length < 2 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (v: number) => h - 4 - (v / max) * (h - 8);
  const d = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <div className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full overflow-visible text-accent" preserveAspectRatio="none">
        <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between font-mono text-10 text-muted-foreground">
        <span>{labels[0]}</span>
        <span>{points[points.length - 1]?.toFixed(0)}% today</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}
