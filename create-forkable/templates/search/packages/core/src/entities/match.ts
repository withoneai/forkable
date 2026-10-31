// Entity match check (SPEC 8.2): candidate person pairs with the same normalized name (or one a
// prefix of the other, "Priya S." and "Priya Shah"); Jev noul "same person?" per pair, batched by 10.
// >= 0.85 merge, 0.5 to 0.85 pending (the preview asks), < 0.5 rejected.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { CallCtx, EngineCtx } from "../ctx.js";
import type { Db } from "../db/client.js";
import { entities, entityKeys, entityLinks, entityMatches, users } from "../db/schema.js";
import { newId } from "../ids.js";
import { one } from "../one.js";
import { JEV_ACTION } from "../classify/jev.js";
import { mergeInto, normName, recountEntities } from "./resolve.js";

type Entity = typeof entities.$inferSelect;

/** "Priya S." vs "Priya Shah": same first name, and the last names are equal or one is a prefix (initials) of the other. */
export function namesMatch(a: string, b: string): boolean {
  const ta = normName(a).replace(/\./g, "").split(" ").filter(Boolean);
  const tb = normName(b).replace(/\./g, "").split(" ").filter(Boolean);
  if (!ta.length || !tb.length || ta[0] !== tb[0]) return false;
  if (ta.length === 1 || tb.length === 1) return ta.length === tb.length;
  const la = ta[ta.length - 1]!, lb = tb[tb.length - 1]!;
  return la === lb || la.startsWith(lb) || lb.startsWith(la);
}

export interface Candidate { a: Entity; b: Entity; reason: "name_same_company" | "name_only" | "ext_id_name" }

export async function matchCandidates(db: Db, userId: string): Promise<Candidate[]> {
  const people = await db.select().from(entities).where(and(eq(entities.userId, userId), eq(entities.type, "person"), isNull(entities.mergedIntoId), eq(entities.isSelf, false)));
  const decided = await db.select().from(entityMatches).where(eq(entityMatches.userId, userId));
  const seen = new Set(decided.map((m) => [m.aId, m.bId].sort().join("|")));
  const byFirst = new Map<string, Entity[]>();
  for (const p of people) {
    const first = normName(p.name).split(" ")[0];
    if (!first || p.name.includes("@")) continue;
    const a = byFirst.get(first) ?? [];
    a.push(p);
    byFirst.set(first, a);
  }
  const out: Candidate[] = [];
  for (const group of byFirst.values()) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = group[i]!, b = group[j]!;
      if (!namesMatch(a.name, b.name)) continue;
      if (a.primaryEmail && b.primaryEmail && a.primaryEmail === b.primaryEmail) continue;
      const k = [a.id, b.id].sort().join("|");
      if (seen.has(k)) continue;
      seen.add(k);
      const [x, y] = a.firstSeenAt <= b.firstSeenAt ? [a, b] : [b, a];
      out.push({ a: x, b: y, reason: a.companyId && a.companyId === b.companyId ? "name_same_company" : "name_only" });
    }
  }
  return out;
}

async function keysOf(db: Db, id: string): Promise<string[]> {
  return (await db.select({ k: entityKeys.key }).from(entityKeys).where(eq(entityKeys.entityId, id))).map((r) => r.k);
}

async function sampleTitles(db: Db, id: string): Promise<string[]> {
  const r = await db.execute(sql`select i.title from entity_links l join items i on i.id = l.item_id where l.entity_id = ${id} and i.deleted_at is null order by i.occurred_at desc limit 3`);
  return (r.rows as { title: string }[]).map((x) => x.title);
}

export async function mergeEntities(db: Db, userId: string, keepId: string, mergeId: string, by: "jev" | "user" | "fixture"): Promise<void> {
  await db.transaction(async (tx) => {
    await mergeInto(tx, userId, keepId, mergeId);
    await tx.update(entityMatches).set({ status: "merged", decidedBy: by, decidedAt: new Date() })
      .where(and(eq(entityMatches.userId, userId), sql`((${entityMatches.aId} = ${keepId} and ${entityMatches.bId} = ${mergeId}) or (${entityMatches.aId} = ${mergeId} and ${entityMatches.bId} = ${keepId}))`));
  });
  await recountEntities(db, userId);
}

