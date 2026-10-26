import type { IncomingMessage } from "node:http";
import type { Hono } from "hono";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { createOneConnect, parseUserReference, type OneConnectClient, type OneConnectKeyClient } from "@withone/connect/server";
import { createOneConnectHandlers } from "@withone/connect/node";
import { and, eq, ne } from "drizzle-orm";
import { MAIL_PROVIDERS, calendar, getMailProvider, newId, one, schema, type CalendarProviderKey, type Db, type MailProviderKey } from "@rill/core";
import { connectConfigured, type ServerEnv } from "./config.js";
import { buildCtx } from "./ctx.js";
import type { AppEnv, Deps } from "./deps.js";
import { ensureUserForSid } from "./session.js";

// Sign in with One. Connect is the only login: the rill_sid cookie is the
// correlation id identifyUser hands the package, and the callback is the one
// place Rill learns who someone is (GET /v1/users/whoami on the grant). The
// same person on a second device gets a new sid but the same cu_… back, so
// the callback merges accounts by cu_…, One user id or One email before
// anything else happens.

const CONNECTION_SCOPES = ["user:connections:read", "user:connections:write", "org:connections:read", "org:connections:write", "project:connections:read", "project:connections:write"];

export function createConnect(env: ServerEnv, db: Db): OneConnectKeyClient | null {
  if (!connectConfigured(env)) return null;
  return createOneConnect({
    clientId: env.ONE_CLIENT_ID!,
    clientSecret: env.ONE_CLIENT_SECRET!,
    redirectUri: env.ONE_REDIRECT_URI!,
    permissionSet: env.ONE_PERMISSION_SET,
    connectKey: env.ONE_CONNECT_KEY!,
    // The package's defaults (connections at every tier) plus the profile, which
    // /v1/users/whoami and /v1/users/me need on a Connect grant. A grant consented
    // without it answers both with 403, so it is asked for at sign-in.
    scopes: [...CONNECTION_SCOPES, "user:profile:read"],
    returnTo: "/",
    userStore: {
      async saveUser(userId, reference) {
        const connectUserId = parseUserReference(reference)?.connectUserId ?? null;
        await db
          .insert(schema.connectUsers)
          .values({ userId, reference, connectUserId })
          .onConflictDoUpdate({ target: schema.connectUsers.userId, set: { reference, connectUserId } });
      },
      async loadUser(userId) {
        const [row] = await db.select().from(schema.connectUsers).where(eq(schema.connectUsers.userId, userId)).limit(1);
        return row?.reference ?? null;
      },
      async clearUser(userId) {
        await db.delete(schema.connectUsers).where(eq(schema.connectUsers.userId, userId));
      },
    },
  });
}

interface Whoami { user?: { id?: string; name?: string | null; email?: string | null } }
interface OneMe { id?: string; avatar?: string | null; email?: string | null; firstName?: string | null; lastName?: string | null }

export interface OneProfile { id: string | null; name: string | null; email: string | null; avatarUrl: string | null }

/** One stands in this picture when a profile has none; it is not the person. */
const isPlaceholderAvatar = (url: string) => /picsum\.photos/.test(url);

/**
 * The One account behind the grant: GET /v1/users/whoami for who, GET
 * /v1/users/me for the profile picture (whoami carries none). Both need the
 * grant's user:profile:read scope. Throws when neither answers.
 */
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

const looksLikeEmail = (v: string | null | undefined): v is string => !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/**
 * After a connected callback: whoami, account merge, the live mailbox, a first sync.
 * Two emails, kept apart: whoami's is the One account (who signed in, and the
 * merge key), Gmail's profile is the mailbox (what "from me" means). They
 * differ whenever someone signs in to One with a work address and grants a
 * personal Gmail, so the mailbox never takes the account email when Gmail answers.
 */
