// OAuth smoke (SPEC 19, Phase 3): metadata, DCR (public and confidential), /authorize
// with the pending cookie and the consent page, Sign in with One on a stubbed grant,
// the code, PKCE, the token, bearer on /api/v1 and /mcp with scopes, refresh rotation,
// reuse revoking the family, /revoke, Settings -> API revoke, expiry, deny, the sample
// identity. A tmp SEARCH_HOME, its own Postgres and server ports; no network, no keys.
//
//   pnpm --filter @search/server smoke:oauth

// Must stay the first import: fails the run if it touches the repo's Connect ask or .env.
import "@search/core/test-guard";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { dbSchema, type OneConnectKeyClient } from "@search/core";
import { startServer } from "../src/node.js";

const { connectUsers, oauthClients, oauthTokens, oauthPending, users } = dbSchema;
const PORT = Number(process.env.SMOKE_PORT ?? 52379);
const home = mkdtempSync(join(tmpdir(), "search-smoke-oauth-"));
let failures = 0, passed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail !== undefined ? `  (${typeof detail === "string" ? detail : JSON.stringify(detail)?.slice(0, 300)})` : ""}`);
};

const server = await startServer({ env: { HOME: home, PORT, PG_PORT: Number(process.env.SMOKE_PG_PORT ?? 55453), SECRETS: "file", ENV_DIR: home, UI_URL: undefined, ONE_CLIENT_ID: undefined, PUBLIC_URL: `http://localhost:${PORT}` }, serveUi: false, startScheduler: false, log: () => {} });
const { deps } = server;
const db = deps.db;
deps.scheduler.kick = async () => null;
const base = `http://localhost:${PORT}`;

function stubGrant(cu: string, who: { id: string; name: string; email: string }): OneConnectKeyClient {
  return {
    async fetch(_u: string, path: string) {
      if (path === "/users/me") return Response.json({ id: who.id, email: who.email, firstName: who.name.split(" ")[0], lastName: who.name.split(" ")[1] });
      return Response.json({ user: who });
    },
    async isConnected() { return true; },
    async listConnections() { return [{ key: "live::gmail::default::abc", platform: "gmail", title: who.email, access: { policy: "full" } }]; },
    async runAction() { return { ok: true, status: 200, blockedByGrant: false, refusal: null, data: {} }; },
    getConnectUserId: async () => cu,
    async startAuthorization() { return { redirectUrl: "https://connect.withone.ai/authorize?stub=1", cookie: { name: "one_connect_tx", value: "tx", options: { httpOnly: true, secure: false, sameSite: "lax", maxAge: 600, path: "/" } } }; },
    async completeAuthorization(input: { userId: string; url: string }) {
      if (new URL(input.url).searchParams.get("error")) return { outcome: "denied", redirectUrl: "/?one_connect=denied", clearCookieName: "one_connect_tx" };
      await db.insert(connectUsers).values({ userId: input.userId, reference: `ref:${cu}`, connectUserId: cu }).onConflictDoNothing();
      return { outcome: "connected", redirectUrl: "/?one_connect=success", clearCookieName: "one_connect_tx" };
    },
    async disconnect() {},
  } as unknown as OneConnectKeyClient;
}

