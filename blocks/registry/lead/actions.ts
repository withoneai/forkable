import type { OneAction } from "../lib/one-server.js";

// The provider actions Lead's waterfall calls, by their One action ids
// (people-search/packages/core/src/providers/*.ts). Method and path from each
// action's docs (`one actions load <id>`).
export const LEAD = {
  pdlSearch: { platform: "people-data-labs", actionId: "conn_mod_def::GJ6CPAXoxMA::2a83EikOTXORH7h12QAqHg", method: "POST", path: "/v5/person/search", access: "read" },
  pdlEnrich: { platform: "people-data-labs", actionId: "conn_mod_def::GJ6COy96zDI::ZYpZX860TvitHrndkLitnQ", method: "GET", path: "/v5/person/enrich", access: "read" },
  coresignalSearch: { platform: "coresignal", actionId: "conn_mod_def::GJ2LgE_gQSI::xAMiIrQyRuaks6rd2aalmQ", method: "POST", path: "/v2/employee_base/search/filter", access: "read" },
  coresignalCollect: { platform: "coresignal", actionId: "conn_mod_def::GJ2LfpIXUPQ::CPKIuzUTTE2YuYSnBdNYJA", method: "GET", path: "/employee_base/collect/{{employeeKey}}", access: "read" },
  findymailFind: { platform: "findymail", actionId: "conn_mod_def::GNVodNTamNg::q5zktdhfSEaEM9bqCnWWUQ", method: "POST", path: "/api/search/name", access: "read" },
  hunterFind: { platform: "hunter", actionId: "conn_mod_def::GKHsq4zExrg::RWffHccvRj6CleVN4L6KAA", method: "GET", path: "/email-finder", access: "read" },
  hunterVerify: { platform: "hunter", actionId: "conn_mod_def::GKHsrEOOBQg::cV6dy4XITlSBL97UlSc3QQ", method: "GET", path: "/email-verifier", access: "read" },
  clearoutVerify: { platform: "clearout", actionId: "conn_mod_def::GMYgfFhQuZ4::CPNo1QzxQguZP0qsSAb5cw", method: "POST", path: "/v2/email_verify/instant", access: "read" },
} as const satisfies Record<string, OneAction>;
export type LeadCall = keyof typeof LEAD;
