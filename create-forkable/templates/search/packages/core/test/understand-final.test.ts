// Final review of plain sentences (2026-11-12): every input the two testers found failing,
// as rules (pure) here; the same inputs run on the Acme sample in understand-search.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { understandQuery, withoutFiller, type Vocab } from "../src/query/understand.js";
import { findDates } from "../src/query/dates.js";
import { editDistance, nearestByName } from "../src/search/hybrid.js";

const vocab: Vocab = {
  entities: [
    { id: "p_dana", type: "person", name: "Dana Oyelaran", email: "dana@acme.com", isSelf: true, itemCount: 200 },
    { id: "p_priya", type: "person", name: "Priya Shah", email: "priya@globex.com", itemCount: 40 },
    { id: "p_mia", type: "person", name: "Mia Park", email: "mia@acme.com", itemCount: 20 },
    { id: "p_mia2", type: "person", name: "Mia Park", email: "mia.park@hooli.dev", itemCount: 1 },
    { id: "p_jules", type: "person", name: "Jules Martin", email: "jules@hooli.dev", itemCount: 4 },
    { id: "p_marco", type: "person", name: "Marco Bellini", email: "marco@globex.com", itemCount: 9 },
    { id: "p_owen", type: "person", name: "Owen Price", email: "owen@northwind.vc", itemCount: 9 },
    { id: "p_ravi", type: "person", name: "Ravi Menon", email: "ravi@initech.io", itemCount: 12 },
    { id: "p_ravi_chat", type: "person", name: "Ravi M.", email: null, itemCount: 3 },
    { id: "p_lena", type: "person", name: "Lena Vogt", email: "lena@acme.eu", itemCount: 15 },
    { id: "c_globex", type: "company", name: "Globex", domain: "globex.com", itemCount: 60 },
    { id: "c_initech", type: "company", name: "Initech", domain: "initech.io", itemCount: 30 },
    { id: "c_northwind", type: "company", name: "Northwind Ventures", domain: "northwind.vc", itemCount: 12 },
  ],
  platforms: ["gmail", "slack", "linear", "granola", "google-calendar", "outlook-mail", "outlook-calendar", "hubspot", "notion", "teams"],
  kinds: { notion: ["doc"], teams: ["message"], slack: ["message", "person"], linear: ["task", "doc"], granola: ["meeting_note"], gmail: ["email_thread"], "google-calendar": ["event"], "outlook-mail": ["email_thread"], "outlook-calendar": ["event"], hubspot: ["deal", "note", "person", "company"] },
};
const now = new Date("2026-11-12T10:00:00Z"); // a Thursday
const U = (q: string, tz = "UTC", at = now) => understandQuery(q, vocab, { now: at, tz });
const filters = (q: string, tz?: string, at?: Date) => U(q, tz, at).understood.map((u) => u.filter);
/** What is left to search once the filters are out. */
const left = (q: string, tz?: string, at?: Date) => {
  const r = U(q, tz, at);
  const added = new Set(r.understood.flatMap((u) => u.filter.split(" ")));
  return r.query.split(/\s+/).filter((w) => w && !added.has(w)).join(" ");
};

describe("final review: words that only restate a filter are not required (item 1)", () => {
  const rows: [string, string[], string][] = [
    ["emails from people at Initech", ["type:mail", "with:initech.io"], "from"],
    ["issues assigned to Mia", ["type:issue"], "to Mia"],
    ["what's on my calendar tomorrow", ["type:event", "on:tomorrow"], ""],
    ["emails I haven't replied to", ["type:mail", "lane:needs-you"], ""],
    ["linear issues in review", ["in:linear", "type:issue", 'status:"in review"'], ""],
    ["calendar events next week", ["type:event", "after:2026-11-16 before:2026-11-23"], ""],
    ["anything from Jules since Monday", ["with:jules@hooli.dev", "after:2026-11-09"], ""], // "anything from": anything they are part of (polish item 4)
  ];
  for (const [q, f, l] of rows) it(`"${q}"`, () => { assert.deepEqual(filters(q), f); assert.equal(left(q), l); });
});

