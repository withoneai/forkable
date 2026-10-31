// Deterministic inference (SPEC 10.4): read one dry-run response and guess the
// results array, the id, pagination, title, body, dates, people, link, the
// incremental filter and the kind. Also the fallback proposal when Anthropic is
// not in the grant ("Suggested by rules").

import type { Expr, FieldMap, InferenceHints, ItemKind, Pagination, SearchProfile } from "../contract.js";

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Path to the largest array of objects (depth 3), "" when the response itself is one. */
export function findResults(data: unknown): { path: string; rows: Obj[] } {
  let best: { path: string; rows: Obj[] } = { path: "", rows: [] };
  const visit = (v: unknown, path: string, depth: number) => {
    if (Array.isArray(v)) {
      const rows = v.filter(isObj);
      if (rows.length > best.rows.length || (rows.length && rows.length === best.rows.length && path.length < best.path.length)) best = { path, rows };
      return;
    }
    if (!isObj(v) || depth > 3) return;
    for (const [k, x] of Object.entries(v)) visit(x, path ? `${path}.${k}` : k, depth + 1);
  };
  visit(data, "", 0);
  return best;
}

function leaves(o: unknown, prefix = "", depth = 0, out: [string, unknown][] = []): [string, unknown][] {
  if (depth > 3) return out;
  if (isObj(o)) for (const [k, v] of Object.entries(o)) {
    const p = prefix ? `${prefix}.${/^[A-Za-z_$][\w$]*$/.test(k) ? k : `["${k}"]`}` : /^[A-Za-z_$][\w$]*$/.test(k) ? k : `["${k}"]`;
    if (isObj(v)) leaves(v, p, depth + 1, out);
    else out.push([p, v]);
  }
  return out;
}

const isDateish = (v: unknown, key: string): boolean => {
  if (typeof v === "string") return ISO_RE.test(v.trim()) || (/(_at|At|date|time|Date|Time)$/.test(key) && !Number.isNaN(Date.parse(v)));
  if (typeof v === "number") return /(_at|At|date|time|Date|Time|ts)$/i.test(key) && v > 946_684_800 && v < 4_102_444_800_000;
  return false;
};

/** Coverage of each leaf path across the sample rows. */
function stats(rows: Obj[]): Map<string, { n: number; values: unknown[] }> {
  const m = new Map<string, { n: number; values: unknown[] }>();
  for (const r of rows) for (const [p, v] of leaves(r)) {
    if (v === null || v === undefined || v === "") continue;
    const s = m.get(p) ?? { n: 0, values: [] };
    s.n++;
    s.values.push(v);
    m.set(p, s);
  }
  return m;
}

const PAGINATION: [string, (data: Obj) => Pagination | null][] = [
  ["nextPageToken", (d) => ("nextPageToken" in d ? { type: "cursor", next: "nextPageToken", passAs: "query:pageToken" } : null)],
  ["next_cursor", (d) => ("next_cursor" in d ? { type: "cursor", next: "next_cursor", passAs: "query:start_cursor", ...("has_more" in d ? { hasMore: "has_more" } : {}) } : null)],
  ["after_cursor", (d) => ("after_cursor" in d ? { type: "cursor", next: "after_cursor", passAs: "query:cursor", ...("end_of_stream" in d ? { hasMore: "end_of_stream", hasMoreInverted: true } : {}) } : null)],
  ["paging.next.after", (d) => (isObj(d.paging) && isObj((d.paging as Obj).next) ? { type: "cursor", next: "paging.next.after", passAs: "query:after" } : null)],
  ["@odata.nextLink", (d) => ("@odata.nextLink" in d ? { type: "nextUrl", next: '["@odata.nextLink"]' } : null)],
  ["response_metadata.next_cursor", (d) => (isObj(d.response_metadata) ? { type: "cursor", next: "response_metadata.next_cursor", passAs: "query:cursor" } : null)],
  ["meta.after_cursor", (d) => (isObj(d.meta) && "after_cursor" in (d.meta as Obj) ? { type: "cursor", next: "meta.after_cursor", passAs: "query:page[after]", ...("has_more" in (d.meta as Obj) ? { hasMore: "meta.has_more" } : {}) } : null)],
  ["nextOffset", (d) => ("nextOffset" in d ? { type: "cursor", next: "nextOffset", passAs: "query:offset" } : null)],
  ["pageInfo", (d) => (isObj(d.pageInfo) && "endCursor" in (d.pageInfo as Obj) ? { type: "relay", endCursor: "pageInfo.endCursor", hasNextPage: "pageInfo.hasNextPage", passAs: "query:after" } : null)],
  ["meta.next", (d) => (isObj(d.meta) && "next" in (d.meta as Obj) ? { type: "nextUrl", next: "meta.next" } : null)],
  ["next_page", (d) => ("next_page" in d ? { type: "nextUrl", next: "next_page" } : null)],
  // Stripe-style lists: { object: "list", data: [...], has_more }, the next page starts after the last id
  ["has_more+data", (d) => ("has_more" in d && Array.isArray(d.data) ? { type: "lastId", idPath: "id", passAs: "query:starting_after", hasMore: "has_more" } : null)],
];

