import { SectionHead } from "./SectionHead";
import { useReveal } from "../lib/hooks";
import { FAQ_ITEMS } from "../lib/faq";

export function FAQSection() {
  const [ref, shown] = useReveal<HTMLDivElement>(0.15);
  return (
    <section id="faq" className="relative scroll-mt-24 px-6 pb-24 pt-12 sm:pb-36">
      <SectionHead index="05" label="FAQ" title="Questions people ask" />
      <div ref={ref} className={`t-stagger mx-auto mt-12 max-w-2xl divide-y divide-border rounded-xl border border-border bg-card/50 ${shown ? "is-shown" : ""}`}>
        {FAQ_ITEMS.map((item, i) => (
          <div key={item.q} className={`t-stagger-line t-stagger-line--${Math.min(i + 1, 4)} p-4`}>
            <h3 className="text-13 font-medium text-foreground">{item.q}</h3>
            <p className="mt-1.5 text-13 text-muted-foreground">{item.a}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
