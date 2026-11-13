// Keeps Search inside the One plan's limits (D-one-limits).
//
// One counts calls per connect user per minute, sized by the plan of the One
// account that owns this Search's Connect app (Free 20, Starter 100, Pro 500 a
// minute; Enterprise custom), and caps Free at 1M requests a month with a 402.
// Every call through one.ts takes a token here first, so the indexer, the
// embedder, Jev and the person's own searches share one budget instead of each
// pacing itself and adding up past the plan.
//
// - Paced at PACE of the limit, so a burst from elsewhere does not tip it over.
// - A RESERVE share is kept for calls a person is waiting on (search, assistant,
//   MCP, CLI, the mapper). Background work never dips into it, and still gets
//   the full rate over a minute.
// - The limit comes from the plan picked in Settings, or (auto) from what One
//   reports on each call (`rateLimit` on runAction's result, @withone/connect
//   0.24). Until a call has reported it, auto assumes Free.
// - A 429 from One stops every call for that user until Retry-After / reset.
// - A 402 (the month's requests are used up) holds background work for an hour,
//   then lets one call through to check again. Calls a person makes still go.

import type { LedgerActor, OnePlan, OnePlanStatus } from "./contract.js";

export const ONE_PLAN_RPM = { free: 20, starter: 100, pro: 500 } as const;
export const PACE = 0.9;
export const RESERVE = 0.25;
export const QUOTA_RECHECK_MS = 60 * 60_000;
/** What "nothing limits this user" (One sent rateLimit with limit null) paces at. */
export const UNLIMITED_RPM = 100_000;
const DEFAULT_BLOCK_MS = 60_000;
const SETTINGS_TTL_MS = 60_000;

export type CallPriority = "now" | "background";
const BACKGROUND: ReadonlySet<LedgerActor> = new Set(["indexer", "embedder", "classifier"]);
export const priorityFor = (actor: LedgerActor): CallPriority => (BACKGROUND.has(actor) ? "background" : "now");

export interface PlanSetting { plan: OnePlan; rpm: number | null }

/** Thrown to background callers while the month's requests are used up. */
export class OneQuotaHeld extends Error {
  constructor(public until: Date) { super("One plan's monthly requests are used up"); }
}

interface Waiter { priority: CallPriority; resolve: () => void; reject: (e: unknown) => void }

export interface Clock { now(): number; setTimer(fn: () => void, ms: number): unknown; clearTimer(t: unknown): void }
const realClock: Clock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => { const t = setTimeout(fn, ms); (t as { unref?: () => void }).unref?.(); return t; },
  clearTimer: (t) => clearTimeout(t as NodeJS.Timeout),
};

export class Budget {
  setting: PlanSetting = { plan: "auto", rpm: null };
  settingAt = 0;
  /** X-RateLimit-Limit as One last reported it. */
  learned: number | null = null;
  learnedAt: number | null = null;
  tokens: number;
  last: number;
  blockedUntil = 0;
  quotaUntil = 0;
  lastRefusal: { kind: "rate_limit" | "plan_limit"; at: number } | null = null;
  private waiters: Waiter[] = [];
  private timer: unknown = null;
  private recent: number[] = [];

  constructor(private clock: Clock = realClock) {
    this.last = clock.now();
    this.tokens = this.capacity();
  }

  /** The plan's per-minute limit as Search understands it. */
  limit(): number {
    const s = this.setting;
    const chosen = s.plan === "custom" ? Math.max(1, Math.floor(s.rpm ?? ONE_PLAN_RPM.free)) : s.plan === "auto" ? null : ONE_PLAN_RPM[s.plan];
    if (chosen === null) return this.learned ?? ONE_PLAN_RPM.free;
    // One knows better than the picker: never run above what it reports.
    return this.learned !== null ? Math.min(chosen, this.learned) : chosen;
  }

  capacity(): number { return Math.max(1, Math.floor(this.limit() * PACE)); }
  reserve(): number { const c = this.capacity(); return c < 4 ? 0 : Math.floor(c * RESERVE); }

