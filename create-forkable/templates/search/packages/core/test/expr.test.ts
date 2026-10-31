import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePath, isValidPath } from "../src/expr/path.js";
import { renderTemplate, renderValue } from "../src/expr/template.js";
import { evalPredicate, parsePredicate } from "../src/expr/predicate.js";
import { evalExpr } from "../src/expr/field.js";
import { decode } from "../src/decode/index.js";
import { decodeAddress, decodeDomain, isFreeMail } from "../src/decode/address.js";
import { fuseRanks, boostScore } from "../src/search/hybrid.js";
import { parseQuery, formatQuery, applyChip, OPERATOR_KEYS } from "../src/query/parse.js";
import { resolveDateValue } from "../src/query/dates.js";
import { hashProfile, canonicalJson } from "../src/profile/hash.js";
import { validateProfile } from "../src/profile/validate.js";
import { resolveDates, resolveRel, rfc2822 } from "../src/sample/world.js";
import { hashEmbed } from "../src/embed/local-hash.js";
import { pad } from "../src/embed/providers.js";
import { ticketProfile } from "./helpers.js";

const rec = {
  id: "abc",
  ids: ["x", "y"],
  contact: { emails: [{ address: "A@x.com" }, { address: "b@y.com" }] },
  messages: [
    { payload: { headers: [{ name: "From", value: "Jane <jane@acme.com>" }, { name: "To", value: "a@x.com, Bob <b@y.com>" }] }, labelIds: ["INBOX", "UNREAD"] },
    { payload: { headers: [{ name: "from", value: "c@z.com" }] }, labelIds: ["SENT"] },
  ],
  props: { Name: { type: "title", title: [{ plain_text: "Plan" }] }, Champion: { type: "email", email: "priya@globex.com" } },
  "@odata.nextLink": "https://graph/x?$skip=10",
};

describe("path grammar (One CLI cases plus [-1], quoted keys, object values)", () => {
  it("dotted and numeric", () => {
    assert.deepEqual(resolvePath(rec, "id"), ["abc"]);
    assert.deepEqual(resolvePath(rec, "ids.0"), ["x"]);
    assert.deepEqual(resolvePath(rec, "ids[1]"), ["y"]);
    assert.deepEqual(resolvePath(rec, "contact.emails.0.address"), ["A@x.com"]);
  });
  it("wildcards fan out, nested", () => {
    assert.deepEqual(resolvePath(rec, "contact.emails[].address"), ["A@x.com", "b@y.com"]);
    assert.equal(resolvePath(rec, "messages[].payload.headers[].value").length, 3);
    assert.deepEqual(resolvePath(rec, "messages[].labelIds[]"), ["INBOX", "UNREAD", "SENT"]);
  });
  it("filters are case-insensitive on the value", () => {
    assert.deepEqual(resolvePath(rec, "messages[].payload.headers[name=From].value"), ["Jane <jane@acme.com>", "c@z.com"]);
    assert.deepEqual(resolvePath(rec, "messages[0].payload.headers[name='to'].value"), ["a@x.com, Bob <b@y.com>"]);
  });
  it("negative index, quoted key, object values", () => {
    assert.deepEqual(resolvePath(rec, "messages[-1].labelIds[0]"), ["SENT"]);
    assert.deepEqual(resolvePath(rec, '["@odata.nextLink"]'), ["https://graph/x?$skip=10"]);
    assert.deepEqual(resolvePath(rec, "props[type=email].email"), ["priya@globex.com"]);
    assert.equal(resolvePath(rec, "props[]").length, 2);
  });
  it("missing paths resolve to nothing", () => {
    assert.deepEqual(resolvePath(rec, "nope.deeper"), []);
    assert.deepEqual(resolvePath(rec, "ids[5]"), []);
    assert.equal(isValidPath("a[b"), false);
    assert.equal(isValidPath("a.b[0].c"), true);
  });
});

