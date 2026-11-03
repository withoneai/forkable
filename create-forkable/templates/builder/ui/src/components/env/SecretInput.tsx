// The one input every secure value goes through. Masked by default on
// secret names with a show/hide toggle, never autofilled or spellchecked,
// and a pasted block of NAME=value lines is handed to the form to split
// instead of landing in one field. The typed value lives in this
// component's state only; it is cleared after a save.

import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { AlertTriangle, Check, Eye, EyeOff, X } from "lucide-react";
import { looksLikeBlock, type EnvCheck } from "@builder/core/envvars";
import { cn } from "@/lib/utils";

const base =
  "h-8 w-full rounded-md border bg-card pl-2.5 font-mono text-xs text-foreground placeholder:font-sans placeholder:text-muted-foreground/60 transition-[border-color,box-shadow] duration-100 " +
  "focus:outline-none focus-visible:outline-none disabled:opacity-50";

export interface SecretInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type"> {
  value: string;
  onChange: (v: string) => void;
  /** Masked with a show/hide toggle. */
  secret?: boolean;
  /** A paste with several NAME=value lines: the form splits it. */
  onBlock?: (text: string) => void;
  check?: EnvCheck | null;
}

export const SecretInput = forwardRef<HTMLInputElement, SecretInputProps>(function SecretInput(
  { value, onChange, secret, onBlock, check, className, ...rest },
  ref,
) {
  const [shown, setShown] = useState(false);
  const tone = !value || !check ? "idle" : check.level;
  return (
    <div className="relative flex items-center">
      <input
        ref={ref}
        {...rest}
        type={secret && !shown ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (onBlock && looksLikeBlock(text)) {
            e.preventDefault();
            onBlock(text);
          }
        }}
        autoComplete={secret ? "new-password" : "off"}
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        aria-invalid={tone === "error" || undefined}
        className={cn(
          base,
          secret ? "pr-14" : "pr-8",
          tone === "error"
            ? "border-destructive-text/60 focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--destructive-text)_16%,transparent)]"
            : tone === "warn"
              ? "border-warning-text/60 focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--warning-text)_16%,transparent)]"
              : "border-border hover:border-border-strong focus:border-ring focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--ring)_18%,transparent)]",
          className,
        )}
      />
      <span className="pointer-events-none absolute right-2 flex items-center gap-1">
        {tone === "ok" && <Check className="size-3.5 stroke-[2.25] text-success-text" aria-hidden />}
        {tone === "warn" && <AlertTriangle className="size-3.5 text-warning-text" aria-hidden />}
        {tone === "error" && <X className="size-3.5 stroke-[2.25] text-destructive-text" aria-hidden />}
        {secret && (
          <button
            type="button"
            className="pointer-events-auto inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={shown ? "Hide the value" : "Show the value"}
            aria-pressed={shown}
            title={shown ? "Hide" : "Show"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShown((v) => !v)}
          >
            {shown ? <EyeOff className="size-3.5 stroke-[1.75]" /> : <Eye className="size-3.5 stroke-[1.75]" />}
          </button>
        )}
      </span>
    </div>
  );
});
