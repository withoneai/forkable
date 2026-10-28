import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "./env.js";
import { connectFor, stableUserId } from "./connect.js";
import { deleteUi, listUis, listVersions, loadRender } from "./store.js";
import { renderPayload, runTool } from "./tools.js";
import canvasHtml from "../dist-view/canvas.html";
import { blocksPage, landingPage, notFoundPage, pageCsp } from "./web-ui.js";
import { authCsp, chatApp, connectedPage, consentPage, messagePage } from "./web-ui.js";

// blocks.forkable.dev itself. Sign in with One (the same Connect app and the
// same person as in Claude or ChatGPT), see every UI you saved, open each one
// live on your own grant. Sample mode (AUTH=off) signs everyone in as the
// Acme sample so it runs with no Connect app.

export const WEB_FLOW = "fb_web";
const SESSION = "fb_session";
const DAY = 60 * 60 * 24;

type C = Context<{ Bindings: Env }>;

type Session = { userId: string; name: string | null; email: string | null; avatar: string | null; profiled?: number };

async function sessionUser(c: C): Promise<Session | null> {
  if (c.env.AUTH === "off") return { userId: "sample", name: "Acme sample", email: "dana@acme.test", avatar: null };
  const sid = getCookie(c, SESSION);
  if (!sid) return null;
  const raw = await c.env.OAUTH_KV.get(`sess:${sid}`);
  if (!raw) return null;
  const s = JSON.parse(raw) as Session;
  // Sessions from before the profile was kept, or whose lookup failed: try again, at most hourly.
  if (!s.email && (!s.profiled || Date.now() - s.profiled > 3600_000)) {
    const connect = connectFor(c.env);
    if (connect) {
      Object.assign(s, await profile(connect, s.userId), { profiled: Date.now() });
      await c.env.OAUTH_KV.put(`sess:${sid}`, JSON.stringify(s), { expirationTtl: 30 * DAY });
    }
  }
  return { ...s, email: s.email ?? null, avatar: s.avatar ?? null };
}

/**
 * Who signed in, from One: GET /v1/users/whoami for the name and email, GET
 * /v1/users/me for the picture (whoami carries none). Both need the grant's
 * user:profile:read scope, which @withone/connect asks for by default. The
 * SDK's fetch adds /v1. A failure leaves the fields empty, never the sign-in.
 */
export async function profile(connect: NonNullable<ReturnType<typeof connectFor>>, userId: string) {
  const read = async <T>(path: string): Promise<T | null> => {
    try {
      const r = await connect.fetch(userId, path);
      return r.ok ? ((await r.json()) as T) : (console.log("profile", path, r.status), null);
    } catch {
      return null;
    }
  };
  const [who, me] = await Promise.all([
    read<{ user?: { name?: string | null; email?: string | null } }>("/users/whoami"),
    read<{ avatar?: string | null; email?: string | null; firstName?: string | null; lastName?: string | null }>("/users/me"),
  ]);
  const meName = [me?.firstName, me?.lastName].filter(Boolean).join(" ").trim();
  const avatar = me?.avatar?.trim();
  return {
    name: who?.user?.name?.trim() || meName || null,
    email: (who?.user?.email ?? me?.email)?.trim().toLowerCase() || null,
    avatar: avatar && /^https:\/\//.test(avatar) && !/picsum\.photos/.test(avatar) ? avatar : null,
  };
}

/** The callback leg when the sign-in started on the website. */
export async function finishWebLogin(c: C) {
  const connect = connectFor(c.env);
  deleteCookie(c, WEB_FLOW, { path: "/" });
  if (!connect) return c.redirect("/");
  const tempId = `u_${crypto.randomUUID()}`;
  const done = await connect.completeAuthorization({ userId: tempId, url: c.req.url, getCookie: (n) => getCookie(c, n) });
  if (done.clearCookieName) deleteCookie(c, done.clearCookieName, { path: "/" });
  if (done.outcome !== "connected") {
    console.log("web sign-in", done.outcome, done.code);
    return c.redirect("/?signin=failed");
  }
  const userId = await stableUserId(c.env, connect, tempId);
  const session: Session = { userId, ...(await profile(connect, userId)), profiled: Date.now() };
  const sid = crypto.randomUUID() + crypto.randomUUID();
  await c.env.OAUTH_KV.put(`sess:${sid}`, JSON.stringify(session), { expirationTtl: 30 * DAY });
  setCookie(c, SESSION, sid, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 30 * DAY });
  return c.redirect("/");
}

// ---- Pages (markup and style in web-ui.ts) ---------------------------

// The UI page runs the agent's code in a sandboxed frame inside it. No outside
// network: data only through /api/web/tool, which only this page can call.
const CSP_UI = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: https://assets.withone.ai; font-src data:; connect-src 'self'; frame-src 'self' about:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Before paint on /u/<id>: the remembered theme (fb-theme) or the system's. */
const UI_THEME = `(function(){var s=null;try{s=localStorage.getItem("fb-theme")}catch(e){}var d=s==="light"||s==="dark"?s==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d)})()`;

