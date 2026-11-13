// Final review of plain sentences (2026-11-12), on the Acme sample: a read sentence never
// returns less than its words did, "from" means from, and every filter that hides results
// says how many. The inputs are the ones the two testers found failing.
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import type { EngineCtx } from "../src/ctx.js";
import { runDemo, DEMO_USER } from "../src/sample/demo.js";
import { collapseSame, hybridSearch, toResultRows } from "../src/search/hybrid.js";
import { sql } from "drizzle-orm";
import { SAMPLE_SETTINGS } from "../src/settings.js";
import { testDb } from "./helpers.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("plain sentences on the Acme sample (final review)", () => {
  let b: Awaited<ReturnType<typeof testDb>>;
  let ctx: EngineCtx;
  const read = (q: string, limit = 50) => hybridSearch(ctx, DEMO_USER, { q, limit, understand: true, tz: "Asia/Qatar" });
  const words = (q: string, limit = 50) => hybridSearch(ctx, DEMO_USER, { q, limit, tz: "Asia/Qatar" });
  before(async () => {
    b = await testDb("understand-search");
    ctx = { db: b.db, oneConnect: null, capability: b.capability, transport: null, settingsFor: async () => SAMPLE_SETTINGS, emit() {}, log() {}, now: () => new Date() };
    const r = await runDemo({ db: b.db, capability: b.capability, root: ROOT, database: { kind: "embedded", version: b.serverVersion, port: b.port } }, () => {});
    assert.deepEqual(r.failures, []);
  });
  after(async () => { await b.done(); });

  describe("leftover words never empty a read sentence (item 1)", () => {
    for (const q of ["emails from people at Initech", "anything from Jules since Monday", "issues assigned to Mia", "emails I haven't replied to", "linear issues in review", "that contract Marco sent"]) {
      it(`"${q}" finds something`, async () => {
        const r = await read(q);
        assert.ok(r.total > 0, `${q}: ${r.searchedAs}`);
      });
    }
    it("when the leftover words match nothing, the filters list on their own and the response says which words", async () => {
      const r = await read("emails from Priya about zebras");
      assert.equal(r.fallback, "filters");
      assert.equal(r.unmatched, "zebras");
      const typed = await words("from:priya@globex.com type:mail");
      assert.equal(r.total, typed.total);
    });
    it("when only one or two items have the words, they come first and the filters' other items follow", async () => {
      const r = await read("is Tom from Hooli in my CRM");
      assert.equal(r.fallback, "filters");
      assert.ok((r.matchedWords ?? 0) >= 1 && r.total > (r.matchedWords ?? 0), JSON.stringify({ m: r.matchedWords, t: r.total }));
      assert.equal(r.results[0]?.title, "Tom Reyes");
      assert.ok(r.results.some((x) => x.kind !== "person" && x.kind !== "company"), "the filters' items follow");
      const names = r.results.filter((x) => x.kind === "person").map((x) => x.title);
      assert.equal(new Set(names).size, names.length, "one row per person");
    });
    it("calendar events next week lists every event next week", async () => {
      const r = await read("calendar events next week");
      const f = r.understood.map((u) => u.filter).join(" ");
      const typed = await words(f);
      assert.ok(r.total >= 1 && r.total === typed.total, `${r.total} vs ${typed.total}`);
      assert.ok(r.results.every((x) => x.kind === "event"));
    });
    it("what's on my calendar tomorrow lists tomorrow's events", async () => {
      const r = await read("what's on my calendar tomorrow");
      assert.deepEqual(r.understood.map((u) => u.kind), ["type", "date"]);
      assert.ok(r.results.every((x) => x.kind === "event"));
    });
  });

  describe("from means from (item 3)", () => {
    it("a name read after from lists only what that person sent, wrote or organized", async () => {
      const r = await read("emails from Priya");
      assert.ok(r.total > 0);
      for (const x of r.results) assert.ok(x.people.some((p) => p.name === "Priya Shah" && ["from", "author", "organizer", "owner"].includes(p.role)), x.title);
      const r2 = await read("from Priya");
      assert.ok(!r2.results.some((x) => x.title.startsWith("Call with Priya")), "a note that only mentions her is not from her");
    });
    it("a typed filter finds exactly what it did, read or not", async () => {
      const a = await words("from:priya@globex.com");
      const c = await read("from:priya@globex.com");
      assert.deepEqual(c.results.map((x) => x.id), a.results.map((x) => x.id));
    });
    it("with still reaches notes that name them", async () => {
      const r = await read("with Priya");
      assert.ok(r.results.some((x) => x.title.startsWith("Call with Priya")));
    });
  });

  describe("chips that hide results say which and how many (item 4)", () => {
    it("slack messages about the renewal is one chip, and In Slack says what it hides", async () => {
      const r = await read("slack messages about the renewal");
      assert.deepEqual(r.understood.map((u) => u.filter), ["in:slack"]);
      assert.ok(r.hiddenByFilters > 0);
      assert.equal(r.hiddenBy?.[0]?.label, "In Slack");
      assert.equal(r.hiddenBy?.[0]?.phrase, "slack");
    });
    it("nothing under the filters says which filter, taken off, finds something", async () => {
      const r = await read("mail from Felix Wagner last month");
      if (r.total === 0) assert.ok((r.hiddenBy ?? []).length > 0);
    });
  });

  describe("one row per thing (item 6)", () => {
    it("open deals lists each deal once, the other CRM as a badge, and the counts agree", async () => {
      const r = await read("open deals");
      const titles = r.results.map((x) => x.title);
      assert.equal(new Set(titles).size, titles.length, titles.join(" | "));
      const hooli = r.results.find((x) => x.title === "Hooli design partner");
      assert.ok(hooli?.alsoIn?.length, "the other CRM is a badge");
      assert.equal(r.counts.scope.deal, r.total);
    });
    it("a person's records are one row in a search", async () => {
      const r = await read("Owen Price");
      assert.equal(r.results.filter((x) => x.title === "Owen Price").length, 1);
    });
    it("a timeline keeps one row per person, company and deal", async () => {
      const raw = (await b.db.execute(sql`select * from items where user_id = ${DEMO_USER} and title in ('Priya Shah', 'Globex', 'Globex renewal 2027') and deleted_at is null`)).rows as never[];
      const rows = await toResultRows(ctx, raw, new Map(), []);
      assert.ok(rows.length >= 5);
      const one = await collapseSame(ctx, DEMO_USER, rows);
      assert.deepEqual(one.map((x) => x.title).sort(), ["Globex", "Globex renewal 2027", "Priya Shah"]);
    });
  });

  describe("searches that missed (item 5)", () => {
    it("that contract Marco sent includes his redline", async () => {
      const r = await read("that contract Marco sent");
      assert.ok(r.results.some((x) => x.title === "Globex legal redline, final"), r.results.map((x) => x.title).join(" | "));
    });
    it("deals closing this quarter are deals", async () => {
      const r = await read("deals closing this quarter");
      assert.ok(r.total > 0 && r.results.every((x) => x.kind === "deal"));
    });
    it("Prya offers Priya Shah", async () => {
      const r = await read("Prya");
      assert.equal(r.didYouMean?.name, "Priya Shah");
    });
    for (const [q, name] of [["who is Priya Shah", "Priya Shah"], ["who is Owen Price", "Owen Price"], ["who is Ravi", "Ravi Menon"]] as const) {
      it(`"${q}" shows the person`, async () => {
        const r = await read(q);
        assert.equal(r.entities[0]?.name, name);
      });
    }
  });
});
