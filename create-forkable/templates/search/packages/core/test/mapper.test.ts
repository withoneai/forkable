// The New profile flow on the Acme sample (Zendesk fixture catalog), rules
// inference, pack export and import, suggest and the sample rerank.
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import type { EngineCtx } from "../src/ctx.js";
import type { ServerEvent } from "../src/contract.js";
import { profiles, sources } from "../src/db/schema.js";
import { inferHints, profileFromHints } from "../src/mapper/infer.js";
import { classifyAction, listPlatforms } from "../src/mapper/catalog.js";
import { createDraft, pickModels, patchDraft, previewDraft, saveDraft, validateDraft, draftProfile } from "../src/mapper/drafts.js";
import { checkProposal, rulesProposal } from "../src/mapper/propose.js";
import { acceptImport, exportPack, importPack } from "../src/profile/share.js";
import { loadBuiltinPacks, upsertBuiltins } from "../src/profile/builtins.js";
import { validateProfile } from "../src/profile/validate.js";
import { fixtureTransport, loadSampleWorld } from "../src/sample/world.js";
import { runSource } from "../src/engine/run.js";
import { suggest } from "../src/search/suggest.js";
import { fuseRerank } from "../src/search/rerank.js";
import { SAMPLE_SETTINGS } from "../src/settings.js";
import { seedUser, testDb } from "./helpers.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("inference (SPEC 10.4)", () => {
  const resp = {
    tickets: [
      { id: 11, subject: "Export fails", description: "<p>The CSV export fails over 50 MB on every try since Monday.</p>", status: "open", created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-28T09:00:00Z", url: "https://acme.zendesk.com/api/v2/tickets/11.json", requester_email: "ravi@initech.io" },
      { id: 12, subject: "SSO login loop", description: "<p>Users bounce between the IdP and the app after the SAML change.</p>", status: "pending", created_at: "2026-10-21T10:00:00Z", updated_at: "2026-10-27T09:00:00Z", url: "https://acme.zendesk.com/api/v2/tickets/12.json", requester_email: "priya@globex.com" },
    ],
    after_cursor: "abc", end_of_stream: false,
  };
  it("finds results, id, cursor, title, body, dates, emails and links", () => {
    const h = inferHints(resp, { model: "tickets", ioSchema: { properties: { start_time: {} } } });
    assert.equal(h.resultsPath, "tickets");
    assert.equal(h.idPath, "id");
    assert.deepEqual(h.pagination, { type: "cursor", next: "after_cursor", passAs: "query:cursor", hasMore: "end_of_stream", hasMoreInverted: true });
    assert.equal(h.titleCandidates[0], "subject");
    assert.equal(h.bodyCandidates[0], "description");
    assert.ok(h.dateCandidates.includes("created_at") && h.dateCandidates.includes("updated_at"));
    assert.deepEqual(h.emailCandidates, ["requester_email"]);
    assert.deepEqual(h.urlCandidates, ["url"]);
    assert.equal(h.incrementalParam, "start_time");
  });
  it("the rules profile validates and is incremental on updated_at", () => {
    const h = inferHints(resp, { model: "tickets", ioSchema: { properties: { start_time: {} } } });
    const p = profileFromHints({ platform: "zendesk", actionId: "conn_mod_def::x::y", title: "Incremental Ticket Export", method: "GET", path: "/api/v2/incremental/tickets", hints: h });
    assert.equal(p.id, "zendesk.tickets");
    assert.deepEqual(validateProfile(p).issues.filter((i) => i.level === "error"), []);
    assert.equal(p.incremental.strategy, "watermark");
    assert.deepEqual(p.list.query, { start_time: "{{ run.since | unix }}" });
    assert.equal(p.entities?.refs?.[0]?.role, "author");
  });
  it("classifies actions as read and list-like", () => {
    assert.deepEqual(classifyAction({ title: "List Tickets", method: "GET", path: "/api/v2/tickets" }), { listLike: true, readOnly: true });
    assert.equal(classifyAction({ title: "Update Ticket", method: "PUT", path: "/api/v2/tickets/{{id}}" }).readOnly, false);
    assert.equal(classifyAction({ title: "Search CRM Contacts", method: "POST", path: "/crm/v3/objects/contacts/search" }).readOnly, true);
  });
  it("a proposal that invents an action is dropped", () => {
    const p = profileFromHints({ platform: "zendesk", actionId: "conn_mod_def::x::y", title: "T", method: "GET", path: "/t", hints: inferHints(resp) });
    const { ok, errors } = checkProposal({ models: [{ recommended: true, reason: "r", profile: { ...p, list: { ...p.list, actionId: "conn_mod_def::made::up" } }, fieldNotes: [], questions: [] }] }, [{ actionId: "conn_mod_def::x::y", title: "T", method: "GET", path: "/t", knowledge: "", sample: resp, hints: inferHints(resp) }]);
    assert.equal(ok.models.length, 0);
    assert.equal(errors[0]?.check, "actions");
    assert.equal(rulesProposal("zendesk", [{ actionId: "conn_mod_def::x::y", title: "T", method: "GET", path: "/t", knowledge: "", sample: resp, hints: inferHints(resp) }]).models.length, 1);
  });
  it("rerank fusion keeps RRF order for equal relevance and lifts exact hits", () => {
    assert.deepEqual(fuseRerank(["a", "b", "c"], new Map()), ["a", "b", "c"]);
    assert.deepEqual(fuseRerank(["a", "b", "c"], new Map([["c", 3]])).slice(0, 1), ["c"]);
  });
});

