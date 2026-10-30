// Smoke test for the email2 port on a live mailbox: inbox tabs in the Gmail
// query and the judging queue, Jev failing closed (hold, then the writer
// judges without drafts), reconcile requeuing a thread with no lane, and
// follow-ups bringing a done thread back once. A stubbed grant, no network,
// no keys. Needs a Postgres: the embedded one Rill already runs (~/.rill/db),
// into a scratch database that is dropped at the end.
// Run: pnpm exec tsx scripts/smoke-filtering.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { createDb, ensureDatabase, followUps, newId, reconcile, runMigrations, schema, sync, type Ctx } from "@rill/core";
import type { OneConnectClient } from "@withone/connect/server";
import { loadEnv } from "../src/config.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const PG = process.env.SMOKE_PG ?? "postgres://rill:rill@127.0.0.1:55439";
const NAME = `rill_smoke_${Date.now()}`;
await ensureDatabase(`${PG}/postgres`, NAME);
const { db, pool } = createDb(`${PG}/${NAME}`);
await runMigrations(db);

const env = { ...loadEnv(), LOCAL: false, AI_ENGINE: undefined } as ReturnType<typeof loadEnv>;
const jevRecording = (JSON.parse(readFileSync(path.join(env.ROOT, "fixtures/recorded/t15.json"), "utf8")) as { jev: unknown }).jev;

// The grant: Gmail, TypeSafe (Jev) and Anthropic (the writer). Jev's health is a switch.
let jevUp = false;
const queries: string[] = [];
const calls: string[] = [];
const oneConnect = {
  async isConnected() { return true; },
  async listConnections() {
    return [
      { platform: "gmail", key: "live::gmail::default::abc", title: "Gmail" },
      { platform: "typesafe", key: "live::typesafe::default::abc", title: "TypeSafe" },
      { platform: "anthropic", key: "live::anthropic::default::abc", title: "Anthropic" },
    ];
  },
  async runAction(_userId: string, req: { path: string; body?: Record<string, unknown> }) {
    calls.push(req.path);
    if (req.path.includes("systemone")) {
      if (!jevUp) return { ok: false, status: 503, blockedByGrant: false, refusal: null, data: { error: "unavailable" } };
      return { ok: true, status: 200, blockedByGrant: false, refusal: null, data: jevRecording };
    }
    if (req.path.includes("/messages") && !req.path.includes("gmail")) {
      const text = JSON.stringify({ kind: "person", kind_confidence: 0.9, needs_reply: 0.95, ball: "me", ball_confidence: 0.9, urgency: 1, inj_agent_addressed: 0, inj_override: 0, inj_action_request: 0, summary: "Ben needs a signature." });
      return { ok: true, status: 200, blockedByGrant: false, refusal: null, data: { model: "claude-smoke", content: [{ type: "text", text }] } };
    }
    if (typeof req.body?.query === "string") queries.push(req.body.query);
    return { ok: true, status: 200, blockedByGrant: false, refusal: null, data: { threads: [] } };
  },
} as unknown as OneConnectClient;

const userId = newId("usr");
const mailboxId = newId("mbx");
await db.insert(schema.users).values({ id: userId, name: "Dana Reyes" });
await db.insert(schema.mailboxes).values({ id: mailboxId, userId, source: "live", mode: "connect", connectionKey: "live::gmail::default::abc", address: "dana@acme.example", label: "dana@acme.example", syncState: { initialImportDone: true } });
await db.insert(schema.settings).values({ mailboxId, me: "Dana Reyes, CEO of Acme Inc", writerEngine: "one", writerProvider: "anthropic" });

async function ctxNow(): Promise<Ctx> {
  const [mailbox] = await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.id, mailboxId));
  const [settings] = await db.select().from(schema.settings).where(eq(schema.settings.mailboxId, mailboxId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  return { db, mailbox: mailbox!, user: user!, settings: settings!, oneConnect, env, emit: () => {} } as Ctx;
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
async function addThread(gmailId: string, subject: string, msgs: { from: string; fromMe?: boolean; labels?: string[]; at: Date }[]) {
  const id = `${mailboxId}:${gmailId}`;
  await db.insert(schema.threads).values({ id, gmailId, mailboxId, subject, lastMessageAt: msgs[msgs.length - 1]!.at, messageCount: msgs.length, participants: [{ name: "", email: msgs[0]!.from }] });
  let i = 0;
  for (const m of msgs) {
    const mid = `${gmailId}-m${i++}`;
    await db.insert(schema.messages).values({
      id: `${mailboxId}:${mid}`, gmailId: mid, threadId: id, mailboxId, fromName: m.from, fromEmail: m.from,
      to: m.fromMe ? ["ben@adlerandco.example"] : ["dana@acme.example"], date: m.at, subject, body: "Could you sign the Q3 filing today?",
      labelIds: m.labels ?? (m.fromMe ? ["SENT"] : ["INBOX"]), isFromMe: !!m.fromMe, judgedAt: m.fromMe ? new Date() : null,
    });
  }
  return id;
}
const unjudged = async (threadId: string) =>
  (await db.select().from(schema.messages).where(and(eq(schema.messages.threadId, threadId), eq(schema.messages.isFromMe, false)))).filter((m) => !m.judgedAt).length;
const stateOf = async (threadId: string) => (await db.select().from(schema.threadState).where(eq(schema.threadState.threadId, threadId)))[0];
const syncState = async () => (await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.id, mailboxId)))[0]!.syncState;

