// Plain sentences (SPEC D48), the cases an independent check broke: when in doubt,
// nothing is applied. Every row is an input that once applied a wrong or partial
// filter. Pure, no database.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { understandQuery, type Vocab, type VocabEntity } from "../src/query/understand.js";

const people: VocabEntity[] = [
  { id: "p_dana", type: "person", name: "Dana Oyelaran", email: "dana@acme.com", isSelf: true, itemCount: 200 },
  { id: "p_priya", type: "person", name: "Priya Shah", email: "priya@globex.com", itemCount: 40 },
  { id: "p_marco", type: "person", name: "Marco Bellini", email: "marco@globex.com", itemCount: 9 },
  { id: "p_lena", type: "person", name: "Lena Vogt", email: "lena@acme.eu", itemCount: 15 },
  { id: "p_lena_chat", type: "person", name: "Lena Vogt", email: null, itemCount: 3 },
  { id: "p_may", type: "person", name: "May Lin", email: "may@umbrella.co", itemCount: 4 },
  { id: "p_mark", type: "person", name: "Mark Bell", email: "mark@hooli.dev", itemCount: 4 },
  { id: "p_will", type: "person", name: "Will Turner", email: "will@hooli.dev", itemCount: 4 },
  { id: "p_grace", type: "person", name: "Grace Liu", email: "grace.liu@initrode.com", itemCount: 4 },
  { id: "p_april", type: "person", name: "April Stone", email: "april@initrode.com", itemCount: 4 },
  { id: "p_owen", type: "person", name: "Owen Price", email: "owen@northwind.vc", itemCount: 4 },
  { id: "p_hannah", type: "person", name: "Hannah Cole", email: "hannah.cole@umbrella.co", itemCount: 4 },
  { id: "p_felix", type: "person", name: "Felix Braun", email: "felix@umbrella.co", itemCount: 2 },
  { id: "p_sam", type: "person", name: "Sam Okafor", email: "sam@acme.com", itemCount: 4 },
  { id: "p_ahmad", type: "person", name: "أحمد علي", email: "ahmad@qatar.example", itemCount: 4 },
  { id: "p_jiro", type: "person", name: "ゴロウ 山田", email: "goro@tokyo.example", itemCount: 4 },
  { id: "p_zoe", type: "person", name: "Zoë Ångström", email: "zoe@nordic.example", itemCount: 4 },
  { id: "c_globex", type: "company", name: "Globex", domain: "globex.com", itemCount: 60 },
  { id: "c_umbrella", type: "company", name: "Umbrella", domain: "umbrella.co", itemCount: 60 },
  { id: "c_initech", type: "company", name: "Initech", domain: "initech.io", itemCount: 30 },
];
const vocab: Vocab = { entities: people, platforms: ["gmail", "slack", "notion", "hubspot", "linear", "teams", "google-calendar"] };
const now = new Date("2026-11-12T10:00:00Z"); // a Thursday in November
const U = (q: string) => understandQuery(q, vocab, { now, tz: "UTC" });

/** [sentence, filters applied, suggestion kinds offered, the choices' filters (all suggestions, in order)] */
type Row = [string, string[], string[], string[]?];

