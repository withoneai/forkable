import { memo } from "react";
import type { InboxRow } from "@rill/core/api-types";
import { cn, fmtRelative, TIER_LABEL } from "@/lib/utils";
import { Badge } from "../ui/Badge";
import { Tooltip } from "../ui/Tooltip";
import { Logo } from "../Logo";

export const rowDomId = (threadId: string) => `row-${threadId}`;

/** Why a row is here, one chip, highest-signal reason first. "Rill drafted" wins
 *  even over a goal or VIP match: a ready draft is the more actionable fact. */
function reasonFor(row: InboxRow): { label: string; title: string; accent?: boolean } | null {
  if (row.hasDraft) return { label: "Rill drafted", title: "Rill wrote a reply. Review it before it sends.", accent: true };
  if (row.goal) return { label: "Goal", title: `Goal · ${row.goal.title}` };
  if (row.vip) return { label: "VIP", title: `VIP · ${row.vip.name} · ${TIER_LABEL[row.vip.tier]}` };
  if (row.lane === "screener") return { label: "New sender", title: "First time this sender has written to you." };
  if (row.needsReply) return { label: "Needs reply", title: "Needs a reply from you." };
  return null;
}

/** Lays itself out from the list's own width (container query), not the screen's. */
export const Row = memo(function Row({ row, selected, open, onSelect, onOpen }: {
  row: InboxRow; selected: boolean; open: boolean; onSelect: () => void; onOpen: () => void;
}) {
  const unread = row.unread;
  const reason = reasonFor(row);
  const flags = (
    <>
      {row.check && <Badge tone="warning" title="Jev was unsure about the lane. Worth a look.">Check</Badge>}
      {row.screen === "quarantine" && <Badge tone="destructive">Quarantined</Badge>}
      {row.replyLater && <Badge tone="outline">Later</Badge>}
    </>
  );
  const time = (
    <time dateTime={row.lastMessageAt} className="tnum shrink-0 text-right text-11 font-normal text-muted-foreground">
      {fmtRelative(row.lastMessageAt)}
    </time>
  );
  const dot = <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", unread ? "bg-accent" : "bg-transparent")} />;
  // Whose move: the Rill mark when a draft is waiting on you, nothing when the ball is yours to start.
  const owner = (
    <span className="flex w-4 shrink-0 items-center justify-center">
      {row.hasDraft && <OwnerMark label="Rill drafted a reply" />}
    </span>
  );

  return (
    <div
      id={rowDomId(row.threadId)}
      role="option"
      aria-selected={selected}
      data-thread={row.threadId}
      onMouseDown={onSelect}
      onClick={onOpen}
      className={cn(
        "group relative mx-1.5 min-w-0 cursor-default select-none rounded-md text-13 outline-none transition-colors duration-75",
        open ? "bg-muted" : selected ? "bg-card-hover" : "hover:bg-faint",
        selected && "ring-1 ring-inset ring-border-strong",
      )}
    >
      {unread && <span className="sr-only">Unread. </span>}

      {/* Narrow list: two lines, the subject gets the full width. */}
      <div className="flex flex-col gap-0.5 px-3 py-2.5 @min-[720px]:hidden">
        <div className="flex min-w-0 items-center gap-2">
          {dot}
          <span className={cn("min-w-0 flex-1 truncate", unread ? "font-semibold text-foreground" : "font-normal text-foreground/80")}>{row.from.name}</span>
          {flags}
          {time}
          {owner}
        </div>
        <div className="flex min-w-0 items-center gap-2 pl-3.5">
          {reason && <Chip {...reason} />}
          <span className="min-w-0 flex-1 truncate">
            <span className={cn(unread ? "font-semibold text-foreground" : "font-normal text-foreground/90")}>{row.subject}</span>
            {row.snippet && <span className="text-muted-foreground"> · {row.snippet}</span>}
          </span>
        </div>
      </div>

      {/* Wide list: one line, the chip before the subject, the owner slot far right. */}
      <div className="hidden h-11 min-w-0 items-center gap-2 px-3 @min-[720px]:flex">
        {dot}
        <span className={cn("w-[160px] shrink-0 truncate", unread ? "font-semibold text-foreground" : "font-normal text-foreground/80")}>{row.from.name}</span>
        {reason && <span className="hidden shrink-0 @min-[880px]:flex"><Chip {...reason} /></span>}
        <span className="min-w-0 flex-1 truncate">
          <span className={cn(unread ? "font-semibold text-foreground" : "font-normal text-foreground/90")}>{row.subject}</span>
          {row.snippet && <span className="text-muted-foreground"> · {row.snippet}</span>}
        </span>
        {flags}
        <span className="w-10 shrink-0 text-right">{time}</span>
        {owner}
      </div>
    </div>
  );
});

function OwnerMark({ label }: { label: string }) {
  return (
    <Tooltip label={label}>
      <span aria-label={label} className="flex size-4 shrink-0 items-center justify-center">
        <Logo size={12} className="opacity-70" />
      </span>
    </Tooltip>
  );
}

/** The one reason chip: filled, no icon, no border. Color only for meaning. */
function Chip({ label, title, accent }: { label: string; title: string; accent?: boolean }) {
  return (
    <span
      title={title}
      className={cn(
        "shrink-0 truncate rounded-md px-2 py-0.5 text-11 font-medium leading-none",
        accent ? "bg-accent/15 text-accent" : "bg-foreground/10 text-foreground/70",
      )}
    >
      {label}
    </span>
  );
}
