// Hybrid search (SPEC 9.2): Postgres full text + pgvector, fused with Reciprocal Rank
// Fusion, filtered by operators, boosted by importance, recency and named entities.

import { sql, type SQL } from "drizzle-orm";
import type { EntityChip, ItemFacets, ItemKind, Lane, OpValue, ParsedQuery, ResultRow, SearchRequest, SearchResponse } from "../api-types.js";
import type { EntityRole } from "../contract.js";
import type { EngineCtx } from "../ctx.js";
import { pickEmbedder, embedQueryWithStatus, semanticStatus, vectorLiteral } from "../embed/index.js";
import { newId } from "../ids.js";
import { logoUrl, PLATFORM_NAMES, platformName } from "../platforms.js";
import { DATE_KEYS, formatQuery, parseQuery, TYPE_ALIASES } from "../query/parse.js";
import { proposeDates } from "../query/dates.js";
import { fold, keepWords, understandQuery, withoutFiller } from "../query/understand.js";
import { vocabExtra, vocabFor } from "./vocab.js";
import { entityItemStats } from "./entity-items.js";

export const RRF_K = 60;
/** Cosine distance past which a vector neighbour is not a match (similarity under 0.25). */
export const VEC_MAX_DISTANCE = 0.75;

/** An exact title, or the whole query as a phrase inside the title, counts like one more rank-1 keyword hit (D42). */
export const EXACT_TITLE_BONUS = 1 / (RRF_K + 1);
/** A person or company record nothing else mentions (no mail, event, note, message) weighs this much (D43). */
export const LONE_RECORD_WEIGHT = 0.6;
/** pg_trgm similarity an entity name needs to be offered as "Did you mean" (D43). */
export const DID_YOU_MEAN_MIN = 0.4;

export interface FusedRank { id: string; kw: number | null; vec: number | null; title: number | null; rrf: number }

/** RRF: 1/(k + r_kw) + 1/(k + r_vec) + 0.5/(k + r_title); a missing rank contributes 0. */
export function fuseRanks(kw: string[], vec: string[], title: string[], k = RRF_K): FusedRank[] {
  const m = new Map<string, FusedRank>();
  const get = (id: string) => { let f = m.get(id); if (!f) { f = { id, kw: null, vec: null, title: null, rrf: 0 }; m.set(id, f); } return f; };
  kw.forEach((id, i) => { const f = get(id); f.kw = i + 1; f.rrf += 1 / (k + i + 1); });
  vec.forEach((id, i) => { const f = get(id); f.vec = i + 1; f.rrf += 1 / (k + i + 1); });
  title.forEach((id, i) => { const f = get(id); f.title = i + 1; f.rrf += 0.5 / (k + i + 1); });
  return [...m.values()].sort((a, b) => b.rrf - a.rrf || a.id.localeCompare(b.id));
}

/** score = rrf * (1 + 0.15 * importance) * (0.85 + 0.15 * exp(-age_days / 90)) * (1.2 when a named entity is linked) */
export function boostScore(rrf: number, importance: number | null, ageDays: number, entityHit: boolean): number {
  return rrf * (1 + 0.15 * (importance ?? 0)) * (0.85 + 0.15 * Math.exp(-Math.max(0, ageDays) / 90)) * (entityHit ? 1.2 : 1);
}

// ---------- entities named in the query ----------

async function rows<T>(ctx: EngineCtx, q: SQL): Promise<T[]> {
  return (await ctx.db.execute(q)).rows as T[];
}

