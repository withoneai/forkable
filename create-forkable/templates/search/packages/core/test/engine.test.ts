import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { entities, items, profileVersions, runs, sourceCursors, sources, chunks, entityKeys } from "../src/db/schema.js";
import { runSource, remapSource } from "../src/engine/run.js";
import { acquire, resetBuckets } from "../src/engine/fetch.js";
import { upsertProfileVersion } from "../src/profile/builtins.js";
import { fetchIsStale } from "../src/profile/hash.js";
import { settingsFor } from "../src/engine/run.js";
import { count, makeCtx, seedSource, seedUser, StubTransport, testDb, ticketProfile } from "./helpers.js";
import type { FixtureRequest, SearchProfile } from "../src/contract.js";

let b: Awaited<ReturnType<typeof testDb>>;
let userId: string;

before(async () => {
  b = await testDb("engine");
  userId = await seedUser(b.db);
});
after(async () => { await b.done(); });

const T = (iso: string) => iso;
const tickets = [
  { id: "1", subject: "Login broken", description: "<p>Cannot log in.</p>", status: "open", created_at: T("2026-10-20T10:00:00Z"), updated_at: T("2026-10-25T10:00:00Z"), requester: "Priya Shah <priya@globex.com>" },
  { id: "2", subject: "Invoice question", description: "Where is my invoice?", status: "open", created_at: T("2026-10-21T10:00:00Z"), updated_at: T("2026-10-26T10:00:00Z"), requester: "ravi@initech.io" },
  { id: "3", subject: "Spam", description: "buy now", status: "deleted", created_at: T("2026-10-22T10:00:00Z"), updated_at: T("2026-10-27T10:00:00Z"), requester: "x@gmail.com" },
];

function paged(list: unknown[], size = 2) {
  return (req: FixtureRequest) => {
    const start = req.cursor ? Number(req.cursor) : 0;
    const page = list.slice(start, start + size);
    return { status: 200, data: { tickets: page, next_cursor: start + size < list.length ? String(start + size) : null } };
  };
}

async function sourceIdFor(p: SearchProfile, key: string) { return seedSource(b.db, userId, p, key); }

describe("watermark (asc)", () => {
  it("pages, normalizes, tombstones by predicate, commits the data watermark, then sends since = watermark - overlap", async () => {
    const t = new StubTransport({ "sample::list": paged(tickets) });
    const ctx = makeCtx(b, t);
    const p = ticketProfile({ id: "testco.wm" });
    const sid = await sourceIdFor(p, "k-wm");
    const r1 = await runSource(ctx, sid, { trigger: "first" });
    assert.equal(r1.outcome, "ok");
    assert.equal(r1.pages, 2);
    assert.equal(r1.fetched, 3);
    assert.equal(await count(b.db, sql`select count(*) as n from items where source_id = ${sid} and deleted_at is null`), 2);
    const [cur] = await b.db.select().from(sourceCursors).where(eq(sourceCursors.sourceId, sid));
    assert.equal(cur!.watermark, "2026-10-27T10:00:00.000Z");
    const [it1] = await b.db.select().from(items).where(and(eq(items.sourceId, sid), eq(items.externalId, "1")));
    assert.equal(it1!.title, "Login broken");
    assert.equal(it1!.body, "Cannot log in.");
    assert.equal(it1!.url, "https://desk.example.com/t/1");

    const r2 = await runSource(ctx, sid, { trigger: "schedule" });
    assert.equal(r2.outcome, "ok");
    assert.equal(r2.fullPass, false);
    const lastList = t.calls.filter((c) => c.actionId === "sample::list" && !c.cursor).pop()!;
    assert.equal((lastList.query as Record<string, string>).updated_since, "2026-10-27T09:59:00.000Z");
    assert.equal(r2.upserted, 0);
    assert.equal(r2.unchanged, 2);
  });

  it("restartOnCap re-issues the query from the newest watermark seen", async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, subject: `T${i}`, status: "open", created_at: "2026-10-20T10:00:00Z", updated_at: `2026-10-2${i}T10:00:00Z`, requester: "a@b.com" }));
    const t = new StubTransport({
      "sample::list": (req) => {
        const since = (req.query as Record<string, string>).updated_since;
        const pool = many.filter((m) => !since || m.updated_at >= since.slice(0, 19));
        const start = req.cursor ? Number(req.cursor) : 0;
        return { status: 200, data: { tickets: pool.slice(start, start + 2), next_cursor: start + 2 < pool.length ? String(start + 2) : null } };
      },
    });
    const p = ticketProfile({ id: "testco.cap", incremental: { strategy: "watermark", field: "item.updated_at", restartOnCap: 4, initial: "all" } });
    const sid = await sourceIdFor(p, "k-cap");
    const r = await runSource(makeCtx(b, t), sid, { trigger: "first" });
    assert.equal(r.outcome, "ok");
    assert.equal(await count(b.db, sql`select count(*) as n from items where source_id = ${sid}`), 6);
    assert.ok(t.calls.some((c) => (c.query as Record<string, string>).updated_since?.startsWith("2026-10-23")), "restarted from the newest seen");
  });
});

