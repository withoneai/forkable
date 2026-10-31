// The mapping assistant on a real local engine: a Zendesk draft made before the
// grant (stubbed One catalog, the docs' example as samples), then two asks through
// the chosen engine (SEARCH_LOCAL_ENGINE picks it): a question that must not change
// anything, and a change that must come back as valid ops. Plus checkOps on bad ops.
// Run: SEARCH_LOCAL_ENGINE=claude-code pnpm --filter @search/core exec tsx scripts/smoke-mapping-assistant.ts

// Must stay the first import: fails the run if it touches the repo's Connect ask or .env.
import "../src/test-guard.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EngineCtx, OneConnectKeyClient } from "../src/ctx.js";
import { users } from "../src/db/schema.js";
import { assistDraft, checkOps, type AssistOp } from "../src/mapper/assist.js";
import { createDraft } from "../src/mapper/drafts.js";
import { loadSampleWorld } from "../src/sample/world.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { testDb } from "../test/helpers.js";

process.env.SEARCH_LOCAL_ENGINE ??= "claude-code";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? `\n     ${detail}` : ""}`); };

const world = loadSampleWorld(resolve(ROOT, "fixtures/sample"));
const live = (id: string) => id.replace(/^sample::/, "conn_mod_def::");
const sampleId = (id: string) => id.replace(/^conn_mod_def::/, "sample::");
const EXAMPLE = "\n\n## Example response\n\n```json\n" + JSON.stringify({ tickets: [
  { id: 101, subject: "Login fails on SSO", description: "Customer cannot sign in with SSO since Monday.", status: "open", created_at: "2026-10-20T09:00:00Z", updated_at: "2026-10-21T10:00:00Z", url: "https://acme.zendesk.com/api/v2/tickets/101.json" },
  { id: 102, subject: "Invoice copy", description: "Asks for a copy of the September invoice.", status: "solved", created_at: "2026-10-18T12:00:00Z", updated_at: "2026-10-19T08:00:00Z", url: "https://acme.zendesk.com/api/v2/tickets/102.json" },
] }, null, 2) + "\n```\n";
const stub = {
  isConnected: async () => true,
  listConnections: async () => [],
  listActions: async (_u: string, platform: string) => ((world.catalog.actions.get(platform) ?? []) as { _id: string }[]).map((a) => ({ ...a, _id: live(a._id) })),
  getActionKnowledge: async (_u: string, id: string) => {
    const k: Record<string, unknown> = { ...(world.catalog.knowledge.get(sampleId(id)) as Record<string, unknown>), actionId: id };
    if (id.endsWith("list-tickets")) k.knowledge = String(k.knowledge ?? "") + EXAMPLE;
    return k;
  },
  runAction: async () => { throw new Error("no runAction here"); },
} as unknown as OneConnectKeyClient;

// checkOps, no model needed
const fake = { proposal: { models: [{ profile: { id: "zendesk.tickets" } }] } } as never;
const c = checkOps([
  { op: "map", model: "zendesk.tickets", path: "item.updated_at", target: "updatedAt" },
  { op: "map", model: "nope", path: "x", target: "title" },
  { op: "map", model: "zendesk.tickets", path: "x", target: "colour" },
  { op: "identity", model: "zendesk.tickets", urlTemplate: "javascript:alert(1)" },
  { op: "identity", model: "zendesk.tickets", every: "60m", backfill: "all" },
  { op: "delete_everything" },
], fake);
check("checkOps keeps the good ops", c.ops.length === 2 && (c.ops[0] as Extract<AssistOp, { op: "map" }>).path === "updated_at", JSON.stringify(c.ops));
check("checkOps drops unknown models, targets, non-https links and ops", c.dropped.length === 4, JSON.stringify(c.dropped));

const b = await testDb("assist");
try {
  const userId = "usr_live";
  await b.db.insert(users).values({ id: userId, name: "Dana Oyelaran", email: "dana@acme.com", isSample: false });
  const logs: string[] = [];
  const ctx: EngineCtx = { db: b.db, oneConnect: stub, capability: b.capability, transport: null, settingsFor: async () => DEFAULT_SETTINGS, emit() {}, log: (l) => logs.push(l), now: () => new Date(), world };
  const d = await createDraft(ctx, userId, { platform: "zendesk", models: ["ticket"] });
  const m = d.proposal!.models.find((x) => x.profile.list.actionId.endsWith("list-tickets")) ?? d.proposal!.models[0]!;
  const pid = m.profile.id;
  const state = {
    step: "Fields", active: pid, selected: [pid], name: "Zendesk tickets",
    rows: { [pid]: [{ path: "id", target: "id" }, { path: "subject", target: "title" }, { path: "created_at", target: "occurredAt" }, { path: "updated_at", target: "skip" }, { path: "description", target: "skip" }, { path: "status", target: "skip" }, { path: "url", target: "skip" }] },
    identity: { [pid]: { idPath: "id", urlTemplate: "", every: "15m", backfill: "365d" } },
  };
  let t = Date.now();
  const q = await assistDraft(ctx, userId, d.id, { message: "What does the status field hold here? Don't change anything.", state });
  check(`a question gets an answer and no ops (${q.by}, ${((Date.now() - t) / 1000).toFixed(1)} s)`, q.reply.length > 10 && q.ops.length === 0, JSON.stringify(q));
  console.log(`     ${q.reply.slice(0, 200)}`);
  t = Date.now();
  const e = await assistDraft(ctx, userId, d.id, { message: "Use description as the body, updated_at as the date updated, and refresh every hour.", history: [{ role: "user", text: "What does the status field hold here?" }, { role: "assistant", text: q.reply }], state });
  const has = (pred: (o: AssistOp) => boolean) => e.ops.some(pred);
  check(`a change comes back as ops (${((Date.now() - t) / 1000).toFixed(1)} s)`, e.ops.length > 0, JSON.stringify(e));
  check("description -> body", has((o) => o.op === "map" && o.path === "description" && o.target === "body"), JSON.stringify(e.ops));
  check("updated_at -> updatedAt", has((o) => o.op === "map" && o.path === "updated_at" && o.target === "updatedAt"), JSON.stringify(e.ops));
  check("every 60m", has((o) => o.op === "identity" && o.every === "60m"), JSON.stringify(e.ops));
  check("nothing dropped", e.dropped.length === 0, JSON.stringify(e.dropped));
  console.log(`     ${e.reply.slice(0, 200)}`);
} finally {
  await b.done();
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
