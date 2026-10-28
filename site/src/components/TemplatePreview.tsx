import { useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { AppWindow } from "./AppWindow";
import { connectorLogo } from "./icons";
import type { Template } from "../lib/templates";

// A small running preview of the picked template on the Acme Inc sample
// data: real state, not a picture. Clicking a row approves it, same shape
// as the one-click approvals every One Connect template ships with.
export function TemplatePreview({ template }: { template: Template }) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  return (
    <AppWindow className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="text-13 font-semibold">{template.name}</span>
        <span className="text-11 text-muted-foreground">Acme Inc sample</span>
        <span className="flex-1" />
        <RefreshCw className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
      </header>
      <div key={template.slug} className="flex-1 space-y-1 p-2">
        {template.previewRows.map((row, i) => {
          const approved = done[row.label];
          return (
            <button
              key={row.label}
              type="button"
              onClick={() => setDone((d) => ({ ...d, [row.label]: !d[row.label] }))}
              className="animate-[row-in_360ms_var(--stagger-ease)_both] flex w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left text-13 transition-colors hover:bg-foreground/[0.04]"
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <span
                className={
                  approved
                    ? "grid size-4 shrink-0 place-items-center rounded-full bg-accent-fill text-accent-ink"
                    : "size-4 shrink-0 rounded-full border border-border"
                }
              >
                {approved && <Check className="size-2.5" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground/90">{row.label}</span>
              <span className="shrink-0 text-11 text-muted-foreground">{approved ? "Approved" : row.detail}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5 border-t border-border px-3 py-2">
        {template.platforms.map((p) => (
          <img key={p.slug} src={connectorLogo(p.slug)} alt={p.name} className="size-3.5 rounded-sm" />
        ))}
        <span className="text-11 text-muted-foreground">connected with One</span>
      </div>
    </AppWindow>
  );
}
