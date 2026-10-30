// Smoke test for several connections of one platform in a grant: two Gmail
// accounts and an Outlook become three mailboxes, each calendar pairs with
// its own account, calendar calls run on the mailbox's calendar connection,
// an account that leaves the grant pauses and comes back, and a new account
// starts from the first mailbox's settings. A stubbed grant, no network, no
// keys. Needs the embedded Postgres Rill already runs (~/.rill/db), into a
// scratch database dropped at the end.
// Run: pnpm exec tsx scripts/smoke-multi-account.ts
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { calendar, createDb, ensureDatabase, newId, runMigrations, schema } from "@rill/core";
import type { OneConnectClient } from "@withone/connect/server";
import { loadEnv } from "../src/config.js";
import { onConnected, pairCalendars } from "../src/connect.js";
import { buildCtx } from "../src/ctx.js";
import type { Deps } from "../src/deps.js";
import { createHub } from "../src/events.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const PG = process.env.SMOKE_PG ?? "postgres://rill:rill@127.0.0.1:55439";
const NAME = `rill_smoke_multi_${Date.now()}`;
await ensureDatabase(`${PG}/postgres`, NAME);
const { db, pool } = createDb(`${PG}/${NAME}`);
await runMigrations(db);

type Conn = { platform: string; key: string; title?: string };
const GMAIL_A: Conn = { platform: "gmail", key: "live::gmail::default::aaa", title: "dana@gmail.example" };
const GMAIL_B: Conn = { platform: "gmail", key: "live::gmail::default::bbb", title: "Work Gmail" };
const GMAIL_D: Conn = { platform: "gmail", key: "live::gmail::default::ddd", title: "side@gmail.example" };
const OUTLOOK_C: Conn = { platform: "outlook-mail", key: "live::outlook-mail::default::ccc", title: "Dana Outlook" };
// Listed B's calendar first, so pairing in list order alone would get it wrong.
const GCAL_B: Conn = { platform: "google-calendar", key: "live::google-calendar::default::calb", title: "dana@work.example" };
const GCAL_A: Conn = { platform: "google-calendar", key: "live::google-calendar::default::cala", title: "dana@gmail.example" };
const ADDRESS: Record<string, string> = {
  [GMAIL_A.key]: "dana@gmail.example",
  [GMAIL_B.key]: "dana@work.example",
  [GMAIL_D.key]: "side@gmail.example",
  [OUTLOOK_C.key]: "dana@outlook.example",
};

let grant: Conn[] = [];
let whoamiUp = true;
const calls: { key: string; path: string }[] = [];
const stub = {
  async fetch(_userId: string, path: string) {
    if (!whoamiUp) return new Response("{}", { status: 403 });
    if (path === "/users/me") return Response.json({ id: "one-dana", email: "dana@acme.example", firstName: "Dana", lastName: "Reyes" });
    return Response.json({ user: { id: "one-dana", name: "Dana Reyes", email: "dana@acme.example" } });
  },
  async listConnections() { return grant; },
  async isConnected() { return true; },
  async runAction(_userId: string, req: { path: string; connectionKey: string }) {
    calls.push({ key: req.connectionKey, path: req.path });
    const addr = ADDRESS[req.connectionKey];
    return { ok: true, status: 200, blockedByGrant: false, refusal: null, data: { emailAddress: addr, mail: addr, userPrincipalName: addr, historyId: "1", items: [], value: [] } };
  },
  getConnectUserId: () => "cu_dana",
} as unknown as OneConnectClient;

const kicked: string[] = [];
const deps: Deps = {
  db, env: loadEnv(), oneConnect: stub, hub: createHub(), connectSetup: null, version: "smoke",
  scheduler: { kick: async (id: string) => { kicked.push(id); } } as unknown as Deps["scheduler"],
  dbInfo: { kind: "external", url: "smoke", dataDir: null },
};

const userId = newId("usr");
await db.insert(schema.users).values({ id: userId });
await db.insert(schema.connectUsers).values({ userId, reference: "ref:cu_dana", connectUserId: "cu_dana" });
const live = () => db.select().from(schema.mailboxes).where(and(eq(schema.mailboxes.userId, userId), eq(schema.mailboxes.mode, "connect"))).orderBy(schema.mailboxes.createdAt);
const byKey = async (key: string) => (await live()).find((m) => m.connectionKey === key);
const settle = () => new Promise((r) => setTimeout(r, 200));

