import { Fragment, useState } from "react";
import clsx from "clsx";
import { Check, Copy } from "lucide-react";
import { FORK_COMMAND } from "../lib/links";

// The fork command as the page's primary button, the way Rill's landing
// leads: solid, mono, one click copies it. On a phone it wraps at the
// spaces instead of running off the screen.
export function Terminal({ command = FORK_COMMAND, className }: { command?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(command).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      aria-label={copied ? "Copied" : `Copy ${command}`}
      className={clsx(
        "group inline-flex max-w-full items-center gap-3 rounded-3xl bg-foreground px-5 py-3 text-left font-mono text-11 text-background transition-[box-shadow,transform] duration-300 hover:shadow-[0_0_0_4px_var(--accent-glow),0_0_40px_var(--accent-glow)] active:scale-[0.98] sm:rounded-full sm:px-6 sm:text-13",
        className,
      )}
    >
      <span className="select-none self-start text-background/50 sm:self-auto">$</span>
      <span className="min-w-0">
        {/* Wrap only between the package and its flags, never inside "-- --template". */}
        {command.split(/ (?=-- )/).map((part, i) => (
          <Fragment key={i}>
            {i > 0 && " "}
            <span className="whitespace-nowrap">{part}</span>
          </Fragment>
        ))}
      </span>
      <span className="t-icon-swap shrink-0" data-state={copied ? "b" : "a"}>
        <span className="t-icon" data-icon="a">
          <Copy className="size-3.5 opacity-60" strokeWidth={2} />
        </span>
        <span className="t-icon" data-icon="b">
          <Check className="size-3.5" strokeWidth={2.5} />
        </span>
      </span>
    </button>
  );
}
