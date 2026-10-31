// HTTP types (docs/CONTRACT.md sections 6 and 7). Browser-safe: types only.

import type {
  Capability, SettingsData, ItemKind, ItemFacets, EntityRole, SourceHealth, RunSummary, RunTrigger,
  ProfileSetting, SearchProfile, LedgerActor, ErrorCode,
} from "./contract.js";
import type { DateProposal } from "./query/dates.js";

export type { DateProposal };

export interface ApiUser { id: string; name: string | null; email: string | null; avatarUrl: string | null; isSample: boolean }
export interface MeResponse { user: ApiUser | null; signedIn: boolean; connect: { configured: boolean; signInUrl: string | null }; capability: Capability; settings: SettingsData | null }

export interface ResultRow {
  id: string; kind: ItemKind; platform: string; sourceId: string; sourceName: string; logoUrl: string;
  title: string; titleHighlights: [number, number][];
  context: string | null;
  snippet: string | null; snippetHighlights: [number, number][];
  occurredAt: string; updatedAt: string | null; url: string | null;
  people: { entityId: string; name: string; role: EntityRole; avatarUrl: string | null }[];
  facets: ItemFacets; lane: Lane | null; importance: number | null;
  groupCount: number;
  /** One row per human (D43): the other platforms whose records for the same person or company folded into this row. */
  alsoIn?: string[];
  /** Why this row is first when an exact match put it there: an email, a domain, an id or the whole name. */
  exact?: "email" | "domain" | "id" | "name" | null;
  score: number; ranks: { kw: number | null; vec: number | null; title: number | null; rerank: number | null };
}
export type Lane = "vip" | "needs_you" | "waiting" | "fyi" | "low";

export interface ParsedQuery {
  text: string;
  clauses: QueryClause[];
  errors: { at: number; message: string }[];
}
export type QueryClause =
  | { kind: "word"; value: string; negate: boolean }
  | { kind: "phrase"; value: string; negate: boolean }
  | { kind: "or" }
  | { kind: "op"; key: OperatorKey; values: OpValue[]; negate: boolean; raw: string };
export type OperatorKey = "source" | "account" | "type" | "is" | "from" | "to" | "with" | "about" | "before" | "after" | "on" | "updated" | "during" | "has" | "status" | "stage" | "lane" | "label" | "container" | "amount" | "id";
export type OpValue =
  | { t: "text"; v: string }
  | { t: "date"; v: string; resolved: { from: string; to: string } }
  | { t: "range"; from: string; to: string }
  | { t: "cmp"; op: ">" | ">=" | "<" | "<="; v: string | number; resolved?: string };
export interface ChipEdit { key: OperatorKey; values: string[] | null; negate?: boolean }

export interface SearchRequest { q: string; /** skip the query vector cache (the UI Refresh) */ fresh?: boolean; limit?: number; offset?: number; sort?: "best" | "newest" | "oldest"; scope?: ItemKind | "all"; selectedEntityIds?: string[] }
export interface SearchResponse {
  queryId: string;
  parsed: ParsedQuery;
  total: number;
  hiddenByFilters: number;
  counts: { scope: Record<ItemKind | "all", number>; source: Record<string, number> };
  entities: EntityChip[];
  results: ResultRow[];
  mode: "hybrid" | "keyword";
  embedder: EmbedderStatus;
  /** The keyword arm found nothing for every word together, so it ran again with OR between the words. */
  fallback: "or" | null;
  /** Plain dates read from the text ("last month", "in October"), offered as chips; never applied on their own. */
  dateProposals: DateProposal[];
  /** An entity whose name is close to the text when nothing named it exactly ("Did you mean Priya Shah?"). */
  didYouMean: EntityChip | null;
  ms: number;
}
/** semantic is false when the vector arm did not run; reason says why (D41). */
export interface EmbedderStatus { model: string; semantic: boolean; reason: SemanticOffReason | null; platform: string | null; message: string | null }
export type SemanticOffReason = "not_in_grant" | "error" | "keyword_mode" | "sample";

export interface EntityChip { id: string; type: "person" | "company"; name: string; subtitle: string | null; avatarUrl: string | null; logoUrl: string | null; itemCount: number; sources: string[]; isSelf: boolean; email: string | null }

/** `fresh` (the UI's Refresh) asks Jev about every candidate again and overwrites the stored scores. */
export interface RerankRequest { queryId: string; fresh?: boolean }
/** `stored` candidates reused a score from rerank_scores, `asked` went to Jev in this request (0 when every score was stored). */
export interface RerankResponse { queryId: string; order: string[]; reranked: boolean; ms: number; reason?: "off" | "short_query" | "timeout" | "jev_missing" | "sample_no_fixture"; stored?: number; asked?: number }

export interface SuggestResponse { operators: { insert: string; label: string; avatarUrl?: string; logoUrl?: string }[]; entities: EntityChip[]; recent: string[] }

export interface ItemDetail {
  row: ResultRow; body: string; bodyHighlights: [number, number][];
  parts: { kind: "message" | "section"; title: string | null; author: string | null; at: string | null; text: string }[];
  properties: { label: string; value: string }[];
  classification: { lane: Lane | null; importance: number | null; kindGuess: string | null; needsYou: number | null; by: "jev" | "rules" | "fixture" | null };
  related: ResultRow[];
  rawAvailable: boolean;
}

export interface EntityDetail {
  entity: { id: string; type: "person" | "company"; name: string; emails: string[]; domain: string | null; title: string | null; company: EntityChip | null; avatarUrl: string | null; isSelf: boolean; sources: { platform: string; count: number; lastAt: string }[] };
  timeline: ResultRow[];
  pendingMatches: { matchId: string; other: EntityChip; probability: number; reason: string }[];
  /** People merged into this one (by email, by Jev or by the user); each can be unmerged (POST /entities/:mergedId/unmerge). */
  merged?: { id: string; name: string; email: string | null; platforms: string[]; decidedBy: "jev" | "user" | "fixture" | null; probability: number | null }[];
}

