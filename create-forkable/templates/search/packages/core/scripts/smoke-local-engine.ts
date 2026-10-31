// The local engine end to end: indexes the Acme sample into a scratch schema, turns
// the demo user into a "live" user with no Connect client (so no Anthropic), then
// asks the assistant. Locally it must answer on Claude Code or Codex with
// citations and one Activity row; with SEARCH_LOCAL_ENGINE=off or SEARCH_HOSTED=1
// it must say what is missing. Spends one real local CLI turn or two.
// Run: pnpm --filter @search/core exec tsx scripts/smoke-local-engine.ts

// Must stay the first import: fails the run if it touches the repo's Connect ask or .env.
import "../src/test-guard.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { runChatTurn } from "../src/chat/run.js";
import type { ChatEvent } from "../src/api-types.js";
import type { EngineCtx } from "../src/ctx.js";
import { ledger, users } from "../src/db/schema.js";
import { engineStatus, redetectLocalEngine } from "../src/local-agent.js";
import { DEMO_USER, runDemo } from "../src/sample/demo.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import type { SettingsData } from "../src/contract.js";
import { testDb } from "../test/helpers.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? `\n     ${detail}` : ""}`); };

const b = await testDb("local_engine");
try {
  const r = await runDemo({ db: b.db, capability: b.capability, root: ROOT, database: { kind: "embedded", version: b.serverVersion, port: b.port } }, () => {});
  check("sample indexed", r.items > 0, String(r.failures));
  await b.db.update(users).set({ isSample: false }).where(eq(users.id, DEMO_USER));
  const logs: string[] = [];
  let settings: SettingsData = { ...DEFAULT_SETTINGS, chatModel: "claude-haiku-5-5", localChatModel: "claude-haiku-5-5" };
  const ctx: EngineCtx = { db: b.db, oneConnect: null, capability: b.capability, transport: null, settingsFor: async () => settings, emit() {}, log: (l) => logs.push(l), now: () => new Date() };
  const ask = async (q: string) => { const evs: ChatEvent[] = []; for await (const ev of runChatTurn(ctx, DEMO_USER, { message: q, context: { query: "globex renewal" } })) evs.push(ev); return evs; };

  const st = await engineStatus(settings);
  console.log(`engine: ${st.engine}${st.local ? ` (${st.local.name} at ${st.local.path})` : ` (${st.reason})`}; override ${st.override ?? "none"}`);
  for (const c of st.clis) console.log(`     ${c.name}: ${c.installed ? c.path : "not installed"}, signed in ${c.signedIn}, ${c.models.length} models`);
  check("status lists both CLIs", st.clis.map((c) => c.id).join(",") === "claude-code,codex");
  if (st.local) {
    const started = Date.now();
    const evs = await ask("Where does the Globex renewal stand?");
    const ans = evs.find((e) => e.type === "answer") as Extract<ChatEvent, { type: "answer" }> | undefined;
    const err = evs.find((e) => e.type === "error") as Extract<ChatEvent, { type: "error" }> | undefined;
    check(`answered on ${st.local.name} in ${((Date.now() - started) / 1000).toFixed(1)} s`, !!ans && ans.model.startsWith(`${st.local.id}:`), err?.error.message ?? logs.join(" | "));
    check("cites the sample", (ans?.citations.length ?? 0) > 0, ans?.text);
    if (ans) console.log(`     ${ans.text.slice(0, 300)}`);
    const rows = await b.db.select().from(ledger).where(and(eq(ledger.userId, DEMO_USER), eq(ledger.platform, st.local.id)));
    check("Activity row for the local run", rows.length >= 1 && rows.every((x) => x.method === "EXEC"));
    const anth = await b.db.select().from(ledger).where(and(eq(ledger.userId, DEMO_USER), eq(ledger.platform, "anthropic"), eq(ledger.mode, "connect")));
    check("no Anthropic call on the grant", anth.length === 0);
  }

  // the saved choice "one" with no Anthropic in the grant says so plainly (only when the env does not override it)
  const savedEnv = process.env.SEARCH_LOCAL_ENGINE;
  delete process.env.SEARCH_LOCAL_ENGINE;
  settings = { ...settings, engine: "one" };
  const execRows = async () => (await b.db.select().from(ledger).where(and(eq(ledger.userId, DEMO_USER), eq(ledger.method, "EXEC")))).length;
  const before = await execRows();
  check("setting one: status says chosen", (await engineStatus(settings)).reason === "chosen");
  const evs0 = await ask("Where does the Globex renewal stand?");
  const err0 = evs0.find((e) => e.type === "error") as Extract<ChatEvent, { type: "error" }> | undefined;
  check("setting one: says Anthropic is not in your grant", err0?.error.code === "model_unavailable" && /Anthropic is not in your grant/.test(err0.error.message), err0?.error.message);
  check("setting one: no local run", (await execRows()) === before);
  settings = { ...settings, engine: "auto" };
  if (savedEnv !== undefined) process.env.SEARCH_LOCAL_ENGINE = savedEnv;

  process.env.SEARCH_LOCAL_ENGINE = "off"; redetectLocalEngine();
  let evs = await ask("Where does the Globex renewal stand?");
  let err = evs.find((e) => e.type === "error") as Extract<ChatEvent, { type: "error" }> | undefined;
  check("off: says Claude Code or Codex, or Anthropic", err?.error.code === "model_unavailable" && /Claude Code or Codex/.test(err.error.message), err?.error.message);
  delete process.env.SEARCH_LOCAL_ENGINE;

  process.env.SEARCH_HOSTED = "1"; redetectLocalEngine();
  check("hosted: engine is one", (await engineStatus({ engine: "claude-code" })).engine === "one");
  evs = await ask("Where does the Globex renewal stand?");
  err = evs.find((e) => e.type === "error") as Extract<ChatEvent, { type: "error" }> | undefined;
  check("hosted: says Anthropic in your grant", err?.error.message === "The assistant needs Anthropic in your grant.", err?.error.message);
  delete process.env.SEARCH_HOSTED;
} finally {
  await b.done();
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
