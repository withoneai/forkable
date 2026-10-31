import { Terminal as TerminalIcon, Code2, Plug } from "lucide-react";
import { SectionHead } from "./SectionHead";
import { useReveal } from "../lib/hooks";

const SURFACES = [
  {
    icon: TerminalIcon,
    title: "CLI",
    body: "Query from a terminal with the same operators and ranking as the app. Scriptable, with --json.",
    code: "$ search \"priya globex contract\"",
  },
  {
    icon: Code2,
    title: "API",
    body: "A REST API behind OAuth. Your own tools and scripts query the same index your sign-in sees.",
    code: "GET /api/v1/search?q=priya+globex",
  },
  {
    icon: Plug,
    title: "MCP",
    body: "An MCP server with OAuth, Sign in with One behind it. Point Claude Code, Codex or Claude Desktop at it and ask.",
    code: "$ search mcp-config --client claude-code",
  },
];

export function SurfacesSection() {
  const [ref, shown] = useReveal<HTMLDivElement>(0.15);
  return (
    <section id="surfaces" className="relative scroll-mt-24 px-6 pb-24 pt-12 sm:pb-36">
      <SectionHead index="04" label="CLI, API, MCP" title="Search it from anywhere">
        The web app, a CLI, a REST API and an MCP server all read the same index, each behind the
        signed-in user's own grant.
      </SectionHead>
      <div ref={ref} className={`t-stagger mx-auto mt-12 grid max-w-6xl grid-cols-1 gap-3 sm:grid-cols-3 ${shown ? "is-shown" : ""}`}>
        {SURFACES.map((s, i) => (
          <div key={s.title} className={`t-stagger-line t-stagger-line--${Math.min(i + 1, 4)} flex flex-col gap-3 rounded-xl border border-border bg-card/50 p-4`}>
            <s.icon className="size-4 text-accent-fg" strokeWidth={1.75} />
            <h3 className="text-13 font-medium">{s.title}</h3>
            <p className="text-13 text-muted-foreground">{s.body}</p>
            <code className="mt-auto truncate rounded-md border border-border bg-background px-2 py-1.5 font-mono text-11 text-muted-foreground">
              {s.code}
            </code>
          </div>
        ))}
      </div>
    </section>
  );
}
