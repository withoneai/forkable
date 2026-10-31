// The field map vocabulary for the New profile flow (SPEC 10.1 step 3) and the
// small, pure helpers both the sheet and the mock use: resolve a path in a
// sample record, list a record's leaf paths, and turn the map rows the user
// edits into the Partial<SearchProfile> a draft PATCH carries.
import type { EntityRef, FieldMap, ItemKind, ProposalOutput, SearchProfile } from "@/contract/api-types";

export type Target =
  | "skip" | "property" | "title" | "body" | "occurredAt" | "updatedAt" | "status" | "labels" | "container"
  | "priority" | "from" | "assignee" | "company" | "email" | "id" | "url";

export interface TargetSpec { key: Target; label: string; required?: boolean; hint?: string }

/** Skip is pinned first in every menu (Salesforce pattern). */
export const TARGETS: TargetSpec[] = [
  { key: "skip", label: "Skip" },
  { key: "title", label: "Title", required: true },
  { key: "id", label: "Unique id", required: true },
  { key: "occurredAt", label: "Date created", required: true },
  { key: "body", label: "Body" },
  { key: "updatedAt", label: "Date updated" },
  { key: "url", label: "Link" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "labels", label: "Labels" },
  { key: "container", label: "Container" },
  { key: "from", label: "Person, from" },
  { key: "assignee", label: "Person, assignee" },
  { key: "email", label: "Email" },
  { key: "company", label: "Company" },
  { key: "property", label: "Keep as property" },
];
export const targetLabel = (t: Target) => TARGETS.find((x) => x.key === t)?.label ?? t;
export const REQUIRED: Target[] = ["title", "id", "occurredAt"];

/** The required targets no real field carries yet (a row with no path never counts). */
export const missingTargets = (rows: MapRow[]): Target[] => REQUIRED.filter((t) => !rows.some((r) => r.target === t && r.path));

export interface MapRow { path: string; target: Target; confidence: number | null; reason: string | null; by: "ai" | "user" | "none" }

/** Resolve a.b, a[0], a[-1], a[] in a record. Returns the first value, or the array for a[]. */
export function getPath(root: unknown, path: string): unknown {
  if (!path) return undefined;
  const parts = path.replace(/\[(-?\d+)\]/g, ".$1").replace(/\[\]/g, "").split(".").filter(Boolean);
  let cur: unknown = root;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur) && /^-?\d+$/.test(p)) { const i = Number(p); cur = cur[i < 0 ? cur.length + i : i]; continue; }
    if (typeof cur === "object") cur = (cur as Record<string, unknown>)[p];
    else return undefined;
  }
  return cur;
}

/** Leaf paths of a record: nested objects with dots, arrays kept whole. */
export function leafPaths(obj: unknown, prefix = ""): string[] {
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) return prefix ? [prefix] : [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...leafPaths(v, p));
    else out.push(p);
  }
  return out;
}

export function showValue(v: unknown, max = 44): string {
  if (v === undefined) return "missing";
  if (v === null || v === "") return "empty";
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === "object" ? "{...}" : String(x))).join(", ").slice(0, max) : "empty list";
  if (typeof v === "object") return "{...}";
  const s = String(v).replace(/\s+/g, " ");
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

