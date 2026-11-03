import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import type { AppEnv } from "../env";

// The app's own session (One Connect on, in preview and published): an
// anonymous user and a cookie exist before /api/one/authorize, so the
// Connect callback has a user to attach the grant to.

const COOKIE = "app_sid";
const DAYS = 30;

export async function sessionUserId(c: Context<AppEnv>): Promise<string | null> {
  const sid = getCookie(c, COOKIE);
  if (!sid) return null;
  const [s] = await db(c).select().from(schema.sessions).where(eq(schema.sessions.id, sid)).limit(1);
  if (!s || s.expiresAt.getTime() < Date.now()) return null;
  return s.userId;
}

/** The current user id, creating an anonymous user and session when there is none. */
export async function ensureSession(c: Context<AppEnv>): Promise<string> {
  const existing = await sessionUserId(c);
  if (existing) return existing;
  const d = db(c);
  const userId = crypto.randomUUID();
  const sid = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  await d.insert(schema.users).values({ id: userId });
  await d.insert(schema.sessions).values({ id: sid, userId, expiresAt: new Date(Date.now() + DAYS * 86_400_000) });
  setCookie(c, COOKIE, sid, { httpOnly: true, secure: new URL(c.req.url).protocol === "https:", sameSite: "Lax", path: "/", maxAge: DAYS * 86_400 });
  return userId;
}