  source(): OnePlanStatus["limitFrom"] {
    if (this.setting.plan === "auto") return this.learned !== null ? "one" : "default";
    const chosen = this.setting.plan === "custom" ? Math.max(1, Math.floor(this.setting.rpm ?? ONE_PLAN_RPM.free)) : ONE_PLAN_RPM[this.setting.plan];
    return this.learned !== null && this.learned < chosen ? "one" : "chosen";
  }

  private refill(now: number): void {
    const cap = this.capacity();
    this.tokens = Math.min(cap, this.tokens + ((now - this.last) * cap) / 60_000);
    this.last = now;
  }

  setPlan(s: PlanSetting): void {
    this.resize(() => { this.setting = s; });
    this.settingAt = this.clock.now();
    this.pump();
  }

  /** Changes the limit; a full bucket stays full at the new size, a partial one keeps what it has. */
  private resize(change: () => void): void {
    const now = this.clock.now();
    this.refill(now);
    const full = this.tokens >= this.capacity() - 1e-6;
    change();
    this.tokens = full ? this.capacity() : Math.min(this.tokens, this.capacity());
  }

  acquire(priority: CallPriority): Promise<void> {
    const now = this.clock.now();
    if (priority === "background" && now < this.quotaUntil) return Promise.reject(new OneQuotaHeld(new Date(this.quotaUntil)));
    return new Promise<void>((resolve, reject) => {
      this.waiters.push({ priority, resolve, reject });
      this.pump();
    });
  }

  private need(p: CallPriority): number { return p === "now" ? 1 : 1 + this.reserve(); }

  private pump(): void {
    if (this.timer !== null) { this.clock.clearTimer(this.timer); this.timer = null; }
    const now = this.clock.now();
    if (!this.waiters.length) return;
    if (now < this.blockedUntil) { this.timer = this.clock.setTimer(() => { this.timer = null; this.pump(); }, this.blockedUntil - now); return; }
    this.refill(now);
    // the person first, then background, each in arrival order
    for (;;) {
      const i = this.waiters.findIndex((w) => w.priority === "now");
      const idx = i >= 0 ? i : 0;
      const w = this.waiters[idx];
      if (!w) return;
      if (w.priority === "background" && now < this.quotaUntil) {
        this.waiters.splice(idx, 1);
        w.reject(new OneQuotaHeld(new Date(this.quotaUntil)));
        continue;
      }
      const need = this.need(w.priority);
      if (this.tokens < need) {
        const ms = Math.max(5, Math.ceil(((need - this.tokens) * 60_000) / this.capacity()));
        this.timer = this.clock.setTimer(() => { this.timer = null; this.pump(); }, ms);
        return;
      }
      this.tokens -= 1;
      this.recent.push(now);
      this.waiters.splice(idx, 1);
      w.resolve();
    }
  }

  /** What One's response said (headers and status). */
  observe(o: { status: number; limit?: number | null; remaining?: number | null; resetMs?: number | null; retryAfterMs?: number | null; refusal?: string | null; unlimited?: boolean }): void {
    const now = this.clock.now();
    if (o.unlimited) {
      this.resize(() => { this.learned = UNLIMITED_RPM; });
      this.learnedAt = now;
    }
    if (o.limit && o.limit > 0 && o.limit < 1_000_000) {
      const lim = Math.floor(o.limit);
      this.resize(() => { this.learned = lim; });
      this.learnedAt = now;
    }
    if (o.remaining !== null && o.remaining !== undefined && o.remaining >= 0) {
      const lim = this.limit();
      this.refill(now);
      this.tokens = Math.min(this.tokens, Math.max(0, o.remaining - (lim - this.capacity())));
    }
    if (o.refusal === "rate_limit" || (o.status === 429 && o.refusal === undefined)) {
      const wait = o.retryAfterMs ?? o.resetMs ?? DEFAULT_BLOCK_MS;
      this.blockedUntil = Math.max(this.blockedUntil, now + Math.max(1_000, wait));
      this.tokens = 0;
      this.lastRefusal = { kind: "rate_limit", at: now };
      // no header to learn from: assume the plan is tighter than we thought
      if (o.limit == null && this.learned === null) this.learned = Math.max(5, Math.floor(this.limit() / 2));
    }
    if (o.refusal === "plan_limit") {
      this.quotaUntil = now + QUOTA_RECHECK_MS;
      this.lastRefusal = { kind: "plan_limit", at: now };
      for (const w of this.waiters.filter((x) => x.priority === "background")) w.reject(new OneQuotaHeld(new Date(this.quotaUntil)));
      this.waiters = this.waiters.filter((x) => x.priority !== "background");
    } else if (o.status >= 200 && o.status < 400 && this.quotaUntil) {
      // a call went through: the month's requests are back (bought more, or a new month)
      this.quotaUntil = 0;
    }
    this.pump();
  }

