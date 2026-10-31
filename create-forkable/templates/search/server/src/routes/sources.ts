// Sources, runs and item errors (CONTRACT 6.2), and the Acme sample sign-in.

import { Hono } from "hono";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { createSource, dbSchema, fetchIsStale, parseDuration, recountEntities, settingsFor, type RunTrigger } from "@search/core";
import type { AppEnv } from "../deps.js";
import { ApiError, badRequest, conflict, notFound } from "../errors.js";
import { bootstrapSample, SAMPLE_USER } from "../sample.js";
import { bindSid, requireUser } from "../session.js";
import { apiSource, sourceFor, sourcesResponse } from "../views.js";
import { connectionsFor } from "@search/core";
import { cookieOnly, int, need, readJson } from "./lib.js";

const { sources, runs, itemErrors, profiles, profileVersions, items, chunks, rawItems, entityLinks, classifications, pendingEmbeddings, sourceCursors, users, rerankScores } = dbSchema;

export const sourceRoutes = new Hono<AppEnv>();

sourceRoutes.get("/sources", async (c) => {
  need(c, "search:read");
  const u = await requireUser(c);
  return c.json(await sourcesResponse(c.get("deps"), u));
});

/** "Try the Acme sample": the session becomes the shared sample user; the world is indexed the first time. */
sourceRoutes.post("/sources/sample", async (c) => {
  cookieOnly(c);
  const deps = c.get("deps");
  await bootstrapSample(deps);
  await bindSid(deps.db, c.get("sid"), SAMPLE_USER);
  const [u] = await deps.db.select().from(users).where(eq(users.id, SAMPLE_USER));
  c.set("user", u!);
  return c.json(await sourcesResponse(deps, u!));
});

sourceRoutes.post("/sources", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  const deps = c.get("deps");
  const b = await readJson<{ platform?: string; connectionKey?: string; profileId?: string }>(c);
  if (!b.platform || !b.connectionKey || !b.profileId) throw badRequest("platform, connectionKey and profileId are required.");
  const conn = (await connectionsFor(deps.ctx, u.id)).find((x) => x.key === b.connectionKey && x.platform === b.platform);
  if (!conn) throw new ApiError(409, "not_connected", `${b.platform} on that connection is not in your grant.`, { platform: b.platform });
  const [p] = await deps.db.select().from(profiles).where(eq(profiles.id, b.profileId));
  if (!p || (p.userId && p.userId !== u.id) || p.platform !== b.platform || !p.currentVersionId) throw notFound("Profile");
  const [v] = await deps.db.select().from(profileVersions).where(eq(profileVersions.id, p.currentVersionId));
  const [had] = await deps.db.select({ id: sources.id }).from(sources).where(and(eq(sources.userId, u.id), eq(sources.connectionKey, conn.key), eq(sources.profileId, p.id)));
  const id = await createSource(deps.db, { userId: u.id, platform: b.platform, connectionKey: conn.key, connectionLabel: conn.title ?? conn.name ?? b.platform, profileId: p.id, versionId: v!.id, profile: v!.json, mode: u.isSample ? "fixture" : "connect" });
  if (!had) void deps.scheduler.kick(id, { trigger: "first" });
  const [s] = await deps.db.select().from(sources).where(eq(sources.id, id));
  return c.json(await apiSource(deps, s!));
});

sourceRoutes.get("/sources/:id", async (c) => {
  need(c, "search:read");
  const u = await requireUser(c);
  return c.json(await apiSource(c.get("deps"), await sourceFor(c.get("deps"), u.id, c.req.param("id"))));
});

