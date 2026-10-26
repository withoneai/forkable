import { OneConnectError, type OneConnectClient } from "@withone/connect/server";
import type { LedgerRow } from "./api-types.js";
import { BlockedByGrant, NotConnected, type CallInput, type CallResultMeta, type Ctx, type OneLayer } from "./contract.js";
import { ledger } from "./ledger.js";
import type { CallMode, Platform } from "./types.js";

// Every platform call in the app goes through `call()` below. It resolves how
// the call reaches One, sends it, writes one ledger row, and hands back the
// data. Three ways out:
//
//   fixture   a sample mailbox: fixtures/ answer instead of the platform
//   connect   the user's grant, through @withone/connect (runAction): Gmail on
//             the mailbox's connection, TypeSafe and the LLMs on the grant's
//             connection for that platform
//
// There is no key mode. The app never holds a platform key or an API secret.
//
// A refusal outside the grant (403, blockedByGrant) is recorded and thrown as
// BlockedByGrant. The receipt demo calls `attempt` instead, which returns the
// row and never throws for a refusal.

/** The delete action is never in the grant; the fixture replays One's refusal for it. */
export const DELETE_ACTION_ID = "conn_mod_def::GJ3ocgKltKQ::s8UCfiDLSaO9w9oPU32TYA";

/** The mail platforms answer on the mailbox's own connection; everything else on the grant's connection for that platform. */
function defaultCredential(platform: Platform): "mailbox" | "grant" {
  return platform === "gmail" || platform === "outlook-mail" ? "mailbox" : "grant";
}

type Resolved = { mode: CallMode | "missing"; key: string | null };

// The user's grant, platform -> first connection key, cached briefly so a
// sync does not re-ask One per call.
const grantCache = new Map<string, { at: number; byPlatform: Map<string, string> }>();
const GRANT_TTL_MS = 60_000;

export async function grantedConnections(oneConnect: OneConnectClient | null, userId: string): Promise<Map<string, string>> {
  if (!oneConnect) return new Map();
  const hit = grantCache.get(userId);
  if (hit && Date.now() - hit.at < GRANT_TTL_MS) return hit.byPlatform;
  const byPlatform = new Map<string, string>();
  try {
    if (await oneConnect.isConnected(userId)) {
      for (const c of await oneConnect.listConnections(userId)) if (!byPlatform.has(c.platform)) byPlatform.set(c.platform, c.key);
    }
  } catch (e) {
    if (e instanceof OneConnectError && e.code === "reconnect_required") throw e;
    // One unreachable: treat as nothing granted for now, retry on the next call
  }
  grantCache.set(userId, { at: Date.now(), byPlatform });
  return byPlatform;
}

export function forgetGrant(userId: string): void {
  grantCache.delete(userId);
}

async function resolve(ctx: Ctx, platform: Platform, credential: "mailbox" | "grant"): Promise<Resolved> {
  const env = ctx.env;
  if (ctx.mailbox.source === "sample") {
    // Recording the sample inbox runs Jev and the writer live on the recording user's grant; Gmail stays on fixtures.
    if (credential === "grant" && env.RECORD === "1") {
      const key = (await grantedConnections(ctx.oneConnect, ctx.user.id)).get(platform);
      if (key) return { mode: "connect", key };
    }
    return { mode: "fixture", key: null };
  }
  if (credential === "mailbox") {
    if (ctx.mailbox.mode === "connect" && ctx.oneConnect && ctx.mailbox.connectionKey) return { mode: "connect", key: ctx.mailbox.connectionKey };
    return { mode: "missing", key: null };
  }
  const key = (await grantedConnections(ctx.oneConnect, ctx.user.id)).get(platform);
  return key ? { mode: "connect", key } : { mode: "missing", key: null };
}

function fillPath(path: string, params?: Record<string, string | number | boolean>): string {
  return path.replace(/\{\{(\w+)\}\}/g, (_, k: string) => encodeURIComponent(String(params?.[k] ?? "")));
}

/** Actions One serves itself (tag "custom") take the connection key in the body. Today those are the Gmail helpers under /v1/gmail/. A provider's own /v1 path (TypeSafe's /v1/systemone) is not one of them. */
function isCustomAction(path: string): boolean {
  return path.startsWith("/v1/gmail/");
}

interface Outcome<Out> {
  mode: CallMode;
  status: number;
  ok: boolean;
  blockedByGrant: boolean;
  refusal: string | null;
  data: Out | null;
  note: string | null;
  error: unknown;
}

