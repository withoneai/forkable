// The in-process scheduler (SPEC 13): a 30 s tick starts due source runs (at most
// SEARCH_SYNC_CONCURRENCY at once), and a 5 s worker loop embeds, classifies and
// matches entities for users whose index changed. Sample sources run the same
// path on the fixture transport. Everything reads deps per call, so a Connect
// reload reaches the next run.

import { and, eq, inArray, isNotNull, isNull, lt, lte, notInArray, or, sql } from "drizzle-orm";
import { attachNewConnections, classifyPending, dbSchema, embedPending, runEntityMatch, runSource, sourceHealth, type RunSummary, type RunTrigger, type SourceHealth } from "@search/core";
import type { Deps } from "./deps.js";

const { sources, runs, users, settings, oauthPending, oauthCodes, oauthTokens, ledger, pendingEmbeddings, connectUsers } = dbSchema;

export interface KickOptions { trigger: RunTrigger; full?: boolean; estimate?: number | null }

export interface Scheduler {
  start(): void;
  stop(): void;
  /** Starts a run now (or joins the one in flight). Resolves when it ends. */
  kick(sourceId: string, opts: KickOptions): Promise<RunSummary | null>;
  isRunning(sourceId: string): boolean;
  /** The first-run estimate while a run is in flight. */
  progress(sourceId: string): SourceHealth["progress"] | undefined;
  /** Embed, classify and match for a user now (sample bootstrap, tests). */
  runWorkers(userId: string, opts?: { match?: boolean }): Promise<void>;
  markDirty(userId: string): void;
  /** Sources the tick must leave alone (the sample bootstrap runs them itself). */
  hold(sourceIds: string[]): () => void;
  tick(): Promise<void>;
  idle(): Promise<void>;
}

const TICK_MS = 30_000;
const WORK_MS = 5_000;
const MATCH_EVERY_MS = 60_000;
/** How often the tick looks for connections that joined a grant without a sign-in (D46). */
const ATTACH_EVERY_MS = 10 * 60_000;
const HOUR = 3_600_000;

