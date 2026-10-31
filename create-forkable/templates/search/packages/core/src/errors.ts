import type { ErrorCode, LedgerRow } from "./contract.js";

export class SearchError extends Error {
  constructor(public code: ErrorCode, message: string, public data?: unknown) { super(message); }
}
export class NotConnected extends SearchError {
  constructor(public platform: string) { super("not_connected", `${platform} is not in your grant`, { platform }); }
}
export class BlockedByGrant extends SearchError {
  constructor(public actionId: string, public row: LedgerRow | null) { super("blocked_by_grant", `One refused ${actionId}: not in the grant`, { actionId }); }
}
export class HttpError extends SearchError {
  constructor(public status: number, public body: unknown) {
    super(status === 429 ? "rate_limited" : status === 402 ? "plan_limit" : "upstream_error", `request failed with ${status}: ${JSON.stringify(body ?? null).slice(0, 300)}`, { status, body: JSON.stringify(body ?? null).slice(0, 500) });
  }
}
export class SampleActionLive extends SearchError {
  constructor(actionId: string) { super("sample_action_live", `sample action ${actionId} cannot run on a real grant`); }
}
export class UnresolvedAction extends SearchError {
  constructor(actionId: string) { super("unresolved_action", `unresolved action id ${actionId}`); }
}
