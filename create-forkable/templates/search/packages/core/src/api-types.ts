// HTTP types (docs/CONTRACT.md sections 6 and 7). Browser-safe: types only.

import type {
  Capability, SettingsData, ItemKind, ItemFacets, EntityRole, SourceHealth, RunSummary, RunTrigger,
  ProfileSetting, SearchProfile, LedgerActor, ErrorCode,
} from "./contract.js";
import type { DateProposal } from "./query/dates.js";
import type { Understood, UnderstandChoice, UnderstandSuggestion } from "./query/understand.js";

export type { DateProposal, Understood, UnderstandChoice, UnderstandSuggestion };

export interface ApiUser { id: string; name: string | null; email: string | null; avatarUrl: string | null; isSample: boolean }
export interface MeResponse { user: ApiUser | null; signedIn: boolean; connect: { configured: boolean; signInUrl: string | null }; capability: Capability; settings: SettingsData | null; database?: DatabaseInfo | null }
/** Where this Search keeps its data, as the running server knows it (Settings, Database). Signed-in callers only. */
export interface DatabaseInfo {
  kind: "embedded" | "external";
  /** The connection string with its password masked. */
  url: string;
  /** The embedded data folder, with the home folder shown as ~; null for an external database. */
  dataDir: string | null;
  port: number | null;
  version: string;
}

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

export interface SearchRequest {
  q: string; /** skip the query vector cache (the UI Refresh) */ fresh?: boolean; limit?: number; offset?: number; sort?: "best" | "newest" | "oldest"; scope?: ItemKind | "all"; selectedEntityIds?: string[];
  /** Read plain phrases ("emails from Priya last week") into filters (D48). Off unless asked; REST and the web turn it on. */
  understand?: boolean;
  /** IANA zone date words resolve in ("Asia/Qatar"): the browser's. Else the server's own. */
  tz?: string;
}
export interface SearchResponse {
  queryId: string;
  /** What was searched: the box with understood phrases read as filters (the box itself when understanding is off). */
  parsed: ParsedQuery;
  /** Whether plain phrases were read (D48). */
  understanding: boolean;
  /** Phrases applied as filters, in text order; each removable (the UI quotes the phrase to keep it as words). */
  understood: Understood[];
  /** Phrases that could mean more than one thing (two Priyas, a name or a tool), with choices; never applied. */
  suggestions: UnderstandSuggestion[];
  /** The query actually run, as operator text ("type:mail from:priya@globex.com after:..."). Equals q when nothing was understood. */
  searchedAs: string;
  total: number;
  hiddenByFilters: number;
  counts: { scope: Record<ItemKind | "all", number>; source: Record<string, number> };
  entities: EntityChip[];
  results: ResultRow[];
  mode: "hybrid" | "keyword";
  embedder: EmbedderStatus;
  /**
   * "or": the keyword arm found nothing for every word together, so it ran again with OR between the words.
   * "filters": a read sentence's leftover words (`unmatched`) matched nothing under its filters, so the page
   * lists what the filters match on their own (D48).
   */
  fallback: "or" | "filters" | null;
  /** With fallback "filters": the words no result had, or (with `matchedWords`) only that many had. */
  unmatched?: string | null;
  /** With fallback "filters": how many items had the words; they come first, then everything else the filters match. */
  matchedWords?: number;
  /**
   * The first `topRows` rows are the ones the words match best (every word, or all of them the
   * filters' items had); the rest follow under a divider named `restLabel` ("Other messages in Slack"),
   * which the web app shows collapsed. Absent when every row matches as well as the first.
   */
  /** With a during: date ("deals closing this quarter"): deals with no close date and tasks with no due date, left out of any range. */
  undated?: { deals: number; tasks: number };
  topRows?: number;
  restLabel?: string;
  /** Which filter hides how many items that have the words; a read phrase carries its phrase and offsets so the UI can keep it as words. */
  hiddenBy?: { label: string; filter: string; phrase: string | null; start: number | null; end: number | null; n: number }[];
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
  entity: { id: string; type: "person" | "company"; name: string; emails: string[]; domain: string | null; title: string | null; company: EntityChip | null; avatarUrl: string | null; isSelf: boolean; sources: { platform: string; count: number; lastAt: string }[];
    /** The same number every card that opens this page shows (EntityChip.itemCount, both from entityItemStats): live items linked to it, its own records included, and for a company its people's items. */
    itemCount: number };
  /** Newest first, at most 50: its own records (the contact itself) left out, two tools' copies of one thing shown once, and for a company its people's items too. Fewer than itemCount when any of those apply. */
  timeline: ResultRow[];
  pendingMatches: { matchId: string; other: EntityChip; probability: number; reason: string }[];
  /** People merged into this one (by email, by Jev or by the user); each can be unmerged (POST /entities/:mergedId/unmerge). */
  merged?: { id: string; name: string; email: string | null; platforms: string[]; decidedBy: "jev" | "user" | "fixture" | null; probability: number | null }[];
}

