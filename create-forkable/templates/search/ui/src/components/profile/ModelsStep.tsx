// Step 2, Models: the platform's models (Contacts, Deals, Notes) grouped from its
// read actions with no AI, suggested ones first. The user ticks what to search;
// only those go to the dry run and the AI map (POST /profile-drafts/:id/models).
// After a map, each picked row says whether it mapped.
import { useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Search as SearchIcon } from "lucide-react";
import type { CatalogModel, ItemKind, ProfileDraft } from "@/contract/api-types";
import { cn, fmtNum } from "@/lib/utils";
import { Progress, type DraftStage } from "./PlatformStep";

export const MAX_PICKS = 8;

export function modelFor(draft: ProfileDraft, actionId: string) {
  return draft.proposal?.models.find((m) => m.profile.list.actionId === actionId);
}

const KIND_LABEL: Record<ItemKind, string> = {
  person: "People", company: "Companies", deal: "Deals", email_thread: "Email", message: "Messages", meeting_note: "Meeting notes",
  event: "Events", task: "Tasks", note: "Notes", doc: "Docs", record: "Records",
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
  if (prof) return { ok: true, note: prof.reason || "Mapped", estimate };
  const err = samples.find((s) => s!.error)?.error;
  return { ok: false, note: err ? `Not mapped: ${err}` : samples.some((s) => s!.ok && !s!.count) ? "Not mapped: no records in the sample" : "Not mapped", estimate };
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
        <p className="text-13 font-medium">Mapping {picks.length} {picks.length === 1 ? "model" : "models"}</p>
        <Progress stages={stages} order={["docs", "dry_run", "propose", "validate"]} />
      </div>
    );
  }
  if (!draft.models.length) {
    return <p className="rounded-xl border border-border bg-card p-4 text-13 text-muted-foreground">No list actions found for this platform. Search needs an action that returns many records.</p>;
  }

  const row = (m: CatalogModel) => {
    const on = picks.includes(m.key);
    const isBuiltin = !!m.builtinProfile;
    const locked = draft.inGrant && !m.permitted;
    const full = !on && picks.length >= MAX_PICKS;
    const disabled = isBuiltin || locked || full;
    const result = mapped(draft, m);
    const a = m.actions[0]!;
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
            <span className="flex items-center gap-2">
              <span className="truncate text-13 font-medium">{m.label}</span>
              {m.kind !== "record" && KIND_LABEL[m.kind] !== m.label && <span className="shrink-0 text-11 text-muted-foreground">{KIND_LABEL[m.kind]}</span>}
            </span>
            {result ? (
              <span className={cn("flex items-center gap-1.5 truncate text-11", result.ok ? "text-muted-foreground" : "text-warning-text")}>
                {result.ok ? <Check className="size-3 shrink-0 text-success-text" /> : <AlertTriangle className="size-3 shrink-0" />}
                <span className="truncate">{result.note}</span>
              </span>
            ) : (
              <span className="truncate font-mono text-11 text-muted-foreground">{a.method} {a.path.replace(/\{\{?\s*([\w.-]+)\s*\}?\}/g, (_, v: string) => a.pathVars?.[v] ?? `{${v}}`)}{m.actions.length + m.more > 1 ? `  +${m.actions.length + m.more - 1}` : ""}</span>
            )}
          </span>
          {result?.estimate != null && <span className="tnum shrink-0 text-11 text-muted-foreground">about {fmtNum(result.estimate)}</span>}
          {isBuiltin && <span className="shrink-0 text-11 text-muted-foreground">Built in</span>}
          {locked && <span className="shrink-0 text-11 text-muted-foreground">Not in your grant</span>}
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
    <div className="flex flex-col gap-4" role="group" aria-label="Models">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filter ${draft.models.length} models`} aria-label="Filter models" data-testid="models-filter"
            className="h-8 w-full rounded-md border border-border bg-card pl-8 pr-2.5 text-13 placeholder:text-muted-foreground/60 hover:border-border-strong focus:border-ring focus:outline-none"
          />
        </div>
        <span className="tnum shrink-0 text-11 text-muted-foreground">{picks.length} of {MAX_PICKS} picked</span>
      </div>

      {filtered ? (
        filtered.length ? list(filtered, `Matching "${q.trim()}"`) : <p className="px-0.5 text-13 text-muted-foreground">No model matches.</p>
      ) : (
        <>
          {list(suggested, "Suggested", "Things people search for")}
          {list(builtin, "Already built in", "Indexed by the built-in profile")}
          {rest.length > 0 && (
            showAll ? list(rest, "Everything else") : (
              <button type="button" onClick={() => setShowAll(true)} className="flex items-center gap-1.5 self-start px-0.5 text-xs text-muted-foreground hover:text-foreground">
                <ChevronDown className="size-3.5" />Show {rest.length} more models
              </button>
            )
          )}
        </>
      )}
      <p className="px-0.5 text-11 text-muted-foreground">
        From {fmtNum(draft.models.reduce((n, m) => n + m.actions.length + m.more, 0))} list actions. {draft.hiddenActions ? `${fmtNum(draft.hiddenActions)} other actions write or read one record, so they are not models. ` : ""}Only the models you pick go to the AI.
      </p>
    </div>
  );
}
