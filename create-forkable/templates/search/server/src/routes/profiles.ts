// Profiles (list, versions, edit, fork, export, import, validate), the catalog and
// connections, and the New profile drafts (SPEC 10, CONTRACT 6.2).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  acceptImport, connectionsFor, createDraft, pickModels, draftActionIds, dbSchema, discardDraft, dryRun, exportPack, fetchPackUrl, getDraft, hashProfile, importPack,
  listPlatforms, patchDraft, previewDraft, reproposeDraft, saveDraft, upsertProfileVersion, validateDraft, validateProfile, draftEstimate,
  type SearchProfile,
} from "@search/core";
import { assistDraft, type AssistInput } from "@search/core/mapper/assist";
import { connectExtraFile } from "../config.js";
import type { AppEnv } from "../deps.js";
import { ApiError, badRequest, notFound } from "../errors.js";
import { requireUser } from "../session.js";
import { apiProfile } from "../views.js";
import { cookieOnly, need, readJson } from "./lib.js";
import { localOnly } from "./setup.js";

const { profiles, profileVersions, sources, items, runs } = dbSchema;

export const profileRoutes = new Hono<AppEnv>();

profileRoutes.get("/profiles", async (c) => {
  need(c, "search:read");
  const u = await requireUser(c);
  const deps = c.get("deps");
  const rows = await deps.db.select({ id: profiles.id }).from(profiles).where(or(isNull(profiles.userId), eq(profiles.userId, u.id))).orderBy(profiles.platform, profiles.slug);
  return c.json(await Promise.all(rows.map((r) => apiProfile(deps, r.id, u.id))));
});

profileRoutes.get("/profiles/:id", async (c) => {
  need(c, "search:read");
  const u = await requireUser(c);
  return c.json(await apiProfile(c.get("deps"), c.req.param("id"), u.id));
});

profileRoutes.get("/profiles/:id/versions", async (c) => {
  need(c, "search:read");
  const u = await requireUser(c);
  const deps = c.get("deps");
  await apiProfile(deps, c.req.param("id"), u.id);
  const rows = await deps.db.select().from(profileVersions).where(eq(profileVersions.profileId, c.req.param("id"))).orderBy(desc(profileVersions.version));
  return c.json(rows.map((r) => ({ version: r.version, profileHash: r.profileHash, createdAt: r.createdAt.toISOString(), note: r.note })));
});

async function ownCopy(c: Parameters<typeof requireUser>[0], userId: string, profileId: string, json?: SearchProfile, note?: string): Promise<{ profileId: string; versionId: string; prevVersionId: string | null; builtinId: string | null }> {
  const deps = c.get("deps");
  const [p] = await deps.db.select().from(profiles).where(and(eq(profiles.id, profileId), or(isNull(profiles.userId), eq(profiles.userId, userId))));
  if (!p) throw notFound("Profile");
  const [cur] = p.currentVersionId ? await deps.db.select().from(profileVersions).where(eq(profileVersions.id, p.currentVersionId)) : [];
  const body = { ...(json ?? cur!.json), author: userId };
  const origin = p.userId ? p.origin : "user";
  const r = await upsertProfileVersion(deps.db, userId, body, origin, userId, note ?? (p.userId ? "Edited" : "Copied from the built-in"));
  return { profileId: r.profileId, versionId: r.versionId, prevVersionId: p.currentVersionId, builtinId: p.userId ? null : p.id };
}

profileRoutes.put("/profiles/:id", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  const deps = c.get("deps");
  const b = await readJson<{ json?: SearchProfile; note?: string }>(c);
  if (!b.json) throw badRequest("json is required.");
  const report = validateProfile(b.json);
  if (!report.ok) throw new ApiError(400, "invalid_profile", "The profile does not validate.", { report });
  const [old] = await deps.db.select({ v: profileVersions }).from(profiles).innerJoin(profileVersions, eq(profileVersions.id, profiles.currentVersionId)).where(eq(profiles.id, c.req.param("id")));
  const r = await ownCopy(c, u.id, c.req.param("id"), b.json, b.note);
  const h = hashProfile(b.json);
  const effect = !old ? "none" : old.v.fetchHash !== h.fetchHash ? "refetch" : old.v.mapHash !== h.mapHash ? "remap" : old.v.indexHash !== h.indexHash ? "reindex" : "none";
  // the user's sources on this profile (or on the built-in it copied) move to the new version
  const mine = await deps.db.select().from(sources).where(and(eq(sources.userId, u.id), inArray(sources.profileId, [c.req.param("id"), r.profileId])));
  for (const s of mine) await deps.db.update(sources).set({ profileId: r.profileId, profileVersionId: r.versionId }).where(eq(sources.id, s.id));
  const [{ n } = { n: 0 }] = mine.length ? await deps.db.select({ n: sql<number>`count(*)::int` }).from(items).where(and(inArray(items.sourceId, mine.map((s) => s.id)), isNull(items.deletedAt))) : [];
  if (effect !== "none") for (const s of mine) if (!deps.scheduler.isRunning(s.id)) void deps.scheduler.kick(s.id, { trigger: effect === "remap" ? "remap" : effect === "reindex" ? "reindex" : "manual", full: effect === "refetch" });
  return c.json({ profile: await apiProfile(deps, r.profileId, u.id), report, effect, affectedItems: n });
});

