// Search, rerank, count, suggest, items, entities, saved and recent searches.

import { Hono } from "hono";
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import {
  countOnly, dbSchema, entityChips, hybridSearch, jevRerank, mergeEntities, newId, suggest, unmergeEntity,
  type ItemKind, type SearchRequest,
} from "@search/core";
import type { AppEnv } from "../deps.js";
import { badRequest, notFound } from "../errors.js";
import { requireUser } from "../session.js";
import { entityDetail, itemDetail, rowsFor } from "../views.js";
import { int, need, readJson } from "./lib.js";

const { recentSearches, savedSearches, items, rawItems, entities, entityMatches } = dbSchema;

export const searchRoutes = new Hono<AppEnv>();

const SORTS = new Set(["best", "newest", "oldest"]);

/** Recently opened items (CONTRACT gap 12): kept in memory per user until core adds a table. */
const opened = new Map<string, string[]>();

searchRoutes.get("/search", async (c) => {
  need(c, "search:read");
  const u = await requireUser(c);
  const deps = c.get("deps");
  const q = c.req.query("q") ?? "";
  const sort = SORTS.has(c.req.query("sort") ?? "") ? (c.req.query("sort") as SearchRequest["sort"]) : "best";
  const scope = (c.req.query("scope") || "all") as ItemKind | "all";
  const offset = int(c.req.query("offset"), 0, 0, 10_000);
  const fresh = c.req.query("fresh") === "1";
  const res = await hybridSearch(deps.ctx, u.id, { q, limit: int(c.req.query("limit"), 30, 1, 200), offset, sort, scope, fresh });
  if (q.trim() && offset === 0 && !c.get("scopes")) {
    await deps.db.delete(recentSearches).where(and(eq(recentSearches.userId, u.id), eq(recentSearches.query, q.trim())));
    await deps.db.insert(recentSearches).values({ id: newId("rec"), userId: u.id, query: q.trim(), resultCount: res.total });
    const keep = await deps.db.select({ id: recentSearches.id }).from(recentSearches).where(eq(recentSearches.userId, u.id)).orderBy(desc(recentSearches.at)).limit(50);
    await deps.db.delete(recentSearches).where(and(eq(recentSearches.userId, u.id), notInArray(recentSearches.id, keep.map((k) => k.id).concat("_"))));
  }
  return c.json(res);
});

searchRoutes.post("/search/rerank", async (c) => {
  need(c, "search:read");
  const u = await requireUser(c);
  const b = await readJson<{ queryId?: string; fresh?: boolean }>(c);
  if (!b.queryId) throw badRequest("queryId is required.");
  return c.json(await jevRerank(c.get("deps").ctx, u.id, { queryId: b.queryId, fresh: b.fresh === true }));
});

searchRoutes.get("/search/count", async (c) => {
  need(c, "search:read");
  const u = await requireUser(c);
  return c.json({ count: await countOnly(c.get("deps").ctx, u.id, c.req.query("q") ?? "") });
});

searchRoutes.get("/suggest", async (c) => {
  need(c, "search:read");
  const u = await requireUser(c);
  return c.json(await suggest(c.get("deps").ctx, u.id, c.req.query("prefix") ?? ""));
});

searchRoutes.get("/items/:id", async (c) => {
  need(c, "search:read");
  const u = await requireUser(c);
  const d = await itemDetail(c.get("deps"), u.id, c.req.param("id"));
  const list = [d.row.id, ...(opened.get(u.id) ?? []).filter((x) => x !== d.row.id)].slice(0, 20);
  opened.set(u.id, list);
  return c.json(d);
});

searchRoutes.get("/items/:id/raw", async (c) => {
  need(c, "account:read");
  const u = await requireUser(c);
  const [it] = await c.get("deps").db.select({ rawId: items.rawItemId }).from(items).where(and(eq(items.id, c.req.param("id")), eq(items.userId, u.id)));
  if (!it) throw notFound("Item");
  const [r] = await c.get("deps").db.select().from(rawItems).where(eq(rawItems.id, it.rawId));
  if (!r) throw notFound("Raw payload");
  return c.json({ item: r.item, detail: r.detail ?? null, children: r.children ?? null });
});

