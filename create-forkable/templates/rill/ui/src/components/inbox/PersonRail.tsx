import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import type { ThreadResponse } from "@rill/core/api-types";
import { fmtRelative, TIER_LABEL } from "@/lib/utils";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";

export function PersonRail({ person, currentThreadId }: { person: ThreadResponse["person"]; currentThreadId: string }) {
  const status = { unknown: "First-time sender", let_in: "Let in", screened_out: "Screened out" }[person.senderStatus];
  const rules = person.vip?.rules;
  const ruleLines = rules ? [
    rules.alwaysTop && "Always on top",
    rules.notify && "Notify",
    rules.neverDraft && "Never auto-draft",
    rules.replyWithinHours ? `Reply within ${rules.replyWithinHours}h` : null,
    rules.followUpDays ? `Follow up after ${rules.followUpDays} days` : null,
  ].filter(Boolean) as string[] : [];
  const others = person.threadsWithThem.filter((t) => t.threadId !== currentThreadId);
  return (
    <aside className="flex w-[240px] shrink-0 flex-col gap-5 overflow-y-auto border-l border-border bg-faint p-4" aria-label="Person">
      <div className="flex items-center gap-3">
        <Avatar name={person.name} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-13 font-semibold">{person.name}</p>
          <p className="truncate text-11 text-muted-foreground">{person.email}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {person.vip ? <Badge>VIP · {TIER_LABEL[person.vip.tier]}</Badge> : <Badge tone="outline">Not a VIP</Badge>}
        <Badge tone={person.senderStatus === "screened_out" ? "destructive" : "outline"}>{status}</Badge>
      </div>
      {ruleLines.length > 0 && (
        <div>
          <p className="label-caps mb-1.5">Rules</p>
          <ul className="flex flex-col gap-1 text-xs">
            {ruleLines.map((l) => <li key={l} className="flex items-center gap-1.5"><Check className="size-3 text-muted-foreground" />{l}</li>)}
          </ul>
        </div>
      )}
      <div>
        <p className="label-caps mb-1.5">Other threads</p>
        {others.length === 0 ? (
          <p className="text-xs text-muted-foreground">None in the last 30 days.</p>
        ) : (
          <ul className="flex flex-col">
            {others.map((t) => (
              <li key={t.threadId}>
                <Link to={`/thread/${t.threadId}`} className="-mx-2 flex h-7 items-center gap-2 rounded-md px-2 text-xs transition-colors hover:bg-card-hover">
                  <span className="min-w-0 flex-1 truncate">{t.subject}</span>
                  <span className="tnum shrink-0 text-11 text-muted-foreground">{fmtRelative(t.lastMessageAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
