import type { Lane } from "@rill/core/types";
import { useMailbox } from "@/lib/mailbox";
import { useInbox } from "@/lib/queries";
import { useLive } from "./Live";

export function StatusChip() {
  const live = useLive();
  const { mailboxId } = useMailbox();
  const lane = (sessionStorage.getItem("rill.lane") as Lane | null) ?? "vip";
  const inbox = useInbox(mailboxId ?? "", lane);
  const judging = inbox.data?.judging ?? 0;
  const remaining = live.progress ? Math.max(0, live.progress.total - live.progress.judged) : judging;
  const label = live.syncing ? "Syncing" : remaining > 0 ? `Sorting ${remaining} more` : null;
  if (!label) return null;
  return (
    <div role="status" className="fade-in flex h-7 items-center gap-2 rounded-md px-2 text-11 text-muted-foreground">
      <span className="pulse-dot size-1.5 rounded-full bg-foreground" />
      {label}
    </div>
  );
}
