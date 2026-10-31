// Drizzle tables (SPEC section 4) except the vector tables, which live in
// schema-vector.ts and are applied by ensureVectorSchema only when pgvector works.
// No foreign keys: the demo runs the same migrations inside a scratch schema,
// and drizzle-kit qualifies references with "public". Cascades are done in code.

import { sql } from "drizzle-orm";
import {
  boolean, customType, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, unique, uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  ItemFacets, ItemKind, Lane, LedgerActor, ProposalOutput, RunOutcome, RunTrigger, SearchProfile,
  SettingsData, SourceError, SourceStatus, ValidationReport, DraftEdits, DraftStep,
} from "../contract.js";
import type { ChatContext, Citation, ChatStep, QueryProposal } from "../api-types.js";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
const ts = (name: string) => timestamp(name, { withTimezone: true });

// ---------- identity and settings ----------

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email"),
  oneUserId: text("one_user_id"),
  avatarUrl: text("avatar_url"),
  isSample: boolean("is_sample").default(false).notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  sid: text("sid").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
  lastSeenAt: ts("last_seen_at").defaultNow().notNull(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const connectUsers = pgTable("connect_users", {
  userId: text("user_id").primaryKey(),
  reference: text("reference").notNull(),
  connectUserId: text("connect_user_id"),
  updatedAt: ts("updated_at").defaultNow().notNull(),
}, (t) => [index("connect_users_cu_idx").on(t.connectUserId)]);

export const settings = pgTable("settings", {
  userId: text("user_id").primaryKey(),
  data: jsonb("data").$type<SettingsData>().notNull(),
  updatedAt: ts("updated_at").defaultNow().notNull(),
});

export const savedSearches = pgTable("saved_searches", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  query: text("query").notNull(),
  position: integer("position").default(0).notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
}, (t) => [index("saved_searches_user_idx").on(t.userId)]);

/** Jev rerank scores, asked once (SPEC 9.2): per user, normalized query and item, valid while the item's hash matches. */
export const rerankScores = pgTable("rerank_scores", {
  userId: text("user_id").notNull(),
  query: text("query").notNull(),
  itemId: text("item_id").notNull(),
  contentHash: text("content_hash").notNull(),
  score: integer("score").notNull(),
  at: ts("at").defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.query, t.itemId] }), index("rerank_scores_item_idx").on(t.itemId)]);

export const recentSearches = pgTable("recent_searches", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  query: text("query").notNull(),
  resultCount: integer("result_count").default(0).notNull(),
  at: ts("at").defaultNow().notNull(),
}, (t) => [index("recent_searches_user_idx").on(t.userId, t.at)]);

export const selfAddresses = pgTable("self_addresses", {
  userId: text("user_id").notNull(),
  kind: text("kind").$type<"email" | "domain" | "ext">().notNull(),
  value: text("value").notNull(),
  sourceId: text("source_id"),
}, (t) => [primaryKey({ columns: [t.userId, t.kind, t.value] })]);

// ---------- profiles ----------

export const profiles = pgTable("profiles", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  slug: text("slug").notNull(),
  platform: text("platform").notNull(),
  model: text("model").notNull(),
  origin: text("origin").$type<"builtin" | "user" | "import" | "url">().notNull(),
  originUrl: text("origin_url"),
  currentVersionId: text("current_version_id"),
  createdAt: ts("created_at").defaultNow().notNull(),
  updatedAt: ts("updated_at").defaultNow().notNull(),
}, (t) => [unique("profiles_user_slug_uq").on(t.userId, t.slug).nullsNotDistinct()]);