sourceRoutes.patch("/sources/:id", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  const deps = c.get("deps");
  const s = await sourceFor(deps, u.id, c.req.param("id"));
  const b = await readJson<{ paused?: boolean; scheduleEvery?: string; settings?: Record<string, unknown> }>(c);
  const patch: Partial<typeof sources.$inferInsert> = {};
  if (b.scheduleEvery !== undefined) {
    const ms = parseDuration(b.scheduleEvery);
    if (!ms || ms < 60_000) throw badRequest("scheduleEvery is a duration of at least 1m, like 15m or 1h.");
    patch.scheduleEvery = ms;
    patch.nextRunAt = new Date(Date.now() + ms);
  }
  if (b.settings && typeof b.settings === "object") patch.settings = { ...s.settings, ...b.settings };
  if (b.paused === true) patch.status = "paused";
  if (b.paused === false && s.status === "paused") { patch.status = s.lastSuccessAt ? "healthy" : "new"; patch.nextRunAt = new Date(); }
  // a setting the fetch reads (Granola's transcripts, a backfill window) refetches what is already indexed: run now
  let refetch = false;
  if (patch.settings) {
    const [v] = await deps.db.select().from(profileVersions).where(eq(profileVersions.id, s.profileVersionId));
    const stale = !!v && !!s.lastSuccessAt && fetchIsStale(s.fetchHash, v.fetchHash, v.json, settingsFor(v.json, patch.settings));
    refetch = stale && (patch.status ?? s.status) !== "paused" && s.status !== "awaiting_grant";
    if (refetch) patch.nextRunAt = new Date();
  }
  if (Object.keys(patch).length) await deps.db.update(sources).set(patch).where(eq(sources.id, s.id));
  if (refetch && !deps.scheduler.isRunning(s.id)) void deps.scheduler.kick(s.id, { trigger: "manual" });
  const [row] = await deps.db.select().from(sources).where(eq(sources.id, s.id));
  const out = await apiSource(deps, row!);
  deps.hub.emit(u.id, { type: "source", sourceId: s.id, health: out.health });
  return c.json(out);
});

/** Kicks a run and answers with its id once the runs row exists (or after 1.5 s). */
async function startRun(c: Parameters<typeof requireUser>[0], sourceId: string, trigger: RunTrigger, full = false): Promise<string> {
  const deps = c.get("deps");
  if (deps.scheduler.isRunning(sourceId)) throw conflict("A run is already in flight for this source.");
  const since = new Date(Date.now() - 1000);
  void deps.scheduler.kick(sourceId, { trigger, full });
  for (let i = 0; i < 30; i++) {
    const [r] = await deps.db.select({ id: runs.id }).from(runs).where(and(eq(runs.sourceId, sourceId), gte(runs.startedAt, since))).orderBy(desc(runs.startedAt)).limit(1);
    if (r) return r.id;
    await new Promise((res) => setTimeout(res, 50));
  }
  return `pending:${sourceId}`;
}

sourceRoutes.post("/sources/:id/sync", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  const s = await sourceFor(c.get("deps"), u.id, c.req.param("id"));
  const b = await readJson<{ full?: boolean }>(c);
  return c.json({ runId: await startRun(c, s.id, "manual", !!b.full) });
});

sourceRoutes.post("/sources/:id/update-profile", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  const deps = c.get("deps");
  const s = await sourceFor(deps, u.id, c.req.param("id"));
  const b = await readJson<{ versionId?: string }>(c);
  const [p] = await deps.db.select().from(profiles).where(eq(profiles.id, s.profileId));
  const target = b.versionId ?? p?.currentVersionId;
  const [v] = target ? await deps.db.select().from(profileVersions).where(and(eq(profileVersions.id, target), eq(profileVersions.profileId, s.profileId))) : [];
  if (!v) throw notFound("Profile version");
  await deps.db.update(sources).set({ profileVersionId: v.id, scheduleEvery: parseDuration(v.json.schedule?.every ?? "") ?? s.scheduleEvery }).where(eq(sources.id, s.id));
  if (!deps.scheduler.isRunning(s.id)) void deps.scheduler.kick(s.id, { trigger: "remap" });
  const [row] = await deps.db.select().from(sources).where(eq(sources.id, s.id));
  return c.json(await apiSource(deps, row!));
});

