import { forwardRef, type ReactNode } from "react";
import { CircleDashed, CircleDot, CircleCheck, CircleX, Circle, Paperclip, Users, Video } from "lucide-react";
import type { ResultRow as Row } from "@/contract/api-types";
import { cn, fmtMoney, fmtRelative, fmtTime, KIND_LABEL, enumLabel, nameForAddress, ownerName, platformName, splitHighlights, stageLabel } from "@/lib/utils";
import { SourceLogo } from "@/components/SourceLogo";
import { AccountChip } from "@/components/AccountChip";
import { useAccounts } from "@/lib/accounts";
import { Avatar } from "@/components/ui/Avatar";

export function Highlighted({ text, ranges, className }: { text: string; ranges: [number, number][]; className?: string }) {
  return (
    <span className={className}>
      {splitHighlights(text, ranges).map((p, i) => (p.hit ? <b key={i} className="font-semibold text-foreground">{p.text}</b> : <span key={i}>{p.text}</span>))}
    </span>
  );
}

const RSVP: Record<string, string> = { accepted: "Going", tentative: "Maybe", declined: "No", needsAction: "Invited" };

export function StateIcon({ type, className }: { type?: string; className?: string }) {
  const c = cn("size-3.5 shrink-0 stroke-[1.75]", className);
  if (type === "completed") return <CircleCheck className={cn(c, "text-success-text")} aria-label="Done" />;
  if (type === "canceled") return <CircleX className={cn(c, "text-muted-foreground")} aria-label="Canceled" />;
  if (type === "started") return <CircleDot className={cn(c, "text-warning-text")} aria-label="In progress" />;
  if (type === "backlog") return <CircleDashed className={cn(c, "text-muted-foreground")} aria-label="Backlog" />;
  return <Circle className={cn(c, "text-muted-foreground")} aria-label="Todo" />;
}

export function PriorityBars({ p }: { p?: number }) {
  if (!p) return null;
  const lvl = p === 1 ? 4 : 5 - p; // 1 urgent ... 4 low
  return (
    <span className="inline-flex h-3 items-end gap-px" aria-label={["", "Urgent", "High", "Medium", "Low"][p]} title={["", "Urgent", "High", "Medium", "Low"][p]}>
      {[1, 2, 3].map((i) => <span key={i} className={cn("w-[3px] rounded-[1px]", i <= Math.min(3, lvl) ? (p === 1 ? "bg-destructive-text" : "bg-foreground/70") : "bg-border-strong")} style={{ height: `${4 + i * 2.5}px` }} />)}
    </span>
  );
}

/**
 * A sender as a name: facets carry what the provider sent (an address, a Slack user id),
 * the linked people carry the resolved entity. Prefers the linked from/author whose name
 * matches the address, then the first one, then the raw value.
 */
function senderName(r: Row, raw: string | null | undefined): string {
  const from = r.people.filter((p) => p.role === "from" || p.role === "author");
  const looksRaw = !raw || raw.includes("@") || /^[UWB][A-Z0-9]{5,}$/.test(raw);
  if (!looksRaw) return raw!;
  const local = raw?.split("@")[0]?.split(/[._+-]/)[0]?.toLowerCase() ?? "";
  const hit = (local && from.find((p) => p.name.toLowerCase().startsWith(local))) || from[0];
  return hit?.name ?? raw ?? "";
}