describe("templates and filters", () => {
  const ctx = { item: { id: "t 1", when: "2026-10-28T10:00:00Z", list: ["a", "", "b"], note: "<p>Call with Priya.</p><p>Next</p>" }, run: { since: new Date("2026-10-01T00:00:00Z") }, account: {} };
  it("renders and encodes", () => {
    assert.equal(renderTemplate("https://x/{{ item.id | urlencode }}", ctx), "https://x/t%201");
    assert.equal(renderTemplate("after:{{ run.since | unix }}", ctx), "after:1790812800");
    assert.equal(renderTemplate("{{ run.since | unixms }}", ctx), "1790812800000");
    assert.equal(renderTemplate("{{ item.when | date:\"yyyy/MM/dd\" }}", ctx), "2026/10/28");
    assert.equal(renderTemplate("{{ item.when | iso }}", ctx), "2026-10-28T10:00:00.000Z");
    assert.equal(renderTemplate("{{ item.list | join:\"+\" }}", ctx), "a+b");
    assert.equal(renderTemplate("{{ item.missing | default:\"none\" }}", ctx), "none");
    assert.equal(renderTemplate("{{ 'Jane <J@Acme.com>' | email }}", ctx), "j@acme.com");
    assert.equal(renderTemplate("{{ '1730000000.123456' | slackts }}", ctx), "p1730000000123456");
    assert.equal(renderTemplate("{{ item.note | striphtml | firstline | truncate:10 }}", ctx), "Call with…");
  });
  it("all-empty renders null; strict links render null on any empty part", () => {
    assert.equal(renderTemplate("{{ item.a }} {{ item.b }}", ctx), null);
    assert.equal(renderTemplate("https://app/{{ account.portalId }}/{{ item.id }}", ctx, { strict: true }), null);
    assert.equal(renderTemplate("{{ item.id }}", ctx, { strict: true }), null, "not an absolute URL");
    assert.equal(renderValue("{{ 5 }}", ctx), 5);
  });
  it("rejects unknown filters", () => assert.throws(() => renderTemplate("{{ item.id | shout }}", ctx)));
});

describe("predicates", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  const c = { now, item: { status: "deleted", archived: true, n: 3, at: "2026-10-01T00:00:00Z", labels: ["INBOX", "UNREAD"], "@removed": { reason: "deleted" }, gone: null } };
  it("compares, combines and calls", () => {
    assert.equal(evalPredicate("item.status == 'deleted'", c), true);
    assert.equal(evalPredicate("item.archived == true && item.n >= 3", c), true);
    assert.equal(evalPredicate("item.n > 5 || !item.archived", c), false);
    assert.equal(evalPredicate("contains(item.labels, 'UNREAD')", c), true);
    assert.equal(evalPredicate("len(item.labels) == 2", c), true);
    assert.equal(evalPredicate("item.status in ['open', 'deleted']", c), true);
    assert.equal(evalPredicate("item.@removed != null", c), true);
    assert.equal(evalPredicate("item.gone != null", c), false);
    assert.equal(evalPredicate("item.at > now - 30d", c), true);
    assert.equal(evalPredicate("item.at > now - 7d", c), false);
  });
  it("is a parser, not eval", () => {
    assert.throws(() => parsePredicate("process.exit(1)"));
    assert.throws(() => parsePredicate("item.a ==="));
  });
});

