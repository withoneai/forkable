// The last polish round (2026-11-12): every input two final testers found failing, on the
// Acme sample. A pure part (understanding) and a database part (the search).
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import type { EngineCtx } from "../src/ctx.js";
import { runDemo, DEMO_USER } from "../src/sample/demo.js";
import { dropFilterText, hybridSearch, wordsOnlyText } from "../src/search/hybrid.js";
import { understandQuery, type Vocab, type VocabEntity } from "../src/query/understand.js";
import { SAMPLE_SETTINGS } from "../src/settings.js";
import { testDb } from "./helpers.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const people: VocabEntity[] = [
  { id: "p_dana", type: "person", name: "Dana Oyelaran", email: "dana@acme.com", isSelf: true, itemCount: 200 },
  { id: "p_priya", type: "person", name: "Priya Shah", email: "priya@globex.com", itemCount: 40 },
  { id: "p_owen", type: "person", name: "Owen Price", email: "owen@northwind.vc", itemCount: 4 },
  { id: "c_globex", type: "company", name: "Globex", domain: "globex.com", itemCount: 60 },
  { id: "c_umbrella", type: "company", name: "Umbrella", domain: "umbrella.co", itemCount: 60 },
];
const vocab: Vocab = { entities: people, platforms: ["gmail", "slack", "notion", "google-calendar"] };
const U = (q: string) => understandQuery(q, vocab, { now: new Date("2026-11-12T10:00:00Z"), tz: "UTC" });

describe("polish: a negation never applies the positive (item 1)", () => {
  /** [sentence, a word that must not be searched, the exclusion offered] */
  const rows: [string, string, string | null][] = [
    ["emails without Priya", "priya", "-with:priya@globex.com"],
    ["meetings not with Globex", "globex", "-with:globex.com"],
    ["everything except Umbrella", "umbrella", "-with:umbrella.co"],
    ["everything about Umbrella except pricing", "pricing", "-pricing"],
    ["emails excluding Priya", "priya", "-with:priya@globex.com"],
    ["deals other than Globex", "globex", "-with:globex.com"],
    ["messages but not in Slack", "slack", "-in:slack"],
    ["emails not to Owen", "owen", "-to:owen@northwind.vc"],
    ["notes not about Globex", "globex", null],
    ["everything except emails", "emails", "-type:mail"],
    ["emails with no attachments", "attachments", "-has:attachment"],
    ["meetings that don't include Priya", "priya", null],
    ["not emails from Priya", "priya", null],
  ];
  for (const [q, word, offer] of rows) {
    it(`"${q}"`, () => {
      const r = U(q);
      for (const u of r.understood) assert.ok(!/^(from|with|to|in|about):/.test(u.filter) || !u.filter.includes(word), `applied ${u.filter}`);
      assert.ok(!r.query.toLowerCase().split(/\s+/).includes(word), `searched ${r.query}`);
      if (offer) assert.ok(r.suggestions.some((s) => s.why === "negated" && s.choices.some((c) => c.filter === offer)), JSON.stringify(r.suggestions));
    });
  }
  it("the negation governs its target only: the date after it still reads", () => {
    const r = U("emails not from Priya last week");
    assert.deepEqual(r.understood.map((u) => u.kind), ["type", "date"]);
  });
  it("a negated date is dropped, never read as the date", () => {
    assert.deepEqual(U("emails not in October").understood.map((u) => u.filter), ["type:mail"]);
  });
});

describe("polish: replies read as Needs you and Waiting (item 5)", () => {
  for (const q of ["anything I need to reply to", "what do I need to reply to", "emails waiting on me", "things I haven't answered", "messages I need to answer"]) {
    it(`"${q}" is Needs you`, () => {
      const r = U(q);
      assert.ok(r.understood.some((u) => u.filter === "lane:needs-you"), JSON.stringify(r.understood));
      assert.ok(!/\bneed\b/.test(r.query), r.query);
    });
  }
  for (const q of ["emails waiting on them", "threads I haven't heard back on", "emails with no reply yet"]) {
    it(`"${q}" is Waiting`, () => {
      const r = U(q);
      assert.ok(r.understood.some((u) => u.filter === "lane:waiting"), JSON.stringify(r.understood));
    });
  }
});

describe("polish: channels read as the container filter (item 3)", () => {
  const v: Vocab = { ...vocab, channels: ["deals", "eng"] };
  const R = (q: string) => understandQuery(q, v, { now: new Date("2026-11-12T10:00:00Z"), tz: "UTC" });
  for (const q of ["messages in #deals", "in the deals channel", "#deals", "from the eng channel"]) {
    it(`"${q}"`, () => assert.ok(R(q).understood.some((u) => /^container:(deals|eng)$/.test(u.filter)), JSON.stringify(R(q))));
  }
  it("a channel that does not exist stays as words", () => assert.equal(R("in #random").understood.length, 0));
  it("not in #deals offers the exclusion and never searches deals", () => {
    const r = R("messages not in #deals");
    assert.ok(r.suggestions.some((s) => s.choices[0]?.filter === "-container:deals"));
    assert.ok(!/deals/.test(r.query), r.query);
  });
});

