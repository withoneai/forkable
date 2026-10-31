// Step 3, Fields: the AI-proposed map (Attio import + HubSpot's two sample
// values + Salesforce's Skip pinned first). Left the map, right a live preview
// of one sample as a result row and as the preview pane, five samples to page.
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, RotateCcw } from "lucide-react";
import type { DraftPreview } from "@/contract/api-types";
import { useKeys } from "@/lib/keys";
import { cn, fmtRelative, KIND_LABEL } from "@/lib/utils";
import { SourceLogo } from "@/components/SourceLogo";
import { Button } from "@/components/ui/Button";
import { Menu } from "@/components/ui/Menu";
import { Skeleton } from "@/components/ui/Skeleton";
import { inField, onControl } from "./keys";
import { fieldName, getPath, missingTargets, REQUIRED, showValue, TARGETS, targetLabel, type MapRow, type Target } from "./fieldmap";

const REVIEW_BELOW = 0.75;

const formatOf = (t: Target, sample: unknown): string => {
  if (t === "occurredAt" || t === "updatedAt") return typeof sample === "number" ? "Epoch seconds" : "ISO 8601";
  if (t === "priority") return "low to urgent";
  if (t === "labels") return "List";
  if (t === "from" || t === "assignee" || t === "company") return "Id, resolved";
  if (t === "body") return "Plain text";
  if (t === "skip") return "";
  return "Text";
};

