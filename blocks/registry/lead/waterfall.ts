import type { Context } from "hono";
import { OneRefused, type OneServer } from "../lib/one-server.js";
import sample from "../../fixtures/lead.json" with { type: "json" };
import { LEAD, type LeadCall } from "./actions.js";
import { leadConfig } from "./config.js";
import * as P from "./providers.js";
import type { Attempt, EmailFindResponse, EnrichResponse, Op, Person, ProviderId, Receipt, SearchResponse, VerifyResponse } from "./types.js";

// Lead's provider waterfall (people-search/packages/core/src/waterfall.ts):
// try each provider in order, stop on the first hit, record every attempt.
// Misses and failures are free. Hunter's opt-out (451) stops the whole run.
// Calls go through one.call() on the signed-in user's grant, so the user's
// own provider accounts pay. Before a Connect app exists, the Acme sample
// answers each call with the provider's documented response shape.

interface Req { pathParams?: Record<string, string>; query?: Record<string, string>; body?: unknown }
interface Answer { status: number; body: unknown; refused?: string }

export interface Runtime {
  mode: "sample" | "grant";
  call(key: LeadCall, req: Req): Promise<Answer>;
  /** null: the provider is off or has no contracted cost, so it never runs. */
  cost(p: ProviderId): number | null;
}

type Recorded = Record<string, Record<string, Record<string, { status: number; body: unknown }>>>;
const S = sample as unknown as { sampleUnitCostsCredits: Record<ProviderId, number>; recorded: Recorded };
const pdlRows = () => (S.recorded["people-data-labs"]!.search!.hit!.body as { data: Record<string, unknown>[] }).data;
const rec = (p: string, op: string, k: string): Answer => S.recorded[p]![op]![k]!;
const lc = (s: unknown) => String(s ?? "").toLowerCase();

export function runtimeFor(one: OneServer, c: Context): Runtime {
  if (one.mode() === "sample") {
    return {
      mode: "sample",
      cost: (p) => S.sampleUnitCostsCredits[p] ?? null,
      async call(key, req) {
        const b = (req.body ?? {}) as Record<string, string>;
        const q = req.query ?? {};
        switch (key) {
          case "pdlSearch": {
            const f = (b as unknown as { __sample: { title?: string; domain?: string; company?: string; location?: string } }).__sample ?? {};
            const rows = pdlRows().filter((r) => (!f.title || lc(r.job_title).includes(lc(f.title))) && (!f.domain || lc(r.job_company_website) === lc(f.domain)) && (!f.company || lc(r.job_company_name).includes(lc(f.company))) && (!f.location || `${lc(r.location_locality)} ${lc(r.location_region)}`.includes(lc(f.location))));
            return rows.length ? { status: 200, body: { data: rows } } : rec("people-data-labs", "search", "miss");
          }
          case "coresignalSearch":
            return lc(b.full_name).includes("jane") ? rec("coresignal", "search", "hit") : rec("coresignal", "search", "miss");
          case "pdlEnrich": {
            const row = pdlRows().find((r) => lc(r.work_email) === lc(q.email) || (q.profile && lc(q.profile) === lc((r.profiles as { url: string }[])[0]?.url)));
            return row ? { status: 200, body: row } : rec("people-data-labs", "enrich", "miss");
          }
          case "coresignalCollect":
            return req.pathParams?.employeeKey === "84213" ? rec("coresignal", "collect", "hit") : rec("coresignal", "collect", "failure_unconfirmed");
          case "findymailFind": {
            if (lc(b.name) === "priya shah") return rec("findymail", "find", "miss");
            const row = pdlRows().find((r) => lc(r.full_name) === lc(b.name) && lc(r.job_company_website) === lc(b.domain));
            return row ? { status: 200, body: { contact: { name: row.full_name, domain: row.job_company_website, email: row.work_email } } } : rec("findymail", "find", "miss");
          }
          case "hunterFind":
            return lc(q.full_name) === "priya shah" ? rec("hunter", "find", "hit") : rec("hunter", "find", "miss");
          case "clearoutVerify": {
            const known = pdlRows().some((r) => lc(r.work_email) === lc(b.email)) || lc(b.email) === "priya.shah@acme-inc.example";
            return known ? rec("clearout", "verify", "hit_valid") : rec("clearout", "verify", "miss_unknown");
          }
          case "hunterVerify":
            return rec("hunter", "verify", "miss_unknown");
        }
      },
    };
  }
  return {
    mode: "grant",
    cost: (p) => (leadConfig.providers[p]?.enabled && leadConfig.providers[p]!.unitCost !== null ? leadConfig.providers[p]!.unitCost : null),
    async call(key, req) {
      try {
        const r = await one.call<unknown>(c, { action: LEAD[key], ...req, sample: () => null });
        return { status: r.meta.status, body: r.data };
      } catch (e) {
        if (e instanceof OneRefused) return e.code === "provider_error" ? { status: e.meta.status, body: null } : { status: e.status, body: null, refused: e.code === "outside_grant" ? "outside your grant" : "not connected" };
        throw e;
      }
    },
  };
}

function receipt(op: Op, rt: Runtime): Receipt {
  return { op, attempts: [], charged: 0, costsAre: rt.mode === "sample" ? "sample" : "contracted" };
}
function record(r: Receipt, rt: Runtime, key: LeadCall, a: Answer, read: { outcome: Attempt["outcome"]; detail: string | null }, billed = true) {
  const provider = P.PROVIDER_OF[key]!;
  const outcome = a.refused ? "blocked" : read.outcome;
  const cost = outcome === "hit" && billed ? rt.cost(provider) : 0;
  r.attempts.push({ provider, actionId: LEAD[key].actionId, outcome, cost, detail: a.refused ? `One refused: ${a.refused}` : read.detail });
  r.charged += cost ?? 0;
}
const skip = (r: Receipt, key: LeadCall) => r.attempts.push({ provider: P.PROVIDER_OF[key]!, actionId: LEAD[key].actionId, outcome: "skipped", cost: 0, detail: "off, or no contracted cost yet" });
const sqlStr = (s: string) => `'${s.replace(/'/g, "''").toLowerCase()}'`;