/** A tiny browser: one cookie jar, manual redirects. */
class Browser {
  jar = new Map<string, string>();
  async go(method: string, url: string, body?: Record<string, string>): Promise<Response> {
    const headers: Record<string, string> = {};
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (body) { headers["content-type"] = "application/x-www-form-urlencoded"; headers.origin = base; }
    const res = await fetch(url.startsWith("http") ? url : `${base}${url}`, { method, redirect: "manual", headers, body: body ? new URLSearchParams(body).toString() : undefined });
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(";");
      const [k, v] = [kv!.slice(0, kv!.indexOf("=")), kv!.slice(kv!.indexOf("=") + 1)];
      if (!v || attrs.some((a) => /max-age=0\b/i.test(a.trim()) || /expires=Thu, 01 Jan 1970/i.test(a.trim()))) this.jar.delete(k); else this.jar.set(k, v);
    }
    return res;
  }
}

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};
const post = async (path: string, body: Record<string, string> | object, json = false, headers: Record<string, string> = {}) => {
  const res = await fetch(`${base}${path}`, {
    method: "POST", headers: { "content-type": json ? "application/json" : "application/x-www-form-urlencoded", ...headers },
    body: json ? JSON.stringify(body) : new URLSearchParams(body as Record<string, string>).toString(),
  });
  const text = await res.text();
  let j: any = null; try { j = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json: j, headers: res.headers };
};
const api = async (path: string, token: string, init: RequestInit = {}) => {
  const res = await fetch(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  const text = await res.text();
  let j: any = null; try { j = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json: j, headers: res.headers, setCookie: res.headers.getSetCookie() };
};
const mcp = (token: string, body: unknown) => fetch(`${base}/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify(body) });

try {
  // 1. Discovery
  let r = await fetch(`${base}/.well-known/oauth-authorization-server`);
  const meta = await r.json() as any;
  check("AS metadata: issuer, S256, public clients, endpoints", meta.issuer === base && meta.code_challenge_methods_supported.join() === "S256" && meta.token_endpoint_auth_methods_supported.includes("none") && meta.registration_endpoint === `${base}/register` && meta.revocation_endpoint === `${base}/revoke`, meta);
  r = await fetch(`${base}/.well-known/oauth-protected-resource`);
  const prm = await r.json() as any;
  check("protected resource metadata names /mcp and this server", prm.resource === `${base}/mcp` && prm.authorization_servers[0] === base, prm);
  r = await fetch(`${base}/.well-known/oauth-protected-resource/api/v1`);
  check("protected resource metadata for /api/v1", ((await r.json()) as any).resource === `${base}/api/v1`);
  r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  check("POST /mcp with no token is 401 with resource_metadata", r.status === 401 && /resource_metadata="http:\/\/localhost:\d+\/\.well-known\/oauth-protected-resource\/mcp"/.test(r.headers.get("www-authenticate") ?? ""), r.headers.get("www-authenticate"));
  r = await fetch(`${base}/api/v1/search?q=globex`, { headers: { authorization: "Bearer nope" } });
  check("REST with a bad token is 401 unauthorized + WWW-Authenticate", r.status === 401 && ((await r.json()) as any).error.code === "unauthorized" && !!r.headers.get("www-authenticate") && !r.headers.getSetCookie().some((c) => c.startsWith("search_sid=")));

  // 2. DCR
  let reg = await post("/register", { client_name: "Search CLI test", redirect_uris: ["http://127.0.0.1/callback"], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: "search:read search:ask sources:write account:read" }, true);
  const pub = reg.json;
  check("DCR public client: 201, no secret", reg.status === 201 && !!pub.client_id && !pub.client_secret && pub.token_endpoint_auth_method === "none", reg.json);
  reg = await post("/register", { client_name: "Script", redirect_uris: ["https://example.com/cb"] }, true);
  const conf = reg.json;
  const [confRow] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, conf.client_id));
  check("DCR confidential client: secret returned once, stored as SHA-256 only", reg.status === 201 && typeof conf.client_secret === "string" && confRow?.clientSecretHash === createHash("sha256").update(conf.client_secret).digest("hex") && !JSON.stringify(confRow).includes(conf.client_secret), reg.json);
  reg = await post("/register", { client_name: "Bad", redirect_uris: ["http://evil.example/cb"] }, true);
  check("DCR refuses a plain http redirect off loopback", reg.status === 400 && reg.json.error === "invalid_client_metadata", reg.json);

  // 3. /authorize: consent page and pending cookie (RFC 8252 loopback: any port)
  const b = new Browser();
  const p1 = pkce();
  const redirectUri = "http://127.0.0.1:48123/callback";
  const authUrl = `/authorize?${new URLSearchParams({ response_type: "code", client_id: pub.client_id, redirect_uri: redirectUri, code_challenge: p1.challenge, code_challenge_method: "S256", state: "st-1", scope: "search:read search:ask sources:write account:read", resource: `${base}/api/v1` })}`;
  r = await b.go("GET", authUrl);
  const page = await r.text();
  check("GET /authorize renders the consent page naming the client", r.status === 200 && page.includes("Search CLI test") && page.includes("Use the Acme sample") && page.includes("127.0.0.1:48123"), page.slice(0, 200));
  check("GET /authorize sets search_oauth_pending", b.jar.has("search_oauth_pending"));
  const pendingId = b.jar.get("search_oauth_pending")!;
  const [pend] = await db.select().from(oauthPending).where(eq(oauthPending.id, pendingId));
  check("the pending row holds client, redirect, challenge, scopes, resource", pend?.clientId === pub.client_id && pend.redirectUri === redirectUri && pend.codeChallenge === p1.challenge && pend.scopes.length === 4 && pend.resource === `${base}/api/v1`, pend);
  r = await b.go("GET", authUrl.replace("S256", "plain"));
  check("plain PKCE is refused", r.status === 302 && /error=invalid_request/.test(r.headers.get("location") ?? ""), r.headers.get("location"));
  r = await new Browser().go("POST", "/oauth/consent", { pending: pendingId, action: "sample" });
  check("consent without the pending cookie is refused", r.status === 400);

  // 4. Continue with One -> stubbed Connect callback -> code
  deps.oneConnect = stubGrant("cu_theo", { id: "theo-id", name: "Theo Lund", email: "theo@acme.com" });
  r = await b.go("POST", "/oauth/consent", { pending: pendingId, action: "one" });
  check("Continue with One goes to the Connect sign-in", r.status === 302 && r.headers.get("location") === "/api/one/authorize?oauth=1", r.headers.get("location"));
  r = await b.go("GET", r.headers.get("location")!);
  check("which redirects to One and keeps the pending cookie", r.status === 302 && r.headers.get("location")!.startsWith("https://connect.withone.ai/") && b.jar.has("search_oauth_pending") && b.jar.has("one_connect_tx"));
  r = await b.go("GET", "/api/one/callback?code=one-code&state=one-state");
  const loc = new URL(r.headers.get("location") ?? "http://x/");
  check("the callback redirects to the client with code, state and iss", r.status === 302 && loc.origin + loc.pathname === redirectUri && !!loc.searchParams.get("code") && loc.searchParams.get("state") === "st-1" && loc.searchParams.get("iss") === base, loc.toString());
  check("the pending row and cookie are gone", !b.jar.has("search_oauth_pending") && (await db.select().from(oauthPending).where(eq(oauthPending.id, pendingId))).length === 0);
  const code = loc.searchParams.get("code")!;

  // 5. Token
  let t = await post("/token", { grant_type: "authorization_code", client_id: pub.client_id, code, code_verifier: pkce().verifier, redirect_uri: redirectUri });
  check("a wrong code_verifier is invalid_grant", t.status === 400 && t.json.error === "invalid_grant", t.json);
  t = await post("/token", { grant_type: "authorization_code", client_id: pub.client_id, code, code_verifier: p1.verifier, redirect_uri: "http://127.0.0.1:1/other" });
  check("a different redirect_uri is invalid_grant", t.status === 400 && t.json.error === "invalid_grant", t.json);
  t = await post("/token", { grant_type: "authorization_code", client_id: pub.client_id, code, code_verifier: p1.verifier, redirect_uri: redirectUri });
  // (the redirect_uri mismatch consumed the code: single use means a failed exchange after PKCE also burns it)
  if (t.status !== 200) {
    // run the flow again for a clean code
    const p2 = pkce();
    const b2 = new Browser();
    await b2.go("GET", authUrl.replace(p1.challenge, p2.challenge));
    const pid = b2.jar.get("search_oauth_pending")!;
    await b2.go("POST", "/oauth/consent", { pending: pid, action: "one" });
    await b2.go("GET", "/api/one/authorize?oauth=1");
    const cb = await b2.go("GET", "/api/one/callback?code=c&state=s");
    const c2 = new URL(cb.headers.get("location")!).searchParams.get("code")!;
    check("a code burnt by a bad exchange stays burnt", true);
    t = await post("/token", { grant_type: "authorization_code", client_id: pub.client_id, code: c2, code_verifier: p2.verifier, redirect_uri: redirectUri });
  }
  const tok = t.json;
  check("token: Bearer access (1 h) and refresh with the four scopes", t.status === 200 && tok.token_type === "Bearer" && tok.expires_in === 3600 && tok.access_token.startsWith("sat_") && tok.refresh_token.startsWith("srt_") && tok.scope.split(" ").length === 4, tok);
  check("token responses are no-store", t.headers.get("cache-control") === "no-store");
  t = await post("/token", { grant_type: "authorization_code", client_id: pub.client_id, code, code_verifier: p1.verifier, redirect_uri: redirectUri });
  check("a code is single use", t.status === 400 && t.json.error === "invalid_grant");
  const stored = await db.select().from(oauthTokens);
  check("tokens are stored as SHA-256 only", stored.length >= 2 && !stored.some((s) => s.tokenHash === tok.access_token || s.tokenHash === tok.refresh_token));

  // 6. Bearer on REST
  let a = await api("/api/v1/me", tok.access_token);
  check("bearer /me is Theo (whoami on the stub)", a.status === 200 && a.json.signedIn && a.json.user.name === "Theo Lund" && !a.json.user.isSample, a.json);
  check("a bearer request gets no session cookie", !a.setCookie.some((c) => c.startsWith("search_sid=")));
  a = await api("/api/v1/search?q=globex", tok.access_token);
  check("bearer GET /search answers", a.status === 200 && typeof a.json.total === "number", a.json);
  a = await api("/api/v1/settings", tok.access_token, { method: "PUT", body: "{}", headers: { "content-type": "application/json" } });
  check("cookie-only routes refuse a bearer (403 forbidden)", a.status === 403 && a.json.error.code === "forbidden", a.json);
  r = await mcp(tok.access_token, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  check("a token for /api/v1 is refused on /mcp", r.status === 401);

  // 7. Refresh rotation and reuse
  t = await post("/token", { grant_type: "refresh_token", client_id: pub.client_id, refresh_token: tok.refresh_token });
  const tok2 = t.json;
  check("refresh rotates: a new access and a new refresh token", t.status === 200 && tok2.refresh_token !== tok.refresh_token && tok2.access_token !== tok.access_token, t.json);
  a = await api("/api/v1/me", tok2.access_token);
  check("the new access token works", a.status === 200 && a.json.user?.name === "Theo Lund");
  t = await post("/token", { grant_type: "refresh_token", client_id: pub.client_id, refresh_token: tok2.refresh_token, scope: "search:read sources:write account:read search:ask admin" });
  check("a refresh cannot widen scopes", t.status === 400 && t.json.error === "invalid_scope", t.json);
  t = await post("/token", { grant_type: "refresh_token", client_id: pub.client_id, refresh_token: tok.refresh_token });
  check("reusing the rotated refresh token is invalid_grant", t.status === 400 && t.json.error === "invalid_grant", t.json);
  a = await api("/api/v1/me", tok2.access_token);
  check("reuse revoked the whole family: the newest access token is 401", a.status === 401 && a.json.error.code === "unauthorized", a.json);
  t = await post("/token", { grant_type: "refresh_token", client_id: pub.client_id, refresh_token: tok2.refresh_token });
  check("and the newest refresh token is dead too", t.status === 400 && t.json.error === "invalid_grant");

  // 8. The sample identity, MCP default scopes, /mcp
  const b3 = new Browser();
  const p3 = pkce();
  r = await b3.go("GET", `/authorize?${new URLSearchParams({ response_type: "code", client_id: pub.client_id, redirect_uri: "http://127.0.0.1:51000/callback", code_challenge: p3.challenge, code_challenge_method: "S256", state: "st-3", resource: `${base}/mcp` })}`);
  r = await b3.go("POST", "/oauth/consent", { pending: b3.jar.get("search_oauth_pending")!, action: "sample" });
  const loc3 = new URL(r.headers.get("location") ?? "http://x/");
  check("Use the Acme sample mints a code straight away", r.status === 302 && !!loc3.searchParams.get("code") && loc3.searchParams.get("state") === "st-3", loc3.toString());
  t = await post("/token", { grant_type: "authorization_code", client_id: pub.client_id, code: loc3.searchParams.get("code")!, code_verifier: p3.verifier, redirect_uri: "http://127.0.0.1:51000/callback", resource: `${base}/mcp` });
  const mt = t.json;
  check("an MCP resource with no scope gets search:read search:ask", t.status === 200 && mt.scope === "search:read search:ask", t.json);
  r = await mcp(mt.access_token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });
  const init = await r.json() as any;
  check("POST /mcp initialize with a token", r.status === 200 && init.result?.serverInfo?.name === "search" && /operators/.test(init.result?.instructions ?? ""), init);
  r = await mcp(mt.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = ((await r.json()) as any).result?.tools?.map((x: any) => x.name).sort();
  check("tools/list has the five read-only tools", tools?.join() === "ask,fetch,get_entity,list_sources,search", tools);
  r = await mcp(mt.access_token, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search", arguments: { query: "globex", limit: 3 } } });
  const sr = ((await r.json()) as any).result;
  check("tools/call search on the sample", sr?.structuredContent?.results?.length === 3 && !sr.isError, sr);
  a = await api("/api/v1/search?q=globex", mt.access_token);
  check("an MCP token is refused on /api/v1", a.status === 401);

  // 9. Scope enforcement on REST (a read-only token)
  const b4 = new Browser();
  const p4 = pkce();
  await b4.go("GET", `/authorize?${new URLSearchParams({ response_type: "code", client_id: pub.client_id, redirect_uri: redirectUri, code_challenge: p4.challenge, code_challenge_method: "S256", scope: "search:read", resource: `${base}/api/v1` })}`);
  r = await b4.go("POST", "/oauth/consent", { pending: b4.jar.get("search_oauth_pending")!, action: "sample" });
  t = await post("/token", { grant_type: "authorization_code", client_id: pub.client_id, code: new URL(r.headers.get("location")!).searchParams.get("code")!, code_verifier: p4.verifier, redirect_uri: redirectUri });
  const ro = t.json.access_token as string;
  a = await api("/api/v1/search?q=globex", ro);
  check("a search:read token can search the sample", a.status === 200 && a.json.total > 0, a.json?.total);
  a = await api("/api/v1/answer", ro, { method: "POST", body: JSON.stringify({ q: "where are we with globex?" }), headers: { "content-type": "application/json" } });
  check("but not ask (403 insufficient_scope)", a.status === 403 && a.json.error.code === "insufficient_scope" && a.json.error.data.required === "search:ask", a.json);

  // 10. Expiry
  await db.update(oauthTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(oauthTokens.tokenHash, createHash("sha256").update(ro).digest("hex")));
  a = await api("/api/v1/search?q=globex", ro);
  check("an expired access token is 401 token_expired", a.status === 401 && a.json.error.code === "token_expired" && /invalid_token/.test(a.headers.get("www-authenticate") ?? ""), a.json);

  // 11. /revoke (RFC 7009 form body)
  r = await fetch(`${base}/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: pub.client_id, token: mt.refresh_token, token_type_hint: "refresh_token" }).toString() });
  check("POST /revoke (form) answers 200", r.status === 200);
  r = await mcp(mt.access_token, { jsonrpc: "2.0", id: 4, method: "tools/list" });
  check("revoking the refresh token ends its access token too (401)", r.status === 401);

  // 12. Confidential client auth
  t = await post("/token", { grant_type: "refresh_token", client_id: conf.client_id, client_secret: "wrong", refresh_token: "srt_x" });
  check("a wrong client_secret is 401 invalid_client", t.status === 401 && t.json.error === "invalid_client", t.json);
  t = await post("/token", { grant_type: "refresh_token", client_id: conf.client_id, client_secret: conf.client_secret, refresh_token: "srt_x" });
  check("the right secret passes client auth (then invalid_grant for the made-up token)", t.status === 400 && t.json.error === "invalid_grant", t.json);

  // 13. Deny, and a web sign-in dropping an abandoned request
  const b5 = new Browser();
  await b5.go("GET", authUrl);
  r = await b5.go("POST", "/oauth/consent", { pending: b5.jar.get("search_oauth_pending")!, action: "deny" });
  const loc5 = new URL(r.headers.get("location") ?? "http://x/");
  check("Cancel returns error=access_denied with the state", loc5.searchParams.get("error") === "access_denied" && loc5.searchParams.get("state") === "st-1", loc5.toString());
  const b6 = new Browser();
  await b6.go("GET", authUrl);
  await b6.go("GET", "/api/one/authorize");
  check("a plain web sign-in clears an abandoned pending cookie", !b6.jar.has("search_oauth_pending"));
  const b7 = new Browser();
  await b7.go("GET", authUrl);
  await db.update(oauthPending).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(oauthPending.id, b7.jar.get("search_oauth_pending")!));
  r = await b7.go("POST", "/oauth/consent", { pending: b7.jar.get("search_oauth_pending")!, action: "sample" });
  check("an expired pending request cannot be completed", r.status === 400 && (await r.text()).includes("expired"));

  // 14. Signed-in browser: Continue as, then Settings -> API lists and revokes
  const b8 = new Browser();
  await b8.go("POST", "/api/v1/sources/sample");
  const p8 = pkce();
  r = await b8.go("GET", `/authorize?${new URLSearchParams({ response_type: "code", client_id: pub.client_id, redirect_uri: redirectUri, code_challenge: p8.challenge, code_challenge_method: "S256", resource: `${base}/api/v1` })}`);
  check("a signed-in browser sees Continue as Dana", (await r.text()).includes("Continue as Dana Oyelaran"));
  r = await b8.go("POST", "/oauth/consent", { pending: b8.jar.get("search_oauth_pending")!, action: "allow" });
  t = await post("/token", { grant_type: "authorization_code", client_id: pub.client_id, code: new URL(r.headers.get("location")!).searchParams.get("code")!, code_verifier: p8.verifier, redirect_uri: redirectUri });
  const dana = t.json.access_token as string;
  check("allow mints a code for the signed-in user", t.status === 200 && (await api("/api/v1/me", dana)).json.user.name === "Dana Oyelaran");
  r = await b8.go("GET", "/api/v1/oauth-clients");
  const list = await r.json() as any[];
  const row = list.find((x) => x.clientId === pub.client_id);
  check("GET /oauth-clients lists the client with its active tokens", r.status === 200 && row?.name === "Search CLI test" && row.activeTokens >= 1 && !!row.lastUsedAt, list);
  a = await api("/api/v1/oauth-clients", dana);
  check("GET /oauth-clients is cookie only", a.status === 403);
  r = await b8.go("DELETE", `/api/v1/oauth-clients/${pub.client_id}`);
  check("DELETE /oauth-clients/:id answers 204", r.status === 204);
  a = await api("/api/v1/me", dana);
  check("after Settings revoke the token is 401", a.status === 401);
  r = await b8.go("GET", "/api/v1/oauth-clients");
  check("and the client shows 0 active tokens", ((await r.json()) as any[]).find((x) => x.clientId === pub.client_id)?.activeTokens === 0);
  const [theo] = await db.select().from(users).where(eq(users.name, "Theo Lund"));
  check("the One sign-in made Theo's account", !!theo && !theo.isSample);
} catch (e) {
  failures++;
  console.log(`FAIL crashed: ${(e as Error).stack}`);
} finally {
  await server.stop();
  rmSync(home, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} failed, ${passed} passed` : `\nall ${passed} passed`);
process.exit(failures ? 1 : 0);
