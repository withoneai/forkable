import type { Context, MiddlewareHandler } from "hono";
import { generateCookie, getCookie, setCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { newId, schema, type Db, type UserRow } from "@rill/core";
import type { AppEnv } from "./deps.js";

export const SID_COOKIE = "rill_sid";
const MAX_AGE = 400 * 24 * 60 * 60; // 400 days, the browser cap

const cookieOptions = (secure: boolean) => ({
  httpOnly: true,
  sameSite: "Lax" as const,
  secure,
  path: "/",
  maxAge: MAX_AGE,
});

/** Mints rill_sid when missing. No user row yet: that happens on the first write. */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  let sid = getCookie(c, SID_COOKIE);
  const secure = new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https";
  let minted: string | null = null;
  if (!sid || !/^[A-Za-z0-9_-]{16,80}$/.test(sid)) {
    sid = newId("sid");
    setCookie(c, SID_COOKIE, sid, cookieOptions(secure));
    minted = generateCookie(SID_COOKIE, sid, cookieOptions(secure));
  }
  c.set("sid", sid);
  c.set("sidCookie", minted);
  c.set("user", null);
  await next();
};

/** The user behind a sid, or null when the sid has never written anything. */
export async function userForSid(db: Db, sid: string): Promise<UserRow | null> {
  const [row] = await db
    .select({ user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.sid, sid))
    .limit(1);
  return row?.user ?? null;
}

/** The user behind a sid, created together with the session row when missing. */
export async function ensureUserForSid(db: Db, sid: string): Promise<UserRow> {
  const existing = await userForSid(db, sid);
  if (existing) return existing;
  const id = newId("usr");
  const [user] = await db.insert(schema.users).values({ id }).returning();
  if (!user) throw new Error("could not create the user row");
  await db.insert(schema.sessions).values({ sid, userId: id }).onConflictDoNothing();
  // Another request may have won the race: read back whoever the sid points at.
  return (await userForSid(db, sid)) ?? user;
}

/** Resolves (and caches on the context) the current user. `create` makes one on first write. */
export async function currentUser(c: Context<AppEnv>, opts: { create: boolean }): Promise<UserRow | null> {
  const cached = c.get("user");
  if (cached) return cached;
  const db = c.get("deps").db;
  const sid = c.get("sid");
  const user = opts.create ? await ensureUserForSid(db, sid) : await userForSid(db, sid);
  if (user) c.set("user", user);
  return user;
}
