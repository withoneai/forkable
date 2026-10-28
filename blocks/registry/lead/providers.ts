import type { EmailStatus, Outcome, Person, ProviderId } from "./types.js";

// How each provider says hit, miss or failure, lifted from Lead
// (people-search/packages/core/src/providers/*.ts). A miss is free by each
// provider's own billing rule; a failure is never billed and never retried
// on the same provider.

export interface Read<T> { outcome: Outcome; detail: string | null; data: T }
let seq = 0;
const empty = (): Person => ({ id: `p_${Date.now().toString(36)}${(seq++).toString(36)}`, name: null, title: null, company: null, location: null, linkedinUrl: null, emails: [], sources: [], matchConfidence: null });
type O = Record<string, unknown>;

export function pdlPerson(raw: unknown): Person {
  const r = (raw ?? {}) as O;
  const p = empty();
  p.name = (r.full_name as string) ?? null;
  p.title = (r.job_title as string) ?? null;
  p.company = { name: (r.job_company_name as string) ?? null, domain: (r.job_company_website as string) ?? null };
  p.location = { city: (r.location_locality as string) ?? null, region: (r.location_region as string) ?? null, country: (r.location_country as string) ?? null };
  const li = (Array.isArray(r.profiles) ? (r.profiles as O[]) : []).find((x) => x.network === "linkedin");
  p.linkedinUrl = (li?.url as string) ?? null;
  if (r.work_email) p.emails.push({ address: r.work_email as string, status: "unverified", source: "people-data-labs" });
  p.sources = ["people-data-labs"];
  p.matchConfidence = typeof r.likelihood === "number" ? r.likelihood / 10 : null;
  return p;
}

/** 404 is PDL's miss. 402 ("account maximum reached") is a billing failure. */
export function pdlSearch(status: number, body: { data?: unknown[] } | null): Read<Person[]> {
  if (status === 404) return { outcome: "miss", detail: "no records matched", data: [] };
  if (status === 402) return { outcome: "failure", detail: "402: account maximum reached", data: [] };
  if (status >= 400) return { outcome: "failure", detail: `${status}`, data: [] };
  return { outcome: "hit", detail: null, data: (body?.data ?? []).map(pdlPerson) };
}
export function pdlEnrich(status: number, body: unknown): Read<Person | null> {
  if (status === 404) return { outcome: "miss", detail: "no records matched", data: null };
  if (status >= 400) return { outcome: "failure", detail: status === 402 ? "402: account maximum reached" : `${status}`, data: null };
  return { outcome: "hit", detail: null, data: pdlPerson(body) };
}

/** Coresignal's search is free; collect is the credited call. Its miss shape is unconfirmed, so a non-200 is a failure. */
export function coresignalSearch(status: number, body: { employeeIds?: unknown[] } | unknown[] | null): Read<string[]> {
  if (status >= 400) return { outcome: "failure", detail: `${status}`, data: [] };
  const ids = Array.isArray(body) ? body : Array.isArray((body as { employeeIds?: unknown[] })?.employeeIds) ? (body as { employeeIds: unknown[] }).employeeIds : [];
  return ids.length ? { outcome: "hit", detail: null, data: ids.map(String) } : { outcome: "miss", detail: "no candidates matched", data: [] };
}
export function coresignalCollect(status: number, body: O | null): Read<Person | null> {
  if (status !== 200 || !body || !Object.keys(body).length) return { outcome: "failure", detail: `${status}: miss shape unconfirmed, treated as failure`, data: null };
  const p = empty();
  p.name = (body.full_name as string) ?? null;
  p.title = (body.active_experience_title as string) ?? null;
  p.company = { name: (body.active_experience_company_name as string) ?? null, domain: (body.active_experience_company_website as string) ?? null };
  p.location = { city: (body.location_full as string) ?? null, region: null, country: (body.location_country as string) ?? null };
  p.linkedinUrl = (body.linkedin_url as string) ?? null;
  p.sources = ["coresignal"];
  return { outcome: "hit", detail: null, data: p };
}

/** Findymail spends a credit only when it finds a verified address. It answers in two shapes. */
export function findymailFind(status: number, body: { contact?: { email?: string | null } | null; payload?: { contact?: { email?: string | null } | null } } | null): Read<{ email: string | null; confidence: number | null }> {
  if (status === 402) return { outcome: "failure", detail: "402: not enough credits", data: { email: null, confidence: null } };
  if (status === 423) return { outcome: "failure", detail: "423: subscription is paused", data: { email: null, confidence: null } };
  if (status >= 400) return { outcome: "failure", detail: `${status}`, data: { email: null, confidence: null } };
  const email = body?.contact?.email ?? body?.payload?.contact?.email ?? null;
  return email ? { outcome: "hit", detail: null, data: { email, confidence: null } } : { outcome: "miss", detail: "no email found, free", data: { email: null, confidence: null } };
}

/** Hunter's 451 claimed_email: the person asked Hunter to stop. Never retried anywhere. */
export const CLAIMED = "451 claimed_email: the person opted out, not retried";
export function hunterFind(status: number, body: { data?: { email?: string | null; score?: number | null } } | null): Read<{ email: string | null; confidence: number | null }> {
  if (status === 451) return { outcome: "blocked", detail: CLAIMED, data: { email: null, confidence: null } };
  if (status >= 400) return { outcome: "failure", detail: `${status}`, data: { email: null, confidence: null } };
  const email = body?.data?.email ?? null;
  return email ? { outcome: "hit", detail: null, data: { email, confidence: (body?.data?.score ?? 0) / 100 } } : { outcome: "miss", detail: "no email found", data: { email: null, confidence: null } };
}

const mapStatus = (raw: string): EmailStatus => (raw === "valid" ? "valid" : raw === "invalid" ? "invalid" : raw === "accept_all" || raw === "catch_all" ? "catch_all" : "unknown");
export function hunterVerify(status: number, body: { data?: { status?: string } } | null): Read<EmailStatus | null> {
  if (status === 451) return { outcome: "blocked", detail: CLAIMED, data: null };
  if (status === 202) return { outcome: "miss", detail: "202: still running, not billed twice", data: null };
  if (status >= 400) return { outcome: "failure", detail: `${status}`, data: null };
  const raw = body?.data?.status ?? "unknown";
  return raw === "unknown" ? { outcome: "miss", detail: "no definitive answer", data: null } : { outcome: "hit", detail: null, data: mapStatus(raw) };
}
/** Clearout's "failed" is its own no-answer case and is not charged. */
export function clearoutVerify(status: number, body: { status?: string; data?: { status?: string } } | null): Read<EmailStatus | null> {
  if (status >= 400) return { outcome: "failure", detail: `${status}`, data: null };
  const raw = body?.data?.status;
  if (!raw || raw === "failed" || body?.status === "failed") return { outcome: "miss", detail: "no definitive answer, free", data: null };
  return { outcome: "hit", detail: null, data: mapStatus(raw) };
}

export const PROVIDER_OF: Record<string, ProviderId> = { pdlSearch: "people-data-labs", pdlEnrich: "people-data-labs", coresignalSearch: "coresignal", coresignalCollect: "coresignal", findymailFind: "findymail", hunterFind: "hunter", hunterVerify: "hunter", clearoutVerify: "clearout" };