export const profileVersions = pgTable("profile_versions", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull(),
  version: integer("version").notNull(),
  json: jsonb("json").$type<SearchProfile>().notNull(),
  fetchHash: text("fetch_hash").notNull(),
  mapHash: text("map_hash").notNull(),
  indexHash: text("index_hash").notNull(),
  profileHash: text("profile_hash").notNull(),
  createdBy: text("created_by").notNull(),
  note: text("note"),
  createdAt: ts("created_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("profile_versions_uq").on(t.profileId, t.version)]);

export const profileDrafts = pgTable("profile_drafts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  platform: text("platform").notNull(),
  step: text("step").$type<DraftStep>().default("platform").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().default({}).notNull(),
  proposal: jsonb("proposal").$type<ProposalOutput>(),
  edits: jsonb("edits").$type<DraftEdits>().default({ selected: [], profiles: {} }).notNull(),
  validation: jsonb("validation").$type<ValidationReport>(),
  model: text("model"),
  status: text("status").$type<"open" | "saved" | "discarded">().default("open").notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
  updatedAt: ts("updated_at").defaultNow().notNull(),
});

// ---------- sources, cursors, runs ----------

export const sources = pgTable("sources", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  platform: text("platform").notNull(),
  connectionKey: text("connection_key").notNull(),
  connectionLabel: text("connection_label").notNull(),
  profileId: text("profile_id").notNull(),
  profileVersionId: text("profile_version_id").notNull(),
  fetchHash: text("fetch_hash"),
  mapHash: text("map_hash"),
  indexHash: text("index_hash"),
  mode: text("mode").$type<"fixture" | "connect">().notNull(),
  status: text("status").$type<SourceStatus>().default("new").notNull(),
  accountVars: jsonb("account_vars").$type<Record<string, unknown>>(),
  accountVarsAt: ts("account_vars_at"),
  settings: jsonb("settings").$type<Record<string, unknown>>().default({}).notNull(),
  scheduleEvery: integer("schedule_every").notNull(),
  nextRunAt: ts("next_run_at"),
  lastAttemptAt: ts("last_attempt_at"),
  lastSuccessAt: ts("last_success_at"),
  lastFullPassAt: ts("last_full_pass_at"),
  consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
  retryAt: ts("retry_at"),
  lastError: jsonb("last_error").$type<SourceError>(),
  itemCount: integer("item_count").default(0).notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("sources_uq").on(t.userId, t.connectionKey, t.profileId),
  index("sources_due_idx").on(t.nextRunAt),
]);

export const sourceCursors = pgTable("source_cursors", {
  sourceId: text("source_id").notNull(),
  partitionKey: text("partition_key").default("").notNull(),
  watermark: text("watermark"),
  deltaToken: text("delta_token"),
  pageCursor: jsonb("page_cursor").$type<Record<string, unknown> | null>(),
  pendingWatermark: text("pending_watermark"),
  lastFullPassAt: ts("last_full_pass_at"),
  updatedAt: ts("updated_at").defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.sourceId, t.partitionKey] })]);

export const runs = pgTable("runs", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  trigger: text("trigger").$type<RunTrigger>().notNull(),
  fullPass: boolean("full_pass").default(false).notNull(),
  startedAt: ts("started_at").defaultNow().notNull(),
  finishedAt: ts("finished_at"),
  outcome: text("outcome").$type<RunOutcome>().default("running").notNull(),
  pages: integer("pages").default(0).notNull(),
  fetched: integer("fetched").default(0).notNull(),
  hydrated: integer("hydrated").default(0).notNull(),
  upserted: integer("upserted").default(0).notNull(),
  unchanged: integer("unchanged").default(0).notNull(),
  tombstoned: integer("tombstoned").default(0).notNull(),
  skipped: integer("skipped").default(0).notNull(),
  calls: integer("calls").default(0).notNull(),
  retries: integer("retries").default(0).notNull(),
  httpStatus: integer("http_status"),
  retryAfterAt: ts("retry_after_at"),
  error: jsonb("error").$type<SourceError>(),
}, (t) => [index("runs_source_idx").on(t.sourceId, t.startedAt)]);

export const itemErrors = pgTable("item_errors", {
  sourceId: text("source_id").notNull(),
  externalId: text("external_id").notNull(),
  stage: text("stage").$type<"hydrate" | "normalize" | "embed" | "classify">().notNull(),
  code: text("code").notNull(),
  message: text("message").notNull(),
  attempts: integer("attempts").default(1).notNull(),
  lastAt: ts("last_at").defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.sourceId, t.externalId, t.stage] })]);

// ---------- raw and normalized items ----------

export const rawItems = pgTable("raw_items", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  externalId: text("external_id").notNull(),
  partitionKey: text("partition_key").default("").notNull(),
  item: jsonb("item").notNull(),
  detail: jsonb("detail"),
  children: jsonb("children").$type<Record<string, unknown[]>>(),
  partition: jsonb("partition"),
  fingerprint: text("fingerprint"),
  fetchHash: text("fetch_hash").notNull(),
  fetchedAt: ts("fetched_at").defaultNow().notNull(),
  deletedAt: ts("deleted_at"),
}, (t) => [uniqueIndex("raw_items_uq").on(t.sourceId, t.externalId)]);

