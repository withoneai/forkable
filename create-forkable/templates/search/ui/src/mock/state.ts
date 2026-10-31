// In-memory state of the mock server. A localStorage flag remembers the
// sample sign-in across reloads, the way Rill's mock remembers its mailbox.
import type { ApiSource, ChatMessage, LedgerRow, ProfileSetting, SettingsData, SourceHealth } from "@/contract/api-types";
import { logoUrl, platformName } from "@/lib/utils";
import { ITEMS, SOURCES, type MockSourceDef } from "./world";

const PERSIST = "search.mock";
interface Persisted { signedIn: boolean; setup: Record<string, { last4: string; at: string }> }
function read(): Persisted {
  try { const raw = localStorage.getItem(PERSIST); if (raw) { const p = JSON.parse(raw) as Partial<Persisted>; return { signedIn: !!p.signedIn, setup: p.setup ?? {} }; } } catch { /* ignore */ }
  return { signedIn: false, setup: {} };
}
export const persisted = read();
export const persist = () => { try { localStorage.setItem(PERSIST, JSON.stringify(persisted)); } catch { /* ignore */ } };

const min = 60_000;
const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

export const settings: SettingsData = {
  embedding: { provider: "local", model: "local:hash-v1", dims: 1536 },
  rerank: true,
  engine: "auto",
  chatModel: "claude-sonnet-5-5",
  proposalModel: "claude-haiku-5-5",
  localChatModel: "claude-sonnet-5-5",
  localProposalModel: "claude-haiku-5-5",
  jevModel: "jev-latest",
  backfillDefault: "365d",
  slackTier: "limited",
  vipEntityIds: ["ent_priya", "ent_owen"],
  lanesOn: true,
  paused: false,
};

export interface MockSourceState { def: MockSourceDef; health: SourceHealth; paused: boolean; scheduleEvery: string; settings: Record<string, unknown>; extraItems: number; origin: "builtin" | "user" }

const countFor = (d: MockSourceDef) => ITEMS.filter((i) => i.platform === d.platform && i.model === d.model).length;

function healthy(d: MockSourceDef, i: number): SourceHealth {
  const items = countFor(d);
  return {
    status: "healthy", lastSuccessAt: iso(-(4 + i) * min), lastAttemptAt: iso(-(4 + i) * min), nextRunAt: iso((11 - (i % 9)) * min), retryAt: null,
    consecutiveFailures: 0, itemCount: items, added24h: Math.min(items, (i * 3) % 7), updated24h: (i * 5) % 4, failed24h: 0, lastError: null,
  };
}

export const sources = new Map<string, MockSourceState>();
SOURCES.forEach((d, i) => {
  const h = healthy(d, i);
  if (d.platform === "slack") {
    Object.assign(h, { status: "rate_limited", retryAt: iso(6 * min), nextRunAt: iso(6 * min), lastError: { code: "rate_limited", message: "Slack is rate limiting Search. It allows one history call a minute for this app.", at: iso(-2 * min), httpStatus: 429 } });
  }
  if (d.platform === "teams") Object.assign(h, { failed24h: 2, status: "degraded", lastError: { code: "blocked_by_grant", message: "Search was not granted Read channel messages on Teams.", at: iso(-40 * min), httpStatus: 403 } });
  sources.set(d.id, { def: d, health: h, paused: false, scheduleEvery: d.platform === "slack" ? "15m" : d.kind === "event" ? "5m" : "15m", settings: settingsFor(d), extraItems: 0, origin: "builtin" });
});

function settingsFor(d: MockSourceDef): Record<string, unknown> {
  if (d.platform === "slack") return { maxChannels: 20, backfill: "30d" };
  if (d.platform === "granola") return { backfill: "365d", include: "transcript" };
  if (d.platform === "teams") return { channelMessages: false };
  if (d.platform === "gmail") return { backfill: "365d", skipPromotions: true };
  return { backfill: "365d" };
}
export function settingsSpecFor(d: MockSourceDef): Record<string, ProfileSetting> {
  if (d.platform === "slack") return { maxChannels: { type: "number", default: 20, min: 1, max: 200, label: "Channels to index", help: "The most active ones first." }, backfill: { type: "duration", default: "30d", label: "Backfill" } };
  if (d.platform === "granola") return { backfill: { type: "duration", default: "365d", label: "How far back" }, include: { type: "choice", default: "transcript", label: "Transcripts", options: [{ value: "", label: "Summary only" }, { value: "transcript", label: "Summary and transcript" }], help: "Transcripts make meetings searchable word for word. Summary only uses less space." } };
  if (d.platform === "teams") return { channelMessages: { type: "boolean", default: false, label: "Channel messages", help: "Needs admin consent in most tenants." } };
  if (d.platform === "gmail") return { backfill: { type: "duration", default: "365d", label: "Backfill" }, skipPromotions: { type: "boolean", default: true, label: "Skip Promotions" } };
  return { backfill: { type: "duration", default: "365d", label: "Backfill" } };
}

