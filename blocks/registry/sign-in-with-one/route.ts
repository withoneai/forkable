import { Hono, type Context } from "hono";
import type { OneConnectClient } from "@withone/connect/server";
import { createOneConnectHandlers } from "@withone/connect/node";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import type { IncomingMessage } from "node:http";

// Sign in with One: the two Connect routes (authorize, callback) plus a
// status route the button reads. The user's grant is stored by the Connect
// client's userStore (see src/connect.ts in the starter).

export interface SignInWithOneOptions {
  connect: OneConnectClient | null | (() => OneConnectClient | null);
  /** Your session lookup, from a Hono request. */
  userId: (c: Context) => string | Promise<string>;
  /** The same lookup on the raw Node request, for the callback. */
  identifyUser: (req: IncomingMessage) => string | null | Promise<string | null>;
}

export function signInWithOneRoute(opts: SignInWithOneOptions) {
  const r = new Hono();
  const client = () => (typeof opts.connect === "function" ? opts.connect() : opts.connect);

  r.get("/api/one/status", async (c) => {
    const connect = client();
    if (!connect) return c.json({ data: { configured: false, connected: false, connections: [] } });
    const userId = await opts.userId(c);
    const connected = await connect.isConnected(userId);
    const connections = connected ? (await connect.listConnections(userId)).map((x) => ({ platform: x.platform, name: x.title ?? x.name ?? x.platform })) : [];
    return c.json({ data: { configured: true, connected, connections } });
  });

  r.post("/api/one/disconnect", async (c) => {
    await client()?.disconnect(await opts.userId(c));
    return c.json({ data: { ok: true } });
  });

  const initial = client();
  if (!initial) {
    r.get("/api/one/authorize", (c) => c.json({ error: { code: "connect_not_configured", message: "Add your Connect app at /setup/connect first." } }, 404));
    return r;
  }

  // The Node adapter writes to the raw request/response, which
  // @hono/node-server exposes on c.env. On Workers use createOneConnectRoutes.
  const handlers = createOneConnectHandlers(initial, { identifyUser: opts.identifyUser });
  const serve = (which: "authorize" | "callback") => async (c: Context) => {
    await handlers[which]((c.env as { incoming: never }).incoming, (c.env as { outgoing: never }).outgoing);
    return RESPONSE_ALREADY_SENT;
  };
  r.get("/api/one/authorize", serve("authorize"));
  r.get("/api/one/callback", serve("callback"));
  return r;
}
