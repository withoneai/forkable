// Domain and engine types. The compiled form of docs/CONTRACT.md sections 3 to 5.
// Type-only file: browser-safe (the UI may import types from here).

import type { Lane, LedgerRow, ServerEvent, ResultRow } from "./api-types.js";
export type { Lane, LedgerRow, ServerEvent, ResultRow };

// ---------- profile format (CONTRACT 4.1) ----------

export type Path = string; // a.b | a.0 | a[0] | a[-1] | a[] | a[name=From]
export type Template = string; // "{{ expr | filter:arg }}" or a literal

export type Expr =
  | Path
  | { path: Path; pick?: "first" | "last" | "all" | "join" | "count"; sep?: string; decode?: Decoder }
  | { template: Template }
  | { coalesce: Expr[] }
  | { join: Expr[]; sep?: string }
  | { test: string };

export type Decoder =
  | "text" | "html" | "markdown" | "mail-strip" | "graph-body" | "mime-body"
  | "notion-blocks" | "notion-title" | "slack-mrkdwn" | "prosemirror" | "transcript"
  | "email" | "domain" | "datetime" | "address" | "number";

export interface RequestSpec {
  actionId: string;
  pathVars?: Record<string, Template>;
  query?: Record<string, Template | Template[]>;
  body?: unknown;
  headers?: Record<string, Template>;
}

export type PassAs = `${"query" | "body" | "header"}:${string}`;
export type Pagination =
  | { type: "none" }
  | { type: "cursor"; next: Path; passAs: PassAs; hasMore?: Path; hasMoreInverted?: boolean }
  | { type: "offset"; passAs: PassAs; total?: Path; start?: 0 | 1; nextPath?: Path; hasMore?: Path }
  | { type: "page"; passAs: PassAs; start?: 0 | 1; totalPages?: Path }
  | { type: "lastId"; idPath: Path; passAs: PassAs; hasMore?: Path }
  | { type: "relay"; endCursor: Path; hasNextPage: Path; passAs: PassAs }
  | { type: "linkHeader" }
  | { type: "nextUrl"; next: Path };

export type Duration = string;

export type Incremental =
  | { strategy: "full" }
  | { strategy: "watermark"; field: Path; order?: "asc" | "desc"; overlap?: Duration; restartOnCap?: number; initial?: Duration }
  | { strategy: "delta"; tokenPath: Path; tokenPassAs?: PassAs | "url"; bootstrap?: RequestSpec; resetOn?: number[]; initial?: Duration };

export interface ListSpec extends RequestSpec {
  resultsPath: Path;
  idPath: Path;
  pagination: Pagination;
  pageSize?: { param: string; value: number; in?: "query" | "body" };
}

export interface PartitionSpec extends RequestSpec {
  as: string;
  resultsPath: Path;
  idPath: Path;
  pagination: Pagination;
  keep?: string;
  order?: { by: Path; dir: "asc" | "desc" };
  max?: number | Template;
  next?: PartitionSpec;
}

export interface ChildSpec {
  as: string;
  request: RequestSpec;
  resultsPath: Path;
  pagination?: Pagination;
  maxPages?: number;
  when?: string;
}

export interface Hydrate {
  request: RequestSpec;
  resultsPath?: Path;
  fingerprint?: Template;
  children?: ChildSpec[];
  concurrency?: number;
  notFoundIsDelete?: boolean;
  /** Predicate over item: hydrate only when it holds (Slack replies only for threaded messages). */
  when?: string;
}

export interface Deletes {
  when?: string;
  reconcile?: "never" | "onFullPass";
  fullPassEvery?: Duration;
}

export type ItemKind =
  | "person" | "company" | "email_thread" | "event" | "doc" | "task"
  | "message" | "meeting_note" | "deal" | "note" | "record";

export const ITEM_KINDS: ItemKind[] = [
  "person", "company", "email_thread", "event", "doc", "task",
  "message", "meeting_note", "deal", "note", "record",
];

export interface FieldMap {
  title: Expr;
  body?: Expr;
  snippet?: Expr;
  occurredAt: Expr;
  updatedAt?: Expr;
  url?: Template;
  container?: Expr;
  groupKey?: Expr;
  status?: Expr;
  labels?: Expr;
  facets?: Record<string, Expr>;
}

export type EntityRole = "is" | "from" | "to" | "cc" | "attendee" | "organizer" | "owner" | "assignee" | "author" | "mentioned" | "about";

