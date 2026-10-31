// One retry policy for list, hydrate, children and account calls (SPEC 7.2), and the
// token buckets shared by every profile on one connection.

import { OneConnectError } from "@withone/connect/server";
import type { CallInput, ErrorCode, RawCallResult } from "../contract.js";
import type { CallCtx } from "../ctx.js";
import { NotConnected, SearchError } from "../errors.js";
import { one } from "../one.js";

export type StopKind = "rate_limited" | "auth_needed" | "grant_blocked" | "plan_limit" | "page_failed" | "not_connected" | "bug";

/** Ends a run (or a page). `kind` decides the run outcome and the source status. */
export class RunStop extends Error {
  constructor(public kind: StopKind, public code: ErrorCode, message: string, public extra: { status?: number; actionId?: string; retryAt?: Date } = {}) {
    super(message);
  }
}

// ---------- token buckets ----------

class Bucket {
  tokens: number;
  last: number;
  constructor(public capacity: number, now: number) { this.tokens = capacity; this.last = now; }
  refill(now: number): void {
    const perMs = this.capacity / 60_000;
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * perMs);
    this.last = now;
  }
  /** ms to wait before a token is available (0 = take now). */
  waitMs(now: number): number {
    this.refill(now);
    if (this.tokens >= 1) return 0;
    return Math.ceil((1 - this.tokens) / (this.capacity / 60_000));
  }
  take(now: number): void { this.refill(now); this.tokens -= 1; }
  drain(now: number): void { this.refill(now); this.tokens = 0; }
}

const buckets = new Map<string, Bucket>();

function bucket(key: string, rpm: number, now: number): Bucket {
  let b = buckets.get(key);
  if (!b || b.capacity !== rpm) { b = new Bucket(rpm, now); buckets.set(key, b); }
  return b;
}

export function resetBuckets(): void { buckets.clear(); }

export interface Limiter {
  /** Per (user, connection), shared by every profile on the connection. */
  connectionKey: string;
  rpm: number;
  /** Tighter per-action budget (Slack history at 1 a minute). */
  perAction?: Record<string, { requestsPerMinute: number }>;
  /** Fixture runs never wait. */
  enabled: boolean;
}

export async function acquire(lim: Limiter, actionId: string, sleep: (ms: number) => Promise<void>, now: () => number = Date.now): Promise<void> {
  if (!lim.enabled) return;
  for (;;) {
    const conn = bucket(`c:${lim.connectionKey}`, lim.rpm, now());
    const per = lim.perAction?.[actionId];
    const act = per ? bucket(`a:${lim.connectionKey}:${actionId}`, per.requestsPerMinute, now()) : null;
    const wait = Math.max(conn.waitMs(now()), act?.waitMs(now()) ?? 0);
    if (wait <= 0) { conn.take(now()); act?.take(now()); return; }
    await sleep(Math.min(wait, 60_000));
  }
}

export function drainConnection(lim: Limiter, now: () => number = Date.now): void {
  buckets.get(`c:${lim.connectionKey}`)?.drain(now());
}

// ---------- retry policy ----------

export interface RetryPolicy {
  rate: { tries: number; baseMs: number; maxMs: number };
  server: { tries: number; baseMs: number; maxMs: number };
  jitter: number;
}

export const DEFAULT_POLICY: RetryPolicy = {
  rate: { tries: 5, baseMs: 30_000, maxMs: 300_000 },
  server: { tries: 4, baseMs: 2_000, maxMs: 60_000 },
  jitter: 0.2,
};

function jittered(ms: number, j: number, rnd: () => number): number {
  return Math.round(ms * (1 - j + 2 * j * rnd()));
}

/** Slack answers 200 with { ok: false, error } for its own failures. */
function slackStatus(platform: string, data: unknown): number | null {
  if (platform !== "slack" || !data || typeof data !== "object" || (data as { ok?: unknown }).ok !== false) return null;
  const e = String((data as { error?: unknown }).error ?? "");
  if (e === "ratelimited" || e === "rate_limited") return 429;
  if (e === "invalid_auth" || e === "token_revoked" || e === "account_inactive" || e === "not_authed") return 401;
  if (e === "missing_scope" || e === "not_allowed_token_type") return 403;
  if (e === "channel_not_found" || e === "thread_not_found") return 404;
  return 400;
}

export interface FetchResult { res: RawCallResult; retries: number; calls: number }