  status(): Omit<OnePlanStatus, "monthCalls" | "todayCalls"> {
    const now = this.clock.now();
    this.recent = this.recent.filter((t) => now - t < 60_000);
    return {
      plan: this.setting.plan,
      customRpm: this.setting.rpm,
      limit: this.limit(),
      pace: this.capacity(),
      reserved: this.reserve(),
      limitFrom: this.source(),
      learnedAt: this.learnedAt ? new Date(this.learnedAt).toISOString() : null,
      lastMinute: this.recent.length,
      waiting: { now: this.waiters.filter((w) => w.priority === "now").length, background: this.waiters.filter((w) => w.priority === "background").length },
      slowedUntil: now < this.blockedUntil ? new Date(this.blockedUntil).toISOString() : null,
      heldUntil: now < this.quotaUntil ? new Date(this.quotaUntil).toISOString() : null,
    };
  }
}

// ---------- per user ----------

const budgets = new Map<string, Budget>();
let clock: Clock = realClock;

export function budgetFor(userId: string): Budget {
  let b = budgets.get(userId);
  if (!b) { b = new Budget(clock); budgets.set(userId, b); }
  return b;
}

/** Tests: a fresh map and an optional fake clock. */
export function resetBudgets(c?: Clock): void { budgets.clear(); clock = c ?? realClock; }

/** Loads the plan setting at most once a minute (Settings calls planChanged on save). */
export async function ensurePlan(userId: string, load: () => Promise<PlanSetting>): Promise<Budget> {
  const b = budgetFor(userId);
  if (clock.now() - b.settingAt > SETTINGS_TTL_MS) {
    try { b.setPlan(await load()); } catch { b.settingAt = clock.now(); }
  }
  return b;
}

export function planChanged(userId: string, s: PlanSetting): void { budgetFor(userId).setPlan(s); }

/** True while One has said this month's requests are used up (the scheduler skips the user). */
export function quotaHeld(userId: string): boolean {
  const b = budgets.get(userId);
  return !!b && clock.now() < b.quotaUntil;
}

// ---------- One's rate limit, as @withone/connect reports it ----------
// From 0.24, runAction returns `rateLimit: { limit, remaining, resetsIn,
// retryAfter }` (seconds) read off One's X-RateLimit-* and Retry-After headers
// for the call, or null when One sent none.

export interface PackageRateLimit { limit: number | null; remaining: number | null; resetsIn: number | null; retryAfter: number | null }

export function fromRateLimit(r: PackageRateLimit | null | undefined): { limit: number | null; remaining: number | null; resetMs: number | null; retryAfterMs: number | null; unlimited: boolean } | null {
  if (!r) return null;
  const ms = (s: number | null) => (s === null || !Number.isFinite(s) ? null : Math.round(s * 1000));
  // limit null with no remaining means nothing limits this user (an unlimited plan)
  return { limit: r.limit, remaining: r.remaining, resetMs: ms(r.resetsIn), retryAfterMs: ms(r.retryAfter), unlimited: r.limit === null && r.remaining === null };
}
