import { Plus, SlidersHorizontal, Sparkles, Database } from "lucide-react";
import { SectionHead } from "./SectionHead";
import { connectorLogo } from "./icons";
import { Shot } from "./Shot";
import { useReveal } from "../lib/hooks";
import { SOURCE_NAMES, type SourceSlug } from "../lib/sample";
import platformCount from "../generated/platform-count.json";

const SOURCES: SourceSlug[] = [
  "hubspot",
  "attio",
  "gmail",
  "outlook-mail",
  "google-calendar",
  "outlook-calendar",
  "notion",
  "linear",
  "slack",
  "teams",
  "granola",
];

const STEPS = [
  { title: "Pick a platform", body: "Choose any tool in One's catalog from Settings, then the kinds of records you want." },
  { title: "It proposes a map", body: "An AI reads the platform's docs and sample records and maps them to titles, dates and text." },
  { title: "Check three samples", body: "See real records as search results. Fix a field yourself, or ask the assistant beside it." },
  { title: "Indexing starts", body: "Save and it syncs on its own schedule from then on. Export it as a file to share." },
];

export function IntegrationsSection() {
  const [ref, shown] = useReveal<HTMLDivElement>(0.15);
  return (
    <section id="integrations" className="relative scroll-mt-24 px-6 pb-24 pt-12 sm:pb-36">
      <SectionHead index="01" label="Integrations" title={<>Sign-in and sources<br />come with the fork</>}>
        Copying an app that reads Gmail or HubSpot used to mean an OAuth app per tool, tokens to store and
        refresh, a login and a consent screen to build.{" "}
        <span className="text-foreground">You make one Connect app, and every source Search indexes runs on each user's own grant.</span>
      </SectionHead>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
        {SOURCES.map((s) => (
          <span key={s} className="flex items-center gap-1.5 rounded-full border border-border bg-card/50 py-1 pl-1.5 pr-2.5 text-11 text-muted-foreground">
            <img src={connectorLogo(s)} alt="" className="size-4 rounded-sm" />
            {SOURCE_NAMES[s]}
          </span>
        ))}
      </div>

      <div ref={ref} className={`t-stagger mx-auto mt-16 max-w-4xl ${shown ? "is-shown" : ""}`}>
        <div className="t-stagger-line t-stagger-line--1 rounded-xl border border-border bg-card/50 p-6 sm:p-8">
          <div className="flex items-center gap-2">
            <Plus className="size-4 text-accent-fg" strokeWidth={1.75} />
            <h3 className="text-15 font-medium">Add any other tool in One</h3>
          </div>
          <p className="mt-2 max-w-xl text-13 text-muted-foreground">
            The eleven above ship built in. For anything else in One's {platformCount.platforms} platforms,
            Settings turns it into a mapping profile without a line of code.
          </p>
          <ol className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
                <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-11 font-medium text-background">
                  {i + 1}
                </span>
                <h4 className="text-13 font-medium text-foreground">{step.title}</h4>
                <p className="text-11 text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
          <Shot
            name="new-profile-check"
            alt="New profile, the Check step for Zendesk tickets: three sample tickets shown as search results, the name, refresh and start-from settings, and the assistant docked on the right"
            className="mt-6"
          />
        </div>

        <div className="t-stagger-line t-stagger-line--2 mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { icon: SlidersHorizontal, title: "Profiles are files", body: "Built-in profiles ship in the repo. Yours export and import, or go back as a PR." },
            { icon: Database, title: "No provider keys", body: "Every sync, Jev judgment and embedding call runs on the signed-in user's own grant." },
            { icon: Sparkles, title: "Jev classifies as it goes", body: "Type, importance, and the people and companies a result belongs to, resolved on sync." },
          ].map((item) => (
            <div key={item.title} className="flex flex-col gap-2 rounded-xl border border-border bg-card/50 p-4">
              <item.icon className="size-4 text-accent-fg" strokeWidth={1.75} />
              <h3 className="text-13 font-medium">{item.title}</h3>
              <p className="text-13 text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