export interface EntityRef {
  role: Exclude<EntityRole, "is">;
  type: "person" | "company";
  email?: Expr;
  name?: Expr;
  address?: Expr;
  domain?: Expr;
  externalId?: Expr;
  response?: Expr;
  /** Fan out over this path; the other expressions resolve against each element (its fields, or `el` for a scalar). */
  each?: Path;
}

export interface Entities {
  /** allEmails: every address `email` resolves to is this one person's (a CRM record with two), so each is a merge key (D43). Off, a list makes no key. */
  is?: { type: "person" | "company"; email?: Expr; domain?: Expr; name?: Expr; externalId?: Expr; title?: Expr; companyName?: Expr; allEmails?: boolean };
  refs?: EntityRef[];
  ignoreDomains?: string[];
  directory?: boolean;
}

export interface Chunking {
  strategy: "whole" | "paragraph" | "message" | "heading";
  unit?: Path;
  unitBody?: Expr;
  maxTokens?: number;
  overlapTokens?: number;
  header?: Template;
}

export interface ClassifyExtra {
  key: string;
  jev: { question: Template; output: "labels" | "boolean" | "score"; labels?: string[]; into: string };
  when?: string;
}

export interface Limits {
  requestsPerMinute?: number;
  perAction?: Record<string, { requestsPerMinute: number; pageSize?: number }>;
  maxPagesPerRun?: number;
  maxItemsPerRun?: number;
}

export type ProfileSetting =
  | { type: "duration"; default: string; label: string; help?: string }
  | { type: "string"; default: string; label: string; help?: string }
  | { type: "number"; default: number; label: string; min?: number; max?: number; help?: string }
  | { type: "boolean"; default: boolean; label: string; help?: string }
  | { type: "choice"; default: string; options: { value: string; label: string }[]; label: string; help?: string };

export interface SearchProfile {
  $schema: "https://search.forkable.dev/schema/profile-1.json";
  id: string;
  platform: string;
  model: string;
  kind: ItemKind;
  title: string;
  description?: string;
  author?: string;
  revision?: number;
  verified?: "none" | "fixture" | "real";
  proposal?: { by: string; draftId: string; at: string };
  sampleOnly?: boolean;
  enabledByDefault?: boolean;
  account?: { request: RequestSpec; vars: Record<string, Path>; self?: { kind: "email" | "domain" | "ext"; var: string }[]; optional?: boolean };
  settings?: Record<string, ProfileSetting>;
  partitions?: PartitionSpec;
  list: ListSpec;
  incremental: Incremental;
  hydrate?: Hydrate;
  deletes?: Deletes;
  keep?: string;
  fields: FieldMap;
  entities?: Entities;
  chunk?: Chunking;
  classify?: ClassifyExtra[];
  limits?: Limits;
  schedule?: { every: Duration };
}

export interface SearchProfilePack {
  $schema: "https://search.forkable.dev/schema/pack-1.json";
  name: string;
  platform: string;
  profiles: SearchProfile[];
}

export interface EngineVersions { decoder: number; chunker: number; normalize: number }
export interface ProfileHashes { fetchHash: string; mapHash: string; indexHash: string; profileHash: string }

// ---------- normalized items (CONTRACT 4.3) ----------

export interface NormalizedItem {
  externalId: string;
  kind: ItemKind;
  title: string;
  body: string;
  snippet: string | null;
  occurredAt: string;
  updatedAt: string | null;
  url: string | null;
  container: string | null;
  groupKey: string | null;
  status: string | null;
  labels: string[];
  facets: ItemFacets;
  refs: ResolvedRef[];
  is: ResolvedIs | null;
  deleted: boolean;
  /** No date on the record at all: occurredAt is when Search first saw it, kept from run to run (D45). Never hashed. */
  occurredAtGuessed?: boolean;
}

export interface ResolvedRef { role: EntityRole; type: "person" | "company"; email?: string; name?: string; domain?: string; externalId?: string; response?: string }
export interface ResolvedIs { type: "person" | "company"; email?: string; /** every address of a record that has 2 to 5 (D43): records sharing one are one person */ emails?: string[]; domain?: string; name?: string; externalId?: string; title?: string; companyName?: string }

export type ItemFacets =
  | ({ kind: "person" } & PersonFacets)
  | ({ kind: "company" } & CompanyFacets)
  | ({ kind: "email_thread" } & EmailThreadFacets)
  | ({ kind: "event" } & EventFacets)
  | ({ kind: "doc" } & DocFacets)
  | ({ kind: "task" } & TaskFacets)
  | ({ kind: "message" } & MessageFacets)
  | ({ kind: "meeting_note" } & MeetingNoteFacets)
  | ({ kind: "deal" } & DealFacets)
  | ({ kind: "note" } & NoteFacets)
  | ({ kind: "record" } & Record<string, unknown>);