describe("polish on the Acme sample", () => {
  let b: Awaited<ReturnType<typeof testDb>>;
  let ctx: EngineCtx;
  const read = (q: string, limit = 60) => hybridSearch(ctx, DEMO_USER, { q, limit, understand: true, tz: "America/Los_Angeles" });
  const words = (q: string, limit = 60) => hybridSearch(ctx, DEMO_USER, { q, limit, tz: "America/Los_Angeles" });
  before(async () => {
    b = await testDb("polish");
    ctx = { db: b.db, oneConnect: null, capability: b.capability, transport: null, settingsFor: async () => SAMPLE_SETTINGS, emit() {}, log() {}, now: () => new Date() };
    const r = await runDemo({ db: b.db, capability: b.capability, root: ROOT, database: { kind: "embedded", version: b.serverVersion, port: b.port } }, () => {});
    assert.deepEqual(r.failures, []);
  });
  after(async () => { await b.done(); });

  it("item 1: emails without Priya is every email, not Priya's", async () => {
    const r = await read("emails without Priya");
    const all = await words("type:mail");
    assert.equal(r.total, all.total);
  });
  it("item 1: meetings not with Globex never lists only Globex", async () => {
    const r = await read("meetings not with Globex");
    const all = await words("type:meeting");
    assert.equal(r.total, all.total);
  });
  it("item 5: anything I need to reply to lists the Needs you lane", async () => {
    const r = await read("anything I need to reply to");
    const lane = await words("lane:needs-you");
    assert.ok(r.total > 0 && r.total === lane.total, `${r.total} vs ${lane.total} (${r.searchedAs})`);
    assert.equal(r.unmatched, null);
  });

  it("item 3: in:#deals finds the deals channel with or without reading sentences", async () => {
    for (const r of [await read("in:#deals Globex"), await words("in:#deals Globex")]) {
      assert.ok(r.total > 0 && r.results.every((x) => x.platform === "slack" && /deals/.test(x.title)), `${r.total}`);
    }
    const s = await read("messages in #deals about Globex");
    assert.ok(s.total > 0 && s.results.every((x) => /deals/.test(x.title)), s.searchedAs);
  });

  it("item 4: anything from Owen about the board keeps the board-prep meeting he attends", async () => {
    const r = await read("anything from Owen about the board");
    assert.ok(r.results.some((x) => x.title === "Northwind board prep"), r.results.map((x) => x.title).join(" | "));
  });
  it("item 4: Ravi's email about the data import puts that email first", async () => {
    assert.equal((await read("Ravi's email about the data import")).results[0]?.title, "Pilot data import");
  });
  it("item 4: receipts from October puts the receipt first, the rest under a divider", async () => {
    const r = await read("receipts from October");
    assert.match(r.results[0]?.title ?? "", /receipt/i);
    assert.ok((r.topRows ?? 0) >= 1 && (r.topRows ?? 0) < r.total && !!r.restLabel, JSON.stringify({ t: r.topRows, l: r.restLabel }));
  });
  it("item 4: mail from Felix Wagner last month is empty, and dropping the date finds his mail", async () => {
    const r = await read("mail from Felix Wagner last month");
    const date = (r.hiddenBy ?? []).find((h) => /^(after|before):/.test(h.filter));
    if (r.total === 0) {
      assert.ok(date, JSON.stringify(r.hiddenBy));
      assert.ok((await read(dropFilterText("mail from Felix Wagner last month", date!))).total > 0);
    }
  });
  it("item 7: one renewal message first, the other Slack messages under a divider", async () => {
    const r = await read("slack messages about the renewal");
    assert.match(r.results[0]?.snippet ?? r.results[0]?.title ?? "", /renewal/i);
    assert.ok((r.topRows ?? 0) >= 1 && (r.topRows ?? 0) < r.total && /Slack/.test(r.restLabel ?? ""), JSON.stringify({ t: r.topRows, l: r.restLabel }));
  });
  it("item 7: what does Felix want from us puts Felix's ask first", async () => {
    const r = await read("what does Felix want from us?");
    assert.match(`${r.results[0]?.title} ${r.results[0]?.snippet}`, /Felix/);
  });

  it("item 6: deals closing this quarter lists only deals with a close date in it, and counts the ones with none", async () => {
    const r = await read("deals closing this quarter");
    assert.ok(r.total > 0 && r.results.every((x) => x.kind === "deal" && typeof (x.facets as { closeDate?: string }).closeDate === "string"), r.results.map((x) => x.title).join(" | "));
    assert.equal(r.undated?.deals, 1);
  });

  describe("item 2: what a filter hides is what dropping it adds, in every mode", () => {
    for (const q of ["the security questionnaire Globex sent", "notes about the renewal from Priya", "emails from Priya about the renewal", "renewal type:note", "globex renewal from:priya@globex.com type:mail", "slack messages about the renewal", "receipts from October"]) {
      it(`"${q}"`, async () => {
        const r = await read(q);
        for (const h of r.hiddenBy ?? []) {
          const d = await read(dropFilterText(q, h));
          assert.equal(h.n, d.total - r.total, `${h.label} hides ${h.n}, dropping it gives ${d.total} (page ${r.total}, mode ${r.fallback})`);
        }
        if (r.hiddenByFilters > 0 && (r.hiddenBy?.length ?? 0) !== 1) {
          const w = await read(wordsOnlyText(q, r.understood));
          assert.equal(r.hiddenByFilters, w.total - r.total);
        }
      });
    }
  });
});
