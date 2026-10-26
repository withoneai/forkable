import type { ApiEvent } from "@rill/core/api-types";
import { fmtTime, fmtTimeCompact } from "@/lib/calendarLayout";
import { cn } from "@/lib/utils";

/**
 * Tinted fill, a left edge bar, title left and start time right on one line;
 * the location is a second line only when the block is tall enough. A dashed
 * bar means "waiting on your reply"; selected flips to a solid fill.
 */
export function EventBlock({ event, tz, style, onClick, dense, tall, selected, ghost, onGrab }: {
  event: ApiEvent; tz: string; style?: React.CSSProperties; onClick: () => void; dense?: boolean; tall?: boolean; selected?: boolean;
  /** Faded copy left behind while the block is being dragged. */
  ghost?: boolean;
  /** Set for events you can move or resize: mousedown on the body moves, on the bottom edge resizes. */
  onGrab?: (mode: "move" | "resize", e: React.MouseEvent) => void;
}) {
  const cancelled = event.status === "cancelled";
  const declined = event.myResponse === "declined";
  const faded = cancelled || declined;
  const pending = !faded && (event.myResponse === "needsAction" || event.myResponse === "tentative" || event.status === "tentative");
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      aria-pressed={selected}
      onMouseDown={onGrab ? (e) => { if (e.button === 0) onGrab((e.target as HTMLElement).dataset.resize ? "resize" : "move", e); } : undefined}
      title={`${event.title}, ${fmtTime(event.start, tz)}${event.myResponse === "needsAction" ? ", waiting on your reply" : ""}`}
      className={cn(
        "group absolute flex flex-col overflow-hidden rounded-sm border-l-2 px-1.5 text-left transition-colors duration-100",
        dense ? "justify-center" : "gap-0.5 py-1",
        selected
          ? "border-l-foreground bg-foreground text-background"
          : faded
            ? "border-l-muted-foreground/40 bg-muted/40 text-muted-foreground"
            : event.conflict
              ? "border-l-warning-text bg-warning-text/[0.09] hover:bg-warning-text/[0.14] dark:bg-warning-text/[0.12]"
              : "border-l-foreground/45 bg-muted/80 hover:bg-muted dark:border-l-foreground/55 dark:bg-foreground/[0.09] dark:hover:bg-foreground/[0.13]",
        pending && !selected && "border-dashed",
        onGrab && "cursor-grab active:cursor-grabbing",
        ghost && "opacity-40",
      )}
    >
      <span className="flex min-w-0 items-baseline gap-1 text-11 leading-4">
        <span className={cn("min-w-0 flex-1 truncate font-medium", cancelled && "line-through")}>{event.title}</span>
        <span className={cn("tnum shrink-0 text-10", selected ? "text-background/70" : "text-muted-foreground")}>{fmtTimeCompact(event.start, tz)}</span>
      </span>
      {tall && event.location && (
        <span className={cn("truncate text-10 leading-3", selected ? "text-background/70" : "text-muted-foreground")}>{event.location}</span>
      )}
      {onGrab && <span data-resize aria-hidden className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize" />}
    </button>
  );
}
