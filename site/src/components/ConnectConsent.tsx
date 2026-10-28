import { useRef, useState } from "react";
import clsx from "clsx";
import { Check, ShieldCheck } from "lucide-react";
import { connectorLogo } from "./icons";
import type { Template } from "../lib/templates";

type Level = "Read only" | "Read & write" | "Full access";
const LEVELS: Level[] = ["Read only", "Read & write", "Full access"];

type Step = 1 | 2 | 3 | 4;

// The real consent flow is three steps: confirm email, a 6-digit code, then
// connect tools and set access. This mocks it faithfully on the Acme Inc
// sample, never a fourth step.
export function ConnectConsent({ template }: { template: Template }) {
  const [step, setStep] = useState<Step>(1);
  const [email, setEmail] = useState("you@acme.inc");
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [levels, setLevels] = useState<Record<string, Level>>(() =>
    Object.fromEntries(template.platforms.map((p) => [p.slug, "Read only" as Level])),
  );
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const codeDone = digits.every((d) => d !== "");

  const reset = () => {
    setStep(1);
    setDigits(Array(6).fill(""));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1.5 font-mono text-11 uppercase tracking-wide text-muted-foreground">
        {["Confirm email", "Enter code", "Connect tools"].map((label, i) => {
          const n = (i + 1) as Step;
          const active = step === n || (step === 4 && n === 3);
          const past = step > n;
          return (
            <span key={label} className="flex items-center gap-1.5 whitespace-nowrap">
              {i > 0 && <span className="h-px w-3 shrink-0 bg-border" aria-hidden />}
              <span className={clsx(past || active ? "text-foreground" : undefined)}>
                {n}. <span className="hidden sm:inline">{label}</span>
              </span>
            </span>
          );
        })}
      </div>

      {step === 1 && (
        <div className="flex flex-col gap-3">
          <label className="text-13 text-muted-foreground">
            Confirm the email {template.name} will connect for.
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-13 outline-none focus:border-foreground/30"
          />
          <button
            type="button"
            onClick={() => setStep(2)}
            className="self-start rounded-full bg-foreground px-4 py-2 text-13 font-medium text-background transition-opacity hover:opacity-90"
          >
            Send code
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          <label className="text-13 text-muted-foreground">Enter the 6-digit code sent to {email}.</label>
          <div className="flex gap-1.5">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputs.current[i] = el;
                }}
                value={d}
                maxLength={1}
                inputMode="numeric"
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(-1);
                  setDigits((prev) => {
                    const next = [...prev];
                    next[i] = v;
                    return next;
                  });
                  if (v && i < 5) inputs.current[i + 1]?.focus();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
                }}
                className="size-9 rounded-lg border border-border bg-background text-center text-15 outline-none focus:border-foreground/30"
              />
            ))}
          </div>
          <button
            type="button"
            disabled={!codeDone}
            onClick={() => setStep(3)}
            className="self-start rounded-full bg-foreground px-4 py-2 text-13 font-medium text-background transition-opacity enabled:hover:opacity-90 disabled:opacity-40"
          >
            Verify
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-3">
          <p className="text-13 text-muted-foreground">
            {template.name} is asking for these tools. Choose the access for each one.
          </p>
          {template.platforms.map((p) => (
            <div key={p.slug} className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5">
              <div className="flex items-center gap-2 text-13">
                <img src={connectorLogo(p.slug)} alt="" className="size-4 rounded-sm" />
                {p.name}
              </div>
              <div className="flex gap-1 rounded-md bg-background p-0.5">
                {LEVELS.map((lv) => (
                  <button
                    key={lv}
                    type="button"
                    onClick={() => setLevels((prev) => ({ ...prev, [p.slug]: lv }))}
                    className={clsx(
                      "rounded-sm px-2 py-1 text-11 transition-colors",
                      levels[p.slug] === lv ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {lv}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setStep(4)}
            className="self-start rounded-full bg-accent-fill px-4 py-2 text-13 font-medium text-accent-ink transition-opacity hover:opacity-90"
          >
            Allow access
          </button>
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-13 text-foreground">
            <ShieldCheck className="size-4 text-accent-fg" strokeWidth={1.75} />
            Granted
          </div>
          <ul className="flex flex-col gap-1.5">
            {template.platforms.map((p) => (
              <li key={p.slug} className="flex items-center gap-2 text-13 text-muted-foreground">
                <Check className="size-3.5 text-foreground" strokeWidth={2.5} />
                {p.name} <span className="text-foreground">{levels[p.slug]}</span>
              </li>
            ))}
          </ul>
          <p className="text-11 text-muted-foreground">
            {template.name} now runs on your own accounts. Change or revoke them any time in your One account.
          </p>
          <button type="button" onClick={reset} className="self-start text-13 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Start over
          </button>
        </div>
      )}
    </div>
  );
}