export const items = pgTable("items", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sourceId: text("source_id").notNull(),
  rawItemId: text("raw_item_id").notNull(),
  externalId: text("external_id").notNull(),
  platform: text("platform").notNull(),
  kind: text("kind").$type<ItemKind>().notNull(),
  title: text("title").notNull(),
  body: text("body").default("").notNull(),
  snippet: text("snippet"),
  url: text("url"),
  container: text("container"),
  groupKey: text("group_key"),
  status: text("status"),
  labels: text("labels").array().default(sql`'{}'::text[]`).notNull(),
  facets: jsonb("facets").$type<ItemFacets>().notNull(),
  occurredAt: ts("occurred_at").notNull(),
  updatedAt: ts("updated_at"),
  deletedAt: ts("deleted_at"),
  mapHash: text("map_hash").notNull(),
  bodyHash: text("body_hash").notNull(),
  contentHash: text("content_hash"),
  importance: real("importance"),
  lane: text("lane").$type<Lane>(),
  directory: boolean("directory").default(false).notNull(),
  indexedAt: ts("indexed_at").defaultNow().notNull(),
  tsv: tsvector("tsv").generatedAlwaysAs(sql`setweight(to_tsvector('english', search_unaccent(coalesce(title, ''))), 'A') || setweight(to_tsvector('english', coalesce(container, '') || ' ' || coalesce(search_labels_text(labels), '')), 'C') || setweight(to_tsvector('english', left(coalesce(body, ''), 100000)), 'B')`),
}, (t) => [
  uniqueIndex("items_uq").on(t.sourceId, t.externalId),
  index("items_tsv_idx").using("gin", t.tsv),
  index("items_user_kind_idx").on(t.userId, t.kind, t.occurredAt.desc()),
  index("items_user_platform_idx").on(t.userId, t.platform),
  index("items_labels_idx").using("gin", t.labels),
  index("items_facets_idx").using("gin", sql`${t.facets} jsonb_path_ops`),
]);

export const chunks = pgTable("chunks", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull(),
  userId: text("user_id").notNull(),
  ord: integer("ord").notNull(),
  text: text("text").notNull(),
  textHash: text("text_hash").notNull(),
  tokens: integer("tokens").notNull(),
  tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('english', text)`),
}, (t) => [
  uniqueIndex("chunks_uq").on(t.itemId, t.ord),
  index("chunks_tsv_idx").using("gin", t.tsv),
  index("chunks_hash_idx").on(t.textHash),
]);

// ---------- entities ----------

export const entities = pgTable("entities", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").$type<"person" | "company">().notNull(),
  name: text("name").notNull(),
  primaryEmail: text("primary_email"),
  domain: text("domain"),
  title: text("title"),
  companyId: text("company_id"),
  avatarUrl: text("avatar_url"),
  isSelf: boolean("is_self").default(false).notNull(),
  mergedIntoId: text("merged_into_id"),
  attributes: jsonb("attributes").$type<Record<string, unknown>>().default({}).notNull(),
  itemCount: integer("item_count").default(0).notNull(),
  firstSeenAt: ts("first_seen_at").defaultNow().notNull(),
  lastSeenAt: ts("last_seen_at").defaultNow().notNull(),
  tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('simple', search_unaccent(coalesce(name, '') || ' ' || coalesce(primary_email, '') || ' ' || coalesce(domain, '')))`),
}, (t) => [
  index("entities_user_idx").on(t.userId, t.type),
  index("entities_tsv_idx").using("gin", t.tsv),
]);

export const entityKeys = pgTable("entity_keys", {
  entityId: text("entity_id").notNull(),
  userId: text("user_id").notNull(),
  key: text("key").notNull(),
  sourceId: text("source_id"),
  createdAt: ts("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("entity_keys_uq").on(t.userId, t.key).where(sql`${t.key} not like 'name:%'`),
  index("entity_keys_entity_idx").on(t.entityId),
  index("entity_keys_key_idx").on(t.userId, t.key),
]);

export const entityLinks = pgTable("entity_links", {
  itemId: text("item_id").notNull(),
  entityId: text("entity_id").notNull(),
  role: text("role").notNull(),
  sourceId: text("source_id").notNull(),
}, (t) => [
  primaryKey({ columns: [t.itemId, t.entityId, t.role] }),
  index("entity_links_entity_idx").on(t.entityId),
]);

export const entityMatches = pgTable("entity_matches", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  aId: text("a_id").notNull(),
  bId: text("b_id").notNull(),
  reason: text("reason").$type<"name_same_company" | "name_only" | "ext_id_name">().notNull(),
  probability: real("probability"),
  status: text("status").$type<"pending" | "merged" | "rejected">().default("pending").notNull(),
  decidedBy: text("decided_by").$type<"jev" | "user" | "fixture">(),
  createdAt: ts("created_at").defaultNow().notNull(),
  decidedAt: ts("decided_at"),
}, (t) => [uniqueIndex("entity_matches_uq").on(t.userId, t.aId, t.bId)]);

// ---------- classifications ----------

export const classifications = pgTable("classifications", {
  itemId: text("item_id").notNull(),
  userId: text("user_id").notNull(),
  questionSet: text("question_set").notNull(),
  bodyHash: text("body_hash").notNull(),
  model: text("model").notNull(),
  answers: jsonb("answers").$type<Record<string, unknown>>().notNull(),
  kindGuess: text("kind_guess"),
  importance: real("importance"),
  lane: text("lane").$type<Lane>(),
  needsYou: real("needs_you"),
  judgedAt: ts("judged_at").defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.itemId, t.questionSet] })]);