try {
  // 0. Pairing on its own.
  const pairs = pairCalendars(
    [
      { id: "a", mailProvider: "gmail", address: "dana@gmail.example", calendarConnectionKey: null },
      { id: "b", mailProvider: "gmail", address: "dana@work.example", calendarConnectionKey: null },
      { id: "c", mailProvider: "outlook-mail", address: "dana@outlook.example", calendarConnectionKey: null },
    ],
    [GCAL_B, GCAL_A],
  );
  check("pairing: each Gmail gets its own account's calendar", pairs.get("a")?.key === GCAL_A.key && pairs.get("b")?.key === GCAL_B.key);
  check("pairing: never hands another address's calendar to a mailbox", !pairs.has("c"));
  const solo = pairCalendars([{ id: "x", mailProvider: "gmail", address: "x@y.example", calendarConnectionKey: null }], [{ platform: "google-calendar", key: "k", title: "Google Calendar" }]);
  check("pairing: one account and an untitled calendar still pair (the old behavior)", solo.get("x")?.key === "k");

  // 1. A grant with two Gmail accounts, an Outlook and two Google calendars.
  grant = [GCAL_B, GMAIL_A, OUTLOOK_C, GMAIL_B, GCAL_A];
  await onConnected(deps, userId);
  await settle();
  const first = await live();
  check("three mail connections make three mailboxes", first.length === 3, String(first.length));
  const a = await byKey(GMAIL_A.key), b = await byKey(GMAIL_B.key), c = await byKey(OUTLOOK_C.key);
  check("each mailbox learns its own address from its own connection", a?.address === "dana@gmail.example" && b?.address === "dana@work.example" && c?.address === "dana@outlook.example", first.map((m) => m.address).join(", "));
  check("Gmail accounts come before Outlook", first[0]?.mailProvider === "gmail" && first[1]?.mailProvider === "gmail" && first[2]?.mailProvider === "outlook-mail");
  check("the Outlook mailbox talks through Outlook", c?.mailProvider === "outlook-mail");
  check("account A pairs with A's calendar", a?.calendarConnectionKey === GCAL_A.key, a?.calendarConnectionKey ?? "null");
  check("account B pairs with B's calendar, matched by address after the profile read", b?.calendarConnectionKey === GCAL_B.key, b?.calendarConnectionKey ?? "null");
  check("the Outlook mailbox gets no Google calendar that belongs to another address", c?.calendarConnectionKey == null);
  check("a first sync was kicked for every mailbox", [a, b, c].every((m) => m && kicked.includes(m.id)));
  const profileKeys = new Set(calls.filter((x) => /profile|\/me$/.test(x.path)).map((x) => x.key));
  check("each profile read ran on that mailbox's connection", [GMAIL_A.key, GMAIL_B.key, OUTLOOK_C.key].every((k) => profileKeys.has(k)), [...profileKeys].join(", "));

  // 2. Calendar calls run on the mailbox's calendar connection, not the grant's first one.
  calls.length = 0;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  await calendar.syncCalendar(await buildCtx(deps, b!, user!)).catch(() => undefined);
  const calKeys = new Set(calls.map((x) => x.key));
  check("B's calendar sync runs only on B's calendar connection", calls.length > 0 && calKeys.size === 1 && calKeys.has(GCAL_B.key), [...calKeys].join(", ") || "no calls");

  // 3. B leaves the grant and D joins: B pauses with its mail kept, D starts from A's settings.
  await db.update(schema.settings).set({ onboarded: true, timezone: "Asia/Qatar" }).where(eq(schema.settings.mailboxId, a!.id));
  grant = [GMAIL_A, OUTLOOK_C, GMAIL_D, GCAL_A, GCAL_B];
  await onConnected(deps, userId);
  await settle();
  const b2 = await byKey(GMAIL_B.key), d = await byKey(GMAIL_D.key), a2 = await byKey(GMAIL_A.key);
  check("an account that left the grant pauses", b2?.status === "paused", b2?.status);
  check("its row (and mail) is kept", b2?.id === b?.id);
  check("account A keeps the same mailbox", a2?.id === a?.id && a2?.status === "active");
  check("the new account gets its own mailbox", !!d && d.address === "side@gmail.example", d?.address ?? "none");
  const [ds] = d ? await db.select().from(schema.settings).where(eq(schema.settings.mailboxId, d.id)) : [];
  check("the new account starts from the first mailbox's settings, so it skips the wizard", ds?.onboarded === true && ds.timezone === "Asia/Qatar", `${ds?.onboarded} ${ds?.timezone}`);
  check("the new account never takes another address's calendar", d?.calendarConnectionKey == null, d?.calendarConnectionKey ?? "null");

  // 4. B is granted again with the same connection: the paused mailbox comes back.
  grant = [GMAIL_A, OUTLOOK_C, GMAIL_D, GMAIL_B, GCAL_A, GCAL_B];
  await onConnected(deps, userId);
  await settle();
  const b3 = await byKey(GMAIL_B.key);
  check("a re-granted account resumes in its old mailbox", b3?.id === b?.id && b3?.status === "active", b3?.status);
  check("and picks its calendar back up", b3?.calendarConnectionKey === GCAL_B.key, b3?.calendarConnectionKey ?? "null");
  check("still four mailboxes, no duplicates", (await live()).length === 4, String((await live()).length));

  // 5. The single-account era: one mailbox whose Gmail connection was made again (new key) keeps its mail.
  const solo2 = newId("usr");
  await db.insert(schema.users).values({ id: solo2 });
  await db.insert(schema.connectUsers).values({ userId: solo2, reference: "ref:cu_solo", connectUserId: "cu_solo" });
  const oldId = newId("mbx");
  await db.insert(schema.mailboxes).values({ id: oldId, userId: solo2, source: "live", mode: "connect", connectionKey: "live::gmail::default::old", mailProvider: "gmail", address: null, label: "Your Gmail" });
  grant = [{ platform: "gmail", key: "live::gmail::default::new", title: "Gmail" }];
  ADDRESS["live::gmail::default::new"] = "solo@gmail.example";
  whoamiUp = false; // another person: nothing to merge on
  await onConnected(deps, solo2);
  const soloRows = await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.userId, solo2));
  check("a single mailbox with a replaced connection is reused, not duplicated", soloRows.length === 1 && soloRows[0]!.id === oldId && soloRows[0]!.connectionKey === "live::gmail::default::new", `${soloRows.length}`);
} finally {
  await pool.end();
  const admin = new pg.Client(`${PG}/postgres`);
  await admin.connect();
  await admin.query(`drop database if exists "${NAME}" with (force)`);
  await admin.end();
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