export interface SearchParams { title?: string; company?: string; domain?: string; location?: string; limit?: number }
export async function searchPeople(rt: Runtime, f: SearchParams): Promise<SearchResponse> {
  const r = receipt("people.search", rt);
  const size = Math.min(25, Math.max(1, f.limit ?? 10));
  if (rt.cost("people-data-labs") === null) skip(r, "pdlSearch");
  else {
    const where = [f.title && `job_title LIKE ${sqlStr(`%${f.title}%`)}`, f.domain && `job_company_website=${sqlStr(f.domain)}`, f.company && `job_company_name=${sqlStr(f.company)}`, f.location && `location_name LIKE ${sqlStr(`%${f.location}%`)}`].filter(Boolean);
    const a = await rt.call("pdlSearch", { body: { sql: `SELECT * FROM person${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`, size, ...(rt.mode === "sample" ? { __sample: f } : {}) } });
    const read = P.pdlSearch(a.status, a.body as never);
    record(r, rt, "pdlSearch", a, read);
    if (read.outcome === "hit") return { people: read.data.slice(0, size), receipt: r };
  }
  if (rt.cost("coresignal") === null) skip(r, "coresignalSearch");
  else {
    const a = await rt.call("coresignalSearch", { body: { ...(f.title ? { headline: f.title } : {}), ...(f.location ? { location: f.location } : {}) } });
    const read = P.coresignalSearch(a.status, a.body as never);
    record(r, rt, "coresignalSearch", a, read, false);
    const people: Person[] = [];
    for (const key of read.data.slice(0, Math.min(size, 5))) {
      const col = await rt.call("coresignalCollect", { pathParams: { employeeKey: key } });
      const cr = P.coresignalCollect(col.status, col.body as never);
      record(r, rt, "coresignalCollect", col, cr);
      if (cr.data) people.push(cr.data);
    }
    if (people.length) return { people, receipt: r };
  }
  return { people: [], receipt: r };
}

export interface EnrichParams { email?: string; linkedinUrl?: string; name?: string; domain?: string }
export async function enrichPerson(rt: Runtime, p: EnrichParams): Promise<EnrichResponse> {
  const r = receipt("people.enrich", rt);
  if (rt.cost("people-data-labs") === null) skip(r, "pdlEnrich");
  else {
    const query: Record<string, string> = {};
    if (p.email) query.email = p.email;
    if (p.linkedinUrl) query.profile = p.linkedinUrl;
    if (p.name) query.name = p.name;
    if (p.domain) query.company = p.domain;
    const a = await rt.call("pdlEnrich", { query });
    const read = P.pdlEnrich(a.status, a.body);
    record(r, rt, "pdlEnrich", a, read);
    if (read.data) return { person: read.data, receipt: r };
  }
  if (rt.cost("coresignal") === null) skip(r, "coresignalSearch");
  else {
    const name = p.name ?? (p.email ? p.email.split("@")[0]!.replace(/[._]/g, " ") : "");
    const a = await rt.call("coresignalSearch", { body: { full_name: name } });
    const read = P.coresignalSearch(a.status, a.body as never);
    record(r, rt, "coresignalSearch", a, read, false);
    if (read.data[0]) {
      const col = await rt.call("coresignalCollect", { pathParams: { employeeKey: read.data[0] } });
      const cr = P.coresignalCollect(col.status, col.body as never);
      record(r, rt, "coresignalCollect", col, cr);
      if (cr.data) return { person: cr.data, receipt: r };
    }
  }
  return { person: null, receipt: r };
}

export async function findEmail(rt: Runtime, p: { name: string; domain: string }): Promise<EmailFindResponse> {
  const r = receipt("people.email", rt);
  for (const key of ["findymailFind", "hunterFind"] as const) {
    const provider = P.PROVIDER_OF[key]!;
    if (rt.cost(provider) === null) {
      skip(r, key);
      continue;
    }
    const a = key === "findymailFind" ? await rt.call(key, { body: { name: p.name, domain: p.domain } }) : await rt.call(key, { query: { domain: p.domain, full_name: p.name } });
    const read = key === "findymailFind" ? P.findymailFind(a.status, a.body as never) : P.hunterFind(a.status, a.body as never);
    record(r, rt, key, a, read);
    if (read.outcome === "hit") return { email: read.data.email, confidence: read.data.confidence, source: provider, receipt: r };
    if (read.detail === P.CLAIMED) break;
  }
  return { email: null, confidence: null, source: null, receipt: r };
}

export async function verifyEmail(rt: Runtime, email: string): Promise<VerifyResponse> {
  const r = receipt("email.verify", rt);
  for (const key of ["clearoutVerify", "hunterVerify"] as const) {
    const provider = P.PROVIDER_OF[key]!;
    if (rt.cost(provider) === null) {
      skip(r, key);
      continue;
    }
    const a = key === "clearoutVerify" ? await rt.call(key, { body: { email, timeout: 10000 } }) : await rt.call(key, { query: { email } });
    const read = key === "clearoutVerify" ? P.clearoutVerify(a.status, a.body as never) : P.hunterVerify(a.status, a.body as never);
    record(r, rt, key, a, read);
    if (read.outcome === "hit") return { email, status: read.data, source: provider, receipt: r };
    if (read.detail === P.CLAIMED) break;
  }
  return { email, status: null, source: null, receipt: r };
}
