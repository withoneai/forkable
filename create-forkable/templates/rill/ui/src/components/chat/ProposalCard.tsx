import { useState } from "react";
import { Check, Clock, Crown, ExternalLink, Hourglass, LogIn, PenLine, Search, ShieldOff, Undo2 } from "lucide-react";
import type { ChatProposal } from "@rill/core/types";
import type { ThreadAction } from "@rill/core/api-types";
import { toast } from "@/lib/toast";
import { useApplyDraftProposal, useThreadAction } from "@/lib/queries";
import { snoozeTargets } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

const ICON: Record<ChatProposal["kind"], React.ReactNode> = {
  done: <Check />, snooze: <Clock />, reply_later: <Hourglass />, screen_out: <ShieldOff />,
  let_in: <LogIn />, add_vip: <Crown />, draft: <PenLine />, open: <ExternalLink />, search: <Search />,
};

const BUTTON_LABEL: Record<ChatProposal["kind"], string> = {
  done: "Mark done", snooze: "Snooze", reply_later: "Reply later", screen_out: "Screen out",
  let_in: "Let in", add_vip: "Add as VIP", draft: "Use this draft", open: "Open thread", search: "Search again",
};

/**
 * One proposal from the assistant, one primary button. The click is the only
 * thing that acts; the proposal itself is just a suggestion. A successful
 * click swaps the button for a receipt line, with Undo for anything reversible.
 */
export function ProposalCard({ proposal, mailboxId, onSendMessage, onOpenThread }: {
  proposal: ChatProposal;
  mailboxId: string;
  onSendMessage: (text: string) => void;
  onOpenThread: (threadId: string) => void;
}) {
  const act = useThreadAction(mailboxId);
  const applyDraft = useApplyDraftProposal(mailboxId);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [undo, setUndo] = useState<(() => void) | null>(null);
  const busy = act.isPending || applyDraft.isPending;

  const ids = proposal.threadIds ?? (proposal.threadId ? [proposal.threadId] : []);
  const bulk = ids.length > 1;
  const count = (n: number) => `${n} ${n === 1 ? "thread" : "threads"}`;

  /** Runs one thread action on every thread the proposal covers; the receipt and Undo cover all of them. */
  const runAll = async (action: ThreadAction, done: string, reversible: boolean) => {
    if (!ids.length) return;
    const succeeded: string[] = [];
    let lastError = "";
    for (const threadId of ids) {
      try {
        await act.mutateAsync({ threadId, action });
        succeeded.push(threadId);
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    const failed = ids.length - succeeded.length;
    if (failed) toast({ title: `${count(failed)} did not change`, detail: lastError, tone: "destructive" });
    if (!succeeded.length) return;
    setReceipt(bulk ? `${done} · ${count(succeeded.length)}${failed ? `, ${failed} failed` : ""}` : done);
    if (reversible) setUndo(() => () => { for (const threadId of succeeded) act.mutate({ threadId, action: { action: "undo" } }); });
  };

  const run = () => {
    const threadId = proposal.threadId ?? ids[0];
    const params = proposal.params ?? {};
    switch (proposal.kind) {
      case "done":
        void runAll({ action: "done" }, "Done", true);
        return;
      case "snooze": {
        const until = typeof params.until === "string" ? params.until : snoozeTargets().find((s) => s.key === "monday")!.until;
        void runAll({ action: "snooze", until }, "Snoozed", true);
        return;
      }
      case "reply_later":
        void runAll({ action: "reply_later" }, "Reply later", false);
        return;
      case "screen_out":
        void runAll({ action: "screen_out" }, "Screened out", true);
        return;
      case "let_in":
        void runAll({ action: "let_in" }, "Let in", true);
        return;
      case "add_vip": {
        const tier = (typeof params.tier === "string" ? params.tier : "key") as "inner" | "key" | "team";
        void runAll({ action: "add_vip", tier }, "Added as a VIP", false);
        return;
      }
      case "draft": {
        if (!threadId) return;
        const body = typeof params.body === "string" ? params.body.trim() : "";
        if (!body) return;
        applyDraft.mutate({ threadId, body }, { onSuccess: () => setReceipt("Draft ready") });
        return;
      }
      case "open":
        if (threadId) onOpenThread(threadId);
        return;
      case "search": {
        const query = typeof params.query === "string" ? params.query : proposal.label;
        onSendMessage(`/search ${query}`);
        return;
      }
    }
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5">
      <div className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&>svg]:size-[13px] [&>svg]:stroke-[1.75]">{ICON[proposal.kind]}</span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{proposal.label}</span>
      </div>
      {receipt ? (
        <div className="flex items-center gap-2 pl-8 text-xs text-muted-foreground">
          <span>{receipt}</span>
          {undo && (
            <button
              type="button"
              onClick={() => { undo(); setReceipt(null); setUndo(null); }}
              className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
            >
              <Undo2 className="size-3" />
              Undo
            </button>
          )}
        </div>
      ) : (
        <div className="pl-8">
          <Button size="sm" variant={proposal.kind === "screen_out" ? "ghost" : "default"} loading={busy} onClick={run}>
            {BUTTON_LABEL[proposal.kind]}{bulk ? ` · ${count(ids.length)}` : ""}
          </Button>
        </div>
      )}
    </div>
  );
}