export interface FetchOpts {
  limiter: Limiter;
  sleep: (ms: number) => Promise<void>;
  policy?: RetryPolicy;
  random?: () => number;
  /** 404/410 answered as a result (hydrate tombstones) instead of a page failure. */
  notFoundOk?: boolean;
  /** Statuses answered as a result (delta resetOn). */
  passStatuses?: number[];
}

/**
 * Runs one call through the policy. Returns the result for 2xx (and allowed 404/410 or
 * pass-through statuses); throws RunStop otherwise.
 */
export async function fetchWithPolicy(ctx: CallCtx, input: CallInput<unknown, unknown>, o: FetchOpts): Promise<FetchResult> {
  const policy = o.policy ?? DEFAULT_POLICY;
  const rnd = o.random ?? Math.random;
  let rateTries = 0, serverTries = 0, retries = 0, calls = 0;
  for (;;) {
    await acquire(o.limiter, input.actionId, o.sleep);
    let res: RawCallResult;
    calls++;
    try {
      res = await one.raw(ctx, input);
    } catch (e) {
      if (e instanceof OneConnectError) {
        if (e.code === "reconnect_required" || e.code === "refresh_failed" || e.code === "not_connected") throw new RunStop("auth_needed", "reconnect_required", "The grant is gone: sign in with One again.", { actionId: input.actionId });
        // request_failed: One unreachable; retry like a 5xx
        res = { status: e.status ?? 0, ok: false, data: e.message, blockedByGrant: false, refusal: "one_error", retryAfterMs: null, ms: 0, ledgerId: null };
      } else if (e instanceof NotConnected) {
        throw new RunStop("not_connected", "not_connected", e.message, { actionId: input.actionId });
      } else if (e instanceof SearchError) {
        throw new RunStop("bug", e.code, e.message, { actionId: input.actionId });
      } else {
        res = { status: 0, ok: false, data: String((e as Error)?.message ?? e), blockedByGrant: false, refusal: null, retryAfterMs: null, ms: 0, ledgerId: null };
      }
    }
    const status = slackStatus(input.platform, res.data) ?? res.status;
    if (status >= 200 && status < 300 && res.ok !== false) return { res, retries, calls };
    if (res.ok && slackStatus(input.platform, res.data) === null) return { res, retries, calls };
    if (o.passStatuses?.includes(status)) return { res: { ...res, status }, retries, calls };
    if (res.blockedByGrant || res.refusal === "grant") throw new RunStop("grant_blocked", "blocked_by_grant", `Search was not granted ${input.actionId}.`, { status: 403, actionId: input.actionId });
    if (status === 401) throw new RunStop("auth_needed", "reconnect_required", "The provider refused the connection: sign in again.", { status, actionId: input.actionId });
    if (status === 402 || res.refusal === "plan_limit") throw new RunStop("plan_limit", "plan_limit", "One plan limit reached.", { status, actionId: input.actionId });
    if ((status === 404 || status === 410) && o.notFoundOk) return { res: { ...res, status }, retries, calls };
    if (status === 429 || res.refusal === "rate_limit") {
      drainConnection(o.limiter);
      rateTries++;
      const wait = res.retryAfterMs ?? jittered(Math.min(policy.rate.baseMs * 2 ** (rateTries - 1), policy.rate.maxMs), policy.jitter, rnd);
      if (rateTries >= policy.rate.tries) throw new RunStop("rate_limited", "rate_limited", "Rate limited.", { status: 429, actionId: input.actionId, retryAt: new Date(Date.now() + wait) });
      retries++;
      await o.sleep(wait);
      continue;
    }
    if (status === 0 || status >= 500 || res.refusal === "one_error") {
      serverTries++;
      if (serverTries >= policy.server.tries) throw new RunStop("page_failed", "upstream_error", `Failed after ${serverTries} tries (${status || "network"}): ${bodyText(res.data)}`, { status, actionId: input.actionId });
      retries++;
      await o.sleep(jittered(Math.min(policy.server.baseMs * 2 ** (serverTries - 1), policy.server.maxMs), policy.jitter, rnd));
      continue;
    }
    throw new RunStop("page_failed", "upstream_error", `Answered ${status}: ${bodyText(res.data)}`, { status, actionId: input.actionId });
  }
}

export function bodyText(data: unknown): string {
  const s = typeof data === "string" ? data : JSON.stringify(data ?? null);
  return s.slice(0, 500);
}