const STRUCTURAL = /^(kind|model|list\.(?!idPath)|incremental|schedule|chunk|deletes|pagination|partitions|hydrate|account)/;
/** The first item path an expression reads ({ coalesce: [{ join: [...] }] } included). */
const firstPath = (e: unknown): string | null => {
  if (!e) return null;
  if (typeof e === "string") return e.startsWith("item.") ? e : tplPath(e) ? `item.${tplPath(e)}` : null;
  if (typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  if (typeof o.path === "string") return o.path;
  for (const k of ["coalesce", "join"] as const) if (Array.isArray(o[k])) for (const x of o[k] as unknown[]) { const p = firstPath(x); if (p) return p; }
  return null;
};

/** Reads a template's single path, "{{ item.url }}" -> "url". */
const tplPath = (t: unknown) => (typeof t === "string" ? /\{\{\s*item\.([^\s|}]+)/.exec(t)?.[1] ?? null : null);
const exprPath = (e: unknown): string | null => (typeof e === "string" ? e : e && typeof e === "object" && "path" in e ? String((e as { path: string }).path) : null);

/** The proposal's targets ("fields.title", "list.idPath", "facets.priority", "refs.from") as our keys. */
export function normalizeTarget(t: string): Target {
  const s = t.replace(/^fields\./, "").replace(/^facets\./, "").replace(/^entities\./, "");
  if (s === "list.idPath" || s === "idPath" || s === "id") return "id";
  if (/^refs[.[]from/.test(s) || s === "from" || s === "requester") return "from";
  if (/^refs[.[]assignee/.test(s) || s === "assignee") return "assignee";
  if (/^refs[.[](about|company)/.test(s) || s === "company" || s === "is.domain") return "company";
  if (s === "is.email" || s === "email") return "email";
  if (s === "snippet") return "body";
  if (s.startsWith("x_")) return "property";
  return (TARGETS.some((x) => x.key === s) ? s : "property") as Target;
}

/** Map rows for one proposed model: every leaf path of the first sample, the AI's picks laid over it. */
export function rowsFromProposal(model: ProposalOutput["models"][number] | undefined, sample: unknown): MapRow[] {
  const paths = leafPaths(sample);
  const rows = new Map<string, MapRow>(paths.map((p) => [p, { path: p, target: "skip", confidence: null, reason: null, by: "none" }]));
  for (const n of model?.fieldNotes ?? []) {
    const path = (n.path ?? "").replace(/^item\./, "").trim();
    // notes about the profile's shape (kind, list.actionId, incremental...) name no field
    if (!path || STRUCTURAL.test(n.target)) continue;
    rows.set(path, { path, target: normalizeTarget(n.target), confidence: n.confidence, reason: n.reason, by: "ai" });
  }
  // a proposal can map a field without a note for it: take those from the profile itself
  const f = model?.profile.fields;
  const fromProfile: [Target, string | null][] = f ? [
    ["title", firstPath(f.title)], ["occurredAt", firstPath(f.occurredAt)], ["updatedAt", firstPath(f.updatedAt)], ["body", firstPath(f.body)], ["url", tplPath(f.url)],
  ] : [];
  for (const [t, p] of fromProfile) {
    const path = p?.replace(/^item\./, "");
    if (!path || [...rows.values()].some((r) => r.target === t && r.path)) continue;
    const cur = rows.get(path);
    if (cur && cur.target !== "skip") continue;
    rows.set(path, { path, target: t, confidence: 0.8, reason: "From the proposal", by: "ai" });
  }
  // The id lives in list.idPath, which a proposal may not repeat in its notes.
  const idPath = model?.profile.list.idPath;
  if (idPath && ![...rows.values()].some((r) => r.target === "id")) rows.set(idPath, { path: idPath, target: "id", confidence: 0.9, reason: "The proposal's unique id", by: "ai" });
  return [...rows.values()];
}

/** The rows the user settled on, as the parts of a SearchProfile a draft PATCH carries. */
export function rowsToPatch(rows: MapRow[], base: SearchProfile | undefined, extra: { urlTemplate?: string; titleTemplate?: string } = {}): Partial<SearchProfile> {
  const by = (t: Target) => rows.filter((r) => r.target === t && r.path).map((r) => r.path);
  const one = (t: Target) => by(t)[0];
  // Field paths are rooted at item (profile grammar); list.idPath is relative to the record.
  const it = (p: string | undefined) => (p ? `item.${p}` : "");
  const fields: FieldMap = { ...(base?.fields ?? { title: "", occurredAt: "" }), title: "", occurredAt: "" } as FieldMap;
  for (const k of ["body", "updatedAt", "status", "labels", "container", "url", "snippet"] as const) delete (fields as unknown as Record<string, unknown>)[k];
  fields.facets = {};
  // a field the user left where the AI put it keeps the AI's fuller expression (first + last name, a fallback chain)
  const kept = (t: Target, e: unknown) => !!one(t) && firstPath(e) === it(one(t));
  const baseTitle = base?.fields.title, baseDate = base?.fields.occurredAt;
  fields.title = extra.titleTemplate ? { coalesce: [it(one("title")), { template: extra.titleTemplate }] } : kept("title", baseTitle) ? baseTitle! : it(one("title"));
  fields.occurredAt = kept("occurredAt", baseDate) ? baseDate! : one("occurredAt") ? { path: it(one("occurredAt")), decode: "datetime" } : "";
  if (one("body")) fields.body = { path: it(one("body")), decode: "text" };
  if (one("updatedAt")) fields.updatedAt = { path: it(one("updatedAt")), decode: "datetime" };
  if (one("status")) fields.status = it(one("status"));
  if (one("labels")) fields.labels = { path: `${it(one("labels")).replace(/\[\]$/, "")}[]`, pick: "all" };
  if (one("container")) fields.container = it(one("container"));
  if (one("priority")) fields.facets.x_priority = it(one("priority"));
  for (const p of by("property")) fields.facets[`x_${p.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase()}`] = it(p);
  const url = extra.urlTemplate ?? (one("url") ? `{{ item.${one("url")} }}` : undefined);
  if (url) fields.url = url;
  const platform = base?.platform ?? "source";
  const refs: EntityRef[] = [];
  for (const p of by("from")) refs.push({ role: "author", type: "person", externalId: { template: `${platform}:user:{{ item.${p} }}` } });
  for (const p of by("assignee")) refs.push({ role: "assignee", type: "person", externalId: { template: `${platform}:user:{{ item.${p} }}` } });
  for (const p of by("company")) refs.push({ role: "about", type: "company", externalId: { template: `${platform}:organization:{{ item.${p} }}` } });
  const email = one("email");
  return {
    fields,
    list: base ? { ...base.list, idPath: one("id") ?? "" } : undefined,
    // no person or company picked here: keep the proposal's own refs
    entities: { ...(base?.entities ?? {}), refs: refs.length ? refs : base?.entities?.refs ?? [], ...(email ? { is: { type: "person", email: { path: it(email), decode: "email" } } } : {}) },
  } as Partial<SearchProfile>;
}

/** Reverse of rowsToPatch for a saved profile (the Fields tab): the map as rows. */
export function profileToRows(p: SearchProfile): { target: string; expr: string }[] {
  const out: { target: string; expr: string }[] = [];
  const show = (e: unknown): string => typeof e === "string" ? e : JSON.stringify(e);
  out.push({ target: "Unique id", expr: p.list.idPath });
  for (const [k, v] of Object.entries(p.fields)) {
    if (k === "facets") for (const [fk, fv] of Object.entries((v as Record<string, unknown>) ?? {})) out.push({ target: `facets.${fk}`, expr: show(fv) });
    else out.push({ target: targetLabel(k as Target) === k ? k : targetLabel(k as Target), expr: show(v) });
  }
  for (const r of p.entities?.refs ?? []) out.push({ target: `${r.type}, ${r.role}`, expr: show(r.externalId ?? r.email ?? r.address ?? r.name) });
  if (p.entities?.is) out.push({ target: `is ${p.entities.is.type}`, expr: show(p.entities.is.email ?? p.entities.is.domain ?? p.entities.is.name) });
  return out;
}

export const KIND_TARGETS: Partial<Record<ItemKind, Target[]>> = {
  person: ["email", "company"],
  company: [],
  task: ["priority", "from", "assignee", "company"],
};

export { tplPath, exprPath };

/** Fill "{{ item.x }}" in a template from a sample record. */
export function renderTpl(tpl: string, item: unknown, vars: Record<string, string> = {}): string | null {
  let missing = false;
  const out = tpl.replace(/\{\{\s*([^}|\s]+)[^}]*\}\}/g, (_, expr: string) => {
    const v = expr.startsWith("item.") ? getPath(item, expr.slice(5)) : vars[expr.replace(/^account\./, "")];
    if (v == null || v === "") { missing = true; return ""; }
    return String(v);
  });
  return missing ? null : out;
}

/** "properties.firstname" -> "First name", "created_at" -> "Created at": a field as a person reads it. */
export function fieldName(path: string): string {
  const last = path.replace(/\[[^\]]*\]/g, "").split(".").filter(Boolean).pop() ?? path;
  const w = last
    .replace(/^hs_/, "")
    .replace(/(first|last|full|user|company|display|nick|domain|file)(name)/i, "$1 $2")
    .replace(/(create|close|due|start|end|modified|lastmodified)(date)/i, "$1 $2")
    .replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return w ? w[0]!.toUpperCase() + w.slice(1) : path;
}

export type FixAt = "fields" | "advanced" | "settings" | null;
export interface PlainIssue { text: string; level: "error" | "warn"; fixAt: FixAt; target?: Target }

/** A server check in plain words, with where it gets fixed. Raw schema text never reaches the screen. */
export function humanizeIssue(i: { check: string; level: string; message: string }, o: { platform: string; noun: string }): PlainIssue {
  const level = i.level === "error" ? "error" : "warn";
  const m = i.message;
  const field = /fields\.(\w+)/.exec(m)?.[1];
  if (i.check === "schema" && field === "occurredAt") return { level, fixAt: "fields", target: "occurredAt", text: `We could not find a date for each ${o.noun}. Pick the field that says when it was created.` };
  if (i.check === "schema" && field === "title") return { level, fixAt: "fields", target: "title", text: `Each ${o.noun} needs a title. Pick the field that names it.` };
  if (i.check === "schema" && /idPath/.test(m)) return { level, fixAt: "advanced", target: "id", text: `Pick the field that tells ${o.noun}s apart.` };
  if (i.check === "schema" && /facets/.test(m)) return { level, fixAt: "fields", text: "One kept field has no name. Skip it or pick it again in Edit fields." };
  if (i.check === "schema") return { level, fixAt: "fields", text: `Something in the map is incomplete. Open Edit fields and check the fields marked as required.` };
  if (i.check === "title") return { level, fixAt: "fields", target: "title", text: /needs a field/.test(m) ? `Each ${o.noun} needs a title. Pick the field that names it.` : `Some ${o.noun}s have no title. ${m}.` };
  if (i.check === "dates") return { level, fixAt: "fields", target: "occurredAt", text: `Some ${o.noun}s have no readable date (${m.replace(/^Dates parse on /, "")} do). Pick another date field.` };
  if (i.check === "id") return { level, fixAt: "advanced", target: "id", text: `The record id is not unique or is missing (${m}). Pick another one.` };
  if (i.check === "link" && /API/.test(m)) return { level, fixAt: "advanced", target: "url", text: `Open in ${o.platform} would show raw API data, not the ${o.noun}. Clear the link or use the app's address.` };
  if (i.check === "link") return { level, fixAt: "advanced", target: "url", text: /No link/.test(m) ? `Results will not open in ${o.platform}. Add a link in Advanced if you want that.` : m };
  if (i.check === "pagination" && /more pages/.test(m)) return { level, fixAt: null, text: `${o.platform} lists ${o.noun}s in pages, and this map reads only the first one. Ask AI to fix to read every page.` };
  if (i.check === "actions" && /grant/.test(m)) return { level, fixAt: null, text: m };
  if (i.check === "fetch") return { level, fixAt: null, text: m };
  return { level, fixAt: null, text: m };
}
