// Keeping to the One plan (one-budget.ts): pace under the plan's per-minute limit,
// the person ahead of background work, learning the limit One reports,
// stopping on a 429 and holding background work on a 402.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { GrantedConnection } from "../src/contract.js";
import type { CallCtx, OneConnectKeyClient } from "../src/ctx.js";
import { Budget, ONE_PLAN_RPM, OneQuotaHeld, priorityFor, fromRateLimit, UNLIMITED_RPM, resetBudgets, budgetFor, quotaHeld, type Clock } from "../src/one-budget.js";
import { one, forgetGrant } from "../src/one.js";
import { oneUsageTotals, flushOneUsage } from "../src/one-usage.js";
import { users } from "../src/db/schema.js";
import { putSettings } from "../src/settings.js";
import { testDb } from "./helpers.js";

/** A clock tests move by hand; timers fire as time passes. */
function fakeClock() {
  let t = 1_000_000;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let id = 0;
  const c: Clock & { advance(ms: number): Promise<void> } = {
    now: () => t,
    setTimer: (fn, ms) => { timers.push({ at: t + ms, fn, id: ++id }); return id; },
    clearTimer: (x) => { timers = timers.filter((tm) => tm.id !== x); },
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        t = next.at;
        next.fn();
        await new Promise((r) => setImmediate(r));
      }
      t = end;
      await new Promise((r) => setImmediate(r));
    },
  };
  return c;
}

const settle = () => new Promise((r) => setImmediate(r));

describe("one budget", () => {
  it("paces under the plan and assumes Free until One says otherwise", async () => {
    const c = fakeClock();
    const b = new Budget(c);
    assert.equal(b.limit(), ONE_PLAN_RPM.free);
    assert.equal(b.capacity(), 18); // 90% of 20
    let done = 0;
    for (let i = 0; i < 30; i++) void b.acquire("now").then(() => done++);
    await settle();
    assert.equal(done, 18, "a full bucket lets the paced amount through at once");
    await c.advance(60_000);
    assert.equal(done, 30, "the rest follow within the minute");
  });

  it("keeps a share for the person: background never empties the bucket", async () => {
    const c = fakeClock();
    const b = new Budget(c);
    b.setPlan({ plan: "starter", rpm: null });
    assert.equal(b.capacity(), 90);
    assert.equal(b.reserve(), 22);
    let bg = 0;
    for (let i = 0; i < 200; i++) void b.acquire("background").then(() => bg++);
    await settle();
    assert.equal(bg, 90 - 22);
    let mine = 0;
    for (let i = 0; i < 5; i++) void b.acquire("now").then(() => mine++);
    await settle();
    assert.equal(mine, 5, "the person's calls go at once while background waits");
  });

  it("serves the person before background work already in the queue", async () => {
    const c = fakeClock();
    const b = new Budget(c);
    b.setPlan({ plan: "custom", rpm: 4 }); // capacity 3, no reserve below 4
    const order: string[] = [];
    for (let i = 0; i < 6; i++) void b.acquire("background").then(() => order.push("bg"));
    await settle();
    void b.acquire("now").then(() => order.push("me"));
    await c.advance(21_000);
    assert.deepEqual(order.slice(0, 4), ["bg", "bg", "bg", "me"]);
  });

  it("learns the limit One reports and never runs above it", async () => {
    const b = new Budget(fakeClock());
    b.setPlan({ plan: "pro", rpm: null });
    assert.equal(b.limit(), 500);
    b.observe({ status: 200, limit: 100, remaining: 99, resetMs: 40_000, refusal: null });
    assert.equal(b.limit(), 100, "picked Pro, One says 100: 100 wins");
    assert.equal(b.status().limitFrom, "one");
    b.setPlan({ plan: "auto", rpm: null });
    assert.equal(b.limit(), 100);
    b.observe({ status: 200, limit: 500, remaining: 3, refusal: null });
    assert.ok(b.tokens <= 3, "remaining from One caps what Search thinks it has");
  });

  it("stops everything after a 429 until Retry-After", async () => {
    const c = fakeClock();
    const b = new Budget(c);
    b.setPlan({ plan: "starter", rpm: null });
    b.observe({ status: 429, limit: 100, remaining: 0, retryAfterMs: 15_000, refusal: "rate_limit" });
    let done = 0;
    void b.acquire("now").then(() => done++);
    await c.advance(14_000);
    assert.equal(done, 0);
    await c.advance(2_000);
    assert.equal(done, 1);
    assert.ok(b.status().slowedUntil === null);
  });

  it("a provider's own 429 is not One's: it does not stop other calls", async () => {
    const b = new Budget(fakeClock());
    b.observe({ status: 429, refusal: null, retryAfterMs: 60_000 });
    assert.equal(b.status().slowedUntil, null);
  });

  it("holds background work after a 402 and lets the person through", async () => {
    const c = fakeClock();
    const b = new Budget(c);
    b.observe({ status: 402, refusal: "plan_limit" });
    await assert.rejects(b.acquire("background"), OneQuotaHeld);
    await b.acquire("now");
    assert.ok(b.status().heldUntil);
    b.observe({ status: 200, refusal: null });
    assert.equal(b.status().heldUntil, null, "a call that goes through ends the hold");
  });

  it("reads the rate limit @withone/connect reports (seconds to ms), and no limit as unlimited", () => {
    assert.deepEqual(fromRateLimit({ limit: 100, remaining: 7, resetsIn: 12, retryAfter: 3 }), { limit: 100, remaining: 7, resetMs: 12_000, retryAfterMs: 3_000, unlimited: false });
    assert.equal(fromRateLimit(null), null);
    assert.equal(fromRateLimit({ limit: null, remaining: null, resetsIn: null, retryAfter: null })!.unlimited, true);
    const b = new Budget(fakeClock());
    b.observe({ status: 200, unlimited: true, refusal: null });
    assert.equal(b.limit(), UNLIMITED_RPM, "auto on an unlimited plan does not hold Search to Free");
    b.setPlan({ plan: "starter", rpm: null });
    assert.equal(b.limit(), 100, "a picked plan still caps it");
  });

  it("indexing, embedding and Jev are background; everything a person waits on is not", () => {
    for (const a of ["indexer", "embedder", "classifier"] as const) assert.equal(priorityFor(a), "background");
    for (const a of ["user", "assistant", "mcp", "api", "mapper"] as const) assert.equal(priorityFor(a), "now");
  });
});