export const web = new Hono<{ Bindings: Env }>();

web.get("/", async (c) => {
  c.header("Content-Security-Policy", await pageCsp());
  const user = await sessionUser(c);
  const mcpUrl = `${c.env.PUBLIC_URL}/mcp`;
  if (!user) return c.html(landingPage(mcpUrl, c.req.query("signin") === "failed"));
  const q = (c.req.query("q") ?? "").slice(0, 100);
  const uis = await listUis(c.env.DB, user.userId, q);
  return c.html(blocksPage(user, uis, q, mcpUrl));
});

// Local design previews of the chat-app sign-in pages. Sample mode only
// (AUTH=off never runs on the live server), so they never exist in production.
web.get("/__preview/auth/:kind", async (c) => {
  if (c.env.AUTH !== "off") return c.notFound();
  const app = chatApp(c.req.query("host") ?? "claude.ai");
  const kind = c.req.param("kind");
  c.header("Content-Security-Policy", await authCsp());
  if (kind === "consent") return c.html(consentPage({ app, pendingId: "preview" }));
  if (kind === "connected") return c.html(connectedPage({ app, redirectTo: "#", who: { name: "Dana Reyes", email: "dana@acme.test" } }));
  return c.html(messagePage("This sign-in expired", "Sign-in links last ten minutes. Start again from your chat app."));
});

web.get("/login", async (c) => {
  if (c.env.AUTH === "off") return c.redirect("/");
  const connect = connectFor(c.env);
  if (!connect) return c.text("Sign in with One is not set up on this server.", 503);
  const { redirectUrl, cookie } = connect.startAuthorization();
  setCookie(c, cookie.name, cookie.value, { ...cookie.options, sameSite: "Lax" });
  setCookie(c, WEB_FLOW, "1", { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 600 });
  deleteCookie(c, "fb_pending", { path: "/" }); // this sign-in is for the website, not a chat app
  return c.redirect(redirectUrl);
});

web.post("/logout", async (c) => {
  const sid = getCookie(c, SESSION);
  if (sid) await c.env.OAUTH_KV.delete(`sess:${sid}`);
  deleteCookie(c, SESSION, { path: "/" });
  return c.redirect("/");
});

web.get("/u/:id", async (c) => {
  const user = await sessionUser(c);
  if (!user) return c.redirect("/login");
  const version = c.req.query("v") ? Number(c.req.query("v")) : undefined;
  const r = await loadRender(c.env.DB, user.userId, c.req.param("id"), version);
  if (!r) {
    c.header("Content-Security-Policy", await pageCsp());
    return c.html(notFoundPage(user), 404);
  }
  const versions = await listVersions(c.env.DB, user.userId, r.uiId);
  const boot = JSON.stringify({ render: renderPayload(r, c.env.PUBLIC_URL), versions: versions.map((v) => v.version), user: user.name }).replace(/</g, "\\u003c");
  c.header("Content-Security-Policy", CSP_UI);
  c.header("Cache-Control", "no-store");
  return c.html(canvasHtml.replace("<head>", `<head><script>window.__FB_WEB__=${boot};${UI_THEME}</script>`));
});

web.post("/u/:id/delete", async (c) => {
  const user = await sessionUser(c);
  if (!user) return c.redirect("/login");
  if (!sameOrigin(c)) return c.text("Forbidden", 403);
  await deleteUi(c.env.DB, user.userId, c.req.param("id"));
  return c.redirect("/");
});

// The UI page's only door to data. Same-origin pages only: the agent's code
// runs in an opaque-origin frame, so its requests carry Origin: null and no
// session cookie, and are refused here.
const WEB_TOOLS = new Set(["run_action"]);
web.post("/api/web/tool", async (c) => {
  if (!sameOrigin(c)) return c.json({ error: "forbidden" }, 403);
  const user = await sessionUser(c);
  if (!user) return c.json({ error: "signed_out" }, 401);
  const { name, args } = (await c.req.json().catch(() => ({}))) as { name?: string; args?: unknown };
  if (!name || !WEB_TOOLS.has(name)) return c.json({ error: "not_allowed" }, 400);
  const connect = c.env.AUTH === "off" ? null : connectFor(c.env);
  const result = await runTool(name, args ?? {}, {
    userId: user.userId,
    connect,
    kv: c.env.OAUTH_KV,
    db: c.env.DB,
    publicUrl: c.env.PUBLIC_URL,
  });
  return c.json(result);
});

function sameOrigin(c: C) {
  const origin = c.req.header("origin");
  return !!origin && origin === new URL(c.req.url).origin;
}