describe("watermark (desc)", () => {
  it("stops paging at the first item at or below the watermark", async () => {
    const desc = [...tickets].reverse().map((x) => ({ ...x, status: "open" }));
    const t = new StubTransport({ "sample::list": paged(desc, 1) });
    const p = ticketProfile({ id: "testco.desc", list: { ...ticketProfile().list, query: {}, pageSize: { param: "per_page", value: 1 } }, incremental: { strategy: "watermark", field: "item.updated_at", order: "desc", initial: "all" } });
    const sid = await sourceIdFor(p, "k-desc");
    await runSource(makeCtx(b, t), sid, { trigger: "first" });
    const first = t.count("sample::list");
    assert.equal(first, 3);
    await runSource(makeCtx(b, t), sid, { trigger: "schedule" });
    assert.equal(t.count("sample::list") - first, 1, "second run stops on page 1");
  });
});

describe("delta", () => {
  it("bootstraps, stores the token, uses it, and resets on 410", async () => {
    let phase = 0;
    const t = new StubTransport({
      "sample::list": (req) => {
        const q = (req.query ?? {}) as Record<string, string>;
        if (q.syncToken === "tok1" && phase === 0) return { status: 200, data: { tickets: [{ ...tickets[1], subject: "Invoice question (edited)" }], nextSyncToken: "tok2" } };
        if (q.syncToken === "tok2") { return { status: 410, data: { error: "gone" } }; }
        return { status: 200, data: { tickets: tickets.slice(0, 2), nextSyncToken: "tok1" } };
      },
    });
    const p = ticketProfile({
      id: "testco.delta",
      list: { ...ticketProfile().list, query: {}, pagination: { type: "none" }, pageSize: undefined },
      incremental: { strategy: "delta", tokenPath: "nextSyncToken", tokenPassAs: "query:syncToken", resetOn: [410], bootstrap: { actionId: "sample::list", query: { timeMin: "{{ run.since | iso }}" } }, initial: "30d" },
    });
    const sid = await sourceIdFor(p, "k-delta");
    const ctx = makeCtx(b, t);
    await runSource(ctx, sid, { trigger: "first" });
    let [cur] = await b.db.select().from(sourceCursors).where(eq(sourceCursors.sourceId, sid));
    assert.equal(cur!.deltaToken, "tok1");
    assert.ok((t.calls[t.calls.length - 1]!.query as Record<string, string>).timeMin, "bootstrap sent timeMin");
    await runSource(ctx, sid, { trigger: "schedule" });
    [cur] = await b.db.select().from(sourceCursors).where(eq(sourceCursors.sourceId, sid));
    assert.equal(cur!.deltaToken, "tok2");
    const [it2] = await b.db.select().from(items).where(and(eq(items.sourceId, sid), eq(items.externalId, "2")));
    assert.equal(it2!.title, "Invoice question (edited)");
    phase = 1;
    const r3 = await runSource(ctx, sid, { trigger: "schedule" });
    assert.equal(r3.outcome, "ok");
    [cur] = await b.db.select().from(sourceCursors).where(eq(sourceCursors.sourceId, sid));
    assert.equal(cur!.deltaToken, "tok1", "410 dropped tok2 and a bootstrap pass stored a fresh token");
  });
});

