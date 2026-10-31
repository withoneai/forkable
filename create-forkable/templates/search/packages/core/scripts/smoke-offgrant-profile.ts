// New profile before the platform is in the grant: a live (non-sample) user whose
// stubbed grant has no Zendesk makes a Zendesk profile from One's catalog and docs,
// saves it as awaiting_grant, nothing runs, then a sign-in that grants Zendesk
// attaches it and it is due. The stub answers with the Acme catalog fixtures; one
// action's docs get a documented example response so both paths are covered.
// SEARCH_LOCAL_ENGINE=off keeps it to the rules proposal (set it to run a model).
// Run: pnpm --filter @search/core exec tsx scripts/smoke-offgrant-profile.ts

// Must stay the first import: fails the run if it touches the repo's Connect ask or .env.
import "../src/test-guard.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import type { EngineCtx, OneConnectKeyClient } from "../src/ctx.js";
import { sources, users } from "../src/db/schema.js";
import { createDraft, patchDraft, saveDraft, validateDraft } from "../src/mapper/drafts.js";
import { forgetGrant } from "../src/one.js";
import { ensureSources } from "../src/profile/builtins.js";
import { runSource } from "../src/engine/run.js";
import { loadSampleWorld } from "../src/sample/world.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { testDb } from "../test/helpers.js";

process.env.SEARCH_LOCAL_ENGINE ??= "off";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? `\n     ${detail}` : ""}`); };

const world = loadSampleWorld(resolve(ROOT, "fixtures/sample"));
const EXAMPLE = "\n\n## Example response\n\n```json\n" + JSON.stringify({ tickets: [
  { id: 101, subject: "Login fails on SSO", description: "Customer cannot sign in with SSO since Monday.", status: "open", created_at: "2026-10-20T09:00:00Z", updated_at: "2026-10-21T10:00:00Z", url: "https://acme.zendesk.com/api/v2/tickets/101.json" },
  { id: 102, subject: "Invoice copy", description: "Asks for a copy of the September invoice.", status: "solved", created_at: "2026-10-18T12:00:00Z", updated_at: "2026-10-19T08:00:00Z", url: "https://acme.zendesk.com/api/v2/tickets/102.json" },
] }, null, 2) + "\n```\n";
// live-looking ids: sample:: ids are refused outside the sample
const live = (id: string) => id.replace(/^sample::/, "conn_mod_def::");
const sampleId = (id: string) => id.replace(/^conn_mod_def::/, "sample::");
let granted: { key: string; platform: string; name: string; title: string; access: { policy: "full" } }[] = [];
const stub = {
  isConnected: async () => true,
  listConnections: async () => granted,
  listActions: async (_u: string, platform: string) => ((world.catalog.actions.get(platform) ?? []) as { _id: string }[]).map((a) => ({ ...a, _id: live(a._id) })),
  getActionKnowledge: async (_u: string, id: string) => {
    const k: Record<string, unknown> = { ...(world.catalog.knowledge.get(sampleId(id)) as Record<string, unknown>), actionId: id };
    if (id.endsWith("list-tickets")) k.knowledge = String(k.knowledge ?? "") + EXAMPLE;
    return k;
  },
  runAction: async () => { throw new Error("runAction must not be called before the grant"); },
} as unknown as OneConnectKeyClient;

const b = await testDb("offgrant");
try {
  const userId = "usr_live";
  await b.db.insert(users).values({ id: userId, name: "Dana Oyelaran", email: "dana@acme.com", isSample: false });
  const ctx: EngineCtx = { db: b.db, oneConnect: stub, capability: b.capability, transport: null, settingsFor: async () => DEFAULT_SETTINGS, emit() {}, log: (l) => { if (process.env.SMOKE_VERBOSE) console.log(`     log: ${l}`); }, now: () => new Date(), world };

  const d = await createDraft(ctx, userId, { platform: "zendesk", models: ["ticket"] });
  check("draft made without Zendesk in the grant", !d.inGrant && !d.connection);
  check("list actions read from the catalog", d.candidates.some((c) => c.listLike), String(d.candidates.length));
  const fromDocs = Object.values(d.samples);
  check("samples marked fromDocs, no fetch", fromDocs.length > 0 && fromDocs.every((s) => s.fromDocs));
  check("the documented example became sample records", fromDocs.some((s) => s.count === 2));
  check(`a proposal (${d.proposedBy})`, (d.proposal?.models.length ?? 0) > 0, JSON.stringify(d.proposal?.notes));
  const pick = d.proposal!.models.find((m) => m.profile.list.actionId.endsWith("list-tickets")) ?? d.proposal!.models[0]!;
  await patchDraft(ctx, userId, d.id, { edits: { selected: [pick.profile.id], profiles: {} } });
  const rep = await validateDraft(ctx, userId, d.id);
  check("validation passes with warnings, no errors", rep.ok, JSON.stringify(rep.issues.filter((i) => i.level === "error")));
  check("fetch check waits for the first run", rep.issues.some((i) => i.check === "fetch" && i.level === "warn" && /first run/.test(i.message)));

  const saved = await saveDraft(ctx, userId, d.id, { profiles: [pick.profile.id] });
  check("saved, awaiting the grant", saved.awaitingGrant === true && saved.sourceIds.length === 1);
  const [src] = await b.db.select().from(sources).where(eq(sources.id, saved.sourceIds[0]!));
  check("source is awaiting_grant with no next run", src?.status === "awaiting_grant" && src.nextRunAt === null && src.connectionKey === "pending:zendesk", JSON.stringify(src));
  const run = await runSource(ctx, src!.id, { trigger: "manual" });
  check("a run before the grant does nothing", run.outcome === "cancelled" && run.calls === 0);

  granted = [{ key: "live::zendesk::default::abc", platform: "zendesk", name: "Zendesk", title: "acme.zendesk.com", access: { policy: "full" } }];
  forgetGrant(userId);
  const ids = await ensureSources(ctx, userId);
  const [after] = await b.db.select().from(sources).where(and(eq(sources.userId, userId), eq(sources.id, src!.id)));
  check("the granting sign-in attaches it", ids.includes(src!.id) && after?.status === "new" && after.connectionKey === "live::zendesk::default::abc" && !!after.nextRunAt, JSON.stringify(after));
} finally {
  await b.done();
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