profileRoutes.post("/profiles/:id/fork", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  const r = await ownCopy(c, u.id, c.req.param("id"));
  return c.json(await apiProfile(c.get("deps"), r.profileId, u.id));
});

profileRoutes.get("/profiles/:id/export", async (c) => {
  need(c, "search:read");
  const u = await requireUser(c);
  const pack = await exportPack(c.get("deps").db, u.id, c.req.param("id"));
  c.header("content-disposition", `attachment; filename="${pack.profiles[0]!.id}.json"`);
  return c.json(pack);
});

profileRoutes.post("/profiles/import", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  const b = await readJson<{ pack?: unknown; url?: string }>(c);
  if (b.url) return c.json(await importPack(c.get("deps").db, u.id, await fetchPackUrl(b.url), { origin: "url", url: b.url }));
  if (b.pack === undefined) throw badRequest("Send { pack } or { url }.");
  const pack = typeof b.pack === "string" ? (() => { try { return JSON.parse(b.pack); } catch { throw badRequest("The pasted text is not JSON."); } })() : b.pack;
  return c.json(await importPack(c.get("deps").db, u.id, pack));
});

profileRoutes.post("/profiles/import/:importId/accept", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  const ids = await acceptImport(c.get("deps").db, u.id, c.req.param("importId"));
  return c.json(await Promise.all(ids.map((id) => apiProfile(c.get("deps"), id, u.id))));
});

profileRoutes.post("/profiles/validate", async (c) => {
  need(c, "search:read");
  await requireUser(c);
  const b = await readJson<{ json?: unknown }>(c);
  return c.json(validateProfile(b.json));
});

// ---------- catalog and connections ----------

profileRoutes.get("/catalog/platforms", async (c) => {
  need(c, "search:read");
  const u = await requireUser(c);
  return c.json({ platforms: await listPlatforms(c.get("deps").ctx, u.id, c.req.query("q") ?? "") });
});

profileRoutes.get("/connections", async (c) => {
  need(c, "search:read");
  const u = await requireUser(c);
  return c.json(await connectionsFor(c.get("deps").ctx, u.id));
});

// ---------- drafts ----------

profileRoutes.post("/profile-drafts", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  const b = await readJson<{ platform?: string; connectionKey?: string; models?: string[] }>(c);
  if (!b.platform) throw badRequest("platform is required.");
  return c.json(await createDraft(c.get("deps").ctx, u.id, { platform: b.platform, connectionKey: b.connectionKey, ...(Array.isArray(b.models) ? { models: b.models.map(String) } : {}) }));
});

profileRoutes.post("/profile-drafts/:id/models", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  const b = await readJson<{ models?: string[] }>(c);
  if (!Array.isArray(b.models) || !b.models.length) throw badRequest("models is required: the model keys to map.");
  return c.json(await pickModels(c.get("deps").ctx, u.id, c.req.param("id"), b.models.map(String)));
});

profileRoutes.get("/profile-drafts/:id", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  return c.json(await getDraft(c.get("deps").ctx, u.id, c.req.param("id")));
});

profileRoutes.patch("/profile-drafts/:id", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  const b = await readJson<{ step?: "platform" | "models" | "fields" | "identity" | "review"; edits?: { selected?: string[]; profiles?: Record<string, Partial<SearchProfile>> } }>(c);
  return c.json(await patchDraft(c.get("deps").ctx, u.id, c.req.param("id"), b));
});

profileRoutes.post("/profile-drafts/:id/dry-run", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  const b = await readJson<{ actionId?: string }>(c);
  if (!b.actionId) throw badRequest("actionId is required.");
  return c.json(await dryRun(c.get("deps").ctx, u.id, c.req.param("id"), b.actionId));
});

profileRoutes.post("/profile-drafts/:id/repropose", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  const b = await readJson<{ hint?: string }>(c);
  return c.json(await reproposeDraft(c.get("deps").ctx, u.id, c.req.param("id"), b.hint));
});

profileRoutes.post("/profile-drafts/:id/preview", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  const b = await readJson<{ profileId?: string }>(c);
  if (!b.profileId) throw badRequest("profileId is required.");
  return c.json(await previewDraft(c.get("deps").ctx, u.id, c.req.param("id"), b.profileId));
});

