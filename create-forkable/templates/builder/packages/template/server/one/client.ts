import type { Context } from "hono";
import { createOneConnect, type OneConnectKeyClient } from "@withone/connect/server";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import type { AppEnv, Bindings } from "../env";
import type { Action, ActionInput, OneUser, Refusal, RunResult } from "./index";
import { sessionUserId } from "./session";

// One mode for preview and published (ONE_MODE, set by __BRAND_NAME__):
//  connect  One Connect is on. @withone/connect on this app's own Connect app
//           (ONE_CLIENT_ID and friends), key mode, the user store on this
//           app's database. Every call runs on the signed-in person's grant.
//           In preview __BRAND_NAME__ also sets a dev check (__ENV_PREFIX__DEV_URL and
//           __ENV_PREFIX__DEV_TOKEN in .dev.vars): before each call it asks whether this
//           call may leave the computer (the app's manifest, visitors, older
//           versions, writes while the agent works) and after it reports what
//           One answered, for the Access tab. Published, there is none.
//  off      One Connect is off for this app: no One login, and every
//           one(c).run is a local refusal (connect_off). Nothing reaches One.
//           In preview only, until this app's Connect app is set up, me() is
//           a local preview user, so a fresh app works before any sign-in.
//           Published there is no preview user: routes behind requireUser
//           answer 401 until One Connect is on.

const P = "__ENV_PREFIX__";
const SCOPES = ["user:connections:read", "user:connections:write", "org:connections:read", "org:connections:write", "project:connections:read", "project:connections:write", "user:profile:read"];

export interface OneClient {
  /** as "owner": the app owner's grant (APP_OWNER_EMAIL), for public pages. */
  run(a: Action, input: ActionInput, as?: "user" | "owner"): Promise<RunResult<unknown>>;
  me(c: Context<AppEnv>): Promise<OneUser | null>;
}

const local = (status: number, code: string, message: string): RunResult<never> => ({ ok: false, status, refusal: { source: "local", code, message } });

const vars = (env: Bindings) => env as unknown as Record<string, string | undefined>;

/** "connect" or "off". Anything else (an older project's "preview") reads as off. */
export function oneMode(env: Bindings): "connect" | "off" {
  return env?.ONE_MODE === "connect" ? "connect" : "off";
}

/** The preview's dev check, when __BRAND_NAME__ runs this app. Null when published. */
export function devCheck(env: Bindings): { url: string; token: string } | null {
  const v = vars(env);
  const url = v[`${P}DEV_URL`]?.replace(/\/$/, "");
  const token = v[`${P}DEV_TOKEN`];
  return url && token ? { url, token } : null;
}

/** The keyless sample: a stub One on this computer stands in for One. Its refusals are labeled Sample. */
export const isSample = (env: Bindings): boolean => vars(env)[`${P}ONE_SAMPLE`] === "1";

