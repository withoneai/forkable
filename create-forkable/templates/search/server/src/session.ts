// The browser's session: cookie search_sid (httpOnly, SameSite=Lax, Secure on
// https, 400 days). The user row is created lazily on the first write.

import type { Context, MiddlewareHandler } from "hono";
import { generateCookie, getCookie, setCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { dbSchema, newId, type Db } from "@search/core";
import type { AppEnv, UserRow } from "./deps.js";
import { notSignedIn } from "./errors.js";

export const SID_COOKIE = "search_sid";
const MAX_AGE = 400 * 24 * 60 * 60;
const { sessions, users, connectUsers } = dbSchema;

const cookieOptions = (secure: boolean) => ({ httpOnly: true, sameSite: "Lax" as const, secure, path: "/", maxAge: MAX_AGE });

export function isSecure(c: Context): boolean {
  return new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https";
}

/** Mints search_sid when missing. */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", null);
  c.set("scopes", null);
  c.set("clientId", null);
  // A bearer request (CLI, scripts) never gets a browser session; apiBearer resolves it.
  if (/^Bearer\s/i.test(c.req.header("authorization") ?? "")) {
    c.set("sid", "");
    c.set("sidCookie", null);
    return next();
  }
  let sid = getCookie(c, SID_COOKIE);
  let minted: string | null = null;
  if (!sid || !/^[A-Za-z0-9_-]{16,80}$/.test(sid)) {
    sid = randomSid();
    setCookie(c, SID_COOKIE, sid, cookieOptions(isSecure(c)));
    minted = generateCookie(SID_COOKIE, sid, cookieOptions(isSecure(c)));
  }
  c.set("sid", sid);
  c.set("sidCookie", minted);
  c.set("user", null);
  c.set("scopes", null);
  c.set("clientId", null);
  await next();
};

function randomSid(): string {
  return `sid_${newId("usr").slice(4)}${newId("usr").slice(4)}`;
}

export async function userForSid(db: Db, sid: string): Promise<UserRow | null> {
  const [row] = await db.select({ user: users }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(eq(sessions.sid, sid)).limit(1);
  return row?.user ?? null;
}

/** The sid's user, created with its session row when missing. */
export async function ensureUserForSid(db: Db, sid: string): Promise<UserRow> {
  const existing = await userForSid(db, sid);
  if (existing) return existing;
  const id = newId("usr");
  const [user] = await db.insert(users).values({ id }).returning();
  await db.insert(sessions).values({ sid, userId: id }).onConflictDoUpdate({ target: sessions.sid, set: { userId: id, lastSeenAt: new Date() } });
  return (await userForSid(db, sid)) ?? user!;
}

/** Points the sid at a user (sample sign-in, merge). */
export async function bindSid(db: Db, sid: string, userId: string): Promise<void> {
  await db.insert(sessions).values({ sid, userId }).onConflictDoUpdate({ target: sessions.sid, set: { userId, lastSeenAt: new Date() } });
}

export async function currentUser(c: Context<AppEnv>): Promise<UserRow | null> {
  const cached = c.get("user");
  if (cached) return cached;
  const user = await userForSid(c.get("deps").db, c.get("sid"));
  if (user) c.set("user", user);
  return user;
}

/** A signed-in user: the sample user, or one whose sid finished Sign in with One. */
export async function signedInUser(c: Context<AppEnv>): Promise<UserRow | null> {
  const u = await currentUser(c);
  if (!u) return null;
  if (u.isSample) return u;
  const [cu] = await c.get("deps").db.select({ id: connectUsers.userId }).from(connectUsers).where(eq(connectUsers.userId, u.id)).limit(1);
  return cu ? u : null;
}

export async function requireUser(c: Context<AppEnv>): Promise<UserRow> {
  const u = await signedInUser(c);
  if (!u) throw notSignedIn();
  return u;
}