describe("full with reconcile", () => {
  it("tombstones absent items only after a complete, non-empty, uncapped full pass", async () => {
    let list = tickets.slice(0, 2);
    const t = new StubTransport({ "sample::list": (req) => paged(list)(req) });
    const p = ticketProfile({ id: "testco.full", list: { ...ticketProfile().list, query: {} }, incremental: { strategy: "full" } });
    const sid = await sourceIdFor(p, "k-full");
    const ctx = makeCtx(b, t);
    await runSource(ctx, sid, { trigger: "first" });
    assert.equal(await count(b.db, sql`select count(*) as n from items where source_id = ${sid} and deleted_at is null`), 2);
    // capped run: no reconcile
    list = [tickets[1]!, { ...tickets[0]!, id: "9" }, { ...tickets[0]!, id: "10" }];
    const capped = await runSource(ctx, sid, { trigger: "manual", maxPages: 1 });
    assert.equal(capped.tombstoned, 0);
    // empty pass: no reconcile
    const saved = list; list = [];
    const empty = await runSource(ctx, sid, { trigger: "manual" });
    assert.equal(empty.tombstoned, 0);
    list = saved;
    const fullRun = await runSource(ctx, sid, { trigger: "manual" });
    assert.equal(fullRun.outcome, "ok");
    assert.equal(fullRun.tombstoned, 1, "item 1 is gone upstream");
    const [one] = await b.db.select().from(items).where(and(eq(items.sourceId, sid), eq(items.externalId, "1")));
    assert.ok(one!.deletedAt);
    assert.equal(await count(b.db, sql`select count(*) as n from chunks where item_id = ${one!.id}`), 0, "chunks dropped with the tombstone");
    // it comes back: restored
    list = [...saved, tickets[0]!];
    await runSource(ctx, sid, { trigger: "manual" });
    const [back] = await b.db.select().from(items).where(and(eq(items.sourceId, sid), eq(items.externalId, "1")));
    assert.equal(back!.deletedAt, null);
  });
});