describe("final review: dates (item 2)", () => {
  const rows: [string, string, string?][] = [
    ["since Monday", "after:2026-11-09"],
    ["this quarter", "after:2026-10-01 before:2027-01-01"],
    ["last quarter", "after:2026-07-01 before:2026-10-01"],
    ["between Oct 1 and Oct 15", "after:2026-10-01 before:2026-10-16"],
    ["from Oct 1 to Oct 15", "after:2026-10-01 before:2026-10-16"],
    ["3 days ago", "on:2026-11-09"],
    ["the past two weeks", "after:2026-10-29"],
    ["two weeks ago", "after:2026-10-26 before:2026-11-02"],
    ["tomorrow", "on:tomorrow"],
    ["next week", "after:2026-11-16 before:2026-11-23"],
    ["before last Friday", "before:2026-11-06"],
    ["last Friday", "on:2026-11-06"],
  ];
  for (const [q, insert] of rows) it(`"${q}"`, () => assert.deepEqual(findDates(q, now, "UTC").map((d) => d.insert), [insert]));

  it("dates follow the zone: 23:30 UTC on Thursday is already Friday in Doha", () => {
    const late = new Date("2026-11-12T23:30:00Z");
    assert.deepEqual(findDates("3 days ago", late, "UTC").map((d) => d.insert), ["on:2026-11-09"]);
    assert.deepEqual(findDates("3 days ago", late, "Asia/Qatar").map((d) => d.insert), ["on:2026-11-10"]);
    assert.equal(findDates("since Monday", late, "Asia/Qatar")[0]!.label, "Since Monday, Nov 9");
    assert.deepEqual(findDates("last Friday", late, "Asia/Qatar").map((d) => d.insert), ["on:2026-11-06"]);
    assert.deepEqual(filters("anything from Jules since Monday", "Asia/Qatar", late), ["with:jules@hooli.dev", "after:2026-11-09"]);
  });

  it("closing or due points the date at the end: deals closing this quarter", () => {
    assert.deepEqual(filters("deals closing this quarter"), ["type:deal", "during:2026-10-01..2026-12-31"]);
    assert.equal(U("deals closing this quarter").understood[1]!.label, "Closing this quarter, Q4 2026");
    assert.deepEqual(filters("tasks due this week"), ["type:issue", "during:2026-11-09..2026-11-15"]);
  });

  it("a range not started yet this year is last year's", () => {
    assert.deepEqual(findDates("between Dec 1 and Dec 5", now, "UTC").map((d) => d.insert), ["after:2025-12-01 before:2025-12-06"]);
  });
});

describe("final review: from means from (item 3)", () => {
  it("a possessive before a type word is from; before anything else it is with", () => {
    assert.deepEqual(filters("Priya's emails"), ["from:priya@globex.com", "type:mail"]);
    assert.deepEqual(filters("Priya's multi-year discount"), ["with:priya@globex.com"]);
  });
  it("a name before sent is the sender", () => {
    assert.deepEqual(filters("that contract Marco sent"), ["from:marco@globex.com"]);
    assert.equal(left("that contract Marco sent"), "contract");
    assert.deepEqual(filters("the security questionnaire Globex sent"), ["with:globex.com"]);
  });
  it("emails I sent to Owen are from you and to Owen", () => {
    assert.deepEqual(filters("emails I sent to Owen"), ["type:mail", "from:me", "to:owen@northwind.vc"]);
  });
});

describe("final review: chips that hide what was asked (item 4)", () => {
  it("a type word a tool already implies is not a second chip", () => {
    assert.deepEqual(filters("slack messages about the renewal"), ["in:slack"]);
    assert.equal(left("slack messages about the renewal"), "about renewal");
    assert.deepEqual(filters("granola notes with Priya"), ["in:granola", "with:priya@globex.com"]);
    // Linear holds issues and docs, so Issues still narrows
    assert.deepEqual(filters("linear issues"), ["in:linear", "type:issue"]);
    // with no kinds known, nothing is dropped
    assert.deepEqual(understandQuery("slack messages", { ...vocab, kinds: undefined }, { now, tz: "UTC" }).understood.map((u) => u.filter), ["in:slack", "type:message"]);
  });
  it("who works at a company lists its people", () => {
    assert.deepEqual(filters("who works at Northwind"), ["type:person", "with:northwind.vc"]);
  });
});

describe("final review: the comparison against main", () => {
  it("a chat account written with an initial is the same person (Ravi M. is Ravi Menon)", () => {
    assert.deepEqual(filters("Ravi's email about the data import"), ['from:"Ravi Menon"', "type:mail"]);
  });
  it("pages are docs and edited points at the last change", () => {
    assert.deepEqual(filters("notion pages edited this week"), ["in:notion", "updated:>=2026-11-09"]);
    assert.equal(U("notion pages edited this week").understood[1]!.label, "Changed this week, since Nov 9");
  });
  it("a Teams chat is In Teams", () => {
    assert.deepEqual(filters("Teams chat with Lena about the 12% ask"), ["in:teams", "with:lena@acme.eu"]);
  });
});

describe("final review: names (item 5)", () => {
  it("question words are not part of a name", () => {
    assert.equal(withoutFiller("who is Priya Shah"), "Priya Shah");
    assert.equal(withoutFiller("who is Owen Price?"), "Owen Price");
    assert.equal(withoutFiller("who"), "who");
  });
  it("a misspelt first name finds the person", () => {
    assert.equal(editDistance("prya", "priya"), 1);
    assert.equal(editDistance("pirya", "priya"), 1);
    assert.equal(nearestByName(vocab.entities, "Prya"), "p_priya");
    assert.equal(nearestByName(vocab.entities, "Priya"), null);
    assert.equal(nearestByName(vocab.entities, "pricing"), null);
  });
});