describe("decoders", () => {
  it("text family", () => {
    assert.equal(decode("html", "<p>Hi&nbsp;<b>there</b></p><script>x()</script>"), "Hi there");
    assert.equal(decode("markdown", "# Title\n**bold** and [link](http://x)"), "Title\nbold and link");
    assert.equal(decode("mail-strip", "Sounds good.\n\nOn Tue, Oct 28, 2026 at 9:14 AM Priya <p@g.com> wrote:\n> old"), "Sounds good.");
    assert.equal(decode("graph-body", { contentType: "html", content: "<div>Hello</div>" }), "Hello");
    assert.equal(decode("slack-mrkdwn", "<@U01DANA> see <https://x.io|the doc> in <#C1|deals>"), "@U01DANA see the doc in #deals");
    assert.equal(decode("text", "  a   b \n\n\n c "), "a b\n\nc");
  });
  it("structured", () => {
    assert.equal(decode("notion-blocks", [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "One" }] } }, { type: "to_do", to_do: { rich_text: [{ plain_text: "Two" }] } }]), "One\n- Two");
    assert.equal(decode("notion-title", { properties: rec.props }), "Plan");
    assert.equal(decode("prosemirror", { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }] }), "Hi");
  });
  it("addresses, domains, dates, numbers", () => {
    assert.equal(decode("email", "Jane Smith <Jane@Acme.com>"), "jane@acme.com");
    assert.equal(decodeDomain("ops@mail.eu.globex.com"), "globex.com");
    assert.equal(decodeDomain("https://www.acme.co.uk/x"), "acme.co.uk");
    assert.deepEqual(decodeAddress('"Shah, Priya" <priya@globex.com>, b@y.com'), [{ name: "Shah, Priya", email: "priya@globex.com" }, { email: "b@y.com" }]);
    assert.ok(isFreeMail("gmail.com") && isFreeMail("gmx.de") && !isFreeMail("globex.com"));
    assert.equal(decode("datetime", "Mon, 8 Jan 2025 10:30:00 -0800"), "2025-01-08T18:30:00.000Z");
    assert.equal(decode("datetime", 1730000000), "2024-10-27T03:33:20.000Z");
    assert.equal(decode("datetime", "1730000000000"), "2024-10-27T03:33:20.000Z");
    assert.equal(decode("datetime", "2026-10-29T21:00:00.0000000"), "2026-10-29T21:00:00.000Z", "zone-less is UTC");
    assert.equal(decode("number", "84,000"), 84000);
  });
});

describe("field expressions", () => {
  const ctx = { item: { a: "", b: "B", parts: ["x", "y"], first: "Ada", last: "", company: "Acme" } };
  it("coalesce, join drops empties, count, test", () => {
    assert.equal(evalExpr({ coalesce: ["item.a", "item.b"] }, ctx), "B");
    assert.equal(evalExpr({ join: [{ join: ["item.first", "item.last"], sep: " " }, "item.company"], sep: " at " }, ctx), "Ada at Acme");
    assert.equal(evalExpr({ path: "item.parts", pick: "count" }, ctx), 2);
    assert.equal(evalExpr({ path: "item.parts[]", pick: "join", sep: "|" }, ctx), "x|y");
    assert.equal(evalExpr({ test: "len(item.parts) > 1" }, ctx), true);
  });
});

describe("profile hashes", () => {
  const p = ticketProfile();
  it("cosmetic fields change no hash; fetch and map parts change their own", () => {
    const h = hashProfile(p);
    assert.deepEqual(hashProfile({ ...p, title: "Other", schedule: { every: "1h" }, limits: { requestsPerMinute: 5 } }), h);
    const f = hashProfile({ ...p, list: { ...p.list, idPath: "uid" } });
    assert.notEqual(f.fetchHash, h.fetchHash);
    assert.equal(f.mapHash, h.mapHash);
    const m = hashProfile({ ...p, fields: { ...p.fields, title: "item.other" } });
    assert.equal(m.fetchHash, h.fetchHash);
    assert.notEqual(m.mapHash, h.mapHash);
    assert.equal(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] }), '{"a":[1,{"c":3,"d":2}],"b":1}');
  });
  it("static validation catches bad paths, facets and TBD ids", () => {
    assert.equal(validateProfile(p).ok, true);
    const bad = validateProfile({ ...p, kind: "deal", author: "builtin", sampleOnly: undefined, list: { ...p.list, actionId: "TBD:x" }, fields: { ...p.fields, facets: { nope: "item.x" }, title: "nobody.x" } });
    assert.equal(bad.ok, false);
    const msgs = bad.issues.map((i) => i.message).join("\n");
    assert.match(msgs, /TBD/);
    assert.match(msgs, /not a deal facet/);
    assert.match(msgs, /must start with/);
  });
});