type Extras = { [k: `x_${string}`]: unknown };
export type PersonFacets = Extras & { email?: string; phone?: string; jobTitle?: string; companyName?: string; companyDomain?: string; lifecycle?: string; owner?: string; location?: string };
export type CompanyFacets = Extras & { domain?: string; industry?: string; size?: string; owner?: string; location?: string; categories?: string[] };
export type EmailThreadFacets = Extras & { messageCount: number; unread?: boolean; hasAttachment?: boolean; lastFrom?: string; participants?: string[]; folder?: string };
export type EventFacets = Extras & { start: string; end: string; allDay?: boolean; timeZone?: string; location?: string; joinUrl?: string; organizerEmail?: string; attendees?: { email?: string; name?: string; response?: string }[]; selfResponse?: string; recurring?: boolean; calendar?: string; calendarColor?: string };
export type DocFacets = Extras & { parentTitle?: string; path?: string[]; editedBy?: string; wordCount?: number };
export type TaskFacets = Extras & { key?: string; state?: string; stateType?: "backlog" | "unstarted" | "started" | "completed" | "canceled"; assignee?: string; priority?: 0 | 1 | 2 | 3 | 4; due?: string; project?: string; team?: string };
export type MessageFacets = Extras & { channel?: string; channelType?: "channel" | "private" | "dm" | "group" | "chat"; sender?: string; threadId?: string; replyCount?: number; isReply?: boolean };
export type MeetingNoteFacets = Extras & { start?: string; end?: string; durationMin?: number; attendees?: { email?: string; name?: string }[]; takeaways?: string[]; hasTranscript?: boolean; eventId?: string };
export type DealFacets = Extras & { amount?: number; currency?: string; stage?: string; closeDate?: string; pipeline?: string; owner?: string; companyName?: string };
export type NoteFacets = Extras & { parentKind?: ItemKind; parentTitle?: string; parentExternalId?: string };

/** Facet keys allowed per kind (besides x_*). Used by validateProfile. */
export const FACETS_BY_KIND: Record<ItemKind, string[]> = {
  person: ["email", "phone", "jobTitle", "companyName", "companyDomain", "lifecycle", "owner", "location"],
  company: ["domain", "industry", "size", "owner", "location", "categories"],
  email_thread: ["messageCount", "unread", "hasAttachment", "lastFrom", "participants", "folder"],
  event: ["start", "end", "allDay", "timeZone", "location", "joinUrl", "organizerEmail", "attendees", "selfResponse", "recurring", "calendar", "calendarColor"],
  doc: ["parentTitle", "path", "editedBy", "wordCount"],
  task: ["key", "state", "stateType", "assignee", "priority", "due", "project", "team"],
  message: ["channel", "channelType", "sender", "threadId", "replyCount", "isReply"],
  meeting_note: ["start", "end", "durationMin", "attendees", "takeaways", "hasTranscript", "eventId"],
  deal: ["amount", "currency", "stage", "closeDate", "pipeline", "owner", "companyName"],
  note: ["parentKind", "parentTitle", "parentExternalId"],
  record: [],
};

// ---------- runtime records (CONTRACT 4.4) ----------

export interface RawRecord { item: unknown; detail?: unknown; children?: Record<string, unknown[]>; partition?: unknown; fetchedAt: string }
export interface NormalizeEnv { account: Record<string, unknown>; settings: Record<string, unknown>; now: Date; selfAddresses: string[] }

export interface RunProgress { runId: string; pages: number; fetched: number; hydrated: number; upserted: number; unchanged: number; tombstoned: number; skipped: number; calls: number; retries: number; itemCount?: number }
export interface RunOptions { trigger: RunTrigger; full?: boolean; maxPages?: number; signal?: AbortSignal; onProgress?: (p: RunProgress) => void }
export type RunTrigger = "schedule" | "manual" | "first" | "remap" | "reindex" | "resume";
export type RunOutcome = "ok" | "partial" | "failed" | "rate_limited" | "auth_needed" | "grant_blocked" | "cancelled" | "running";
export interface RunSummary {
  runId: string; sourceId: string; outcome: RunOutcome; fullPass: boolean;
  pages: number; fetched: number; hydrated: number; upserted: number; unchanged: number;
  tombstoned: number; skipped: number; calls: number; retries: number;
  startedAt: string; finishedAt: string; retryAt?: string; error?: SourceError;
}
export type SourceStatus = "new" | "syncing" | "healthy" | "degraded" | "rate_limited" | "auth_needed" | "grant_blocked" | "awaiting_grant" | "paused" | "error";
export interface SourceError { code: ErrorCode; message: string; at: string; actionId?: string; httpStatus?: number }
export interface SourceHealth { status: SourceStatus; lastSuccessAt: string | null; lastAttemptAt: string | null; nextRunAt: string | null; retryAt: string | null; consecutiveFailures: number; itemCount: number; added24h: number; updated24h: number; failed24h: number; lastError: SourceError | null; progress?: { done: number; estimate: number | null } }

