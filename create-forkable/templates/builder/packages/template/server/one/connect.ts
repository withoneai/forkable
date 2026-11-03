import { Hono, type Context } from "hono";
import { createOneConnectRoutes } from "@withone/connect/next";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import type { AppEnv } from "../env";
import { clientFor, devCheck, isPreviewUser, isSample, oneConnectFor, oneMode, redeemTicket, registerState, reportCall } from "./client";
import { ensureSession } from "./session";

// /api/one/*: Sign in with One on this app's own Connect app, and the grant.
// Do not edit. createOneConnectRoutes from @withone/connect/next (PKCE,
// state and the code exchange), the user store on connect_users.
//
// In preview every Connect app uses one redirect URI, __BRAND_NAME__'s shared
// callback (ONE_REDIRECT_URI). Before the browser goes to One, /authorize
// tells __BRAND_NAME__ which preview this sign-in's state belongs to; the shared
// callback sends the browser back to exactly that preview's /api/one/callback,
// where this app's own PKCE cookie and code exchange finish it. Published,
// ONE_REDIRECT_URI is the app's own address and none of that runs.

export const oneRoutes = new Hono<AppEnv>();

const off = (c: Context<AppEnv>) =>
  c.json({ error: { code: "connect_off", message: devCheck(c.env) ? "One Connect is off for this app. Turn it on in the project's Settings, One Connect." : "Sign in with One is not set up for this app." } }, 501);
const notConfigured = (c: Context<AppEnv>) => c.json({ error: { code: "not_configured", message: "This app's Connect app is missing a value. Check its One Connect settings." } }, 501);

/** Keep the session cookie Hono set on a Response the package built. */
function withCookies(c: Context<AppEnv>, res: Response): Response {
  const pending = c.res.headers.getSetCookie?.() ?? [];
  if (!pending.length) return res;
  const out = new Response(res.body, res);
  for (const v of pending) out.headers.append("set-cookie", v);
  return out;
}

async function connectRoutes(c: Context<AppEnv>) {
  const oc = oneConnectFor(c);
  if (!oc) return null;
  const userId = await ensureSession(c);
  return createOneConnectRoutes(oc, {
    identifyUser: () => userId,
    onComplete: async ({ userId: id, result }) => {
      if (result.outcome !== "connected") return;
      // whoami names the account (needs the user:profile:read scope).
      const res = await oc.fetch(id, "/users/whoami").catch(() => null);
      if (!res?.ok) return;
      const who = (await res.json()) as { user?: { name?: string | null; email?: string | null } };
      await db(c)
        .update(schema.users)
        .set({ name: who.user?.name ?? null, email: who.user?.email?.toLowerCase() ?? null })
        .where(eq(schema.users.id, id));
    },
  });
}

oneRoutes.get("/authorize", async (c) => {
  if (oneMode(c.env) !== "connect") return off(c);
  const routes = await connectRoutes(c);
  if (!routes) return notConfigured(c);
  const res = await routes.GET(c.req.raw);
  if (devCheck(c.env)) {
    // Bind this sign-in to this preview before the browser leaves for One.
    const state = (() => {
      try {
        return new URL(res.headers.get("location") ?? "").searchParams.get("state");
      } catch {
        return null;
      }
    })();
    if (!state || !(await registerState(c.env, state))) {
      return c.html(`<!doctype html><meta charset="utf-8"><title>Sign in with One</title><body style="font:14px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem"><p>The preview's sign-in could not start: __BRAND_NAME__ did not answer. Reload the preview and try again.</p></body>`, 502);
    }
  }
  return withCookies(c, res);
});

oneRoutes.get("/callback", async (c) => {
  if (oneMode(c.env) !== "connect") return off(c);
  const routes = await connectRoutes(c);
  if (!routes) return notConfigured(c);
  const res = await routes.GET(c.req.raw);
  if (!devCheck(c.env)) return withCookies(c, res);
  // The package builds its return address from the shared callback's origin; stay on this preview's host instead.
  const loc = res.headers.get("location");
  if (!loc) return withCookies(c, res);
  let rel = "/";
  try {
    const u = new URL(loc, c.req.url);
    rel = `${u.pathname}${u.search}${u.hash}`;
  } catch {
    /* keep / */
  }
  const out = new Response(res.body, res);
  out.headers.set("location", rel.startsWith("//") ? "/" : rel);
  return withCookies(c, out);
});

/** The signed-in user, or null, and whether signing in can work here. */
oneRoutes.get("/me", async (c) => {
  const mode = oneMode(c.env);
  const preview = isPreviewUser(c);
  const user = mode === "connect" || preview ? await clientFor(c).me(c) : null;
  return c.json({ user, mode, grant: mode === "connect" ? (isSample(c.env) ? "sample" : "one") : null, canSignIn: Boolean(oneConnectFor(c)), previewUser: preview });
});

/**
 * Preview only (the dev check is set): Access's "Ask One". Runs the one call
 * a ticket names, on the signed-in developer's grant, and reports One's
 * answer. The ticket comes from __BRAND_NAME__ and works once; published, this
 * route does not exist.
 */
oneRoutes.post("/dev/receipt-test", async (c) => {
  if (!devCheck(c.env)) return c.json({ error: { code: "not_found", message: "No such route." } }, 404);
  const { ticket } = ((await c.req.json().catch(() => ({}))) ?? {}) as { ticket?: string };
  const t = typeof ticket === "string" ? await redeemTicket(c.env, ticket) : null;
  if (!t) return c.json({ status: 400, blockedByGrant: false, message: "That test expired. Run it again from Access." }, 400);
  const oc = oneConnectFor(c);
  if (!oc) return c.json({ status: 501, blockedByGrant: false, message: "One Connect is off for this app." }, 501);
  const user = await clientFor(c).me(c);
  if (!user) return c.json({ status: 401, blockedByGrant: false, message: "Sign in with One in the preview first." }, 401);
  const conn = (await oc.listConnections(user.id).catch(() => [])).find((x) => x.platform === t.platform);
  if (!conn) return c.json({ status: 409, blockedByGrant: false, message: `${t.platform} is not in your grant to this app.` }, 409);
  const t0 = Date.now();
  const r = await oc.runAction(user.id, { connectionKey: conn.key, actionId: t.actionId, method: t.method, path: t.path, pathParams: t.pathParams });
  await reportCall(c.env, { platform: t.platform, actionId: t.actionId, title: t.title, method: t.method, path: t.path, status: r.status, ok: r.ok, blockedByGrant: r.blockedByGrant, ms: Date.now() - t0 });
  return c.json({ status: r.status, blockedByGrant: r.blockedByGrant });
});

/** Booleans only, never a value. */
oneRoutes.get("/health", (c) => {
  const e = c.env;
  return c.json({
    mode: oneMode(e),
    configured: {
      clientId: Boolean(e.ONE_CLIENT_ID),
      clientSecret: Boolean(e.ONE_CLIENT_SECRET),
      connectKey: Boolean(e.ONE_CONNECT_KEY),
      redirectUri: Boolean(e.ONE_REDIRECT_URI),
      permissionSet: Boolean(e.ONE_PERMISSION_SET),
      // libSQL on Vercel: the URL alone is not enough for a remote database.
      databaseAuthToken: Boolean(e.DATABASE_AUTH_TOKEN),
    },
    db: Boolean(e.DB || e.DATABASE_URL),
  });
});
