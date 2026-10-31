import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Inline label pill for a goal or VIP on a row. Neutral by design. */
export function Chip({ icon, className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { icon?: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-[1.125rem] max-w-[150px] shrink-0 items-center gap-1 truncate rounded-sm bg-muted px-1.5 text-11 font-medium leading-none text-muted-foreground",
        className,
      )}
      {...rest}
    >
      {icon ? <span className="shrink-0 opacity-80 [&>svg]:size-[11px] [&>svg]:stroke-[1.75]">{icon}</span> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