// Plain queue table: works before the vector capability flips on.
export const pendingEmbeddings = pgTable("pending_embeddings", {
  chunkId: text("chunk_id").primaryKey(),
  userId: text("user_id").notNull(),
  model: text("model").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  nextAt: ts("next_at").defaultNow().notNull(),
}, (t) => [index("pending_embeddings_next_idx").on(t.userId, t.nextAt)]);

// ---------- chat ----------

export const chats = pgTable("chats", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
  updatedAt: ts("updated_at").defaultNow().notNull(),
}, (t) => [index("chats_user_idx").on(t.userId, t.updatedAt)]);

export const chatMessages = pgTable("chat_messages", {
  id: text("id").primaryKey(),
  chatId: text("chat_id").notNull(),
  role: text("role").$type<"user" | "assistant">().notNull(),
  content: text("content").notNull(),
  context: jsonb("context").$type<ChatContext>(),
  citations: jsonb("citations").$type<Citation[]>().default([]).notNull(),
  steps: jsonb("steps").$type<ChatStep[]>().default([]).notNull(),
  proposal: jsonb("proposal").$type<QueryProposal>(),
  followups: text("followups").array().default(sql`'{}'::text[]`).notNull(),
  model: text("model"),
  grounded: boolean("grounded").default(true).notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
}, (t) => [index("chat_messages_chat_idx").on(t.chatId, t.createdAt)]);

// ---------- OAuth authorization server ----------

export const oauthClients = pgTable("oauth_clients", {
  clientId: text("client_id").primaryKey(),
  clientSecretHash: text("client_secret_hash"),
  clientName: text("client_name").notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method").notNull(),
  grantTypes: jsonb("grant_types").$type<string[]>().notNull(),
  scope: text("scope"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
  lastUsedAt: ts("last_used_at"),
});

export const oauthPending = pgTable("oauth_pending", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  state: text("state"),
  codeChallenge: text("code_challenge").notNull(),
  codeChallengeMethod: text("code_challenge_method").default("S256").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull(),
  resource: text("resource"),
  createdAt: ts("created_at").defaultNow().notNull(),
  expiresAt: ts("expires_at").notNull(),
});

export const oauthCodes = pgTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id").notNull(),
  userId: text("user_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull(),
  resource: text("resource"),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

export const oauthTokens = pgTable("oauth_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  kind: text("kind").$type<"access" | "refresh">().notNull(),
  clientId: text("client_id").notNull(),
  userId: text("user_id").notNull(),
  familyId: text("family_id").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull(),
  resource: text("resource"),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  replacedBy: text("replaced_by"),
  createdAt: ts("created_at").defaultNow().notNull(),
  lastUsedAt: ts("last_used_at"),
}, (t) => [index("oauth_tokens_user_idx").on(t.userId), index("oauth_tokens_family_idx").on(t.familyId)]);

// ---------- ledger and catalog cache ----------

export const ledger = pgTable("ledger", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sourceId: text("source_id"),
  actor: text("actor").$type<LedgerActor>().notNull(),
  clientId: text("client_id"),
  platform: text("platform").notNull(),
  action: text("action").notNull(),
  actionId: text("action_id").notNull(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  mode: text("mode").$type<"fixture" | "connect">().notNull(),
  level: text("level").$type<"read" | "write">().notNull(),
  status: integer("status").notNull(),
  ok: boolean("ok").notNull(),
  blockedByGrant: boolean("blocked_by_grant").default(false).notNull(),
  refusal: text("refusal"),
  ms: integer("ms").default(0).notNull(),
  summary: text("summary").notNull(),
  note: text("note"),
  at: ts("at").defaultNow().notNull(),
}, (t) => [index("ledger_user_idx").on(t.userId, t.at), index("ledger_source_idx").on(t.sourceId)]);

export const catalogCache = pgTable("catalog_cache", {
  key: text("key").primaryKey(),
  data: jsonb("data").notNull(),
  etag: text("etag"),
  fetchedAt: ts("fetched_at").defaultNow().notNull(),
});

export const schema = {
  users, sessions, connectUsers, settings, savedSearches, recentSearches, selfAddresses,
  profiles, profileVersions, profileDrafts, sources, sourceCursors, runs, itemErrors,
  rawItems, items, chunks, entities, entityKeys, entityLinks, entityMatches, classifications,
  pendingEmbeddings, chats, chatMessages, oauthClients, oauthPending, oauthCodes, oauthTokens,
  ledger, catalogCache,
};
