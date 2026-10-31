// Raw record -> NormalizedItem (pure, deterministic: its output is hashed).

import type { EntityRef, ItemFacets, NormalizeEnv, NormalizedItem, RawRecord, ResolvedIs, ResolvedRef, SearchProfile } from "../contract.js";
import { decodeAddress, decodeDomain, decodeEmail } from "../decode/address.js";
import { evalExpr, evalList, evalString, isEmptyValue } from "../expr/field.js";
import { getPath, resolvePath } from "../expr/path.js";
import { evalPredicate } from "../expr/predicate.js";
import { renderTemplate, type TemplateCtx } from "../expr/template.js";
import { toIso } from "../expr/time.js";

export const MAX_BODY = 200_000;
/** A date further ahead than this is not when the thing happened (an expanded series, a typo year). An event past it is not indexed (D45). */
export const FUTURE_LIMIT_MS = 730 * 86_400_000;
/** When the profile's own date paths come back empty: the record's usual date keys, change before creation. */
export const RECORD_DATE_KEYS = ["modifiedTime", "modified_at", "modifiedAt", "updatedAt", "updated_at", "updated", "lastModified", "last_modified", "lastModifiedDateTime", "createdTime", "createdAt", "created_at", "created", "createdDateTime"];

export function templateCtx(raw: RawRecord, env: NormalizeEnv, extra: Record<string, unknown> = {}): TemplateCtx {
  return { item: raw.item, detail: raw.detail, children: raw.children ?? {}, partition: raw.partition, account: env.account, settings: env.settings, now: env.now, ...extra };
}

function strList(v: unknown[]): string[] {
  return v.flatMap((x) => (typeof x === "string" ? [x] : typeof x === "number" || typeof x === "boolean" ? [String(x)] : []));
}

function resolveRef(ref: EntityRef, ctx: TemplateCtx): ResolvedRef[] {
  const out: ResolvedRef[] = [];
  const name = ref.name !== undefined ? evalString(ref.name, ctx) ?? undefined : undefined;
  const response = ref.response !== undefined ? evalString(ref.response, ctx) ?? undefined : undefined;
  if (ref.address !== undefined) {
    const vals = evalList(ref.address, ctx);
    for (const v of vals) for (const a of decodeAddress(v)) out.push({ role: ref.role, type: ref.type, ...(a.email ? { email: a.email } : {}), ...(a.name ? { name: a.name } : {}), ...(response ? { response } : {}) });
    return out;
  }
  if (ref.email !== undefined) {
    const emails = [...new Set(strList(evalList(ref.email, ctx)).map((e) => decodeEmail(e)).filter((e): e is string => !!e))];
    const names = ref.name !== undefined ? strList(evalList(ref.name, ctx)) : [];
    emails.forEach((email, i) => {
      const n = emails.length === 1 ? name : names.length === emails.length ? names[i] : undefined;
      out.push({ role: ref.role, type: ref.type, email, ...(n ? { name: n } : {}), ...(response ? { response } : {}) });
    });
    if (out.length) return out;
  }
  if (ref.externalId !== undefined) {
    const ids = strList(evalList(ref.externalId, ctx)).filter(Boolean);
    const names = ref.name !== undefined ? strList(evalList(ref.name, ctx)) : [];
    ids.forEach((externalId, i) => out.push({ role: ref.role, type: ref.type, externalId, ...(ids.length === 1 && name ? { name } : names.length === ids.length && names[i] ? { name: names[i] } : {}) }));
    if (out.length) return out;
  }
  const domain = ref.domain !== undefined ? decodeDomain(evalString(ref.domain, ctx) ?? "") : undefined;
  if (name || domain) out.push({ role: ref.role, type: ref.type, ...(name ? { name } : {}), ...(domain ? { domain } : {}) });
  return out;
}

/** Every distinct email a value resolves to. */
function emailsOf(expr: Parameters<typeof evalExpr>[0] | undefined, ctx: TemplateCtx): string[] {
  if (expr === undefined) return [];
  const raw = evalExpr(typeof expr === "string" ? { path: expr, pick: "all" } : expr, ctx);
  const vals = (Array.isArray(raw) ? raw : [raw]).filter((v) => !isEmptyValue(v));
  return [...new Set(strList(vals).map((v) => decodeEmail(v)).filter((v): v is string => !!v))];
}

/** A person record with this many addresses or fewer is keyed by all of them; more is a list of other people. */
export const MAX_IS_EMAILS = 5;

/** CLI fan-out guard: a value that resolves to more than one distinct email makes no merge. */
function single(expr: Parameters<typeof evalExpr>[0] | undefined, ctx: TemplateCtx, kind: "email" | "domain" | "plain"): string | undefined {
  if (expr === undefined) return undefined;
  const raw = evalExpr(typeof expr === "string" ? { path: expr, pick: "all" } : expr, ctx);
  const vals = (Array.isArray(raw) ? raw : [raw]).filter((v) => !isEmptyValue(v));
  const norm = [...new Set(strList(vals).map((v) => (kind === "email" ? decodeEmail(v) : kind === "domain" ? decodeDomain(v) : v.trim())).filter((v): v is string => !!v))];
  return norm.length === 1 ? norm[0] : undefined;
}