export interface Citation { n: number; itemId: string; chunkId: string | null; kind: ItemKind; title: string; platform: string; url: string | null; quote: string; occurredAt: string }
export interface QueryProposal { query: string; diff: { op: "+" | "-"; clause: string }[]; count: number; reason: string }
export type ChatStep = { id: string; label: string; state: "running" | "done" | "error"; query?: string; count?: number };
export interface ChatContext { query?: string; queryId?: string; itemIds?: string[]; selectedItemId?: string }
export interface ChatMessage { id: string; role: "user" | "assistant"; content: string; citations: Citation[]; steps: ChatStep[]; proposal: QueryProposal | null; followups: string[]; grounded: boolean; model: string; createdAt: string }
export interface ChatTurnInput { chatId?: string; message: string; context: ChatContext }
export interface AnswerRequest { q: string; queryId?: string }
export interface AnswerResponse { text: string; citations: Citation[]; grounded: boolean; model: string }

export interface ApiSource {
  id: string; platform: string; name: string; logoUrl: string; connectionLabel: string; mode: "fixture" | "connect";
  profile: { id: string; slug: string; title: string; kind: ItemKind; version: number; origin: "builtin" | "user" | "import" | "url"; verified: "none" | "fixture" | "real"; updateAvailable: boolean };
  health: SourceHealth; scheduleEvery: string; settings: Record<string, unknown>; settingsSpec: Record<string, ProfileSetting>;
  /** True when a setting the fetch reads (or the profile's fetch) changed since the last good run: the next run fetches every item again. */
  refetchPending: boolean;
  /** The actions the profile calls, with method and path from connect.manifest.json (null when the manifest has none). */
  actions?: SourceAction[];
}
export interface SourceAction { actionId: string; method: string | null; path: string | null }
export interface SourcesResponse { semantic: EmbedderStatus; sources: ApiSource[]; available: { platform: string; name: string; logoUrl: string; connectionKey: string; connectionLabel: string; builtinProfiles: string[] }[]; notInApp: { platform: string; name: string; logoUrl: string }[]; banner: { level: "warn" | "error"; text: string; sourceId: string | null; action: "reconnect" | "manage_in_one" | "retry" } | null }
export interface ApiRun extends RunSummary { trigger: RunTrigger }
export interface ApiItemError { externalId: string; stage: string; code: string; message: string; attempts: number; lastAt: string }

export interface ApiProfile { id: string; slug: string; platform: string; model: string; title: string; origin: string; currentVersion: number; profileHash: string; verified: string; json: SearchProfile }

export interface AccessResponse {
  grantedBy: { name: string | null; email: string | null };
  platforms: { platform: string; name: string; logoUrl: string; connectionLabel: string; actions: { actionId: string; title: string; verb: string; level: "read" | "write"; granted: boolean; usedBy: string[] }[] }[];
  readOnly: boolean; manageUrl: string;
  status: "active" | "reconnect_required" | "revoked" | "none"; mode: "fixture" | "connect";
}
export interface LedgerRow { id: string; at: string; actor: LedgerActor; clientName: string | null; platform: string; action: string; actionId: string; method: string; path: string; mode: "fixture" | "connect"; level: "read" | "write"; status: number; ok: boolean; blockedByGrant: boolean; refusal: string | null; ms: number; summary: string; note: string | null; sentence: string }

export interface OAuthClientRow { clientId: string; name: string; createdAt: string; lastUsedAt: string | null; scopes: string[]; activeTokens: number }
export interface ConnectSetupResponse { available: boolean; configured: boolean; source: "store" | "env" | null; redirectUri: string; storage: "keychain" | "file"; shadowed: boolean; fields: { name: "ONE_CLIENT_ID" | "ONE_CLIENT_SECRET" | "ONE_CONNECT_KEY" | "ONE_PERMISSION_SET"; saved: boolean; where: "keychain" | "file" | "env" | null; updatedAt: string | null; last4: string | null }[]; create: { running: boolean; approvalUrl: string | null; state: "idle" | "waiting" | "approved" | "failed"; message?: string; askChanged: boolean } }

// ---------- streaming (CONTRACT 7) ----------

export type ChatEvent =
  | { type: "chat"; chatId: string; messageId: string }
  | { type: "step"; step: ChatStep }
  | { type: "results"; items: (ResultRow & { n: number })[] }
  | { type: "answer"; text: string; citations: Citation[]; grounded: boolean; model: string }
  | { type: "proposal"; proposal: QueryProposal }
  | { type: "followups"; items: string[] }
  | { type: "error"; error: { code: ErrorCode; message: string } }
  | { type: "done"; messageId?: string };

export type ServerEvent =
  | { type: "source"; sourceId: string; health: SourceHealth }
  | { type: "run"; sourceId: string; run: ApiRun }
  | { type: "index"; added: number; updated: number; removed: number; sourceId: string }
  | { type: "entity"; entityId: string; change: "merged" | "match_pending" | "unmerged" }
  | { type: "draft"; draftId: string; stage: "actions" | "docs" | "dry_run" | "propose" | "validate" | "ready" | "failed"; message?: string }
  | { type: "health"; capability: Capability }
  | { type: "ledger"; row: LedgerRow }
  | { type: "ping" };

export type { Capability, SettingsData, ItemKind, ItemFacets, EntityRole, SourceHealth, SearchProfile, ProfileSetting };
