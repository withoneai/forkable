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

const REASON: Record<string, string> = {
  name_same_company: "same name and company",
  name_only: "same name",
  ext_id_name: "same name and chat account",
};
const by = (who: string | null, p: number | null) =>
  who === "user" ? "by you" : who === "jev" || who === "fixture" ? `by Jev${p != null ? `, ${Math.round(p * 100)}% sure` : ""}` : "by email";

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
            <span>Possible match: <span className="font-medium">{m.other.name}</span>{where(m.other.sources)}</span>
          </p>
          <div className="flex items-center gap-2.5 pl-5">
            <Avatar name={m.other.name} size="sm" />
            <span className="min-w-0 flex-1 text-xs text-muted-foreground">
              {[m.other.email, REASON[m.reason] ?? m.reason, `Jev ${Math.round(m.probability * 100)}% sure`].filter(Boolean).join(" · ")}
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
          <span className="min-w-0 flex-1 truncate">Merged <span className="text-foreground">{m.name}</span>{where(m.platforms)} {by(m.decidedBy, m.probability)}</span>
          <Button size="sm" variant="ghost" icon={<Undo2 />} loading={busy === m.id} onClick={() => void run(m.id, () => api.unmergeEntity(m.id), `${m.name} is separate again`)}>Unmerge</Button>
        </div>
      ))}
    </section>
  );
}
