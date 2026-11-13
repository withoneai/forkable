// Plain sentences to filters (SPEC D48): the rule table. Pure, no database.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyUnderstood, keepWords, takeChoice, understandQuery, writeUnderstood, type Vocab } from "../src/query/understand.js";
import { findDates, proposeDates, resolveDateValue } from "../src/query/dates.js";
import { parseQuery } from "../src/query/parse.js";

const vocab: Vocab = {
  entities: [
    { id: "p_dana", type: "person", name: "Dana Oyelaran", email: "dana@acme.com", isSelf: true, itemCount: 200 },
    { id: "p_priya", type: "person", name: "Priya Shah", email: "priya@globex.com", itemCount: 40 },
    { id: "p_priya2", type: "person", name: "Priyanka Natarajan", email: "priyanka@initech.io", itemCount: 3 },
    { id: "p_mia", type: "person", name: "Mia Park", email: "mia@acme.com", itemCount: 20 },
    { id: "p_mia2", type: "person", name: "Mia Park", email: "mia.park@hooli.dev", itemCount: 1 },
    { id: "p_lena", type: "person", name: "Lena Vogt", email: "lena@acme.eu", itemCount: 15 },
    { id: "p_may", type: "person", name: "May Lin", email: "may@umbrella.co", itemCount: 4 },
    { id: "p_jose", type: "person", name: "José Álvarez", email: "jose@initrode.com", itemCount: 2 },
    { id: "p_mary", type: "person", name: "Mary Ann Lee", email: "maryann@northwind.vc", itemCount: 2 },
    { id: "p_marco", type: "person", name: "Marco Bellini", email: "marco@globex.com", itemCount: 9 },
    { id: "p_slackbot", type: "person", name: "Theo Lund", email: null, itemCount: 7 },
    { id: "c_acme", type: "company", name: "Acme", domain: "acme.com", isSelf: true, itemCount: 300 },
    { id: "c_globex", type: "company", name: "Globex", domain: "globex.com", itemCount: 60 },
    { id: "c_notion", type: "company", name: "Notion Labs", domain: "notionlabs.io", itemCount: 2 },
    { id: "c_initech", type: "company", name: "Initech", domain: "initech.io", itemCount: 30 },
  ],
  platforms: ["gmail", "slack", "notion", "hubspot", "linear", "google-calendar", "granola", "outlook-mail", "outlook-calendar"],
};

const now = new Date("2026-11-12T10:00:00Z"); // a Thursday
const U = (q: string, tz = "UTC") => understandQuery(q, vocab, { now, tz });

/** [sentence, the filters it applies (in text order), the suggestion kinds it offers, the words left to search] */
type Row = [string, string[], string[]?, string?];

