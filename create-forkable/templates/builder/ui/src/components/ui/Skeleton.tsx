import { cn } from "@/lib/utils";

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden style={style} className={cn("shimmer rounded-sm", className)} />;
}

export function RowSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex h-8 items-center gap-2.5 pl-3 pr-3" style={{ opacity: Math.max(0.25, 1 - i * 0.09) }}>
          <span className="size-[6px]" />
          <Skeleton className="h-2.5 w-[120px]" />
          <Skeleton className="h-2.5 flex-1" style={{ maxWidth: `${58 - (i % 4) * 9}%` }} />
          <Skeleton className="ml-auto h-2.5 w-6" />
        </div>
      ))}
    </div>
  );
}

/** A settings-style list of rows: label on the left, control on the right. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="overflow-hidden rounded-lg border border-border bg-card">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-12 items-center gap-3 border-b border-border px-4 last:border-b-0">
          <Skeleton className="size-4 rounded-full" />
          <Skeleton className="h-2.5 w-[140px]" />
          <Skeleton className="h-2.5 w-[220px] opacity-60" />
          <Skeleton className="ml-auto h-2.5 w-14" />
        </div>
      ))}
    </div>
  );
}
