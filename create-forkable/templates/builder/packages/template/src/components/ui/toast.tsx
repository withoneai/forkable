import { CircleAlert, CircleCheck, Info } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "info" | "success" | "error";
interface Toast {
  id: number;
  tone: Tone;
  title: string;
  description?: string;
}

const ToastContext = React.createContext<(t: Omit<Toast, "id">) => void>(() => {});

/** const toast = useToast(); toast({ tone: "success", title: "Saved" }) */
export function useToast() {
  return React.useContext(ToastContext);
}

export function Toaster({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const push = React.useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), 4000);
  }, []);
  const icons = { info: Info, success: CircleCheck, error: CircleAlert };
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div key={t.id} className="slide-up pointer-events-auto flex gap-2 rounded-lg border border-border bg-card p-3 shadow-float">
              <Icon
                className={cn(
                  "mt-0.5 size-3.5 shrink-0",
                  t.tone === "success" && "text-success-text",
                  t.tone === "error" && "text-destructive-text",
                  t.tone === "info" && "text-muted-foreground",
                )}
              />
              <div className="min-w-0">
                <p className="text-13 font-medium">{t.title}</p>
                {t.description && <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
