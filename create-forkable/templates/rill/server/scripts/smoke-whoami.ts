// Smoke test for the Sign in with One callback: whoami names the account,
// Gmail's profile names the mailbox, and a second device merges into the
// first account. A stubbed grant, no network, no keys. Needs a Postgres:
// the embedded one Rill already runs (~/.rill/db), into a scratch database
// that is dropped at the end. Run: pnpm exec tsx scripts/smoke-whoami.ts
import pg from "pg";
import { eq } from "drizzle-orm";
import { createDb, ensureDatabase, newId, runMigrations, schema } from "@rill/core";
import type { OneConnectClient } from "@withone/connect/server";
import { loadEnv } from "../src/config.js";
import { onConnected } from "../src/connect.js";
import type { Deps } from "../src/deps.js";
import { createHub } from "../src/events.js";

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

// The One account is moe@acme.example; the Gmail it grants is a different address.
const calls: string[] = [];
let whoamiStatus = 200;
function stubGrant(cu: string): OneConnectClient {
  return {
    async fetch(_userId: string, path: string) {
      calls.push(`fetch ${path}`);
      if (whoamiStatus !== 200) return new Response("{}", { status: whoamiStatus });
      if (path === "/users/me") return Response.json({ id: "6f0c1d2e-0000-4000-8000-000000000001", avatar: "https://lh3.example/dana.png", email: "dana@acme.example", firstName: "Dana", lastName: "Reyes" });
      return Response.json({ user: { id: "6f0c1d2e-0000-4000-8000-000000000001", name: "Dana Reyes", email: "Dana@Acme.example" }, organization: null, project: null });
    },
    async listConnections() {
      return [{ platform: "gmail", key: "live::gmail::default::abc", title: "Dana's Gmail" }];
    },
    async isConnected() { return true; },
    async runAction(_userId: string, req: { path: string }) {
      calls.push(`runAction ${req.path}`);
      return { ok: true, status: 200, blockedByGrant: false, refusal: null, data: { emailAddress: "Dana.Reyes@gmail.example", historyId: "1" } };
    },
    getConnectUserId: () => cu,
  } as unknown as OneConnectClient;
}

const kicked: string[] = [];
const env = loadEnv();
const deps = (cu: string): Deps => ({
  db, env, oneConnect: stubGrant(cu), hub: createHub(), connectSetup: null, version: "smoke",
  scheduler: { kick: async (id: string) => { kicked.push(id); } } as unknown as Deps["scheduler"],
  dbInfo: { kind: "external", url: "smoke", dataDir: null },
});

async function signIn(cu: string): Promise<string> {
  const userId = newId("usr");
  await db.insert(schema.users).values({ id: userId });
  await db.insert(schema.sessions).values({ sid: newId("sid"), userId });
  await db.insert(schema.connectUsers).values({ userId, reference: `ref:${cu}`, connectUserId: cu });
  await onConnected(deps(cu), userId);
  return userId;
}

try {
  // 1. First sign-in.
  const first = await signIn("cu_one");
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, first));
  check("whoami names the account", u?.name === "Dana Reyes", u?.name ?? "null");
  check("whoami's email is the account email, lowercased", u?.email === "dana@acme.example", u?.email ?? "null");
  check("the profile picture comes from /v1/users/me", u?.avatarUrl === "https://lh3.example/dana.png", u?.avatarUrl ?? "null");
  check("whoami's id is stored as oneUserId", u?.oneUserId === "6f0c1d2e-0000-4000-8000-000000000001");
  const [m] = await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.userId, first));
  check("the mailbox address comes from Gmail's profile, not the account", m?.address === "dana.reyes@gmail.example", m?.address ?? "null");
  check("the mailbox label follows the address", m?.label === "dana.reyes@gmail.example", m?.label);
  check("whoami and the Gmail profile were both called", calls.includes("fetch /users/whoami") && calls.includes("runAction /gmail/v1/users/me/profile"), calls.join(", "));
  const [ledgerRow] = await db.select().from(schema.ledger).where(eq(schema.ledger.mailboxId, m!.id));
  check("the profile read is on the Activity record", ledgerRow?.action === "get-profile" && ledgerRow.level === "read", ledgerRow?.action);
  const [s] = await db.select().from(schema.settings).where(eq(schema.settings.mailboxId, m!.id));
  check("settings.me starts as the whoami name", s?.me === "Dana Reyes", s?.me ?? "null");
  check("a first sync was kicked", kicked.includes(m!.id));

  // 2. Same person, second device, a different cu_ (a new Connect user): merged by One user id.
  const second = await signIn("cu_two");
  const [gone] = await db.select().from(schema.users).where(eq(schema.users.id, second));
  check("the second device's fresh user was merged away", !gone);
  const sessions = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, first));
  check("both sessions now point at the first account", sessions.length === 2, String(sessions.length));
  const mailboxes = await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.userId, first));
  check("still one live mailbox", mailboxes.filter((x) => x.mode === "connect").length === 1, String(mailboxes.length));

  // 3. whoami down: the mailbox still gets its Gmail address; the account just stays unnamed.
  whoamiStatus = 403;
  const third = await signIn("cu_three");
  const [u3] = await db.select().from(schema.users).where(eq(schema.users.id, third));
  const [m3] = await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.userId, third));
  check("whoami failing leaves the account email empty", u3?.email == null);
  check("whoami failing never blocks the mailbox", m3?.address === "dana.reyes@gmail.example", m3?.address ?? "null");
} finally {
  await pool.end();
  const admin = new pg.Client(`${PG}/postgres`);
  await admin.connect();
  await admin.query(`drop database if exists "${NAME}" with (force)`);
  await admin.end();
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