/** Restores a merged entity from the snapshot kept on its row. */
export async function unmergeEntity(db: Db, userId: string, entityId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [e] = await tx.select().from(entities).where(and(eq(entities.id, entityId), eq(entities.userId, userId)));
    if (!e?.mergedIntoId) return;
    const keep = e.mergedIntoId;
    const attrs = (e.attributes ?? {}) as { mergedKeys?: string[]; mergedLinks?: [string, string, string][] };
    const keys = (attrs.mergedKeys ?? []).filter((k) => !k.startsWith("name:"));
    if (keys.length) await tx.update(entityKeys).set({ entityId }).where(and(eq(entityKeys.userId, userId), eq(entityKeys.entityId, keep), inArray(entityKeys.key, keys)));
    for (const [itemId, role, sourceId] of attrs.mergedLinks ?? []) {
      await tx.insert(entityLinks).values({ itemId, entityId, role, sourceId }).onConflictDoNothing();
      await tx.delete(entityLinks).where(and(eq(entityLinks.itemId, itemId), eq(entityLinks.entityId, keep), eq(entityLinks.role, role)));
    }
    const { mergedKeys: _k, mergedLinks: _l, ...rest } = attrs as Record<string, unknown>;
    await tx.update(entities).set({ mergedIntoId: null, attributes: rest }).where(eq(entities.id, entityId));
    await tx.update(entityMatches).set({ status: "rejected", decidedBy: "user", decidedAt: new Date() })
      .where(and(eq(entityMatches.userId, userId), sql`((${entityMatches.aId} = ${keep} and ${entityMatches.bId} = ${entityId}) or (${entityMatches.aId} = ${entityId} and ${entityMatches.bId} = ${keep}))`));
  });
  await recountEntities(db, userId);
}

export async function runEntityMatch(ctx: EngineCtx, userId: string): Promise<{ merged: number; pending: number; rejected: number }> {
  const [u] = await ctx.db.select().from(users).where(eq(users.id, userId));
  if (!u) return { merged: 0, pending: 0, rejected: 0 };
  const mode: "fixture" | "connect" = u.isSample ? "fixture" : "connect";
  const callCtx: CallCtx = { db: ctx.db, userId, actor: "classifier", mode, oneConnect: ctx.oneConnect, transport: ctx.transport };
  const settings = await ctx.settingsFor(userId);
  const cands = await matchCandidates(ctx.db, userId);
  let merged = 0, pending = 0, rejected = 0;
  const decide = async (c: Candidate, p: number | null, by: "jev" | "fixture") => {
    if (p === null) return;
    const status = p >= 0.85 ? "merged" : p >= 0.5 ? "pending" : "rejected";
    await ctx.db.insert(entityMatches).values({ id: newId("mat"), userId, aId: c.a.id, bId: c.b.id, reason: c.reason, probability: p, status: status === "merged" ? "pending" : status, decidedBy: status === "pending" ? null : by, decidedAt: status === "pending" ? null : ctx.now() }).onConflictDoNothing();
    if (status === "merged") { await mergeEntities(ctx.db, userId, c.a.id, c.b.id, by); merged++; ctx.emit(userId, { type: "entity", entityId: c.a.id, change: "merged" }); }
    else if (status === "pending") { pending++; ctx.emit(userId, { type: "entity", entityId: c.a.id, change: "match_pending" }); }
    else rejected++;
  };

  if (mode === "fixture") {
    for (const c of cands) {
      const ka = await keysOf(ctx.db, c.a.id), kb = await keysOf(ctx.db, c.b.id);
      let p: number | null = null;
      for (const x of ka) for (const y of kb) {
        if (p !== null) break;
        const r = await one.raw(callCtx, { ...JEV_ACTION, action: "systemone", level: "read", summary: "Check whether two people are the same", fixtureKey: `match:${x}|${y}`, body: {} });
        if (r.ok) p = Number((r.data as { same?: number }).same ?? 0);
      }
      await decide(c, p, "fixture");
    }
    return { merged, pending, rejected };
  }

  for (let i = 0; i < cands.length; i += 10) {
    const batch = cands.slice(i, i + 10);
    const pairs: Record<string, unknown> = {};
    const questions: Record<string, unknown> = {};
    for (const [n, c] of batch.entries()) {
      const side = async (e: Entity) => ({ name: e.name, emails: (await keysOf(ctx.db, e.id)).filter((k) => k.startsWith("email:")).map((k) => k.slice(6)), title: e.title, sample_items: await sampleTitles(ctx.db, e.id) });
      pairs[`pair_${n}`] = { a: await side(c.a), b: await side(c.b) };
      questions[`same_${n}`] = { type: "noul", instructions: `In pair_${n}, are a and b the same real person? Judge from names, companies, email domains and what they wrote. Different people can share a name.`, criteria: { true: "same person", false: "different people or not enough evidence" } };
    }
    try {
      const res = await one.call<{ answers?: Record<string, { noul?: number }> }>(callCtx, { ...JEV_ACTION, action: "systemone", level: "read", summary: "Check whether two people are the same", body: { model: settings.jevModel, state: pairs, questions } });
      for (const [n, c] of batch.entries()) { const v = res.answers?.[`same_${n}`]?.noul; await decide(c, typeof v === "number" ? v : null, "jev"); }
    } catch (e) {
      ctx.log(`entity match failed: ${(e as Error).message}`);
      break;
    }
  }
  return { merged, pending, rejected };
}
