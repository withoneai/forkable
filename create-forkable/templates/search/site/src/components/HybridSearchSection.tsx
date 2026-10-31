import { Binary, Server, Users } from "lucide-react";
import { SectionHead } from "./SectionHead";
import { useReveal } from "../lib/hooks";
import { Shot } from "./Shot";

const CARDS = [
  {
    icon: Binary,
    title: "Exact names and vague descriptions",
    body: "Postgres full-text search and pgvector embeddings blend into a single relevance score, so an exact name and a vague description both find the right row.",
  },
  {
    icon: Server,
    title: "Local Postgres or Supabase",
    body: "Run it on an embedded Postgres on your own machine, or point it at any Postgres connection string, Supabase included. Same schema, your choice of where it lives.",
  },
  {
    icon: Users,
    title: "One person, one company",
    body: "A HubSpot contact, an Attio person, a Gmail thread and a Granola note about the same person merge into one entity, matched by email, domain and a Jev check.",
  },
];

export function HybridSearchSection() {
  const [ref, shown] = useReveal<HTMLDivElement>(0.15);
  return (
    <section id="search" className="relative scroll-mt-24 px-6 pb-24 pt-12 sm:pb-36">
      <SectionHead index="02" label="Hybrid search" title="Keyword and meaning, one ranking">
        Embeddings are made through One, on your grant, not a shared key. Nothing is indexed anywhere
        outside the Postgres you point it at.
      </SectionHead>
      <div ref={ref} className={`t-stagger mx-auto mt-12 grid max-w-6xl grid-cols-1 gap-3 sm:grid-cols-3 ${shown ? "is-shown" : ""}`}>
        {CARDS.map((c, i) => (
          <div key={c.title} className={`t-stagger-line t-stagger-line--${Math.min(i + 1, 4)} flex flex-col gap-2 rounded-xl border border-border bg-card/50 p-4`}>
            <c.icon className="size-4 text-accent-fg" strokeWidth={1.75} />
            <h3 className="text-13 font-medium">{c.title}</h3>
            <p className="text-13 text-muted-foreground">{c.body}</p>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-3 max-w-6xl">
        <Shot
          name="integrations"
          alt="Settings, Integrations: eleven sources with their models, sync status and item counts, one marked rate limited with a retry time"
        />
        <p className="mt-3 text-center text-13 text-muted-foreground">
          Each source syncs on its own schedule. Rate limits, retries and errors show up here, not as missing results.
        </p>
      </div>
    </section>
  );
}