export interface Citation { n: number; itemId: string; chunkId: string | null; kind: ItemKind; title: string; platform: string; url: string | null; quote: string; occurredAt: string }
export interface QueryProposal { query: string; diff: { op: "+" | "-"; clause: string }[]; count: number; reason: string }
export type ChatStep = { id: string; label: string; state: "running" | "done" | "error"; query?: string; count?: number };
export interface ChatContext {
  query?: string; queryId?: string; itemIds?: string[]; selectedItemId?: string;
  /** Read `query` as a sentence (D48) when it is searched again (no `queryId` page to read). Unset: on for the web app, off for MCP and REST. */
  understand?: boolean;
  /** IANA zone for date words in `query`. */
  tz?: string;
}
export interface ChatMessage { id: string; role: "user" | "assistant"; content: string; citations: Citation[]; steps: ChatStep[]; proposal: QueryProposal | null; followups: string[]; grounded: boolean; model: string; createdAt: string }
export interface ChatTurnInput { chatId?: string; message: string; context: ChatContext }
export interface AnswerRequest { q: string; queryId?: string; understand?: boolean; tz?: string }
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
/** The Agents screen (SPEC 16.5): one coding agent on this computer. */
export type AgentId = "claude-code" | "codex" | "cursor" | "claude-desktop";
export type AgentState = "not_found" | "not_connected" | "added" | "connected";
export interface AgentRow {
  id: AgentId;
  name: string;
  /** Installed on this computer (the CLI on PATH, the app, or its config folder). */
  found: boolean;
  foundWhere: string | null;
  /** Search's entry is in the agent's config. */
  added: boolean;
  state: AgentState;
  /** The newest use by a sign-in that belongs to this agent. */
  lastUsedAt: string | null;
  /** What the person still has to do, in plain words, when state is "added"; on a connected card not used yet, how to start using it. */
  nextStep: string | null;
  /** The name Search's entry has in this agent ("search", or "search-local" when "search" is someone else's). */
  entryName: string | null;
  /** Something the person should know, in plain words (a name already taken, a sign-in with no entry). */
  note: string | null;
  configPath: string;
  /** OAuth clients that belong to this agent (signed in at least once). */
  clientIds: string[];
  /** Claude Code only: the usage skill is installed in its skills folder. */
  skillInstalled?: boolean;
  /** Search is in the agent's settings but its sign-in ended (signed out, another account, removed): Connect signs it in again. */
  needsConnect?: boolean;
}
export interface AgentsResponse {
  /** False when this server does not run on the person's own computer. */
  local: boolean;
  mcpUrl: string;
  startUrl: string;
  /** The one sentence to paste into any agent. */
  setupSentence: string;
  /** The generic MCP config for any other client. */
  genericJson: string;
  agents: AgentRow[];
  /** Set while the browser shows the Acme sample and apps are still connected to the person's own account. */
  sampleNote?: string | null;
}
export interface AgentActionResult { agent: AgentRow; changed: boolean; message: string; backup: string | null }
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
