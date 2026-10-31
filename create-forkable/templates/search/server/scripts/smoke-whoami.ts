// Sign in with One on a stubbed grant (Rill's smoke-whoami pattern): the callback,
// whoami naming the account, the account merge by cu_, One user id and email,
// and one source per indexable connection x enabled built-in. No network, no
// Connect app, no keys: a tmp SEARCH_HOME and its own Postgres and server ports.
//
//   pnpm --filter @search/server smoke:whoami

// Must stay the first import: fails the run if it touches the repo's Connect ask or .env.
import "@search/core/test-guard";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { dbSchema, newId, type OneConnectKeyClient } from "@search/core";
import { onConnected } from "../src/connect.js";
import { startServer } from "../src/node.js";

const { users, sessions, connectUsers, sources } = dbSchema;
const PORT = Number(process.env.SMOKE_PORT ?? 52378);
const home = mkdtempSync(join(tmpdir(), "search-smoke-whoami-"));
let failures = 0, passed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail !== undefined ? `  (${JSON.stringify(detail)})` : ""}`);
};

const server = await startServer({ env: { HOME: home, PORT, PG_PORT: Number(process.env.SMOKE_PG_PORT ?? 55452), SECRETS: "file", ENV_DIR: home, UI_URL: undefined, ONE_CLIENT_ID: undefined }, serveUi: false, startScheduler: false, log: () => {} });
const { deps } = server;
const db = deps.db;
const kicked: { id: string; trigger: string }[] = [];
deps.scheduler.kick = async (id, opts) => { kicked.push({ id, trigger: opts.trigger }); return null; };

let whoamiStatus = 200;
const calls: string[] = [];
function stubGrant(cu: string, who = { id: "6f0c1d2e-0000-4000-8000-000000000001", name: "Dana Oyelaran", email: "Dana@Acme.com" }): OneConnectKeyClient {
  return {
    async fetch(_u: string, path: string) {
      calls.push(path);
      if (whoamiStatus !== 200) return new Response("{}", { status: whoamiStatus });
      if (path === "/users/me") return Response.json({ id: who.id, avatar: "https://lh3.example/dana.png", email: who.email, firstName: "Dana", lastName: "Oyelaran" });
      return Response.json({ user: who, organization: null, project: null });
    },
    async isConnected() { return true; },
    async listConnections() {
      return [
        { key: "live::gmail::default::abc", platform: "gmail", title: "dana@acme.com", access: { policy: "full" } },
        { key: "live::hubspot::default::def", platform: "hubspot", title: "Acme HubSpot", access: { policy: "full" } },
        { key: "live::anthropic::default::ghi", platform: "anthropic", title: "Anthropic", access: { policy: "full" } },
      ];
    },
    async runAction() { return { ok: true, status: 200, blockedByGrant: false, refusal: null, data: {} }; },
    getConnectUserId: async () => cu,
    async startAuthorization() { return { redirectUrl: "https://connect.withone.ai/authorize?stub=1", cookie: { name: "one_connect_tx", value: "tx", options: { httpOnly: true, secure: false, sameSite: "lax", maxAge: 600, path: "/" } } }; },
    async completeAuthorization(input: { userId: string }) {
      await db.insert(connectUsers).values({ userId: input.userId, reference: `ref:${cu}`, connectUserId: cu }).onConflictDoNothing();
      return { outcome: "connected", redirectUrl: "/?one_connect=success", clearCookieName: "one_connect_tx" };
    },
    async disconnect() {},
  } as unknown as OneConnectKeyClient;
}

async function signIn(cu: string, who?: Parameters<typeof stubGrant>[1], opts: { oauth?: boolean; reference?: string } = {}): Promise<{ fresh: string; result: Awaited<ReturnType<typeof onConnected>> }> {
  const fresh = newId("usr");
  await db.insert(users).values({ id: fresh });
  await db.insert(sessions).values({ sid: `sid_${fresh}`, userId: fresh });
  await db.insert(connectUsers).values({ userId: fresh, reference: opts.reference ?? `ref:${cu}`, connectUserId: cu });
  deps.oneConnect = stubGrant(cu, who);
  return { fresh, result: await onConnected(deps, fresh, { oauth: opts.oauth }) };
}

try {
  // 1. First sign-in.
  const a = await signIn("cu_one");
  const [u] = await db.select().from(users).where(eq(users.id, a.fresh));
  check("whoami names the account", u?.name === "Dana Oyelaran", u?.name);
  check("the account email is lowercased", u?.email === "dana@acme.com", u?.email);
  check("the picture comes from /users/me", u?.avatarUrl === "https://lh3.example/dana.png");
  check("whoami's id is stored as oneUserId", u?.oneUserId === "6f0c1d2e-0000-4000-8000-000000000001");
  check("whoami and /users/me were called without /v1", calls.includes("/users/whoami") && calls.includes("/users/me"), calls);
  const s1 = await db.select().from(sources).where(eq(sources.userId, a.fresh));
  const plats = [...new Set(s1.map((s) => s.platform))].sort();
  check("one source per indexable connection x enabled built-in", plats.join(",") === "gmail,hubspot" && s1.length >= 5, s1.map((s) => s.connectionKey));
  check("sources are connect mode on the grant's connection keys", s1.every((s) => s.mode === "connect" && s.connectionKey.startsWith("live::")));
  check("no source for an AI platform", !s1.some((s) => s.platform === "anthropic"));
  check("a first run was kicked for every source", s1.every((s) => kicked.some((k) => k.id === s.id && k.trigger === "first")), kicked.length);

  // 2. Second device, a new cu_, the same One user id: merged into the first account.
  kicked.length = 0;
  const b = await signIn("cu_two");
  check("the second device merges by One user id", b.result.merged && b.result.userId === a.fresh, b.result);
  check("the fresh user was deleted", (await db.select().from(users).where(eq(users.id, b.fresh))).length === 0);
  const sess = await db.select().from(sessions).where(eq(sessions.userId, a.fresh));
  check("both sessions point at the first account", sess.length === 2, sess.length);
  const s2 = await db.select().from(sources).where(eq(sources.userId, a.fresh));
  check("sources are not duplicated", s2.length === s1.length, s2.length);

  // 3. Same cu_ again (a third browser): merged by cu_.
  const c3 = await signIn("cu_one");
  check("merged by cu_", c3.result.merged && c3.result.userId === a.fresh);

  // 4. A different One user id with the same email: merged by email.
  const d = await signIn("cu_four", { id: "other-one-id", name: "Dana O.", email: "dana@acme.com" });
  check("merged by email", d.result.merged && d.result.userId === a.fresh, d.result);

  // 4b. A CLI or MCP sign-in (OAuth consent) merges into the account but keeps its grant reference (D41);
  // a web sign-in replaces it.
  const [before] = await db.select().from(connectUsers).where(eq(connectUsers.userId, a.fresh));
  const cli = await signIn("cu_one", undefined, { oauth: true, reference: "ref:cu_one;org=other-space" });
  const [kept] = await db.select().from(connectUsers).where(eq(connectUsers.userId, a.fresh));
  check("a CLI sign-in merges into the account", cli.result.merged && cli.result.userId === a.fresh, cli.result);
  check("a CLI sign-in keeps the account's grant reference", kept?.reference === before?.reference, { before: before?.reference, after: kept?.reference });
  check("the CLI sign-in's own reference row is gone", (await db.select().from(connectUsers).where(eq(connectUsers.userId, cli.fresh))).length === 0);
  const web = await signIn("cu_one", undefined, { reference: "ref:cu_one;org=web-space" });
  const [replaced] = await db.select().from(connectUsers).where(eq(connectUsers.userId, a.fresh));
  check("a web sign-in still replaces it", web.result.merged && replaced?.reference === "ref:cu_one;org=web-space", replaced?.reference);
  await db.update(connectUsers).set({ reference: before!.reference }).where(eq(connectUsers.userId, a.fresh));

  // 5. Someone else: a new account, its own sources.
  const e = await signIn("cu_five", { id: "mia-id", name: "Mia Park", email: "mia@acme.com" });
  check("another person gets their own account", !e.result.merged && e.result.userId === e.fresh);
  check("with their own sources", (await db.select().from(sources).where(eq(sources.userId, e.fresh))).length === s1.length);

  // 6. whoami down: no name, sources still made.
  whoamiStatus = 403;
  const f = await signIn("cu_six");
  const [uf] = await db.select().from(users).where(eq(users.id, f.fresh));
  check("whoami failing leaves the account unnamed", uf?.email == null && uf?.name == null);
  check("whoami failing never blocks the sources", (await db.select().from(sources).where(eq(sources.userId, f.fresh))).length === s1.length);
  whoamiStatus = 200;

  // 7. The HTTP legs: a sample session signing in gets a fresh account, the callback runs onConnected.
  const base = `http://127.0.0.1:${PORT}`;
  let cookie = "";
  const req = async (method: string, path: string) => {
    const res = await fetch(`${base}${path}`, { method, redirect: "manual", headers: cookie ? { cookie } : {} });
    for (const c of res.headers.getSetCookie()) if (c.startsWith("search_sid=")) cookie = c.split(";")[0]!;
    return res;
  };
  await req("POST", "/api/v1/sources/sample");
  const sid = cookie.split("=")[1]!;
  deps.oneConnect = stubGrant("cu_seven", { id: "theo-id", name: "Theo Lund", email: "theo@acme.com" });
  const auth = await req("GET", "/api/one/authorize");
  check("authorize redirects to One and sets the flow cookie", auth.status === 302 && auth.headers.get("location")?.startsWith("https://connect.withone.ai/") === true && auth.headers.getSetCookie().some((c) => c.startsWith("one_connect_tx=")));
  const [sess7] = await db.select().from(sessions).where(eq(sessions.sid, sid));
  check("a sample session signing in is moved off the shared sample user", !!sess7 && sess7.userId !== "usr_sample", sess7);
  const cb = await req("GET", "/api/one/callback?code=c&state=s");
  check("the callback redirects to the app", cb.status === 302 && cb.headers.get("location") === "/?one_connect=success", cb.headers.get("location"));
  const me = await (await req("GET", "/api/v1/me")).json() as { signedIn: boolean; user: { name: string; isSample: boolean } | null };
  check("after the callback the session is Theo, signed in, not the sample", me.signedIn && me.user?.name === "Theo Lund" && !me.user.isSample, me);
  const theoSources = await db.select().from(sources).where(and(eq(sources.userId, sess7!.userId)));
  check("the callback created Theo's sources", theoSources.length === s1.length, theoSources.length);
} catch (e) {
  failures++;
  console.log(`FAIL crashed: ${(e as Error).stack}`);
} finally {
  await server.stop();
  rmSync(home, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} failed, ${passed} passed` : `\nall ${passed} passed`);
process.exit(failures ? 1 : 0);
