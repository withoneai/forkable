// Static profile validation (CONTRACT 4.2): schema, then every path, template and
// predicate parses, roots and filters are known, facets fit the kind, action id rules.

import type { z } from "zod";
import type { Expr, ItemKind, RequestSpec, SearchProfile, ValidationIssue, ValidationReport, PartitionSpec, Pagination } from "../contract.js";
import { FACETS_BY_KIND } from "../contract.js";
import { isValidPath, tokenizePath } from "../expr/path.js";
import { parsePredicate, predicatePaths } from "../expr/predicate.js";
import { CTX_ROOTS, parseTemplate, templatePaths } from "../expr/template.js";
import { hashProfile } from "./hash.js";
import { profileSchema, zodIssues } from "./schema.js";

const ROOTS = new Set<string>(CTX_ROOTS);

function rootOf(path: string): string {
  const t = tokenizePath(path)[0];
  return t && t.type === "field" ? t.name : "";
}

export function validateProfile(input: unknown): ValidationReport {
  const issues: ValidationIssue[] = [];
  const r = profileSchema.safeParse(input);
  if (!r.success) {
    for (const m of zodIssues(r.error as z.ZodError)) issues.push({ check: "schema", level: "error", message: m });
    return { ok: false, issues };
  }
  const p = r.data;
  const err = (message: string) => issues.push({ check: "schema", level: "error", message, profileId: p.id });

  const checkPath = (path: string | undefined, where: string, rooted: boolean) => {
    if (path === undefined || path === "" || path === "$") return;
    if (!isValidPath(path)) return err(`${where}: bad path "${path}"`);
    if (rooted && !ROOTS.has(rootOf(path))) err(`${where}: path "${path}" must start with one of ${[...ROOTS].join(", ")}`);
  };
  const checkTemplate = (tpl: string | undefined, where: string) => {
    if (tpl === undefined) return;
    try {
      parseTemplate(tpl);
      for (const path of templatePaths(tpl)) if (!ROOTS.has(rootOf(path))) err(`${where}: template path "${path}" must start with one of ${[...ROOTS].join(", ")}`);
    } catch (e) { err(`${where}: ${(e as Error).message}`); }
  };
  const checkPredicate = (src: string | undefined, where: string) => {
    if (src === undefined) return;
    try {
      const n = parsePredicate(src);
      for (const path of predicatePaths(n)) if (!ROOTS.has(rootOf(path))) err(`${where}: predicate path "${path}" must start with one of ${[...ROOTS].join(", ")}`);
    } catch (e) { err(`${where}: ${(e as Error).message}`); }
  };
  const checkExpr = (e: Expr | undefined, where: string, rooted = true) => {
    if (e === undefined) return;
    if (typeof e === "string") return checkPath(e, where, rooted);
    if ("path" in e) return checkPath(e.path, where, rooted);
    if ("template" in e) return checkTemplate(e.template, where);
    if ("coalesce" in e) return e.coalesce.forEach((x, i) => checkExpr(x, `${where}.coalesce[${i}]`, rooted));
    if ("join" in e) return e.join.forEach((x, i) => checkExpr(x, `${where}.join[${i}]`, rooted));
    if ("test" in e) return checkPredicate(e.test, where);
  };
  const checkDeep = (v: unknown, where: string) => {
    if (typeof v === "string") checkTemplate(v, where);
    else if (Array.isArray(v)) v.forEach((x, i) => checkDeep(x, `${where}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) checkDeep(x, `${where}.${k}`);
  };
  const checkAction = (id: string, where: string) => {
    if (id.startsWith("TBD:")) {
      if (p.author === "builtin") err(`${where}: unresolved action id ${id} (TBD: ids are not allowed in built-ins)`);
      else issues.push({ check: "actions", level: "warn", message: `${where}: unresolved action id ${id}`, profileId: p.id });
    } else if (id.startsWith("sample::")) {
      if (!p.sampleOnly) err(`${where}: sample:: action ids need sampleOnly: true`);
    } else if (!id.startsWith("conn_mod_def::")) err(`${where}: action id must start with conn_mod_def::`);
  };
  const checkRequest = (req: RequestSpec | undefined, where: string) => {
    if (!req) return;
    checkAction(req.actionId, `${where}.actionId`);
    checkDeep(req.pathVars, `${where}.pathVars`);
    checkDeep(req.query, `${where}.query`);
    checkDeep(req.body, `${where}.body`);
    checkDeep(req.headers, `${where}.headers`);
  };
  const checkPagination = (pg: Pagination | undefined, where: string) => {
    if (!pg) return;
    for (const k of ["next", "hasMore", "total", "nextPath", "totalPages", "idPath", "endCursor", "hasNextPage"] as const) {
      const v = (pg as Record<string, unknown>)[k];
      if (typeof v === "string") checkPath(v, `${where}.${k}`, false);
    }
  };
  const checkPartition = (ps: PartitionSpec | undefined, where: string) => {
    if (!ps) return;
    checkRequest(ps, where);
    checkPath(ps.resultsPath, `${where}.resultsPath`, false);
    checkPath(ps.idPath, `${where}.idPath`, false);
    checkPagination(ps.pagination, `${where}.pagination`);
    checkPredicate(ps.keep, `${where}.keep`);
    if (typeof ps.max === "string") checkTemplate(ps.max, `${where}.max`);
    if (ps.order) checkPath(ps.order.by, `${where}.order.by`, false);
    checkPartition(ps.next, `${where}.next`);
  };

  if (p.account) {
    checkRequest(p.account.request, "account.request");
    for (const [k, v] of Object.entries(p.account.vars)) checkPath(v, `account.vars.${k}`, false);
    for (const s of p.account.self ?? []) if (!(s.var in p.account.vars)) err(`account.self: var "${s.var}" is not in account.vars`);
  }
  checkPartition(p.partitions, "partitions");
  checkRequest(p.list, "list");
  checkPath(p.list.resultsPath, "list.resultsPath", false);
  checkPath(p.list.idPath, "list.idPath", false);
  checkPagination(p.list.pagination, "list.pagination");
  const inc = p.incremental;
  if (inc.strategy === "watermark") {
    checkPath(inc.field, "incremental.field", true);
    if (inc.restartOnCap && inc.order === "desc") err("incremental.restartOnCap needs order: \"asc\"");
    if (inc.initial) checkTemplate(inc.initial, "incremental.initial");
  } else if (inc.strategy === "delta") {
    checkPath(inc.tokenPath, "incremental.tokenPath", false);
    checkRequest(inc.bootstrap, "incremental.bootstrap");
    if (inc.initial) checkTemplate(inc.initial, "incremental.initial");
  }
  if (p.hydrate) {
    checkRequest(p.hydrate.request, "hydrate.request");
    checkTemplate(p.hydrate.fingerprint, "hydrate.fingerprint");
    checkPredicate(p.hydrate.when, "hydrate.when");
    for (const [i, c] of (p.hydrate.children ?? []).entries()) {
      checkRequest(c.request, `hydrate.children[${i}].request`);
      checkPredicate(c.when, `hydrate.children[${i}].when`);
      checkPagination(c.pagination, `hydrate.children[${i}].pagination`);
    }
  }
  checkPredicate(p.keep, "keep");
  checkPredicate(p.deletes?.when, "deletes.when");

  const f = p.fields;
  for (const k of ["title", "body", "snippet", "occurredAt", "updatedAt", "container", "groupKey", "status", "labels"] as const) checkExpr(f[k], `fields.${k}`);
  checkTemplate(f.url, "fields.url");
  const allowed = new Set(FACETS_BY_KIND[p.kind as ItemKind]);
  for (const [k, e] of Object.entries(f.facets ?? {})) {
    if (!k.startsWith("x_") && !allowed.has(k)) err(`fields.facets.${k}: not a ${p.kind} facet (allowed: ${[...allowed].join(", ") || "none"}; or prefix x_)`);
    checkExpr(e, `fields.facets.${k}`);
  }
  if (p.entities?.is) for (const [k, e] of Object.entries(p.entities.is)) if (k !== "type" && k !== "allEmails") checkExpr(e as Expr, `entities.is.${k}`);
  for (const [i, ref] of (p.entities?.refs ?? []).entries()) {
    for (const k of ["email", "name", "address", "domain", "externalId", "response"] as const) checkExpr(ref[k], `entities.refs[${i}].${k}`, !ref.each);
    if (ref.each) checkPath(ref.each, `entities.refs[${i}].each`, true);
    if (!ref.email && !ref.name && !ref.address && !ref.domain && !ref.externalId) err(`entities.refs[${i}]: needs email, name, address, domain or externalId`);
  }
  if (p.chunk) {
    if (p.chunk.strategy === "message" && !p.chunk.unit) err("chunk.unit is required for the message strategy");
    checkPath(p.chunk.unit, "chunk.unit", true);
    checkExpr(p.chunk.unitBody, "chunk.unitBody", false);
    checkTemplate(p.chunk.header, "chunk.header");
  }
  for (const [i, c] of (p.classify ?? []).entries()) {
    checkTemplate(c.jev.question, `classify[${i}].jev.question`);
    checkPredicate(c.when, `classify[${i}].when`);
  }
  for (const [k, s] of Object.entries(p.settings ?? {})) if (s.type === "choice" && !s.options.some((o) => o.value === s.default)) err(`settings.${k}: default is not one of the options`);

  const ok = !issues.some((i) => i.level === "error");
  return { ok, issues, ...(ok ? { hashes: { [p.id]: hashProfile(p as SearchProfile) } } : {}) };
}