export type ErrorCode =
  | "bad_request" | "invalid_fields" | "invalid_query" | "invalid_profile"
  | "unauthorized" | "token_expired" | "insufficient_scope" | "not_signed_in"
  | "forbidden" | "local_only" | "not_found" | "conflict" | "not_connected"
  | "blocked_by_grant" | "reconnect_required" | "rate_limited" | "plan_limit"
  | "upstream_error" | "model_unavailable" | "embedding_unavailable" | "keyword_only"
  | "sample_action_live" | "unresolved_action" | "internal";

// ---------- settings (CONTRACT 4.5) ----------

export interface SettingsData {
  embedding: { provider: "local" | "openai" | "gemini" | "cohere" | "mistral-ai"; model: string; dims: 1536 };
  rerank: boolean;
  /** Who writes (chat, answers, profile proposals): auto (Claude Code, else Codex, else One), a local CLI, or models through One. SEARCH_LOCAL_ENGINE wins; SEARCH_HOSTED=1 forces one. */
  engine: "auto" | "claude-code" | "codex" | "one";
  /** Anthropic models through One (and the fallback when the local CLI fails). */
  chatModel: string;
  proposalModel: string;
  /** Claude Code's --model, or "default". Codex always picks its own. */
  localChatModel: string;
  localProposalModel: string;
  jevModel: string;
  backfillDefault: "30d" | "365d" | "all";
  slackTier: "limited" | "marketplace";
  vipEntityIds: string[];
  lanesOn: boolean;
  paused: boolean;
}

// ---------- mapper (CONTRACT 4.6) ----------

export interface CatalogPlatform { platform: string; name: string; title?: string; description?: string; category?: string; image: string; tags: string[]; actionCount?: number; oauth?: boolean; active: boolean }
export interface CatalogAction { actionId: string; title: string; method: string; path: string; tags: string[]; listLike: boolean; readOnly: boolean; permitted: boolean; /** The model key it lists (models.ts). */ model?: string; /** Path values filled from the model, e.g. { objectType: "deals" }. */ pathVars?: Record<string, string> }
/** One thing a platform lists (Contacts, Deals), its best read actions first. */
export interface CatalogModel { key: string; label: string; kind: ItemKind; actions: CatalogAction[]; more: number; permitted: boolean; suggested: boolean; /** A built-in profile already indexes it. */ builtinProfile: string | null }
export interface ActionDoc { actionId: string; knowledge: string; ioSchema?: unknown; method: string; path: string; tags: string[] }

export interface CreateDraftInput { platform: string; connectionKey?: string; /** Model keys to map right away; otherwise the draft stops at the model list. */ models?: string[] }
export interface ProfileDraft {
  id: string; platform: string; step: DraftStep; status: "open" | "saved" | "discarded";
  connection: { key: string; label: string } | null;
  inGrant: boolean;
  /** Every model the platform lists, before any mapping. */
  models: CatalogModel[];
  /** Every account of this platform in the grant (two Gmails); Save makes a source for each one chosen. */
  accounts: { key: string; label: string }[];
  /** Read actions that list nothing on their own (single records, writes). */
  hiddenActions: number;
  /** The model keys the user picked and the AI mapped. */
  picked: string[];
  candidates: CatalogAction[];
  samples: Record<string, DryRunResult>;
  proposal: ProposalOutput | null;
  proposedBy: string;
  edits: DraftEdits;
  validation: ValidationReport | null;
}
export type DraftStep = "platform" | "models" | "fields" | "identity" | "review";
export interface DryRunResult { actionId: string; status: number; ok: boolean; count: number; estimate: number | null; sample: unknown[]; topLevelKeys: string[]; error?: string; /** No grant yet: the sample is the docs' example response, not a fetch. */ fromDocs?: boolean }
export interface DraftEdits { selected: string[]; profiles: Record<string, Partial<SearchProfile>> }
export interface DraftPreview { profileId: string; samples: { externalId: string; item: NormalizedItem; row: ResultRow }[] }
export interface SaveDraftInput { name?: string; profiles: string[]; /** Accounts to index; all of them when left out. */ connectionKeys?: string[] }
export interface SaveDraftResult { profileIds: string[]; sourceIds: string[]; firstRunIds: string[]; /** Saved before the platform was granted: indexing starts after the sign-in that grants it. */ awaitingGrant?: boolean }

