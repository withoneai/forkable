// Scheduler smoke: every run waits for one of SYNC_CONCURRENCY slots (kicks
// included, not just the tick), and a restart closes runs a previous process left
// "running" and queues their sources again. On the Acme sample, tmp home, own ports.
//
//   pnpm --filter @search/server smoke:scheduler

// Must stay the first import: fails the run if it touches the repo's Connect ask or .env.
import "@search/core/test-guard";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { dbSchema, runSource } from "@search/core";
import { startServer } from "../src/node.js";

const { runs, sources } = dbSchema;
const PORT = Number(process.env.SMOKE_PORT ?? 52378);
const PG_PORT = Number(process.env.SMOKE_PG_PORT ?? 55458);
const home = mkdtempSync(join(tmpdir(), "search-smoke-sched-"));
let failures = 0, passed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail !== undefined ? `  (${JSON.stringify(detail).slice(0, 300)})` : ""}`);
};
const env = { HOME: home, PORT, PG_PORT, SECRETS: "file" as const, ENV_DIR: home, UI_URL: undefined, ONE_CLIENT_ID: undefined, SYNC_CONCURRENCY: 2 };

let server = await startServer({ env, serveUi: false, startScheduler: false, log: () => {} });
try {
  const res = await fetch(`${server.url}/api/v1/sources/sample`, { method: "POST", headers: { host: `localhost:${PORT}` } });
  check("the Acme sample signs in and indexes", res.status === 200);
  const ids = (await server.deps.db.select({ id: sources.id }).from(sources)).map((r) => r.id);

  // 1. kicks share the slots: count runs in progress while every source is kicked at once
  let peak = 0;
  const watch = setInterval(() => {
    void server.deps.db.select({ n: sql<number>`count(*)::int` }).from(runs).where(eq(runs.outcome, "running"))
      .then(([r]) => { peak = Math.max(peak, r?.n ?? 0); }).catch(() => {});
  }, 5);
  await Promise.all(ids.map((id) => server.deps.scheduler.kick(id, { trigger: "manual" })));
  clearInterval(watch);
  check(`${ids.length} kicks never ran more than 2 at once (peak ${peak})`, peak > 0 && peak <= 2, peak);
  const left = await server.deps.db.select({ n: sql<number>`count(*)::int` }).from(runs).where(eq(runs.outcome, "running"));
  check("every kicked run finished", left[0]?.n === 0, left);

  // 2. live progress: a multi-page run writes its counters to its runs row before it ends
  const seen: { live: { fetched: number; rowFetched: number; itemCount?: number } | null } = { live: null };
  for (const id of ids) {
    await runSource(server.deps.ctx, id, {
      trigger: "manual", full: true,
      onProgress: (p) => {
        if (seen.live) return;
        void server.deps.db.select({ fetched: runs.fetched, outcome: runs.outcome }).from(runs).where(eq(runs.id, p.runId))
          .then(([r]) => { if (!seen.live && r?.outcome === "running") seen.live = { fetched: p.fetched, rowFetched: r.fetched, itemCount: p.itemCount }; });
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    if (seen.live) break;
  }
  const live = seen.live as { fetched: number; rowFetched: number } | null;
  check("a run in progress shows its counters in its runs row", !!live && live.fetched > 0 && live.rowFetched > 0, live);

  // 3. a run a crashed process left behind
  const victim = ids[0]!;
  const old = new Date(Date.now() - 60_000);
  await server.deps.db.insert(runs).values({ id: "run_stale_smoke", sourceId: victim, trigger: "schedule", startedAt: old, outcome: "running" });
  await server.deps.db.update(sources).set({ status: "syncing", lastAttemptAt: old }).where(eq(sources.id, victim));
  await server.stop();

  server = await startServer({ env, serveUi: false, startScheduler: true, log: () => {} });
  let stale: { outcome: string; finishedAt: Date | null } | undefined;
  for (let i = 0; i < 50; i++) {
    [stale] = await server.deps.db.select({ outcome: runs.outcome, finishedAt: runs.finishedAt }).from(runs).where(eq(runs.id, "run_stale_smoke"));
    if (stale?.outcome !== "running") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  check("a restart closes the left-over run as cancelled", stale?.outcome === "cancelled" && !!stale.finishedAt, stale);
  const [src] = await server.deps.db.select({ status: sources.status, nextRunAt: sources.nextRunAt }).from(sources).where(eq(sources.id, victim));
  check("and puts its source back in the queue", src?.status !== "syncing" && !!src?.nextRunAt && src.nextRunAt.getTime() <= Date.now() + 1000, src);
} catch (e) {
  failures++;
  console.log(`FAIL crashed: ${(e as Error).stack}`);
} finally {
  await server.stop();
  rmSync(home, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failed, ${passed} passed` : `\nall ${passed} passed`);
process.exit(failures ? 1 : 0);