async function postDev(env: Bindings, path: string, body: unknown): Promise<Response | null> {
  const d = devCheck(env);
  if (!d) return null;
  try {
    return await fetch(`${d.url}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(body) });
  } catch {
    return null;
  }
}

/** Key-mode Connect client on this app's own Connect app. Null until One Connect is on and its values are set. */
export function oneConnectFor(c: Context<AppEnv>): OneConnectKeyClient | null {
  const e = c.env;
  if (oneMode(e) !== "connect") return null;
  if (!e.ONE_CLIENT_ID || !e.ONE_CLIENT_SECRET || !e.ONE_CONNECT_KEY || !e.ONE_REDIRECT_URI) return null;
  const d = db(c);
  return createOneConnect({
    clientId: e.ONE_CLIENT_ID,
    clientSecret: e.ONE_CLIENT_SECRET,
    connectKey: e.ONE_CONNECT_KEY,
    redirectUri: e.ONE_REDIRECT_URI,
    permissionSet: e.ONE_PERMISSION_SET || undefined,
    // Only on the keyless sample, where __BRAND_NAME__ points it at its stub One.
    ...(e.ONE_API_URL ? { oneApiUrl: e.ONE_API_URL } : {}),
    scopes: SCOPES,
    userStore: {
      async saveUser(userId, reference) {
        await d
          .insert(schema.connectUsers)
          .values({ userId, reference, updatedAt: new Date() })
          .onConflictDoUpdate({ target: schema.connectUsers.userId, set: { reference, updatedAt: new Date() } });
      },
      async loadUser(userId) {
        const [row] = await d.select().from(schema.connectUsers).where(eq(schema.connectUsers.userId, userId)).limit(1);
        return row?.reference ?? null;
      },
      async clearUser(userId) {
        await d.delete(schema.connectUsers).where(eq(schema.connectUsers.userId, userId));
      },
    },
  });
}

/** Preview only, while this app has no working Connect app: the developer, unsigned. Never published. */
export const PREVIEW_USER: OneUser = { id: "preview-user", name: "You (preview)", email: null };

export function isPreviewUser(c: Context<AppEnv>): boolean {
  return Boolean(devCheck(c.env)) && !oneConnectFor(c);
}

function connectClient(c: Context<AppEnv>): OneClient {
  const me = async (): Promise<OneUser | null> => {
    if (isPreviewUser(c)) return PREVIEW_USER;
    const userId = await sessionUserId(c);
    if (!userId) return null;
    const d = db(c);
    const [row] = await d.select().from(schema.connectUsers).where(eq(schema.connectUsers.userId, userId)).limit(1);
    if (!row) return null;
    const [u] = await d.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    return { id: userId, name: u?.name ?? null, email: u?.email ?? null };
  };
  /**
   * The owner account. Published: APP_OWNER_EMAIL, once it has signed in
   * with One and granted the app. In preview, unless APP_OWNER_EMAIL is set:
   * whoever signed in to this preview first (the developer).
   */
  const owner = async (): Promise<OneUser | null> => {
    const d = db(c);
    const email = c.env.APP_OWNER_EMAIL?.trim().toLowerCase();
    if (!email) {
      if (!devCheck(c.env)) return null;
      const [first] = await d.select().from(schema.connectUsers).orderBy(asc(schema.connectUsers.updatedAt)).limit(1);
      if (!first) return null;
      const [u] = await d.select().from(schema.users).where(eq(schema.users.id, first.userId)).limit(1);
      return { id: first.userId, name: u?.name ?? null, email: u?.email ?? null };
    }
    const [u] = await d.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (!u) return null;
    const [row] = await d.select().from(schema.connectUsers).where(eq(schema.connectUsers.userId, u.id)).limit(1);
    return row ? { id: u.id, name: u.name ?? null, email: u.email ?? null } : null;
  };
  return {
    me,
    async run(a, input, as = "user") {
      const what = { platform: a.platform, actionId: a.actionId, method: a.method, path: a.path, title: a.title, ...(as === "owner" ? { as } : {}) };
      const refuse = async (status: number, code: string, message: string) => {
        await postDev(c.env, "/report", { ...what, status, ok: false, code });
        return local(status, code, message);
      };
      if (oneMode(c.env) !== "connect") return local(403, "connect_off", "One Connect is off for this app, so it calls no platform. Turn it on in the project's Settings, One Connect.");
      const dev = devCheck(c.env);
      if (dev) {
        // The local check first: the manifest, visitors, older versions, writes while the agent works.
        const res = await postDev(c.env, "/check", what);
        if (!res) return local(502, "check_unreachable", "The preview's local check is not reachable, so the call was not sent.");
        const answer = (await res.json().catch(() => null)) as { allow?: boolean; body?: RunResult<unknown> } | null;
        if (!answer?.allow) return (answer?.body as RunResult<unknown> | undefined) ?? local(res.status || 403, "check_refused", "The preview's local check refused this call.");
      } else if (as === "owner") {
        // Published: visitors on the owner's grant only for the actions the builder allowed (APP_VISITOR_ACTIONS, set at publish).
        const allowed = visitorActions(c.env.APP_VISITOR_ACTIONS);
        if (!allowed.size) return local(403, "visitors_off", "This app does not let visitors run actions on the owner's grant.");
        if (!allowed.has(a.actionId)) return local(403, "visitor_not_allowed", "The app owner has not allowed visitors to trigger this action.");
      }
      const oc = oneConnectFor(c);
      if (!oc) return refuse(501, "not_configured", "Connect is not configured for this app yet.");
      const user = as === "owner" ? await owner() : await me();
      if (!user && as === "owner") return refuse(503, "owner_not_connected", "The app owner has not connected yet. Set APP_OWNER_EMAIL and sign in once with that account.");
      if (!user) return refuse(401, "signed_out", "Sign in with One to continue.");
      const t0 = Date.now();
      const connections = await oc.listConnections(user.id).catch(() => []);
      const conn = connections.find((x) => x.platform === a.platform);
      if (!conn) return refuse(409, "not_connected", `Connect ${a.platform} in One to use this.`);
      // Strings; a nested object becomes bracket keys (due_date[lt]=...), as Stripe and most REST APIs read it.
      const query: Record<string, string | string[]> = {};
      const put = (k: string, v: unknown) => {
        if (v === undefined || v === null) return;
        if (Array.isArray(v)) query[k] = v.map((x) => (x !== null && typeof x === "object" ? JSON.stringify(x) : String(x)));
        else if (typeof v === "object") for (const [sub, x] of Object.entries(v)) put(`${k}[${sub}]`, x);
        else query[k] = String(v);
      };
      for (const [k, v] of Object.entries((input.query as Record<string, unknown> | undefined) ?? {})) put(k, v);
      let r;
      try {
        r = await oc.runAction(user.id, {
          connectionKey: conn.key,
          actionId: a.actionId,
          method: a.method,
          path: a.path,
          pathParams: input.pathParams as Record<string, string | number | boolean> | undefined,
          body: input.body,
          query,
          headers: { ...(a.headers ?? {}), ...((input.headers as Record<string, string> | undefined) ?? {}) },
        });
      } catch (err) {
        await postDev(c.env, "/report", { ...what, status: 502, ok: false, ms: Date.now() - t0 });
        return { ok: false, status: 502, data: { error: { code: "one_unreachable", message: `One did not answer: ${(err as Error).message}` } } };
      }
      await postDev(c.env, "/report", { ...what, status: r.status, ok: r.ok, blockedByGrant: r.blockedByGrant, ms: Date.now() - t0 });
      if (r.blockedByGrant) {
        const refusal: Refusal = { source: isSample(c.env) ? "sample" : "one", code: "blocked_by_grant", message: "Outside what you granted this app." };
        return { ok: false, status: 403, refusal, data: r.data };
      }
      return r.ok ? { ok: true, status: r.status, data: r.data } : { ok: false, status: r.status, data: r.data };
    },
  };
}

/** APP_VISITOR_ACTIONS: comma-separated action ids the owner allowed for visitors; unset or "none" is off. */
export function visitorActions(v: string | undefined): Set<string> {
  return new Set((v ?? "").split(",").map((x) => x.trim()).filter((x) => x.startsWith("conn_mod_def::")));
}

export function clientFor(c: Context<AppEnv>): OneClient {
  return connectClient(c);
}

/** For the dev routes: bind a sign-in's state to this preview, so the shared callback can send it back here. */
export async function registerState(env: Bindings, state: string): Promise<boolean> {
  const res = await postDev(env, "/oauth-state", { state });
  return Boolean(res?.ok);
}

/** For the dev routes: which call an Access ticket asks for (one use). */
export async function redeemTicket(env: Bindings, ticket: string): Promise<{ platform: string; actionId: string; title: string; method: string; path: string; pathParams: Record<string, string> } | null> {
  const res = await postDev(env, "/ticket", { ticket });
  if (!res?.ok) return null;
  return (await res.json().catch(() => null)) as { platform: string; actionId: string; title: string; method: string; path: string; pathParams: Record<string, string> } | null;
}

/** For the dev routes: report a call the Access test made. */
export async function reportCall(env: Bindings, body: Record<string, unknown>): Promise<void> {
  await postDev(env, "/report", body);
}