export function createScheduler(deps: Deps): Scheduler {
  const bootAt = new Date();
  const inFlight = new Map<string, Promise<RunSummary | null>>();
  const estimates = new Map<string, number | null>();
  /** Items indexed so far by the run in flight, from its live progress. */
  const done = new Map<string, number>();
  const held = new Set<string>();
  const dirty = new Set<string>();
  const lastMatch = new Map<string, number>();
  const workerBusy = new Set<string>();
  let tickTimer: NodeJS.Timeout | null = null;
  let workTimer: NodeJS.Timeout | null = null;
  let lastCleanup = 0;
  let lastAttach = Date.now();
  let stopped = false;
  const log = (l: string) => deps.log(`[search] ${l}`);

  // Every run, scheduled or kicked (sign-in, Sync now, a new profile), waits for one
  // of SYNC_CONCURRENCY slots, so a sign-in with many sources cannot start them all
  // at once and starve the request path of database connections.
  let active = 0;
  const waiting: Array<() => void> = [];
  async function slot(): Promise<() => void> {
    if (active >= deps.env.SYNC_CONCURRENCY) await new Promise<void>((r) => waiting.push(r));
    active++;
    let freed = false;
    return () => {
      if (freed) return;
      freed = true;
      active--;
      waiting.shift()?.();
    };
  }

  async function emitHealth(userId: string, sourceId: string): Promise<void> {
    try {
      const h = await sourceHealth(deps.db, sourceId);
      const p = inFlight.has(sourceId) ? { done: done.get(sourceId) ?? 0, estimate: estimates.get(sourceId) ?? null } : undefined;
      deps.hub.emit(userId, { type: "source", sourceId, health: p ? { ...h, status: "syncing", progress: p } : h });
    } catch { /* gone */ }
  }

  function kick(sourceId: string, opts: KickOptions): Promise<RunSummary | null> {
    const running = inFlight.get(sourceId);
    if (running) return running;
    const p = (async () => {
      const [s] = await deps.db.select({ userId: sources.userId, itemCount: sources.itemCount }).from(sources).where(eq(sources.id, sourceId));
      if (!s) return null;
      estimates.set(sourceId, opts.estimate ?? (s.itemCount || null));
      await emitHealth(s.userId, sourceId);
      const release = await slot();
      try {
        const sum = await runSource(deps.ctx, sourceId, {
          trigger: opts.trigger, full: opts.full,
          onProgress: (p) => {
            done.set(sourceId, p.itemCount ?? Math.max(done.get(sourceId) ?? 0, p.upserted + p.unchanged));
            void emitHealth(s.userId, sourceId);
          },
        });
        if (sum.upserted || sum.tombstoned) dirty.add(s.userId);
        return sum;
      } catch (e) {
        log(`run ${sourceId} failed: ${(e as Error).message}`);
        return null;
      } finally {
        release();
        inFlight.delete(sourceId);
        estimates.delete(sourceId);
        done.delete(sourceId);
        await emitHealth(s.userId, sourceId);
      }
    })();
    inFlight.set(sourceId, p);
    return p;
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    const now = new Date();
    const room = deps.env.SYNC_CONCURRENCY - inFlight.size;
    if (room > 0) {
      const due = await deps.db.select({ id: sources.id, userId: sources.userId, lastSuccessAt: sources.lastSuccessAt })
        .from(sources)
        .where(and(lte(sources.nextRunAt, now), notInArray(sources.status, ["paused", "auth_needed", "grant_blocked", "awaiting_grant"])))
        .orderBy(sources.nextRunAt)
        .limit(room + inFlight.size + held.size + 20);
      const pausedUsers = new Set((await deps.db.select({ userId: settings.userId }).from(settings).where(sql`(${settings.data}->>'paused')::boolean is true`)).map((r) => r.userId));
      let started = 0;
      for (const d of due) {
        if (started >= room) break;
        if (inFlight.has(d.id) || held.has(d.id) || pausedUsers.has(d.userId)) continue;
        void kick(d.id, { trigger: d.lastSuccessAt ? "schedule" : "first" });
        started++;
      }
    }
    if (deps.oneConnect && Date.now() - lastAttach > ATTACH_EVERY_MS) {
      lastAttach = Date.now();
      await attachAll().catch((e) => log(`looking for new connections failed: ${(e as Error).message}`));
    }
    if (Date.now() - lastCleanup > HOUR) {
      lastCleanup = Date.now();
      await cleanup().catch((e) => log(`cleanup failed: ${(e as Error).message}`));
    }
  }

  /**
   * Runs a previous process left "running" (a restart, a crash) never finish on
   * their own: close them as cancelled and put their sources back in the queue.
   * Only one server may own a data dir, so nothing else can be mid-run here.
   */
  async function recoverInterrupted(bootAt: Date): Promise<void> {
    const now = new Date();
    // only runs that began before this process did, never one a boot-time kick just started
    const stale = await deps.db.update(runs).set({ outcome: "cancelled", finishedAt: now })
      .where(and(eq(runs.outcome, "running"), isNull(runs.finishedAt), lt(runs.startedAt, bootAt)))
      .returning({ sourceId: runs.sourceId });
    const ids = [...new Set(stale.map((r) => r.sourceId))];
    const syncing = await deps.db.select({ id: sources.id, lastSuccessAt: sources.lastSuccessAt }).from(sources)
      .where(and(eq(sources.status, "syncing"), or(isNull(sources.lastAttemptAt), lt(sources.lastAttemptAt, bootAt))));
    for (const src of syncing) {
      await deps.db.update(sources).set({ status: src.lastSuccessAt ? "healthy" : "new", nextRunAt: now }).where(eq(sources.id, src.id));
      if (!ids.includes(src.id)) ids.push(src.id);
    }
    if (ids.length) log(`closed ${stale.length} interrupted run(s); ${ids.length} source(s) queued again`);
  }

  /** A connection added to a grant in One (a second calendar) becomes a source without a new sign-in. */
  async function attachAll(): Promise<void> {
    const signedIn = await deps.db.select({ userId: connectUsers.userId }).from(connectUsers);
    for (const { userId } of signedIn) {
      const made = await attachNewConnections(deps.ctx, userId);
      if (made.length) log(`${made.length} new source(s) for connections added to a grant`);
      for (const id of made) void kick(id, { trigger: "first" });
    }
  }

  async function cleanup(): Promise<void> {
    const now = new Date();
    await deps.db.delete(oauthPending).where(lt(oauthPending.expiresAt, now));
    await deps.db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, now));
    await deps.db.delete(oauthTokens).where(or(lt(oauthTokens.expiresAt, now), and(isNotNull(oauthTokens.revokedAt), lt(oauthTokens.revokedAt, new Date(now.getTime() - 7 * 24 * HOUR)))));
    await deps.db.delete(ledger).where(lt(ledger.at, new Date(now.getTime() - 90 * 24 * HOUR)));
  }

  async function runWorkers(userId: string, opts: { match?: boolean } = {}): Promise<void> {
    if (workerBusy.has(userId)) return;
    workerBusy.add(userId);
    try {
      const e = await embedPending(deps.ctx, userId, 512).catch((err) => { log(`embed failed: ${(err as Error).message}`); return { embedded: 0, cached: 0, failed: 0 }; });
      const due = opts.match || Date.now() - (lastMatch.get(userId) ?? 0) >= MATCH_EVERY_MS;
      let m = { merged: 0, pending: 0 };
      if (due) {
        lastMatch.set(userId, Date.now());
        m = await runEntityMatch(deps.ctx, userId).catch((err) => { log(`entity match failed: ${(err as Error).message}`); return { merged: 0, pending: 0, rejected: 0 }; });
      }
      const k = await classifyPending(deps.ctx, userId, 200).catch((err) => { log(`classify failed: ${(err as Error).message}`); return { judged: 0, failed: 0 }; });
      if (e.embedded + e.cached + k.judged + m.merged > 0) deps.hub.emit(userId, { type: "index", added: 0, updated: k.judged, removed: 0, sourceId: "" });
      const [{ n } = { n: 0 }] = await deps.db.select({ n: sql<number>`count(*)::int` }).from(pendingEmbeddings).where(and(eq(pendingEmbeddings.userId, userId), lte(pendingEmbeddings.nextAt, new Date())));
      if (!n && !k.judged && due) dirty.delete(userId);
    } finally {
      workerBusy.delete(userId);
    }
  }

  async function work(): Promise<void> {
    if (stopped) return;
    for (const u of [...dirty]) await runWorkers(u);
  }

  return {
    start() {
      stopped = false;
      tickTimer = setInterval(() => { void tick().catch((e) => log(`tick failed: ${(e as Error).message}`)); }, TICK_MS);
      workTimer = setInterval(() => { void work().catch((e) => log(`workers failed: ${(e as Error).message}`)); }, WORK_MS);
      tickTimer.unref();
      workTimer.unref();
      void recoverInterrupted(bootAt).catch((e) => log(`recovering interrupted runs failed: ${(e as Error).message}`));
      // users with work left over from a previous process
      void deps.db.selectDistinct({ userId: pendingEmbeddings.userId }).from(pendingEmbeddings).then((r) => r.forEach((x) => dirty.add(x.userId))).catch(() => {});
      setTimeout(() => { void tick().catch(() => {}); }, 2_000).unref();
    },
    stop() {
      stopped = true;
      if (tickTimer) clearInterval(tickTimer);
      if (workTimer) clearInterval(workTimer);
    },
    kick,
    isRunning: (id) => inFlight.has(id),
    progress: (id) => (inFlight.has(id) ? { done: done.get(id) ?? 0, estimate: estimates.get(id) ?? null } : undefined),
    runWorkers,
    markDirty: (u) => { dirty.add(u); },
    hold(ids) { for (const i of ids) held.add(i); return () => { for (const i of ids) held.delete(i); }; },
    tick,
    async idle() { await Promise.allSettled([...inFlight.values()]); },
  };
}

export { users, inArray };
