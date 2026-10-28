import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Env } from "./env.js";
import { connectFor, stableUserId } from "./connect.js";
import { WEB_FLOW, finishWebLogin, profile, web } from "./web.js";
import { authCsp, chatApp, connectedPage, consentPage, messagePage } from "./web-ui.js";

// The MCP server's own OAuth, with Sign in with One as the identity step:
//   host -> /authorize (our consent page) -> One's three-step consent
//   -> /api/one/callback -> back to the host with an MCP code.
// One's consent decides what the grant reaches. Our page only names which
// chat app is asking, so a client registered by someone else cannot ride a
// sign-in silently.

const PENDING = "fb_pending";
const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return "invalid";
  }
};
const EXPIRED = () => messagePage("This sign-in expired", "Sign-in links last ten minutes. Start again from your chat app.");

export const auth = new Hono<{ Bindings: Env }>();

// The website at the root: sign in, your saved UIs, each one live.
auth.route("/", web);

auth.get("/authorize", async (c) => {
  const request = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  const client = await c.env.OAUTH_PROVIDER.lookupClient(request.clientId);
  // Flow log: hosts and parameter names only, never codes, states or tokens.
  console.log("authorize", { client: client?.clientName ?? null, redirect: hostOf(request.redirectUri), hasState: !!request.state, scope: request.scope, resource: (request as any).resource ?? null });
  c.header("Content-Security-Policy", await authCsp());
  if (!client) return c.html(messagePage("We don't know this app", "Remove the connector in your chat app and add it again."), 400);
  const id = crypto.randomUUID();
  await c.env.OAUTH_KV.put(`pending:${id}`, JSON.stringify(request), { expirationTtl: 600 });
  setCookie(c, PENDING, id, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 600 });
  return c.html(consentPage({ app: chatApp(new URL(request.redirectUri).host, client.clientName), pendingId: id }));
});

auth.post("/authorize", async (c) => {
  const form = await c.req.parseBody();
  const id = String(form.id ?? "");
  console.log("consent", { ok: form.ok, cookieMatches: !!id && id === getCookie(c, PENDING) });
  c.header("Content-Security-Policy", await authCsp());
  if (!id || id !== getCookie(c, PENDING)) return c.html(EXPIRED(), 400);
  const raw = await c.env.OAUTH_KV.get(`pending:${id}`);
  if (!raw) return c.html(EXPIRED(), 400);
  const request = JSON.parse(raw) as AuthRequest;
  if (form.ok !== "1") {
    await c.env.OAUTH_KV.delete(`pending:${id}`);
    const back = new URL(request.redirectUri);
    back.searchParams.set("error", "access_denied");
    if (request.state) back.searchParams.set("state", request.state);
    return c.redirect(back.toString());
  }
  const connect = connectFor(c.env);
  if (!connect) return c.html(messagePage("Sign-in is not set up yet", "This server has no Connect app yet. Try again later."), 503);
  const { redirectUrl, cookie } = connect.startAuthorization();
  setCookie(c, cookie.name, cookie.value, { ...cookie.options, sameSite: "Lax" });
  deleteCookie(c, WEB_FLOW, { path: "/" }); // this sign-in is for a chat app, not the website
  return c.redirect(redirectUrl);
});

auth.get("/api/one/callback", async (c) => {
  const id = getCookie(c, PENDING);
  const raw = id ? await c.env.OAUTH_KV.get(`pending:${id}`) : null;
  // One callback for both: a chat app's sign-in (pending request) or the website's.
  if (!raw && getCookie(c, WEB_FLOW)) return finishWebLogin(c);
  console.log("one callback", { hasPendingCookie: !!id, pendingFound: !!raw, params: [...new URL(c.req.url).searchParams.keys()] });
  c.header("Content-Security-Policy", await authCsp());
  if (!id || !raw) return c.html(EXPIRED(), 400);
  const request = JSON.parse(raw) as AuthRequest;
  const connect = connectFor(c.env)!;
  const tempId = `u_${crypto.randomUUID()}`;
  const done = await connect.completeAuthorization({ userId: tempId, url: c.req.url, getCookie: (n) => getCookie(c, n) });
  if (done.clearCookieName) deleteCookie(c, done.clearCookieName, { path: "/" });
  await c.env.OAUTH_KV.delete(`pending:${id}`);
  deleteCookie(c, PENDING, { path: "/" });
  if (done.outcome !== "connected") {
    console.log("one connect", done.outcome, done.code, done.message);
    const back = new URL(request.redirectUri);
    back.searchParams.set("error", "access_denied");
    if (request.state) back.searchParams.set("state", request.state);
    return c.redirect(back.toString());
  }
  const userId = await stableUserId(c.env, connect, tempId);
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request,
    userId: encodeURIComponent(userId),
    metadata: { label: "Sign in with One" },
    scope: request.scope,
    props: { userId },
  });
  const back = new URL(redirectTo);
  console.log("back to host", { host: back.host, params: [...back.searchParams.keys()] });
  // A short "you're connected" page, then on to the chat app. Who signed in
  // is a nicety: if One is slow to say, the page goes without it.
  const client = await c.env.OAUTH_PROVIDER.lookupClient(request.clientId).catch(() => null);
  const who = await Promise.race([profile(connect, userId).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
  return c.html(connectedPage({ app: chatApp(back.host, client?.clientName), redirectTo, who }));
});
