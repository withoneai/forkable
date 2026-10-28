import { useState } from "react";
import { Check, Copy } from "lucide-react";

const DEFAULT_COMMAND = "npm create forkable@latest";

// The launch command, set in the site's mono voice: one line, a copy
// button, no window chrome. This is the hero CTA, not a secondary detail.
export function Terminal({ command = DEFAULT_COMMAND, className }: { command?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(command).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={`group flex items-center gap-3 rounded-full border border-border bg-card/80 px-5 py-3 font-mono text-13 text-foreground backdrop-blur-xl transition-colors hover:border-foreground/20 ${className ?? ""}`}
    >
      <span className="select-none text-muted-foreground">$</span>
      <span className="select-all">{command}</span>
      <span className="t-icon-swap shrink-0" data-state={copied ? "b" : "a"}>
        <span className="t-icon" data-icon="a">
          <Copy className="size-3.5 text-muted-foreground transition-colors group-hover:text-foreground" strokeWidth={2} />
        </span>
        <span className="t-icon" data-icon="b">
          <Check className="size-3.5 text-accent-fg" strokeWidth={2.5} />
        </span>
      </span>
    </button>
  );
}
