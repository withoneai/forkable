import { Quote, ListFilter, MessageSquareText } from "lucide-react";
import { SectionHead } from "./SectionHead";
import { Shot } from "./Shot";
import { useReveal } from "../lib/hooks";

const POINTS = [
  { icon: Quote, title: "Every claim is numbered", body: "Each number opens the row it came from, with the quote that backs it." },
  { icon: ListFilter, title: "It can narrow the search", body: "It proposes a tighter query. Apply it, or keep the question in the chat." },
  { icon: MessageSquareText, title: "Only what Search found", body: "No outside facts. If the results do not say it, the answer does not either." },
];

export function AskSection() {
  const [ref, shown] = useReveal<HTMLDivElement>(0.2);
  return (
    <section id="ask" className="relative scroll-mt-24 px-6 pb-24 pt-12 sm:pb-36">
      <SectionHead index="03" label="The AI on the right" title="It reasons, it cites, it refines">
        Press ⌘J and ask about what you found. The assistant reads the results, answers in a few
        sentences and points at its sources.
      </SectionHead>

      <div className="mx-auto mt-12 max-w-6xl">
        <Shot
          name="dock-answer"
          alt="Search with the assistant docked on the right: asked where things stand with Globex, it answers with numbered citations, one opened to the HubSpot deal it quotes"
        />
        <div ref={ref} className={`t-stagger mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 ${shown ? "is-shown" : ""}`}>
          {POINTS.map((p, i) => (
            <div key={p.title} className={`t-stagger-line t-stagger-line--${i + 1} flex flex-col gap-2 rounded-xl border border-border bg-card/50 p-4`}>
              <p.icon className="size-4 text-accent-fg" strokeWidth={1.75} />
              <h3 className="text-13 font-medium">{p.title}</h3>
              <p className="text-13 text-muted-foreground">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
