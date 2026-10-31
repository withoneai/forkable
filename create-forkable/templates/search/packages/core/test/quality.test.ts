// Search quality (D41 to D46), on the Acme sample: the semantic arm says when it is off,
// exact matches come first, dates are real, one row per human, a second calendar is its own
// source named by its address, and a query that matches nothing as a whole still finds things.
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import type { GrantedConnection, SearchProfile, SettingsData } from "../src/contract.js";
import type { EngineCtx, OneConnectKeyClient } from "../src/ctx.js";
import { entityKeys, items, sources, users } from "../src/db/schema.js";
import { embedPending, resetSemanticHealth, semanticStatus } from "../src/embed/index.js";
import { runSource } from "../src/engine/run.js";
import { normalize } from "../src/engine/normalize.js";
import { renderTemplate } from "../src/expr/template.js";
import { profileFromHints } from "../src/mapper/infer.js";
import { attachNewConnections, createSource, loadBuiltinPacks, upsertBuiltins, upsertProfileVersion } from "../src/profile/builtins.js";
import { proposeDates } from "../src/query/dates.js";
import { runDemo, DEMO_USER } from "../src/sample/demo.js";
import { EXACT_TITLE_BONUS, hybridSearch, titleBonus } from "../src/search/hybrid.js";
import { SAMPLE_SETTINGS } from "../src/settings.js";
import { forgetGrant } from "../src/one.js";
import { makeCtx, StubTransport, testDb, ticketProfile } from "./helpers.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OPENAI: SettingsData = { ...SAMPLE_SETTINGS, embedding: { provider: "openai", model: "text-embedding-3-small", dims: 1536 } };

/** A Connect client that lists the given connections and answers every action with `answer`. */
function stubConnect(conns: GrantedConnection[], answer: () => Promise<{ status: number; ok: boolean; data: unknown; blockedByGrant: boolean; refusal: null }>): OneConnectKeyClient {
  return {
    isConnected: async () => true,
    listConnections: async () => conns,
    runAction: async () => answer(),
  } as unknown as OneConnectKeyClient;
}