describe("one.call keeps to the plan", () => {
  let b: Awaited<ReturnType<typeof testDb>>;
  const GMAIL: GrantedConnection = { key: "live::gmail::default::1", platform: "gmail", name: "Gmail", title: "dana@acme.test", image: "", access: { policy: "full" } } as unknown as GrantedConnection;
  type RL = { limit: number | null; remaining: number | null; resetsIn: number | null; retryAfter: number | null } | null;
  let answers: { status: number; rateLimit: RL }[] = [];
  let calls = 0;

  before(async () => {
    b = await testDb("one_budget", { keyword: true });
    await b.db.insert(users).values({ id: "u_budget", email: "dana@acme.test", name: "Dana", isSample: false }).onConflictDoNothing();
  });
  after(async () => { resetBudgets(); await b?.done(); });

  // runAction as @withone/connect 0.24 answers: status, refusal and the rate limit One reported
  const client = (): OneConnectKeyClient => ({
    isConnected: async () => true,
    listConnections: async () => [GMAIL],
    runAction: async () => {
      calls++;
      const a = answers.shift() ?? { status: 200, rateLimit: { limit: 100, remaining: 80, resetsIn: 30, retryAfter: null } };
      const refusal = a.status === 429 ? "rate_limit" : a.status === 402 ? "plan_limit" : null;
      return { status: a.status, ok: a.status < 300, blockedByGrant: false, refusal, rateLimit: a.rateLimit, data: a.status === 200 ? { ok: true } : { error: "x" } };
    },
  }) as unknown as OneConnectKeyClient;

  const ctx = (actor: CallCtx["actor"] = "user"): CallCtx => ({ db: b.db, userId: "u_budget", actor, mode: "connect", oneConnect: client(), transport: null });
  const input = { platform: "gmail", action: "profile", level: "read" as const, actionId: "conn_mod_def::test", method: "GET" as const, path: "/users/me/profile", summary: "profile" };

  it("learns the plan from the answer, counts the call and honours the setting", async () => {
    resetBudgets(); forgetGrant("u_budget");
    await one.raw(ctx(), input);
    assert.equal(budgetFor("u_budget").limit(), 100, "auto picked up the limit One reported");
    await putSettings(b.db, "u_budget", { onePlan: "free", oneRpm: null });
    resetBudgets();
    await one.raw(ctx(), input);
    assert.equal(budgetFor("u_budget").limit(), 20, "picked Free, One says 100: Search keeps to Free");
    await flushOneUsage();
    const t = await oneUsageTotals(b.db, "u_budget");
    assert.equal(t.month, 2);
  });

  it("passes Retry-After from a One 429 to the caller and holds background work on a 402", async () => {
    resetBudgets(); await putSettings(b.db, "u_budget", { onePlan: "auto", oneRpm: null });
    answers = [{ status: 429, rateLimit: { limit: 100, remaining: 0, resetsIn: 40, retryAfter: 7 } }];
    const r = await one.raw(ctx(), input);
    assert.equal(r.refusal, "rate_limit");
    assert.equal(r.retryAfterMs, 7_000);
    assert.ok(budgetFor("u_budget").status().slowedUntil);

    resetBudgets();
    answers = [{ status: 402, rateLimit: null }];
    const q = await one.raw(ctx("indexer"), input);
    assert.equal(q.refusal, "plan_limit");
    assert.ok(quotaHeld("u_budget"));
    const before = calls;
    const held = await one.raw(ctx("indexer"), input);
    assert.equal(held.status, 402);
    assert.equal(calls, before, "a held background call never reaches One");
    await one.raw(ctx("user"), input);
    assert.equal(calls, before + 1, "the person's call still goes");
    assert.equal(quotaHeld("u_budget"), false, "and it going through ends the hold");
  });
});
