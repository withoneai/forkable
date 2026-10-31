// The catalog for the New profile flow (SPEC 10.2): platforms from One's public
// /v1/available-connectors (cached 24 h), actions and docs on the user's grant
// (listActions 6 h, getActionKnowledge 24 h). Sample users read the fixture
// catalog in fixtures/sample/catalog instead, and their "grant" is every
// built-in platform plus the fixture platforms and the AI platforms.

import { eq, sql } from "drizzle-orm";
import type { ActionDoc, CatalogAction, CatalogPlatform, GrantAccess, GrantedConnection } from "../contract.js";
import type { EngineCtx } from "../ctx.js";
import { catalogCache, profiles, users } from "../db/schema.js";
import { grantedConnections } from "../one.js";
import { AI_PLATFORMS, logoUrl, platformName } from "../platforms.js";

export const CATALOG_URL = "https://api.withone.ai/v1/available-connectors";
const H = 3_600_000;

export type CatalogRow = CatalogPlatform & { inGrant: boolean; connectionLabel: string | null; /** Accounts of this platform in the grant (two Gmails). */ accounts?: number; builtin: boolean };

export async function userMode(ctx: EngineCtx, userId: string): Promise<"fixture" | "connect"> {
  const [u] = await ctx.db.select({ s: users.isSample }).from(users).where(eq(users.id, userId));
  return u?.s ? "fixture" : "connect";
}

async function cached<T>(ctx: EngineCtx, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const [hit] = await ctx.db.select().from(catalogCache).where(eq(catalogCache.key, key));
  if (hit && Date.now() - hit.fetchedAt.getTime() < ttl) return hit.data as T;
  try {
    const data = await load();
    await ctx.db.insert(catalogCache).values({ key, data: data as object, fetchedAt: new Date() }).onConflictDoUpdate({ target: catalogCache.key, set: { data: data as object, fetchedAt: new Date() } });
    return data;
  } catch (e) {
    if (hit) return hit.data as T; // stale beats nothing
    throw e;
  }
}

export function toCatalogPlatform(r: Record<string, unknown>): CatalogPlatform {
  const platform = String(r.platform ?? "");
  return {
    platform, name: String(r.name ?? r.title ?? platformName(platform)), title: typeof r.title === "string" ? r.title : undefined,
    description: typeof r.description === "string" ? r.description : undefined, category: typeof r.category === "string" ? r.category : undefined,
    image: typeof r.image === "string" ? r.image : logoUrl(platform), tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
    actionCount: typeof r.tools === "number" ? r.tools : undefined, oauth: typeof r.oauth === "boolean" ? r.oauth : undefined,
    active: r.active === undefined ? true : !!r.active,
  };
}

/** Every platform One lists (public, no grant needed). */
export async function fetchPlatforms(ctx: EngineCtx, fetchImpl: typeof fetch = fetch): Promise<CatalogPlatform[]> {
  return cached(ctx, "platforms", 24 * H, async () => {
    const out: CatalogPlatform[] = [];
    for (let page = 1; page <= 20; page++) {
      const res = await fetchImpl(`${CATALOG_URL}?page=${page}&limit=100`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`available-connectors answered ${res.status}`);
      const j = (await res.json()) as { rows?: Record<string, unknown>[]; pages?: number };
      out.push(...(j.rows ?? []).map(toCatalogPlatform));
      if (!j.pages || page >= j.pages) break;
    }
    return out;
  });
}

export async function builtinPlatforms(ctx: EngineCtx): Promise<Set<string>> {
  const r = await ctx.db.execute(sql`select distinct ${profiles.platform} as p from ${profiles} where ${profiles.userId} is null`);
  return new Set((r.rows as { p: string }[]).map((x) => x.p));
}

