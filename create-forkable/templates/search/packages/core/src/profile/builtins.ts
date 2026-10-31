// Built-in packs into profiles / profile_versions; sources for a user (real or sample).

import { and, eq, isNull, inArray } from "drizzle-orm";
import type { SearchProfile, SearchProfilePack } from "../contract.js";
import type { EngineCtx } from "../ctx.js";
import type { Db } from "../db/client.js";
import { profiles, profileVersions, sources } from "../db/schema.js";
import { parseDuration } from "../expr/time.js";
import { newId } from "../ids.js";
import type { GrantedConnection } from "../contract.js";
import { grantedConnections } from "../one.js";
import { AI_PLATFORMS } from "../platforms.js";
import { hashProfile } from "./hash.js";

export { loadBuiltinPacks } from "./packs.js";

export async function upsertProfileVersion(db: Db, userId: string | null, p: SearchProfile, origin: "builtin" | "user" | "import" | "url", createdBy: string, note?: string): Promise<{ profileId: string; versionId: string; created: boolean; updated: boolean }> {
  const h = hashProfile(p);
  const [row] = await db.select().from(profiles).where(and(userId === null ? isNull(profiles.userId) : eq(profiles.userId, userId), eq(profiles.slug, p.id)));
  if (!row) {
    const profileId = newId("prf");
    const versionId = newId("pfv");
    await db.insert(profiles).values({ id: profileId, userId, slug: p.id, platform: p.platform, model: p.model, origin, currentVersionId: versionId });
    await db.insert(profileVersions).values({ id: versionId, profileId, version: 1, json: p, ...h, createdBy, note: note ?? null });
    return { profileId, versionId, created: true, updated: false };
  }
  const [cur] = row.currentVersionId ? await db.select().from(profileVersions).where(eq(profileVersions.id, row.currentVersionId)) : [];
  if (cur && cur.profileHash === h.profileHash && JSON.stringify(cur.json) === JSON.stringify(p)) return { profileId: row.id, versionId: cur.id, created: false, updated: false };
  if (cur && cur.profileHash === h.profileHash) {
    // same data behaviour, cosmetic change (title, schedule, limits): update in place
    await db.update(profileVersions).set({ json: p }).where(eq(profileVersions.id, cur.id));
    return { profileId: row.id, versionId: cur.id, created: false, updated: false };
  }
  const versionId = newId("pfv");
  await db.insert(profileVersions).values({ id: versionId, profileId: row.id, version: (cur?.version ?? 0) + 1, json: p, ...h, createdBy, note: note ?? null });
  await db.update(profiles).set({ currentVersionId: versionId, updatedAt: new Date() }).where(eq(profiles.id, row.id));
  return { profileId: row.id, versionId, created: false, updated: true };
}

export async function upsertBuiltins(db: Db, packs: SearchProfilePack[]): Promise<{ created: number; updated: number }> {
  let created = 0, updated = 0;
  for (const pack of packs) for (const p of pack.profiles) {
    const r = await upsertProfileVersion(db, null, p, "builtin", "builtin");
    if (r.created) created++;
    if (r.updated) updated++;
    if (r.updated && process.env.SEARCH_AUTO_UPDATE_BUILTINS === "1") await db.update(sources).set({ profileVersionId: r.versionId }).where(eq(sources.profileId, r.profileId));
  }
  return { created, updated };
}

export interface BuiltinProfileRow { profileId: string; versionId: string; json: SearchProfile }

export async function builtinProfiles(db: Db): Promise<BuiltinProfileRow[]> {
  const rows = await db.select({ p: profiles, v: profileVersions }).from(profiles).innerJoin(profileVersions, eq(profileVersions.id, profiles.currentVersionId)).where(isNull(profiles.userId));
  return rows.map((r) => ({ profileId: r.p.id, versionId: r.v.id, json: r.v.json })).sort((a, b) => a.json.id.localeCompare(b.json.id));
}

/** The connection key a source made before its platform was granted holds until ensureSources attaches the real one. */
export const pendingKey = (platform: string) => `pending:${platform}`;

export async function createSource(db: Db, o: { userId: string; platform: string; connectionKey: string; connectionLabel: string; profileId: string; versionId: string; profile: SearchProfile; mode: "fixture" | "connect"; awaitingGrant?: boolean }): Promise<string> {
  const [have] = await db.select({ id: sources.id }).from(sources).where(and(eq(sources.userId, o.userId), eq(sources.connectionKey, o.connectionKey), eq(sources.profileId, o.profileId)));
  if (have) return have.id;
  const id = newId("src");
  await db.insert(sources).values({
    id, userId: o.userId, platform: o.platform, connectionKey: o.connectionKey, connectionLabel: o.connectionLabel,
    profileId: o.profileId, profileVersionId: o.versionId, mode: o.mode, status: o.awaitingGrant ? "awaiting_grant" : "new",
    scheduleEvery: parseDuration(o.profile.schedule?.every ?? "30m") ?? 1_800_000, nextRunAt: o.awaitingGrant ? null : new Date(),
  }).onConflictDoNothing();
  const [row] = await db.select({ id: sources.id }).from(sources).where(and(eq(sources.userId, o.userId), eq(sources.connectionKey, o.connectionKey), eq(sources.profileId, o.profileId)));
  return row?.id ?? id;
}

/** The sample user's sources: every enabled built-in on `sample:<platform>`, and again on each
 *  extra sample account the fixtures name (a second Gmail). Idempotent. */
