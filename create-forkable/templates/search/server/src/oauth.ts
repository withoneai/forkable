// The OAuth 2.1 authorization server for the CLI, scripts and MCP clients (SPEC 4.9,
// 16.2). Clients, pending requests, codes and tokens live in Postgres; every secret
// is stored as SHA-256 and compared in constant time. Sign in with One (or the Acme
// sample) is the only login step behind /authorize.
//
// From @hono/mcp we use the request validation pieces: authorizeHandler (client,
// redirect URI incl. RFC 8252 loopback ports, S256, scope), tokenHandler (PKCE
// check, grant dispatch) and clientRegistrationHandler (RFC 7591). We replace three
// parts on purpose:
//   - client authentication: @hono/mcp compares client_secret in plain text against
//     getClient(), which would mean storing secrets; ours compares SHA-256 hashes.
//     Public clients (token_endpoint_auth_method "none") pass with no secret.
//   - /revoke: @hono/mcp reads only a JSON body; RFC 7009 clients send a form.
//   - metadata: @hono/mcp advertises only client_secret_post; we add "none".
// Rate limits are off (local server on 127.0.0.1; hono-rate-limiter is not installed).

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { and, eq, isNull, sql } from "drizzle-orm";
import { authorizeHandler, clientRegistrationHandler, tokenHandler } from "@hono/mcp/auth";
import { InvalidClientError, InvalidClientMetadataError, InvalidGrantError, InvalidRequestError, InvalidScopeError, InvalidTargetError, OAuthError, ServerError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { dbSchema, type Db } from "@search/core";
import type { AppEnv, Deps, UserRow } from "./deps.js";
import { consentPage, messagePage } from "./oauth-pages.js";
import { bootstrapSample, SAMPLE_USER } from "./sample.js";
import { bindSid, isSecure, signedInUser } from "./session.js";

const { oauthClients, oauthPending, oauthCodes, oauthTokens, users } = dbSchema;

export const SCOPES = ["search:read", "search:ask", "sources:write", "account:read"] as const;
export type Scope = (typeof SCOPES)[number];
/** CONTRACT 6.3: MCP clients get read + ask unless they ask for more; the CLI asks for all four. */
export const MCP_DEFAULT_SCOPES: Scope[] = ["search:read", "search:ask"];
export const PENDING_COOKIE = "search_oauth_pending";

const PENDING_TTL = 10 * 60_000;
const CODE_TTL = 60_000;
const ACCESS_TTL = 60 * 60_000;
const REFRESH_TTL = 30 * 24 * 60 * 60_000;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const localId = (prefix: string) => `${prefix}_${randomBytes(12).toString("hex")}`;
const token = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;
function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------- resources (RFC 8707) ----------

/** The origins this server answers as: SEARCH_PUBLIC_URL plus the loopback aliases of its port. */
export function origins(deps: Deps): string[] {
  const pub = new URL(deps.env.PUBLIC_URL).origin;
  return [...new Set([pub, `http://localhost:${deps.env.PORT}`, `http://127.0.0.1:${deps.env.PORT}`])];
}

/** "mcp" | "api" | "root" for a resource URL this server owns, else null. */
export function resourceKind(deps: Deps, resource: string | null | undefined): "mcp" | "api" | "root" | null {
  if (!resource) return "root";
  let u: URL;
  try { u = new URL(resource); } catch { return null; }
  if (!origins(deps).includes(u.origin)) return null;
  const p = u.pathname.replace(/\/+$/, "");
  if (p === "") return "root";
  if (p === "/mcp") return "mcp";
  if (p === "/api/v1") return "api";
  return null;
}

/** The base for metadata: the request's own origin when it is one of ours (so a client on 127.0.0.1 sees 127.0.0.1), else SEARCH_PUBLIC_URL. */
export function baseFor(deps: Deps, c: Context): string {
  const o = new URL(c.req.url).origin;
  const host = c.req.header("host");
  const viaHost = host ? `${new URL(c.req.url).protocol}//${host}` : o;
  if (origins(deps).includes(viaHost)) return viaHost;
  return new URL(deps.env.PUBLIC_URL).origin;
}

// ---------- the provider over Postgres ----------

type ClientRow = typeof oauthClients.$inferSelect;

function clientInfo(r: ClientRow): OAuthClientInformationFull {
  // Never the secret: @hono/mcp's own client check is not used, ours compares hashes.
  return {
    ...(r.metadata as Record<string, unknown>),
    client_id: r.clientId,
    client_name: r.clientName,
    redirect_uris: r.redirectUris,
    token_endpoint_auth_method: r.tokenEndpointAuthMethod,
    grant_types: r.grantTypes,
    scope: r.scope ?? SCOPES.join(" "),
    client_id_issued_at: Math.floor(r.createdAt.getTime() / 1000),
  } as OAuthClientInformationFull;
}

function redirectAllowed(uri: string): boolean {
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  // native app schemes (RFC 8252 7.1), e.g. cursor://, vscode://
  return /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+:$|^(cursor|vscode|vscode-insiders|claude):$/i.test(u.protocol);
}

export interface IssuedTokens extends OAuthTokens { refresh_token: string }

export class PgOAuthProvider implements OAuthServerProvider {
  constructor(private deps: Deps) {}
  get db(): Db { return this.deps.db; }

  get clientsStore() {
    const db = this.db;
    return {
      async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
        const [r] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
        return r ? clientInfo(r) : undefined;
      },
      async registerClient(info: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">): Promise<OAuthClientInformationFull> {
        const full = info as OAuthClientInformationFull;
        if (!full.client_id) throw new ServerError("No client id");
        const uris = (full.redirect_uris ?? []).map(String);
        if (!uris.length) throw new InvalidClientMetadataError("redirect_uris is required.");
        const bad = uris.find((u) => !redirectAllowed(u));
        if (bad) throw new InvalidClientMetadataError(`redirect_uri ${bad} is not allowed: use https, a loopback http address, or an app scheme.`);
        const method = full.token_endpoint_auth_method ?? "client_secret_post";
        if (!["none", "client_secret_post", "client_secret_basic"].includes(method)) throw new InvalidClientMetadataError(`token_endpoint_auth_method ${method} is not supported.`);
        const grants = full.grant_types?.length ? full.grant_types : ["authorization_code", "refresh_token"];
        if (grants.some((g) => g !== "authorization_code" && g !== "refresh_token")) throw new InvalidClientMetadataError("Only authorization_code and refresh_token grants are supported.");
        const asked = (full.scope ?? "").split(/\s+/).filter(Boolean);
        const unknown = asked.find((s) => !(SCOPES as readonly string[]).includes(s));
        if (unknown) throw new InvalidClientMetadataError(`Unknown scope ${unknown}.`);
        const scope = (asked.length ? asked : [...SCOPES]).join(" ");
        const name = String(full.client_name ?? "").trim().slice(0, 80) || "Unnamed client";
        const { client_secret, client_secret_expires_at: _e, client_id, client_id_issued_at: _i, client_name: _n, redirect_uris: _r, token_endpoint_auth_method: _m, grant_types: _g, scope: _s, ...rest } = full;
        await db.insert(oauthClients).values({
          clientId: client_id, clientSecretHash: method === "none" || !client_secret ? null : sha256(client_secret),
          clientName: name, redirectUris: uris, tokenEndpointAuthMethod: method, grantTypes: grants, scope, metadata: rest as Record<string, unknown>,
        });
        // The secret goes back once, in this response, and is never stored in the clear.
        return { ...full, client_name: name, redirect_uris: uris, token_endpoint_auth_method: method, grant_types: grants, scope, ...(method === "none" ? { client_secret: undefined, client_secret_expires_at: undefined } : {}) } as OAuthClientInformationFull;
      },
    };
  }

  /** GET /authorize after @hono/mcp validated it: a pending row, the pending cookie, our consent page. */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: unknown): Promise<void> {
    const c = res as Context<AppEnv>;
    const kind = resourceKind(this.deps, params.resource?.href);
    if (!kind) throw new InvalidTargetError("Unknown resource for this server.");
    const allowed = (client.scope ?? SCOPES.join(" ")).split(" ");
    let scopes = params.scopes?.length ? params.scopes : kind === "mcp" ? MCP_DEFAULT_SCOPES : [...SCOPES];
    scopes = scopes.filter((s) => (SCOPES as readonly string[]).includes(s));
    if (!params.scopes?.length) scopes = scopes.filter((s) => allowed.includes(s));
    if (!scopes.length) throw new InvalidScopeError("No scope this server knows.");
    const id = localId("oap");
    await this.db.insert(oauthPending).values({
      id, clientId: client.client_id, redirectUri: params.redirectUri, state: params.state ?? null, codeChallenge: params.codeChallenge,
      codeChallengeMethod: "S256", scopes, resource: params.resource?.href ?? null, expiresAt: new Date(Date.now() + PENDING_TTL),
    });
    setCookie(c, PENDING_COOKIE, id, { httpOnly: true, sameSite: "Lax", secure: isSecure(c), path: "/", maxAge: PENDING_TTL / 1000 });
    c.res = c.html(await renderConsent(this.deps, c, id));
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    const [r] = await this.db.select().from(oauthCodes).where(eq(oauthCodes.codeHash, sha256(code))).limit(1);
    if (!r || r.clientId !== client.client_id) throw new InvalidGrantError("Unknown or expired code.");
    return r.codeChallenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string, resource?: URL): Promise<OAuthTokens> {
    // single use: the update wins once
    const [r] = await this.db.update(oauthCodes).set({ usedAt: new Date() })
      .where(and(eq(oauthCodes.codeHash, sha256(code)), isNull(oauthCodes.usedAt), sql`${oauthCodes.expiresAt} > now()`)).returning();
    if (!r) throw new InvalidGrantError("Unknown, used or expired code.");
    if (r.clientId !== client.client_id) throw new InvalidGrantError("The code was issued to another client.");
    if (redirectUri !== undefined && redirectUri !== r.redirectUri) throw new InvalidGrantError("redirect_uri does not match the authorization request.");
    if (resource && r.resource && resource.href !== r.resource) throw new InvalidTargetError("resource does not match the authorization request.");
    await this.touchClient(client.client_id);
    return this.issue(client.client_id, r.userId, r.scopes, r.resource, localId("fam"));
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[], resource?: URL): Promise<OAuthTokens> {
    const hash = sha256(refreshToken);
    const out = await this.db.transaction(async (tx) => {
      const found = await tx.execute(sql`select * from oauth_tokens where token_hash = ${hash} and kind = 'refresh' for update`);
      const r = found.rows[0] as { client_id: string; user_id: string; family_id: string; scopes: string[]; resource: string | null; expires_at: Date; revoked_at: Date | null; replaced_by: string | null } | undefined;
      if (!r) return { error: new InvalidGrantError("Unknown refresh token.") };
      if (r.client_id !== client.client_id) return { error: new InvalidGrantError("The refresh token belongs to another client.") };
      if (r.replaced_by || r.revoked_at) {
        // Reuse of a rotated (or revoked) refresh token: someone else may hold it. Kill the family.
        await tx.update(oauthTokens).set({ revokedAt: new Date() }).where(and(eq(oauthTokens.familyId, r.family_id), isNull(oauthTokens.revokedAt)));
        return { error: new InvalidGrantError(r.replaced_by ? "Refresh token reuse detected; every token of this sign-in is revoked. Sign in again." : "Refresh token revoked.") };
      }
      if (new Date(r.expires_at).getTime() <= Date.now()) return { error: new InvalidGrantError("Refresh token expired. Sign in again.") };
      const want = scopes?.length ? scopes : r.scopes;
      if (want.some((s) => !r.scopes.includes(s))) return { error: new InvalidScopeError("A refresh cannot widen the scopes.") };
      if (resource && r.resource && resource.href !== r.resource) return { error: new InvalidTargetError("resource does not match the original grant.") };
      const issued = await this.issue(client.client_id, r.user_id, want, r.resource, r.family_id, tx as unknown as Db);
      await tx.update(oauthTokens).set({ replacedBy: sha256(issued.refresh_token), revokedAt: new Date(), lastUsedAt: new Date() }).where(eq(oauthTokens.tokenHash, hash));
      return { tokens: issued };
    });
    if ("error" in out) throw out.error;
    await this.touchClient(client.client_id);
    return out.tokens!;
  }

  async verifyAccessToken(accessToken: string): Promise<AuthInfo> {
    const hash = sha256(accessToken);
    const [r] = await this.db.select().from(oauthTokens).where(and(eq(oauthTokens.tokenHash, hash), eq(oauthTokens.kind, "access"))).limit(1);
    if (!r || !sameHash(r.tokenHash, hash)) throw new TokenProblem("unauthorized", "Unknown access token.");
    if (r.revokedAt) throw new TokenProblem("unauthorized", "This token was revoked. Sign in again.");
    if (r.expiresAt.getTime() <= Date.now()) throw new TokenProblem("token_expired", "The access token expired. Refresh it.");
    if (!r.lastUsedAt || Date.now() - r.lastUsedAt.getTime() > 60_000) {
      await this.db.update(oauthTokens).set({ lastUsedAt: new Date() }).where(eq(oauthTokens.tokenHash, hash));
      await this.touchClient(r.clientId);
    }
    return { token: accessToken, clientId: r.clientId, scopes: r.scopes, expiresAt: Math.floor(r.expiresAt.getTime() / 1000), resource: r.resource ? new URL(r.resource) : undefined, extra: { userId: r.userId, familyId: r.familyId } };
  }

  /** RFC 7009: revoking either token of a sign-in ends the whole family. Unknown tokens answer 200. */
  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const [r] = await this.db.select().from(oauthTokens).where(eq(oauthTokens.tokenHash, sha256(request.token))).limit(1);
    if (!r || r.clientId !== client.client_id) return;
    await this.db.update(oauthTokens).set({ revokedAt: new Date() }).where(and(eq(oauthTokens.familyId, r.familyId), isNull(oauthTokens.revokedAt)));
  }

  async issue(clientId: string, userId: string, scopes: string[], resource: string | null, familyId: string, db: Db = this.db): Promise<IssuedTokens> {
    const access = token("sat_"), refresh = token("srt_");
    const now = Date.now();
    await db.insert(oauthTokens).values([
      { tokenHash: sha256(access), kind: "access", clientId, userId, familyId, scopes, resource, expiresAt: new Date(now + ACCESS_TTL) },
      { tokenHash: sha256(refresh), kind: "refresh", clientId, userId, familyId, scopes, resource, expiresAt: new Date(now + REFRESH_TTL) },
    ]);
    return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope: scopes.join(" ") };
  }

  private async touchClient(clientId: string): Promise<void> {
    await this.db.update(oauthClients).set({ lastUsedAt: new Date() }).where(eq(oauthClients.clientId, clientId));
  }
}