try {
  // 1. Tabs: the Gmail query reads Primary only by default.
  await sync.syncMailbox(await ctxNow());
  check("the Gmail query reads the inbox, Primary only", queries[0]?.startsWith("in:inbox -category:promotions -category:updates -category:social -category:forums newer_than:2d") ?? false, queries[0]);

  const filing = await addThread("t-filing", "Q3 filing ready for your signature", [{ from: "ben@adlerandco.example", at: minutesAgo(5) }]);
  const promo = await addThread("t-promo", "50% off this week", [{ from: "deals@shop.example", labels: ["INBOX", "CATEGORY_PROMOTIONS"], at: minutesAgo(5) }]);

  // 2. Jev down: held, not guessed.
  calls.length = 0;
  const r1 = await sync.judgePending(await ctxNow());
  check("a promotion never reaches the queue", !calls.some((c) => c.includes("systemone")) || r1.held + r1.judged + r1.failed === 1, JSON.stringify(r1));
  check("Jev down: the message is held, not judged", r1.held === 1 && r1.judged === 0, JSON.stringify(r1));
  check("held means no lane and still unjudged", !(await stateOf(filing)) && (await unjudged(filing)) === 1);
  check("the promotion was left alone", (await unjudged(promo)) === 1 && !(await stateOf(promo)));
  const down = (await syncState()).jevDownSince;
  check("the mailbox records when Jev went down", typeof down === "string");
  check("the writer was not asked while holding", !calls.some((c) => c.includes("/v1/messages")), calls.join(", "));

  // 3. Over an hour: the writer judges, with no draft and Check on.
  await db.update(schema.mailboxes).set({ syncState: { initialImportDone: true, jevDownSince: minutesAgo(61).toISOString() } }).where(eq(schema.mailboxes.id, mailboxId));
  const r2 = await sync.judgePending(await ctxNow());
  const st2 = await stateOf(filing);
  check("after the hour the writer judges it", r2.judged === 1 && st2?.judgedBy === "writer-fallback", `${JSON.stringify(r2)} ${st2?.judgedBy}`);
  check("degraded: Check on with the reason", st2?.check === true && /Jev was down/.test(st2?.checkReason ?? ""), st2?.checkReason ?? "");
  const drafts = await db.select().from(schema.drafts).where(eq(schema.drafts.threadId, filing));
  check("degraded: no draft written", drafts.length === 0, String(drafts.length));

  // 4. Jev back: the next message is judged by Jev and the outage clears.
  jevUp = true;
  await db.update(schema.messages).set({ judgedAt: null }).where(eq(schema.messages.threadId, filing));
  const r3 = await sync.judgePending(await ctxNow());
  const st3 = await stateOf(filing);
  check("Jev back: judged by Jev", r3.judged === 1 && st3?.judgedBy === "jev", `${JSON.stringify(r3)} ${st3?.judgedBy}`);
  check("Jev back: the outage is cleared", !(await syncState()).jevDownSince);

  // 5. Reconcile: a listed thread with judged messages but no lane is put back in the queue.
  await db.delete(schema.threadState).where(eq(schema.threadState.threadId, filing));
  const rec = await reconcile(await ctxNow(), ["t-filing", "t-promo", "t-never-imported"]);
  check("reconcile counts a listed thread that never landed", rec.missing === 1, JSON.stringify(rec));
  check("reconcile requeues the thread with no lane", rec.requeued === 1 && (await unjudged(filing)) === 1, JSON.stringify(rec));
  check("reconcile does not count an off tab as stuck", rec.stuck === 0, JSON.stringify(rec));
  check("the reconcile is stored on the mailbox", (await syncState()).reconcile?.listed === 3);
  await sync.judgePending(await ctxNow());
  check("the requeued thread gets its lane back", Boolean(await stateOf(filing)));

  // 6. Follow-ups: you wrote last four days ago and marked it done; it comes back once.
  const waiting = await addThread("t-waiting", "Pilot proposal", [
    { from: "richard@hooli.example", at: minutesAgo(6 * 1440) },
    { from: "dana@acme.example", fromMe: true, at: minutesAgo(4 * 1440) },
  ]);
  jevUp = true;
  await sync.judgePending(await ctxNow());
  await db.update(schema.threadState).set({ done: true, doneReason: "done" }).where(eq(schema.threadState.threadId, waiting));
  const f1 = await followUps(await ctxNow());
  const w1 = await stateOf(waiting);
  check("a due follow-up brings a done thread back", f1.resurfaced >= 1 && w1?.done === false && w1.followUpShownAt !== null, JSON.stringify(f1));
  check("its timer is three days after your message", Math.abs((w1?.followUpAt?.getTime() ?? 0) - minutesAgo(1440).getTime()) < 120_000);
  await db.update(schema.threadState).set({ done: true }).where(eq(schema.threadState.threadId, waiting));
  const f2 = await followUps(await ctxNow());
  check("marked done again, it stays done (once per round)", f2.resurfaced === 0 && (await stateOf(waiting))?.done === true, JSON.stringify(f2));
  const notYet = await addThread("t-recent", "Thanks, talk soon", [{ from: "lena@initech.example", at: minutesAgo(2 * 1440) }, { from: "dana@acme.example", fromMe: true, at: minutesAgo(60) }]);
  await sync.judgePending(await ctxNow());
  await followUps(await ctxNow());
  const n1 = await stateOf(notYet);
  check("a fresh message of yours sets a timer that is not due yet", n1?.followUpAt !== null && (n1?.followUpAt?.getTime() ?? 0) > Date.now() && n1?.followUpShownAt === null);
} finally {
  await pool.end();
  const admin = new pg.Client(`${PG}/postgres`);
  await admin.connect();
  await admin.query(`drop database if exists "${NAME}" with (force)`);
  await admin.end();
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
