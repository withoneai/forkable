import { createOneConnect, type OneConnectKeyClient } from "@withone/connect/server";
import { createOneConnectHandlers } from "@withone/connect/node";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import type { Context, Hono } from "hono";
import type { Env } from "./env.js";
import type { AppEnv } from "./server-env.js";

// One string per user: their permanent One id and the space they granted
// from. Swap this in-memory map for a column on the user's row once this
// fork has its own database.
const userStore = new Map<string, string>();

export function createOneConnectClient(env: Env): OneConnectKeyClient | null {
  if (!env.oneClientId || !env.oneClientSecret || !env.oneConnectKey || !env.oneRedirectUri) {
    return null;
  }
  return createOneConnect({
    clientId: env.oneClientId,
    clientSecret: env.oneClientSecret,
    redirectUri: env.oneRedirectUri,
    connectKey: env.oneConnectKey,
    permissionSet: env.onePermissionSet,
    userStore: {
      saveUser: async (userId, reference) => void userStore.set(userId, reference),
      loadUser: async (userId) => userStore.get(userId) ?? null,
      clearUser: async (userId) => void userStore.delete(userId),
    },
  });
}

/**
 * GET /api/one/authorize and /api/one/callback on Hono-over-Node. The
 * node adapter wants the raw IncomingMessage/ServerResponse, which
 * @hono/node-server exposes as `c.env.incoming`/`c.env.outgoing`;
 * RESPONSE_ALREADY_SENT tells Hono the handler already wrote the
 * response itself. Replace `identifyUser` with this fork's own session
 * lookup once it has one; a single fixed id is fine for a one-user demo.
 */
export function mountConnectRoutes(app: Hono<AppEnv>, oneConnect: OneConnectKeyClient | null): void {
  if (!oneConnect) {
    app.get("/api/one/authorize", (c) => c.json({ error: { code: "connect_not_configured", message: "Sign in with One is not configured on this server." } }, 404));
    app.get("/api/one/callback", (c) => c.redirect("/?one_connect=error&one_connect_error=failed"));
    return;
  }

  const handlers = createOneConnectHandlers(oneConnect, {
    identifyUser: async () => "demo-user",
    onComplete: ({ userId, result }) => {
      if (result.outcome !== "connected") console.log(`[forkable-starter] connect: flow ended ${result.outcome}${result.message ? `: ${result.message}` : ""}`);
    },
  });

  const serve = (which: "authorize" | "callback") => async (c: Context<AppEnv>) => {
    await handlers[which](c.env.incoming, c.env.outgoing);
    return RESPONSE_ALREADY_SENT;
  };

  app.get("/api/one/authorize", serve("authorize"));
  app.get("/api/one/callback", serve("callback"));
}