export function normalize(profile: SearchProfile, raw: RawRecord, env: NormalizeEnv): NormalizedItem {
  const ctx = templateCtx(raw, env);
  const f = profile.fields;
  const externalId = String(getPath(raw.item, profile.list.idPath) ?? "");
  let body = evalString(f.body, ctx) ?? "";
  if (body.length > MAX_BODY) body = body.slice(0, MAX_BODY);
  const title = (evalString(f.title, ctx) ?? "").replace(/\s+/g, " ").trim() || "(untitled)";
  let snippet = evalString(f.snippet, ctx);
  if (!snippet && body) snippet = body.replace(/\s+/g, " ").trim().slice(0, 280);
  if (snippet && snippet.length > 280) snippet = snippet.slice(0, 279) + "…";
  // occurredAt (D45): the profile's date, else its updatedAt, else the record's own date keys, else first seen.
  // Never a date more than two years out; an event that far out (an endless series) is not indexed.
  const limit = (env.now ? new Date(env.now).getTime() : Date.parse(raw.fetchedAt)) + FUTURE_LIMIT_MS;
  const sane = (v: string | null) => (v && !(Date.parse(v) > limit) ? v : null);
  const mapped = toIso(evalExpr(f.occurredAt, ctx));
  const farFuture = !!mapped && Date.parse(mapped) > limit;
  const updatedAt = sane(f.updatedAt ? toIso(evalExpr(f.updatedAt, ctx)) : null);
  const own = () => {
    const rec = raw.item && typeof raw.item === "object" ? (raw.item as Record<string, unknown>) : {};
    for (const k of RECORD_DATE_KEYS) { const v = sane(toIso(rec[k])); if (v) return v; }
    return null;
  };
  const known = sane(mapped) ?? updatedAt ?? own();
  const occurredAt = known ?? raw.fetchedAt;
  const container = evalString(f.container, ctx);
  const groupKey = evalString(f.groupKey, ctx);
  const status = evalString(f.status, ctx);
  const labels = [...new Set(strList(evalList(f.labels, ctx)).map((s) => s.trim()).filter(Boolean))];

  const facets: Record<string, unknown> = { kind: profile.kind };
  for (const [k, e] of Object.entries(f.facets ?? {})) {
    const v = evalExpr(e, ctx);
    if (!isEmptyValue(v)) facets[k] = v;
  }

  const doc = { title, body, snippet, occurredAt, updatedAt, container, groupKey, status, labels, facets, externalId };
  const url = f.url ? renderTemplate(f.url, { ...ctx, doc }, { strict: true }) : null;

  const refs: ResolvedRef[] = [];
  for (const ref of profile.entities?.refs ?? []) {
    if (!ref.each) { refs.push(...resolveRef(ref, ctx)); continue; }
    // one ref per element; its paths see the element's fields (or `el` for a scalar) and the usual roots
    for (const el of resolvePath(ctx, ref.each)) {
      const elCtx = { ...ctx, ...(el && typeof el === "object" && !Array.isArray(el) ? (el as Record<string, unknown>) : {}), el };
      for (const r of resolveRef({ ...ref, each: undefined }, elCtx)) refs.push(r);
    }
  }

  let is: ResolvedIs | null = null;
  const isSpec = profile.entities?.is;
  if (isSpec) {
    const r: ResolvedIs = { type: isSpec.type };
    // allEmails: a record with 2 to 5 addresses is one person under each of them (D43)
    const emails = isSpec.type === "person" && isSpec.allEmails ? emailsOf(isSpec.email, ctx) : [];
    const email = emails.length > 1 && emails.length <= MAX_IS_EMAILS ? emails[0] : single(isSpec.email, ctx, "email");
    const domain = single(isSpec.domain, ctx, "domain");
    const name = isSpec.name ? evalString(isSpec.name, ctx) ?? undefined : undefined;
    const externalIdV = single(isSpec.externalId, ctx, "plain");
    const t = isSpec.title ? evalString(isSpec.title, ctx) ?? undefined : undefined;
    const cn = isSpec.companyName ? evalString(isSpec.companyName, ctx) ?? undefined : undefined;
    if (email) r.email = email;
    if (emails.length > 1 && emails.length <= MAX_IS_EMAILS) r.emails = emails;
    if (domain) r.domain = domain;
    if (name) r.name = name.replace(/\s+/g, " ").trim();
    if (externalIdV) r.externalId = externalIdV;
    if (t) r.title = t;
    if (cn) r.companyName = cn;
    if (r.email || r.domain || r.externalId || r.name) is = r;
  }

  const deleted = (profile.deletes?.when ? evalPredicate(profile.deletes.when, ctx) : false) || (farFuture && profile.kind === "event");

  return {
    externalId, kind: profile.kind, title, body, snippet: snippet ?? null, occurredAt, updatedAt: updatedAt ?? null, url,
    container, groupKey, status, labels, facets: facets as ItemFacets, refs, is, deleted,
    ...(known ? {} : { occurredAtGuessed: true }),
  };
}