describe("New profile on the sample (Zendesk)", () => {
  let b: Awaited<ReturnType<typeof testDb>>;
  let ctx: EngineCtx;
  const events: ServerEvent[] = [];
  const userId = "usr_mapper";
  before(async () => {
    b = await testDb("mapper");
    const world = loadSampleWorld(join(ROOT, "fixtures", "sample"));
    ctx = { db: b.db, oneConnect: null, capability: b.capability, transport: fixtureTransport(world), world, settingsFor: async () => SAMPLE_SETTINGS, emit: (_u, e) => events.push(e), log() {}, now: () => new Date() };
    await upsertBuiltins(b.db, loadBuiltinPacks(join(ROOT, "profiles")));
    await seedUser(b.db, userId);
  });
  after(async () => { await b.done(); });

  let draftId = "";
  it("lists the fixture catalog with Zendesk in the sample grant", async () => {
    const rows = await listPlatforms(ctx, userId, "zen");
    const z = rows.find((r) => r.platform === "zendesk");
    assert.ok(z?.inGrant);
    assert.equal(z?.builtin, false);
    assert.ok((await listPlatforms(ctx, userId, "")).some((r) => r.platform === "hubspot" && r.builtin));
  });
  it("creates a draft with models only, no AI and no dry run", async () => {
    const d = await createDraft(ctx, userId, { platform: "zendesk" });
    assert.equal(d.proposal, null);
    assert.deepEqual(d.samples, {});
    const t = d.models.find((m) => m.key === "ticket");
    assert.ok(t?.suggested && t.kind === "task", JSON.stringify(d.models.map((m) => m.key)));
    assert.ok(d.models.every((m) => m.actions.every((a) => a.actionId !== "sample::zendesk::update-ticket")), "writes are never models");
    assert.ok(d.hiddenActions > 0);
    assert.deepEqual(events.filter((e) => e.type === "draft").map((e) => (e as { stage: string }).stage), ["actions", "ready"]);
    events.length = 0;
  });
  it("maps only the picked models: dry runs, the fixture proposal, validation", async () => {
    const d0 = await createDraft(ctx, userId, { platform: "zendesk" });
    events.length = 0;
    const d = await pickModels(ctx, userId, d0.id, ["ticket"]);
    draftId = d.id;
    assert.equal(d.inGrant, true);
    assert.equal(d.proposedBy, "fixture");
    assert.deepEqual(d.picked, ["ticket"]);
    assert.ok(d.candidates.every((c) => c.model === "ticket"), JSON.stringify(d.candidates.map((c) => c.title)));
    assert.ok(d.samples["sample::zendesk::incremental-tickets-cursor"]?.ok);
    assert.deepEqual(d.edits.selected, ["zendesk.tickets"]);
    assert.ok(d.validation?.ok, JSON.stringify(d.validation?.issues.filter((i) => i.level === "error")));
    assert.deepEqual(events.filter((e) => e.type === "draft").map((e) => (e as { stage: string }).stage), ["docs", "dry_run", "propose", "validate", "ready"]);
  });
  it("previews and validates edits, naming the failing samples", async () => {
    const pv = await previewDraft(ctx, userId, draftId, "zendesk.tickets");
    assert.ok(pv.samples.length >= 3);
    assert.ok(pv.samples[0]!.row.title.length > 0);
    await patchDraft(ctx, userId, draftId, { edits: { profiles: { "zendesk.tickets": { fields: { title: "item.nope", occurredAt: { path: "item.created_at", decode: "datetime" } } } } } });
    const r = await validateDraft(ctx, userId, draftId);
    const t = r.issues.find((i) => i.check === "title");
    assert.equal(t?.level, "error");
    assert.ok((t?.sampleIds?.length ?? 0) >= 3);
    await patchDraft(ctx, userId, draftId, { edits: { profiles: {} } });
    const [row] = await b.db.select().from(profiles).where(eq(profiles.slug, "zendesk.tickets"));
    assert.equal(row, undefined);
  });
  it("saves: a user profile, a fixture source, and the source indexes", async () => {
    // patchDraft merges profiles: clear the bad edit explicitly
    await patchDraft(ctx, userId, draftId, { edits: { profiles: { "zendesk.tickets": {} } } });
    const r = await saveDraft(ctx, userId, draftId, { name: "Support tickets", profiles: ["zendesk.tickets"] });
    assert.equal(r.sourceIds.length, 1);
    const [s] = await b.db.select().from(sources).where(eq(sources.id, r.sourceIds[0]!));
    assert.equal(s?.mode, "fixture");
    const [p] = await b.db.select().from(profiles).where(and(eq(profiles.userId, userId), eq(profiles.slug, "zendesk.tickets")));
    assert.equal(p?.origin, "user");
    const sum = await runSource(ctx, r.sourceIds[0]!, { trigger: "first" });
    assert.equal(sum.outcome, "ok", JSON.stringify(sum.error));
    assert.ok(sum.upserted >= 10, String(sum.upserted));
  });
  it("exports without the user id, imports as a preview, accepts", async () => {
    const [p] = await b.db.select().from(profiles).where(and(eq(profiles.userId, userId), eq(profiles.slug, "zendesk.tickets")));
    const pack = await exportPack(b.db, userId, p!.id);
    assert.equal(pack.profiles[0]!.author, "community");
    assert.equal(pack.profiles[0]!.proposal, undefined);
    assert.ok(!JSON.stringify(pack).includes(userId));
    const pv = await importPack(b.db, "usr_other", pack);
    assert.equal(pv.diff[0]!.status, "new");
    assert.ok(pv.report.ok);
    const same = await importPack(b.db, userId, pack);
    assert.equal(same.diff[0]!.status, "same");
    const ids = await acceptImport(b.db, "usr_other", pv.importId);
    assert.equal(ids.length, 1);
    await assert.rejects(importPack(b.db, userId, { nope: true }), /not a Search profile pack/);
    await assert.rejects(acceptImport(b.db, userId, pv.importId), /expired/);
  });
  it("suggests operators, platforms and recent searches", async () => {
    const s = await suggest(ctx, userId, "in:zen");
    assert.deepEqual(s.operators.map((o) => o.insert), ["in:zendesk"]);
    const t = await suggest(ctx, userId, "lane:n");
    assert.deepEqual(t.operators.map((o) => o.insert), ["lane:needs-you"]);
    assert.ok((await suggest(ctx, userId, "fro")).operators.some((o) => o.insert === "from:"));
    void draftProfile;
  });
});
