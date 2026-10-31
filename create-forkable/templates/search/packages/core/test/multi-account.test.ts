// Two accounts on one platform (Connect lets a user grant two Gmails): the sample's
// second Gmail (dana@acme.dev) gets its own sources and items, results say which
// account they came from, New profile saves one source per chosen account, and a
// source saved before the grant attaches to every account the grant brings.
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import type { EngineCtx } from "../src/ctx.js";
import { items, profileDrafts, sources } from "../src/db/schema.js";
import { sampleGrant } from "../src/mapper/catalog.js";
import { createDraft, pickModels, saveDraft } from "../src/mapper/drafts.js";
import { createSampleSources, ensureSources, loadBuiltinPacks, upsertBuiltins } from "../src/profile/builtins.js";
import { fixtureTransport, loadSampleWorld } from "../src/sample/world.js";
import { runSource } from "../src/engine/run.js";
import { hybridSearch } from "../src/search/hybrid.js";
import { SAMPLE_SETTINGS } from "../src/settings.js";
import { seedUser, testDb } from "./helpers.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("two accounts on one platform", () => {
  let b: Awaited<ReturnType<typeof testDb>>;
  let ctx: EngineCtx;
  const world = loadSampleWorld(join(ROOT, "fixtures", "sample"));
  const userId = "usr_multi";
  before(async () => {
    b = await testDb("multi");
    ctx = { db: b.db, oneConnect: null, capability: b.capability, transport: fixtureTransport(world), world, settingsFor: async () => SAMPLE_SETTINGS, emit() {}, log() {}, now: () => new Date() };
    await upsertBuiltins(b.db, loadBuiltinPacks(join(ROOT, "profiles")));
    await seedUser(b.db, userId);
  });
  after(async () => { await b.done(); });

  it("the sample grant has two Gmail accounts", async () => {
    const gmail = (await sampleGrant(ctx)).filter((c) => c.platform === "gmail");
    assert.deepEqual(gmail.map((c) => c.key), ["sample:gmail", "sample:gmail:personal"]);
    assert.equal(gmail[1]!.title, "dana@acme.dev");
  });

  it("each account gets its own source and its own items", async () => {
    await createSampleSources(b.db, userId, { platforms: ["gmail"], connections: world.connections });
    const rows = await b.db.select().from(sources).where(and(eq(sources.userId, userId), eq(sources.platform, "gmail")));
    assert.equal(rows.length, 2);
    const counts: Record<string, number> = {};
    for (const s of rows) {
      const sum = await runSource(ctx, s.id, { trigger: "first" });
      assert.equal(sum.outcome, "ok", JSON.stringify(sum.error));
      counts[s.connectionLabel] = (await b.db.select().from(items).where(eq(items.sourceId, s.id))).length;
    }
    assert.deepEqual(counts, { "dana@acme.com": 24, "dana@acme.dev": 3 });
  });

  it("results name the account", async () => {
    const res = await hybridSearch(ctx, userId, { q: "lisbon", limit: 10 });
    const hit = res.results.find((r) => /Lisbon/.test(r.title));
    assert.ok(hit, JSON.stringify(res.results.map((r) => r.title)));
    assert.equal(hit.sourceName, "Gmail · dana@acme.dev");
    const work = (await hybridSearch(ctx, userId, { q: "globex renewal terms", limit: 10 })).results.find((r) => r.platform === "gmail");
    assert.equal(work?.sourceName, "Gmail · dana@acme.com");
  });

  it("New profile saves one source per chosen account", async () => {
    const d = await createDraft(ctx, userId, { platform: "zendesk" });
    // the sample has one Zendesk; give this draft two accounts the way a real two-account grant would
    const two = [{ key: "sample:zendesk", label: "support@acme.zendesk.com" }, { key: "sample:zendesk:eu", label: "eu@acme.zendesk.com" }];
    const [row] = await b.db.select().from(profileDrafts).where(eq(profileDrafts.id, d.id));
    await b.db.update(profileDrafts).set({ input: { ...(row!.input as Record<string, unknown>), accounts: two } }).where(eq(profileDrafts.id, d.id));
    const mapped = await pickModels(ctx, userId, d.id, ["ticket"]);
    assert.deepEqual(mapped.accounts.map((a) => a.key), two.map((a) => a.key));
    const both = await saveDraft(ctx, userId, d.id, { profiles: ["zendesk.tickets"] });
    assert.equal(both.sourceIds.length, 2);
    const keys = (await b.db.select({ k: sources.connectionKey }).from(sources).where(and(eq(sources.userId, userId), eq(sources.platform, "zendesk")))).map((r) => r.k).sort();
    assert.deepEqual(keys, ["sample:zendesk", "sample:zendesk:eu"]);
  });

  it("New profile can index just one of the accounts", async () => {
    const d = await createDraft(ctx, userId, { platform: "zendesk" });
    const [row] = await b.db.select().from(profileDrafts).where(eq(profileDrafts.id, d.id));
    await b.db.update(profileDrafts).set({ input: { ...(row!.input as Record<string, unknown>), accounts: [{ key: "sample:zendesk:a", label: "a" }, { key: "sample:zendesk:b", label: "b" }] } }).where(eq(profileDrafts.id, d.id));
    await pickModels(ctx, userId, d.id, ["user"]);
    const pid = (await b.db.select().from(profileDrafts).where(eq(profileDrafts.id, d.id)))[0]!.edits.selected[0]!;
    const one = await saveDraft(ctx, userId, d.id, { profiles: [pid], connectionKeys: ["sample:zendesk:b"] });
    assert.equal(one.sourceIds.length, 1);
    const [s] = await b.db.select().from(sources).where(eq(sources.id, one.sourceIds[0]!));
    assert.equal(s?.connectionKey, "sample:zendesk:b");
  });

  it("a source saved before the grant attaches to every account the grant brings", async () => {
    const realUser = "usr_multi_live";
    await b.db.insert((await import("../src/db/schema.js")).users).values({ id: realUser, name: "Dana Oyelaran", email: "dana@acme.com", isSample: false });
    // a waiting Zendesk source (no built-in pack), as New profile saves one before Zendesk is granted
    const [zd] = await b.db.select().from(sources).where(and(eq(sources.userId, userId), eq(sources.connectionKey, "sample:zendesk")));
    await b.db.insert(sources).values({ ...zd!, id: "src_waiting", userId: realUser, connectionKey: "pending:zendesk", connectionLabel: "Waiting", status: "awaiting_grant", nextRunAt: null, mode: "connect" });
    const conns = [
      { key: "live-zd-us", platform: "zendesk", name: "Zendesk", title: "support@acme.zendesk.com", access: { policy: "full" } },
      { key: "live-zd-eu", platform: "zendesk", name: "Zendesk", title: "eu@acme.zendesk.com", access: { policy: "full" } },
    ];
    const oneConnect = { isConnected: async () => true, listConnections: async () => conns } as unknown as EngineCtx["oneConnect"];
    await ensureSources({ ...ctx, oneConnect }, realUser);
    const mine = await b.db.select().from(sources).where(and(eq(sources.userId, realUser), eq(sources.profileId, zd!.profileId)));
    assert.deepEqual(mine.map((s) => s.connectionKey).sort(), ["live-zd-eu", "live-zd-us"]);
    assert.ok(mine.some((s) => s.id === "src_waiting"), "the waiting row itself is reused for the first account");
    assert.ok(mine.every((s) => s.status === "new"), JSON.stringify(mine.map((s) => s.status)));
  });
});