export async function createSampleSources(db: Db, userId: string, opts: { platforms?: string[]; connections?: { key: string; platform: string; label: string }[] } = {}): Promise<string[]> {
  const ids: string[] = [];
  const extra = opts.connections ?? [];
  for (const b of await builtinProfiles(db)) {
    if (b.json.enabledByDefault === false) continue;
    if (opts.platforms && !opts.platforms.includes(b.json.platform)) continue;
    const more = extra.filter((c) => c.platform === b.json.platform);
    // with two accounts on a platform the first is named too, so results say which inbox
    const first = more.length ? "dana@acme.com" : "Acme sample";
    ids.push(await createSource(db, { userId, platform: b.json.platform, connectionKey: `sample:${b.json.platform}`, connectionLabel: first, profileId: b.profileId, versionId: b.versionId, profile: b.json, mode: "fixture" }));
    for (const c of more) ids.push(await createSource(db, { userId, platform: c.platform, connectionKey: c.key, connectionLabel: c.label, profileId: b.profileId, versionId: b.versionId, profile: b.json, mode: "fixture" }));
  }
  return ids;
}

/** The list actions a connection's sources already call: a built-in on the same action would index the same records twice. */
async function listActionsOn(db: Db, userId: string, connectionKey: string): Promise<Set<string>> {
  const rows = await db.select({ json: profileVersions.json }).from(sources).innerJoin(profileVersions, eq(profileVersions.id, sources.profileVersionId))
    .where(and(eq(sources.userId, userId), eq(sources.connectionKey, connectionKey)));
  return new Set(rows.map((r) => r.json.list.actionId));
}

/** One source per connection x enabled built-in: one per account, so a second calendar is its own source (D46).
 *  Returns every source id, and which of them this call made. */
async function builtinSources(ctx: EngineCtx, userId: string, conns: GrantedConnection[]): Promise<{ ids: string[]; created: string[] }> {
  const builtins = await builtinProfiles(ctx.db);
  const ids: string[] = [];
  const created: string[] = [];
  for (const c of conns) {
    const have = await listActionsOn(ctx.db, userId, c.key);
    for (const b of builtins) {
      if (b.json.platform !== c.platform || b.json.enabledByDefault === false || b.json.sampleOnly) continue;
      const [mine] = await ctx.db.select({ id: sources.id }).from(sources).where(and(eq(sources.userId, userId), eq(sources.connectionKey, c.key), eq(sources.profileId, b.profileId)));
      if (mine) { ids.push(mine.id); continue; }
      // the user's own profile already lists these records on this account (a Drive profile made before the built-in)
      if (have.has(b.json.list.actionId)) continue;
      const id = await createSource(ctx.db, { userId, platform: c.platform, connectionKey: c.key, connectionLabel: c.title ?? c.name ?? c.platform, profileId: b.profileId, versionId: b.versionId, profile: b.json, mode: "connect" });
      ids.push(id);
      created.push(id);
    }
  }
  return { ids, created };
}

/** Connections that joined the grant since the last sign-in (a second calendar added in One) get their
 *  built-in sources. Nothing else changes: stopped sources stay stopped until a sign-in. */
export async function attachNewConnections(ctx: EngineCtx, userId: string): Promise<string[]> {
  const conns = (await grantedConnections(ctx.oneConnect, userId)).filter((c) => !AI_PLATFORMS.has(c.platform));
  return (await builtinSources(ctx, userId, conns)).created;
}

/** One source per indexable connection x enabled built-in profile (real users), plus the
 *  sources New profile saved before their platform was granted, now attached to it. */
export async function ensureSources(ctx: EngineCtx, userId: string): Promise<string[]> {
  const conns = await grantedConnections(ctx.oneConnect, userId);
  const ids: string[] = (await builtinSources(ctx, userId, conns)).ids;
  const waiting = await ctx.db.select().from(sources).where(and(eq(sources.userId, userId), eq(sources.status, "awaiting_grant")));
  // a waiting source goes to every account of its platform: the first takes the waiting row, the rest get their own
  for (const w of waiting) {
    const accounts = conns.filter((x) => x.platform === w.platform);
    let placed = false;
    for (const c of accounts) {
      const label = c.title ?? c.name ?? c.platform;
      const [taken] = await ctx.db.select({ id: sources.id }).from(sources).where(and(eq(sources.userId, userId), eq(sources.connectionKey, c.key), eq(sources.profileId, w.profileId)));
      if (taken) { ids.push(taken.id); continue; }
      if (!placed) {
        await ctx.db.update(sources).set({ connectionKey: c.key, connectionLabel: label, status: "new", nextRunAt: new Date(), lastError: null }).where(eq(sources.id, w.id));
        placed = true;
        ids.push(w.id);
        continue;
      }
      const [v] = await ctx.db.select().from(profileVersions).where(eq(profileVersions.id, w.profileVersionId));
      if (v) ids.push(await createSource(ctx.db, { userId, platform: c.platform, connectionKey: c.key, connectionLabel: label, profileId: w.profileId, versionId: w.profileVersionId, profile: v.json, mode: w.mode }));
    }
    // every account already had it: the waiting copy is a duplicate
    if (accounts.length && !placed) await ctx.db.delete(sources).where(eq(sources.id, w.id));
  }
  // A fresh sign-in can carry a wider grant, and the scheduler never retries
  // sources stopped by the grant or by auth on its own. Give them another run.
  const stopped = await ctx.db.update(sources).set({ status: "new", nextRunAt: new Date() })
    .where(and(eq(sources.userId, userId), inArray(sources.status, ["grant_blocked", "auth_needed"])))
    .returning({ id: sources.id });
  for (const r of stopped) if (!ids.includes(r.id)) ids.push(r.id);
  return ids;
}
