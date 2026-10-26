import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { BlockedByGrant, NotConnected } from "@rill/core";
import { OneConnectError } from "@withone/connect/server";

/** A route error with the status and code the UI reads. */
export class HttpError extends Error {
  constructor(public readonly status: ContentfulStatusCode, public readonly code: string, message: string, public readonly extra?: Record<string, unknown>) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, "not_found", `${what} not found`);
export const badRequest = (message: string) => new HttpError(400, "bad_request", message);
export const forbidden = (message: string) => new HttpError(403, "forbidden", message);
export const conflict = (message: string) => new HttpError(409, "conflict", message);

/** Maps any thrown value to `{ error: { code, message } }`. Secrets never reach here; messages are ours. */
export function errorToResponse(c: Context, err: unknown): Response {
  if (err instanceof HttpError) {
    return c.json({ error: { code: err.code, message: err.message }, ...(err.extra ?? {}) }, err.status);
  }
  if (err instanceof BlockedByGrant) {
    return c.json({ error: { code: "blocked_by_grant", message: err.message }, ledger: err.row }, 403);
  }
  if (err instanceof NotConnected) {
    return c.json({ error: { code: "not_connected", message: err.message } }, 403);
  }
  if (err instanceof OneConnectError) {
    if (err.code === "reconnect_required") {
      return c.json({ error: { code: "reconnect_required", message: "Your One grant is gone. Connect again to keep going." } }, 409);
    }
    if (err.code === "not_connected") {
      return c.json({ error: { code: "not_connected", message: "Connect your mail through One first." } }, 403);
    }
    return c.json({ error: { code: "one_unreachable", message: "One did not answer. Try again in a moment." } }, 502);
  }
  if (err instanceof SyntaxError) {
    return c.json({ error: { code: "bad_request", message: "The request body is not valid JSON." } }, 400);
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[rill] unhandled error:", message);
  return c.json({ error: { code: "internal", message: "Something went wrong on the server." } }, 500);
}
