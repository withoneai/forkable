import sample from "../../fixtures/builder.json" with { type: "json" };
import type { CatalogDoc, SourceFile } from "./types.js";

// Real entries from One's catalog (`one actions find`, 2026-10-28: Slack,
// Stripe, Notion, Gmail, HubSpot, GitHub, Google Calendar, Linear), their
// docs trimmed, and a small Acme standup app to scan and publish. What the
// Builder blocks show before a Connect app exists.
const S = sample as unknown as { catalog: (CatalogDoc & { intent: string })[]; app: { name: string; files: SourceFile[] } };
export const BUILDER_SAMPLE = S;

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
/** Ranks the sample catalog the way a search would: shared words with the title and intent. */
export function searchSample(platform: string, query: string): CatalogDoc[] {
  const q = new Set(words(query));
  return S.catalog
    .filter((a) => !platform || a.platform === platform)
    .map((a) => ({ a, score: words(`${a.title} ${a.intent} ${a.path}`).filter((w) => q.has(w)).length }))
    .filter((x) => x.score > 0 || !query.trim())
    .sort((x, y) => y.score - x.score)
    .map((x) => x.a);
}
