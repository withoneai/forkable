// Score once and keep slow answers (SPEC 9.2, D47): Jev is asked only about candidates
// without a stored score, scores outlive the process, a content change asks again, a
// late answer is stored, and one rerank is in flight per missing set.
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import type { GrantedConnection } from "../src/contract.js";
import type { EngineCtx, OneConnectKeyClient } from "../src/ctx.js";
import { items, rerankScores, users } from "../src/db/schema.js";
import { forgetGrant } from "../src/one.js";
import { runDemo, DEMO_USER } from "../src/sample/demo.js";
import { hybridSearch } from "../src/search/hybrid.js";
import { jevRerank, RERANK, rerankInFlight, settleReranks } from "../src/search/rerank.js";
import { normalizeQuestion } from "../src/sample/world.js";
import { SAMPLE_SETTINGS } from "../src/settings.js";
import { testDb } from "./helpers.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const JEV: GrantedConnection = { key: "k-typesafe", platform: "typesafe", name: "TypeSafe", title: "TypeSafe", image: null, access: "read" } as unknown as GrantedConnection;

/** A Jev on the grant that scores by title and records every candidate list it was sent. */
class FakeJev {
  calls: { title: string }[][] = [];
  delayMs = 0;
  client(): OneConnectKeyClient {
    return {
      isConnected: async () => true,
      listConnections: async () => [JEV],
      runAction: async (_u: string, r: { body?: { state?: { candidates?: { n: number; title: string }[] } } }) => {
        const cands = r.body?.state?.candidates ?? [];
        this.calls.push(cands.map((c) => ({ title: c.title })));
        if (this.delayMs) await new Promise((ok) => setTimeout(ok, this.delayMs));
        const answers = Object.fromEntries(cands.map((c) => [`rel_${c.n}`, /globex/i.test(c.title) ? 3 : /renewal/i.test(c.title) ? 2 : 0]));
        return { status: 200, ok: true, data: { answers }, blockedByGrant: false, refusal: null };
      },
    } as unknown as OneConnectKeyClient;
  }
}

