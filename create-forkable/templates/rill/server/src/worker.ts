// Cloudflare Workers entry. A skeleton, not deployed today: the shape is what
// matters. Hono on Workers, ui/dist as Static Assets, Hyperdrive to Neon
// Postgres, a Cron Trigger that enqueues per-mailbox syncs, a Queue consumer
// that syncs and judges. Connect uses the fetch adapter (createOneConnectRoutes),
// since Workers has no Node request/response objects.
import { createOneConnectRoutes } from "@withone/connect/next";
import { createDb, schema } from "@rill/core";
import { and, eq } from "drizzle-orm";
import { createApp } from "./app.js";
import { createConnect, onConnected } from "./connect.js";
import type { Deps } from "./deps.js";
import { createHub } from "./events.js";
import { createScheduler } from "./scheduler.js";
import { ROOT, type ServerEnv } from "./config.js";
import { userForSid } from "./session.js";

// Minimal Workers types, so this file typechecks without @cloudflare/workers-types.
interface Hyperdrive { connectionString: string }
interface Queue<T> { send(message: T): Promise<void> }
interface MessageBatch<T> { messages: { body: T; ack(): void; retry(opts?: { delaySeconds?: number }): void }[] }
interface ScheduledController { cron: string; scheduledTime: number }
interface ExecutionContext { waitUntil(p: Promise<unknown>): void }
interface Fetcher { fetch(request: Request): Promise<Response> }

export interface WorkerEnv {
  HYPERDRIVE: Hyperdrive;
  ASSETS: Fetcher;
  SYNC_QUEUE: Queue<{ mailboxId: string }>;
  ONE_CLIENT_ID?: string; ONE_CLIENT_SECRET?: string; ONE_CONNECT_KEY?: string; ONE_REDIRECT_URI?: string; ONE_PERMISSION_SET?: string;
  AI_ENGINE?: string; AI_PROVIDER?: string; AI_MODEL?: string; JEV_MODEL?: string;
}

function toServerEnv(env: WorkerEnv): ServerEnv {
  return {
    ONE_CLIENT_ID: env.ONE_CLIENT_ID, ONE_CLIENT_SECRET: env.ONE_CLIENT_SECRET, ONE_CONNECT_KEY: env.ONE_CONNECT_KEY,
    ONE_REDIRECT_URI: env.ONE_REDIRECT_URI, ONE_PERMISSION_SET: env.ONE_PERMISSION_SET,
    AI_ENGINE: env.AI_ENGINE, AI_PROVIDER: env.AI_PROVIDER, AI_MODEL: env.AI_MODEL, JEV_MODEL: env.JEV_MODEL,
    LOCAL: false, ROOT, PORT: 443, HOME: "/", PG_PORT: 0, DATABASE_URL: env.HYPERDRIVE.connectionString,
  };
}

/** One Deps per invocation; Hyperdrive pools, so a 5-connection pool per Worker is the cap. */
function buildDeps(env: WorkerEnv): Deps {
  const serverEnv = toServerEnv(env);
  const { db } = createDb(env.HYPERDRIVE.connectionString, 5);
  const oneConnect = createConnect(serverEnv, db);
  const hub = createHub(); // hosted: replace with a Durable Object per mailbox for live push
  const scheduler = createScheduler({ db, env: serverEnv, oneConnect, hub });
  return { db, env: serverEnv, oneConnect, hub, scheduler, connectSetup: null, version: "worker", dbInfo: { kind: "external", url: "hyperdrive", dataDir: null } };
}

const readSid = (request: Request) => request.headers.get("cookie")?.match(/(?:^|;\s*)rill_sid=([^;]+)/)?.[1] ?? null;

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const deps = buildDeps(env);
    const url = new URL(request.url);
    if (deps.oneConnect && (url.pathname === "/api/one/authorize" || url.pathname === "/api/one/callback")) {
      const routes = createOneConnectRoutes(deps.oneConnect, {
        identifyUser: async (req) => { const sid = readSid(req); return sid ? (await userForSid(deps.db, sid))?.id ?? null : null; },
        onComplete: async ({ userId, result }) => {
          if (result.outcome !== "connected") return console.log(`connect: ${result.outcome}`);
          await onConnected(deps, userId).catch((err: unknown) => console.error(`connect: post-callback step failed: ${err instanceof Error ? err.message : String(err)}`));
        },
      });
      return routes.GET(request);
    }
    if (url.pathname.startsWith("/api/")) return createApp(deps, { mountConnect: false }).fetch(request);
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller: ScheduledController, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    const { db } = createDb(env.HYPERDRIVE.connectionString, 5);
    const due = await db.select({ id: schema.mailboxes.id }).from(schema.mailboxes)
      .where(and(eq(schema.mailboxes.source, "live"), eq(schema.mailboxes.status, "active")));
    for (const m of due) ctx.waitUntil(env.SYNC_QUEUE.send({ mailboxId: m.id }));
  },

  async queue(batch: MessageBatch<{ mailboxId: string }>, env: WorkerEnv): Promise<void> {
    const deps = buildDeps(env);
    for (const msg of batch.messages) {
      try {
        await deps.scheduler.kick(msg.body.mailboxId, {});
        msg.ack();
      } catch {
        msg.retry({ delaySeconds: 60 });
      }
    }
  },
};