export interface ProposalInput {
  platform: CatalogPlatform;
  candidates: { actionId: string; title: string; method: string; path: string; model?: string; pathVars?: Record<string, string>; knowledgeExcerpt: string; ioSchema?: unknown; sample: unknown; inference: InferenceHints }[];
  vocabulary: { kinds: ItemKind[]; fields: (keyof FieldMap)[]; facetsByKind: Record<ItemKind, string[]>; decoders: Decoder[]; filters: string[] };
  grammar: string;
  previousErrors?: ValidationIssue[];
}
export interface InferenceHints { resultsPath?: string; idPath?: string; pagination?: Pagination; titleCandidates: string[]; bodyCandidates: string[]; dateCandidates: string[]; emailCandidates: string[]; urlCandidates: string[]; incrementalParam?: string; kindGuess?: ItemKind }
export interface ProposalOutput {
  models: {
    recommended: boolean;
    reason: string;
    profile: SearchProfile;
    fieldNotes: { target: string; path: string; confidence: number; reason: string }[];
    questions: string[];
  }[];
  notes?: string;
}

export interface ValidationIssue { check: ValidationCheck; level: "ok" | "warn" | "error"; message: string; profileId?: string; sampleIds?: string[] }
export type ValidationCheck = "schema" | "actions" | "fetch" | "id" | "title" | "dates" | "link" | "pagination" | "incremental" | "size" | "hashes";
export interface ValidationReport { ok: boolean; issues: ValidationIssue[]; hashes?: Record<string, ProfileHashes> }
export interface ImportPreview { importId: string; pack: SearchProfilePack; report: ValidationReport; diff: { profileId: string; status: "new" | "same" | "changed"; changedSections: string[] }[] }

// ---------- one.call (CONTRACT 5) ----------

export type LedgerActor = "indexer" | "assistant" | "mapper" | "classifier" | "embedder" | "user" | "api" | "mcp";

export interface CallInput<Out, T> {
  platform: string;
  action: string;
  level: "read" | "write";
  actionId: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  pathParams?: Record<string, string>;
  query?: Record<string, string | string[]>;
  body?: unknown;
  headers?: Record<string, string>;
  summary: string;
  fixtureKey?: string;
  /** Fixture page matching: the pagination value sent (null on a first page) and the partition id. */
  cursor?: string | null;
  partition?: string | null;
  /** The delta token a delta run's first page sent (fixture matching). */
  delta?: string | null;
  pick?: (data: Out) => T;
}

export interface RawCallResult { status: number; ok: boolean; data: unknown; blockedByGrant: boolean; refusal: "grant" | "plan_limit" | "rate_limit" | "one_error" | null; retryAfterMs: number | null; ms: number; ledgerId: string | null }

export type GrantAccess = { policy: "full" } | { policy: "methods"; methods: string[] } | { policy: "actions"; actions: { actionId: string; title: string; method: string }[] | string[] };
export interface GrantedConnection { key: string; platform: string; name?: string; title?: string; image?: string; access: GrantAccess }

export interface FixtureRequest { actionId: string; method: string; path: string; /** The sample connection asking; pages with match.connection answer only it. */ connectionKey?: string | null; pathParams?: Record<string, string>; query?: Record<string, string | string[]>; body?: unknown; platform?: string; fixtureKey?: string; cursor?: string | null; partition?: string | null; delta?: string | null }
export interface FixtureAnswer { status: number; data: unknown; blockedByGrant?: boolean; refusal?: RawCallResult["refusal"] }
export interface FixtureTransport { answer(req: FixtureRequest): Promise<FixtureAnswer> }

export interface Capability {
  mode: "hybrid" | "keyword";
  reason?: "no_build_for_platform" | "extension_unavailable" | "cannot_create_extension" | "flags_missing" | "forced" | "embedding_not_granted";
  pgvector?: string;
  where: "embedded" | "external";
  vectorSchema?: string;
}

export type { ParsedQuery, QueryClause, OperatorKey, OpValue, ChipEdit } from "./api-types.js";
