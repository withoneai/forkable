import { useEffect, useState } from "react";
import { Check, ExternalLink, Loader2, Lock, Rocket } from "lucide-react";
import clsx from "clsx";
import { SectionHead } from "./SectionHead";
import { connectorLogo } from "./icons";
import { useReveal } from "../lib/hooks";
import { CHECKS } from "../lib/demo";

const POINTS = [
  {
    title: "Checked before it ships",
    body: "Typecheck, build, a scan for secrets in the code and the bundle, the access list against the code, and pnpm audit. A failing check blocks the publish and hands the findings to the agent.",
  },
  {
    title: "Vercel or GitHub",
    body: "Deploy to Vercel, or export the repo to GitHub, private unless you say otherwise. Both run on your own One account.",
  },
  {
    title: "Live with sign-in on",
    body: "The published app keeps Sign in with One, so the people who use it connect their own tools and can revoke them any time.",
  },
];

export function PublishSection() {
  const [ref, shown] = useReveal<HTMLDivElement>(0.3);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!shown) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTick(99);
      return;
    }
    const id = setInterval(() => setTick((t) => (t >= 9 ? t : t + 1)), 380);
    return () => clearInterval(id);
  }, [shown]);
  const checks = Math.min(CHECKS.length, tick);
  const deploying = tick >= CHECKS.length + 1;
  const live = tick >= CHECKS.length + 3;

  return (
    <section id="publish" className="relative scroll-mt-24 px-6 pb-24 pt-12 sm:pb-36">
      <SectionHead index="03" label="Publish" title="One click to live">
        Press Publish. The version you are looking at gets checked, built and deployed, and you get a
        URL to send.
      </SectionHead>

      <div className="mx-auto mt-12 grid max-w-5xl grid-cols-1 items-center gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div ref={ref} className="squircle overflow-hidden rounded-xl border border-border bg-background shadow-[var(--window-shadow)]">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Rocket className="size-4 text-accent-fg" strokeWidth={1.75} />
            <span className="text-15 font-medium text-foreground">Publish revenue-digest</span>
            <span className="ml-auto font-mono text-11 text-muted-foreground">8aee5f7</span>
          </div>
          <div className="p-4">
            <p className="text-11 uppercase tracking-wide text-muted-foreground">Checks</p>
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {CHECKS.map((c, i) => (
                <li key={c} className="flex items-center gap-2 px-3 py-2 text-13">
                  {i < checks ? (
                    <Check className="size-3.5 text-accent-fg" strokeWidth={2.5} />
                  ) : i === checks && shown ? (
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" strokeWidth={2} />
                  ) : (
                    <span className="size-3.5 rounded-full border border-border" />
                  )}
                  <span className={i < checks ? "text-foreground" : "text-muted-foreground"}>{c}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-11 uppercase tracking-wide text-muted-foreground">Where to</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <span className="flex items-center gap-2 rounded-lg border border-accent-fg/60 bg-card/60 px-3 py-2 text-13 text-foreground">
                <img src={connectorLogo("vercel")} alt="" className="size-4 dark:invert" />
                Vercel
              </span>
              <span className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-13 text-muted-foreground">
                <img src={connectorLogo("github")} alt="" className="size-4 dark:invert" />
                GitHub
                <Lock className="ml-auto size-3" strokeWidth={1.75} />
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-border px-4 py-3">
            {live ? (
              <span className="motion-in flex min-w-0 items-center gap-2 text-13">
                <span className="live-dot size-1.5 shrink-0 rounded-full bg-accent-fg" />
                <span className="text-muted-foreground">Live at</span>
                <span className="truncate font-mono text-foreground">revenue-digest.vercel.app</span>
                <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              </span>
            ) : (
              <span className="flex items-center gap-2 text-13 text-muted-foreground">
                {deploying && <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />}
                {deploying ? "Deploying to Vercel" : "Runs on your One account"}
              </span>
            )}
            <span
              className={clsx(
                "ml-auto shrink-0 rounded-md px-3 py-1.5 text-13 font-medium transition-colors",
                live ? "border border-border text-foreground" : "bg-accent-fill text-accent-ink",
              )}
            >
              {live ? "Open" : "Deploy"}
            </span>
          </div>
        </div>

        <ul className="flex flex-col gap-6">
          {POINTS.map((p, i) => (
            <li key={p.title} className="flex gap-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-11 font-medium text-background">
                {i + 1}
              </span>
              <span>
                <h3 className="text-15 font-medium text-foreground">{p.title}</h3>
                <p className="mt-1 text-13 text-muted-foreground">{p.body}</p>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