searchRoutes.get("/recent-items", async (c) => {
  need(c, "search:read");
  const u = await requireUser(c);
  const ids = (opened.get(u.id) ?? []).slice(0, int(c.req.query("limit"), 8, 1, 20));
  if (!ids.length) return c.json([]);
  const rows = await c.get("deps").db.select().from(items).where(and(inArray(items.id, ids), isNull(items.deletedAt)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return c.json(await rowsFor(c.get("deps"), ids.map((i) => byId.get(i)).filter((x): x is NonNullable<typeof x> => !!x)));
});

searchRoutes.get("/entities", async (c) => {
  need(c, "search:read");
  const u = await requireUser(c);
  const deps = c.get("deps");
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const type = c.req.query("type");
  const limit = int(c.req.query("limit"), 10, 1, 200);
  const r = await deps.db.execute(sql`select id from entities where user_id = ${u.id} and merged_into_id is null and (item_count > 0 or is_self)
    ${type === "person" || type === "company" ? sql`and type = ${type}` : sql``}
    ${q ? sql`and (lower(name) like ${`%${q}%`} or lower(coalesce(primary_email, '')) like ${`${q}%`} or lower(coalesce(domain, '')) like ${`${q}%`})` : sql``}
    order by is_self desc, item_count desc, name limit ${limit}`);
  return c.json(await entityChips(deps.ctx, (r.rows as { id: string }[]).map((x) => x.id)));
});

searchRoutes.get("/entities/:id", async (c) => {
  need(c, "search:read");
  const u = await requireUser(c);
  return c.json(await entityDetail(c.get("deps"), u.id, c.req.param("id")));
});

async function ownEntity(c: Parameters<typeof requireUser>[0], userId: string, id: string): Promise<void> {
  const [e] = await c.get("deps").db.select({ id: entities.id }).from(entities).where(and(eq(entities.id, id), eq(entities.userId, userId)));
  if (!e) throw notFound("Person or company");
}

searchRoutes.post("/entities/:id/merge", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  const deps = c.get("deps");
  const b = await readJson<{ otherId?: string }>(c);
  if (!b.otherId) throw badRequest("otherId is required.");
  await ownEntity(c, u.id, c.req.param("id"));
  await ownEntity(c, u.id, b.otherId);
  await mergeEntities(deps.db, u.id, c.req.param("id"), b.otherId, "user");
  deps.hub.emit(u.id, { type: "entity", entityId: c.req.param("id"), change: "merged" });
  return c.json(await entityDetail(deps, u.id, c.req.param("id")));
});

searchRoutes.post("/entities/:id/unmerge", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  const deps = c.get("deps");
  await ownEntity(c, u.id, c.req.param("id"));
  await unmergeEntity(deps.db, u.id, c.req.param("id"));
  deps.hub.emit(u.id, { type: "entity", entityId: c.req.param("id"), change: "unmerged" });
  return c.json(await entityDetail(deps, u.id, c.req.param("id")));
});

searchRoutes.post("/entity-matches/:id", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  const deps = c.get("deps");
  const b = await readJson<{ decision?: "merge" | "reject" }>(c);
  const [m] = await deps.db.select().from(entityMatches).where(and(eq(entityMatches.id, c.req.param("id")), eq(entityMatches.userId, u.id)));
  if (!m) throw notFound("Match");
  if (b.decision === "merge") {
    await mergeEntities(deps.db, u.id, m.aId, m.bId, "user");
    await deps.db.update(entityMatches).set({ status: "merged", decidedBy: "user", decidedAt: new Date() }).where(eq(entityMatches.id, m.id));
    deps.hub.emit(u.id, { type: "entity", entityId: m.aId, change: "merged" });
  } else if (b.decision === "reject") {
    await deps.db.update(entityMatches).set({ status: "rejected", decidedBy: "user", decidedAt: new Date() }).where(eq(entityMatches.id, m.id));
  } else throw badRequest('decision is "merge" or "reject".');
  return c.body(null, 204);
});

// ---------- saved and recent searches ----------

const savedRow = (r: typeof savedSearches.$inferSelect) => ({ id: r.id, name: r.name, query: r.query, position: r.position });

searchRoutes.get("/saved-searches", async (c) => {
  need(c, "search:read");
  const u = await requireUser(c);
  const rows = await c.get("deps").db.select().from(savedSearches).where(eq(savedSearches.userId, u.id)).orderBy(asc(savedSearches.position), asc(savedSearches.createdAt));
  return c.json(rows.map(savedRow));
});

searchRoutes.post("/saved-searches", async (c) => {
  const u = await requireUser(c);
  const b = await readJson<{ name?: string; query?: string }>(c);
  if (!b.query?.trim()) throw badRequest("query is required.");
  const db = c.get("deps").db;
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(savedSearches).where(eq(savedSearches.userId, u.id));
  const [row] = await db.insert(savedSearches).values({ id: newId("sav"), userId: u.id, name: (b.name?.trim() || b.query.trim()).slice(0, 120), query: b.query.trim(), position: n }).returning();
  return c.json(savedRow(row!));
});

searchRoutes.patch("/saved-searches/:id", async (c) => {
  const u = await requireUser(c);
  const b = await readJson<{ name?: string; query?: string; position?: number }>(c);
  const db = c.get("deps").db;
  const patch = { ...(b.name?.trim() ? { name: b.name.trim().slice(0, 120) } : {}), ...(b.query?.trim() ? { query: b.query.trim() } : {}), ...(typeof b.position === "number" ? { position: Math.trunc(b.position) } : {}) };
  const [row] = Object.keys(patch).length
    ? await db.update(savedSearches).set(patch).where(and(eq(savedSearches.id, c.req.param("id")), eq(savedSearches.userId, u.id))).returning()
    : await db.select().from(savedSearches).where(and(eq(savedSearches.id, c.req.param("id")), eq(savedSearches.userId, u.id)));
  if (!row) throw notFound("Saved search");
  return c.json(savedRow(row));
});

searchRoutes.delete("/saved-searches/:id", async (c) => {
  const u = await requireUser(c);
  await c.get("deps").db.delete(savedSearches).where(and(eq(savedSearches.id, c.req.param("id")), eq(savedSearches.userId, u.id)));
  return c.body(null, 204);
});

searchRoutes.get("/recent-searches", async (c) => {
  need(c, "search:read");
  const u = await requireUser(c);
  const rows = await c.get("deps").db.select().from(recentSearches).where(eq(recentSearches.userId, u.id)).orderBy(desc(recentSearches.at)).limit(int(c.req.query("limit"), 20, 1, 50));
  return c.json(rows.map((r) => ({ query: r.query, at: r.at.toISOString(), resultCount: r.resultCount })));
});

searchRoutes.delete("/recent-searches", async (c) => {
  const u = await requireUser(c);
  await c.get("deps").db.delete(recentSearches).where(eq(recentSearches.userId, u.id));
  opened.delete(u.id);
  return c.body(null, 204);
});
