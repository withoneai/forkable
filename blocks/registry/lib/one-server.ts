import type { Context } from "hono";
import type { ActionKnowledge, OneConnectClient, PlatformAction } from "@withone/connect/server";

// Every component's route calls its platform through `one.call()` below, on
// the signed-in user's grant. The component never holds a provider token or
// an API secret: One makes the call, inside what the user allowed.
//
// Before Sign in with One is set up (no Connect app yet), each call answers
// from the component's own sample instead, so a fresh fork works on its first
// `pnpm dev`. Every answer says which one it was in `meta.mode`.

export type OneMode = "sample" | "grant";

export interface OneAction {
  platform: string;
  actionId: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  access: "read" | "write";
}

export interface OneCallInput<T> {
  action: OneAction;
  pathParams?: Record<string, string | number | boolean>;
  query?: Record<string, string>;
  body?: unknown;
  /** Extra headers an action's docs pin, such as a provider's version header. */
  headers?: Record<string, string>;
  /** What the call returns before Sign in with One is set up. */
  sample: () => T | Promise<T>;
}

export interface OneMeta {
  mode: OneMode;
  platform: string;
  access: "read" | "write";
  status: number;
}

export interface OneResult<T> {
  data: T;
  meta: OneMeta;
}

export class OneRefused extends Error {
  constructor(
    readonly status: number,
    readonly code: "outside_grant" | "not_connected" | "provider_error",
    readonly meta: OneMeta,
    message: string,
  ) {
    super(message);
  }
}

export interface OneServerOptions {
  /** The Connect client from createOneConnect, or null until a Connect app exists.
   *  A function works too, for a fork that swaps its client at runtime. */
  connect: OneConnectClient | null | (() => OneConnectClient | null);
  /** Your session lookup: who is calling. */
  userId: (c: Context) => string | Promise<string>;
  /** "never" in production so a signed-out user never sees made-up mail. */
  sample?: "until-connected" | "never";
}

// One's own Gmail helpers (paths under /v1/gmail/) take the connection key in the body.
const takesKeyInBody = (path: string) => path.startsWith("/v1/gmail/");

const fillPath = (path: string, params?: Record<string, string | number | boolean>) =>
  path.replace(/\{\{(\w+)\}\}/g, (_, k: string) => encodeURIComponent(String(params?.[k] ?? "")));

export function createOneServer(opts: OneServerOptions) {
  const sampleAllowed = (opts.sample ?? "until-connected") === "until-connected";
  const client = () => (typeof opts.connect === "function" ? opts.connect() : opts.connect);

  async function connectionFor(userId: string, platform: string): Promise<string | null> {
    const connect = client();
    if (!connect) return null;
    if (!(await connect.isConnected(userId))) return null;
    const conns = await connect.listConnections(userId);
    return conns.find((x) => x.platform === platform)?.key ?? null;
  }

  async function catalogCall<T>(c: Context, live: (connect: OneConnectClient, userId: string) => Promise<T>, sample: () => T | Promise<T>): Promise<OneResult<T>> {
    const base = { platform: "one", access: "read" as const };
    const connect = client();
    if (!connect) {
      if (sampleAllowed) return { data: await sample(), meta: { ...base, mode: "sample", status: 200 } };
      throw new OneRefused(401, "not_connected", { ...base, mode: "grant", status: 401 }, "Sign in with One to read the catalog.");
    }
    const userId = await opts.userId(c);
    if (!(await connect.isConnected(userId))) throw new OneRefused(401, "not_connected", { ...base, mode: "grant", status: 401 }, "Sign in with One to read the catalog.");
    return { data: await live(connect, userId), meta: { ...base, mode: "grant", status: 200 } };
  }

  return {
    async call<T>(c: Context, input: OneCallInput<T>): Promise<OneResult<T>> {
      const { action } = input;
      const base = { platform: action.platform, access: action.access };
      const userId = await opts.userId(c);
      const key = await connectionFor(userId, action.platform);

      if (!key) {
        if (!client() && sampleAllowed) {
          return { data: await input.sample(), meta: { ...base, mode: "sample", status: 200 } };
        }
        throw new OneRefused(401, "not_connected", { ...base, mode: "grant", status: 401 }, `${action.platform} is not in your grant yet.`);
      }

      const body = takesKeyInBody(action.path) && input.body && typeof input.body === "object"
        ? { connectionKey: key, ...(input.body as Record<string, unknown>) }
        : input.body;
      const res = await client()!.runAction(userId, {
        connectionKey: key,
        actionId: action.actionId,
        method: action.method,
        path: fillPath(action.path, input.pathParams),
        query: input.query,
        body,
        ...(input.headers ? { headers: input.headers } : {}),
      });
      const meta: OneMeta = { ...base, mode: "grant", status: res.status };
      if (res.blockedByGrant) throw new OneRefused(403, "outside_grant", meta, `${action.platform} ${action.access} is outside your grant.`);
      if (!res.ok) throw new OneRefused(502, "provider_error", meta, `${action.platform} answered ${res.status}.`);
      return { data: res.data as T, meta };
    },

    /** "sample" until a Connect app exists, for routes that read only what
     *  your app stored (a report over earlier runs) and call no platform. */
    mode(): OneMode {
      return !client() && sampleAllowed ? "sample" : "grant";
    },

    /** One's action catalog, read on the signed-in user's grant: search a
     *  platform's actions in words, then read one action's docs. Before a
     *  Connect app exists it answers from the sample you pass. */
    catalog: {
      async search(c: Context, platform: string, query: string, sample: () => PlatformAction[] | Promise<PlatformAction[]>, limit = 8): Promise<OneResult<PlatformAction[]>> {
        return catalogCall(c, (connect, userId) => connect.searchActions(userId, platform, query, { limit, mode: "knowledge" }), sample);
      },
      async knowledge(c: Context, actionId: string, sample: () => ActionKnowledge | null | Promise<ActionKnowledge | null>): Promise<OneResult<ActionKnowledge | null>> {
        return catalogCall(c, (connect, userId) => connect.getActionKnowledge(userId, actionId), sample);
      },
    },

    /** Turns a refusal into the JSON every component's client reads. */
    error(c: Context, e: unknown) {
      if (e instanceof OneRefused) {
        return c.json({ error: { code: e.code, message: e.message }, meta: e.meta }, e.status as 401 | 403 | 502);
      }
      return c.json({ error: { code: "server_error", message: String((e as Error)?.message ?? e) } }, 500);
    },
  };
}

export type OneServer = ReturnType<typeof createOneServer>;
