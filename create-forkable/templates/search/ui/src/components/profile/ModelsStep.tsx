// Step 2, Models: the platform's models (Contacts, Deals, Notes) grouped from its
// read actions with no AI, suggested ones first. The user ticks what to search;
// only those go to the dry run and the AI map (POST /profile-drafts/:id/models).
// After a map, each picked row says whether it mapped.
import { useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Search as SearchIcon } from "lucide-react";
import type { CatalogModel, ItemKind, ProfileDraft } from "@/contract/api-types";
import { cn, fmtNum } from "@/lib/utils";
import { Progress, type DraftStage } from "./PlatformStep";
import { COPY } from "@/lib/copy";

export const MAX_PICKS = 8;

export function modelFor(draft: ProfileDraft, actionId: string) {
  return draft.proposal?.models.find((m) => m.profile.list.actionId === actionId);
}

/** What a pick is, in a few words: how it shows up in results. */
const KIND_LINE: Record<ItemKind, string> = {
  person: "Shows up as people", company: "Shows up as companies", deal: "Shows up as deals", email_thread: "Shows up as email",
  message: "Shows up as messages", meeting_note: "Shows up as meeting notes", event: "Shows up as calendar events",
  task: "Shows up as tasks and tickets", note: "Shows up as notes", doc: "Shows up as docs", record: "Shows up as records",
};
/** The request behind a pick, for the Advanced disclosure only. */
const requestLine = (m: CatalogModel) => {
  const a = m.actions[0]!;
  return `${a.method} ${a.path.replace(/\{\{?\s*([\w.-]+)\s*\}?\}/g, (_, v: string) => a.pathVars?.[v] ?? `{${v}}`)}${m.actions.length + m.more > 1 ? `  +${m.actions.length + m.more - 1}` : ""}`;
};

/** The first three suggested models: a starting pick the user can change. */
export function defaultPicks(draft: ProfileDraft): string[] {
  if (draft.picked.length) return draft.picked;
  return draft.models.filter((m) => m.suggested && m.permitted !== false).slice(0, 3).map((m) => m.key);
}

/** What the last map did for a model: its profile, or why there is none. */
function mapped(draft: ProfileDraft, m: CatalogModel): { ok: boolean; note: string; estimate: number | null } | null {
  if (!draft.picked.includes(m.key)) return null;
  const prof = draft.proposal?.models.find((x) => m.actions.some((a) => a.actionId === x.profile.list.actionId));
  const samples = m.actions.map((a) => draft.samples[a.actionId]).filter(Boolean);
  const estimate = samples.find((s) => s!.estimate != null)?.estimate ?? null;
  if (prof) return { ok: true, note: prof.reason || "Ready", estimate };
  const err = samples.find((s) => s!.error)?.error;
  return { ok: false, note: err ? `Not ready: ${err}` : samples.some((s) => s!.ok && !s!.count) ? "Not ready: the first page was empty" : "Not ready", estimate };
}

