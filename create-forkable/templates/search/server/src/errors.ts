// Every error leaves as { error: { code, message, data? } } (CONTRACT 8). Messages
// are ours; a secret never reaches one.

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { BlockedByGrant, SearchError } from "@search/core";
import { OneConnectError } from "@withone/connect/server";

export class ApiError extends Error {
  constructor(public readonly status: ContentfulStatusCode, public readonly code: string, message: string, public readonly data?: unknown) {
    super(message);
  }
}

export const notFound = (what: string) => new ApiError(404, "not_found", `${what} not found.`);
export const badRequest = (message: string, data?: unknown) => new ApiError(400, "bad_request", message, data);
export const conflict = (message: string) => new ApiError(409, "conflict", message);
export const notSignedIn = () => new ApiError(401, "not_signed_in", "Sign in with One or open the Acme sample first.");

const STATUS: Record<string, ContentfulStatusCode> = {
  bad_request: 400, invalid_fields: 400, invalid_query: 400, invalid_profile: 400,
  unauthorized: 401, token_expired: 401, not_signed_in: 401,
  insufficient_scope: 403, forbidden: 403, local_only: 403, blocked_by_grant: 403,
  not_found: 404, conflict: 409, not_connected: 409, reconnect_required: 409,
  model_unavailable: 409, embedding_unavailable: 409, keyword_only: 409,
  rate_limited: 429, plan_limit: 402, upstream_error: 502,
  sample_action_live: 500, unresolved_action: 500, internal: 500,
};

export function statusFor(code: string): ContentfulStatusCode {
  return STATUS[code] ?? 500;
}

export function errorBody(err: unknown): { status: ContentfulStatusCode; body: { error: { code: string; message: string; data?: unknown } } } {
  if (err instanceof ApiError) return { status: err.status, body: { error: { code: err.code, message: err.message, ...(err.data !== undefined ? { data: err.data } : {}) } } };
  if (err instanceof BlockedByGrant) return { status: 403, body: { error: { code: "blocked_by_grant", message: err.message, data: { actionId: err.actionId, ledger: err.row } } } };
  if (err instanceof SearchError) return { status: statusFor(err.code), body: { error: { code: err.code, message: err.message, ...(err.data !== undefined ? { data: err.data } : {}) } } };
  if (err instanceof OneConnectError) {
    if (err.code === "reconnect_required") return { status: 409, body: { error: { code: "reconnect_required", message: "Your One grant is gone. Sign in with One again to keep going." } } };
    if (err.code === "not_connected") return { status: 409, body: { error: { code: "not_connected", message: "Sign in with One first." } } };
    return { status: 502, body: { error: { code: "upstream_error", message: "One did not answer. Try again in a moment." } } };
  }
  if (err instanceof SyntaxError) return { status: 400, body: { error: { code: "bad_request", message: "The request body is not valid JSON." } } };
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[search] unhandled error: ${err instanceof Error ? err.stack ?? message : message}`);
  return { status: 500, body: { error: { code: "internal", message: "Something went wrong on the server." } } };
}

export function errorToResponse(c: Context, err: unknown): Response {
  const { status, body } = errorBody(err);
  return c.json(body, status);
}
