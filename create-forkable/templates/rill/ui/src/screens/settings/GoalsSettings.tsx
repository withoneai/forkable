import { useState } from "react";
import { Pause, Play, Plus, Trash2 } from "lucide-react";
import type { ApiGoal } from "@rill/core/api-types";
import { useMailboxId } from "@/lib/mailbox";
import { useGoalMutations, useGoals } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Input, Textarea } from "@/components/ui/Input";
import { Slider } from "@/components/ui/Slider";
import { Skeleton } from "@/components/ui/Skeleton";
import { SectionTitle } from "./SettingsLayout";

export function GoalsSettings() {
  const mailboxId = useMailboxId();
  const q = useGoals(mailboxId);
  const m = useGoalMutations(mailboxId);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: "", detail: "" });

  const add = () => {
    if (!draft.title.trim()) return;
    m.create.mutate({ title: draft.title.trim(), detail: draft.detail.trim(), weight: 7 }, {
      onSuccess: () => { setDraft({ title: "", detail: "" }); setAdding(false); toast({ title: "Goal added", detail: "New emails are judged against it. Older ones re-judge lazily." }); },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle title="Goals" hint="A title and one plain-English line. Moving a weight re-sorts instantly from stored judgments. Editing the text asks Jev again.">
        <Button size="sm" icon={<Plus />} onClick={() => setAdding(true)} disabled={(q.data?.length ?? 0) >= 7}>Add goal</Button>
      </SectionTitle>

      {adding && (
        <form className="slide-up flex flex-col gap-2 rounded-lg border border-border bg-card p-3" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <Input autoFocus placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="Goal title" />
          <Textarea placeholder="What counts, and what does not." value={draft.detail} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} aria-label="Goal detail" className="min-h-[56px]" />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" variant="primary" type="submit" loading={m.create.isPending} disabled={!draft.title.trim()}>Add</Button>
          </div>
        </form>
      )}

      {q.isPending && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[112px] w-full rounded-lg" />)}
      {q.data?.map((g) => <GoalCard key={g.id} g={g} onPatch={(patch) => m.update.mutate({ goalId: g.id, patch })} onDelete={() => m.remove.mutate(g.id)} />)}
      {q.data?.length === 0 && !adding && <p className="text-13 text-muted-foreground">No goals yet. Without goals, the Goals lane stays empty.</p>}
    </div>
  );
}

function GoalCard({ g, onPatch, onDelete }: { g: ApiGoal; onPatch: (p: Partial<ApiGoal>) => void; onDelete: () => void }) {
  const [detail, setDetail] = useState(g.detail);
  const [title, setTitle] = useState(g.title);
  return (
    <div className={cn("flex flex-col rounded-lg border border-border bg-card transition-opacity", g.paused && "opacity-60")}>
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => { if (title.trim() && title !== g.title) onPatch({ title: title.trim() }); }}
          aria-label="Goal title"
          className="-mx-1.5 min-w-0 flex-1 rounded-sm bg-transparent px-1.5 text-13 font-semibold outline-none transition-colors hover:bg-faint focus:bg-faint"
        />
        {g.paused && <Badge tone="outline">Paused</Badge>}
        <span className="tnum text-11 text-muted-foreground"><span className="font-medium text-foreground">{g.matched7d}</span> matched in 7 days</span>
        <Button size="sm" variant="ghost" icon={g.paused ? <Play /> : <Pause />} onClick={() => onPatch({ paused: !g.paused })}>{g.paused ? "Resume" : "Pause"}</Button>
        <ConfirmButton size="sm" variant="ghost" icon={<Trash2 />} onConfirm={onDelete} confirmLabel="Delete?" aria-label="Delete goal"> </ConfirmButton>
      </div>
      <div className="px-3 pb-1 pt-1.5">
        <Textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          onBlur={() => { if (detail !== g.detail) onPatch({ detail }); }}
          aria-label="Goal detail"
          className="min-h-[44px] border-transparent bg-faint hover:border-border focus:bg-card"
        />
      </div>
      <div className="flex items-center gap-3 px-3 pb-2.5 pt-1">
        <span className="w-11 text-11 text-muted-foreground">Weight</span>
        <Slider label={`Weight for ${g.title}`} value={g.weight} disabled={g.paused} onCommit={(w) => onPatch({ weight: w })} className="max-w-[320px]" />
      </div>
    </div>
  );
}
