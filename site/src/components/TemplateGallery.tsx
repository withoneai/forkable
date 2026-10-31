import { SectionHead } from "./SectionHead";
import { ForkLanes } from "./art/ForkLanes";
import { TemplateCard } from "./TemplateCard";
import { TemplatePreview } from "./TemplatePreview";
import { useReveal } from "../lib/hooks";
import { TEMPLATES, type Template } from "../lib/templates";

export function TemplateGallery({
  selected,
  onSelect,
}: {
  selected: Template;
  onSelect: (t: Template) => void;
}) {
  const [ref, shown] = useReveal<HTMLDivElement>(0.15);

  return (
    <section id="templates" className="relative pb-24 pt-24 sm:pb-36">
      <div className="px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <SectionHead index="02" label="Templates" title="Start from something that already works" align="left">
            Each business is a working app, its agent team, coding-agent instructions and a
            go-to-market kit. Its integrations come with it. Start with Rill or Search. Brief is coming soon.
          </SectionHead>
          <p className="shrink-0 font-mono text-11 uppercase tracking-wide text-muted-foreground">
            A new official business every 10 days
          </p>
        </div>
      </div>

      <ForkLanes className="mt-12 block h-56 sm:h-72" />

      <div ref={ref} className={`t-stagger relative mx-auto -mt-12 max-w-6xl px-6 ${shown ? "is-shown" : ""}`}>
        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[3fr_2fr]">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {TEMPLATES.map((t) => (
              <TemplateCard key={t.slug} template={t} active={t.slug === selected.slug} onSelect={() => onSelect(t)} />
            ))}
            <div className="flex flex-col justify-center gap-1.5 rounded-xl border border-dashed border-border p-4">
              <h3 className="text-15 font-medium text-muted-foreground">More on the way</h3>
              <p className="text-13 text-muted-foreground">Each one a full app with Connect already wired in.</p>
            </div>
          </div>
          <TemplatePreview template={selected} />
        </div>
      </div>
    </section>
  );
}