const TABLE: Row[] = [
  // people
  ["emails from Priya last week", ["type:mail", "from:priya@globex.com", "after:2026-11-02 before:2026-11-09"], [], ""],
  ["from Priya", ["from:priya@globex.com"], [], ""],
  ["sent by Priya", ["from:priya@globex.com"], [], ""],
  ["with Lena", ["with:lena@acme.eu"], [], ""],
  ["to Lena", ["to:lena@acme.eu"], [], ""],
  ["meetings with Lena this month", ["type:meeting", "with:lena@acme.eu", "after:2026-11-01"], [], ""],
  ["Priya's emails", ["from:priya@globex.com", "type:mail"], [], ""],
  ["Priya Shah's notes", ["from:priya@globex.com", "type:note,meeting_note"], [], ""],
  ["from priya shah", ["from:priya@globex.com"], [], ""],
  ["from PRIYA", ["from:priya@globex.com"], [], ""],
  ["from Shah", [], ["last_name"], "from Shah"],
  ["from Natarajan", [], ["last_name"], "from Natarajan"],
  ["from Priyanka Natarajan", ["from:priyanka@initech.io"], [], ""],
  ["from Priyanka", ["from:priyanka@initech.io"], [], ""],
  ["from Jose", ["from:jose@initrode.com"], [], ""],
  ["from José Álvarez", ["from:jose@initrode.com"], [], ""],
  ["from Mary Ann Lee", ["from:maryann@northwind.vc"], [], ""],
  ["from Theo", ['from:"Theo Lund"'], [], ""],
  ["from me", ["from:me"], [], ""],
  ["emails I sent", ["type:mail", "from:me"], [], ""],
  ["sent to me", ["to:me"], [], ""],
  ["assigned to me", ["to:me"], [], ""],
  ["from Dana", ["from:me"], [], ""],
  ["from priya@globex.com", ["from:priya@globex.com"], [], ""],
  ["with globex.com", ["with:globex.com"], [], ""],
  ["people at Globex", ["type:person", "with:globex.com"], [], ""],
  ["from Globex", ["with:globex.com"], [], ""],
  ["Globex renewal from Priya", ["from:priya@globex.com"], [], "Globex renewal"],
  // two people, one first name
  ["from Mia", [], ["same_name"], "from Mia"],
  ["emails from Mia Park", ["type:mail"], ["same_name"], "from Mia Park"],
  ["from Priyanka Natarajan and Priya Shah", ["from:priyanka@initech.io,priya@globex.com"], [], ""],
  // tools
  ["in Slack", ["in:slack"], [], ""],
  ["pricing on Notion", ["in:notion"], [], "pricing"],
  ["slack messages", ["in:slack", "type:message"], [], ""],
  ["Linear issues about import", ["in:linear", "type:issue"], [], "about import"],
  ["from HubSpot", ["in:hubspot"], [], ""],
  ["deals from HubSpot", ["type:deal", "in:hubspot"], [], ""],
  ["in Google Calendar", ["in:google-calendar"], [], ""],
  ["in Outlook", ["in:outlook-mail,outlook-calendar"], [], ""],
  ["in Teams", [], [], "in Teams"], // Teams is not connected here
  // a name or a tool
  ["from Notion", [], ["name_or_tool"], "from Notion"],
  ["from Notion Labs", ["with:notionlabs.io"], [], ""],
  ["in Notion", ["in:notion"], [], ""],
  // states
  ["unread emails", ["is:unread", "type:mail"], [], ""],
  ["open deals", ["is:open", "type:deal"], [], ""],
  ["my deals", ["is:mine", "type:deal"], [], ""],
  ["upcoming meetings", ["is:upcoming", "type:meeting"], [], ""],
  ["past meetings with Priya", ["is:past", "type:meeting", "with:priya@globex.com"], [], ""],
  ["what needs me", ["lane:needs-you"], [], ""],
  ["emails waiting on me", ["type:mail", "lane:needs-you"], [], ""],
  ["emails with an attachment", ["type:mail", "has:attachment"], [], ""],
  ["contract with attachments from Marco", ["has:attachment", "from:marco@globex.com"], [], "contract"],
  ["from my VIPs", ["lane:vip"], [], ""],
  ["meeting notes", ["type:meeting_note"], [], ""],
  ["emails and messages from Lena", ["type:mail", "type:message", "from:lena@acme.eu"], [], ""],
  // dates
  ["pricing yesterday", ["on:yesterday"], [], "pricing"],
  ["board deck in October", ["after:2026-10-01 before:2026-11-01"], [], "board deck"],
  ["invoices past 2 weeks", ["after:2026-10-29"], [], "invoices"],
  ["today's meetings", ["on:today", "type:meeting"], [], ""],
  ["in May", ["after:2026-05-01 before:2026-06-01"], [], ""],
  ["from May", [], ["name_or_date"], "from May"],
  ["with May", ["with:may@umbrella.co"], [], ""],
  ["since March", ["after:2026-03-01"], [], ""],
  // false positives: nothing applied
  ["from scratch", [], [], "from scratch"],
  ["in progress", [], [], "in progress"],
  ["with regards", [], [], "with regards"],
  ["notes from the meeting", ["type:note,meeting_note"], [], "from meeting"],
  ["open the Globex doc", [], [], "open the Globex doc"],
  ["how to open a ticket", [], [], "how to open a ticket"],
  ["may I see the pricing", [], [], "may I see the pricing"],
  ["Globex deal", [], [], "Globex deal"],
  ["renewal emails", [], [], "renewal emails"],
  ["email address of Priya", [], [], "email address of Priya"],
  ["talk to the team", [], [], "talk to the team"],
  ["on Monday", [], [], "on Monday"],
  ["linear regression", [], [], "linear regression"],
  ["the deal with it", [], [], "the deal with it"],
  ["sorted by date", [], [], "sorted by date"],
  ["globex renewal", [], [], "globex renewal"],
  ["deal with it", [], [], "deal with it"],
  ["email about pricing", [], [], "email about pricing"],
  ["messages in #deals", ["type:message"], [], "in #deals"],
  ["meeting with Lena", ["type:meeting", "with:lena@acme.eu"], [], ""],
  ["who emailed me about the renewal", [], [], "who emailed me about the renewal"],
  ["", [], [], ""],
  // typed filters win and are never read
  ["from:lena emails from Priya", ["type:mail"], [], "from:lena from Priya"],
  ["type:deal emails", [], [], "type:deal emails"],
  ['"emails from Priya"', [], [], '"emails from Priya"'],
  ["-unread emails", ["type:mail"], [], "-unread"],
  ["in:gmail from Priya in Slack", ["from:priya@globex.com"], [], "in:gmail in Slack"],
  ["after:2026-01-01 pricing last week", [], [], "after:2026-01-01 pricing last week"],
  ["emails from Priya OR Lena", ["type:mail", "from:priya@globex.com"], [], "OR Lena"],
];

