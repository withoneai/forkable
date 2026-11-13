// The words on screen, in one place. The app is for people who have never seen a
// config file, so it says what a thing does for them, not how it is built. The
// word list is in AGENTS.md ("Words on screen") and `pnpm check:copy` fails when a
// builder word comes back. Real terms (profile, model, grant, embedding) stay in
// the Advanced disclosures, the Cheatsheet, /setup/connect and the developer docs.
import type { Capability, MeResponse, SemanticOffReason, SourceStatus } from "@/contract/api-types";

/** The group name for VIPs, Needs you, Waiting, FYI and Low, everywhere it shows. */
export const PRIORITY = "Priority";

export const COPY = {
  // sources: one connected tool and what Search reads from it
  source: "Source",
  sources: "Sources",
  addSource: "Add a source",
  editSource: "Edit what it reads",
  exportSource: "Export settings",
  whatToSearch: "What to search",
  sourcesIntro: "Each source is one of your connected tools. Search reads it and keeps it up to date.",
  // updating (the engine calls it sync)
  updateNow: "Update now",
  updating: "Updating",
  updateAll: "Update all sources",
  updateFromStart: "Read everything again",
  updatingCount: (n: number) => (n === 1 ? "Updating" : `Updating ${n} sources`),
  updateFailed: "Could not start the update",
  updateWatch: "Watch it in the Status column",
  // access (the One grant)
  yourAccess: "Your access",
  connected: "Connected",
  notConnected: "Not connected",
  allowed: "Allowed",
  notAllowed: "Not allowed",
  readsOnly: "Search only reads. Every call shows up in Access.",
  securedByOne: "Secured by One",
  manageInOne: "Manage in One",
  // the platforms the Connect app asks for, in plain words
  askListName: "the tools Search can ask for",
  notInAskTitle: "Not available yet",
  notInAskBody: "Search cannot ask for these tools yet. Add a source and it walks you through adding one.",
  // search by meaning (semantic, hybrid, embeddings)
  meaning: "Search by meaning",
  meaningOn: "Search by meaning is on.",
  meaningOff: "Search by meaning is off.",
  meaningSample: "Search by meaning is off in the sample. Results match your words.",
  meaningOffResults: "Results match your words.",
  wordsAndMeaning: "Words and meaning",
  wordsOnly: "Words only",
  // the judgment model (Jev): everyday screens say what it did; its name stays in tooltips and Settings
  judgeName: "Jev",
  judgeWho: "Jev, the AI model Search uses to judge priority and spot the same person",
  judgeActivity: "Priority and matching",
  judgeSorted: "Sorted by Jev, the AI model Search uses to judge priority",
  judgeOrdered: "Ordered by Jev, the AI model Search uses to judge which results are best",
  markedAuto: "marked automatically",
  bestFirst: "Best results first",
  // where the data lives
  onThisComputer: "On this computer",
} as const;

/** The AI helpers Search calls behind the scenes, by platform, in plain words (Access). */
export const HELPER_TEXT: Record<string, string> = {
  openai: "Reads your text for meaning, so a search finds what you mean",
  gemini: "Reads your text for meaning, so a search finds what you mean",
  cohere: "Reads your text for meaning, so a search finds what you mean",
  "mistral-ai": "Reads your text for meaning, so a search finds what you mean",
  anthropic: "Writes answers from your results, each one linked to where it came from",
  typesafe: "Sorts recent items by priority and spots the same person across tools",
};

/** A source's status as one word, beside its dot. */
export const STATUS_WORD: Record<SourceStatus, string> = {
  healthy: "Up to date", syncing: "Updating", new: "Starting", degraded: "Needs attention", rate_limited: "Slowed down",
  auth_needed: "Needs sign-in", grant_blocked: "No access", awaiting_grant: "Waiting for access", paused: "Paused", error: "Failed",
};

/** Why search by meaning is off for this database, as the end of a sentence. */
export const MEANING_DB_REASON: Record<NonNullable<Capability["reason"]>, string> = {
  no_build_for_platform: "This computer's database cannot do it yet",
  extension_unavailable: "The database is missing the part that compares meaning",
  cannot_create_extension: "The database does not let Search turn it on",
  flags_missing: "The database started without the part that compares meaning",
  forced: "It is turned off on purpose for now",
  embedding_not_granted: "Search has no access to an AI that reads for meaning",
};

/** Why search by meaning did not run for one search. */
export function meaningOffReason(reason: SemanticOffReason | string | null | undefined, message?: string | null): string {
  if (message) return message;
  if (reason === "not_in_grant") return "Search has no access to the AI that reads for meaning.";
  if (reason === "sample") return "The sample matches words only.";
  if (reason === "keyword_mode") return "This database matches words only.";
  return "The AI that reads for meaning did not answer.";
}

/**
 * Whether search by meaning runs, from one place, so Settings, Database and home agree:
 * the database must compare meaning AND an AI must read for meaning (the sample's
 * built-in reader matches words only, so the sample is off).
 */
export function meaningState(me: Pick<MeResponse, "capability" | "settings"> | undefined): { on: boolean; sample: boolean; why: string | null } {
  if (!me) return { on: false, sample: false, why: null };
  const cap = me.capability;
  if (cap.mode !== "hybrid") return { on: false, sample: false, why: cap.reason ? MEANING_DB_REASON[cap.reason] : "This database matches words only" };
  if (me.settings?.embedding.provider === "local") return { on: false, sample: true, why: "The sample matches words only" };
  return { on: true, sample: false, why: null };
}
