// Sign in with One. Connect is the only login: search_sid is the correlation id,
// and the callback is the one place Search learns who someone is (whoami on the
// grant). The same person on a second device gets a new sid but the same cu_
// back, so the callback merges accounts by cu_, One user id or email before
// anything else, then makes one source per indexable connection and kicks the
// first runs off the request path.
//
// The authorize and callback legs call startAuthorization / completeAuthorization
// directly in Hono (the blocks MCP pattern), the same code the OAuth sign-in for
// the CLI and MCP reuses in Phase 3.

import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { and, eq, ne } from "drizzle-orm";
import { createOneConnect, parseUserReference, type OneConnectClient, type OneConnectKeyClient } from "@withone/connect/server";
import { dbSchema, ensureSources, forgetGrant, grantedConnections, type Db } from "@search/core";
import { connectConfigured, type ServerEnv } from "./config.js";
import type { AppEnv, Deps } from "./deps.js";
import { bindSid, currentUser, ensureUserForSid } from "./session.js";
import { newId } from "@search/core";
import { denyPending, dropPending, finishPending, loadPending, PENDING_COOKIE } from "./oauth.js";

const { users, sessions, connectUsers, settings, sources } = dbSchema;

export function createConnect(env: ServerEnv, db: Db): OneConnectKeyClient | null {
  if (!connectConfigured(env)) return null;
  // 0.19's default scopes already include user:profile:read (whoami, /users/me).
  return createOneConnect({
    clientId: env.ONE_CLIENT_ID!,
    clientSecret: env.ONE_CLIENT_SECRET!,
    redirectUri: env.ONE_REDIRECT_URI!,
    permissionSet: env.ONE_PERMISSION_SET,
    connectKey: env.ONE_CONNECT_KEY!,
    returnTo: "/",
    userStore: {
      async saveUser(userId, reference) {
        const connectUserId = parseUserReference(reference)?.connectUserId ?? null;
        await db.insert(connectUsers).values({ userId, reference, connectUserId, updatedAt: new Date() })
          .onConflictDoUpdate({ target: connectUsers.userId, set: { reference, connectUserId, updatedAt: new Date() } });
      },
      async loadUser(userId) {
        const [row] = await db.select().from(connectUsers).where(eq(connectUsers.userId, userId)).limit(1);
        return row?.reference ?? null;
      },
      async clearUser(userId) {
        await db.delete(connectUsers).where(eq(connectUsers.userId, userId));
      },
    },
  }) as OneConnectKeyClient;
}

interface Whoami { user?: { id?: string; name?: string | null; email?: string | null } }
interface OneMe { id?: string; avatar?: string | null; email?: string | null; firstName?: string | null; lastName?: string | null }
export interface OneProfile { id: string | null; name: string | null; email: string | null; avatarUrl: string | null }

const isPlaceholderAvatar = (url: string) => /picsum\.photos/.test(url);

/** The One account behind the grant: /users/whoami for who, /users/me for the picture. Paths have no /v1. */
export async function whoami(oneConnect: OneConnectClient, userId: string): Promise<OneProfile | null> {
  const read = async <T>(path: string): Promise<T> => {
    const res = await oneConnect.fetch(userId, path);
    if (!res.ok) throw new Error(`${path} answered ${res.status}`);
    return (await res.json()) as T;
  };
  const [who, me] = await Promise.allSettled([read<Whoami>("/users/whoami"), read<OneMe>("/users/me")]);
  if (who.status === "rejected" && me.status === "rejected") throw who.reason;
  const u = who.status === "fulfilled" ? who.value.user : undefined;
  const m = me.status === "fulfilled" ? me.value : undefined;
  if (!u && !m) return null;
  const meName = [m?.firstName, m?.lastName].filter(Boolean).join(" ").trim();
  const avatar = m?.avatar?.trim();
  return {
    id: u?.id ?? m?.id ?? null,
    name: u?.name?.trim() || meName || null,
    email: (u?.email ?? m?.email)?.trim().toLowerCase() || null,
    avatarUrl: avatar && /^https:\/\//.test(avatar) && !isPlaceholderAvatar(avatar) ? avatar : null,
  };
}

export interface ConnectedResult { userId: string; merged: boolean; sourceIds: string[] }

/** After a connected callback: whoami, account merge, sources, first runs. Returns the account the session now points at.
 *  `oauth`: the sign-in came from a CLI or MCP client (/oauth/consent). It identifies the person and never replaces the
 *  grant the account already holds (D41): the web keeps its own reference. */