const filtersOf = (q: string) => U(q).understood.map((u) => u.filter);
const wordsLeft = (q: string) => {
  const r = U(q);
  // what is left of the sentence once filters are taken out (filters typed by hand stay, in order)
  const added = new Set(r.understood.map((u) => u.filter));
  return r.query.split(/\s+/).filter((w) => w && ![...added].some((f) => f.split(" ").includes(w))).join(" ");
};

describe("understanding plain sentences (D48)", () => {
  it(`has at least 60 cases (${TABLE.length})`, () => assert.ok(TABLE.length >= 60));
  for (const [q, filters, sugg = [], left] of TABLE) {
    it(`"${q}"`, () => {
      const r = U(q);
      assert.deepEqual(r.understood.map((u) => u.filter), filters, `filters for "${q}": ${JSON.stringify(r.understood)}`);
      assert.deepEqual(r.suggestions.map((s) => s.why), sugg, `suggestions for "${q}": ${JSON.stringify(r.suggestions)}`);
      if (left !== undefined) assert.equal(wordsLeft(q), left, `words left for "${q}": ${r.query}`);
    });
  }

  it("labels read in plain words", () => {
    const r = U("emails from Priya last week");
    assert.deepEqual(r.understood.map((u) => u.label), ["Emails", "From Priya Shah", "Last week, Nov 2 to Nov 8"]);
    assert.deepEqual(U("from me").understood[0]!.label, "From you");
    assert.deepEqual(U("in Outlook").understood[0]!.label, "In Outlook Mail or Outlook Calendar");
  });

  it("two people with the same name come back as choices with their addresses", () => {
    const s = U("from Mia").suggestions[0]!;
    assert.equal(s.phrase, "from Mia");
    assert.deepEqual(s.choices.map((c) => [c.label, c.filter, c.detail]), [
      ["From Mia Park", "from:mia@acme.com", "mia@acme.com"],
      ["From Mia Park", "from:mia.park@hooli.dev", "mia.park@hooli.dev"],
    ]);
    // a second Priya: the first name alone is a question, the full name is not
    const two: Vocab = { ...vocab, entities: [...vocab.entities, { id: "p_priya3", type: "person", name: "Priya Natarajan", email: "priya.n@initech.io", itemCount: 3 }] };
    const r = understandQuery("emails from Priya", two, { now, tz: "UTC" });
    assert.deepEqual(r.understood.map((u) => u.filter), ["type:mail"]);
    assert.deepEqual(r.suggestions[0]!.choices.map((c) => c.filter), ["from:priya@globex.com", "from:priya.n@initech.io"]);
    assert.deepEqual(understandQuery("from Priya Shah", two, { now, tz: "UTC" }).understood.map((u) => u.filter), ["from:priya@globex.com"]);
    assert.deepEqual(understandQuery("Priya's notes", two, { now, tz: "UTC" }).suggestions.map((s) => s.why), ["same_name"]);
  });

  it("a name or a tool offers both", () => {
    const s = U("from Notion").suggestions[0]!;
    assert.deepEqual(s.choices.map((c) => c.filter), ["in:notion", "with:notionlabs.io"]);
    const m = U("from May").suggestions[0]!;
    assert.deepEqual(m.choices.map((c) => c.filter), ["after:2026-05-01", "from:may@umbrella.co"]);
  });

  it("phrases keep their place in the text", () => {
    const q = "Emails from Priya, last week?";
    const r = U(q);
    for (const u of r.understood) assert.equal(q.slice(u.start, u.end), u.phrase);
    assert.deepEqual(r.understood.map((u) => u.phrase), ["Emails", "from Priya", "last week"]);
  });

  it("the searched query takes the phrases out and adds the filters", () => {
    assert.equal(U("Globex renewal emails from Priya").query, "Globex renewal emails from:priya@globex.com");
    assert.equal(U("emails from Priya last week").query, "type:mail from:priya@globex.com after:2026-11-02 before:2026-11-09");
    const p = parseQuery(U("emails from Priya last week").query, now, "UTC");
    assert.equal(p.text, "");
    assert.equal(p.errors.length, 0);
  });

  it("removing a chip keeps the words, and they are never read again", () => {
    const q = "emails from Priya last week";
    const r = U(q);
    const from = r.understood.find((u) => u.kind === "person")!;
    const kept = keepWords(q, [from]);
    assert.equal(kept, 'emails "from Priya" last week');
    assert.deepEqual(filtersOf(kept), ["type:mail", "after:2026-11-02 before:2026-11-09"]);
    const all = keepWords(q, r.understood);
    assert.equal(all, '"emails" "from Priya" "last week"');
    assert.deepEqual(filtersOf(all), []);
  });

  it("taking a choice writes that filter in place of the phrase", () => {
    const q = "emails from Mia about the launch";
    const s = U(q).suggestions[0]!;
    const next = takeChoice(q, s, s.choices[1]!.filter);
    assert.equal(next, "emails from:mia.park@hooli.dev about the launch");
    assert.deepEqual(filtersOf(next), ["type:mail"]);
  });

  it("editing an understood chip by hand writes its filter into the box", () => {
    const q = "emails from Priya last week";
    assert.equal(writeUnderstood(q, U(q).understood, ["from"]), "emails from:priya@globex.com last week");
  });

  it("applyUnderstood tidies the leftover punctuation", () => {
    assert.equal(applyUnderstood("pricing, from Priya?", [{ start: 9, end: 19, filter: "from:priya@globex.com" }]), "pricing? from:priya@globex.com");
  });

  it("is fast: 1,000 sentences against 5,000 people well under a second", () => {
    const big: Vocab = { entities: [...vocab.entities, ...Array.from({ length: 5000 }, (_, i) => ({ id: `x${i}`, type: "person" as const, name: `Person${i} Last${i}`, email: `p${i}@x.example` }))], platforms: vocab.platforms };
    understandQuery("warm up", big, { now });
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) understandQuery(`emails from Priya last week about pricing ${i}`, big, { now, tz: "UTC" });
    assert.ok(performance.now() - t0 < 1000, `${Math.round(performance.now() - t0)} ms`);
  });
});