describe("search quality on the Acme sample", () => {
  let b: Awaited<ReturnType<typeof testDb>>;
  let ctx: EngineCtx;
  const top = async (q: string) => (await hybridSearch(ctx, DEMO_USER, { q, limit: 10 }));
  before(async () => {
    b = await testDb("quality");
    ctx = { db: b.db, oneConnect: null, capability: b.capability, transport: null, settingsFor: async () => SAMPLE_SETTINGS, emit() {}, log() {}, now: () => new Date() };
    const r = await runDemo({ db: b.db, capability: b.capability, root: ROOT, database: { kind: "embedded", version: b.serverVersion, port: b.port } }, () => {});
    assert.deepEqual(r.failures, []);
  });
  after(async () => { await b.done(); });

  // ---------- 1. the semantic arm says when it is off (D41) ----------

  describe("semantic status", () => {
    it("the sample embedder is not semantic, and that is not a problem to report", async () => {
      const r = await top("globex renewal");
      assert.equal(r.embedder.semantic, false);
      assert.equal(r.embedder.reason, b.capability.mode === "hybrid" ? "sample" : "keyword_mode");
    });

    it("OpenAI missing from the grant says not_in_grant, on the search and on the status", { skip: b?.capability.mode === "keyword" }, async () => {
      resetSemanticHealth();
      await b.db.insert(users).values({ id: "usr_real", name: "Dana Oyelaran", email: "dana@acme.com", isSample: false }).onConflictDoNothing();
      const real: EngineCtx = { ...ctx, settingsFor: async () => OPENAI, oneConnect: stubConnect([], async () => ({ status: 200, ok: true, data: {}, blockedByGrant: false, refusal: null })) };
      forgetGrant("usr_real");
      const r = await hybridSearch(real, "usr_real", { q: "globex renewal", limit: 5 });
      assert.equal(r.embedder.semantic, false);
      assert.equal(r.embedder.reason, "not_in_grant");
      assert.equal(r.embedder.platform, "openai");
      assert.equal(r.embedder.message, "OpenAI is not in your grant.");
      const st = await semanticStatus(real, "usr_real");
      assert.equal(st.reason, "not_in_grant", "the status (sources, banner) remembers it without calling anything");
    });

    it("an embedder that errors says error; a later success clears it", async () => {
      if (b.capability.mode !== "hybrid") return;
      resetSemanticHealth();
      let fail = true;
      const vec = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
      const real: EngineCtx = {
        ...ctx, settingsFor: async () => OPENAI,
        oneConnect: stubConnect([{ key: "k-openai", platform: "openai", name: "OpenAI", title: "OpenAI", image: null, access: "read" } as unknown as GrantedConnection],
          async () => (fail ? Promise.reject(new Error("socket hang up")) : { status: 200, ok: true, data: { data: [{ embedding: vec }] }, blockedByGrant: false, refusal: null })),
      };
      forgetGrant("usr_real");
      const r = await hybridSearch(real, "usr_real", { q: "pricing", limit: 5 });
      assert.equal(r.embedder.reason, "error");
      assert.match(r.embedder.message ?? "", /OpenAI did not answer/);
      fail = false;
      const ok = await hybridSearch(real, "usr_real", { q: "pricing again", limit: 5 });
      assert.equal(ok.embedder.semantic, true);
      assert.equal((await semanticStatus(real, "usr_real")).semantic, true);
    });

    it("the embed worker failing marks the status too", async () => {
      if (b.capability.mode !== "hybrid") return;
      resetSemanticHealth();
      const real: EngineCtx = { ...ctx, settingsFor: async () => OPENAI, oneConnect: stubConnect([], async () => ({ status: 200, ok: true, data: {}, blockedByGrant: false, refusal: null })) };
      forgetGrant("usr_real");
      const src = await upsertProfileVersion(b.db, null, ticketProfile({ id: "testco.semantic" }), "builtin", "builtin");
      const sid = await createSource(b.db, { userId: "usr_real", platform: "testco", connectionKey: "k-sem", connectionLabel: "test", profileId: src.profileId, versionId: src.versionId, profile: ticketProfile(), mode: "fixture" });
      const t = new StubTransport({ "sample::list": () => ({ status: 200, data: { tickets: [{ id: "s1", subject: "Embed me", description: "words", status: "open", created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:00:00Z", requester: "Priya Shah <priya@globex.com>" }], next_cursor: null } }) });
      await runSource({ ...makeCtx(b, t, { settings: OPENAI }) }, sid, { trigger: "first" });
      const e = await embedPending(real, "usr_real");
      assert.ok(e.failed > 0);
      assert.equal((await semanticStatus(real, "usr_real")).reason, "not_in_grant");
    });
  });

  // ---------- 2. exact matches first (D42) ----------

  describe("exact matches", () => {
    it("an email puts that person's record first", async () => {
      const r = await top("priya@globex.com");
      assert.equal(r.results[0]!.kind, "person");
      assert.equal(r.results[0]!.title, "Priya Shah");
      assert.equal(r.results[0]!.exact, "email");
      assert.equal(r.entities[0]!.name, "Priya Shah");
    });

    it("a domain puts that company's record first", async () => {
      const r = await top("globex.com");
      assert.equal(r.results[0]!.kind, "company");
      assert.equal(r.results[0]!.title, "Globex");
      assert.equal(r.results[0]!.exact, "domain");
    });

    it("an external id puts that item first", async () => {
      const r = await top("acme-311");
      assert.match(r.results[0]!.title, /^ACME-311/);
      assert.equal(r.results[0]!.exact, "id");
      assert.equal(r.didYouMean, null, "an id is never a misspelt name");
    });

    it("a whole entity name puts that person first", async () => {
      const r = await top("Priya Shah");
      assert.equal(r.results[0]!.kind, "person");
      assert.equal(r.results[0]!.exact, "name");
    });

    it("an exact phrase in a title gets a fixed bonus", async () => {
      assert.equal(titleBonus("Contract review", "contract review"), EXACT_TITLE_BONUS);
      assert.equal(titleBonus("Globex contract review", "contract review"), EXACT_TITLE_BONUS / 2);
      assert.equal(titleBonus("Contracts reviewed", "contract review"), 0);
      const r = await top('"contract review"');
      assert.match(r.results[0]!.title.toLowerCase(), /contract review/);
      assert.match(r.results[1]!.title.toLowerCase(), /contract review/);
    });

    it("sorting by date ignores the exact lane", async () => {
      const r = await hybridSearch(ctx, DEMO_USER, { q: "priya@globex.com", sort: "newest", limit: 10 });
      const dates = r.results.map((x) => x.occurredAt);
      assert.deepEqual(dates, [...dates].sort().reverse());
    });
  });

  // ---------- 3. dates (D45) ----------

  describe("dates", () => {
    it("an endless series is not indexed 900 days out", async () => {
      const far = await b.db.execute(sql`select count(*)::int as n from items where user_id = ${DEMO_USER} and deleted_at is null and occurred_at > now() + interval '730 days'`);
      assert.equal((far.rows[0] as { n: number }).n, 0);
      const climbing = (await top("climbing type:event")).results;
      assert.equal(climbing.length, 1);
      assert.ok(Date.parse(climbing[0]!.occurredAt) < Date.now() + 30 * 86_400_000);
    });

    it("the Calendar pack bounds full passes a year ahead, never the sync-token run", () => {
      const ahead = renderTemplate("{{ run.now | plus:365d | iso }}", { run: { now: new Date("2026-10-30T00:00:00Z") } });
      assert.equal(ahead, "2027-10-30T00:00:00.000Z");
      const pack = loadBuiltinPacks(join(ROOT, "profiles")).find((p) => p.platform === "google-calendar")!;
      const prof = pack.profiles[0]!;
      // Full passes bound the expansion; delta runs must not (Google refuses timeMax next to syncToken).
      assert.equal((prof.incremental as { bootstrap?: { query?: Record<string, unknown> } }).bootstrap?.query?.timeMax, "{{ run.now | plus:365d | iso }}");
      assert.equal(prof.list.query?.timeMax, undefined);
    });

    it("a record with no date keeps the day it was first seen, so re-fetching it is not a change", async () => {
      const p = ticketProfile({ id: "testco.undated", fields: { title: "item.subject", occurredAt: { path: "item.when", decode: "datetime" }, url: "https://desk.example.com/t/{{ item.id }}" } });
      const v = await upsertProfileVersion(b.db, null, p, "builtin", "builtin");
      await b.db.insert(users).values({ id: "usr_dates", name: "Dana", isSample: true }).onConflictDoNothing();
      const sid = await createSource(b.db, { userId: "usr_dates", platform: "testco", connectionKey: "k-undated", connectionLabel: "test", profileId: v.profileId, versionId: v.versionId, profile: p, mode: "fixture" });
      const t = new StubTransport({ "sample::list": () => ({ status: 200, data: { tickets: [{ id: "u1", subject: "No date at all", status: "open" }], next_cursor: null } }) });
      let now = new Date("2026-10-01T10:00:00Z");
      const c = makeCtx(b, t, { now: () => now });
      await runSource(c, sid, { trigger: "first", full: true });
      const [first] = await b.db.select().from(items).where(eq(items.sourceId, sid));
      now = new Date("2026-10-02T10:00:00Z");
      const second = await runSource(c, sid, { trigger: "manual", full: true });
      const [again] = await b.db.select().from(items).where(eq(items.sourceId, sid));
      assert.equal(again!.occurredAt.toISOString(), first!.occurredAt.toISOString());
      assert.equal(second.upserted, 0, "no update churn");
      assert.equal(second.unchanged, 1);
    });

    it("an empty date path falls back to the record's own modifiedTime, never the sync time", () => {
      const p = ticketProfile({ fields: { title: "item.subject", occurredAt: { path: "item.missing", decode: "datetime" } } });
      const n = normalize(p, { item: { id: "f1", subject: "Pricing deck", modifiedTime: "2026-08-14T09:00:00Z", createdTime: "2026-01-02T09:00:00Z" }, fetchedAt: "2026-10-30T08:00:00Z" }, { account: {}, settings: {}, now: new Date("2026-10-30T08:00:00Z"), selfAddresses: [] });
      assert.equal(n.occurredAt, "2026-08-14T09:00:00.000Z");
      assert.equal(n.occurredAtGuessed, undefined);
    });

    it("a date more than two years out is never occurredAt", () => {
      const env = { account: {}, settings: {}, now: new Date("2026-10-30T08:00:00Z"), selfAddresses: [] };
      const doc = normalize(ticketProfile(), { item: { id: "d1", subject: "Typo year", created_at: "2054-01-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" }, fetchedAt: "2026-10-30T08:00:00Z" }, env);
      assert.equal(doc.occurredAt, "2026-09-01T00:00:00.000Z");
      assert.equal(doc.deleted, false);
      const ev = normalize(ticketProfile({ kind: "event" }), { item: { id: "e1", subject: "Bi-weekly sync", created_at: "2054-10-08T16:00:00Z" }, fetchedAt: "2026-10-30T08:00:00Z" }, env);
      assert.equal(ev.deleted, true, "an event that far out is not indexed");
    });

    it("New profile rules date a file by its last change, then its creation", () => {
      const p = profileFromHints({ platform: "google-drive", actionId: "x", title: "List Files", method: "GET", path: "/files", hints: { resultsPath: "files", idPath: "id", titleCandidates: ["name"], bodyCandidates: [], dateCandidates: ["createdTime", "modifiedTime"], urlCandidates: [], emailCandidates: [], pagination: { type: "none" }, kindGuess: "doc" } as never });
      assert.deepEqual(p.fields.occurredAt, { coalesce: [{ path: "item.modifiedTime", decode: "datetime" }, { path: "item.createdTime", decode: "datetime" }] });
      const none = profileFromHints({ platform: "x", actionId: "x", title: "List Things", method: "GET", path: "/things", hints: { resultsPath: "things", idPath: "id", titleCandidates: ["name"], bodyCandidates: [], dateCandidates: [], urlCandidates: [], emailCandidates: [], pagination: { type: "none" } } as never });
      assert.ok(!JSON.stringify(none.fields.occurredAt).includes("run.now"), "never the sync time");
    });
  });

  // ---------- 4. one row per human (D43) ----------

  describe("people", () => {
    it("two Attio records that share an address are one person", async () => {
      const keys = await b.db.select().from(entityKeys).where(and(eq(entityKeys.userId, DEMO_USER), sql`${entityKeys.key} in ('email:owen@northwind.vc', 'email:owen.price@northwind.vc')`));
      assert.equal(new Set(keys.map((k) => k.entityId)).size, 1);
    });

    it("a person's records fold into one row with the other tools as badges", async () => {
      const r = await top("Owen Price");
      const people = r.results.filter((x) => x.kind === "person");
      assert.equal(people.length, 1);
      assert.ok(people[0]!.alsoIn?.includes("attio") || people[0]!.platform === "attio");
      assert.equal(people[0]!.groupCount, 3, "HubSpot plus two Attio records");
      assert.equal(r.entities.filter((e) => e.name === "Owen Price").length, 1);
    });

    it("a record nothing else mentions weighs less than one with mail", async () => {
      const r = (await top("type:person hooli")).results;
      const jules = r.find((x) => x.title === "Jules Martin")!;
      const tom = r.find((x) => x.title === "Tom Reyes")!;
      assert.ok(r.indexOf(jules) < r.indexOf(tom));
      assert.ok(tom.score < jules.score * 0.7);
    });

    it("a misspelt name offers the entity and finds its record", async () => {
      const r = await top("Owen Prise");
      assert.equal(r.didYouMean?.name, "Owen Price");
      assert.ok(r.results.slice(0, 3).some((x) => x.kind === "person" && x.title === "Owen Price"));
      assert.equal((await top("Owen Price")).didYouMean, null, "the right spelling asks nothing");
      assert.equal((await top("globex renewal")).didYouMean, null, "a name plus a topic is not a misspelt name");
    });
  });

  // ---------- 5. one source per account, named by its address (D46) ----------

  describe("accounts", () => {
    it("the second Google account is its own Calendar source, labelled with its address", async () => {
      const cal = await b.db.select().from(sources).where(and(eq(sources.userId, DEMO_USER), eq(sources.platform, "google-calendar")));
      assert.deepEqual(cal.map((s) => s.connectionLabel).sort(), ["dana@acme.com", "dana@acme.dev"]);
      const hit = (await top("lisbon type:event")).results[0]!;
      assert.equal(hit.sourceName, "Google Calendar · dana@acme.dev");
    });

    it("a source One titled with the platform name takes the account's address on its run", async () => {
      await b.db.insert(users).values({ id: "usr_label", name: "Dana", isSample: true }).onConflictDoNothing();
      const packs = loadBuiltinPacks(join(ROOT, "profiles"));
      await upsertBuiltins(b.db, packs);
      const p = packs.find((x) => x.platform === "gmail")!.profiles[0]! as SearchProfile;
      const v = await upsertProfileVersion(b.db, null, p, "builtin", "builtin");
      const sid = await createSource(b.db, { userId: "usr_label", platform: "gmail", connectionKey: "sample:gmail:personal", connectionLabel: "Gmail", profileId: v.profileId, versionId: v.versionId, profile: p, mode: "fixture" });
      const { fixtureTransport, loadSampleWorld } = await import("../src/sample/world.js");
      const world = loadSampleWorld(join(ROOT, "fixtures", "sample"));
      await runSource({ ...ctx, transport: fixtureTransport(world), world }, sid, { trigger: "first" });
      const [s] = await b.db.select().from(sources).where(eq(sources.id, sid));
      assert.equal(s!.connectionLabel, "dana@acme.dev");
    });

    it("a connection added to the grant later gets its sources, once, without a sign-in", async () => {
      await b.db.insert(users).values({ id: "usr_attach", name: "Dana", isSample: false }).onConflictDoNothing();
      const conns = [{ key: "k-cal-1", platform: "google-calendar", name: "Google Calendar", title: "Google Calendar", image: null, access: "read" }] as unknown as GrantedConnection[];
      const c: EngineCtx = { ...ctx, oneConnect: stubConnect(conns, async () => ({ status: 200, ok: true, data: {}, blockedByGrant: false, refusal: null })) };
      forgetGrant("usr_attach");
      assert.equal((await attachNewConnections(c, "usr_attach")).length, 1);
      conns.push({ key: "k-cal-2", platform: "google-calendar", name: "Google Calendar", title: "Google Calendar", image: null, access: "read" } as unknown as GrantedConnection);
      forgetGrant("usr_attach");
      const made = await attachNewConnections(c, "usr_attach");
      assert.equal(made.length, 1, "only the new calendar");
      forgetGrant("usr_attach");
      assert.equal((await attachNewConnections(c, "usr_attach")).length, 0);
    });

    it("a built-in never doubles a user profile that lists the same records on that account", async () => {
      await b.db.insert(users).values({ id: "usr_dup", name: "Dana", isSample: false }).onConflictDoNothing();
      const builtin = loadBuiltinPacks(join(ROOT, "profiles")).find((x) => x.platform === "linear")!.profiles[0]! as SearchProfile;
      const mine = { ...builtin, id: "linear.my-issues", title: "My issues" };
      const v = await upsertProfileVersion(b.db, "usr_dup", mine, "user", "usr_dup");
      await createSource(b.db, { userId: "usr_dup", platform: "linear", connectionKey: "k-lin", connectionLabel: "Linear", profileId: v.profileId, versionId: v.versionId, profile: mine, mode: "connect" });
      const conns = [{ key: "k-lin", platform: "linear", name: "Linear", title: "Linear", image: null, access: "read" }] as unknown as GrantedConnection[];
      const c: EngineCtx = { ...ctx, oneConnect: stubConnect(conns, async () => ({ status: 200, ok: true, data: {}, blockedByGrant: false, refusal: null })) };
      forgetGrant("usr_dup");
      await attachNewConnections(c, "usr_dup");
      const rows = await b.db.select({ id: sources.id, profileId: sources.profileId }).from(sources).where(eq(sources.userId, "usr_dup"));
      const builtinIssues = rows.filter((r) => r.profileId !== v.profileId);
      // the other Linear built-ins (projects, documents) are added; the issues built-in is not
      assert.ok(!(await Promise.all(builtinIssues.map(async (r) => (await b.db.execute(sql`select p.slug from profiles p where p.id = ${r.profileId}`)).rows[0] as { slug: string }))).some((r) => r.slug === builtin.id));
    });
  });

  // ---------- 6. nothing as a whole, something by parts (D44) ----------

  describe("zero results", () => {
    it("every word together finds nothing: any of them, and the response says so", async () => {
      const r = await top("renewal pricing hooli zebra");
      assert.equal(r.fallback, "or");
      assert.ok(r.total > 0);
      assert.equal((await top("globex renewal")).fallback, null);
    });

    it("plain dates in the text become proposed after:/before: chips", async () => {
      const now = new Date(2026, 9, 30, 12);
      assert.deepEqual(proposeDates("who did I talk to about pricing last month", now).map((d) => d.insert), ["after:2026-09-01 before:2026-10-01"]);
      assert.deepEqual(proposeDates("pricing in October", now).map((d) => d.insert), ["after:2026-10-01 before:2026-11-01"]);
      assert.deepEqual(proposeDates("board deck in december", now).map((d) => d.insert), ["after:2025-12-01 before:2026-01-01"]);
      assert.deepEqual(proposeDates("standup this week", now).map((d) => d.insert), ["after:2026-10-26"]);
      assert.deepEqual(proposeDates("invoices past 2 weeks", now).map((d) => d.insert), ["after:2026-10-16"]);
      assert.equal(proposeDates("globex renewal", now).length, 0);
      assert.equal(proposeDates("pricing last month", now)[0]!.remove, "last month");
      const r = await top("pricing last month");
      assert.equal(r.dateProposals.length, 1);
      assert.equal((await top("pricing after:30d last month")).dateProposals.length, 0, "a date operator already set");
    });
  });
});