/** The sample user's grant: built-in platforms, fixture-catalog platforms, AI platforms. */
export async function sampleGrant(ctx: EngineCtx): Promise<GrantedConnection[]> {
  const ps = new Set([...(await builtinPlatforms(ctx)), ...(ctx.world?.catalog.actions.keys() ?? []), ...AI_PLATFORMS]);
  const access = { policy: "methods", methods: ["GET", "POST"] } as GrantAccess;
  const base = [...ps].sort().map((p) => ({ key: `sample:${p}`, platform: p, name: platformName(p), title: p === "outlook-mail" || p === "outlook-calendar" || p === "teams" ? "dana@acme.eu" : "dana@acme.com", access }));
  // a second account on one platform (Connect lets a user grant two Gmails): right after the first
  const extra = (ctx.world?.connections ?? []).filter((c) => ps.has(c.platform)).map((c) => ({ key: c.key, platform: c.platform, name: platformName(c.platform), title: c.label, access }));
  return base.flatMap((b) => [b, ...extra.filter((e) => e.platform === b.platform)]);
}

export async function connectionsFor(ctx: EngineCtx, userId: string): Promise<GrantedConnection[]> {
  return (await userMode(ctx, userId)) === "fixture" ? sampleGrant(ctx) : grantedConnections(ctx.oneConnect, userId);
}

export async function listPlatforms(ctx: EngineCtx, userId: string, q = ""): Promise<CatalogRow[]> {
  const mode = await userMode(ctx, userId);
  const all = mode === "fixture"
    ? (ctx.world?.catalog.platforms ?? []).map((r) => toCatalogPlatform(r as Record<string, unknown>))
    : await fetchPlatforms(ctx);
  const conns = await connectionsFor(ctx, userId);
  const builtin = await builtinPlatforms(ctx);
  const needle = q.trim().toLowerCase();
  return all
    .filter((p) => p.active && !AI_PLATFORMS.has(p.platform))
    .filter((p) => !needle || p.platform.includes(needle) || p.name.toLowerCase().includes(needle) || (p.category ?? "").toLowerCase().includes(needle))
    .map((p) => {
      const mine = conns.filter((x) => x.platform === p.platform);
      // two accounts: "dana@acme.com · dana@acme.dev"
      return { ...p, inGrant: mine.length > 0, connectionLabel: mine.length ? mine.map((c) => c.title ?? c.name ?? p.name).join(" · ") : null, accounts: mine.length, builtin: builtin.has(p.platform) };
    })
    .sort((a, b) => Number(b.inGrant) - Number(a.inGrant) || a.name.localeCompare(b.name))
    .slice(0, 200);
}

const WRITE_VERB = /\b(create|update|delete|remove|send|post a|add|insert|upsert|patch|put|merge|archive|move|cancel|bulk|import|upload|set|reply|forward|invite|mark|trash|modify)\b/i;
const LIST_WORD = /\b(list|search|query|get many|get all|export|incremental|retrieve .*s|recent|history|feed)\b/i;

/** Read-only and list-shaped, by method and title (SPEC 10.2 step 1). */
export function classifyAction(a: { title: string; method: string; path: string }): { listLike: boolean; readOnly: boolean } {
  const m = a.method.toUpperCase();
  const write = WRITE_VERB.test(a.title) && !LIST_WORD.test(a.title);
  const readOnly = !write && (m === "GET" || (m === "POST" && /search|query|list|graphql|find/i.test(`${a.title} ${a.path}`)));
  const listLike = readOnly && (LIST_WORD.test(a.title) || /s$/.test(a.path.replace(/\/$/, "").split("/").pop() ?? "")) && !/\{\{?[^}]+\}?\}$/.test(a.path);
  return { listLike, readOnly };
}

function permits(access: GrantAccess | undefined, a: { actionId: string; method: string }): boolean {
  if (!access) return false;
  if (access.policy === "full") return true;
  if (access.policy === "methods") return access.methods.map((m) => m.toUpperCase()).includes(a.method.toUpperCase());
  return access.actions.some((x) => (typeof x === "string" ? x : x.actionId) === a.actionId);
}