export class TokenProblem extends Error {
  constructor(public readonly code: "unauthorized" | "token_expired", message: string) { super(message); }
}

// ---------- pending requests and codes ----------

type PendingRow = typeof oauthPending.$inferSelect;

export async function loadPending(deps: Deps, c: Context, id?: string | null): Promise<PendingRow | null> {
  const fromCookie = getCookie(c, PENDING_COOKIE);
  if (!fromCookie || (id && id !== fromCookie)) return null;
  const [r] = await deps.db.select().from(oauthPending).where(eq(oauthPending.id, fromCookie)).limit(1);
  if (!r || r.expiresAt.getTime() <= Date.now()) return null;
  return r;
}

export async function dropPending(deps: Deps, c: Context, id: string): Promise<void> {
  await deps.db.delete(oauthPending).where(eq(oauthPending.id, id));
  deleteCookie(c, PENDING_COOKIE, { path: "/" });
}

function clientRedirect(p: PendingRow, params: Record<string, string>): string {
  const u = new URL(p.redirectUri);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (p.state) u.searchParams.set("state", p.state);
  return u.toString();
}

/** Mints the one-time code for this pending request and user, drops the pending row, and answers the redirect to the client. */
export async function finishPending(deps: Deps, c: Context, p: PendingRow, userId: string): Promise<Response> {
  const code = token("sac_");
  await deps.db.insert(oauthCodes).values({
    codeHash: sha256(code), clientId: p.clientId, userId, redirectUri: p.redirectUri, codeChallenge: p.codeChallenge,
    scopes: p.scopes, resource: p.resource, expiresAt: new Date(Date.now() + CODE_TTL),
  });
  await dropPending(deps, c, p.id);
  // RFC 9207 iss: the origin the client discovered us on (its resource), else SEARCH_PUBLIC_URL.
  const iss = p.resource && resourceKind(deps, p.resource) ? new URL(p.resource).origin : new URL(deps.env.PUBLIC_URL).origin;
  return c.redirect(clientRedirect(p, { code, iss }), 302);
}

