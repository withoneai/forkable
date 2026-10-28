import { FileCode2, KeyRound, ShieldCheck, Plus, UserCheck, Layers } from "lucide-react";
import { SectionHead } from "./SectionHead";
import { connectorLogo } from "./icons";
import { useReveal } from "../lib/hooks";

const ITEMS = [
  { icon: FileCode2, title: "Declared in the repo", body: "connect.manifest.json lists every action the business calls and the access it asks for." },
  { icon: Layers, title: "One app for every tool", body: "A single Connect app covers Gmail, Stripe, WhatsApp Business and whatever else the business uses." },
  { icon: KeyRound, title: "No provider tokens to keep", body: "Your server stores one short reference per user. Nothing to refresh." },
  { icon: UserCheck, title: "Sign in with One, built in", body: "Your users sign in with One and connect their own accounts in three steps." },
  { icon: Plus, title: "Add a tool later", body: "The add-integration skill wires a new tool and updates the manifest." },
  { icon: ShieldCheck, title: "Secured by One", body: "Each user connects their own accounts, and they can revoke them any time." },
];

const SAMPLE_TOOLS = [
  { slug: "gmail", name: "Gmail" },
  { slug: "google-calendar", name: "Google Calendar" },
  { slug: "stripe", name: "Stripe" },
  { slug: "whatsapp-business", name: "WhatsApp Business" },
  { slug: "square", name: "Square" },
  { slug: "twilio", name: "Twilio" },
];

export function IntegrationsSection() {
  const [ref, shown] = useReveal<HTMLDivElement>(0.15);
  return (
    <section id="integrations" className="relative px-6 pb-24 pt-12 sm:pb-36">
      <SectionHead index="01" label="Integrations" title={<>Integrations and sign‑in<br />come with the fork</>}>
        Copying an app that talks to Gmail or Stripe used to mean an OAuth app per provider, tokens to store and
        refresh, a login and a consent screen to build. A Forkable business ships with its integrations declared and
        Sign in with One wired in. <span className="text-foreground">You make one Connect app, and every tool the business needs runs on your users' own accounts.</span>
      </SectionHead>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
        {SAMPLE_TOOLS.map((t) => (
          <span key={t.slug} className="flex items-center gap-1.5 rounded-full border border-border bg-card/50 py-1 pl-1.5 pr-2.5 text-11 text-muted-foreground">
            <img src={connectorLogo(t.slug)} alt="" className="size-4 rounded-sm" />
            {t.name}
          </span>
        ))}
      </div>

      <div ref={ref} className={`t-stagger mx-auto mt-12 grid max-w-6xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 ${shown ? "is-shown" : ""}`}>
        {ITEMS.map((item, i) => (
          <div key={item.title} className={`t-stagger-line t-stagger-line--${Math.min(i + 1, 4)} flex flex-col gap-2 rounded-xl border border-border bg-card/50 p-4`}>
            <item.icon className="size-4 text-accent-fg" strokeWidth={1.75} />
            <h3 className="text-13 font-medium">{item.title}</h3>
            <p className="text-13 text-muted-foreground">{item.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