const TABLE: Row[] = [
  // 1. "not" never becomes its opposite: offered as the exclusion, never applied
  ["not from Priya", [], ["negated"], ["-from:priya@globex.com"]],
  ["emails that are not from Priya", ["type:mail"], ["negated"], ["-from:priya@globex.com"]],
  ["emails except from Priya", ["type:mail"], ["negated"], ["-from:priya@globex.com"]],
  ["messages that aren't in Slack", ["type:message"], ["negated"], ["-in:slack"]],
  ["emails other than from Lena", ["type:mail"], ["negated"], ['-from:"Lena Vogt"']],
  ["notes without Priya", ["type:note,meeting_note"], ["negated"], ["-with:priya@globex.com"]],
  ["excluding Globex", [], ["negated"], ["-with:globex.com"]],
  ["emails not last week", ["type:mail"], []],
  ["not emails from Priya", [], []],
  ["didn't reply to Priya", [], []],
  ["not unread", [], []],
  // 3. a last name alone is offered, and only when it reads as a name
  ["emails with price changes", ["type:mail"], []],
  ["emails with Price", ["type:mail"], ["last_name"], ["with:owen@northwind.vc"]],
  ["from Shah", [], ["last_name"], ["from:priya@globex.com"]],
  ["the shah's report", [], ["last_name"], ["with:priya@globex.com"]],
  // first names that are words need a capital and nothing after them
  ["emails with grace", ["type:mail"], ["common_word"], ["with:grace.liu@initrode.com"]],
  ["emails from Grace", ["type:mail", "from:grace.liu@initrode.com"], []],
  ["from will", [], ["common_word"], ["from:will@hooli.dev"]],
  ["from Will", ["from:will@hooli.dev"], []],
  ["mark as read", [], []],
  ["from Mark about pricing", ["from:mark@hooli.dev"], []],
  // tool names that are everyday words
  ["notes on linear algebra", ["type:note,meeting_note"], ["maybe_tool"], ["in:linear"]],
  ["notes on slack time", ["type:note,meeting_note"], ["maybe_tool"], ["in:slack"]],
  ["work in teams", [], ["maybe_tool"], ["in:teams"]],
  ["messages in teams", ["type:message", "in:teams"], []],
  ["notes on Notion", ["type:note,meeting_note", "in:notion"], []],
  ["in Linear", ["in:linear"], []],
  ["slack messages", ["in:slack", "type:message"], []],
  ["linear regression", [], []],
  ["notion of risk", [], []],
  ["deals in hubspot pipeline", ["type:deal"], ["maybe_tool"], ["in:hubspot"]],
  ["deals in hubspot", ["type:deal", "in:hubspot"], []],
  // 5. lists
  ["emails from Priya and Marco", ["type:mail", "from:priya@globex.com,marco@globex.com"], []],
  ["from Priya or Marco", ["from:priya@globex.com,marco@globex.com"], []],
  ["from Hannah, Felix", ["from:hannah.cole@umbrella.co,felix@umbrella.co"], []],
  ["from Priya, Marco and Hannah", ["from:priya@globex.com,marco@globex.com,hannah.cole@umbrella.co"], []],
  ["with Initech, Umbrella", [], ["list"], ["with:initech.io,umbrella.co"]],
  ["with Initech and Umbrella", [], ["list"], ["with:initech.io,umbrella.co"]],
  ["with Initech or Umbrella", ["with:initech.io,umbrella.co"], []],
  ["to Lena and Sam", [], ["list"], ['to:"Lena Vogt",sam@acme.com']],
  ["from Priya and Nobody Known", [], []],
  ["from Priya and the team", ["from:priya@globex.com"], []],
  ["from Priya, last week", ["from:priya@globex.com", "after:2026-11-02 before:2026-11-09"], []],
  // 6. one human with two records: one chip, never two identical choices
  ["with Lena", ['with:"Lena Vogt"'], []],
  // 7. names in any script
  ["from أحمد", ["from:ahmad@qatar.example"], []],
  ["emails from أحمد علي", ["type:mail", "from:ahmad@qatar.example"], []],
  ["from ‏أحمد", ["from:ahmad@qatar.example"], []],
  ["from ゴロウ", ["from:goro@tokyo.example"], []],
  ["from ｺﾞﾛｳ", ["from:goro@tokyo.example"], []],
  ["from Zoe", ["from:zoe@nordic.example"], []],
  ["from ZOË ÅNGSTRÖM", ["from:zoe@nordic.example"], []],
  ["from Zoë", ["from:zoe@nordic.example"], []],
  // minor: duplicate chips, dates with a day, a month still ahead, attachments
  ["from Lena Vogt's team", ['with:"Lena Vogt"'], []],
  ["priya's priya's", ["with:priya@globex.com"], []],
  ["from April 3", [], ["name_or_date"], ["after:2026-04-03", "from:april@initrode.com"]],
  ["since April 3", ["after:2026-04-03"], []],
  ["emails on May 5", ["type:mail", "after:2026-05-05 before:2026-05-06"], []],
  ["in December", [], ["which_year"], ["after:2025-12-01 before:2026-01-01", "after:2026-12-01 before:2027-01-01"]],
  ["in December 2025", ["after:2025-12-01 before:2026-01-01"], []],
  ["since December", ["after:2025-12-01"], []],
  ["in October", ["after:2026-10-01 before:2026-11-01"], []],
  ["in November", ["after:2026-11-01 before:2026-12-01"], []],
  ["attachments from Priya", ["has:attachment", "from:priya@globex.com"], []],
];