export async function onConnected(deps: Deps, userId: string): Promise<void> {
  const { db, oneConnect, scheduler } = deps;
  if (!oneConnect) return;
  const log = (line: string) => console.log(`[rill] connect: ${line}`);
  one.forgetGrant(userId);

  // 1. Who just connected, and what the grant reaches.
  const [who, connections] = await Promise.all([
    whoami(oneConnect, userId).catch((err: unknown) => {
      log(`whoami failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }),
    oneConnect.listConnections(userId).catch((err: unknown) => {
      log(`listConnections failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }),
  ]);
  // Gmail first, else Outlook. The calendar follows the mail's vendor when the grant has both kinds.
  const mailConn = connections.find((c) => c.platform === "gmail") ?? connections.find((c) => c.platform === "outlook-mail");
  if (!mailConn) log("the grant reaches no Gmail or Outlook connection");
  const mailProvider: MailProviderKey = mailConn?.platform === "outlook-mail" ? "outlook-mail" : "gmail";
  const mailLabel = MAIL_PROVIDERS[mailProvider].label;
  const gmailKey = mailConn?.key ?? null;
  const gmailName = mailConn ? (mailConn.title ?? mailConn.name ?? null) : null;
  const calendarOrder: CalendarProviderKey[] = mailProvider === "outlook-mail" ? ["outlook-calendar", "google-calendar"] : ["google-calendar", "outlook-calendar"];
  const calendarConn = calendarOrder.map((p) => connections.find((c) => c.platform === p)).find(Boolean);
  const calendarKey = calendarConn?.key ?? null;
  const calendarProvider = calendarConn?.platform as CalendarProviderKey | undefined;
  const email = who?.email ?? null;
  const name = who?.name ?? null;
  const oneUserId = who?.id ?? null;

  // 2. Account merge: another user row already holds this cu_…, this One user id, or this One email.
  const [mine] = await db.select().from(schema.connectUsers).where(eq(schema.connectUsers.userId, userId)).limit(1);
  const connectUserId = mine?.connectUserId ?? null;
  let targetId = userId;
  let existing: { id: string } | undefined;
  if (connectUserId) {
    [existing] = await db
      .select({ id: schema.connectUsers.userId })
      .from(schema.connectUsers)
      .where(and(eq(schema.connectUsers.connectUserId, connectUserId), ne(schema.connectUsers.userId, userId)))
      .limit(1);
  }
  if (!existing && oneUserId) {
    [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.oneUserId, oneUserId), ne(schema.users.id, userId))).limit(1);
  }
  if (!existing && email) {
    [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.email, email), ne(schema.users.id, userId))).limit(1);
  }
  if (existing && mine) {
    targetId = existing.id;
    await db.transaction(async (tx) => {
      await tx.update(schema.sessions).set({ userId: targetId }).where(eq(schema.sessions.userId, userId));
      await tx.delete(schema.connectUsers).where(eq(schema.connectUsers.userId, targetId));
      await tx.update(schema.connectUsers).set({ userId: targetId }).where(eq(schema.connectUsers.userId, userId));
      // The orphan has no mailboxes of its own worth keeping: it was minted seconds ago for this sign-in.
      const [orphanMailbox] = await tx.select({ id: schema.mailboxes.id }).from(schema.mailboxes).where(eq(schema.mailboxes.userId, userId)).limit(1);
      if (orphanMailbox) await tx.update(schema.mailboxes).set({ userId: targetId }).where(eq(schema.mailboxes.userId, userId));
      await tx.delete(schema.users).where(eq(schema.users.id, userId));
    });
    log(`merged a fresh session into an existing account`);
  }
  const avatarUrl = who?.avatarUrl ?? null;
  const patch = { ...(name ? { name } : {}), ...(email ? { email } : {}), ...(oneUserId ? { oneUserId } : {}), ...(avatarUrl ? { avatarUrl } : {}) };
  if (Object.keys(patch).length > 0) await db.update(schema.users).set(patch).where(eq(schema.users.id, targetId));

  // 3. The live mailbox over the first mail connection the grant reaches.
  if (!gmailKey) return;

  const [current] = await db
    .select()
    .from(schema.mailboxes)
    .where(and(eq(schema.mailboxes.userId, targetId), eq(schema.mailboxes.mode, "connect")))
    .limit(1);
  // Until the provider answers, the connection's own title is the best guess at the address.
  const guess = looksLikeEmail(gmailName) ? gmailName.trim().toLowerCase() : null;
  let mailboxId: string;
  const calendarPatch = calendarKey && calendarProvider ? { calendarProvider, calendarConnectionKey: calendarKey } : {};
  if (current) {
    mailboxId = current.id;
    await db.update(schema.mailboxes).set({ connectionKey: gmailKey, mailProvider, status: "active", ...(current.address ? {} : { address: guess }), ...calendarPatch }).where(eq(schema.mailboxes.id, current.id));
  } else {
    mailboxId = newId("mbx");
    await db.insert(schema.mailboxes).values({ id: mailboxId, userId: targetId, source: "live", mode: "connect", connectionKey: gmailKey, mailProvider, address: guess, label: guess ?? gmailName ?? `Your ${mailLabel}`, ...calendarPatch });
    await db.insert(schema.settings).values({ mailboxId, me: name ?? null }).onConflictDoNothing();
  }

  // 4. The mailbox's own address, from the mail provider, before the first sync reads "from me" off it.
  let [mailboxRow] = await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.id, mailboxId)).limit(1);
  const [userRow] = await db.select().from(schema.users).where(eq(schema.users.id, targetId)).limit(1);
  if (!mailboxRow || !userRow) return;
  const ctx = await buildCtx(deps, mailboxRow, userRow);
  const address = await getMailProvider(mailboxRow.mailProvider).address?.(ctx).catch((err: unknown) => {
    log(`${mailLabel} profile failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  if (address && address !== mailboxRow.address) {
    // The label follows the address unless the user renamed the mailbox.
    const renamed = mailboxRow.label !== (mailboxRow.address ?? guess ?? gmailName ?? `Your ${mailLabel}`);
    await db.update(schema.mailboxes).set({ address, ...(renamed ? {} : { label: address }) }).where(eq(schema.mailboxes.id, mailboxId));
    [mailboxRow] = await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.id, mailboxId)).limit(1);
    ctx.mailbox = mailboxRow!;
  }

  // 5. First sync and judge, off the request path.
  void scheduler.kick(mailboxId, { full: true });
  if (calendarKey) void calendar.syncCalendar(ctx).catch((err) => log(`calendar sync failed: ${err instanceof Error ? err.message : String(err)}`));
}

/**
 * GET /api/one/authorize and /api/one/callback through the Node adapter, on the raw req/res.
 * The client is read per request: the setup screen can turn Connect on, or
 * swap the app, while the server runs.
 */
export function mountConnectRoutes(app: Hono<AppEnv>, deps: Deps): void {
  // The adapter sees Node's IncomingMessage; the sid lives on Hono's context. Bridge per request.
  const sidFor = new WeakMap<IncomingMessage, string>();
  const handlersFor = new WeakMap<OneConnectKeyClient, ReturnType<typeof createOneConnectHandlers>>();
  const handlers = (oneConnect: OneConnectKeyClient) => {
    let h = handlersFor.get(oneConnect);
    if (h) return h;
    h = createOneConnectHandlers(oneConnect, {
      identifyUser: async (req) => {
        const sid = sidFor.get(req);
        if (!sid) return null;
        const user = await ensureUserForSid(deps.db, sid);
        return user.id;
      },
      onComplete: async ({ userId, result }) => {
        if (result.outcome === "connected") {
          try {
            await onConnected(deps, userId);
          } catch (err) {
            console.error(`[rill] connect: post-callback step failed: ${err instanceof Error ? err.message : String(err)}`);
          }
          return;
        }
        // For our logs only. Never shown to the user.
        console.log(`[rill] connect: flow ended ${result.outcome}${result.message ? `: ${result.message}` : ""}`);
      },
    });
    handlersFor.set(oneConnect, h);
    return h;
  };

  const serve = (which: "authorize" | "callback") => async (c: import("hono").Context<AppEnv>) => {
    const oneConnect = deps.oneConnect as OneConnectKeyClient | null;
    if (!oneConnect) {
      if (which === "callback") return c.redirect("/?one_connect=error&one_connect_error=failed");
      return c.json({ error: { code: "connect_not_configured", message: "Sign in with One is not configured on this server." } }, 404);
    }
    const req = c.env.incoming;
    const res = c.env.outgoing;
    sidFor.set(req, c.get("sid"));
    // A sid minted on this very request must survive the adapter's own Set-Cookie.
    const minted = c.get("sidCookie");
    if (minted) {
      res.setHeader("Set-Cookie", [minted]);
      const original = res.setHeader.bind(res);
      res.setHeader = ((name: string, value: number | string | readonly string[]) => {
        if (name.toLowerCase() === "set-cookie") {
          const list = Array.isArray(value) ? [...value] : [String(value)];
          if (!list.includes(minted)) list.push(minted);
          return original(name, list);
        }
        return original(name, value);
      }) as typeof res.setHeader;
    }
    await handlers(oneConnect)[which](req, res);
    return RESPONSE_ALREADY_SENT;
  };

  app.get("/api/one/authorize", serve("authorize"));
  app.get("/api/one/callback", serve("callback"));
}
