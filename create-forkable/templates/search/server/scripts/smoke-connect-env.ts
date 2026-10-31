// Connect-from-code smoke: the real `pnpm connect` flow on fake values.
// A tmp .env holds what `one connect create` writes (client id, redirect URI,
// permission set, the two secrets empty); the client secret and Connect key are
// pasted on /setup/connect into a tmp store (file mode, never the Keychain,
// never ~/.search). Ids from .env win, secrets from the store fill in, and
// Sign in with One turns on without a restart.
//
//   pnpm --filter @search/server smoke:connect

// Must stay the first import: fails the run if it touches the repo's Connect ask or .env.
import "@search/core/test-guard";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/node.js";

const PORT = Number(process.env.SMOKE_PORT ?? 52383);
const home = mkdtempSync(join(tmpdir(), "search-smoke-connect-"));
const envDir = mkdtempSync(join(tmpdir(), "search-smoke-connect-env-"));
let failures = 0, passed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail !== undefined ? `  (${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 300)})` : ""}`);
};

// Fake values only. The redirect uses 127.0.0.1 so it differs from the default localhost one.
const CLIENT_ID = "oc_fake_smoke_client_7a1c";
const PERMISSION_SET = "00000000-fake-smoke-perm-0000000000ps";
const REDIRECT = `http://127.0.0.1:${PORT}/api/one/callback`;
const SECRET = "one_secret_fake_smoke_abcdefgh";
const KEY = "sk_live_fake_smoke_ijklmnop";
const writeEnv = (clientId: string) => writeFileSync(join(envDir, ".env"), [
  `ONE_CLIENT_ID=${clientId}`, `ONE_REDIRECT_URI=${REDIRECT}`, `ONE_PERMISSION_SET=${PERMISSION_SET}`, "ONE_CLIENT_SECRET=", "ONE_CONNECT_KEY=", "",
].join("\n"));
writeEnv(CLIENT_ID);

const server = await startServer({ env: { HOME: home, ENV_DIR: envDir, PORT, PG_PORT: Number(process.env.SMOKE_PG_PORT ?? 55457), SECRETS: "file", UI_URL: undefined }, serveUi: false, startScheduler: false, log: () => {} });
const base = `http://127.0.0.1:${PORT}`;
let cookie = "";
async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; text: string; headers: Headers }> {
  const res = await fetch(`${base}${path.startsWith("/api") ? path : `/api/v1${path}`}`, {
    method, redirect: "manual",
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), host: `localhost:${PORT}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = [...new Map([...cookie.split("; ").filter(Boolean), ...set.map((c) => c.split(";")[0]!)].map((kv) => [kv.split("=")[0], kv])).values()].join("; ");
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
}
const field = (r: { json: any }, name: string) => r.json.fields.find((f: any) => f.name === name);
const leaks = (text: string) => [SECRET, KEY, CLIENT_ID, PERMISSION_SET].some((v) => text.includes(v));

try {
  let r = await call("GET", "/me");
  check("before: Sign in with One is off", r.status === 200 && r.json.connect.configured === false && r.json.connect.signInUrl === null, r.json?.connect);

  r = await call("GET", "/setup/connect");
  check("setup shows the ids as set by .env", r.status === 200 && r.json.source === "env" && !r.json.configured
    && field(r, "ONE_CLIENT_ID").saved && field(r, "ONE_CLIENT_ID").where === "env" && field(r, "ONE_CLIENT_ID").last4 === "7a1c"
    && field(r, "ONE_PERMISSION_SET").saved && field(r, "ONE_PERMISSION_SET").where === "env", r.json);
  check("setup asks only for the two secrets", !field(r, "ONE_CLIENT_SECRET").saved && !field(r, "ONE_CONNECT_KEY").saved, r.json?.fields);
  check("setup uses the .env redirect URI", r.json.redirectUri === REDIRECT, r.json.redirectUri);
  check("setup never returns a full value", !leaks(r.text));

  r = await call("POST", "/setup/connect", { ONE_CLIENT_ID: "oc_some_other_app_9999" });
  check("a different client id than .env is refused", r.status === 409 && r.json.error.code === "conflict", r.json);

  r = await call("POST", "/setup/connect", { ONE_CLIENT_SECRET: SECRET });
  check("one secret alone: still off", r.status === 200 && !r.json.configured && field(r, "ONE_CLIENT_SECRET").saved && field(r, "ONE_CLIENT_SECRET").where === "file", r.json);
  check("still off on /me", (await call("GET", "/me")).json.connect.signInUrl === null);

  r = await call("POST", "/setup/connect", { ONE_CONNECT_KEY: KEY });
  check("both secrets saved: configured, ids still from .env", r.status === 200 && r.json.configured && r.json.source === "env" && field(r, "ONE_CLIENT_ID").where === "env" && field(r, "ONE_CONNECT_KEY").last4 === "mnop", r.json);
  check("save response never returns a full value", !leaks(r.text));

  r = await call("GET", "/me");
  check("after: Sign in with One is on without a restart", r.json.connect.configured === true && r.json.connect.signInUrl === "/api/one/authorize", r.json?.connect);

  r = await call("GET", "/api/one/authorize");
  const loc = r.headers.get("location") ?? "";
  let u: URL | null = null;
  try { u = new URL(loc); } catch { /* not a url */ }
  check("authorize redirects to One", r.status === 302 && u?.protocol === "https:", loc.slice(0, 80));
  check("authorize uses the .env redirect URI", u?.searchParams.get("redirect_uri") === REDIRECT, u?.searchParams.get("redirect_uri"));
  check("authorize uses the .env client id", u?.searchParams.get("client_id") === CLIENT_ID);
  check("authorize never carries a secret", !loc.includes(SECRET) && !loc.includes(KEY));

  // `pnpm connect` again for a NEW app: the old secrets belong to the old app, so ask again.
  writeEnv("oc_fake_smoke_newapp_42b9");
  r = await call("GET", "/setup/connect");
  check("a new app in .env needs its own secrets", r.status === 200 && !r.json.configured && field(r, "ONE_CLIENT_ID").last4 === "42b9" && !field(r, "ONE_CLIENT_SECRET").saved && !field(r, "ONE_CONNECT_KEY").saved, r.json);
  check("and sign-in turns off with it", (await call("GET", "/me")).json.connect.signInUrl === null);
  writeEnv(CLIENT_ID);
  r = await call("GET", "/setup/connect");
  check("back to the first app: its stored secrets apply again", r.json.configured === true, r.json);

  r = await call("DELETE", "/setup/connect/ONE_CONNECT_KEY");
  check("removing the Connect key turns sign-in off", r.status === 200 && !r.json.configured && (await call("GET", "/me")).json.connect.signInUrl === null);
} catch (e) {
  failures++;
  console.log(`FAIL crashed: ${(e as Error).stack}`);
} finally {
  await server.stop();
  rmSync(home, { recursive: true, force: true });
  rmSync(envDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failed, ${passed} passed` : `\nall ${passed} passed`);
process.exit(failures ? 1 : 0);