export async function resolveEntityValue(ctx: EngineCtx, userId: string, value: string): Promise<string[]> {
  const v = value.trim().toLowerCase();
  if (!v) return [];
  if (v === "me") return (await rows<{ id: string }>(ctx, sql`select id from entities where user_id = ${userId} and is_self and merged_into_id is null`)).map((r) => r.id);
  if (v.includes("@")) {
    return (await rows<{ id: string }>(ctx, sql`select e.id from entity_keys k join entities e on e.id = k.entity_id where k.user_id = ${userId} and k.key = ${"email:" + v} and e.merged_into_id is null`)).map((r) => r.id);
  }
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v)) {
    const r = await rows<{ id: string }>(ctx, sql`select e.id from entity_keys k join entities e on e.id = k.entity_id where k.user_id = ${userId} and k.key = ${"domain:" + v} and e.merged_into_id is null`);
    if (r.length) return r.map((x) => x.id);
  }
  // name: every word must prefix-match a word of the name
  const words = v.split(/\s+/).filter(Boolean).map((w) => w.replace(/[^a-z0-9.'-]/g, "")).filter(Boolean);
  if (!words.length) return [];
  const conds = words.map((w) => sql`(lower(e.name) like ${w + "%"} or lower(e.name) like ${"% " + w + "%"})`);
  return (await rows<{ id: string }>(ctx, sql`select e.id from entities e where e.user_id = ${userId} and e.merged_into_id is null and ${sql.join(conds, sql` and `)} order by e.item_count desc limit 10`)).map((r) => r.id);
}

const ROLES: Record<string, EntityRole[] | null> = {
  from: ["from", "author", "organizer", "owner"],
  to: ["to", "cc", "attendee", "assignee"],
  with: null,
  about: ["about", "is", "mentioned"],
};

// ---------- filters ----------

function platformsFor(v: string): string[] {
  const s = v.toLowerCase().replace(/^#/, "");
  const out = new Set<string>();
  for (const [slug, name] of Object.entries(PLATFORM_NAMES)) {
    const n = name.toLowerCase();
    if (slug === s || n === s || n.replace(/\s+/g, "") === s || n.replace(/\s+/g, "-") === s) out.add(slug);
  }
  if (!out.size) {
    if (s === "outlook") { out.add("outlook-mail"); out.add("outlook-calendar"); }
    else if (s === "google" || s === "calendar") { out.add("google-calendar"); if (s === "calendar") out.add("outlook-calendar"); }
    else out.add(s);
  }
  return [...out];
}

const DONE = ["done", "closed", "closedlost", "closed lost", "lost", "completed", "canceled", "cancelled", "archived", "resolved", "won", "closedwon"];

function texts(vals: OpValue[]): string[] {
  return vals.flatMap((v) => (v.t === "text" ? [v.v] : v.t === "date" ? [v.v] : v.t === "cmp" ? [String(v.v)] : []));
}

function dateCond(col: SQL, v: OpValue, key: string): SQL | null {
  if (v.t === "date") {
    if (key === "before") return sql`${col} < ${v.resolved.from}::timestamptz`;
    if (key === "after") return sql`${col} >= ${v.resolved.from}::timestamptz`;
    return sql`(${col} >= ${v.resolved.from}::timestamptz and ${col} < ${v.resolved.to}::timestamptz)`;
  }
  if (v.t === "range" && v.from && v.to) return sql`(${col} >= ${v.from}::timestamptz and ${col} < ${v.to}::timestamptz)`;
  if (v.t === "cmp" && v.resolved) {
    const op = sql.raw(v.op);
    return sql`${col} ${op} ${v.resolved}::timestamptz`;
  }
  return null;
}

const DURING_START = sql`(case when i.kind = 'deal' then (i.facets->>'closeDate')::timestamptz when i.kind = 'task' then (i.facets->>'dueDate')::timestamptz else coalesce((i.facets->>'start')::timestamptz, i.occurred_at) end)`;
const DURING_END = sql`(case when i.kind = 'deal' then (i.facets->>'closeDate')::timestamptz when i.kind = 'task' then (i.facets->>'dueDate')::timestamptz else coalesce((i.facets->>'end')::timestamptz, i.occurred_at) end)`;

export interface BuiltFilters { where: SQL; entityIds: string[]; errors: string[] }

/**
 * `soft`: filters the box read from a sentence (D48), by their text ("with:globex.com").
 * A "with" read from words reaches a little further than a typed filter: "with Globex"
 * also finds items with someone who works at Globex, and "with Hannah" also finds an
 * item that names them but links no person at all (a note, a doc). "from" keeps the
 * sender's role: "from Priya" never lists a note that only mentions her.
 */
export async function buildFilters(ctx: EngineCtx, userId: string, parsed: ParsedQuery, opts: { scope?: ItemKind | "all"; soft?: Set<string> } = {}): Promise<BuiltFilters> {
  const conds: SQL[] = [sql`i.user_id = ${userId}`, sql`i.deleted_at is null`, sql`i.directory = false`];
  const entityIds: string[] = [];
  const errors: string[] = [];
  if (opts.scope && opts.scope !== "all") conds.push(sql`i.kind = ${opts.scope}`);
  const byKey = new Map<string, { values: OpValue[]; negate: boolean; raw: string }[]>();
  for (const c of parsed.clauses) if (c.kind === "op") { const a = byKey.get(c.key) ?? []; a.push({ values: c.values, negate: c.negate, raw: c.raw }); byKey.set(c.key, a); }

  for (const [key, groups] of byKey) {
    // same key ORs (positives), negated clauses each AND NOT
    const pos = groups.filter((g) => !g.negate).flatMap((g) => g.values);
    const neg = groups.filter((g) => g.negate).flatMap((g) => g.values);
    const build = async (vals: OpValue[]): Promise<SQL | null> => {
      const parts: SQL[] = [];
      switch (key) {
        case "source": {
          // in:#deals is the deals channel, the same as container:deals, on every surface (web, REST, MCP)
          const vs = texts(vals);
          const chans = vs.filter((v) => v.startsWith("#")).map((v) => v.slice(1).toLowerCase()).filter(Boolean);
          const ps = vs.filter((v) => !v.startsWith("#")).flatMap(platformsFor);
          if (ps.length) parts.push(sql`i.platform in (${sql.join(ps.map((p) => sql`${p}`), sql`, `)})`);
          for (const ch of chans) parts.push(sql`(lower(coalesce(i.container, '')) like ${"%" + ch + "%"})`);
          break;
        }
        case "type": { const ks = texts(vals).flatMap((t) => TYPE_ALIASES[t.toLowerCase()] ?? []); parts.push(ks.length ? sql`i.kind in (${sql.join(ks.map((k) => sql`${k}`), sql`, `)})` : sql`false`); break; }
        case "is": for (const t of texts(vals).map((x) => x.toLowerCase())) {
          if (t === "unread") parts.push(sql`(i.facets->>'unread') = 'true'`);
          else if (t === "vip") parts.push(sql`i.lane = 'vip'`);
          else if (t === "needs-you" || t === "needs_you") parts.push(sql`i.lane = 'needs_you'`);
          else if (t === "waiting") parts.push(sql`i.lane = 'waiting'`);
          else if (t === "mine") parts.push(sql`exists (select 1 from entity_links l join entities e on e.id = l.entity_id where l.item_id = i.id and e.is_self and l.role in ('owner','assignee','organizer','author','from'))`);
          else if (t === "open") parts.push(sql`(i.status is null or lower(i.status) not in (${sql.join(DONE.map((d) => sql`${d}`), sql`, `)}))`);
          else if (t === "upcoming") parts.push(sql`(i.kind = 'event' and coalesce((i.facets->>'start')::timestamptz, i.occurred_at) > now())`);
          else if (t === "past") parts.push(sql`i.occurred_at < now()`);
        } break;
        case "from": case "to": case "with": case "about": {
          const ids = (await Promise.all(texts(vals).map((t) => resolveEntityValue(ctx, userId, t)))).flat();
          entityIds.push(...ids);
          if (!ids.length) { parts.push(sql`false`); break; }
          const roles = ROLES[key];
          parts.push(roles
            ? sql`exists (select 1 from entity_links l where l.item_id = i.id and l.entity_id in (${sql.join(ids.map((x) => sql`${x}`), sql`, `)}) and l.role in (${sql.join(roles.map((r) => sql`${r}`), sql`, `)}))`
            : sql`exists (select 1 from entity_links l where l.item_id = i.id and l.entity_id in (${sql.join(ids.map((x) => sql`${x}`), sql`, `)}))`);
          break;
        }
        case "before": case "after": case "on": for (const v of vals) { const c = dateCond(sql`i.occurred_at`, v, key); if (c) parts.push(c); } break;
        case "updated": for (const v of vals) { const c = dateCond(sql`coalesce(i.updated_at, i.occurred_at)`, v, v.t === "cmp" ? "cmp" : "on"); if (c) parts.push(c); } break;
        case "during": for (const v of vals) {
          const r = v.t === "date" ? v.resolved : v.t === "range" ? { from: v.from, to: v.to } : null;
          // an event by its start and end; a deal by its close date and a task by its due date when it has one
          // a deal with no close date or a task with no due date is not "closing" or "due" in any range (polish item 6)
          if (r) parts.push(sql`(${DURING_START} < ${r.to}::timestamptz and ${DURING_END} >= ${r.from}::timestamptz)`);
        } break;
        case "has": for (const t of texts(vals).map((x) => x.toLowerCase())) {
          if (t === "attachment") parts.push(sql`(i.facets->>'hasAttachment') = 'true'`);
          else if (t === "link") parts.push(sql`i.body ~ 'https?://'`);
          else if (t === "joinurl") parts.push(sql`(i.facets ? 'joinUrl')`);
          else if (t === "transcript") parts.push(sql`(i.facets->>'hasTranscript') = 'true'`);
        } break;
        case "status": for (const t of texts(vals)) parts.push(sql`lower(coalesce(i.status, '')) like ${t.toLowerCase() + "%"}`); break;
        case "stage": for (const t of texts(vals)) parts.push(sql`(lower(coalesce(i.facets->>'stage', i.status, '')) like ${t.toLowerCase() + "%"})`); break;
        case "lane": for (const t of texts(vals)) parts.push(sql`i.lane = ${t.toLowerCase().replace("-", "_")}`); break;
        // which account of a platform (two Gmails): account:dana@acme.dev, or any part of it (account:acme.dev)
        case "account": { const ts = texts(vals).map((t) => `%${t.toLowerCase()}%`); if (ts.length) parts.push(sql`i.source_id in (select s.id from sources s where ${sql.join(ts.map((t) => sql`lower(s.connection_label) like ${t}`), sql` or `)})`); break; }
        case "label": for (const t of texts(vals)) parts.push(sql`exists (select 1 from unnest(i.labels) lb where lower(lb) = ${t.toLowerCase()})`); break;
        case "container": for (const t of texts(vals)) parts.push(sql`(lower(coalesce(i.container, '')) like ${"%" + t.toLowerCase() + "%"})`); break;
        case "amount": for (const v of vals) if (v.t === "cmp" && typeof v.v === "number") parts.push(sql`((i.facets->>'amount') ~ '^-?[0-9.]+$' and (i.facets->>'amount')::numeric ${sql.raw(v.op)} ${v.v})`); break;
        case "id": for (const t of texts(vals)) parts.push(sql`(i.id = ${t} or i.external_id = ${t} or lower(i.facets->>'key') = ${t.toLowerCase()})`); break;
      }
      return parts.length ? sql`(${sql.join(parts, sql` or `)})` : null;
    };
    let p = pos.length ? await build(pos) : null;
    const soft = groups.filter((g) => !g.negate && opts.soft?.has(g.raw)).flatMap((g) => g.values);
    // "from" honours the sender's role even when read from words ("from Priya" is never a note that
    // only mentions her); only "with" and "about" reach further (D48, final review 2026-11-12)
    if (p && soft.length && key === "with") {
      const more = await softReach(ctx, userId, texts(soft), ROLES[key]);
      if (more) p = sql`(${p} or ${more})`;
    }
    if (p) conds.push(p);
    if (neg.length) { const n = await build(neg); if (n) conds.push(sql`not ${n}`); }
  }
  return { where: sql.join(conds, sql` and `), entityIds: [...new Set(entityIds)], errors };
}

/** The extra reach of a name read from a sentence (see buildFilters). */
async function softReach(ctx: EngineCtx, userId: string, values: string[], roles: EntityRole[] | null): Promise<SQL | null> {
  const ids = (await Promise.all(values.map((t) => resolveEntityValue(ctx, userId, t)))).flat();
  if (!ids.length) return null;
  const ents = await rows<{ id: string; type: "person" | "company"; name: string }>(ctx, sql`select id, type, name from entities where id in (${sql.join(ids.map((x) => sql`${x}`), sql`, `)}) and not is_self`);
  const parts: SQL[] = [];
  const companies = ents.filter((e) => e.type === "company").map((e) => e.id);
  if (companies.length) {
    const roleCond = roles ? sql` and l.role in (${sql.join(roles.map((r) => sql`${r}`), sql`, `)})` : sql``;
    parts.push(sql`exists (select 1 from entity_links l join entities pe on pe.id = l.entity_id where l.item_id = i.id and pe.company_id in (${sql.join(companies.map((x) => sql`${x}`), sql`, `)})${roleCond})`);
  }
  // a person by first name, a company by its name, in an item that links no person
  const names = [...new Set(ents.map((e) => (e.type === "person" ? e.name.split(/\s+/)[0]! : e.name)).filter((n) => n.length > 1))];
  if (names.length) {
    const mention = sql.join(names.map((n) => sql`i.tsv @@ plainto_tsquery('english', ${n})`), sql` or `);
    parts.push(sql`(not exists (select 1 from entity_links lx join entities ex on ex.id = lx.entity_id where lx.item_id = i.id and ex.type = 'person') and (${mention}))`);
  }
  return parts.length ? sql`(${sql.join(parts, sql` or `)})` : null;
}

// ---------- the search ----------

interface ItemRowLite {
  id: string; kind: ItemKind; platform: string; source_id: string; title: string; snippet: string | null; body: string; url: string | null;
  container: string | null; group_key: string | null; status: string | null; facets: ItemFacets; occurred_at: Date | string; updated_at: Date | string | null;
  lane: Lane | null; importance: number | null;
}

const queries = new Map<string, { userId: string; q: string; at: number; ids: string[]; rows: ResultRow[]; understand: boolean; tz: string | null }>();

export function rememberedQuery(queryId: string): { userId: string; q: string; ids: string[]; rows: ResultRow[]; understand: boolean; tz: string | null } | null {
  const hit = queries.get(queryId);
  if (!hit || Date.now() - hit.at > 600_000) return null;
  return hit;
}

let trgm: boolean | null = null;
async function hasTrgm(ctx: EngineCtx): Promise<boolean> {
  if (trgm !== null) return trgm;
  const r = await rows<{ ok: boolean }>(ctx, sql`select exists (select 1 from pg_extension where extname = 'pg_trgm') as ok`);
  trgm = !!r[0]?.ok;
  return trgm;
}

/** At most this many items with a read sentence's leftover words, against many more under its filters alone: the filters' items follow them. */
export const FEW_WORD_HITS = 2;

/** Words too small to name as "the words no result had". */
const SMALL_WORDS = new Set(["a", "an", "the", "of", "to", "in", "on", "at", "by", "for", "from", "with", "about", "and", "or", "is", "are", "was", "it", "my", "me", "i", "this", "that"]);

function terms(text: string): string[] {
  return text.toLowerCase().replace(/"/g, " ").split(/\s+/).filter((w) => w && w !== "or" && !w.startsWith("-")).map((w) => w.replace(/[^a-z0-9@.'-]/g, "")).filter((w) => w.length >= 2);
}

export function highlights(s: string | null, ts: string[]): [number, number][] {
  if (!s || !ts.length) return [];
  const out: [number, number][] = [];
  const low = s.toLowerCase();
  for (const t of ts) {
    const stem = t.length > 4 ? t.slice(0, Math.max(4, t.length - 2)) : t;
    let i = 0;
    for (;;) {
      const j = low.indexOf(stem, i);
      if (j < 0) break;
      if (j === 0 || !/[a-z0-9]/.test(low[j - 1]!)) {
        let e = j + stem.length;
        while (e < low.length && /[a-z0-9]/.test(low[e]!)) e++;
        out.push([j, e]);
      }
      i = j + stem.length;
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const h of out) { const last = merged[merged.length - 1]; if (last && h[0] <= last[1]) last[1] = Math.max(last[1], h[1]); else merged.push([...h]); }
  return merged;
}

function iso(d: Date | string | null): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

export function contextFor(r: { kind: ItemKind; facets: ItemFacets; container: string | null; status: string | null }, people: string[]): string | null {
  const f = r.facets as Record<string, unknown>;
  switch (r.kind) {
    case "email_thread": return [people[0], f.messageCount && Number(f.messageCount) > 1 ? `(${f.messageCount})` : null].filter(Boolean).join(" ") || null;
    case "deal": return [f.stage ?? r.status, typeof f.amount === "number" || typeof f.amount === "string" ? `${f.currency && f.currency !== "USD" ? f.currency + " " : "$"}${Number(f.amount).toLocaleString("en-US")}` : null].filter(Boolean).join(" · ") || null;
    case "message": return [r.container, people[0]].filter(Boolean).join(" · ") || null;
    case "task": return [f.key, f.state ?? r.status].filter(Boolean).join(" · ") || null;
    case "person": return [f.jobTitle, f.companyName].filter(Boolean).join(" at ") || null;
    case "event": return (f.location as string | undefined) ?? null;
    default: return r.container ?? r.status ?? null;
  }
}

async function peopleFor(ctx: EngineCtx, ids: string[]): Promise<Map<string, ResultRow["people"]>> {
  const m = new Map<string, ResultRow["people"]>();
  if (!ids.length) return m;
  const r = await rows<{ item_id: string; entity_id: string; name: string; role: EntityRole; avatar_url: string | null }>(ctx, sql`
    select l.item_id, e.id as entity_id, e.name, l.role, e.avatar_url
    from entity_links l join entities e on e.id = l.entity_id
    where l.item_id in (${sql.join(ids.map((x) => sql`${x}`), sql`, `)}) and e.type = 'person' and e.merged_into_id is null
    order by case l.role when 'from' then 0 when 'author' then 1 when 'organizer' then 2 when 'is' then 3 else 4 end, e.is_self, e.name`);
  for (const x of r) {
    const a = m.get(x.item_id) ?? [];
    if (!a.some((p) => p.entityId === x.entity_id) && a.length < 6) a.push({ entityId: x.entity_id, name: x.name, role: x.role, avatarUrl: x.avatar_url });
    m.set(x.item_id, a);
  }
  return m;
}

type FusedEntry = FusedRank & { score: number; group: number; rerank?: number | null; alsoIn?: string[]; exact?: ResultRow["exact"] };

export async function toResultRows(ctx: EngineCtx, items: ItemRowLite[], fused: Map<string, FusedEntry>, ts: string[]): Promise<ResultRow[]> {
  const ppl = await peopleFor(ctx, items.map((i) => i.id));
  // a platform with two accounts (two Gmails) names the account: "Gmail · dana@acme.dev"
  const srcIds = [...new Set(items.map((i) => i.source_id))];
  const srcNames = new Map<string, string>();
  if (srcIds.length) {
    const src = await rows<{ id: string; platform: string; label: string | null; accounts: number }>(ctx, sql`
      select s.id, s.platform, s.connection_label as label,
        (select count(distinct o.connection_key)::int from sources o where o.user_id = s.user_id and o.platform = s.platform and o.connection_key not like 'pending:%') as accounts
      from sources s where s.id in (${sql.join(srcIds.map((x) => sql`${x}`), sql`, `)})`);
    for (const s of src) if (s.accounts > 1 && s.label) srcNames.set(s.id, `${platformName(s.platform)} · ${s.label}`);
  }
  return items.map((i) => {
    const f = fused.get(i.id);
    const people = ppl.get(i.id) ?? [];
    const sourceName = srcNames.get(i.source_id) ?? platformName(i.platform);
    return {
      id: i.id, kind: i.kind, platform: i.platform, sourceId: i.source_id, sourceName, logoUrl: logoUrl(i.platform),
      title: i.title, titleHighlights: highlights(i.title, ts),
      context: contextFor(i, people.filter((p) => p.role === "from" || p.role === "author" || p.role === "organizer").map((p) => p.name)),
      snippet: i.snippet, snippetHighlights: highlights(i.snippet, ts),
      occurredAt: iso(i.occurred_at)!, updatedAt: iso(i.updated_at), url: i.url, people, facets: i.facets, lane: i.lane, importance: i.importance,
      groupCount: f?.group ?? 1, ...(f?.alsoIn?.length ? { alsoIn: f.alsoIn } : {}), ...(f?.exact ? { exact: f.exact } : {}), score: f?.score ?? 0, ranks: { kw: f?.kw ?? null, vec: f?.vec ?? null, title: f?.title ?? null, rerank: f?.rerank ?? null },
    };
  });
}

async function entityStrip(ctx: EngineCtx, userId: string, text: string, named: string[]): Promise<EntityChip[]> {
  const ids = new Set(named.filter(Boolean));
  // "who is Priya Shah" names Priya Shah: the question words are not part of the name
  const nameText = withoutFiller(text);
  if (nameText.trim()) {
    const r = await rows<{ id: string }>(ctx, sql`
      select id from entities where user_id = ${userId} and merged_into_id is null and item_count > 0
        and tsv @@ plainto_tsquery('simple', search_unaccent(${nameText}))
      order by item_count desc limit 3`);
    for (const x of r) ids.add(x.id);
  }
  if (!ids.size) return [];
  return entityChips(ctx, [...ids].slice(0, 3));
}

export async function entityChips(ctx: EngineCtx, ids: string[]): Promise<EntityChip[]> {
  if (!ids.length) return [];
  const r = await rows<{ id: string; type: "person" | "company"; name: string; title: string | null; domain: string | null; avatar_url: string | null; company: string | null; is_self: boolean; primary_email: string | null }>(ctx, sql`
    select e.id, e.type, e.name, e.title, e.domain, e.avatar_url, e.is_self, e.primary_email, c.name as company
    from entities e left join entities c on c.id = e.company_id
    where e.id in (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`);
  const order = new Map(ids.map((x, i) => [x, i]));
  // the card says what the page it opens says: one count, one place (entity-items.ts)
  const stats = await entityItemStats(ctx, r.map((e) => e.id));
  return r.sort((a, b) => order.get(a.id)! - order.get(b.id)!).map((e) => ({
    id: e.id, type: e.type, name: e.name, subtitle: e.type === "person" ? [e.title, e.company].filter(Boolean).join(", ") || null : e.domain,
    avatarUrl: e.avatar_url, logoUrl: null, itemCount: stats.get(e.id)?.count ?? 0, sources: stats.get(e.id)?.platforms ?? [], isSelf: !!e.is_self, email: e.primary_email,
  }));
}

// ---------- exact matches, people, typos (D42, D43) ----------

const EMAIL_RE = /^[^\s@"]+@[^\s@"]+\.[a-z]{2,}$/i;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
/** An external id looks like a key: one token with a digit in it (ACME-311, ENG-1210, INV-0042). */
const ID_RE = /^[a-z0-9][\w.:#/-]*\d[\w.:#/-]*$/i;

export interface ExactHit { itemIds: string[]; entityIds: string[]; why: NonNullable<ResultRow["exact"]> | null }

/** The text the exact lane reads: one quoted phrase, or the free words when there are 1 to 5. */
export function exactTarget(parsed: ParsedQuery): string | null {
  const free = parsed.clauses.filter((c) => c.kind === "word" || c.kind === "phrase");
  if (!free.length || free.some((c) => (c as { negate: boolean }).negate) || parsed.clauses.some((c) => c.kind === "or")) return null;
  const phrases = free.filter((c) => c.kind === "phrase");
  if (phrases.length === 1 && free.length === 1) return (phrases[0] as { value: string }).value.trim() || null;
  if (phrases.length) return null;
  // "who is Priya Shah" looks for Priya Shah
  const t = withoutFiller(free.map((c) => (c as { value: string }).value).join(" ").trim());
  return t && t.split(/\s+/).length <= 5 ? t : null;
}

/** Items to put ahead of fusion: the record of the person or company an email, domain or whole name names, or an item by its external id. */
export async function exactLane(ctx: EngineCtx, userId: string, target: string, where: SQL): Promise<ExactHit> {
  const v = target.trim().toLowerCase();
  const none: ExactHit = { itemIds: [], entityIds: [], why: null };
  if (!v) return none;
  const keyed = async (key: string) => (await rows<{ id: string }>(ctx, sql`select e.id from entity_keys k join entities e on e.id = k.entity_id where k.user_id = ${userId} and k.key = ${key} and e.merged_into_id is null`)).map((r) => r.id);
  let entityIds: string[] = [];
  let why: ExactHit["why"] = null;
  if (EMAIL_RE.test(v)) { entityIds = await keyed(`email:${v}`); why = "email"; }
  else if (DOMAIN_RE.test(v) && !/\s/.test(v)) { entityIds = await keyed(`domain:${v.replace(/^www\./, "")}`); why = "domain"; }
  let itemIds: string[] = [];
  if (!entityIds.length && ID_RE.test(v) && !EMAIL_RE.test(v)) {
    itemIds = (await rows<{ id: string }>(ctx, sql`select i.id from items i where ${where} and (lower(i.external_id) = ${v} or lower(i.facets->>'key') = ${v}) order by i.occurred_at desc limit 5`)).map((r) => r.id);
    if (itemIds.length) return { itemIds, entityIds: [], why: "id" };
  }
  if (!entityIds.length && /[a-z]/.test(v) && v.split(/\s+/).length >= 2 && !EMAIL_RE.test(v)) {
    entityIds = (await rows<{ id: string }>(ctx, sql`select id from entities where user_id = ${userId} and merged_into_id is null and item_count > 0 and lower(name) = ${v} order by item_count desc limit 3`)).map((r) => r.id);
    why = entityIds.length ? "name" : null;
  }
  if (!entityIds.length) return none;
  // the person's or company's own records (role is), the busiest platform first
  itemIds = (await rows<{ id: string }>(ctx, sql`
    select i.id from entity_links l join items i on i.id = l.item_id
    where l.entity_id in (${sql.join(entityIds.map((x) => sql`${x}`), sql`, `)}) and l.role = 'is' and ${where}
    order by case ${sql.join(entityIds.map((x, n) => sql`when l.entity_id = ${x} then ${n}`), sql` `)} else ${entityIds.length} end, i.updated_at desc nulls last limit 10`)).map((r) => r.id);
  return { itemIds, entityIds, why };
}

/** Did you mean: the entity whose name is closest to a 1 to 3 word text (pg_trgm), when nothing named one. */
export async function nearestEntity(ctx: EngineCtx, userId: string, text: string): Promise<string | null> {
  const v = text.trim().toLowerCase().replace(/"/g, "");
  const n = v.split(/\s+/).filter(Boolean).length;
  if (n < 1 || n > 3 || v.length < 4 || !/[a-z]/.test(v) || !(await hasTrgm(ctx))) return null;
  const r = await rows<{ id: string; lname: string }>(ctx, sql`
    select id, lower(name) as lname from entities where user_id = ${userId} and merged_into_id is null and item_count > 0
      and similarity(lower(name), ${v}) >= ${DID_YOU_MEAN_MIN}
    order by similarity(lower(name), ${v}) desc, item_count desc limit 1`);
  return r[0] && r[0].lname !== v ? r[0].id : null;
}

/** Edit distance with one swap of two neighbours counting as one edit (Damerau, optimal string alignment). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
  }
  return d[a.length]![b.length]!;
}

/**
 * Did you mean, by spelling: a one-word text one or two edits from a person's first name
 * or a company name ("Prya" is Priya Shah), the busiest first. Trigrams miss short names.
 */
export function nearestByName(entities: { id: string; type: string; name: string; itemCount?: number; isSelf?: boolean }[], text: string): string | null {
  const v = fold(text.trim().replace(/"/g, ""));
  if (!/^[\p{L}'-]{4,}$/u.test(v)) return null;
  const max = v.length >= 7 ? 2 : 1;
  let best: { id: string; n: number } | null = null;
  for (const e of entities) {
    if (e.isSelf) continue;
    const words = fold(e.name).split(/\s+/);
    const key = e.type === "person" ? words[0]! : fold(e.name);
    if (key === v || words.includes(v)) return null; // the text is a name already
    if (Math.abs(key.length - v.length) > max || editDistance(key, v) > max) continue;
    if (!best || (e.itemCount ?? 0) > best.n) best = { id: e.id, n: e.itemCount ?? 0 };
  }
  return best?.id ?? null;
}

/** Companies' names, folded, for telling that two deals with one title name the same company. */
async function companyNames(ctx: EngineCtx, userId: string): Promise<string[]> {
  return (await vocabFor(ctx, userId)).entities.filter((e) => e.type === "company").map((e) => normTitle(e.name)).filter((n) => n.length > 2);
}

const normTitle = (t: string) => fold(t).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Two records that are clearly one thing kept in two tools: a deal (or a doc page) with the
 * same title that names one of the person's companies ("Hooli design partner" in Attio and
 * in HubSpot). Null when there is nothing safe to fold by. Only folded across platforms.
 */
export function sameRecordKey(it: { kind: string; title: string }, companies: string[]): string | null {
  if (it.kind !== "deal") return null;
  const t = normTitle(it.title);
  if (!t || !companies.some((c) => new RegExp(`(^| )${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(t))) return null;
  return `${it.kind}\u0000${t}`;
}

/**
 * One row per person or company and per record kept in two tools, the first row kept and
 * the others as its "also in" badges: for lists that do not come from a search (a person's
 * or company's own timeline).
 */
export async function collapseSame(ctx: EngineCtx, userId: string, rows: ResultRow[]): Promise<ResultRow[]> {
  const ents = await recordEntities(ctx, rows.filter((r) => r.kind === "person" || r.kind === "company").map((r) => r.id));
  const companies = await companyNames(ctx, userId);
  const seen = new Map<string, ResultRow>();
  const out: ResultRow[] = [];
  for (const r of rows) {
    const e = ents.get(r.id);
    const key = e ? `e\u0000${e.entityId}` : sameRecordKey(r, companies);
    const best = key ? seen.get(key) : undefined;
    if (best && (e || best.platform !== r.platform)) {
      if (r.platform !== best.platform && !(best.alsoIn ?? []).includes(r.platform)) best.alsoIn = [...(best.alsoIn ?? []), r.platform];
      best.groupCount = (best.groupCount ?? 1) + 1;
      continue;
    }
    const copy = { ...r };
    if (key && !best) seen.set(key, copy);
    out.push(copy);
  }
  return out;
}

/** For person and company items: which entity each one is, and whether anything but records mentions it. */
async function recordEntities(ctx: EngineCtx, ids: string[]): Promise<Map<string, { entityId: string; lone: boolean }>> {
  const m = new Map<string, { entityId: string; lone: boolean }>();
  if (!ids.length) return m;
  const r = await rows<{ item_id: string; entity_id: string; lone: boolean }>(ctx, sql`
    select distinct on (l.item_id) l.item_id, l.entity_id,
      not exists (select 1 from entity_links l2 join items j on j.id = l2.item_id where l2.entity_id = l.entity_id and j.kind not in ('person', 'company') and j.deleted_at is null and j.directory = false) as lone
    from entity_links l join entities e on e.id = l.entity_id
    where l.item_id in (${sql.join(ids.map((x) => sql`${x}`), sql`, `)}) and l.role = 'is' and e.merged_into_id is null
    order by l.item_id, e.item_count desc`);
  for (const x of r) m.set(x.item_id, { entityId: x.entity_id, lone: !!x.lone });
  return m;
}

/** The whole text as words, lowercased, for the exact title test. */
function phraseOf(parsed: ParsedQuery): string | null {
  const ph = parsed.clauses.find((c) => c.kind === "phrase" && !c.negate) as { value: string } | undefined;
  if (ph) return ph.value.toLowerCase().replace(/\s+/g, " ").trim() || null;
  const words = parsed.clauses.filter((c) => c.kind === "word" && !c.negate).map((c) => (c as { value: string }).value.toLowerCase());
  return words.length >= 2 && !parsed.clauses.some((c) => c.kind === "or") ? words.join(" ") : null;
}

export function titleBonus(title: string, phrase: string | null): number {
  if (!phrase) return 0;
  const t = title.toLowerCase().replace(/\s+/g, " ").trim();
  if (t === phrase) return EXACT_TITLE_BONUS;
  const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`).test(t) ? EXACT_TITLE_BONUS / 2 : 0;
}

export async function hybridSearch(ctx: EngineCtx, userId: string, req: SearchRequest, inner = false): Promise<SearchResponse> {
  const t0 = Date.now();
  // plain phrases to filters (D48): only the searched query changes, never the box text
  let understanding: ReturnType<typeof understandQuery> | null = null;
  if (req.understand && (req.q ?? "").trim()) {
    const vocab = await vocabFor(ctx, userId);
    understanding = understandQuery(req.q, vocab, { now: ctx.now(), tz: req.tz, extra: await vocabExtra(ctx, userId, req.q, vocab) });
  }
  const searchedAs = understanding ? understanding.query : (req.q ?? "").trim();
  const parsed = parseQuery(searchedAs, ctx.now(), req.tz);
  const limit = Math.max(1, Math.min(req.limit ?? 30, 200));
  const offset = Math.max(0, req.offset ?? 0);
  const soft = new Set((understanding?.understood ?? []).filter((u) => u.kind === "person" || u.kind === "company").map((u) => u.filter));
  const read = !!understanding?.understood.length;
  const filters = await buildFilters(ctx, userId, parsed, { scope: req.scope, soft });
  const unscoped = req.scope && req.scope !== "all" ? await buildFilters(ctx, userId, parsed, { soft }) : filters;
  const text = parsed.text;
  let hasText = /[a-z0-9]/i.test(text.replace(/\bOR\b/g, ""));
  const hadText = hasText;
  // what a read sentence leaves can be only small words ("where are we" of "where are we with
  // Globex"): nothing to match, so the filters list on their own instead of finding nothing (D48)
  if (hasText && understanding?.understood.length) {
    const r = await rows<{ empty: boolean }>(ctx, sql`select websearch_to_tsquery('english', ${text})::text = '' as empty`);
    if (r[0]?.empty) hasText = false;
  }
  const settings = await ctx.settingsFor(userId);
  const sample = (await rows<{ s: boolean }>(ctx, sql`select is_sample as s from users where id = ${userId}`))[0]?.s ?? false;
  const embedder = pickEmbedder(settings, sample ? "fixture" : "connect");
  const ts = terms(text);

  let fused: FusedRank[] = [];
  let candidateWhere: SQL = filters.where;
  let status = { model: embedder.id, semantic: false, reason: null, platform: null, message: null } as SearchResponse["embedder"];
  let fallback: SearchResponse["fallback"] = null;
  let kwText = text;
  let exact: ExactHit = { itemIds: [], entityIds: [], why: null };
  let didYouMean: string | null = null;
  let andEmpty = false;
  if (hasText) {
    const kwFor = (q: string) => rows<{ id: string }>(ctx, sql`
      with q as (select websearch_to_tsquery('english', ${q}) as tq)
      select i.id from items i cross join q
      left join lateral (select max(ts_rank_cd(ch.tsv, q.tq)) as r from chunks ch where ch.item_id = i.id and ch.tsv @@ q.tq) c on true
      where ${filters.where} and (i.tsv @@ q.tq or c.r is not null)
      order by greatest(ts_rank_cd(i.tsv, q.tq, 1), coalesce(c.r, 0)) desc, i.occurred_at desc
      limit 100`);
    let kw = await kwFor(text);
    andEmpty = kw.length === 0;
    // meaning reads the whole sentence when names were read from it ("contract review with Globex"
    // keeps Globex in the meaning while the filter keeps it in the links), else what is left
    const qv = await embedQueryWithStatus(ctx, userId, soft.size ? req.q : text, { fresh: req.fresh });
    status = qv.status;
    let vec: { id: string }[] = [];
    if (qv.vector) {
      vec = await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`set local hnsw.iterative_scan = relaxed_order`);
        const r = await tx.execute(sql`
          select item_id as id from (
            select ch.item_id, min(e.embedding <=> ${vectorLiteral(qv.vector!)}::vector) as d
            from chunk_embeddings e join chunks ch on ch.id = e.chunk_id join items i on i.id = ch.item_id
            where e.user_id = ${userId} and e.model = ${embedder.id} and ${filters.where}
            group by ch.item_id having min(e.embedding <=> ${vectorLiteral(qv.vector!)}::vector) < ${VEC_MAX_DISTANCE} order by d limit 100) t`);
        return r.rows as { id: string }[];
      });
    }
    // every word together found nothing and no semantic arm can stand in: any of the words (D44).
    // A read sentence tries it even with meaning on, since its filters already narrow the page.
    if (!kw.length && ts.length >= 2 && (!status.semantic || read)) {
      const orText = ts.join(" or ");
      const kw2 = await kwFor(orText);
      if (kw2.length) { kw = kw2; kwText = orText; fallback = "or"; }
    }
    let title: { id: string }[] = [];
    if (ts.length >= 1 && ts.length <= 3 && (await hasTrgm(ctx))) {
      title = await rows<{ id: string }>(ctx, sql`
        select i.id from items i where ${filters.where} and similarity(lower(i.title), ${ts.join(" ")}) > 0.3
        order by similarity(lower(i.title), ${ts.join(" ")}) desc limit 20`);
    }
    const target = exactTarget(parsed);
    if (target) exact = await exactLane(ctx, userId, target, filters.where);
    fused = fuseRanks(kw.map((r) => r.id), vec.map((r) => r.id), title.map((r) => r.id));
    for (const id of exact.itemIds) if (!fused.some((f) => f.id === id)) fused.push({ id, kw: null, vec: null, title: null, rrf: 0 });
    candidateWhere = sql`i.id in (${fused.length ? sql.join(fused.map((f) => sql`${f.id}`), sql`, `) : sql`null`})`;
  }
  // a read sentence whose leftover words matched nothing under its filters: list what the filters
  // match and say so, rather than an empty page the same words never gave without the filters (D48)
  let unmatched: string | null = null;
  // one or two items had the words while the filters alone hold many more ("lunch with Anika"
  // finds only her record): those come first, then everything else the filters match
  let wordHits: string[] = [];
  if (hasText && read && fused.length > 0 && fused.length <= FEW_WORD_HITS) {
    const n = (await rows<{ n: number }>(ctx, sql`select count(*)::int as n from (select 1 from items i where ${filters.where} limit 60) t`))[0]?.n ?? 0;
    if (n >= Math.max(6, fused.length * 3)) wordHits = fused.map((f) => f.id);
  }
  if (hasText && read && (!fused.length || wordHits.length)) {
    unmatched = ts.filter((w) => !SMALL_WORDS.has(w)).join(" ") || text.trim();
    hasText = false;
    fused = [];
    kwText = text;
  }
  if (!hasText) {
    candidateWhere = filters.where;
    if (!unmatched) status = await semanticStatus(ctx, userId);
  }

  // items for the candidates (text) or the newest N (filters only)
  let ordered = hasText
    ? fused.length ? await rows<ItemRowLite>(ctx, sql`select i.* from items i where ${candidateWhere}`) : []
    : await rows<ItemRowLite>(ctx, sql`select i.* from items i where ${filters.where} order by i.occurred_at ${req.sort === "oldest" ? sql`asc` : sql`desc`} limit 500`);

  if (unmatched && ordered.length) fallback = "filters";
  else if (unmatched) unmatched = null;

  // named-entity boost
  const named = new Set(filters.entityIds);
  const textEntityIds = hasText ? (await rows<{ id: string }>(ctx, sql`select id from entities where user_id = ${userId} and merged_into_id is null and tsv @@ plainto_tsquery('simple', search_unaccent(${text})) limit 20`)).map((r) => r.id) : [];
  for (const id of textEntityIds) named.add(id);
  for (const id of exact.entityIds) named.add(id);
  // a misspelt name: offer the closest entity and bring its own records in (D43)
  // only when every word together found nothing: a misspelt name, never a name plus a topic ("globex renewal")
  if (hasText && andEmpty && !named.size && !filters.entityIds.length && !exact.why && !/\d/.test(text)) {
    didYouMean = await nearestEntity(ctx, userId, text) ?? nearestByName((await vocabFor(ctx, userId)).entities, text);
    if (didYouMean) {
      named.add(didYouMean);
      const own = await rows<ItemRowLite>(ctx, sql`select i.* from items i join entity_links l on l.item_id = i.id where l.entity_id = ${didYouMean} and l.role = 'is' and ${filters.where} limit 5`);
      for (const it of own) if (!ordered.some((o) => o.id === it.id)) { ordered.push(it); fused.push({ id: it.id, kw: null, vec: null, title: 1, rrf: 0.5 / (RRF_K + 1) }); }
      if (own.length) candidateWhere = sql`i.id in (${sql.join(fused.map((f) => sql`${f.id}`), sql`, `)})`;
    }
  }
  const linked = new Set<string>();
  if (named.size && ordered.length) {
    const r = await rows<{ item_id: string }>(ctx, sql`select distinct item_id from entity_links where entity_id in (${sql.join([...named].map((x) => sql`${x}`), sql`, `)}) and item_id in (${sql.join(ordered.map((o) => sql`${o.id}`), sql`, `)})`);
    for (const x of r) linked.add(x.item_id);
  }
  // text queries: every record of one person or company is one row; a filter listing (type:person,
  // a lane) keeps one row per record, matching the counts its tools show
  const people = hasText || unmatched ? await recordEntities(ctx, ordered.filter((o) => o.kind === "person" || o.kind === "company").map((o) => o.id)) : new Map<string, { entityId: string; lone: boolean }>();
  const companies = await companyNames(ctx, userId);
  const phrase = hasText ? phraseOf(parsed) : null;
  const pinned = new Map(exact.itemIds.map((id, i) => [id, i]));
  const now = ctx.now().getTime();
  const fusedById = new Map(fused.map((f) => [f.id, f]));
  const fusedMap = new Map<string, FusedEntry>();
  for (const it of ordered) {
    const f = fusedById.get(it.id) ?? { id: it.id, kw: null, vec: null, title: null, rrf: 0 };
    const age = (now - new Date(it.occurred_at).getTime()) / 86_400_000;
    let score = hasText ? boostScore(f.rrf + titleBonus(it.title, phrase), it.importance, age, linked.has(it.id)) : 0;
    if (hasText && people.get(it.id)?.lone) score *= LONE_RECORD_WEIGHT;
    fusedMap.set(it.id, { ...f, score, group: 1, ...(pinned.has(it.id) ? { exact: exact.why } : {}) });
  }
  let list = [...ordered];
  // how many of the words each row has (question words left out): in a fallback, rows with more of them come first
  const covTerms = [...new Set(terms(withoutFiller(text)).filter((w) => !SMALL_WORDS.has(w)))].slice(0, 8);
  const coverage = new Map<string, number>();
  if ((unmatched || fallback === "or") && covTerms.length && ordered.length) {
    const r = await rows<{ id: string; c: number }>(ctx, sql`select i.id, (${sql.join(covTerms.map((t) => sql`(i.tsv @@ plainto_tsquery('english', ${t}))::int`), sql` + `)}) as c from items i where i.id in (${sql.join(ordered.map((o) => sql`${o.id}`), sql`, `)})`);
    for (const x of r) coverage.set(x.id, Number(x.c));
  }
  const cov = (id: string) => coverage.get(id) ?? 0;
  if (wordHits.length) {
    const first = wordHits.map((id) => list.find((x) => x.id === id)).filter((x): x is ItemRowLite => !!x);
    list = [...first, ...list.filter((x) => !wordHits.includes(x.id))];
    for (const it of first) { const f = fusedMap.get(it.id); if (f) f.score = 1; }
  }
  // the filters fallback: after the rows with every word, the rows with more of the words, then the newest
  if (unmatched && coverage.size) {
    const head = list.slice(0, wordHits.length);
    const rest = list.slice(wordHits.length).sort((a, b) => cov(b.id) - cov(a.id) || +new Date(b.occurred_at) - +new Date(a.occurred_at));
    list = [...head, ...rest];
  }
  if (hasText) {
    if (req.sort === "newest") list.sort((a, b) => +new Date(b.occurred_at) - +new Date(a.occurred_at));
    else if (req.sort === "oldest") list.sort((a, b) => +new Date(a.occurred_at) - +new Date(b.occurred_at));
    else list.sort((a, b) => {
      const pa = pinned.get(a.id), pb = pinned.get(b.id);
      if (pa !== undefined || pb !== undefined) return (pa ?? Infinity) - (pb ?? Infinity);
      // any of the words: a row with more of them first ("Felix wants ..." before "Owen wants ...")
      if (fallback === "or" && cov(a.id) !== cov(b.id)) return cov(b.id) - cov(a.id);
      return fusedMap.get(b.id)!.score - fusedMap.get(a.id)!.score || +new Date(b.occurred_at) - +new Date(a.occurred_at);
    });
  }
  // group: items sharing group_key within a source collapse to the best one,
  // and every record of one person or company collapses to its best row (D43)
  // and one record kept in two tools (the same deal in two CRMs) is one row with the other as a badge
  const seenGroups = new Map<string, string>();
  const seenEntity = new Map<string, string>();
  const seenRecord = new Map<string, string>();
  const collapsed: { kind: ItemKind; platform: string }[] = [];
  const grouped: ItemRowLite[] = [];
  const fold2 = (best: string, it: ItemRowLite) => {
    const b = fusedMap.get(best)!;
    const bestRow = grouped.find((g) => g.id === best);
    if (it.platform !== bestRow?.platform && !(b.alsoIn ?? []).includes(it.platform)) b.alsoIn = [...(b.alsoIn ?? []), it.platform];
    b.group++;
    collapsed.push({ kind: it.kind, platform: it.platform });
  };
  for (const it of list) {
    if (it.group_key) {
      const g = `${it.source_id}\u0000${it.group_key}`;
      const best = seenGroups.get(g);
      // folded into its group's best row: the counts drop it too, so a tab or lane count never says one more than the list
      if (best) { fusedMap.get(best)!.group++; collapsed.push({ kind: it.kind, platform: it.platform }); continue; }
      seenGroups.set(g, it.id);
    }
    const ent = people.get(it.id);
    if (ent) {
      const best = seenEntity.get(ent.entityId);
      if (best) { fold2(best, it); continue; }
      seenEntity.set(ent.entityId, it.id);
    }
    const rk = sameRecordKey(it, companies);
    if (rk) {
      const best = seenRecord.get(rk);
      const bestRow = best ? grouped.find((g) => g.id === best) : undefined;
      if (best && bestRow && bestRow.platform !== it.platform && !(fusedMap.get(best)!.alsoIn ?? []).includes(it.platform)) { fold2(best, it); continue; }
      if (!best) seenRecord.set(rk, it.id);
    }
    grouped.push(it);
  }

  // counts over the unscoped candidate set
  const countWhere = hasText ? sql`${unscoped.where} and ${candidateWhere}` : unscoped.where;
  const cr = await rows<{ kind: ItemKind; platform: string; n: number }>(ctx, sql`select i.kind, i.platform, count(*)::int as n from items i where ${countWhere} group by 1, 2`);
  const scope: Record<string, number> = { all: 0 };
  const source: Record<string, number> = {};
  for (const r of cr) { scope[r.kind] = (scope[r.kind] ?? 0) + r.n; scope.all! += r.n; source[r.platform] = (source[r.platform] ?? 0) + r.n; }
  // the counts match the rows: a record folded into another one is not counted twice
  for (const c of collapsed) {
    if ((scope[c.kind] ?? 0) > 0) { scope[c.kind]!--; scope.all!--; }
    if ((source[c.platform] ?? 0) > 0) source[c.platform]!--;
  }
  // what each filter hides is what dropping it adds, measured by running the very search the Drop
  // button runs (the same scope, the same reading), so the number on the page never disagrees with
  // the page it opens, in any mode: plain, any of the words, or the filters fallback
  let hiddenByFilters = 0;
  let hiddenBy: NonNullable<SearchResponse["hiddenBy"]> = [];
  const groups = inner ? [] : filterGroups(parsed, understanding?.understood ?? []);
  if (groups.length && (hadText || !grouped.length) && groups.length <= 6) {
    const totalOf = async (q: string) => (await hybridSearch(ctx, userId, { ...req, q, limit: 1, offset: 0 }, true)).total;
    for (const g of groups) {
      const n = (await totalOf(dropFilterText(req.q, g))) - grouped.length;
      if (n > 0) hiddenBy.push({ ...g, n });
    }
    hiddenBy.sort((a, b) => b.n - a.n);
    // every filter at once: one number for "Clear all", and with one filter it is that filter's own
    if (groups.length === 1) hiddenByFilters = hiddenBy[0]?.n ?? 0;
    else if (hadText) hiddenByFilters = Math.max(0, (await totalOf(wordsOnlyText(req.q, understanding?.understood ?? []))) - grouped.length);
  }

  // "deals closing this quarter": the deals with no close date are not in any range, and the page says how many
  let undated: SearchResponse["undated"] = undefined;
  if (!inner && parsed.clauses.some((c) => c.kind === "op" && c.key === "during" && !c.negate)) {
    const others = await buildFilters(ctx, userId, { ...parsed, clauses: parsed.clauses.filter((c) => !(c.kind === "op" && c.key === "during")) }, { scope: req.scope, soft });
    const r = await rows<{ kind: string; title: string }>(ctx, sql`select i.kind, i.title from items i where ${others.where} and ((i.kind = 'deal' and (i.facets->>'closeDate') is null) or (i.kind = 'task' and (i.facets->>'dueDate') is null)) limit 500`);
    // a copy of a listed deal kept in another tool (no close date there) is that deal, not one more without a date
    const dated = await rows<{ kind: string; title: string }>(ctx, sql`select i.kind, i.title from items i where ${others.where} and i.kind = 'deal' and (i.facets->>'closeDate') is not null limit 500`);
    const listed = new Set(dated.map((g) => sameRecordKey(g, companies)).filter(Boolean));
    const left = r.filter((x) => { const k = sameRecordKey(x, companies); return !k || !listed.has(k); });
    const deals = left.filter((x) => x.kind === "deal").length, tasks = left.filter((x) => x.kind === "task").length;
    if (deals || tasks) undated = { deals, tasks };
  }

  // the rows the words match best, then a divider before the rest (collapsed in the web app)
  let topRows = 0;
  let restLabel: string | undefined;
  if (wordHits.length) topRows = grouped.filter((g) => wordHits.includes(g.id)).length;
  else if (fallback === "or" && coverage.size && covTerms.length >= 2) {
    const best = Math.max(...grouped.map((g) => cov(g.id)));
    if (best >= 2) { let n = 0; while (n < grouped.length && cov(grouped[n]!.id) === best) n++; topRows = n; }
  }
  if (topRows > 0 && topRows < grouped.length) restLabel = fallback === "or" ? "Results with fewer of your words" : restLabelOf(understanding?.understood ?? []);
  else topRows = 0;

  const page = grouped.slice(offset, offset + limit);
  const results = await toResultRows(ctx, page, fusedMap, fallback ? terms(text) : ts);
  const queryId = newId("q");
  // rerank asks Jev about the person's own words (the whole sentence reads better than what is left of it)
  if (!inner) queries.set(queryId, { userId, q: req.q, at: Date.now(), ids: grouped.slice(0, 100).map((g) => g.id), rows: results, understand: !!req.understand, tz: req.tz ?? null });
  if (queries.size > 500) { const first = queries.keys().next().value; if (first) queries.delete(first); }
  const dated = parsed.clauses.some((c) => c.kind === "op" && DATE_KEYS.has(c.key));
  return {
    queryId, parsed, total: grouped.length, hiddenByFilters, hiddenBy, unmatched, ...(wordHits.length ? { matchedWords: wordHits.length } : {}),
    ...(topRows && offset === 0 ? { topRows, restLabel } : {}), ...(undated ? { undated } : {}),
    understanding: !!req.understand, understood: understanding?.understood ?? [], suggestions: understanding?.suggestions ?? [], searchedAs,
    counts: { scope: scope as SearchResponse["counts"]["scope"], source },
    entities: await entityStrip(ctx, userId, hasText ? text : "", [...exact.entityIds, ...filters.entityIds, ...(didYouMean ? [didYouMean] : [])]),
    results, mode: ctx.capability.mode, embedder: status,
    fallback, dateProposals: hasText && !dated && !req.understand ? proposeDates(text, ctx.now(), req.tz) : [],
    didYouMean: didYouMean ? (await entityChips(ctx, [didYouMean]))[0] ?? null : null,
    ms: Date.now() - t0,
  };
}

/** "Other messages in Slack", "Other results from Owen Price": the divider before the rows the words did not match. */
export function restLabelOf(understood: { kind: string; label: string }[]): string {
  const lower = (l: string) => l.charAt(0).toLowerCase() + l.slice(1);
  const type = understood.find((u) => u.kind === "type");
  const noun = type ? lower(type.label) : "results";
  const quals = understood.filter((u) => u.kind === "source" || u.kind === "person" || u.kind === "company" || u.kind === "state").map((u) => u.kind === "state" ? `(${lower(u.label)})` : lower(u.label));
  const dates = understood.filter((u) => u.kind === "date").map((u) => `(${u.label})`);
  return ["Other", noun, ...quals, ...dates].join(" ");
}

type FilterGroup = { label: string; filter: string; phrase: string | null; start: number | null; end: number | null };

/** The filters of a search as the page names them: a read phrase is one ("last week" is after: and before:), a typed one its own text. */
export function filterGroups(parsed: ParsedQuery, understood: { phrase: string; start: number; end: number; filter: string; label: string }[]): FilterGroup[] {
  const ops = parsed.clauses.filter((c) => c.kind === "op" && !c.negate) as Extract<ParsedQuery["clauses"][number], { kind: "op" }>[];
  const groups: FilterGroup[] = [];
  const taken = new Set<string>();
  for (const u of understood) {
    const raws = u.filter.split(" ").filter((r) => ops.some((o) => o.raw === r));
    if (!raws.length) continue;
    for (const r of raws) taken.add(r);
    groups.push({ label: u.label, filter: u.filter, phrase: u.phrase, start: u.start, end: u.end });
  }
  for (const o of ops) if (!taken.has(o.raw)) { taken.add(o.raw); groups.push({ label: o.raw, filter: o.raw, phrase: null, start: null, end: null }); }
  return groups;
}

/** The box without one filter, exactly as the page's Drop button writes it: a read phrase stays as its words, a typed filter comes out. */
export function dropFilterText(q: string, g: FilterGroup): string {
  if (g.phrase !== null && g.start !== null && g.end !== null) return keepWords(q, [{ phrase: g.phrase, start: g.start, end: g.end }]);
  return q.split(/(\s+)/).filter((w) => w.trim() !== g.filter).join("").replace(/\s+/g, " ").trim();
}

/** The box with every filter gone, as "Clear all" writes it: typed ones dropped, read ones kept as their words. */
export function wordsOnlyText(q: string, understood: { phrase: string; start: number; end: number }[]): string {
  const p = parseQuery(keepWords(q, understood));
  return formatQuery({ ...p, clauses: p.clauses.filter((c) => c.kind === "word" || c.kind === "phrase") });
}

/** Filters-only count for a query (refinement chips). */
export async function countOnly(ctx: EngineCtx, userId: string, query: string, opts: { understand?: boolean; tz?: string } = {}): Promise<number> {
  const r = await hybridSearch(ctx, userId, { q: query, limit: 1, ...opts });
  return r.total;
}