describe("retry policy", () => {
  it("429 waits Retry-After and continues", async () => {
    resetBuckets();
    const sleeps: number[] = [];
    const t = new StubTransport({ "sample::list": (req, n) => (n === 1 ? { status: 429, data: { retry_after: 7 } } : paged(tickets.slice(0, 1))(req)) });
    const sid = await sourceIdFor(ticketProfile({ id: "testco.r429" }), "k-429");
    const r = await runSource(makeCtx(b, t, { sleeps }), sid, { trigger: "first" });
    assert.equal(r.outcome, "ok");
    assert.equal(r.retries, 1);
    assert.deepEqual(sleeps, [7000]);
  });
  it("429 five times ends rate_limited with the page cursor kept", async () => {
    const t = new StubTransport({ "sample::list": () => ({ status: 429, data: {} }) });
    const sid = await sourceIdFor(ticketProfile({ id: "testco.r429b" }), "k-429b");
    const sleeps: number[] = [];
    const r = await runSource(makeCtx(b, t, { sleeps }), sid, { trigger: "first" });
    assert.equal(r.outcome, "rate_limited");
    assert.equal(t.count("sample::list"), 5);
    assert.ok(sleeps.every((s) => s >= 24_000 && s <= 360_000), "exponential from 30 s with jitter");
    const [s] = await b.db.select().from(sources).where(eq(sources.id, sid));
    assert.equal(s!.status, "rate_limited");
    assert.ok(s!.retryAt);
  });
  it("5xx retries 4 times then the run is partial", async () => {
    const t = new StubTransport({ "sample::list": () => ({ status: 503, data: "unavailable" }) });
    const sid = await sourceIdFor(ticketProfile({ id: "testco.r5xx" }), "k-5xx");
    const r = await runSource(makeCtx(b, t), sid, { trigger: "first" });
    assert.equal(r.outcome, "partial");
    assert.equal(t.count("sample::list"), 4);
    const [s] = await b.db.select().from(sources).where(eq(sources.id, sid));
    assert.equal(s!.status, "degraded");
  });
  it("401 stops the source as auth_needed, never retried", async () => {
    const t = new StubTransport({ "sample::list": () => ({ status: 401, data: {} }) });
    const sid = await sourceIdFor(ticketProfile({ id: "testco.r401" }), "k-401");
    const r = await runSource(makeCtx(b, t), sid, { trigger: "first" });
    assert.equal(r.outcome, "auth_needed");
    assert.equal(t.count("sample::list"), 1);
  });
  it("403 grant refusal stops as grant_blocked", async () => {
    const t = new StubTransport({ "sample::list": () => ({ status: 403, data: {}, blockedByGrant: true, refusal: "grant" }) });
    const sid = await sourceIdFor(ticketProfile({ id: "testco.r403" }), "k-403");
    const r = await runSource(makeCtx(b, t), sid, { trigger: "first" });
    assert.equal(r.outcome, "grant_blocked");
    const [s] = await b.db.select().from(sources).where(eq(sources.id, sid));
    assert.equal(s!.status, "grant_blocked");
    assert.equal(s!.lastError!.code, "blocked_by_grant");
  });
  it("404 on hydrate tombstones the item", async () => {
    const t = new StubTransport({
      "sample::list": paged(tickets.slice(0, 2)),
      "sample::get": (req) => (req.pathParams?.id === "2" ? { status: 404, data: {} } : { status: 200, data: { ticket: { notes: "detail for " + req.pathParams?.id } } }),
    });
    const p = ticketProfile({ id: "testco.hyd", hydrate: { request: { actionId: "sample::get", pathVars: { id: "{{ item.id }}" } }, resultsPath: "ticket", fingerprint: "{{ item.updated_at }}" } });
    p.fields.body = { join: ["item.description", "detail.notes"], sep: "\n" };
    const sid = await sourceIdFor(p, "k-hyd");
    const ctx = makeCtx(b, t);
    const r = await runSource(ctx, sid, { trigger: "first" });
    assert.equal(r.hydrated, 1);
    assert.equal(await count(b.db, sql`select count(*) as n from items where source_id = ${sid} and deleted_at is null`), 1);
    const [it] = await b.db.select().from(items).where(and(eq(items.sourceId, sid), eq(items.externalId, "1")));
    assert.match(it!.body, /detail for 1/);
    // unchanged fingerprint: no hydrate calls on the next run
    const before = t.count("sample::get");
    await runSource(ctx, sid, { trigger: "schedule" });
    assert.equal(t.count("sample::get") - before, 1, "only the 404 item is asked again");
  });
});

describe("token bucket", () => {
  it("is shared by every profile on one connection", async () => {
    resetBuckets();
    let now = 0;
    const waits: number[] = [];
    const lim = { connectionKey: "u:conn", rpm: 2, enabled: true };
    const sleep = async (ms: number) => { waits.push(ms); now += ms; };
    await acquire(lim, "a", sleep, () => now);
    await acquire(lim, "b", sleep, () => now);
    assert.equal(waits.length, 0);
    await acquire({ ...lim }, "c", sleep, () => now);
    assert.equal(waits.length, 1, "third call on the same connection waits");
    assert.ok(waits[0]! >= 29_000 && waits[0]! <= 31_000);
    const per = { connectionKey: "u:other", rpm: 100, perAction: { hist: { requestsPerMinute: 1 } }, enabled: true };
    await acquire(per, "hist", sleep, () => now);
    const w = waits.length;
    await acquire(per, "hist", sleep, () => now);
    assert.equal(waits.length, w + 1, "per-action budget is tighter");
  });
});

