import { useState } from "react";
import { cn, initials } from "@/lib/utils";

/** A person: their picture when there is one that loads, else their initials. */
export function Avatar({ name, src, size = "sm", className }: { name: string; src?: string | null; size?: "xs" | "sm" | "md" | "lg"; className?: string }) {
  const s = { xs: "size-4 text-8", sm: "size-5 text-9", md: "size-6 text-10", lg: "size-9 text-xs" }[size];
  const [broken, setBroken] = useState<string | null>(null);
  const shape = cn("inline-flex shrink-0 select-none items-center justify-center rounded-full ring-1 ring-inset ring-foreground/5", s, className);
  if (src && broken !== src) {
    return <img src={src} alt="" aria-hidden referrerPolicy="no-referrer" onError={() => setBroken(src)} className={cn(shape, "bg-muted object-cover")} />;
  }
  return (
    <span aria-hidden className={cn(shape, "bg-muted font-semibold tracking-wide text-muted-foreground")}>
      {initials(name)}
    </span>
  );
}