interface RawAction { _id: string; title: string; method: string; path: string; tags?: string[]; modelName?: string }

/** One's /knowledge pages, keeping modelName when One sends it (@withone/connect's listActions drops it). */
async function knowledgeRows(ctx: EngineCtx, userId: string, platform: string): Promise<RawAction[]> {
  const oc = ctx.oneConnect!;
  const page = async (n: number) => {
    const r = await oc.fetch(userId, `/knowledge?connectionPlatform=${encodeURIComponent(platform)}&limit=100&page=${n}`);
    if (!r.ok) throw new Error(`One's action catalog answered ${r.status}`);
    return (await r.json()) as { rows?: Record<string, unknown>[]; pages?: number };
  };
  const first = await page(1);
  const rest = await Promise.all(Array.from({ length: Math.min(Math.max(first.pages ?? 1, 1), 20) - 1 }, (_, i) => page(i + 2).catch(() => ({ rows: [] }))));
  return [first, ...rest].flatMap((p) => p.rows ?? []).map((r) => ({
    _id: String(r._id ?? r.systemId ?? ""), title: String(r.title ?? ""), method: String(r.method ?? "").toUpperCase(), path: String(r.path ?? ""),
    ...(Array.isArray(r.tags) ? { tags: r.tags.map(String) } : {}), ...(typeof r.modelName === "string" && r.modelName ? { modelName: r.modelName } : {}),
  }));
}

export async function listCatalogActions(ctx: EngineCtx, userId: string, platform: string, conn: GrantedConnection | null): Promise<(CatalogAction & { modelName?: string })[]> {
  const mode = await userMode(ctx, userId);
  let raw: RawAction[];
  if (mode === "fixture") raw = (ctx.world?.catalog.actions.get(platform) ?? []) as RawAction[];
  else if (!ctx.oneConnect) raw = [];
  else raw = await cached(ctx, `actions2:${platform}`, 6 * H, async () => knowledgeRows(ctx, userId, platform).catch(async () => (await ctx.oneConnect!.listActions(userId, platform)) as unknown as RawAction[]));
  const rank = (a: CatalogAction) => (/^list\b/i.test(a.title) ? 0 : /^(search|query)\b/i.test(a.title) ? 1 : /incremental|export/i.test(a.title) ? 2 : 3) * 100 + a.path.split("/").length;
  return raw
    .map((a) => ({ actionId: a._id, title: a.title, method: a.method, path: a.path, tags: a.tags ?? [], ...classifyAction(a), permitted: permits(conn?.access, { actionId: a._id, method: a.method }), ...(a.modelName ? { modelName: a.modelName } : {}) }))
    .sort((a, b) => Number(b.listLike) - Number(a.listLike) || rank(a) - rank(b));
}

export async function actionDoc(ctx: EngineCtx, userId: string, actionId: string): Promise<ActionDoc | null> {
  const mode = await userMode(ctx, userId);
  if (mode === "fixture") {
    const k = ctx.world?.catalog.knowledge.get(actionId) as Record<string, unknown> | undefined;
    return k ? { actionId, knowledge: String(k.knowledge ?? ""), ioSchema: k.ioSchema, method: String(k.method ?? "GET"), path: String(k.path ?? ""), tags: (k.tags as string[]) ?? [] } : null;
  }
  if (!ctx.oneConnect) return null;
  try {
    const k = await cached(ctx, `knowledge:${actionId}`, 24 * H, async () => (await ctx.oneConnect!.getActionKnowledge(userId, actionId)) as unknown as Record<string, unknown>);
    return { actionId, knowledge: String(k.knowledge ?? ""), ioSchema: k.ioSchema, method: String(k.method ?? "GET"), path: String(k.path ?? ""), tags: (k.tags as string[]) ?? [] };
  } catch {
    return null;
  }
}