export async function denyPending(deps: Deps, c: Context, p: PendingRow, error = "access_denied", description = "The user declined."): Promise<Response> {
  await dropPending(deps, c, p.id);
  return c.redirect(clientRedirect(p, { error, error_description: description }), 302);
}

async function renderConsent(deps: Deps, c: Context<AppEnv>, pendingId: string): Promise<string> {
  const [p] = await deps.db.select().from(oauthPending).where(eq(oauthPending.id, pendingId));
  const [cl] = await deps.db.select().from(oauthClients).where(eq(oauthClients.clientId, p!.clientId));
  const user = await signedInUser(c);
  return consentPage({
    pendingId, clientName: cl?.clientName ?? "An app", redirectHost: new URL(p!.redirectUri).host, scopes: p!.scopes,
    user: user ? { name: user.name ?? user.email ?? "your account", isSample: user.isSample } : null,
    oneConfigured: !!deps.oneConnect,
  });
}

// ---------- client authentication (hash compare) ----------

const authenticateClient = (provider: PgOAuthProvider): MiddlewareHandler => async (c, next) => {
  try {
    const body = (c.req.header("content-type") ?? "").includes("application/json") ? await c.req.json() : await c.req.parseBody();
    let id = typeof body.client_id === "string" ? body.client_id : undefined;
    let secret = typeof body.client_secret === "string" ? body.client_secret : undefined;
    const basic = c.req.header("authorization");
    if (basic?.startsWith("Basic ")) {
      const [u, s] = Buffer.from(basic.slice(6), "base64").toString().split(":");
      id ??= decodeURIComponent(u ?? "");
      secret ??= decodeURIComponent(s ?? "");
    }
    if (!id) throw new InvalidRequestError("client_id is required.");
    const [r] = await provider.db.select().from(oauthClients).where(eq(oauthClients.clientId, id)).limit(1);
    if (!r) throw new InvalidClientError("Invalid client_id");
    if (r.clientSecretHash) {
      if (!secret) throw new InvalidClientError("Client secret is required");
      if (!sameHash(r.clientSecretHash, sha256(secret))) throw new InvalidClientError("Invalid client_secret");
    }
    c.set("client" as never, clientInfo(r) as never);
    await next();
  } catch (e) {
    if (e instanceof OAuthError) return c.json(e.toResponseObject(), e instanceof ServerError ? 500 : e instanceof InvalidClientError ? 401 : 400);
    return c.json(new ServerError("Internal Server Error").toResponseObject(), 500);
  }
};

