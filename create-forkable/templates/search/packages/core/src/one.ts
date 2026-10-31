// Every platform call goes through here (SPEC 12, CONTRACT 5): on the user's Connect grant,
// or on the sample world's fixture transport. One ledger row per call (or an indexer rollup).

import { OneConnectError } from "@withone/connect/server";
import type { CallInput, GrantAccess, GrantedConnection, LedgerRow, RawCallResult } from "./contract.js";
import type { CallCtx, OneConnectKeyClient } from "./ctx.js";
import { BlockedByGrant, HttpError, NotConnected, SampleActionLive, UnresolvedAction } from "./errors.js";
import { recordLedger, toLedgerRow, type LedgerInsert } from "./ledger.js";
import { AI_PLATFORMS } from "./platforms.js";
import { newId } from "./ids.js";

/** The write Search never has: the Access receipt attempts it and One declines. */
export const RECEIPT_ACTION = {
  platform: "gmail",
  actionId: "conn_mod_def::GJ3ocgKltKQ::s8UCfiDLSaO9w9oPU32TYA",
  method: "DELETE" as const,
  path: "/users/{{userId}}/messages/{{id}}",
};

const grantCache = new Map<string, { at: number; list: GrantedConnection[] }>();
const GRANT_TTL_MS = 60_000;

export async function grantedConnections(oneConnect: OneConnectKeyClient | null, userId: string): Promise<GrantedConnection[]> {
  if (!oneConnect) return [];
  const hit = grantCache.get(userId);
  if (hit && Date.now() - hit.at < GRANT_TTL_MS) return hit.list;
  let list: GrantedConnection[] = [];
  try {
    if (await oneConnect.isConnected(userId)) {
      list = (await oneConnect.listConnections(userId)).map((c) => ({ key: c.key, platform: c.platform, name: c.name, title: c.title, image: c.image, access: c.access as GrantAccess }));
    }
  } catch (e) {
    if (e instanceof OneConnectError && e.code === "reconnect_required") throw e;
  }
  grantCache.set(userId, { at: Date.now(), list });
  return list;
}

export function forgetGrant(userId: string): void {
  grantCache.delete(userId);
}

export function fillPath(path: string, params?: Record<string, string>): string {
  return path.replace(/\{\{\s*(\w+)\s*\}\}|\{(\w+)\}/g, (_m, a?: string, b?: string) => encodeURIComponent(String(params?.[(a ?? b)!] ?? "")));
}

/** One serves these itself (paths under /v1/<platform>/, tag "custom"): the connection key goes in the body. */
export function isOneServed(path: string): boolean {
  return /^\/v1\/(gmail|google-calendar|outlook-mail|slack)\//.test(path);
}

async function connectionFor(ctx: CallCtx, platform: string): Promise<string | null> {
  if (ctx.connectionKey && !AI_PLATFORMS.has(platform)) return ctx.connectionKey;
  const list = await grantedConnections(ctx.oneConnect, ctx.userId);
  return list.find((c) => c.platform === platform)?.key ?? ctx.connectionKey ?? null;
}

function parseRetryAfter(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v);
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
  const d = Date.parse(s);
  return Number.isNaN(d) ? null : Math.max(0, d - Date.now());
}

/** Retry-After hints a response body may carry (Slack's retry_after, Graph's retryAfterSeconds). runAction exposes no headers (0.19.0). */
function retryAfterFrom(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const h = (o.headers ?? {}) as Record<string, unknown>;
  return parseRetryAfter(o.retryAfter ?? o.retry_after ?? o["Retry-After"] ?? h["retry-after"] ?? h["Retry-After"] ?? (o.error as Record<string, unknown> | undefined)?.retryAfterSeconds);
}