export async function onConnected(deps: Deps, userId: string, opts: { oauth?: boolean } = {}): Promise<ConnectedResult> {
  const { db } = deps;
  const oneConnect = deps.oneConnect;
  if (!oneConnect) return { userId, merged: false, sourceIds: [] };
  const log = (line: string) => deps.log(`[search] connect: ${line}`);
  forgetGrant(userId);

  const who = await whoami(oneConnect, userId).catch((err: unknown) => {
    log(`whoami failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  const email = who?.email ?? null;
  const oneUserId = who?.id ?? null;

  // Account merge: another row already holds this cu_, this One user id, or this email.
  const [mine] = await db.select().from(connectUsers).where(eq(connectUsers.userId, userId)).limit(1);
  const cu = mine?.connectUserId ?? null;
  let existing: { id: string } | undefined;
  if (cu) [existing] = await db.select({ id: connectUsers.userId }).from(connectUsers).where(and(eq(connectUsers.connectUserId, cu), ne(connectUsers.userId, userId))).limit(1);
  if (!existing && oneUserId) [existing] = await db.select({ id: users.id }).from(users).where(and(eq(users.oneUserId, oneUserId), ne(users.id, userId), eq(users.isSample, false))).limit(1);
  if (!existing && email) [existing] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, email), ne(users.id, userId), eq(users.isSample, false))).limit(1);
  let targetId = userId;
  if (existing && mine) {
    targetId = existing.id;
    const [held] = await db.select().from(connectUsers).where(eq(connectUsers.userId, targetId)).limit(1);
    // a CLI or MCP sign-in keeps the account's reference (and the space it points at); a web sign-in replaces it
    const keepHeld = !!opts.oauth && !!held;
    await db.transaction(async (tx) => {
      await tx.update(sessions).set({ userId: targetId }).where(eq(sessions.userId, userId));
      if (keepHeld) {
        await tx.delete(connectUsers).where(eq(connectUsers.userId, userId));
      } else {
        await tx.delete(connectUsers).where(eq(connectUsers.userId, targetId));
        await tx.update(connectUsers).set({ userId: targetId }).where(eq(connectUsers.userId, userId));
      }
      // The orphan was minted seconds ago for this sign-in: nothing of its own to keep.
      await tx.delete(settings).where(eq(settings.userId, userId));
      await tx.delete(users).where(eq(users.id, userId));
    });
    forgetGrant(targetId);
    log(`merged a fresh session into an existing account${keepHeld ? " (kept its grant reference)" : ""}`);
  }
  const patch = { ...(who?.name ? { name: who.name } : {}), ...(email ? { email } : {}), ...(oneUserId ? { oneUserId } : {}), ...(who?.avatarUrl ? { avatarUrl: who.avatarUrl } : {}) };
  if (Object.keys(patch).length) await db.update(users).set(patch).where(eq(users.id, targetId));

  // One reads consent live, so a consent screen that ran again can still have changed the grant itself.
  // Say so when platforms Search indexes are gone; the sources and the semantic banner show it in the app.
  try {
    const now = new Set((await grantedConnections(oneConnect, targetId)).map((c) => c.platform));
    const had = await db.selectDistinct({ platform: sources.platform }).from(sources).where(and(eq(sources.userId, targetId), ne(sources.status, "awaiting_grant")));
    const gone = had.map((h) => h.platform).filter((p) => !now.has(p));
    if (gone.length) log(`this sign-in's grant no longer has ${gone.join(", ")}${opts.oauth ? " (signed in from a CLI or MCP client)" : ""}`);
  } catch { /* a check only */ }

  // One source per indexable connection x enabled built-in profile, then the first runs.
  let sourceIds: string[] = [];
  try {
    sourceIds = await ensureSources(deps.ctx, targetId);
  } catch (err) {
    log(`could not list the grant's connections: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const id of sourceIds) deps.scheduler.kick(id, { trigger: "first" });
  return { userId: targetId, merged: targetId !== userId, sourceIds };
}

/** A sample session signing in with One gets its own fresh account, never the shared sample user. */
async function realUserForSid(deps: Deps, c: Context<AppEnv>): Promise<string> {
  const sid = c.get("sid");
  const u = await currentUser(c);
  if (u && !u.isSample) return u.id;
  if (u?.isSample) {
    const id = newId("usr");
    await deps.db.insert(users).values({ id });
    await bindSid(deps.db, sid, id);
    c.set("user", null);
    return id;
  }
  return (await ensureUserForSid(deps.db, sid)).id;
}

export function mountConnectRoutes(app: Hono<AppEnv>, deps: Deps): void {
  app.get("/api/one/authorize", async (c) => {
    const oneConnect = deps.oneConnect;
    if (!oneConnect) return c.json({ error: { code: "not_found", message: "Sign in with One is not set up on this server. Open /setup/connect." } }, 404);
    await realUserForSid(deps, c);
    // A plain web sign-in must not finish an abandoned OAuth request from this browser.
    if (c.req.query("oauth") !== "1" && getCookie(c, PENDING_COOKIE)) deleteCookie(c, PENDING_COOKIE, { path: "/" });
    const returnTo = c.req.query("returnTo");
    const r = await oneConnect.startAuthorization({ returnTo: returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : undefined });
    setCookie(c, r.cookie.name, r.cookie.value, { httpOnly: true, secure: r.cookie.options.secure, sameSite: "Lax", maxAge: r.cookie.options.maxAge, path: r.cookie.options.path });
    return c.redirect(r.redirectUrl, 302);
  });

  app.get("/api/one/callback", async (c) => {
    const oneConnect = deps.oneConnect;
    if (!oneConnect) return c.redirect("/?one_connect=error&one_connect_error=failed", 302);
    const userId = await realUserForSid(deps, c);
    const result = await oneConnect.completeAuthorization({ userId, url: c.req.url, getCookie: (name) => getCookie(c, name) });
    if (result.clearCookieName) deleteCookie(c, result.clearCookieName, { path: "/" });
    // An OAuth sign-in (CLI, MCP client) started from /oauth/consent carries the pending cookie.
    const pending = await loadPending(deps, c);
    let accountId = userId;
    if (result.outcome === "connected") {
      try {
        accountId = (await onConnected(deps, userId, { oauth: !!pending })).userId;
      } catch (err) {
        deps.log(`[search] connect: post-callback step failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (pending) return finishPending(deps, c, pending, accountId);
    } else {
      deps.log(`[search] connect: flow ended ${result.outcome}${result.code ? ` (${result.code})` : ""}`);
      if (pending) return denyPending(deps, c, pending, "access_denied", "Sign in with One did not finish.");
    }
    if (getCookie(c, PENDING_COOKIE)) await dropPending(deps, c, getCookie(c, PENDING_COOKIE)!);
    return c.redirect(result.redirectUrl, 302);
  });
}
