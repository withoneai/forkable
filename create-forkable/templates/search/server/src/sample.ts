// The keyless Acme sample (SPEC 11.4): one shared sample user (Dana Oyelaran) per
// machine, every enabled built-in profile on `sample:<platform>`, the engine on
// the fixture transport. "Try the Acme sample" points the session at that user
// and indexes the world the first time, in the demo's order (directories and
// CRM records first, then two passes so delta removals show).

import { and, eq, sql } from "drizzle-orm";
import { createSampleSources, dbSchema, putSettings, runSource, SAMPLE_SETTINGS, vipIdsForKeys } from "@search/core";
import type { Deps } from "./deps.js";

const { users, sources, profileVersions, items } = dbSchema;

export const SAMPLE_USER = "usr_sample";
const ORDER = ["hubspot", "attio", "gmail", "outlook-mail", "google-calendar", "outlook-calendar", "notion", "linear", "slack", "teams", "granola"];

let bootstrapping: Promise<void> | null = null;

export async function ensureSampleUser(deps: Deps): Promise<string> {
  await deps.db.insert(users).values({ id: SAMPLE_USER, name: "Dana Oyelaran", email: "dana@acme.com", isSample: true }).onConflictDoNothing();
  return SAMPLE_USER;
}

/** Makes the sample sources and, the first time, indexes the whole world before answering. Idempotent. */
export async function bootstrapSample(deps: Deps): Promise<void> {
  if (bootstrapping) return bootstrapping;
  bootstrapping = (async () => {
    const userId = await ensureSampleUser(deps);
    const [{ n } = { n: 0 }] = await deps.db.select({ n: sql<number>`count(*)::int` }).from(items).where(eq(items.userId, userId));
    await createSampleSources(deps.db, userId, { connections: deps.sample().world.connections });
    if (n > 0) return;
    await putSettings(deps.db, userId, { ...SAMPLE_SETTINGS });
    const rows = await deps.db.select({ s: sources, v: profileVersions }).from(sources).innerJoin(profileVersions, eq(profileVersions.id, sources.profileVersionId)).where(and(eq(sources.userId, userId), eq(sources.mode, "fixture")));
    const rank = (r: (typeof rows)[number]) => (r.v.json.entities?.directory ? 0 : r.v.json.entities?.is ? 1 : 2) * 100 + Math.max(0, ORDER.indexOf(r.s.platform));
    rows.sort((a, b) => rank(a) - rank(b) || a.v.json.id.localeCompare(b.v.json.id));
    const release = deps.scheduler.hold(rows.map((r) => r.s.id));
    try {
      for (const pass of [1, 2]) for (const r of rows) await runSource(deps.ctx, r.s.id, { trigger: pass === 1 ? "first" : "schedule" });
      const world = deps.sample().world;
      await putSettings(deps.db, userId, { vipEntityIds: await vipIdsForKeys(deps.ctx, userId, world.vipKeys) });
      await deps.scheduler.runWorkers(userId, { match: true });
      deps.scheduler.markDirty(userId);
    } finally {
      release();
    }
  })().finally(() => { bootstrapping = null; });
  return bootstrapping;
}
