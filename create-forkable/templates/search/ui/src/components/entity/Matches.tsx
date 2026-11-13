import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { GitMerge, Undo2 } from "lucide-react";
import type { EntityDetail } from "@/contract/api-types";
import { api } from "@/lib/api";
import { keys } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn, platformName } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { COPY } from "@/lib/copy";

const REASON: Record<string, string> = {
  name_same_company: "same name and company",
  name_only: "same name",
  ext_id_name: "same name and chat account",
};
/** How two records became one person, in plain words; the model's name stays in the tooltip. */
const by = (who: string | null, p: number | null) =>
  who === "user" ? "You said they are the same person"
    : who === "jev" || who === "fixture" ? `Search thought they were the same person${p != null ? `, ${Math.round(p * 100)}% sure` : ""}`
      : "Same email address";

/**
 * Entity match check results (SPEC 8.2) on a person: "Possible match: Ravi M. (Granola)" with
 * Merge and Not the same, and the people merged in with Unmerge. Used by the person preview
 * and the entity page.
 */
export function Matches({ detail, compact }: { detail: EntityDetail; compact?: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const e = detail.entity;
  const merged = detail.merged ?? [];
  if (e.type !== "person" || (!detail.pendingMatches.length && !merged.length)) return null;
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: keys.entity(e.id) }),
    qc.invalidateQueries({ queryKey: ["search"] }),
    qc.invalidateQueries({ queryKey: ["item"] }),
  ]);
  const run = async (id: string, fn: () => Promise<unknown>, title: string) => {
    setBusy(id);
    try { await fn(); await refresh(); toast({ title }); }
    catch (err) { toast({ title: "That did not save", detail: (err as Error).message, tone: "destructive" }); }
    finally { setBusy(null); }
  };
  const where = (platforms: string[]) => (platforms.length ? ` (${platforms.map(platformName).join(", ")})` : "");

  return (
    <section aria-label="Possible matches" data-testid="matches" className={cn("flex flex-col gap-2", !compact && "rounded-lg border border-border bg-card p-3")}>
      {detail.pendingMatches.map((m) => (
        <div key={m.matchId} data-testid="possible-match" className={cn("flex flex-col gap-2 rounded-md", compact && "border border-border bg-card p-2.5")}>
          <p className="flex items-center gap-1.5 text-13">
            <GitMerge className="size-3.5 shrink-0 text-muted-foreground" />
            <span>Maybe the same person: <span className="font-medium">{m.other.name}</span>{where(m.other.sources)}</span>
          </p>
          <div className="flex items-center gap-2.5 pl-5">
            <Avatar name={m.other.name} size="sm" />
            <span className="min-w-0 flex-1 text-xs text-muted-foreground">
              {[m.other.email, REASON[m.reason] ?? m.reason].filter(Boolean).join(" · ")}
              {" · "}
              <Tooltip label={`Decided by ${COPY.judgeWho}`}><span tabIndex={0} className="underline decoration-dotted underline-offset-2">Search thinks these are the same person, {Math.round(m.probability * 100)}% sure</span></Tooltip>
            </span>
          </div>
          <div className="flex items-center gap-1.5 pl-5">
            <Button size="sm" variant="primary" loading={busy === m.matchId} onClick={() => void run(m.matchId, () => api.decideMatch(m.matchId, "merge"), `Merged ${m.other.name} into ${e.name}`)}>Merge</Button>
            <Button size="sm" variant="ghost" disabled={busy === m.matchId} onClick={() => void run(m.matchId, () => api.decideMatch(m.matchId, "reject"), "Kept as two people")}>Not the same</Button>
          </div>
        </div>
      ))}
      {merged.map((m) => (
        <div key={m.id} data-testid="merged-person" className="flex items-center gap-2 text-xs text-muted-foreground">
          <GitMerge className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Includes <span className="text-foreground">{m.name}</span>{where(m.platforms)}. {m.decidedBy === "jev" || m.decidedBy === "fixture"
            ? <Tooltip label={`Decided by ${COPY.judgeWho}`}><span tabIndex={0} className="underline decoration-dotted underline-offset-2">{by(m.decidedBy, m.probability)}</span></Tooltip>
            : by(m.decidedBy, m.probability)}</span>
          <Button size="sm" variant="ghost" icon={<Undo2 />} loading={busy === m.id} onClick={() => void run(m.id, () => api.unmergeEntity(m.id), `${m.name} is separate again`)}>Separate them</Button>
        </div>
      ))}
    </section>
  );
}
