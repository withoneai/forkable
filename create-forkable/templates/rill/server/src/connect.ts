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

interface GrantConnection { key: string; platform: string; name?: string; title?: string }

const MAIL_PLATFORMS: MailProviderKey[] = ["gmail", "outlook-mail"];
const CALENDAR_PLATFORMS: CalendarProviderKey[] = ["google-calendar", "outlook-calendar"];
const CALENDAR_FOR: Record<MailProviderKey, CalendarProviderKey[]> = {
  gmail: ["google-calendar", "outlook-calendar"],
  "outlook-mail": ["outlook-calendar", "google-calendar"],
};

/** A connection's own title or name, when it reads like the account's address. */
export function connectionEmail(c: { name?: string; title?: string }): string | null {
  for (const v of [c.title, c.name]) if (looksLikeEmail(v)) return v.trim().toLowerCase();
  return null;
}

/**
 * Which calendar connection goes with which mailbox, when the grant holds
 * several accounts. In order: a calendar a mailbox already has and the grant
 * still reaches; a calendar whose connection reads as the mailbox's address
 * (dana@gmail.com's Gmail gets dana@gmail.com's Google Calendar); then, for a
 * mailbox still without one, the next unclaimed calendar of its own vendor.
 * Mailboxes come first-connected first, so with one account of each kind
 * this is what the single-account code always did.
 */
export function pairCalendars(
  mailboxes: { id: string; mailProvider: MailProviderKey; address: string | null; calendarConnectionKey: string | null }[],
  calendars: GrantConnection[],
): Map<string, GrantConnection> {
  const out = new Map<string, GrantConnection>();
  const taken = new Set<string>();
  const claim = (mailboxId: string, c: GrantConnection) => { out.set(mailboxId, c); taken.add(c.key); };
  for (const m of mailboxes) {
    const kept = calendars.find((c) => c.key === m.calendarConnectionKey);
    if (kept) claim(m.id, kept);
  }
  for (const m of mailboxes) {
    if (out.has(m.id) || !m.address) continue;
    const same = calendars.find((c) => !taken.has(c.key) && connectionEmail(c) === m.address);
    if (same) claim(m.id, same);
  }
  for (const m of mailboxes) {
    if (out.has(m.id)) continue;
    for (const p of CALENDAR_FOR[m.mailProvider]) {
      // Never hand a mailbox a calendar that plainly belongs to another address.
      const next = calendars.find((c) => !taken.has(c.key) && c.platform === p && (!connectionEmail(c) || !m.address || connectionEmail(c) === m.address));
      if (next) { claim(m.id, next); break; }
    }
  }
  return out;
}

