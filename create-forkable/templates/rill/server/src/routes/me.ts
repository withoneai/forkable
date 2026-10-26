import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { one, schema, type ApiMailbox, type MeResponse } from "@rill/core";
import { connectConfigured } from "../config.js";
import { onConnected, whoami } from "../connect.js";
import type { AppEnv } from "../deps.js";
import { currentUser, SID_COOKIE } from "../session.js";
import { toApiMailbox } from "./lib.js";

export const meRoutes = new Hono<AppEnv>();

/** Users the /me backfill already asked whoami about, for the life of the process. */
const whoamiTried = new Set<string>();

meRoutes.get("/me", async (c) => {
  const deps = c.get("deps");
  const user = await currentUser(c, { create: false });
  let mailboxes: ApiMailbox[] = [];
  let connected = false;
  let platforms: string[] = [];
  if (user) {
    const rows = await deps.db.select().from(schema.mailboxes).where(eq(schema.mailboxes.userId, user.id)).orderBy(schema.mailboxes.createdAt);
    mailboxes = await Promise.all(rows.map((m) => toApiMailbox(deps.db, m)));
    if (deps.oneConnect) connected = await deps.oneConnect.isConnected(user.id).catch(() => false);
    if (connected) {
      platforms = [...(await one.grantedConnections(deps.oneConnect, user.id)).keys()];
      // Signed in before the grant carried user:profile:read (or before whoami answered Connect users): try once per process.
      if ((!user.email || !user.oneUserId || !user.avatarUrl) && !whoamiTried.has(user.id)) {
        whoamiTried.add(user.id);
        const who = await whoami(deps.oneConnect!, user.id).catch(() => null);
        const patch = { ...(who?.name && !user.name ? { name: who.name } : {}), ...(who?.email ? { email: who.email } : {}), ...(who?.id ? { oneUserId: who.id } : {}), ...(who?.avatarUrl ? { avatarUrl: who.avatarUrl } : {}) };
        if (Object.keys(patch).length > 0) {
          await deps.db.update(schema.users).set(patch).where(eq(schema.users.id, user.id));
          Object.assign(user, patch);
        }
      }
      // A grant with no live mailbox means the callback's follow-up never finished (or a merge moved it). Finish it now.
      if (platforms.includes("gmail") && !rows.some((m) => m.mode === "connect")) {
        await onConnected(deps, user.id).catch((err: unknown) => console.error(`[rill] connect: finish failed: ${err instanceof Error ? err.message : String(err)}`));
        const again = await deps.db.select().from(schema.mailboxes).where(eq(schema.mailboxes.userId, user.id)).orderBy(schema.mailboxes.createdAt);
        mailboxes = await Promise.all(again.map((m) => toApiMailbox(deps.db, m)));
      }
    }
  }
  const body: MeResponse = {
    user: user ? { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl ?? null } : null,
    mailboxes,
    connect: { configured: connectConfigured(deps.env), connected },
    grant: { platforms },
    local: deps.env.LOCAL,
  };
  return c.json(body);
});

meRoutes.post("/signout", (c) => {
  deleteCookie(c, SID_COOKIE, { path: "/" });
  return c.body(null, 204);
});

meRoutes.post("/connect/disconnect", async (c) => {
  const deps = c.get("deps");
  const user = await currentUser(c, { create: false });
  if (user && deps.oneConnect) {
    await deps.oneConnect.disconnect(user.id).catch(() => {});
    await deps.db.update(schema.mailboxes).set({ status: "paused" })
      .where(eq(schema.mailboxes.userId, user.id));
    // Only Connect mailboxes pause; the sample keeps going.
    await deps.db.update(schema.mailboxes).set({ status: "active" })
      .where(eq(schema.mailboxes.userId, user.id));
    const rows = await deps.db.select().from(schema.mailboxes).where(eq(schema.mailboxes.userId, user.id));
    for (const m of rows) if (m.mode === "connect") await deps.db.update(schema.mailboxes).set({ status: "paused" }).where(eq(schema.mailboxes.id, m.id));
  }
  return c.body(null, 204);
});