describe("dates in a time zone (D48)", () => {
  // 2026-11-12 22:30 UTC is already Friday 2026-11-13 01:30 in Doha (UTC+3)
  const late = new Date("2026-11-12T22:30:00Z");
  it("today and yesterday follow the browser's zone, not the server's", () => {
    const qa = resolveDateValue("today", late, "Asia/Qatar")!;
    assert.equal(qa.from, "2026-11-12T21:00:00.000Z");
    assert.equal(qa.to, "2026-11-13T21:00:00.000Z");
    const utc = resolveDateValue("today", late, "UTC")!;
    assert.equal(utc.from, "2026-11-12T00:00:00.000Z");
    assert.equal(findDates("yesterday", late, "Asia/Qatar")[0]!.label, "Yesterday, Nov 12");
    assert.equal(findDates("yesterday", late, "UTC")[0]!.label, "Yesterday, Nov 11");
  });
  it("a plain date in the box is that day in that zone", () => {
    assert.equal(resolveDateValue("2026-11-02", late, "Asia/Qatar")!.from, "2026-11-01T21:00:00.000Z");
    assert.equal(parseQuery("after:2026-11-02", late, "Asia/Qatar").clauses[0]!.kind, "op");
  });
  it("last week in Doha on a Friday morning", () => {
    const r = understandQuery("emails from Priya last week", vocab, { now: late, tz: "Asia/Qatar" });
    assert.equal(r.understood[2]!.filter, "after:2026-11-02 before:2026-11-09");
    assert.equal(r.understood[2]!.label, "Last week, Nov 2 to Nov 8");
  });
  it("an unknown zone falls back to the process zone", () => {
    assert.ok(resolveDateValue("today", late, "Not/AZone"));
  });
  it("proposals keep their old shape", () => {
    assert.deepEqual(proposeDates("pricing last month", now, "UTC"), [{ phrase: "last month", remove: "last month", insert: "after:2026-10-01 before:2026-11-01", label: "October 2026" }]);
  });
});