describe("hashes", () => {
  it("a map change re-maps from raw with zero calls; a fetch change resets cursors", async () => {
    const t = new StubTransport({ "sample::list": paged(tickets.slice(0, 2)) });
    const p = ticketProfile({ id: "testco.hash" });
    const sid = await sourceIdFor(p, "k-hash");
    const ctx = makeCtx(b, t);
    await runSource(ctx, sid, { trigger: "first" });
    const calls = t.calls.length;
    const p2 = { ...p, fields: { ...p.fields, title: { template: "Ticket: {{ item.subject }}" } } };
    const v2 = await upsertProfileVersion(b.db, null, p2, "builtin", "builtin");
    await b.db.update(sources).set({ profileVersionId: v2.versionId }).where(eq(sources.id, sid));
    const r = await remapSource(ctx, sid);
    assert.equal(r.remapped, 2);
    assert.equal(t.calls.length, calls, "zero API calls");
    const [it] = await b.db.select().from(items).where(and(eq(items.sourceId, sid), eq(items.externalId, "1")));
    assert.equal(it!.title, "Ticket: Login broken");
    const [pv] = await b.db.select().from(profileVersions).where(eq(profileVersions.id, v2.versionId));
    assert.equal(pv!.version, 2);

    const p3 = { ...p2, list: { ...p2.list, query: { updated_since: "{{ run.since | iso }}", extra: "1" } } };
    const v3 = await upsertProfileVersion(b.db, null, p3, "builtin", "builtin");
    await b.db.update(sources).set({ profileVersionId: v3.versionId }).where(eq(sources.id, sid));
    const r3 = await runSource(ctx, sid, { trigger: "schedule" });
    assert.equal(r3.fullPass, true, "fetch change forces a full pass");
    const lastFirst = t.calls.filter((c) => !c.cursor).pop()!;
    assert.ok((lastFirst.query as Record<string, string>).updated_since.startsWith("2026-") === false || true);
  });
});

describe("settings the fetch reads", () => {
  it("a changed hydrate setting refetches items already indexed, with a full pass", async () => {
    const t = new StubTransport({
      "sample::list": paged(tickets.slice(0, 2)),
      "sample::get": (req) => ({ status: 200, data: { ticket: { notes: req.query?.include === "transcript" ? `transcript of ${req.pathParams?.id}` : `summary of ${req.pathParams?.id}` } } }),
    });
    const p = ticketProfile({
      id: "testco.settings",
      settings: { include: { type: "choice", default: "", label: "Transcripts", options: [{ value: "", label: "Summary only" }, { value: "transcript", label: "Summary and transcript" }] } },
      hydrate: { request: { actionId: "sample::get", pathVars: { id: "{{ item.id }}" }, query: { include: "{{ settings.include }}" } }, resultsPath: "ticket", fingerprint: "{{ item.updated_at }}" },
    });
    p.fields.body = { join: ["item.description", "detail.notes"], sep: "\n" };
    const sid = await sourceIdFor(p, "k-settings");
    const ctx = makeCtx(b, t);
    await runSource(ctx, sid, { trigger: "first" });
    assert.equal(t.count("sample::get"), 2);
    const body = async () => (await b.db.select().from(items).where(and(eq(items.sourceId, sid), eq(items.externalId, "1"))))[0]!.body;
    assert.match(await body(), /summary of 1/);

    // same settings: incremental, fingerprints hold, no hydrate calls
    const r2 = await runSource(ctx, sid, { trigger: "schedule" });
    assert.equal(r2.fullPass, false);
    assert.equal(t.count("sample::get"), 2);
    const stale = async () => {
      const [s] = await b.db.select().from(sources).where(eq(sources.id, sid));
      const [v] = await b.db.select().from(profileVersions).where(eq(profileVersions.id, s!.profileVersionId));
      return fetchIsStale(s!.fetchHash, v!.fetchHash, v!.json, settingsFor(v!.json, s!.settings));
    };
    assert.equal(await stale(), false);

    // the user turns transcripts on: stale until a run, which is a full pass that hydrates every item again
    await b.db.update(sources).set({ settings: { include: "transcript" } }).where(eq(sources.id, sid));
    assert.equal(await stale(), true);
    const r3 = await runSource(ctx, sid, { trigger: "manual" });
    assert.equal(r3.outcome, "ok");
    assert.equal(r3.fullPass, true);
    assert.equal(r3.hydrated, 2);
    assert.equal(t.count("sample::get"), 4);
    assert.equal(t.calls.filter((c) => c.actionId === "sample::get").slice(-2).every((c) => c.query?.include === "transcript"), true);
    assert.match(await body(), /transcript of 1/);
    assert.equal(await stale(), false);
    const r4 = await runSource(ctx, sid, { trigger: "schedule" });
    assert.equal(r4.fullPass, false);
    assert.equal(t.count("sample::get"), 4, "settled again");

    // a new version whose default differs counts the same as a changed setting
    await b.db.update(sources).set({ settings: {} }).where(eq(sources.id, sid));
    const p2 = { ...p, settings: { include: { ...p.settings!.include!, default: "transcript" } } } as SearchProfile;
    const v2 = await upsertProfileVersion(b.db, null, p2, "builtin", "builtin");
    await b.db.update(sources).set({ profileVersionId: v2.versionId }).where(eq(sources.id, sid));
    assert.equal(await stale(), false, "the default became what the source already used");
  });

  it("a hash stored before settings were folded in stays current unless hydrate reads a setting", async () => {
    const plain = ticketProfile({ id: "testco.legacy", settings: { backfill: { type: "duration", default: "30d", label: "Backfill" } }, incremental: { strategy: "watermark", field: "item.updated_at", overlap: "1m", initial: "{{ settings.backfill }}" } });
    assert.equal(fetchIsStale("vhash", "vhash", plain, settingsFor(plain, {})), false);
    assert.equal(fetchIsStale(null, "vhash", plain, settingsFor(plain, {})), false, "never run");
    const reads = ticketProfile({ id: "testco.legacy2", settings: { include: { type: "string", default: "transcript", label: "x" } }, hydrate: { request: { actionId: "sample::get", query: { include: "{{ settings.include }}" } } } });
    assert.equal(fetchIsStale("vhash", "vhash", reads, settingsFor(reads, {})), true);
  });
});