/**
 * After a connected callback: whoami, account merge, one live mailbox per
 * mail connection, a first sync.
 * Two emails, kept apart: whoami's is the One account (who signed in, and the
 * merge key), each mail provider's profile is that mailbox's address (what
 * "from me" means). They differ whenever someone signs in to One with a work
 * address and grants a personal Gmail, so a mailbox never takes the account
 * email when its provider answers.
 * A grant can hold several connections of one platform (two Gmail accounts,
 * a Gmail and an Outlook). Each becomes its own mailbox, keyed by its
 * connection key, and each pairs with its own account's calendar.
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
      return [] as GrantConnection[];
    }),
  ]);
  // Gmail accounts first, then Outlook, each in the order One lists them. The first is the one the app opens on.
  const mailConns = MAIL_PLATFORMS.flatMap((p) => connections.filter((c) => c.platform === p));
  const calendarConns = connections.filter((c) => (CALENDAR_PLATFORMS as string[]).includes(c.platform));
  if (mailConns.length === 0) log("the grant reaches no Gmail or Outlook connection");
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

  // 3. One live mailbox per mail connection. An existing mailbox is matched by
  // its connection key, then by address (a connection made again after a
  // removal gets a new key); a mailbox whose connection left the grant pauses
  // with its mail kept, and comes back when the account is granted again.
  const live = await db
    .select()
    .from(schema.mailboxes)
    .where(and(eq(schema.mailboxes.userId, targetId), eq(schema.mailboxes.mode, "connect")))
    .orderBy(schema.mailboxes.createdAt);
  // A new account starts from the settings of the user's first live mailbox (time zone, name, writing), so it skips the wizard; goals and VIPs stay per account.
  const [template] = live.length > 0
    ? await db.select().from(schema.settings).where(eq(schema.settings.mailboxId, live[0]!.id)).limit(1)
    : [];
  const claimed = new Set<string>();
  const ordered: string[] = [];
  for (const conn of mailConns) {
    const mailProvider = conn.platform as MailProviderKey;
    const mailLabel = MAIL_PROVIDERS[mailProvider].label;
    const connName = conn.title ?? conn.name ?? null;
    const guess = connectionEmail(conn);
    const match =
      live.find((m) => !claimed.has(m.id) && m.connectionKey === conn.key) ??
      (guess ? live.find((m) => !claimed.has(m.id) && m.mailProvider === mailProvider && m.address === guess && !mailConns.some((c) => c.key === m.connectionKey)) : undefined) ??
      // The single-account era: one connect mailbox, its connection replaced. Keep its mail rather than start over.
      (live.length === 1 && mailConns.length === 1 && live[0]!.mailProvider === mailProvider && !claimed.has(live[0]!.id) ? live[0] : undefined);
    if (match) {
      claimed.add(match.id);
      ordered.push(match.id);
      await db.update(schema.mailboxes).set({ connectionKey: conn.key, mailProvider, status: "active", ...(match.address ? {} : { address: guess }) }).where(eq(schema.mailboxes.id, match.id));
      continue;
    }
    const mailboxId = newId("mbx");
    claimed.add(mailboxId);
    ordered.push(mailboxId);
    await db.insert(schema.mailboxes).values({ id: mailboxId, userId: targetId, source: "live", mode: "connect", connectionKey: conn.key, mailProvider, address: guess, label: guess ?? connName ?? `Your ${mailLabel}` });
    if (template) {
      const { mailboxId: _from, updatedAt: _updated, ...rest } = template;
      await db.insert(schema.settings).values({ ...rest, mailboxId }).onConflictDoNothing();
    } else {
      await db.insert(schema.settings).values({ mailboxId, me: name ?? null }).onConflictDoNothing();
    }
    log(`new ${mailLabel} mailbox ${mailboxId}`);
  }
  for (const m of live) {
    if (claimed.has(m.id) || m.status === "paused") continue;
    await db.update(schema.mailboxes).set({ status: "paused" }).where(eq(schema.mailboxes.id, m.id));
    log(`mailbox ${m.id} paused: its connection is no longer in the grant`);
  }
  if (ordered.length === 0) return;
  const [userRow] = await db.select().from(schema.users).where(eq(schema.users.id, targetId)).limit(1);
  if (!userRow) return;

  // 4. Each mailbox's own address, from its mail provider, before the first sync reads "from me" off it.
  const rows = await Promise.all(ordered.map(async (mailboxId) => {
    let [row] = await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.id, mailboxId)).limit(1);
    if (!row) return null;
    const mailLabel = MAIL_PROVIDERS[row.mailProvider].label;
    const ctx = await buildCtx(deps, row, userRow);
    const address = await getMailProvider(row.mailProvider).address?.(ctx).catch((err: unknown) => {
      log(`${mailLabel} profile failed for ${mailboxId}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });
    if (address && address !== row.address) {
      // The label follows the address unless the user renamed the mailbox.
      const conn = mailConns.find((c) => c.key === row!.connectionKey);
      const guess = conn ? connectionEmail(conn) : null;
      const connName = conn ? (conn.title ?? conn.name ?? null) : null;
      const renamed = row.label !== (row.address ?? guess ?? connName ?? `Your ${mailLabel}`);
      await db.update(schema.mailboxes).set({ address, ...(renamed ? {} : { label: address }) }).where(eq(schema.mailboxes.id, mailboxId));
      [row] = await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.id, mailboxId)).limit(1);
    }
    return row ?? null;
  }));
  const mailboxes = rows.filter((r): r is NonNullable<typeof r> => !!r);

  // 5. Each mailbox's calendar: its own account's, never another account's.
  const pairs = pairCalendars(mailboxes, calendarConns);
  for (const m of mailboxes) {
    const cal = pairs.get(m.id);
    const next = cal ? { calendarProvider: cal.platform as CalendarProviderKey, calendarConnectionKey: cal.key } : { calendarProvider: null, calendarConnectionKey: null };
    if (next.calendarConnectionKey === m.calendarConnectionKey && next.calendarProvider === m.calendarProvider) continue;
    // A calendar the grant no longer reaches is dropped; one that was never set stays unset.
    if (!cal && !m.calendarConnectionKey) continue;
    await db.update(schema.mailboxes).set(next).where(eq(schema.mailboxes.id, m.id));
    m.calendarProvider = next.calendarProvider;
    m.calendarConnectionKey = next.calendarConnectionKey;
  }

  // 6. First sync and judge for each, off the request path.
  for (const m of mailboxes) {
    void scheduler.kick(m.id, { full: true });
    if (m.calendarConnectionKey) {
      const ctx = await buildCtx(deps, m, userRow);
      void calendar.syncCalendar(ctx).catch((err) => log(`calendar sync failed for ${m.id}: ${err instanceof Error ? err.message : String(err)}`));
    }
  }
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
