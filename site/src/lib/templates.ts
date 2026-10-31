import type { GlyphId } from "../components/Glyph";
import catalogJson from "../../../create-forkable/catalog.json";

/** One entry of create-forkable/catalog.json (also served as /templates.json). */
export interface CatalogTemplate {
  id: string;
  name: string;
  status: "available" | "coming-soon";
  kind: string;
  tagline: string;
  description: string;
  platforms: string[];
  packageManager: "npm" | "pnpm";
  create: string | null;
  demo: string | null;
  site: string;
  code: string | null;
  repo: string | null;
  envToGoLive: string[];
}

export interface Catalog {
  version: number;
  site: string;
  command: string;
  agentCommand: string;
  templates: CatalogTemplate[];
}

interface Display {
  mark: GlyphId;
  tier: "Official";
  /** Shorter card text when the catalog description is written for agents. */
  cardDescription?: string;
  cardNote?: string;
  platforms: TemplatePlatform[];
  previewRows: { label: string; detail: string }[];
  /** Builders that can run this template. Default: all three. */
  builders?: Builder[];
}

export interface TemplatePlatform {
  name: string;
  slug: string;
}

export interface Template {
  slug: string;
  name: string;
  mark: GlyphId;
  tier: "Official";
  site: string;
  /** Not forkable yet: the card shows "Coming soon" and links nowhere. */
  comingSoon?: boolean;
  /** Where the template's code lives on GitHub. */
  code?: string;
  /** A standalone public repo (owner/name) the Replit, Bolt and Lovable links can open. */
  repo?: string;
  /** Builders that can run it (embedded Postgres, as in Rill and Search, can't start in Bolt). */
  builders: Builder[];
  description: string;
  kind: string;
  platforms: TemplatePlatform[];
  previewRows: { label: string; detail: string }[];
}

// The template list itself (ids, names, descriptions, status, links) comes
// from create-forkable/catalog.json, the one catalog the CLI, the site and
// agents (/templates.json) all read. Only what the cards need to look right
// lives here, keyed by id: the mark, the tier chip, which platform logos to
// show, an extra line for the card, and each app's Acme Inc preview rows.
// Templates in the catalog with no entry here (the bare starter) are not
// shown in the gallery.
export const CATALOG: Catalog = catalogJson as Catalog;

const DISPLAY: Record<string, Display> = {
  rill: {
    mark: "R",
    // Bolt runs Node in the browser, so Rill's embedded Postgres can't start there.
    builders: ["replit", "lovable"],
    tier: "Official",
    cardNote: "It never touches more than you let it.",
    platforms: [
      { name: "Gmail", slug: "gmail" },
      { name: "Google Calendar", slug: "google-calendar" },
    ],
    previewRows: [
      { label: "Priya Nair, term sheet redlines", detail: "Goal · by Thursday" },
      { label: "Victor Lang, board deck", detail: "VIP · drafted" },
      { label: "Riley Chen, offsite date", detail: "VIP · drafted" },
    ],
  },
  search: {
    mark: "S",
    cardDescription:
      "One search box over your CRM, mail, calendars, docs, chat and meeting notes. An AI answers with citations, and a new profile adds any other tool.",
    // Embedded Postgres with pgvector, so like Rill it can't start in Bolt.
    builders: ["replit", "lovable"],
    tier: "Official",
    platforms: [
      { name: "HubSpot", slug: "hubspot" },
      { name: "Gmail", slug: "gmail" },
      { name: "Google Calendar", slug: "google-calendar" },
      { name: "Notion", slug: "notion" },
      { name: "Linear", slug: "linear" },
      { name: "Slack", slug: "slack" },
      { name: "Granola", slug: "granola" },
    ],
    previewRows: [
      { label: "Globex renewal 2027", detail: "HubSpot · $84,000" },
      { label: "Re: Globex renewal terms", detail: "Gmail · Priya Shah" },
      { label: "Initech pilot kickoff", detail: "Granola · Oct 22" },
    ],
  },
  brief: {
    mark: "B",
    tier: "Official",
    cardNote: "Drafts go to Webflow and never publish.",
    platforms: [
      { name: "OpenAI", slug: "openai" },
      { name: "Anthropic", slug: "anthropic" },
      { name: "Gemini", slug: "gemini" },
      { name: "Perplexity", slug: "perplexity" },
      { name: "Webflow", slug: "webflow" },
    ],
    previewRows: [
      { label: "Corporate cards and spend controls", detail: "Visibility 89%" },
      { label: "Pricing for small teams", detail: "Gap · draft ready" },
      { label: "Multi-currency and VAT", detail: "Gap · visibility 34%" },
    ],
  },
};

export const TEMPLATES: Template[] = Object.entries(DISPLAY).flatMap(([id, d]) => {
  const c = CATALOG.templates.find((t) => t.id === id);
  if (!c) return [];
  return [
    {
      slug: c.id,
      name: c.name,
      mark: d.mark,
      tier: d.tier,
      site: c.site,
      comingSoon: c.status !== "available" || undefined,
      code: c.code ?? undefined,
      repo: c.repo ?? undefined,
      builders: d.builders ?? ["replit", "bolt", "lovable"],
      description: [d.cardDescription ?? c.description, d.cardNote].filter(Boolean).join(" "),
      kind: c.kind,
      platforms: d.platforms,
      previewRows: d.previewRows,
    },
  ];
});

export type Builder = "replit" | "bolt" | "lovable";

// Where a fork can go to keep being built. Replit and Bolt import the repo
// itself; Lovable has no repo import link, so it starts from a prompt that
// points at the repo (the same links withone.ai/templates-vibe uses).
export function builderUrl(builder: Builder, template: Template & { repo: string }): string {
  const repo = `github.com/${template.repo}`;
  if (builder === "replit") return `https://replit.com/${repo}`;
  if (builder === "bolt") return `https://bolt.new/${repo}`;
  const prompt = `${template.description} Start from ${repo}. Users sign in with One (withone.ai) and connect ${template.platforms.map((p) => p.name).join(", ")} with their own accounts.`;
  return `https://lovable.dev/?autosubmit=true#prompt=${encodeURIComponent(prompt)}`;
}