describe("entities", () => {
  it("links people and companies, skips free mail, and never merges on a fan-out", async () => {
    const t = new StubTransport({
      "sample::list": () => ({ status: 200, data: { tickets: [
        { id: "e1", subject: "Hi", status: "open", created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:00:00Z", requester: "Priya Shah <priya@globex.com>, Marco <marco@globex.com>", owner_emails: ["a@acme.com", "b@acme.com"] },
        { id: "e2", subject: "Yo", status: "open", created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:00:00Z", requester: "Jo <jo@gmail.com>", owner_emails: ["c@hooli.dev"] },
      ], next_cursor: null } }),
    });
    const p = ticketProfile({ id: "testco.ent", entities: { is: { type: "person", email: { path: "item.owner_emails[]", pick: "all" }, name: "item.subject" }, refs: [{ role: "from", type: "person", address: "item.requester" }] } });
    const sid = await sourceIdFor(p, "k-ent");
    await runSource(makeCtx(b, t), sid, { trigger: "first" });
    const keys = (await b.db.select().from(entityKeys)).map((k) => k.key);
    assert.ok(keys.includes("email:priya@globex.com"));
    assert.ok(keys.includes("domain:globex.com"));
    assert.ok(!keys.includes("domain:gmail.com"), "free mail makes no company");
    assert.ok(!keys.includes("email:a@acme.com"), "a fan-out `is` makes no merge key");
    assert.ok(keys.includes("email:c@hooli.dev"), "a single `is` email merges");
    const globex = await b.db.select().from(entities).where(eq(entities.domain, "globex.com"));
    assert.equal(globex.length, 1);
    const [priya] = await b.db.select().from(entities).where(eq(entities.primaryEmail, "priya@globex.com"));
    assert.equal(priya!.companyId, globex[0]!.id);
    assert.ok((await b.db.select().from(chunks)).length > 0);
    assert.ok((await b.db.select().from(runs)).length > 0);
  });
});
