// The keyless demo end to end on a scratch schema (hybrid and keyword-only), then every
// query operator runs as SQL against the indexed Acme world.
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { runDemo, DEMO_USER } from "../src/sample/demo.js";
import { hybridSearch } from "../src/search/hybrid.js";
import { SAMPLE_SETTINGS } from "../src/settings.js";
import { unmergeEntity } from "../src/entities/match.js";
import { laneFor, vipNamePattern } from "../src/classify/jev.js";
import type { EngineCtx } from "../src/ctx.js";
import { testDb } from "./helpers.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

for (const keyword of [false, true]) {
  describe(`sample world (${keyword ? "keyword-only" : "hybrid"})`, () => {
    let b: Awaited<ReturnType<typeof testDb>>;
    let ctx: EngineCtx;
    const lines: string[] = [];
    before(async () => {
      b = await testDb(keyword ? "sample_kw" : "sample", { keyword });
      ctx = { db: b.db, oneConnect: null, capability: b.capability, transport: null, settingsFor: async () => SAMPLE_SETTINGS, emit() {}, log() {}, now: () => new Date() };
    });
    after(async () => { await b.done(); });

    it("the demo passes every check", async () => {
      const r = await runDemo({ db: b.db, capability: b.capability, root: ROOT, database: { kind: "embedded", version: b.serverVersion, port: b.port } }, (l) => lines.push(l));
      assert.deepEqual(r.failures, [], lines.join("\n"));
      // 198, plus the second Gmail account (dana@acme.dev, 3 threads), the second Google Calendar (3 events,
      // a fourth 900 days out is not indexed) and Owen Price's second Attio record
      assert.equal(r.items, 205);
      if (!keyword) assert.equal(r.vectors, r.chunks);
      else assert.equal(r.vectors, 0);
      assert.ok(lines.some((l) => l.includes("Gmail · delete   declined, 403")));
      assert.ok(lines[2]!.includes("Sample embedder (local, not semantic)"));
    });

    const q = async (text: string) => (await hybridSearch(ctx, DEMO_USER, { q: text, limit: 200 })).total;

    it("every operator runs", async () => {
      const ops = ["source:hubspot,attio", "in:gmail", "type:deal", "type:meeting", "is:unread", "is:vip", "is:needs-you", "is:waiting", "is:mine", "is:open", "is:upcoming", "is:past",
        "from:priya", "from:me", "to:me", "with:globex.com", "about:\"Priya Shah\"", "before:2026-01-01", "after:30d", "on:today", "updated:>7d", "during:this-week",
        "has:attachment", "has:link", "has:joinurl", "has:transcript", "status:open", "stage:contract", "lane:vip", "label:INBOX", "container:deals", "amount:>=50000", "id:ACME-311",
        "globex -from:priya", "renewal OR pilot", "\"contract review\""];
      for (const o of ops) { const n = await q(o); assert.ok(n >= 0, o); }
      assert.equal(await q("type:deal"), 7);
      assert.equal(await q("source:hubspot"), 23);
      assert.equal(await q("from:priya after:30d type:mail"), 3);
      assert.ok((await q("with:globex.com")) >= 10);
      assert.ok((await q("amount:>=80000")) >= 2, "HubSpot amounts are numbers now");
      assert.ok((await q("is:upcoming")) > 0, "future events are indexed");
      assert.equal(await q("id:ACME-311"), 1);
      assert.ok((await q("globex")) > (await q("globex -from:priya")));
    });

    it("lanes, matches and rerank follow the fixtures (Phase 4)", async () => {
      assert.deepEqual(Object.fromEntries(await Promise.all(["vip", "needs-you", "waiting", "fyi", "low"].map(async (l) => [l, await q(`lane:${l}`)]))), { vip: 38, "needs-you": 6, waiting: 6, fyi: 134, low: 26 });
      const st = (await b.db.execute(sql`select status, count(*)::int as n from entity_matches where user_id = ${DEMO_USER} group by status order by status`)).rows;
      assert.deepEqual(st, [{ status: "merged", n: 1 }, { status: "pending", n: 1 }, { status: "rejected", n: 1 }]);
      const top = lines.findIndex((l) => l.startsWith('Search "globex renewal"'));
      assert.ok(lines[top + 1]!.includes("HubSpot") && lines[top + 1]!.includes("Globex renewal 2027"), lines[top + 1]);
    });

    it("merged people can be unmerged", async () => {
      const [m] = (await b.db.execute(sql`select a_id, b_id from entity_matches where user_id = ${DEMO_USER} and status = 'merged'`)).rows as { a_id: string; b_id: string }[];
      assert.ok(m);
      await unmergeEntity(b.db, DEMO_USER, m.b_id);
      const [e] = (await b.db.execute(sql`select merged_into_id from entities where id = ${m.b_id}`)).rows as { merged_into_id: string | null }[];
      assert.equal(e!.merged_into_id, null);
    });
  });
}

describe("lanes", () => {
  it("a VIP named in the text is vip, but never outranks needs_you or waiting", () => {
    const re = vipNamePattern(["Priya Shah", "Owen Price"])!;
    assert.ok(re.test("Call with Priya."));
    assert.ok(re.test("Owen asked for Q3 numbers"));
    assert.ok(!re.test("Priyanka joined"));
    const a = { kind: "customer", needsYou: 0.1, ball: "nobody" as const, ballP: 0.7, importance: 1 };
    assert.equal(laneFor(a, { lastFromSelf: false, personIds: [], namesVip: true }, new Set()), "vip");
    assert.equal(laneFor({ ...a, needsYou: 0.9 }, { lastFromSelf: false, personIds: [], namesVip: true }, new Set()), "needs_you");
    assert.equal(laneFor({ ...a, kind: "newsletter" }, { lastFromSelf: false, personIds: [], namesVip: true }, new Set()), "low");
    assert.equal(laneFor(a, { lastFromSelf: false, personIds: ["p1"] }, new Set(["p1"])), "vip");
  });
});