describe("RRF and boosts", () => {
  it("fuses ranks with k = 60 and title at half weight", () => {
    const f = fuseRanks(["a", "b", "c"], ["c", "a"], ["b"]);
    assert.deepEqual(f.map((x) => x.id), ["a", "c", "b"]);
    assert.ok(Math.abs(f[0]!.rrf - (1 / 61 + 1 / 62)) < 1e-12);
    assert.ok(Math.abs(f.find((x) => x.id === "b")!.rrf - (1 / 62 + 0.5 / 61)) < 1e-12);
  });
  it("importance, recency and entity boosts", () => {
    assert.ok(boostScore(1, 1, 0, false) > boostScore(1, 0, 0, false));
    assert.ok(boostScore(1, 0, 0, false) > boostScore(1, 0, 365, false));
    assert.ok(Math.abs(boostScore(1, 0, 0, true) / boostScore(1, 0, 0, false) - 1.2) < 1e-9);
  });
});

describe("query grammar", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  it("parses every operator", () => {
    const samples: Record<string, string> = {
      source: "source:hubspot,attio", account: "account:dana@acme.dev", type: "type:deal", is: "is:needs-you", from: "from:priya", to: "to:me", with: "with:globex.com",
      about: 'about:"Priya Shah"', before: "before:2026-10-01", after: "after:30d", on: "on:2026-10-28", updated: "updated:>7d",
      during: "during:this-week", has: "has:attachment", status: "status:open", stage: 'stage:"contract sent"', lane: "lane:vip",
      label: "label:INBOX", container: "container:#deals", amount: "amount:>=50000", id: "id:ACME-311",
    };
    assert.deepEqual(Object.keys(samples).sort(), [...OPERATOR_KEYS].sort());
    for (const [k, q] of Object.entries(samples)) {
      const p = parseQuery(q, now);
      assert.equal(p.errors.length, 0, `${q}: ${JSON.stringify(p.errors)}`);
      const c = p.clauses[0]!;
      assert.ok(c.kind === "op" && c.key === k, q);
    }
    const a = parseQuery("in:gmail renewal", now).clauses[0]!;
    assert.ok(a.kind === "op" && a.key === "source", "in: is source:");
    const amt = parseQuery("amount:>=50000", now).clauses[0]!;
    assert.ok(amt.kind === "op" && amt.values[0]!.t === "cmp" && amt.values[0]!.v === 50000);
    const rng = parseQuery("on:2026-10-01..2026-10-05", now).clauses[0]!;
    assert.ok(rng.kind === "op" && rng.values[0]!.t === "range");
  });
  it("negation, phrases, OR, unknown keys stay words, errors are soft", () => {
    const p = parseQuery('-from:priya "contract review" OR renewal re:subject is:bogus', now);
    assert.equal(p.text, '"contract review" OR renewal re:subject');
    assert.ok(p.clauses.some((c) => c.kind === "op" && c.negate));
    assert.ok(p.clauses.some((c) => c.kind === "word" && c.value === "re:subject"));
    assert.equal(p.errors.length, 1);
  });
  it("format and applyChip round-trip", () => {
    const q = 'globex from:priya after:30d "contract sent"';
    assert.equal(formatQuery(parseQuery(q)), q);
    assert.equal(applyChip(q, { key: "from", values: ["marco"] }), 'globex after:30d "contract sent" from:marco');
    assert.equal(applyChip(q, { key: "after", values: null }), 'globex from:priya "contract sent"');
    assert.equal(applyChip("x", { key: "stage", values: ["contract sent"] }), 'x stage:"contract sent"');
  });
  it("dates resolve", () => {
    const d = resolveDateValue("30d", now)!;
    assert.equal(d.from, "2026-09-29T12:00:00.000Z");
    assert.ok(resolveDateValue("2026-10", now));
    assert.equal(resolveDateValue("someday", now), null);
  });
});