/** True when a response says there is more than this page (a has_more flag, a next token or link). */
export function signalsMore(data: unknown): boolean {
  if (!isObj(data)) return false;
  const d = data as Obj;
  for (const k of ["has_more", "hasMore", "more", "has_next_page", "hasNextPage"]) if (d[k] === true) return true;
  for (const k of ["nextPageToken", "next_cursor", "nextCursor", "after_cursor", "next_page", "next", "@odata.nextLink"]) if (typeof d[k] === "string" && d[k]) return true;
  if (isObj(d.paging) && isObj((d.paging as Obj).next)) return true;
  if (isObj(d.meta) && ((d.meta as Obj).has_more === true || (typeof (d.meta as Obj).next === "string" && (d.meta as Obj).next))) return true;
  if (isObj(d.pageInfo) && (d.pageInfo as Obj).hasNextPage === true) return true;
  if (isObj(d.response_metadata) && typeof (d.response_metadata as Obj).next_cursor === "string" && (d.response_metadata as Obj).next_cursor) return true;
  return false;
}

const INCREMENTAL_PARAMS = ["updated_since", "updatedSince", "modified_since", "since", "updated_after", "updatedMin", "start_time", "$filter"];

/** Param names an ioSchema (or the docs' Markdown) mentions. */
function paramNames(ioSchema: unknown, knowledge = ""): Set<string> {
  const out = new Set<string>();
  const visit = (v: unknown, depth: number) => {
    if (depth > 6 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach((x) => visit(x, depth + 1)); return; }
    for (const [k, x] of Object.entries(v as Obj)) {
      if (k === "properties" && isObj(x)) for (const n of Object.keys(x)) out.add(n);
      if (k === "name" && typeof x === "string") out.add(x);
      visit(x, depth + 1);
    }
  };
  visit(ioSchema, 0);
  for (const m of knowledge.matchAll(/`([A-Za-z_$][\w$]*)`/g)) out.add(m[1]!);
  return out;
}

function guessKind(model: string, keys: string[]): ItemKind {
  const k = keys.join(" ").toLowerCase();
  const m = model.toLowerCase();
  if (/contact|person|people|user|member|lead/.test(m) && /email/.test(k)) return "person";
  if (/compan|organi|account/.test(m) && /domain/.test(k)) return "company";
  if (/deal|opportunit/.test(m) || (/amount/.test(k) && /stage/.test(k))) return "deal";
  if (/event|meeting/.test(m) && /start/.test(k) && /end/.test(k)) return "event";
  if (/issue|task|ticket|todo/.test(m)) return m.includes("ticket") ? "record" : "task";
  if (/message|chat|comment/.test(m)) return "message";
  if (/note/.test(m)) return "note";
  if (/page|doc|article|file/.test(m)) return "doc";
  return "record";
}