describe("rerank: score once, keep slow answers", () => {
  let b: Awaited<ReturnType<typeof testDb>>;
  let jev: FakeJev;
  const ctxFor = (j: FakeJev): EngineCtx => ({ db: b.db, oneConnect: j.client(), capability: b.capability, transport: null, settingsFor: async () => SAMPLE_SETTINGS, emit() {}, log() {}, now: () => new Date() });
  const rerank = async (ctx: EngineCtx, q: string, o: { fresh?: boolean } = {}) => {
    const s = await hybridSearch(ctx, DEMO_USER, { q, limit: 30 });
    return { s, r: await jevRerank(ctx, DEMO_USER, { queryId: s.queryId, fresh: o.fresh }) };
  };
  const storedFor = async (q: string) => (await b.db.select().from(rerankScores).where(and(eq(rerankScores.userId, DEMO_USER), eq(rerankScores.query, normalizeQuestion(q))))).length;

  before(async () => {
    // keyword mode: no embedder to stub, the rerank path is the same
    b = await testDb("rerank_cache", { keyword: true });
    const r = await runDemo({ db: b.db, capability: b.capability, root: ROOT, database: { kind: "embedded", version: b.serverVersion, port: b.port } }, () => {});
    assert.deepEqual(r.failures, []);
    // the demo user on a real grant from here on (Jev answers from FakeJev, not the fixtures)
    await b.db.update(users).set({ isSample: false }).where(eq(users.id, DEMO_USER));
    await b.db.delete(rerankScores);
    forgetGrant(DEMO_USER);
  });
  after(async () => { RERANK.budgetMs = 2500; await settleReranks(); await b.done(); });

  const Q = "globex renewal terms";

  it("asks Jev once, then reuses every stored score", async () => {
    jev = new FakeJev();
    const ctx = ctxFor(jev);
    const first = await rerank(ctx, Q);
    const n = Math.min(30, first.s.results.length);
    assert.ok(n >= 2, `the query finds results (${n})`);
    assert.equal(first.r.reranked, true, first.r.reason);
    assert.equal(jev.calls.length, 1);
    assert.equal(jev.calls[0]!.length, n);
    assert.equal(first.r.asked, n);
    assert.equal(await storedFor(Q), n);

    const again = await rerank(ctx, Q);
    assert.equal(jev.calls.length, 1, "a repeat search makes no Jev call");
    assert.equal(again.r.reranked, true);
    assert.equal(again.r.stored, n);
    assert.equal(again.r.asked, 0);
    assert.deepEqual(again.r.order, first.r.order, "same order from stored scores");
  });

  it("scores survive a restart", async () => {
    // a new process: no in-memory state, a fresh ctx and grant lookup, only Postgres
    await settleReranks();
    assert.equal(rerankInFlight(), 0);
    forgetGrant(DEMO_USER);
    const restarted = new FakeJev();
    const r = await rerank(ctxFor(restarted), Q);
    assert.equal(r.r.reranked, true);
    assert.equal(restarted.calls.length, 0, "no Jev call after a restart");
  });

  it("a content change asks Jev about that item only", async () => {
    jev = new FakeJev();
    const ctx = ctxFor(jev);
    const { s } = await rerank(ctx, Q);
    const target = s.results[1]!;
    await b.db.update(items).set({ title: sql`${items.title} || ' (revised)'` }).where(eq(items.id, target.id));
    const r = await rerank(ctx, Q);
    assert.equal(jev.calls.length, 1);
    assert.deepEqual(jev.calls[0]!.map((c) => c.title), [`${target.title} (revised)`]);
    assert.equal(r.r.asked, 1);
    assert.equal(r.r.stored, Math.min(30, s.results.length) - 1);
  });

  it("only new items go to Jev", async () => {
    jev = new FakeJev();
    const ctx = ctxFor(jev);
    const { s } = await rerank(ctx, Q);
    // two items leave the stored set, as if they had just entered the top 30
    const gone = s.results.slice(0, 2).map((x) => x.id);
    for (const id of gone) await b.db.delete(rerankScores).where(and(eq(rerankScores.userId, DEMO_USER), eq(rerankScores.itemId, id)));
    const r = await rerank(ctx, Q);
    assert.equal(jev.calls.length, 1);
    assert.equal(jev.calls[0]!.length, 2);
    assert.equal(r.r.asked, 2);
  });

  it("Refresh (fresh) asks about every candidate again", async () => {
    jev = new FakeJev();
    const r = await rerank(ctxFor(jev), Q, { fresh: true });
    assert.equal(jev.calls.length, 1);
    assert.equal(r.r.asked, Math.min(30, r.s.results.length));
  });

  it("a late answer is stored and the next view uses it, with one call in flight", async () => {
    const q = "globex renewal pricing";
    jev = new FakeJev();
    jev.delayMs = 300;
    RERANK.budgetMs = 40;
    const ctx = ctxFor(jev);
    const s = await hybridSearch(ctx, DEMO_USER, { q, limit: 30 });
    const t0 = Date.now();
    const [a, b2] = await Promise.all([
      jevRerank(ctx, DEMO_USER, { queryId: s.queryId }),
      jevRerank(ctx, DEMO_USER, { queryId: s.queryId }),
    ]);
    assert.ok(Date.now() - t0 < 250, "the budget answers before Jev does");
    assert.equal(a.reranked, false);
    assert.equal(a.reason, "timeout");
    assert.deepEqual(a.order, s.results.map((x) => x.id), "the RRF order stands");
    assert.equal(b2.reason, "timeout");
    assert.equal(rerankInFlight(), 1, "the second request joined the first call");
    const third = await jevRerank(ctx, DEMO_USER, { queryId: s.queryId });
    assert.equal(third.reason, "timeout");
    assert.equal(jev.calls.length, 1, "single-flight: one Jev call for three requests");

    await settleReranks();
    assert.equal(rerankInFlight(), 0);
    assert.equal(await storedFor(q), Math.min(30, s.results.length), "the late answer was stored");
    RERANK.budgetMs = 2500;
    const next = await jevRerank(ctx, DEMO_USER, { queryId: s.queryId });
    assert.equal(next.reranked, true);
    assert.equal(next.asked, 0);
    assert.equal(jev.calls.length, 1, "the next view makes no Jev call");
  });
});
