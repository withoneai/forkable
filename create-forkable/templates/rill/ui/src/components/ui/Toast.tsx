import { X } from "lucide-react";
import { dismissToast, useToasts } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Kbd } from "./Kbd";

export function Toaster() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "slide-up pointer-events-auto flex h-9 min-w-[280px] max-w-[520px] items-center gap-3 rounded-lg border border-border bg-card pl-3 pr-1.5 text-13 shadow-float",
            t.tone === "destructive" && "text-destructive-text",
          )}
        >
          <span className="truncate">
            <span className="font-medium">{t.title}</span>
            {t.detail && <span className="text-muted-foreground"> · {t.detail}</span>}
          </span>
          {t.action && (
            <button
              type="button"
              className="ml-auto inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-foreground hover:bg-card-hover"
              onClick={() => { t.action!.onClick(); dismissToast(t.id); }}
            >
              {t.action.label}
              {t.action.label === "Undo" && <Kbd>Z</Kbd>}
            </button>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)} className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-card-hover hover:text-foreground", !t.action && "ml-auto")}>
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