export function ModelsStep({ draft, picks, onPicks, mapping, stages }: {
  draft: ProfileDraft; picks: string[]; onPicks: (next: string[]) => void; mapping: boolean; stages: DraftStage[];
}) {
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const suggested = draft.models.filter((m) => m.suggested);
  const builtin = draft.models.filter((m) => m.builtinProfile);
  const rest = draft.models.filter((m) => !m.suggested && !m.builtinProfile);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? draft.models.filter((m) => !m.builtinProfile && `${m.label} ${m.actions.map((a) => a.path).join(" ")}`.toLowerCase().includes(s)) : null;
  }, [q, draft.models]);
  const toggle = (key: string) => onPicks(picks.includes(key) ? picks.filter((k) => k !== key) : picks.length >= MAX_PICKS ? picks : [...picks, key]);

  if (mapping) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <p className="text-13 font-medium">Getting {picks.length} {picks.length === 1 ? "pick" : "picks"} ready</p>
        <Progress stages={stages} order={["docs", "dry_run", "propose", "validate"]} />
      </div>
    );
  }
  if (!draft.models.length) {
    return <p className="rounded-xl border border-border bg-card p-4 text-13 text-muted-foreground">Search found nothing it can list in this tool. It needs a way to read many records at once.</p>;
  }

  const row = (m: CatalogModel) => {
    const on = picks.includes(m.key);
    const isBuiltin = !!m.builtinProfile;
    const locked = draft.inGrant && !m.permitted;
    const full = !on && picks.length >= MAX_PICKS;
    const disabled = isBuiltin || locked || full;
    const result = mapped(draft, m);
    return (
      <li key={m.key}>
        <button
          type="button" role="checkbox" aria-checked={on} disabled={disabled} onClick={() => toggle(m.key)} data-testid={`model-${m.key}`}
          className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-100", !disabled && "hover:bg-card-hover", disabled && "cursor-not-allowed opacity-60")}
        >
          <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border-strong bg-card")}>
            {(on || isBuiltin) && <Check className="size-3 stroke-[2.5]" />}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-13 font-medium">{m.label}</span>
            {result ? (
              <span className={cn("flex items-center gap-1.5 truncate text-11", result.ok ? "text-muted-foreground" : "text-warning-text")}>
                {result.ok ? <Check className="size-3 shrink-0 text-success-text" /> : <AlertTriangle className="size-3 shrink-0" />}
                <span className="truncate">{result.note}</span>
              </span>
            ) : (
              <span className="truncate text-11 text-muted-foreground">{KIND_LINE[m.kind]}</span>
            )}
          </span>
          {result?.estimate != null && <span className="tnum shrink-0 text-11 text-muted-foreground">about {fmtNum(result.estimate)}</span>}
          {isBuiltin && <span className="shrink-0 text-11 text-muted-foreground">Built in</span>}
          {locked && <span className="shrink-0 text-11 text-muted-foreground">{COPY.notAllowed}</span>}
        </button>
      </li>
    );
  };
  const list = (items: CatalogModel[], label: string, hint?: string) => items.length > 0 && (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <h2 className="text-11 font-medium uppercase tracking-wide text-muted-foreground">{label}</h2>
        {hint && <span className="text-11 text-muted-foreground">{hint}</span>}
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">{items.map(row)}</ul>
    </section>
  );

  return (
    <div className="flex flex-col gap-4" role="group" aria-label={COPY.whatToSearch}>
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find among the ${draft.models.length} kinds of things in this tool`} aria-label="Find what to search" data-testid="models-filter"
            className="h-8 w-full rounded-md border border-border bg-card pl-8 pr-2.5 text-13 placeholder:text-muted-foreground/60 hover:border-border-strong focus:border-ring focus:outline-none"
          />
        </div>
        <span className="tnum shrink-0 text-11 text-muted-foreground" data-testid="picked-count" title={`Up to ${MAX_PICKS} at a time`}>{picks.length} of {draft.models.filter((m) => !m.builtinProfile).length} picked{picks.length >= MAX_PICKS ? `, the most at once` : ""}</span>
      </div>

      {filtered ? (
        filtered.length ? list(filtered, `Matching "${q.trim()}"`) : <p className="px-0.5 text-13 text-muted-foreground">Nothing matches.</p>
      ) : (
        <>
          {list(suggested, "Suggested", "Things people search for")}
          {list(builtin, "Already built in", "Search already reads these")}
          {rest.length > 0 && (
            showAll ? list(rest, "Everything else") : (
              <button type="button" onClick={() => setShowAll(true)} className="flex items-center gap-1.5 self-start px-0.5 text-xs text-muted-foreground hover:text-foreground">
                <ChevronDown className="size-3.5" />Show {rest.length} more
              </button>
            )
          )}
        </>
      )}
      <p className="px-0.5 text-11 text-muted-foreground">Only what you pick goes to the AI.</p>
      <details className="group px-0.5 text-11 text-muted-foreground" data-copy="advanced" data-testid="models-advanced">
        <summary className="cursor-pointer select-none hover:text-foreground">Advanced</summary>
        <div className="mt-2 flex flex-col gap-1.5">
          <p>From {fmtNum(draft.models.reduce((n, m) => n + m.actions.length + m.more, 0))} list actions. {draft.hiddenActions ? `${fmtNum(draft.hiddenActions)} other actions write or read one record, so they are not listed.` : ""}</p>
          <ul className="flex flex-col gap-1 font-mono">
            {draft.models.map((m) => <li key={m.key} className="truncate"><span className="font-sans text-foreground">{m.label}</span>  {requestLine(m)}</li>)}
          </ul>
        </div>
      </details>
    </div>
  );
}