describe("understanding, when in doubt (D48)", () => {
  for (const [q, filters, why, choices] of TABLE) {
    it(`"${q}"`, () => {
      const r = U(q);
      assert.deepEqual(r.understood.map((u) => u.filter), filters, `filters: ${JSON.stringify(r.understood)}`);
      assert.deepEqual(r.suggestions.map((s) => s.why), why, `suggestions: ${JSON.stringify(r.suggestions)}`);
      if (choices) assert.deepEqual(r.suggestions.flatMap((s) => s.choices.map((c) => c.filter)), choices);
      // nothing negated is ever in what is searched as a positive filter
      if (/\b(not|except|without|excluding|other than)\b|n't\b/i.test(q)) for (const u of r.understood) assert.ok(!/^(from|with|to|in):/.test(u.filter), `"${q}" applied ${u.filter}`);
    });
  }

  it("labels say the year and the exclusion in plain words", () => {
    assert.equal(U("not from Priya").suggestions[0]!.choices[0]!.label, "Not from Priya Shah");
    assert.equal(U("in October").understood[0]!.label, "October 2026");
    assert.deepEqual(U("in December").suggestions[0]!.choices.map((c) => c.label), ["December 2025", "December 2026"]);
    assert.equal(U("since April 3").understood[0]!.label, "Since Apr 3, 2026");
    assert.equal(U("from Priya or Marco").understood[0]!.label, "From Priya Shah or Marco Bellini");
    assert.equal(U("from Priya, Marco and Hannah").understood[0]!.label, "From Priya Shah, Marco Bellini or Hannah Cole");
  });

  it("question and filler words leave the searched words once a filter is read", () => {
    assert.equal(U("what happened last week").query, "after:2026-11-02 before:2026-11-09");
    assert.equal(U("anything from last week").query, "from after:2026-11-02 before:2026-11-09");
    assert.equal(U("who did I email last week").query, "email after:2026-11-02 before:2026-11-09");
    // no filter read: every word stays
    assert.equal(U("what did Priya say about pricing").query, "what did Priya say about pricing");
  });

  it("a person beyond the in-memory list is found by exact name or address", () => {
    const extra: VocabEntity[] = [{ id: "p_rare", type: "person", name: "Ines Rare", email: "ines@rare.example", itemCount: 1 }];
    assert.deepEqual(understandQuery("from Ines Rare", vocab, { now, tz: "UTC" }).understood.map((u) => u.filter), []);
    assert.deepEqual(understandQuery("from Ines Rare", vocab, { now, tz: "UTC", extra }).understood.map((u) => u.filter), ["from:ines@rare.example"]);
    assert.deepEqual(understandQuery("from ines@rare.example", vocab, { now, tz: "UTC", extra }).understood.map((u) => u.label), ["From Ines Rare"]);
  });

  it("two people who share a name still ask; a record with no address could be either, so it stays apart", () => {
    const two: Vocab = { ...vocab, entities: [...people, { id: "p_lena3", type: "person", name: "Lena Vogt", email: "lena.vogt@hooli.dev", itemCount: 2 }] };
    const r = understandQuery("with Lena", two, { now, tz: "UTC" });
    assert.deepEqual(r.understood, []);
    assert.equal(r.suggestions[0]!.why, "same_name");
    assert.deepEqual(r.suggestions[0]!.choices.map((c) => c.detail), ["lena@acme.eu", null, "lena.vogt@hooli.dev"]);
  });
});
