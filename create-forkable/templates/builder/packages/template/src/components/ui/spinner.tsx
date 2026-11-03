import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** An inline busy mark. For whole sections prefer Skeleton rows in the shape of the content. */
export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return <Loader2 role="status" aria-label={label} className={cn("size-3.5 animate-spin text-muted-foreground", className)} />;
}