/** The mapping assistant: a reply plus edit ops the sheet applies (it keeps the Undo). */
profileRoutes.post("/profile-drafts/:id/assist", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  const b = await readJson<Partial<AssistInput>>(c);
  if (typeof b.message !== "string" || !b.message.trim()) throw badRequest("message is required.");
  const state = (b.state ?? { step: "", selected: [], rows: {}, identity: {} }) as AssistInput["state"];
  return c.json(await assistDraft(c.get("deps").ctx, u.id, c.req.param("id"), { message: b.message, history: Array.isArray(b.history) ? b.history : [], state }));
});

profileRoutes.post("/profile-drafts/:id/validate", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  return c.json(await validateDraft(c.get("deps").ctx, u.id, c.req.param("id")));
});

profileRoutes.post("/profile-drafts/:id/save", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  const deps = c.get("deps");
  const b = await readJson<{ name?: string; profiles?: string[]; connectionKeys?: string[] }>(c);
  const r = await saveDraft(deps.ctx, u.id, c.req.param("id"), { name: b.name, profiles: b.profiles ?? [], ...(Array.isArray(b.connectionKeys) ? { connectionKeys: b.connectionKeys.map(String) } : {}) });
  const since = new Date(Date.now() - 1000);
  for (const sid of r.sourceIds) {
    const [s] = await deps.db.select({ profileVersionId: sources.profileVersionId }).from(sources).where(eq(sources.id, sid));
    const [v] = s ? await deps.db.select({ json: profileVersions.json }).from(profileVersions).where(eq(profileVersions.id, s.profileVersionId)) : [];
    const estimate = v ? await draftEstimate(deps.ctx, u.id, c.req.param("id"), v.json.list.actionId) : null;
    void deps.scheduler.kick(sid, { trigger: "first", estimate });
  }
  for (let i = 0; i < 30 && r.firstRunIds.length < r.sourceIds.length; i++) {
    const rows = await deps.db.select({ id: runs.id, sourceId: runs.sourceId }).from(runs).where(and(inArray(runs.sourceId, r.sourceIds), sql`${runs.startedAt} >= ${since}`));
    if (rows.length >= r.sourceIds.length) r.firstRunIds = r.sourceIds.map((s) => rows.find((x) => x.sourceId === s)?.id ?? `pending:${s}`);
    else await new Promise((res) => setTimeout(res, 50));
  }
  if (!r.firstRunIds.length) r.firstRunIds = r.sourceIds.map((s) => `pending:${s}`);
  return c.json(r);
});

/**
 * D26: the actions a draft's chosen profiles call join the Connect ask by id
 * (connect.extra.json), merged into the platform's custom ask. Only ids the ask
 * does not already name are written. With no profiles yet (an old client) the
 * platform joins as read-only, as before.
 */
profileRoutes.post("/profile-drafts/:id/widen-ask", async (c) => {
  cookieOnly(c);
  localOnly(c);
  const u = await requireUser(c);
  const deps = c.get("deps");
  const b = await readJson<{ profiles?: string[] }>(c).catch(() => ({} as { profiles?: string[] }));
  const { platform, actionIds } = await draftActionIds(deps.ctx, u.id, c.req.param("id"), Array.isArray(b.profiles) ? b.profiles.map(String) : undefined);
  // The Acme sample (and every UI test, which signs in as it) never changes the
  // Connect app a real user approves: nothing is written.
  if (u.isSample) return c.json({ written: null, next: "sample", added: [] });
  const file = connectExtraFile(deps.env);
  const cur = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { platforms?: Record<string, { access?: string; actions?: string[] }> }) : {};
  const platforms = { ...(cur.platforms ?? {}) };
  const entry = { ...(platforms[platform] ?? {}) };
  let added: string[] = [];
  if (!Array.isArray(b.profiles) || !b.profiles.length) {
    if (entry.access === "read-only") return c.json({ written: null, next: "none", added });
    entry.access = "read-only";
  } else {
    const manifest = JSON.parse(readFileSync(resolve(deps.env.ROOT, "connect.manifest.json"), "utf8")) as { actions: { platform: string; actionId: string; grant?: boolean }[] };
    const asked = new Set([...manifest.actions.filter((a) => a.platform === platform && a.grant !== false).map((a) => a.actionId), ...(entry.actions ?? [])]);
    added = actionIds.filter((a) => !asked.has(a));
    if (!added.length) return c.json({ written: null, next: "none", added });
    entry.actions = [...(entry.actions ?? []), ...added];
  }
  platforms[platform] = entry;
  writeFileSync(file, `${JSON.stringify({ platforms }, null, 2)}\n`);
  deps.log(`[search] ${platform}: ${added.length ? `${added.length} actions` : "read-only"} added to the Connect ask (${file}) by ${u.id}`);
  return c.json({ written: "connect.extra.json", next: "update_connect_app", added });
});

profileRoutes.delete("/profile-drafts/:id", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  await discardDraft(c.get("deps").ctx, u.id, c.req.param("id"));
  return c.body(null, 204);
});
