// The shapes the Lead routes return and the Lead blocks render
// (people-search/packages/core/src/types.ts, trimmed).

export type ProviderId = "people-data-labs" | "coresignal" | "hunter" | "findymail" | "clearout";
export const PROVIDER_LABELS: Record<ProviderId, string> = { "people-data-labs": "People Data Labs", coresignal: "Coresignal", hunter: "Hunter", findymail: "Findymail", clearout: "Clearout" };

export type EmailStatus = "valid" | "invalid" | "unknown" | "catch_all" | "unverified";
export type Op = "people.search" | "people.enrich" | "people.email" | "email.verify";
export type Outcome = "hit" | "miss" | "failure" | "blocked" | "skipped";

export interface Person {
  id: string;
  name: string | null;
  title: string | null;
  company: { name: string | null; domain: string | null } | null;
  location: { city: string | null; region: string | null; country: string | null } | null;
  linkedinUrl: string | null;
  emails: { address: string; status: EmailStatus; source: ProviderId }[];
  sources: ProviderId[];
  matchConfidence: number | null;
}

export interface Attempt { provider: ProviderId; actionId: string; outcome: Outcome; cost: number | null; detail: string | null }
/** Every provider tried, in order. Misses and failures cost nothing. */
export interface Receipt { op: Op; attempts: Attempt[]; charged: number; costsAre: "sample" | "contracted" }

export interface SearchResponse { people: Person[]; receipt: Receipt }
export interface EnrichResponse { person: Person | null; receipt: Receipt }
export interface EmailFindResponse { email: string | null; confidence: number | null; source: ProviderId | null; receipt: Receipt }
export interface VerifyResponse { email: string; status: EmailStatus | null; source: ProviderId | null; receipt: Receipt }
