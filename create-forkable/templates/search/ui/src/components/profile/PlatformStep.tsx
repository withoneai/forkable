// Step 1, Platform: a palette-style picker over One's catalog (Basedash).
// "In your grant" first; anything else gets the widen-the-ask path (SPEC D26).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, CornerDownLeft, Plus, Search as SearchIcon } from "lucide-react";
import type { CatalogRow } from "@/lib/api";
import { useCatalog } from "@/lib/queries";
import { cn, useDebounced } from "@/lib/utils";
import { SourceLogo } from "@/components/SourceLogo";
import { AccountMark } from "@/components/AccountChip";
import { markFor } from "@/lib/accounts";
import { Spinner } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";

export interface DraftStage { stage: string; message?: string }

export function PlatformStep({ picked, onPick, onSubmit, creating, stages }: {
  picked: CatalogRow | null;
  onPick: (p: CatalogRow) => void;
  onSubmit: () => void;
  creating: boolean;
  stages: DraftStage[];
}) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 120);
  const cat = useCatalog(dq);
  const input = useRef<HTMLInputElement>(null);
  const [i, setI] = useState(0);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => setI(0), [dq]);

  const rows = cat.data?.platforms ?? [];
  // Built-ins are already indexed; they stay listed so a second profile on them is possible, but sorted last.
  const inGrant = useMemo(() => rows.filter((r) => r.inGrant).sort((a, b) => Number(a.builtin) - Number(b.builtin)), [rows]);
  const notIn = rows.filter((r) => !r.inGrant);
  const flat = [...inGrant, ...notIn];

  // the side panel follows the list: a filter that hides the picked platform picks the first one shown
  const flatKey = flat.map((r) => r.platform).join("|");
  useEffect(() => {
    if (flat[0] && (!picked || !flat.some((r) => r.platform === picked.platform))) onPick(flat[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatKey]);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <SearchIcon className="size-4 text-muted-foreground" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a platform: Zendesk, Intercom, Jira..."
            aria-label="Find a platform"
            data-testid="platform-search"
            className="h-full flex-1 bg-transparent text-13 outline-none placeholder:text-muted-foreground/60"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); const n = Math.min(flat.length - 1, i + 1); setI(n); if (flat[n]) onPick(flat[n]); }
              else if (e.key === "ArrowUp") { e.preventDefault(); const n = Math.max(0, i - 1); setI(n); if (flat[n]) onPick(flat[n]); }
              else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (picked) onSubmit(); }
            }}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5" role="listbox" aria-label="Platforms">
          {cat.isPending && <div className="flex flex-col gap-2 p-2">{Array.from({ length: 6 }).map((_, k) => <Skeleton key={k} className="h-6 w-full" />)}</div>}
          {!cat.isPending && flat.length === 0 && <p className="px-3 py-8 text-center text-13 text-muted-foreground">No platform matches “{q}”.</p>}
          {([["Connected", inGrant, null], ["More from One", notIn, "Pick any. Search adds it to your Connect app when you save."]] as const).map(([label, list, hint]) => list.length > 0 && (
            <div key={label} className="mb-1">
              <p className="flex items-baseline gap-2 px-2 pb-1 pt-2"><span className="label-caps">{label}</span>{hint && <span className="text-11 text-muted-foreground">{hint}</span>}</p>
              {list.map((r) => {
                const active = picked?.platform === r.platform;
                return (
                  <button
                    key={r.platform}
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-testid={`platform-${r.platform}`}
                    onClick={() => { setI(flat.indexOf(r)); onPick(r); }}
                    onDoubleClick={onSubmit}
                    className={cn("group flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-13 transition-colors duration-75", active ? "bg-muted" : "hover:bg-card-hover")}
                  >
                    <SourceLogo platform={r.platform} size={18} />
                    <span className="truncate font-medium">{r.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {r.inGrant && (r.accounts ?? 1) > 1 ? `${r.accounts} accounts` : r.inGrant && r.connectionLabel && r.connectionLabel !== r.name ? r.connectionLabel : r.category}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      {r.builtin && <span className="text-11 text-muted-foreground">Built in</span>}
                      {!r.inGrant && (
                        <span className={cn("flex items-center gap-1 text-11 text-muted-foreground transition-opacity duration-75", active ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                          <Plus className="size-3" />Add
                        </span>
                      )}
                      {active && <CornerDownLeft className="size-3 text-muted-foreground" />}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <aside className="flex flex-col gap-4 self-start rounded-xl border border-border bg-faint p-4" aria-live="polite">
        {!picked ? <Skeleton className="h-32 w-full" /> : (
          <>
            <div className="flex items-center gap-2.5">
              <SourceLogo platform={picked.platform} size={28} />
              <div className="min-w-0">
                <p className="truncate text-15 font-semibold">{picked.name}</p>
                <p className="truncate text-11 text-muted-foreground">{!picked.inGrant ? "Not connected yet" : (picked.accounts ?? 1) > 1 ? `${picked.accounts} accounts` : `Uses ${picked.connectionLabel}`}</p>
              </div>
            </div>
            {picked.inGrant && (picked.accounts ?? 1) > 1 && (
              <ul className="flex flex-col gap-1.5" aria-label="Accounts" data-testid="picker-accounts">
                {(picked.connectionLabel ?? "").split(" · ").map((l, _i, all) => (
                  <li key={l} className="flex min-w-0 items-center gap-2 text-xs"><AccountMark text={markFor(l, all)} /><span className="truncate">{l}</span></li>
                ))}
                <li className="text-11 text-muted-foreground">You pick which ones to index on the next step.</li>
              </ul>
            )}
            {picked.description && <p className="text-xs text-muted-foreground">{picked.description}</p>}
            {picked.inGrant ? (
              creating ? <Progress stages={stages} /> : (
                <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                  <li className="flex gap-2"><Check className="mt-0.5 size-3 shrink-0 text-success-text" />Groups {picked.name}'s actions into models you pick from</li>
                  <li className="flex gap-2"><Check className="mt-0.5 size-3 shrink-0 text-success-text" />Reads one page of each model you pick, nothing else</li>
                  <li className="flex gap-2"><Check className="mt-0.5 size-3 shrink-0 text-success-text" />An AI on your grant proposes the map. You confirm every field.</li>
                  <li className="mt-1 font-medium text-foreground">Read only. Search never picks an action that writes.</li>
                </ul>
              )
            ) : (
              <div className="flex flex-col gap-2 text-xs text-muted-foreground">
                <p>You can set it up now. Search reads {picked.name}'s docs to map it.</p>
                <p>When you save, Search adds what it needs to your Connect app. Sign in again to grant it, and indexing starts.</p>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

const STAGE_LABEL: Record<string, string> = {
  actions: "Reading the actions and their models", docs: "Loading the docs for your models", dry_run: "One page each on your grant",
  propose: "Mapping the fields", validate: "Checking ids, dates and links", ready: "Ready",
};

export function Progress({ stages, order = ["actions"] }: { stages: DraftStage[]; order?: string[] }) {
  const seen = new Set(stages.map((s) => s.stage));
  const current = stages[stages.length - 1]?.stage;
  return (
    <ol className="flex flex-col gap-2" data-testid="draft-progress">
      {order.map((s) => {
        const done = seen.has(s) && s !== current;
        const live = s === current || (!stages.length && s === order[0]);
        const msg = stages.find((x) => x.stage === s)?.message;
        return (
          <li key={s} className={cn("flex items-center gap-2 text-xs", done ? "text-foreground" : live ? "text-foreground" : "text-muted-foreground/60")}>
            <span className="flex size-4 items-center justify-center">
              {done ? <Check className="size-3.5 text-success-text" /> : live ? <Spinner className="size-3" /> : <span className="size-1.5 rounded-full bg-border-strong" />}
            </span>
            <span className="truncate">{live && msg ? msg : STAGE_LABEL[s]}</span>
          </li>
        );
      })}
    </ol>
  );
}
