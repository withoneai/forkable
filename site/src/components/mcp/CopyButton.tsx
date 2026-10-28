import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { Check, Copy } from "lucide-react";

// A button that copies `text` and swaps its icon to a check for a moment.
export function CopyButton({ text, label, className, children }: { text: string; label: string; className?: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={clsx("group inline-flex items-center gap-2 transition-colors", className)}
    >
      {children}
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