sourceRoutes.delete("/sources/:id", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  const deps = c.get("deps");
  const s = await sourceFor(deps, u.id, c.req.param("id"));
  const b = await readJson<{ keepItems?: boolean }>(c);
  if (deps.scheduler.isRunning(s.id)) throw conflict("A run is in flight. Pause the source, then remove it.");
  await deps.db.transaction(async (tx) => {
    if (!b.keepItems) {
      const ids = (await tx.select({ id: items.id }).from(items).where(eq(items.sourceId, s.id))).map((r) => r.id);
      for (let i = 0; i < ids.length; i += 500) {
        const part = ids.slice(i, i + 500);
        const chunkIds = (await tx.select({ id: chunks.id }).from(chunks).where(inArray(chunks.itemId, part))).map((r) => r.id);
        if (chunkIds.length) {
          await tx.delete(pendingEmbeddings).where(inArray(pendingEmbeddings.chunkId, chunkIds));
          if (deps.capability.mode === "hybrid") await tx.execute(sql`delete from chunk_embeddings where chunk_id in (${sql.join(chunkIds.map((x) => sql`${x}`), sql`, `)})`);
          await tx.delete(chunks).where(inArray(chunks.id, chunkIds));
        }
        await tx.delete(classifications).where(inArray(classifications.itemId, part));
        await tx.delete(entityLinks).where(inArray(entityLinks.itemId, part));
        await tx.delete(rerankScores).where(inArray(rerankScores.itemId, part));
      }
      await tx.delete(items).where(eq(items.sourceId, s.id));
      await tx.delete(rawItems).where(eq(rawItems.sourceId, s.id));
    }
    await tx.delete(sourceCursors).where(eq(sourceCursors.sourceId, s.id));
    await tx.delete(itemErrors).where(eq(itemErrors.sourceId, s.id));
    await tx.delete(runs).where(eq(runs.sourceId, s.id));
    await tx.delete(sources).where(eq(sources.id, s.id));
  });
  if (!b.keepItems) await recountEntities(deps.db, u.id);
  return c.body(null, 204);
});

sourceRoutes.get("/sources/:id/runs", async (c) => {
  need(c, "search:read");
  const u = await requireUser(c);
  const deps = c.get("deps");
  const s = await sourceFor(deps, u.id, c.req.param("id"));
  const rows = await deps.db.select().from(runs).where(eq(runs.sourceId, s.id)).orderBy(desc(runs.startedAt)).limit(int(c.req.query("limit"), 50, 1, 500));
  return c.json(rows.map((r) => ({
    runId: r.id, sourceId: r.sourceId, trigger: r.trigger, outcome: r.outcome, fullPass: r.fullPass, pages: r.pages, fetched: r.fetched, hydrated: r.hydrated,
    upserted: r.upserted, unchanged: r.unchanged, tombstoned: r.tombstoned, skipped: r.skipped, calls: r.calls, retries: r.retries,
    startedAt: r.startedAt.toISOString(), finishedAt: (r.finishedAt ?? r.startedAt).toISOString(),
    ...(r.retryAfterAt ? { retryAt: r.retryAfterAt.toISOString() } : {}), ...(r.error ? { error: r.error } : {}),
  })));
});

sourceRoutes.get("/sources/:id/errors", async (c) => {
  need(c, "search:read");
  const u = await requireUser(c);
  const deps = c.get("deps");
  const s = await sourceFor(deps, u.id, c.req.param("id"));
  const stage = c.req.query("stage");
  const rows = await deps.db.select().from(itemErrors).where(and(eq(itemErrors.sourceId, s.id), ...(stage ? [eq(itemErrors.stage, stage as "hydrate")] : []))).orderBy(desc(itemErrors.lastAt)).limit(500);
  return c.json(rows.map((r) => ({ externalId: r.externalId, stage: r.stage, code: r.code, message: r.message, attempts: r.attempts, lastAt: r.lastAt.toISOString() })));
});

sourceRoutes.post("/sources/:id/errors/retry", async (c) => {
  need(c, "sources:write");
  const u = await requireUser(c);
  const deps = c.get("deps");
  const s = await sourceFor(deps, u.id, c.req.param("id"));
  const b = await readJson<{ externalIds?: string[] }>(c);
  const where = b.externalIds?.length ? and(eq(itemErrors.sourceId, s.id), inArray(itemErrors.externalId, b.externalIds)) : eq(itemErrors.sourceId, s.id);
  const gone = await deps.db.delete(itemErrors).where(where).returning({ id: itemErrors.externalId });
  if (gone.length && !deps.scheduler.isRunning(s.id)) void deps.scheduler.kick(s.id, { trigger: "manual", full: true });
  return c.json({ queued: gone.length });
});