/** Per-type content, search-ux-mobbin.md 2.4 (normative table). */
function parts(r: Row): { type: ReactNode; title: ReactNode; context: ReactNode; meta: ReactNode; second: ReactNode | null } {
  const f = r.facets;
  const title = <Highlighted text={r.title} ranges={r.titleHighlights} />;
  const snippet = r.snippet && r.snippetHighlights.length ? <Highlighted text={r.snippet} ranges={r.snippetHighlights} /> : null;
  const when = <span className="tnum">{fmtRelative(r.occurredAt)}</span>;
  const typeText = (t: string) => <span className="truncate">{t}</span>;
  switch (f.kind) {
    case "email_thread": {
      const sender = senderName(r, f.lastFrom);
      return {
        type: typeText("Mail"),
        title: <><span className={cn(f.unread ? "font-semibold" : "font-medium")}>{sender}</span><span className="text-muted-foreground"> · </span>{title}{f.messageCount > 1 && <span className="tnum text-muted-foreground"> ({f.messageCount})</span>}</>,
        context: null,
        meta: <>{f.hasAttachment && <Paperclip className="size-3" aria-label="Has attachments" />}{when}</>,
        second: snippet,
      };
    }
    case "event": {
      const names = (f.attendees ?? []).map((a) => (a.name ?? nameForAddress(r.people, a.email) ?? a.email ?? "").split(" ")[0]).filter(Boolean);
      const resp = f.selfResponse ?? "accepted";
      return {
        type: typeText("Event"),
        title,
        context: <span className="tnum">{new Date(f.start).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}, {fmtTime(f.start)} to {fmtTime(f.end)}</span>,
        meta: <span className={cn("rounded-sm px-1.5 py-0.5 text-11 font-medium leading-none", resp === "needsAction" ? "border border-dashed border-border-strong text-foreground" : resp === "declined" ? "bg-muted text-muted-foreground line-through" : "bg-muted text-foreground")}>{RSVP[resp] ?? resp}</span>,
        second: names.length ? <span className="inline-flex items-center gap-1.5"><span>{names.slice(0, 2).join(", ")}{names.length > 2 ? ` +${names.length - 2}` : ""}</span>{f.joinUrl && <Video className="size-3" aria-label="Has a meeting link" />}</span> : null,
      };
    }
    case "person":
      return {
        type: <Avatar name={r.title} size="sm" />,
        title,
        context: [f.jobTitle, f.companyName].filter(Boolean).join(" at "),
        meta: <span>Updated {fmtRelative(r.updatedAt ?? r.occurredAt)}</span>,
        second: f.email ? <span className="font-mono text-11">{f.email}</span> : null,
      };
    case "company":
      return {
        type: <Avatar name={r.title} size="sm" className="rounded-sm" />,
        title,
        context: f.domain,
        meta: ownerName(f.owner) ? <span>{ownerName(f.owner)}</span> : when,
        second: [enumLabel(f.industry), f.size ? `${f.size} people` : null].filter(Boolean).join(" · ") || null,
      };
    case "doc":
      return { type: typeText("Doc"), title, context: f.parentTitle ? <span>› {f.parentTitle}</span> : null, meta: <>{ownerName(f.editedBy) && <Avatar name={ownerName(f.editedBy)!} size="xs" />}{when}</>, second: snippet };
    case "task":
      return {
        type: <span className="font-mono text-11 text-muted-foreground">{f.key ?? "Issue"}</span>,
        title: <span className="inline-flex min-w-0 items-center gap-1.5"><StateIcon type={f.stateType} />{title}</span>,
        context: f.state,
        meta: <><PriorityBars p={f.priority} />{f.assignee && <Avatar name={f.assignee} size="xs" />}{f.due ? <span className="tnum">due {fmtRelative(f.due)}</span> : when}</>,
        second: snippet,
      };
    case "message": {
      // the pack titles a chat message by its channel; the row reads "Sender: the message" (2.4)
      const text = r.snippet ? <Highlighted text={r.snippet} ranges={r.snippetHighlights} /> : title;
      const ch = f.channel ? (f.channel.startsWith("#") || /\s/.test(f.channel) || r.platform !== "slack" ? f.channel : `#${f.channel}`) : r.title.startsWith("#") ? r.title : "DM";
      return {
        type: typeText(ch),
        title: <><span className="font-medium">{senderName(r, f.sender)}</span><span className="text-muted-foreground">: </span>{text}</>,
        context: null,
        meta: when,
        second: f.replyCount ? <span>{f.replyCount} {f.replyCount === 1 ? "reply" : "replies"}</span> : null,
      };
    }
    case "meeting_note":
      return {
        type: typeText("Meeting"),
        title,
        context: <span className="tnum">{new Date(r.occurredAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}{f.durationMin ? ` · ${f.durationMin} min` : ""}</span>,
        meta: <span className="inline-flex items-center gap-1"><Users className="size-3" />{f.attendees?.length ?? 0}</span>,
        second: f.takeaways?.[0] ? <span>{f.takeaways[0]}</span> : snippet,
      };
    case "deal":
      return {
        type: typeText("Deal"),
        title,
        context: f.companyName,
        meta: <><span className="tnum font-medium text-foreground">{fmtMoney(f.amount, f.currency)}</span>{f.stage && <span className="rounded-sm bg-muted px-1.5 py-0.5 text-11 leading-none text-foreground">{stageLabel(f.stage)}</span>}</>,
        second: [f.closeDate ? `Closes ${new Date(f.closeDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : null, ownerName(f.owner)].filter(Boolean).join(" · ") || null,
      };
    case "note":
      return { type: typeText("Note"), title, context: f.parentTitle ? `on ${f.parentTitle}` : null, meta: when, second: snippet };
    default:
      return { type: typeText(KIND_LABEL[r.kind] ?? "Record"), title, context: r.context, meta: when, second: snippet };
  }
}

export const ResultRowView = forwardRef<HTMLDivElement, { row: Row; selected: boolean; onSelect: () => void; onOpen: () => void; index: number; compact?: boolean }>(
  function ResultRowView({ row, selected, onSelect, onOpen, index, compact }, ref) {
    const p = parts(row);
    const two = !!p.second && !compact;
    // two accounts on this platform: which one, as a short chip ("acme.dev"), never the full address on every row
    const accounts = useAccounts();
    const acctLabel = row.sourceName.includes(" · ") ? row.sourceName.split(" · ").slice(1).join(" · ") : null;
    const acct = acctLabel ? accounts.find(row.platform, acctLabel) : undefined;
    const calColor = row.facets.kind === "event" ? row.facets.calendarColor : null;
    return (
      <div
        ref={ref}
        role="option"
        aria-selected={selected}
        data-testid="result-row"
        data-id={row.id}
        data-index={index}
        onMouseDown={(e) => { if (e.button === 0) onSelect(); }}
        onDoubleClick={onOpen}
        className={cn(
          "group relative flex shrink-0 cursor-default select-none flex-col justify-center gap-1.5 px-3 transition-colors duration-75",
          two ? "h-14" : "h-9",
          selected ? "bg-muted" : "hover:bg-card-hover",
        )}
      >
        {selected && <span aria-hidden className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-accent" />}
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="relative flex shrink-0">
            <SourceLogo platform={row.platform} size={16} />
            {calColor && <span aria-hidden className="absolute -left-1.5 top-0 h-4 w-[3px] rounded-full" style={{ background: calColor }} />}
          </span>
          <span className="flex w-16 shrink-0 items-center text-11 text-muted-foreground">{p.type}</span>
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="min-w-0 truncate text-13 text-foreground">{p.title}</span>
            {p.context && <span className="hidden shrink-0 truncate text-xs text-muted-foreground sm:inline md:max-w-[40%]">{p.context}</span>}
          </span>
          {/* one row per person or company: the other tools that hold a record for them */}
          {row.alsoIn?.length ? (
            <span className="flex shrink-0 items-center gap-1" title={`Also in ${row.alsoIn.map(platformName).join(", ")}`} aria-label={`Also in ${row.alsoIn.map(platformName).join(", ")}`} data-testid="also-in">
              {row.alsoIn.map((pl) => <SourceLogo key={pl} platform={pl} size={12} />)}
            </span>
          ) : row.groupCount > 1 && <span className="tnum shrink-0 rounded-sm bg-muted px-1 text-11 text-muted-foreground">+{row.groupCount - 1}</span>}
          {/* two accounts on one platform: which one ("Gmail · dana@acme.dev" from the server) */}
          {acctLabel && <AccountChip short={acct?.short ?? acctLabel} mark={acct?.mark} label={acctLabel} className="hidden md:inline-flex" />}
          <span className="flex shrink-0 items-center gap-2 text-11 text-muted-foreground">{p.meta}</span>
        </div>
        {two && <div className="min-w-0 truncate pl-[calc(16px+5.25rem)] text-xs text-muted-foreground">{p.second}</div>}
      </div>
    );
  },
);