export function inferHints(data: unknown, opts: { model?: string; ioSchema?: unknown; knowledge?: string } = {}): InferenceHints {
  const { path, rows } = findResults(data);
  const st = stats(rows);
  const n = Math.max(1, rows.length);
  const top = rows[0] ?? {};
  const scalarKeys = Object.keys(top).filter((k) => !isObj(top[k]) && !Array.isArray(top[k]));
  // id: id, uuid, *_id at top level, unique across the sample
  const idCands = ["id", "uuid", "key", ...scalarKeys.filter((k) => /(^|_)id$|Id$/.test(k) && k !== "id")];
  let idPath: string | undefined;
  for (const c of idCands) {
    const vals = rows.map((r) => r[c]).filter((v) => typeof v === "string" || typeof v === "number");
    if (vals.length === rows.length && rows.length && new Set(vals.map(String)).size === vals.length) { idPath = c; break; }
  }
  if (!idPath && isObj(top.id)) {
    const inner = Object.keys(top.id as Obj).find((k) => /id$/i.test(k));
    if (inner) idPath = `id.${inner}`;
  }
  const strings = [...st.entries()].filter(([, s]) => s.values.every((v) => typeof v === "string"));
  const avgLen = (s: { values: unknown[] }) => s.values.reduce<number>((a, v) => a + String(v).length, 0) / Math.max(1, s.values.length);
  const nameScore = (p: string) => (/(^|\.)(title|subject|name|summary|display_?name|full_?name)$/i.test(p) ? 3 : /title|subject|name|summary/i.test(p) ? 1 : 0);
  const titleCandidates = strings
    .filter(([p, s]) => s.n / n >= 0.8 && avgLen(s) >= 2 && avgLen(s) <= 140 && !s.values.some((v) => EMAIL_RE.test(String(v)) || /^https?:/.test(String(v)) || isDateish(v, p)))
    .sort((a, b) => nameScore(b[0]) - nameScore(a[0]) || b[1].n - a[1].n || a[0].length - b[0].length)
    .map(([p]) => p)
    .filter((p) => p !== idPath)
    .slice(0, 5);
  const bodyCandidates = strings
    .filter(([p, s]) => avgLen(s) > 60 || /(description|body|content|text|notes?|comment|message)$/i.test(p))
    .sort((a, b) => avgLen(b[1]) - avgLen(a[1]))
    .map(([p]) => p)
    .slice(0, 5);
  const dateCandidates = [...st.entries()].filter(([p, s]) => s.values.every((v) => isDateish(v, p))).map(([p]) => p)
    .sort((a, b) => (/creat/i.test(b) ? 1 : 0) - (/creat/i.test(a) ? 1 : 0));
  const emailCandidates = strings.filter(([, s]) => s.values.some((v) => EMAIL_RE.test(String(v).trim()))).map(([p]) => p);
  const urlCandidates = strings.filter(([p, s]) => /(^|\.)(url|webLink|htmlLink|permalink|web_url|html_url|link)$/i.test(p) && s.values.every((v) => /^https:\/\//.test(String(v)))).map(([p]) => p);
  let pagination: Pagination | undefined;
  if (isObj(data)) for (const [, f] of PAGINATION) { const p = f(data); if (p) { pagination = p; break; } }
  const params = paramNames(opts.ioSchema, opts.knowledge);
  const incrementalParam = INCREMENTAL_PARAMS.find((p) => params.has(p));
  return {
    resultsPath: path, idPath, pagination, titleCandidates, bodyCandidates, dateCandidates, emailCandidates, urlCandidates,
    ...(incrementalParam ? { incrementalParam } : {}), kindGuess: guessKind(opts.model ?? path, scalarKeys),
  };
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "records";
}

/** The model name for an action: the results key, else the last path segment. */
export function modelName(actionPath: string, resultsPath: string | undefined, title: string): string {
  const fromResults = resultsPath ? resultsPath.split(".").pop() : "";
  const fromPath = actionPath.replace(/\{\{?[^}]+\}?\}/g, "").split("/").filter(Boolean).pop() ?? "";
  return slug(fromResults && fromResults !== "data" && fromResults !== "results" && fromResults !== "items" ? fromResults : fromPath || title);
}

const item = (p: string) => `item.${p.replace(/^\./, "")}`;

/** A complete profile from the hints alone (the rules fallback). */
export function profileFromHints(o: { platform: string; actionId: string; title: string; method: string; path: string; hints: InferenceHints; userId?: string; sampleOnly?: boolean }): SearchProfile {
  const h = o.hints;
  const model = modelName(o.path, h.resultsPath, o.title);
  const created = h.dateCandidates.find((d) => /creat/i.test(d)) ?? h.dateCandidates[0];
  const updated = h.dateCandidates.find((d) => /updat|modif|edit|change/i.test(d));
  // a doc or file happened when it last changed; a record when it was made. Never the sync time (D45):
  // with no date in the sample the engine reads the record's own modified/updated/created keys, else first seen.
  const changeFirst = h.kindGuess === "doc" || /file|doc|page|sheet|folder/i.test(model);
  const order = (changeFirst ? [updated, created] : [created, updated]).filter((d): d is string => !!d);
  const fields: FieldMap = {
    title: h.titleCandidates[0] ? { coalesce: [item(h.titleCandidates[0]), { template: "(untitled)" }] } : { template: "(untitled)" },
    occurredAt: order.length > 1 ? { coalesce: order.map((d) => ({ path: item(d), decode: "datetime" as const })) }
      : order[0] ? { path: item(order[0]), decode: "datetime" }
      : { coalesce: ["modifiedTime", "updatedAt", "updated_at", "createdTime", "createdAt", "created_at"].map((d) => ({ path: item(d), decode: "datetime" as const })) },
  };
  const body = h.bodyCandidates.find((b) => b !== h.titleCandidates[0]);
  if (body) fields.body = { path: item(body), decode: /html/i.test(body) ? "html" : "text" } as Expr;
  if (updated) fields.updatedAt = { path: item(updated), decode: "datetime" };
  if (h.urlCandidates[0]) fields.url = `{{ ${item(h.urlCandidates[0])} }}`;
  const status = h.titleCandidates.find((t) => /(^|\.)(status|state|stage)$/i.test(t));
  if (status) fields.status = item(status);
  const refs = h.emailCandidates.slice(0, 3).map((p) => {
    const role = /from|sender|author|creator|requester|reporter/i.test(p) ? "author" : /assign|owner/i.test(p) ? "assignee" : /to|recipient|attendee/i.test(p) ? "to" : "mentioned";
    return { role: role as "author", type: "person" as const, email: { path: item(p), decode: "email" as const } };
  });
  const sinceParam = h.incrementalParam && h.incrementalParam !== "$filter" ? h.incrementalParam : undefined;
  const unixy = sinceParam === "start_time";
  return {
    $schema: "https://search.forkable.dev/schema/profile-1.json",
    id: `${slug(o.platform)}.${model}`,
    platform: o.platform, model, kind: h.kindGuess ?? "record",
    title: `${o.platform.split(/[-_]/).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ")} ${model.replace(/-/g, " ")}`,
    author: o.userId ?? "user", revision: 1, verified: "none",
    ...(o.sampleOnly ? { sampleOnly: true } : {}),
    list: {
      actionId: o.actionId,
      ...(sinceParam ? { query: { [sinceParam]: unixy ? "{{ run.since | unix }}" : "{{ run.since | iso }}" } } : {}),
      resultsPath: h.resultsPath ?? "", idPath: h.idPath ?? "id", pagination: h.pagination ?? { type: "none" },
      ...(h.pagination?.type === "lastId" ? { pageSize: { param: "limit", value: 100 } } : {}),
    },
    incremental: sinceParam && updated ? { strategy: "watermark", field: item(updated), order: "asc", overlap: "10m", initial: "180d" } : { strategy: "full" },
    deletes: { reconcile: "onFullPass", fullPassEvery: "7d" },
    fields,
    ...(refs.length ? { entities: { refs } } : {}),
    chunk: { strategy: "paragraph", maxTokens: 400 },
    schedule: { every: "30m" },
  };
}