export function apiSource(s: MockSourceState): ApiSource {
  const d = s.def;
  return {
    id: d.id, platform: d.platform, name: platformName(d.platform), logoUrl: logoUrl(d.platform), connectionLabel: d.connectionLabel, mode: "fixture",
    profile: { id: `prf_${d.platform}_${d.model}`, slug: `${d.platform}.${d.model}`, title: d.title, kind: d.kind, version: 1, origin: s.origin, verified: "fixture", updateAvailable: d.platform === "hubspot" && d.model === "notes" },
    health: { ...s.health, status: s.paused ? "paused" : s.health.status, itemCount: s.health.itemCount },
    scheduleEvery: s.scheduleEvery, settings: s.settings, settingsSpec: settingsSpecFor(d), refetchPending: false,
  };
}

export const saved = [
  { id: "sv_1", name: "Globex, last 30 days", query: "with:globex.com after:30d", position: 0 },
  { id: "sv_2", name: "Needs you", query: "lane:needs-you", position: 1 },
  { id: "sv_3", name: "Open deals", query: "type:deal is:open", position: 2 },
];
export const recent = [
  { query: "globex renewal", at: iso(-12 * min), resultCount: 11 },
  { query: "from:priya after:30d type:mail", at: iso(-50 * min), resultCount: 3 },
  { query: "lane:needs-you", at: iso(-3 * 60 * min), resultCount: 6 },
  { query: "ACME-298", at: iso(-26 * 60 * min), resultCount: 2 },
  { query: "umbrella data residency", at: iso(-30 * 60 * min), resultCount: 4 },
];

let led = 0;
export function ledgerRow(p: Partial<LedgerRow> & Pick<LedgerRow, "platform" | "action" | "actionId" | "summary" | "sentence">): LedgerRow {
  return {
    id: `led_${++led}`, at: new Date().toISOString(), actor: "indexer", clientName: null, method: "GET", path: "/", mode: "fixture", level: "read", status: 200,
    ok: true, blockedByGrant: false, refusal: null, ms: 120, note: null, ...p,
  };
}

const L = (minsAgo: number, p: Parameters<typeof ledgerRow>[0]) => ({ ...ledgerRow(p), at: iso(-minsAgo * min) });
export const ledger: LedgerRow[] = [
  L(1, { platform: "anthropic", action: "Create a message", actionId: "conn_mod_def::anthropic::messages", actor: "assistant", method: "POST", path: "/v1/messages", summary: "Answered \"Where are we with Globex?\" with 3 citations", sentence: "The assistant answered a question from 12 results", ms: 2140 }),
  L(4, { platform: "hubspot", action: "Search deals", actionId: "conn_mod_def::hubspot::crm.deals.search", method: "POST", path: "/crm/v3/objects/deals/search", summary: "+1 updated", sentence: "Indexed 4 HubSpot deals", ms: 310 }),
  L(4, { platform: "gmail", action: "Get threads", actionId: "conn_mod_def::gmail::get-threads", path: "/gmail/v1/users/me/threads", summary: "+2 new, 3 updated", sentence: "Indexed 29 Gmail threads", ms: 880 }),
  L(5, { platform: "typesafe", action: "Ask System One", actionId: "conn_mod_def::typesafe::systemone", actor: "classifier", method: "POST", path: "/v1/judge", summary: "8 items judged", sentence: "Jev sorted 8 new items into lanes", ms: 640 }),
  L(6, { platform: "slack", action: "Conversation history", actionId: "conn_mod_def::slack::conversations.history", path: "/conversations.history", status: 429, ok: false, summary: "Rate limited, retrying at the next window", sentence: "Slack asked Search to slow down", ms: 95 }),
  L(9, { platform: "google-calendar", action: "List events", actionId: "conn_mod_def::google-calendar::events.list", path: "/calendars/primary/events", summary: "no change", sentence: "Checked Google Calendar for changes", ms: 210 }),
  L(11, { platform: "linear", action: "GraphQL issues", actionId: "conn_mod_def::linear::graphql", method: "POST", path: "/graphql", summary: "+1 updated", sentence: "Indexed 6 Linear issues", ms: 330 }),
  L(14, { platform: "notion", action: "Search", actionId: "conn_mod_def::notion::search", method: "POST", path: "/v1/search", summary: "+1 updated", sentence: "Indexed 4 Notion pages", ms: 520 }),
  L(40, { platform: "teams", action: "List channel messages", actionId: "conn_mod_def::teams::channels.messages.list", path: "/teams/{id}/channels/{id}/messages", status: 403, ok: false, blockedByGrant: true, refusal: "grant", summary: "Not in the grant", sentence: "Teams channel messages are not in the grant", ms: 12 }),
  L(62, { platform: "openai", action: "Create embeddings", actionId: "conn_mod_def::openai::embeddings", actor: "embedder", method: "POST", path: "/v1/embeddings", summary: "Sample embedder used instead", sentence: "Embedded 48 chunks with the sample embedder", ms: 4, mode: "fixture" }),
];

export const chats: { id: string; title: string; updatedAt: string; messages: ChatMessage[] }[] = [];

export const setupFields = ["ONE_CLIENT_ID", "ONE_PERMISSION_SET", "ONE_CLIENT_SECRET", "ONE_CONNECT_KEY"] as const;
export const createState: { state: "idle" | "waiting" | "approved" | "failed"; startedAt: number } = { state: "idle", startedAt: 0 };
