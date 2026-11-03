import { Bot, GitBranch, MousePointer2, RotateCcw, Wrench, ListChecks, GitCommitHorizontal } from "lucide-react";
import { SectionHead } from "./SectionHead";
import { connectorLogo } from "./icons";
import { useReveal } from "../lib/hooks";

const CARDS = [
  {
    icon: Bot,
    title: "Your agent does the work",
    body: "Claude Code or Codex, the one you already have and are signed in to. Builder finds it and drives it. No credits, its own plan pays.",
  },
  {
    icon: MousePointer2,
    title: "Point at what to change",
    body: "Select an element in the preview and ask, edit text in place, or leave a comment. The agent gets the file and line.",
  },
  {
    icon: Wrench,
    title: "Errors fix themselves",
    body: "Type errors, build errors and crashes in the preview go back to the agent on their own, until the app runs clean.",
  },
  {
    icon: ListChecks,
    title: "Plan before it builds",
    body: "Plan mode reads and proposes, nothing is edited. Build the plan when it reads right.",
  },
  {
    icon: RotateCcw,
    title: "Every turn is a version",
    body: "Each turn ends in a checkpoint with a screenshot and the diff. Preview any version, or restore it in one step.",
  },
  {
    icon: GitBranch,
    title: "A real git repo, yours",
    body: "Projects live on your machine as plain React, Hono and Drizzle in a git repo. Open them in your own editor any time.",
  },
];

const VERSIONS = [
  { subject: "Daily Stripe digest to Slack", sha: "8aee5f7", diff: "+286 −2", when: "now", badge: "Live" },
  { subject: "Show totals per customer", sha: "41c09d2", diff: "+58 −12", when: "4 min" },
  { subject: "Fixing 1 error", sha: "c7b2cbc", diff: "+3 −1", when: "6 min" },
  { subject: "Revenue page with filters", sha: "2b7ef6a", diff: "+190 −0", when: "9 min" },
];

export function BuildSection() {
  const [ref, shown] = useReveal<HTMLDivElement>(0.15);
  return (
    <section id="build" className="relative scroll-mt-24 px-6 pb-24 pt-12 sm:pb-36">
      <SectionHead index="02" label="Build" title="Your agent, on your machine">
        Chat on the left, the running app on the right. The agent writes real code in a real repo, and
        you watch every step land in the preview.
      </SectionHead>

      <div ref={ref} className={`t-stagger mx-auto mt-12 grid max-w-6xl grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] ${shown ? "is-shown" : ""}`}>
        <div className="t-stagger-line t-stagger-line--1 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CARDS.map((c) => (
            <div key={c.title} className="flex flex-col gap-2 rounded-xl border border-border bg-card/50 p-4">
              <c.icon className="size-4 text-accent-fg" strokeWidth={1.75} />
              <h3 className="text-13 font-medium">{c.title}</h3>
              <p className="text-13 text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>

        <div className="t-stagger-line t-stagger-line--2 flex flex-col gap-3">
          <div className="squircle overflow-hidden rounded-xl border border-border bg-background shadow-[var(--window-shadow)]">
            <div className="border-b border-border px-4 py-2 text-11 uppercase tracking-wide text-muted-foreground">Agents</div>
            {[
              { slug: "anthropic", name: "Claude Code", note: "Signed in · default" },
              { slug: "openai", name: "Codex", note: "Signed in" },
            ].map((a) => (
              <div key={a.name} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                <img src={connectorLogo(a.slug)} alt="" className="size-5 dark:invert" />
                <span className="flex-1 text-13 text-foreground">{a.name}</span>
                <span className="flex items-center gap-1.5 text-11 text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-accent-fg" />
                  {a.note}
                </span>
              </div>
            ))}
          </div>
          <div className="squircle flex-1 overflow-hidden rounded-xl border border-border bg-background shadow-[var(--window-shadow)]">
            <div className="border-b border-border px-4 py-2 text-11 uppercase tracking-wide text-muted-foreground">History</div>
            <ul>
              {VERSIONS.map((v) => (
                <li key={v.sha} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                  <GitCommitHorizontal className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-13 text-foreground">{v.subject}</span>
                    <span className="block font-mono text-11 text-muted-foreground">
                      {v.sha} · {v.diff}
                    </span>
                  </span>
                  {v.badge ? (
                    <span className="rounded-md bg-accent-fill px-1.5 py-0.5 text-11 font-medium text-accent-ink">{v.badge}</span>
                  ) : (
                    <span className="text-11 text-muted-foreground">{v.when}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
