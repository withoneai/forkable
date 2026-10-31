// Deterministic entity resolution inside a run (SPEC 8.1): people by email, companies by
// registrable domain (free mail and the user's own domains excluded), CRM `is` records,
// external directory ids, self across connections, name-only refs flagged for matching.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NormalizedItem, ResolvedRef, ResolvedIs } from "../contract.js";
import type { Tx } from "../db/client.js";
import { entities, entityKeys, entityLinks } from "../db/schema.js";
import { decodeDomain, isFreeMail, nameFromEmail } from "../decode/address.js";
import { newId } from "../ids.js";

export interface ResolveEnv {
  userId: string;
  sourceId: string;
  platform: string;
  selfEmails: Set<string>;
  selfDomains: Set<string>;
  selfExts?: Set<string>;
  ignoreDomains: Set<string>;
  now: Date;
}

type Entity = typeof entities.$inferSelect;

export function normName(n: string): string {
  return n.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 .'-]/g, " ").replace(/\s+/g, " ").trim();
}

function companyNameFromDomain(domain: string): string {
  const label = domain.split(".")[0] ?? domain;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function extKey(id: string): string {
  return `ext:${id.toLowerCase()}`;
}

async function byKeys(tx: Tx, userId: string, keys: string[]): Promise<Entity[]> {
  if (!keys.length) return [];
  const rows = await tx
    .select({ e: entities })
    .from(entityKeys)
    .innerJoin(entities, eq(entities.id, entityKeys.entityId))
    .where(and(eq(entityKeys.userId, userId), inArray(entityKeys.key, keys)));
  const seen = new Map<string, Entity>();
  for (const r of rows) seen.set(r.e.id, r.e);
  return [...seen.values()];
}

async function live(tx: Tx, e: Entity): Promise<Entity> {
  let cur = e;
  for (let i = 0; i < 8 && cur.mergedIntoId; i++) {
    const [n] = await tx.select().from(entities).where(eq(entities.id, cur.mergedIntoId));
    if (!n) break;
    cur = n;
  }
  return cur;
}

async function addKeys(tx: Tx, userId: string, entityId: string, keys: string[], sourceId: string | null): Promise<void> {
  for (const key of new Set(keys)) {
    if (key.startsWith("name:")) {
      const [has] = await tx.select({ k: entityKeys.key }).from(entityKeys).where(and(eq(entityKeys.entityId, entityId), eq(entityKeys.key, key))).limit(1);
      if (!has) await tx.insert(entityKeys).values({ entityId, userId, key, sourceId });
    } else {
      await tx.insert(entityKeys).values({ entityId, userId, key, sourceId }).onConflictDoNothing();
    }
  }
}

/** Moves keys and links of `mergeId` onto `keepId`; reversible (snapshot kept on the merged row). */
export async function mergeInto(tx: Tx, userId: string, keepId: string, mergeId: string): Promise<void> {
  if (keepId === mergeId) return;
  const [keep] = await tx.select().from(entities).where(eq(entities.id, keepId));
  const [gone] = await tx.select().from(entities).where(eq(entities.id, mergeId));
  if (!keep || !gone) return;
  const keys = await tx.select().from(entityKeys).where(eq(entityKeys.entityId, mergeId));
  const links = await tx.select().from(entityLinks).where(eq(entityLinks.entityId, mergeId));
  await tx.update(entityKeys).set({ entityId: keepId }).where(eq(entityKeys.entityId, mergeId));
  for (const l of links) await tx.insert(entityLinks).values({ ...l, entityId: keepId }).onConflictDoNothing();
  await tx.delete(entityLinks).where(eq(entityLinks.entityId, mergeId));
  await tx.update(entities).set({ companyId: keepId }).where(and(eq(entities.userId, userId), eq(entities.companyId, mergeId)));
  await tx.update(entities).set({
    mergedIntoId: keepId,
    attributes: { ...(gone.attributes ?? {}), mergedKeys: keys.map((k) => k.key), mergedLinks: links.map((l) => [l.itemId, l.role, l.sourceId]) },
  }).where(eq(entities.id, mergeId));
  await tx.update(entities).set({
    name: betterName(keep.name, gone.name),
    primaryEmail: keep.primaryEmail ?? gone.primaryEmail,
    domain: keep.domain ?? gone.domain,
    title: keep.title ?? gone.title,
    companyId: keep.companyId ?? gone.companyId,
    isSelf: keep.isSelf || gone.isSelf,
    firstSeenAt: keep.firstSeenAt < gone.firstSeenAt ? keep.firstSeenAt : gone.firstSeenAt,
  }).where(eq(entities.id, keepId));
}

/** A real full name beats an email-derived or initial-only one. */
export function betterName(a: string, b: string): string {
  const score = (n: string) => (n.includes("@") ? 0 : 1) + (/\s/.test(n) ? 1 : 0) + (/\b[A-Za-z]\.$/.test(n) || /\b[A-Za-z]\.\s/.test(n) ? -1 : 0) + Math.min(n.length, 40) / 100;
  return score(b) > score(a) ? b : a;
}

interface Want {
  type: "person" | "company";
  keys: string[];             // strong keys (email:, domain:, ext:)
  nameKey?: string;
  name?: string;
  email?: string;
  domain?: string;
  title?: string;
  self?: boolean;
  nameOnly?: boolean;
}

async function upsertEntity(tx: Tx, env: ResolveEnv, w: Want): Promise<string | null> {
  let found: Entity[] = [];
  if (w.self) {
    const [s] = await tx.select().from(entities).where(and(eq(entities.userId, env.userId), eq(entities.isSelf, true), eq(entities.type, "person"), isNull(entities.mergedIntoId))).limit(1);
    if (s) found = [s];
  }
  if (!found.length && w.keys.length) found = await Promise.all((await byKeys(tx, env.userId, w.keys)).map((e) => live(tx, e)));
  if (!found.length && w.nameOnly && w.nameKey) {
    // reuse a name-only entity with the same name (never an entity that has an email)
    const rows = await tx.select({ e: entities }).from(entityKeys).innerJoin(entities, eq(entities.id, entityKeys.entityId))
      .where(and(eq(entityKeys.userId, env.userId), eq(entityKeys.key, w.nameKey), isNull(entities.primaryEmail), isNull(entities.mergedIntoId), eq(entities.type, w.type)));
    if (rows[0]) found = [rows[0].e];
  }
  const unique = [...new Map(found.map((e) => [e.id, e])).values()].filter((e) => e.type === w.type);
  let id: string;
  if (unique.length === 0) {
    if (!w.name && !w.email && !w.domain) return null;
    id = newId("ent");
    await tx.insert(entities).values({
      id, userId: env.userId, type: w.type,
      name: w.name ?? (w.email ? nameFromEmail(w.email) : w.domain ? companyNameFromDomain(w.domain) : "Unknown"),
      primaryEmail: w.email ?? null, domain: w.domain ?? null, title: w.title ?? null, isSelf: !!w.self,
      firstSeenAt: env.now, lastSeenAt: env.now,
    });
  } else {
    unique.sort((a, b) => +a.firstSeenAt - +b.firstSeenAt || a.id.localeCompare(b.id));
    id = unique[0]!.id;
    for (const other of unique.slice(1)) await mergeInto(tx, env.userId, id, other.id);
    const [cur] = await tx.select().from(entities).where(eq(entities.id, id));
    if (cur) {
      const name = w.name ? betterName(cur.name, w.name) : cur.name;
      await tx.update(entities).set({
        name, primaryEmail: cur.primaryEmail ?? w.email ?? null, domain: cur.domain ?? w.domain ?? null,
        title: w.title ?? cur.title, isSelf: cur.isSelf || !!w.self, lastSeenAt: env.now,
      }).where(eq(entities.id, id));
    }
  }
  await addKeys(tx, env.userId, id, [...w.keys, ...(w.nameKey ? [w.nameKey] : [])], env.sourceId);
  return id;
}

function companyDomainFor(email: string | undefined, env: ResolveEnv): string | undefined {
  if (!email) return undefined;
  const d = decodeDomain(email);
  if (!d || isFreeMail(d) || env.selfDomains.has(d) || env.ignoreDomains.has(d)) return undefined;
  return d;
}

async function ensureCompany(tx: Tx, env: ResolveEnv, domain: string | undefined, name?: string): Promise<string | null> {
  if (!domain && !name) return null;
  if (domain && (isFreeMail(domain) || env.selfDomains.has(domain) || env.ignoreDomains.has(domain))) return null;
  return upsertEntity(tx, env, {
    type: "company", keys: domain ? [`domain:${domain}`] : [], nameKey: name ? `name:${normName(name)}` : undefined,
    name: name ?? (domain ? companyNameFromDomain(domain) : undefined), domain, nameOnly: !domain,
  });
}

async function resolvePerson(tx: Tx, env: ResolveEnv, r: { email?: string; emails?: string[]; name?: string; externalId?: string; title?: string }): Promise<string | null> {
  const email = r.email?.toLowerCase();
  const all = [...new Set([...(email ? [email] : []), ...(r.emails ?? []).map((e) => e.toLowerCase())])];
  const self = all.some((e) => env.selfEmails.has(e)) || (!!r.externalId && !!env.selfExts?.has(r.externalId.toLowerCase()));
  // every address is a key, so two records sharing one become one person (upsertEntity merges what the keys find)
  const keys = [...all.map((e) => `email:${e}`), ...(r.externalId ? [extKey(r.externalId)] : [])];
  const name = r.name?.replace(/\s+/g, " ").trim() || undefined;
  if (!keys.length && !name) return null;
  const id = await upsertEntity(tx, env, {
    type: "person", keys, nameKey: name ? `name:${normName(name)}` : undefined, name, email, title: r.title, self, nameOnly: keys.length === 0,
  });
  if (id && email && !self) {
    const domain = companyDomainFor(email, env);
    if (domain) {
      const cid = await ensureCompany(tx, env, domain);
      if (cid) await tx.update(entities).set({ companyId: cid }).where(and(eq(entities.id, id), isNull(entities.companyId)));
    }
  }
  return id;
}

async function link(tx: Tx, itemId: string, entityId: string | null, role: string, sourceId: string): Promise<void> {
  if (!entityId) return;
  await tx.insert(entityLinks).values({ itemId, entityId, role, sourceId }).onConflictDoNothing();
}

/** Resolves an item's `is` and refs into entities and links. Returns the entity ids touched. */
export async function resolveItemEntities(tx: Tx, env: ResolveEnv, itemId: string, n: NormalizedItem): Promise<string[]> {
  const touched = new Set<string>();
  const is: ResolvedIs | null = n.is;
  if (is) {
    if (is.type === "person") {
      const id = await resolvePerson(tx, env, { email: is.email, emails: is.emails, name: is.name, externalId: is.externalId, title: is.title });
      if (id) {
        touched.add(id); await link(tx, itemId, id, "is", env.sourceId);
        if (is.companyName || is.domain) {
          const cid = await ensureCompany(tx, env, is.domain ?? companyDomainFor(is.email, env), is.companyName);
          if (cid) { touched.add(cid); await tx.update(entities).set({ companyId: cid }).where(eq(entities.id, id)); await link(tx, itemId, cid, "about", env.sourceId); }
        }
      }
    } else {
      const domain = is.domain ?? (is.email ? decodeDomain(is.email) : undefined);
      const id = await upsertEntity(tx, env, {
        type: "company", keys: [...(domain ? [`domain:${domain}`] : []), ...(is.externalId ? [extKey(is.externalId)] : [])],
        nameKey: is.name ? `name:${normName(is.name)}` : undefined, name: is.name, domain, nameOnly: !domain && !is.externalId,
      });
      if (id) { touched.add(id); await link(tx, itemId, id, "is", env.sourceId); }
    }
  }
  for (const r of n.refs as ResolvedRef[]) {
    if (r.type === "person") {
      const id = await resolvePerson(tx, env, r);
      if (!id) continue;
      touched.add(id);
      await link(tx, itemId, id, r.role, env.sourceId);
      const domain = companyDomainFor(r.email, env);
      if (domain) {
        const cid = await ensureCompany(tx, env, domain);
        if (cid) { touched.add(cid); await link(tx, itemId, cid, r.role, env.sourceId); }
      }
    } else {
      const cid = await ensureCompany(tx, env, r.domain ?? (r.email ? decodeDomain(r.email) : undefined), r.name);
      if (cid) { touched.add(cid); await link(tx, itemId, cid, r.role, env.sourceId); }
    }
  }
  return [...touched];
}

/**
 * Folds entities keyed by the user's own addresses (email: and ext: keys) into the one self
 * person. Needed when self_addresses grows after those people were created (SPEC 8.1 rule 5).
 * Returns true when anything changed.
 */
export async function markSelf(tx: Tx, userId: string, self: { emails: Set<string>; exts: Set<string> }): Promise<boolean> {
  const keys = [...[...self.emails].map((e) => `email:${e}`), ...[...self.exts].map((x) => extKey(x))];
  if (!keys.length) return false;
  const found = await Promise.all((await byKeys(tx, userId, keys)).map((e) => live(tx, e)));
  const people = [...new Map(found.filter((e) => e.type === "person").map((e) => [e.id, e])).values()];
  const [existing] = await tx.select().from(entities).where(and(eq(entities.userId, userId), eq(entities.isSelf, true), eq(entities.type, "person"), isNull(entities.mergedIntoId))).limit(1);
  const all = existing ? [existing, ...people.filter((p) => p.id !== existing.id)] : people;
  if (!all.length || (all.length === 1 && all[0]!.isSelf)) return false;
  all.sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || +a.firstSeenAt - +b.firstSeenAt);
  const keep = all[0]!;
  if (!keep.isSelf) await tx.update(entities).set({ isSelf: true }).where(eq(entities.id, keep.id));
  for (const other of all.slice(1)) await mergeInto(tx, userId, keep.id, other.id);
  return true;
}

/** Recounts item_count and last_seen_at for a user's entities (after a run). */
export async function recountEntities(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`
    update entities e set
      item_count = coalesce(c.n, 0),
      last_seen_at = coalesce(c.last, e.last_seen_at)
    from (
      select e2.id, count(distinct i.id)::int as n, max(i.occurred_at) as last
      from entities e2
      left join entity_links l on l.entity_id = e2.id
      left join items i on i.id = l.item_id and i.deleted_at is null and i.directory = false
      where e2.user_id = ${userId}
      group by e2.id
    ) c
    where e.id = c.id and e.user_id = ${userId}`);
}