// ---------- routes ----------

function asMetadata(deps: Deps, base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    revocation_endpoint: `${base}/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [...SCOPES],
    authorization_response_iss_parameter_supported: true,
    service_documentation: "https://github.com/withoneai/forkable",
  };
}

function resourceMetadata(base: string, path: "/mcp" | "/api/v1") {
  return {
    resource: `${base}${path}`,
    authorization_servers: [base],
    // The MCP tools only read and ask, so that is all /mcp advertises (clients request what is listed here).
    scopes_supported: path === "/mcp" ? [...MCP_DEFAULT_SCOPES] : [...SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: path === "/mcp" ? "Search MCP" : "Search REST API",
  };
}

export function mountOAuth(app: Hono<AppEnv>, deps: Deps): PgOAuthProvider {
  const provider = new PgOAuthProvider(deps);
  const noStore: MiddlewareHandler = async (c, next) => { await next(); c.header("Cache-Control", "no-store"); };
  const cors: MiddlewareHandler = async (c, next) => {
    if (c.req.method === "OPTIONS") {
      return c.body(null, 204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, mcp-protocol-version" });
    }
    await next();
    c.header("Access-Control-Allow-Origin", "*");
  };

  // The issuer follows the request's origin when it is ours, so a client that came in on 127.0.0.1 is not sent to localhost.
  for (const p of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
    app.use(p, cors);
    app.get(p, (c) => c.json(asMetadata(deps, baseFor(deps, c))));
  }
  app.use("/.well-known/oauth-protected-resource/*", cors);
  app.use("/.well-known/oauth-protected-resource", cors);
  app.get("/.well-known/oauth-protected-resource", (c) => c.json(resourceMetadata(baseFor(deps, c), "/mcp")));
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json(resourceMetadata(baseFor(deps, c), "/mcp")));
  app.get("/.well-known/oauth-protected-resource/api/v1", (c) => c.json(resourceMetadata(baseFor(deps, c), "/api/v1")));

  for (const p of ["/register", "/token", "/revoke"]) app.use(p, cors);
  app.post("/register", noStore, clientRegistrationHandler({ clientsStore: provider.clientsStore, clientSecretExpirySeconds: 0 }) as never);
  app.post("/token", noStore, authenticateClient(provider), tokenHandler(provider) as never);
  app.post("/revoke", noStore, authenticateClient(provider), async (c) => {
    const body = (c.req.header("content-type") ?? "").includes("application/json") ? await c.req.json() : await c.req.parseBody();
    if (typeof body.token !== "string" || !body.token) return c.json(new InvalidRequestError("token is required.").toResponseObject(), 400);
    await provider.revokeToken((c as unknown as Context<{ Variables: { client: OAuthClientInformationFull } }>).get("client"), { token: body.token, token_type_hint: typeof body.token_type_hint === "string" ? body.token_type_hint : undefined });
    return c.json({});
  });

  app.get("/authorize", authorizeHandler(provider) as never);

  /** The consent page's buttons. The pending id must match the httpOnly, SameSite=Lax pending cookie. */
  app.post("/oauth/consent", async (c) => {
    const form = await c.req.parseBody();
    const origin = c.req.header("origin");
    if (origin && origin !== "null" && !origins(deps).includes(origin) && origin !== baseFor(deps, c)) {
      return c.html(messagePage("That did not come from this page", "Start the sign-in again from your app."), 403);
    }
    const p = await loadPending(deps, c, typeof form.pending === "string" ? form.pending : null);
    if (!p) return c.html(messagePage("This sign-in expired", "Sign-in requests last ten minutes. Start again from your app."), 400);
    const action = String(form.action ?? "");
    if (action === "deny") return denyPending(deps, c, p);
    if (action === "allow") {
      const u = await signedInUser(c);
      if (!u) return c.html(await renderConsent(deps, c, p.id));
      return finishPending(deps, c, p, u.id);
    }
    if (action === "sample") {
      await bootstrapSample(deps);
      await bindSid(deps.db, c.get("sid"), SAMPLE_USER);
      return finishPending(deps, c, p, SAMPLE_USER);
    }
    if (action === "one") {
      if (!deps.oneConnect) return c.html(messagePage("Sign in with One is not set up", "Open /setup/connect on this computer first, or use the Acme sample."), 409);
      return c.redirect(`/api/one/authorize?oauth=1`, 302);
    }
    return c.html(messagePage("Unknown choice", "Start the sign-in again from your app."), 400);
  });

  return provider;
}

// ---------- bearer auth for /api/v1 and /mcp ----------

export interface Bearer { userId: string; user: UserRow; clientId: string; scopes: string[]; auth: AuthInfo }

/** Resolves a bearer token for the given resource. Throws TokenProblem. */
export async function resolveBearer(deps: Deps, provider: PgOAuthProvider, header: string | undefined, path: "mcp" | "api"): Promise<Bearer> {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  if (!m) throw new TokenProblem("unauthorized", "Send Authorization: Bearer <token>. Sign in with `search login`.");
  const auth = await provider.verifyAccessToken(m[1]!);
  const kind = resourceKind(deps, auth.resource?.href);
  if (kind !== "root" && kind !== path) throw new TokenProblem("unauthorized", `This token is for ${auth.resource?.href}, not this resource.`);
  const userId = String(auth.extra?.userId ?? "");
  const [user] = await deps.db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new TokenProblem("unauthorized", "The account behind this token is gone.");
  return { userId, user, clientId: auth.clientId, scopes: auth.scopes, auth };
}

export function wwwAuthenticate(deps: Deps, c: Context, path: "/mcp" | "/api/v1", problem?: TokenProblem): string {
  const base = baseFor(deps, c);
  const err = problem ? `, error="invalid_token", error_description="${problem.message.replace(/"/g, "'")}"` : "";
  return `Bearer realm="search", resource_metadata="${base}/.well-known/oauth-protected-resource${path}"${err}`;
}

/** /api/v1/*: a bearer request becomes that user with that token's scopes; a cookie request passes through untouched. */
export function apiBearer(deps: Deps, provider: PgOAuthProvider): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header("authorization");
    if (!header || !/^Bearer\s/i.test(header)) return next();
    try {
      const b = await resolveBearer(deps, provider, header, "api");
      c.set("user", b.user);
      c.set("scopes", b.scopes);
      c.set("clientId", b.clientId);
    } catch (e) {
      if (!(e instanceof TokenProblem)) throw e;
      c.header("WWW-Authenticate", wwwAuthenticate(deps, c, "/api/v1", e));
      return c.json({ error: { code: e.code, message: e.message } }, 401);
    }
    return next();
  };
}