async function send(ctx: CallCtx, input: CallInput<unknown, unknown>): Promise<Omit<RawCallResult, "ms" | "ledgerId"> & { note: string | null; error: unknown }> {
  const base = { status: 0, ok: false, data: null as unknown, blockedByGrant: false, refusal: null as RawCallResult["refusal"], retryAfterMs: null as number | null, note: null as string | null, error: null as unknown };
  if (input.actionId.startsWith("TBD:")) return { ...base, note: "unresolved action", error: new UnresolvedAction(input.actionId) };
  if (ctx.mode === "fixture") {
    if (!ctx.transport) return { ...base, note: "no sample world", error: new Error("fixture mode without a transport") };
    if (input.level === "write") return { ...base, status: 403, blockedByGrant: true, refusal: "grant", data: { error: "not in grant" }, note: "outside the grant" };
    const a = await ctx.transport.answer({ actionId: input.actionId, connectionKey: ctx.connectionKey ?? null, method: input.method, path: input.path, pathParams: input.pathParams, query: input.query, body: input.body, platform: input.platform, fixtureKey: input.fixtureKey, cursor: input.cursor ?? null, partition: input.partition ?? null, delta: input.delta ?? null });
    const ok = a.status >= 200 && a.status < 300 && !a.blockedByGrant;
    return { ...base, status: a.status, ok, data: a.data, blockedByGrant: !!a.blockedByGrant, refusal: a.refusal ?? (a.blockedByGrant ? "grant" : null), retryAfterMs: retryAfterFrom(a.data), note: ok ? null : a.blockedByGrant ? "outside the grant" : `fixture answered ${a.status}` };
  }
  if (input.actionId.startsWith("sample::")) return { ...base, note: "sample action", error: new SampleActionLive(input.actionId) };
  if (!ctx.oneConnect) return { ...base, note: "Connect is not configured", error: new NotConnected(input.platform) };
  let key: string | null;
  try { key = await connectionFor(ctx, input.platform); } catch (e) { return { ...base, note: (e as OneConnectError).code ?? "grant lookup failed", error: e }; }
  if (!key) return { ...base, note: "not in the grant", error: new NotConnected(input.platform) };
  // An empty path means "look the action up": runAction reads method, path and the
  // custom tag (connection key in the body) from the catalog and fills pathParams.
  const lookUp = input.path === "";
  const body = !lookUp && isOneServed(input.path) && input.body && typeof input.body === "object" && !Array.isArray(input.body)
    ? { connectionKey: key, ...(input.body as Record<string, unknown>) }
    : input.body;
  try {
    const res = await ctx.oneConnect.runAction(ctx.userId, {
      connectionKey: key, actionId: input.actionId,
      ...(lookUp ? { pathParams: input.pathParams } : { method: input.method, path: fillPath(input.path, input.pathParams) }),
      body, query: input.query, headers: input.headers,
    });
    return {
      ...base, status: res.status, ok: res.ok, data: res.data, blockedByGrant: res.blockedByGrant, refusal: res.refusal,
      retryAfterMs: retryAfterFrom(res.data),
      note: res.blockedByGrant ? "outside the grant" : res.ok ? null : `answered ${res.status}`,
    };
  } catch (e) {
    if (e instanceof OneConnectError) return { ...base, status: e.status ?? 0, note: e.code, error: e };
    return { ...base, note: String((e as Error).message ?? e).slice(0, 300), error: e };
  }
}

async function run(ctx: CallCtx, input: CallInput<unknown, unknown>): Promise<{ res: RawCallResult; error: unknown; row: LedgerRow | null }> {
  const started = Date.now();
  const out = await send(ctx, input);
  const ms = Date.now() - started;
  const ins: LedgerInsert = {
    userId: ctx.userId, sourceId: ctx.sourceId ?? null, actor: ctx.actor, clientId: ctx.clientId ?? null,
    platform: input.platform, action: input.action, actionId: input.actionId, method: input.method, path: input.path,
    mode: ctx.mode, level: input.level, status: out.status, ok: out.ok, blockedByGrant: out.blockedByGrant,
    refusal: out.refusal, ms, summary: input.summary, note: out.note,
  };
  let row: LedgerRow | null = null;
  if (ctx.rollup) {
    ctx.rollup.add(ins);
  } else {
    row = await recordLedger(ctx.db, ins);
    try { ctx.emit?.({ type: "ledger", row }); } catch { /* listener errors never fail a call */ }
  }
  const { note: _n, error, ...rest } = out;
  return { res: { ...rest, ms, ledgerId: row?.id ?? null }, error, row };
}

export const one = {
  /** Throws on refusal, HTTP failure or a missing connection. `pick` maps the answer. */
  async call<Out, T = Out>(ctx: CallCtx, input: CallInput<Out, T>): Promise<T> {
    const { res, error, row } = await run(ctx, input as CallInput<unknown, unknown>);
    if (res.blockedByGrant) throw new BlockedByGrant(input.actionId, row);
    if (error) throw error;
    if (!res.ok) throw new HttpError(res.status, res.data);
    return input.pick ? input.pick(res.data as Out) : (res.data as T);
  },

  /** Writes the row and returns it; never throws on refusal (Access receipt). */
  async attempt(ctx: CallCtx, input: CallInput<unknown, unknown>): Promise<LedgerRow> {
    const { row, error, res } = await run({ ...ctx, rollup: undefined }, input);
    if (error instanceof OneConnectError && error.code === "reconnect_required") throw error;
    return row ?? toLedgerRow({ id: newId("led"), at: new Date(), userId: ctx.userId, sourceId: ctx.sourceId ?? null, actor: ctx.actor, clientId: ctx.clientId ?? null, platform: input.platform, action: input.action, actionId: input.actionId, method: input.method, path: input.path, mode: ctx.mode, level: input.level, status: res.status, ok: res.ok, blockedByGrant: res.blockedByGrant, refusal: res.refusal, ms: res.ms, summary: input.summary, note: null });
  },

  /** Engine use: never throws on an HTTP status. Rethrows connection-level errors. */
  async raw(ctx: CallCtx, input: CallInput<unknown, unknown>): Promise<RawCallResult> {
    const { res, error } = await run(ctx, input);
    if (error) throw error;
    return res;
  },

  grantedConnections,
  forgetGrant,
};