export function FieldsStep({ rows, samples, onChange, onReset, preview, previewLoading, embedded = false }: {
  rows: MapRow[]; samples: unknown[]; onChange: (path: string, target: Target) => void; onReset: () => void; preview: DraftPreview | undefined; previewLoading: boolean;
  /** Inside Check, which shows its own preview: the map alone. */
  embedded?: boolean;
}) {
  const [focus, setFocus] = useState(0);
  const [menu, setMenu] = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const review = rows.filter((r) => r.target !== "skip" && (r.confidence ?? 1) < REVIEW_BELOW);
  const auto = rows.filter((r) => r.target !== "skip" && (r.confidence ?? 1) >= REVIEW_BELOW);
  const skipped = rows.filter((r) => r.target === "skip");
  const order = [...review, ...auto, ...(showSkipped ? skipped : [])];
  const mapped = rows.filter((r) => r.target !== "skip").length;
  const missing = missingTargets(rows);
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  const cur = order[Math.min(focus, order.length - 1)];
  useEffect(() => { if (cur) refs.current[cur.path]?.scrollIntoView({ block: "nearest" }); }, [cur]);
  useKeys({
    j: (e) => { if (menu || inField(e)) return false; setFocus((i) => Math.min(order.length - 1, i + 1)); },
    k: (e) => { if (menu || inField(e)) return false; setFocus((i) => Math.max(0, i - 1)); },
    s: (e) => { if (menu || !cur || inField(e)) return false; onChange(cur.path, "skip"); },
    r: (e) => { if (menu || inField(e)) return false; onReset(); },
    enter: (e) => { if (menu || !cur || onControl(e)) return false; setMenu(cur.path); },
  }, { priority: 30, whileTyping: true });

  const used = new Set(rows.filter((r) => r.target !== "skip" && r.target !== "property").map((r) => r.target));
  const group = (title: string, list: MapRow[], hint?: string) => list.length === 0 ? null : (
    <div role="rowgroup" key={title}>
      <div className="flex h-8 items-center gap-2 border-b border-border bg-faint px-3">
        <span className="label-caps">{title} ({list.length})</span>
        {hint && <span className="text-11 text-muted-foreground">{hint}</span>}
      </div>
      {list.map((r) => {
        const idx = order.indexOf(r);
        const active = idx === focus;
        const v1 = getPath(samples[0], r.path), v2 = getPath(samples[1], r.path);
        const skip = r.target === "skip";
        const req = REQUIRED.includes(r.target);
        return (
          <div
            key={r.path}
            ref={(el) => { refs.current[r.path] = el; }}
            role="row"
            aria-selected={active}
            data-testid={`map-row-${r.path}`}
            onMouseDown={() => setFocus(idx)}
            title={r.reason ? `${r.reason}${r.confidence != null ? ` (${Math.round(r.confidence * 100)}%)` : ""}` : undefined}
            className={cn("group relative grid h-14 grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_20px_minmax(0,1.2fr)_76px] items-center gap-3 border-b border-border px-3 last:border-b-0", active ? "bg-muted" : "hover:bg-card-hover")}
          >
            {active && <span aria-hidden className="absolute inset-y-2 left-0 w-[2px] rounded-r bg-accent" />}
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className={cn("truncate text-xs", skip && "text-muted-foreground")}>{fieldName(r.path)} <span className="font-mono text-11 text-muted-foreground">{r.path}</span></span>
              {r.reason && <span className="truncate text-11 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-aria-selected:opacity-100">{r.reason}</span>}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5 text-xs">
              <span className="truncate">{showValue(v1)}</span>
              <span className="truncate text-muted-foreground">{showValue(v2)}</span>
            </span>
            <span aria-hidden className="flex items-center justify-center text-muted-foreground">
              {skip ? <span className="w-full border-t border-dashed border-border-strong" /> : <ArrowRight className="size-3.5 text-foreground" />}
            </span>
            <Menu
              open={menu === r.path}
              onClose={() => setMenu(null)}
              className="max-h-[300px] w-[220px] overflow-y-auto"
              items={TARGETS.map((t) => ({
                key: t.key,
                label: <span className={cn(t.key === "skip" && "text-muted-foreground")}>{t.label}{t.required ? " *" : ""}</span>,
                hint: t.key === r.target ? "current" : used.has(t.key) && t.key !== "skip" ? "used" : undefined,
                onSelect: () => onChange(r.path, t.key),
              }))}
              anchor={
                <button type="button" aria-haspopup="menu" aria-expanded={menu === r.path} aria-label={`Search field for ${r.path}`} onClick={() => setMenu((m) => (m === r.path ? null : r.path))}
                  className={cn("flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md border px-2 text-left text-xs transition-colors",
                    skip ? "border-dashed border-border-strong text-muted-foreground" : "border-border bg-card hover:border-border-strong")}>
                  <span className="min-w-0 flex-1 truncate">{targetLabel(r.target)}{req ? " *" : ""}</span>
                  {r.by === "ai" && r.confidence != null && !skip && <Confidence c={r.confidence} />}
                  <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                </button>
              }
            />
            <span className="truncate text-11 text-muted-foreground">{formatOf(r.target, v1)}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className={cn("grid min-h-0 flex-1 grid-cols-1 gap-5", !embedded && "lg:grid-cols-[minmax(0,1fr)_340px]")}>
      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-13">
            <span className="font-medium">{mapped} of {rows.length} mapped</span>
            <span className="text-muted-foreground"> · {review.length} need review</span>
            {missing.length > 0 && <span className="text-destructive-text"> · {missing.map(targetLabel).join(", ")} missing</span>}
          </p>
          <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={onReset}>Reset to the proposal</Button>
        </div>
        <div className={cn("min-h-0 overflow-y-auto rounded-xl border border-border bg-card", embedded && "max-h-[420px]")} role="table" aria-label="Field map" data-testid="field-map">
          <div role="row" className="sticky top-0 z-10 grid h-8 grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_20px_minmax(0,1.2fr)_76px] items-center gap-3 border-b border-border bg-card px-3 text-11 font-medium text-muted-foreground">
            <span>Source field</span><span>Samples</span><span /><span>Search field</span><span>Format</span>
          </div>
          {group("Needs review", review, "Low confidence. Check these.")}
          {group("Mapped by AI", auto)}
          <button type="button" onClick={() => setShowSkipped((v) => !v)} className="flex h-8 w-full items-center gap-2 border-t border-border bg-faint px-3 text-left">
            <span className="label-caps">Not mapped ({skipped.length})</span>
            <span className="text-11 text-muted-foreground">{showSkipped ? "Hide" : "Show"}</span>
          </button>
          {showSkipped && group("Skipped", skipped)}
        </div>
        <p className="text-11 text-muted-foreground">J and K move, Enter picks a field, S skips it, R resets to the proposal. * is required.</p>
      </div>
      {!embedded && <PreviewPane preview={preview} loading={previewLoading} />}
    </div>
  );
}

function Confidence({ c }: { c: number }) {
  const bars = c >= 0.9 ? 3 : c >= REVIEW_BELOW ? 2 : 1;
  return (
    <span aria-label={`${Math.round(c * 100)} percent confident`} className="flex items-end gap-px">
      {[1, 2, 3].map((b) => <span key={b} className={cn("w-[3px] rounded-sm", b <= bars ? (bars === 1 ? "bg-warning-text" : "bg-foreground/70") : "bg-border-strong")} style={{ height: 4 + b * 2 }} />)}
    </span>
  );
}

export function PreviewPane({ preview, loading }: { preview: DraftPreview | undefined; loading: boolean }) {
  const [i, setI] = useState(0);
  const n = preview?.samples.length ?? 0;
  useEffect(() => { if (i >= n) setI(0); }, [n, i]);
  const s = preview?.samples[i];
  return (
    <aside className="flex flex-col gap-3 self-start lg:sticky lg:top-0" aria-label="Live preview" data-testid="map-preview">
      <div className="flex items-center justify-between">
        <p className="label-caps">Live preview</p>
        <span className="flex items-center gap-1">
          <button type="button" aria-label="Previous sample" disabled={n < 2} onClick={() => setI((x) => (x - 1 + n) % n)} className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-card-hover disabled:opacity-40"><ChevronLeft className="size-3.5" /></button>
          <span className="tnum text-11 text-muted-foreground">{n ? `${i + 1} of ${n}` : ""}</span>
          <button type="button" aria-label="Next sample" disabled={n < 2} onClick={() => setI((x) => (x + 1) % n)} className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-card-hover disabled:opacity-40"><ChevronRight className="size-3.5" /></button>
        </span>
      </div>
      {!s ? <Skeleton className="h-64 w-full rounded-xl" /> : (
        <div className={cn("flex flex-col gap-3 transition-opacity", loading && "opacity-60")}>
          <p className="text-11 text-muted-foreground">As a result</p>
          <div className="flex h-14 flex-col justify-center gap-1.5 overflow-hidden rounded-lg border border-border bg-card px-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <SourceLogo platform={s.row.platform} size={16} />
              <span className="w-12 shrink-0 truncate text-11 text-muted-foreground">{s.row.facets.kind === "task" && s.row.facets.key ? s.row.facets.key : KIND_LABEL[s.row.kind]}</span>
              <span className="min-w-0 flex-1 truncate text-13 font-medium">{s.row.title}</span>
              <span className="tnum shrink-0 text-11 text-muted-foreground">{fmtRelative(s.row.occurredAt)}</span>
            </div>
            {s.row.snippet && <p className="truncate pl-19 text-xs text-muted-foreground">{s.row.snippet}</p>}
          </div>
          <p className="text-11 text-muted-foreground">As the preview</p>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex h-9 items-center gap-2 border-b border-border px-3 text-xs">
              <SourceLogo platform={s.row.platform} size={14} />
              <span className="text-muted-foreground">Found in {s.row.sourceName}</span>
              {s.item.url && <a href={s.item.url} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground">Open <ExternalLink className="size-3" /></a>}
            </div>
            <div className="flex flex-col gap-3 p-3">
              <p className="text-13 font-semibold leading-snug">{s.item.title}</p>
              <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
                {s.item.status && <><dt className="text-11 text-muted-foreground">Status</dt><dd>{s.item.status}</dd></>}
                {s.row.people.map((p) => <span key={`${p.role}${p.name}`} className="contents"><dt className="text-11 capitalize text-muted-foreground">{p.role}</dt><dd>{p.name}</dd></span>)}
                {s.item.labels.length > 0 && <><dt className="text-11 text-muted-foreground">Labels</dt><dd className="truncate">{s.item.labels.join(", ")}</dd></>}
                <dt className="text-11 text-muted-foreground">Created</dt><dd>{new Date(s.item.occurredAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</dd>
                <dt className="text-11 text-muted-foreground">Id</dt><dd className="font-mono text-11">{s.item.externalId || "missing"}</dd>
              </dl>
              {s.item.body ? <p className="line-clamp-5 text-xs leading-relaxed text-foreground/90">{s.item.body}</p> : <p className="text-xs text-muted-foreground">No body mapped.</p>}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