async function send<Out, T>(ctx: Ctx, input: CallInput<Out, T>, resolved: Resolved): Promise<Outcome<Out>> {
  const mode = resolved.mode;
  const base: Outcome<Out> = { mode: mode === "missing" ? "connect" : mode, status: 0, ok: false, blockedByGrant: false, refusal: null, data: null, note: null, error: null };
  if (mode === "missing") {
    return { ...base, note: "not connected", error: new NotConnected(input.platform) };
  }
  if (mode === "fixture") {
    // Every provider's delete action is kept outside the grant (never asked for); the
    // fixture replays One's refusal for any of them, named "delete-message" (Gmail) or
    // "<thing>-delete" (the convention every other provider's attemptDelete uses).
    if (input.actionId === DELETE_ACTION_ID || input.action === "delete-message" || input.action.endsWith("-delete")) {
      return { ...base, status: 403, blockedByGrant: true, refusal: "grant", note: "outside the grant" };
    }
    try {
      const data = (await input.fixture()) as unknown as Out;
      return { ...base, status: 200, ok: true, data };
    } catch (e) {
      return { ...base, status: 0, note: String((e as Error).message ?? e).slice(0, 300), error: e };
    }
  }
  // connect
  if (!ctx.oneConnect) return { ...base, note: "Connect is not configured", error: new NotConnected(input.platform) };
  const connectionKey = resolved.key;
  if (!connectionKey) return { ...base, note: "not in the grant", error: new NotConnected(input.platform) };
  // The package adds the connection key to the body of a One-served (custom) action
  // only when it looks the action up itself. We pass method and path explicitly, so
  // we add it here; without it One answers 400 "A connection key is required".
  const body = isCustomAction(input.path) && input.body && typeof input.body === "object" && !Array.isArray(input.body)
    ? { connectionKey, ...(input.body as Record<string, unknown>) }
    : input.body;
  try {
    const res = await ctx.oneConnect.runAction(ctx.user.id, {
      connectionKey,
      actionId: input.actionId,
      method: input.method,
      path: fillPath(input.path, input.pathParams),
      body,
      query: input.query,
      headers: input.headers,
    });
    return {
      ...base,
      status: res.status,
      ok: res.ok,
      blockedByGrant: res.blockedByGrant,
      refusal: res.refusal,
      data: res.ok ? (res.data as Out) : null,
      note: res.blockedByGrant ? "outside the grant" : res.ok ? null : `One answered ${res.status}`,
    };
  } catch (e) {
    if (e instanceof OneConnectError) {
      return { ...base, status: e.status ?? 0, note: e.code, error: e };
    }
    return { ...base, status: 0, note: String((e as Error).message ?? e).slice(0, 300), error: e };
  }
}

async function run<Out, T>(ctx: Ctx, input: CallInput<Out, T>): Promise<{ row: LedgerRow; out: Outcome<Out>; meta: CallResultMeta }> {
  const credential = input.credential ?? defaultCredential(input.platform);
  const resolved = await resolve(ctx, input.platform, credential);
  const started = Date.now();
  const out = await send(ctx, input, resolved);
  const ms = Date.now() - started;
  const row = await ledger.record(ctx.db, {
    mailboxId: ctx.mailbox.id,
    userId: ctx.user.id,
    platform: input.platform,
    action: input.action,
    method: input.method,
    path: input.path,
    mode: out.mode,
    level: input.level,
    status: out.status,
    ok: out.ok,
    blockedByGrant: out.blockedByGrant,
    refusal: out.refusal,
    engine: null,
    model: null,
    ms,
    summary: input.summary,
    note: out.note,
  });
  try {
    ctx.emit({ type: "ledger", row });
  } catch {
    // a closed SSE stream must not fail the call
  }
  const meta: CallResultMeta = { mode: out.mode, status: out.status, ok: out.ok, blockedByGrant: out.blockedByGrant, refusal: out.refusal, ms };
  return { row, out, meta };
}

export const one: OneLayer = {
  async modeFor(ctx, platform, credential) {
    return (await resolve(ctx, platform, credential ?? defaultCredential(platform))).mode;
  },

  grantedConnections,
  forgetGrant,

  async call(ctx, input) {
    const { row, out } = await run(ctx, input);
    if (out.blockedByGrant) throw new BlockedByGrant(input.action, row);
    if (out.error) throw out.error;
    if (!out.ok) throw new Error(`${input.platform} ${input.action} failed with ${out.status}${out.note ? `: ${out.note}` : ""}`);
    const data = out.data as unknown;
    // A fixture already answers in the final shape (CallInput.fixture returns T), so
    // pick only maps a real platform response. Running pick over a fixture turned every
    // sample calendar create into "(event)" at the wrong time with a fixed id.
    if (out.mode === "fixture") return data as never;
    return input.pick ? input.pick(data as never) : (data as never);
  },

  async attempt(ctx, input) {
    const { row, out, meta } = await run(ctx, input);
    if (out.error instanceof OneConnectError && out.error.code === "reconnect_required") throw out.error;
    return { row, data: out.ok ? out.data : null, meta };
  },

  async jevAvailable(ctx) {
    if (ctx.mailbox.source === "sample" && ctx.env.RECORD !== "1") return true;
    return (await resolve(ctx, "typesafe", "grant")).mode === "connect";
  },
};