describe("sample world markers and the local embedder", () => {
  const now = new Date("2026-10-29T19:00:00Z"); // 12:00 in Los Angeles
  it("resolves relative dates in Los Angeles, in values and keys", () => {
    assert.equal(resolveRel("-2d 14:00", now).toISOString(), "2026-10-27T21:00:00.000Z");
    assert.equal(resolveRel("-6h", now).toISOString(), "2026-10-29T13:00:00.000Z");
    const r = resolveDates({ a: { $rel: "0d 09:00" }, b: { $relDate: "+1d" }, ["slack:$relSlackTs(-1d 09:00)"]: { $relRfc2822: "-1d 09:00" }, c: "ts $rel(-1d 09:00|unix)" }, now) as Record<string, string>;
    assert.equal(r.a, "2026-10-29T16:00:00.000Z");
    assert.equal(r.b, "2026-10-30");
    assert.equal(r["slack:1793203200.000000"], "Wed, 28 Oct 2026 09:00:00 -0700");
    assert.equal(r.c, "ts 1793203200");
    assert.equal(rfc2822(new Date("2026-12-01T17:00:00Z")), "Tue, 1 Dec 2026 09:00:00 -0800");
  });
  it("local hash embedder is deterministic, normalized and 1536 wide; padding keeps width", () => {
    const a = hashEmbed("Globex renewal terms"), b = hashEmbed("Globex renewal terms"), c = hashEmbed("Pilot data import");
    assert.equal(a.length, 1536);
    assert.deepEqual(a, b);
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i]!, 0);
    assert.ok(Math.abs(dot(a, a) - 1) < 1e-9);
    assert.ok(dot(a, hashEmbed("globex renewal")) > dot(a, c));
    assert.equal(pad(new Array(1024).fill(1)).length, 1536);
  });
});

describe("transcript decoder", () => {
  it("labels speakers, joins one speaker's segments into a turn, and is empty with no text", () => {
    const segs = [
      { speaker: { source: "microphone" }, text: "Where did legal land?" },
      { speaker: { source: "system" }, text: "We are happy with the terms." },
      { speaker: { source: "system" }, text: "Can you quote two years?" },
      { speaker: { source: "microphone", diarization_label: "Speaker B" }, text: "Yes." },
      { speaker: "Priya S.", text: "  Thanks \n all. " },
      { speaker: { source: "speaker", attribution: "them" }, text: "Bye." },
      { speaker: { source: "microphone", attribution: "me" }, text: "Bye now." },
      { speaker: { source: "laptop" }, text: "Unknown source." },
      { speaker: { source: "system" }, text: "" },
    ];
    assert.equal(decode("transcript", segs), "Transcript\nMe: Where did legal land?\nThem: We are happy with the terms. Can you quote two years?\nSpeaker B: Yes.\nPriya S.: Thanks all.\nThem: Bye.\nMe: Bye now.\nUnknown source.");
    assert.equal(decode("transcript", { transcript: [{ text: "No speaker here." }] }), "Transcript\nNo speaker here.");
    assert.equal(decode("transcript", null), "");
    assert.equal(decode("transcript", []), "");
  });
  it("takes the whole array as one value under a path", () => {
    const ctx = { detail: { transcript: [{ speaker: { source: "system" }, text: "One." }, { speaker: { source: "microphone" }, text: "Two." }] } };
    assert.equal(evalExpr({ path: "detail.transcript", decode: "transcript" }, ctx as never), "Transcript\nThem: One.\nMe: Two.");
    assert.equal(evalExpr({ join: [{ path: "detail.summary" }, { path: "detail.none", decode: "transcript" }], sep: "\n\n" }, { detail: { summary: "S" } } as never), "S");
  });
});
