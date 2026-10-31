import type { Context } from "hono";
import type { AppEnv } from "../deps.js";
import { ApiError, badRequest } from "../errors.js";

export async function readJson<T>(c: Context<AppEnv>): Promise<T> {
  const text = await c.req.text();
  if (!text.trim()) return {} as T;
  try { return JSON.parse(text) as T; } catch { throw badRequest("The request body is not valid JSON."); }
}

/** Bearer requests (Phase 3) carry scopes; the cookie session has all four. */
export function need(c: Context<AppEnv>, scope: "search:read" | "search:ask" | "sources:write" | "account:read"): void {
  const scopes = c.get("scopes");
  if (scopes && !scopes.includes(scope)) throw new ApiError(403, "insufficient_scope", `This token lacks ${scope}.`, { required: scope });
}

/** Cookie-only routes (setup, settings writes): a bearer token never reaches them. */
export function cookieOnly(c: Context<AppEnv>): void {
  if (c.get("scopes")) throw new ApiError(403, "forbidden", "This route is for the browser session only.");
}

export function int(v: string | undefined, d: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : d;
}
