# Search build contract

Read this before touching any package. It is the glue between `packages/core`,
`server`, `ui` and `cli`, which are built in parallel by separate agents.
`docs/SPEC.md` says what and why; this file says the exact shapes. Change this
file first, then both sides. The TypeScript in this file is copied verbatim
into `packages/core/src/contract.ts` (domain and engine types) and
`packages/core/src/api-types.ts` (HTTP types, browser-safe); those two files
are the compiled form of this contract.

`$RILL` means the Rill repo in this workspace (the sibling directory that
still carries Rill's pre-rename name).

## 1. Shape

pnpm workspace, Node 22.12+, ESM, TypeScript 5.9 strict, `module`/`moduleResolution`
NodeNext, `.js` suffixes on imports, tsx in dev. No build step for core and
server (`"exports": { ".": "./src/index.ts", "./*": "./src/*.ts" }`).

```
package.json                 name "search", packageManager pnpm@10, scripts below
pnpm-workspace.yaml          packages: [packages/*, server, ui, cli]; onlyBuiltDependencies: @embedded-postgres/*, esbuild
packages/core/src/
  contract.ts                domain + engine types (this file, sections 3 to 5)
  api-types.ts               HTTP types (section 6), browser-safe, imported by ui
  keymap.ts                  keyboard table (browser-safe; ui renders the ? sheet and palette from it)
  query/parse.ts             parseQuery, formatQuery, applyChip (browser-safe)
  query/dates.ts             relative date resolution (browser-safe)
  ids.ts                     newId(prefix)
  db/schema.ts               Drizzle tables (SPEC section 4) except vector
  db/schema-vector.ts        chunk_embeddings, embedding_cache (applied by ensureVectorSchema)
  db/client.ts               createDb, runMigrations, ensureDatabase, ensureVectorSchema, capability
  db/migrations/             drizzle-kit output
  one.ts                     one.call / one.attempt / grantedConnections / forgetGrant
  ledger.ts                  record, list, rollup
  profile/schema.ts          zod SearchProfile, SearchProfilePack; toJsonSchema()
  profile/hash.ts            canonical JSON (RFC 8785), fetchHash, mapHash, indexHash
  profile/builtins.ts        load profiles/*/pack.json, upsert into profiles/profile_versions
  profile/validate.ts        validateProfile (static) and validateDraft (with dry runs)
  expr/path.ts               resolvePath (CLI grammar + [-1])
  expr/template.ts           renderTemplate, filters
  expr/predicate.ts          parsePredicate, evalPredicate
  expr/field.ts              evalExpr (Expr union)
  decode/*.ts                text, html, markdown, mail-strip, graph-body, notion-blocks, notion-title, slack-mrkdwn, prosemirror, email, domain, datetime, address
  engine/run.ts              runSource(ctx, sourceId, opts) -> RunSummary
  engine/fetch.ts            retry policy, token buckets
  engine/paginate.ts         next-page params per Pagination
  engine/incremental.ts      since, cursors, commit
  engine/normalize.ts        normalize(profile, raw, account, settings) -> NormalizedItem
  engine/chunk.ts            chunk(item, profile, raw) -> ChunkDraft[]
  engine/tombstone.ts
  engine/remap.ts            re-normalize from raw_items on map_hash change
  entities/resolve.ts        resolveRefs, upsertEntities, linkEntities
  entities/match.ts          candidate pairs, Jev match, merge, unmerge
  embed/index.ts             Embedder interface, pickEmbedder, embedPending worker
  embed/local-hash.ts        local:hash-v1
  embed/providers.ts         openai, gemini, cohere, mistral request builders + pick
  search/hybrid.ts           hybridSearch, countOnly
  search/rerank.ts           jevRerank
  search/highlight.ts
  classify/jev.ts            item-v1 question set, parse, lanes, rules fallback
  chat/run.ts                runChatTurn (async generator of ChatEvent)
  chat/prompts.ts
  mapper/catalog.ts          platforms (public), actions + knowledge (grant), cache
  mapper/infer.ts            deterministic inference (SPEC 10.4)
  mapper/propose.ts          LLM proposal + repair rounds
  mapper/prompt.ts           the system prompt and ProposalInput builder
  sample/world.ts            load fixtures/sample, relative dates, fixture transport
  sample/demo.ts             runDemo(deps) used by cli demo
  index.ts                   re-exports (section 3)
packages/pgvector/
  package.json               @search/pgvector, no install scripts
  prebuilt/darwin-universal/{lib/vector.dylib, share/extension/vector.control, share/extension/vector--*.sql}
  prebuilt/linux-x64/..., prebuilt/linux-arm64/...   (from scripts/fetch-pgdg.mjs)
  SHA256SUMS
  scripts/build-darwin.sh    PG 18.4 headers-only prefix + pgvector 0.8.7, universal, minos 13.0, bundle_loader
  scripts/fetch-pgdg.mjs     download PGDG postgresql-18-pgvector 0.8.7 .debs, verify sha256, extract (ar + xz)
  src/index.ts               resolvePgvector(home, log): string | null
server/src/
  node.ts  config.ts  boot.ts  app.ts  deps.ts  session.ts  errors.ts
  connect.ts  connect-store.ts  connect-create.ts
  oauth/provider.ts  oauth/routes.ts  oauth/bearer.ts  oauth/consent.ts
  mcp.ts                     /mcp route, tools
  scheduler.ts  workers.ts  events.ts
  routes/{search,items,entities,chat,sources,profiles,drafts,catalog,settings,saved,access,setup,oauth-clients,me}.ts
  demo.ts                    ensureDemoUser, demo schema helpers
  scripts/smoke-api.ts  smoke-oauth.ts  smoke-whoami.ts
ui/src/                      section 9
cli/src/index.ts, cli/bin/search.mjs
profiles/<platform>/pack.json, profiles/schema/profile-1.json
fixtures/sample/...          SPEC section 11
```

Root scripts:

```json
{
  "dev": "concurrently -n server,ui --kill-others-on-fail 'SEARCH_UI_URL=http://localhost:5680 pnpm --filter @search/server dev' 'wait-on -t 60000 http-get://127.0.0.1:52289/api/health && pnpm --filter @search/ui dev'",
  "dev:server": "pnpm --filter @search/server dev",
  "dev:ui": "pnpm --filter @search/ui dev",
  "start": "pnpm --filter @withone/search demo",
  "typecheck": "pnpm -r typecheck && tsc -p tsconfig.json",
  "test": "pnpm -r test",
  "build": "pnpm -r build",
  "db:generate": "pnpm --filter @search/core generate",
  "connect": "node scripts/connect.mjs",
  "welcome": "node forkable/welcome.mjs"
}
```

Dependencies (pin these ranges): `@withone/connect ^0.19.0`, `hono ^4.13`,
`@hono/node-server ^2.1`, `@hono/mcp ^0.3.5`, `@modelcontextprotocol/sdk ^1.32`,
`drizzle-orm ^0.45.4`, `drizzle-kit ^0.31.11`, `pg ^8.16`,
`embedded-postgres 18.4.0-beta.17` (exact), `zod ^4`, `react ^19.1`,
`react-router-dom ^7.6`, `@tanstack/react-query ^5.80`, `vite ^6.3`,
`tailwindcss ^4.1`, `lucide-react`, `tsx ^4.20`. Remember this machine sets
`NODE_ENV=production` and npm `omit=dev`; install with `--include=dev` where npm is used.

## 2. Ports, env, identity

| Thing | Value |
|---|---|
| UI (Vite dev) | 5680, `host: true`, proxies `/api`, `/mcp`, `/oauth`, `/.well-known`, `/authorize`, `/token`, `/register`, `/revoke` to `VITE_API_TARGET ?? http://127.0.0.1:52289` |
| Server | 52289 on 127.0.0.1, pinned. Refuses to start when busy (exit 1, "port 52289 is in use"). |
| Connect redirect | `http://localhost:52289/api/one/callback` |
| Embedded Postgres | 55441 (first free at or after) |
| Landing site | 5690 |
| Data dir | `~/.search` (`db/`, `pg-ext/`, `connect.env`, `connect.json`, `cli-token.json`, `logs/`) |
| Session cookie | `search_sid` |
| OAuth pending cookie | `search_oauth_pending` |
| Keychain service | `search.connect` |

Env (read once by `server/src/config.ts` from the repo-root `.env` then
process env; never a secret value in `.env` except what `pnpm connect`
writes, which is ids only):

| Var | Default | Meaning |
|---|---|---|
| `SEARCH_HOME` | `~/.search` | data dir |
| `SEARCH_PORT` | `52289` | server port (changing it changes the redirect; the Connect app must match) |
| `SEARCH_PG_PORT` | `55441` | embedded Postgres port |
| `SEARCH_DATABASE_URL` | unset | external Postgres; unset means embedded |
| `SEARCH_PUBLIC_URL` | `http://localhost:<SEARCH_PORT>` | OAuth issuer and resource base |
| `SEARCH_UI_URL` | unset | dev only: non-API paths redirect here |
| `SEARCH_SECRETS` | auto | `keychain` or `file` |
| `SEARCH_ENV_DIR` | repo root | where `.env`/`.env.local` with the Connect ids live; when set, shell `ONE_*` values are ignored (the smokes point it at a tmp dir so they never read the developer's `.env`) |
| `SEARCH_FORCE_KEYWORD` | unset | `1` skips pgvector (tests the fallback) |
| `SEARCH_SYNC_CONCURRENCY` | `4` | concurrent source runs |
| `SEARCH_ONE_RPM` | `300` | per-user cap on One calls a minute |
| `SEARCH_JEV_MODEL` | `jev-latest` | |
| `SEARCH_AUTO_UPDATE_BUILTINS` | unset | `1` moves sources to new built-in versions automatically |
| `SEARCH_LOG` | `info` | `debug` logs call summaries (never bodies, never keys) |
| `FORKABLE_CREATE` | unset | set by create-forkable; demo skips "Next:" |
| `ONE_CLIENT_ID`, `ONE_PERMISSION_SET`, `ONE_REDIRECT_URI` | from `pnpm connect` | Connect app ids |
| `ONE_CLIENT_SECRET`, `ONE_CONNECT_KEY` | never in `.env` | only in the setup store (Keychain or `connect.env`) |

There is no `ONE_SECRET` and no connection key variable anywhere. Code that
reads one is a bug.

## 3. Core exports (`@search/core`)

```ts
// db
export function createDb(url: string, max?: number): Db;
export function runMigrations(db: Db): Promise<void>;
export function ensureDatabase(adminUrl: string, name: string): Promise<void>;
export function detectCapability(db: Db, opts: { embedded: boolean; extDir: string | null; force?: "keyword" }): Promise<Capability>;
export function ensureVectorSchema(db: Db, cap: Capability): Promise<void>;

// identity helpers
export function newId(prefix: IdPrefix): string;

// one
export const one: {
  call<Out, T = Out>(ctx: CallCtx, input: CallInput<Out, T>): Promise<T>;
  attempt(ctx: CallCtx, input: CallInput<unknown, unknown>): Promise<LedgerRow>;
  raw(ctx: CallCtx, input: CallInput<unknown, unknown>): Promise<RawCallResult>;   // engine use: never throws on HTTP status
  grantedConnections(oneConnect: OneConnectKeyClient, userId: string): Promise<GrantedConnection[]>;
  forgetGrant(userId: string): void;
};

// profiles
export const profileSchema: z.ZodType<SearchProfile>;
export const packSchema: z.ZodType<SearchProfilePack>;
export function profileJsonSchema(): object;            // writes profiles/schema/profile-1.json
export function hashProfile(p: SearchProfile, versions?: EngineVersions): ProfileHashes;
export function loadBuiltinPacks(root: string): SearchProfilePack[];
export function upsertBuiltins(db: Db, packs: SearchProfilePack[]): Promise<{ created: number; updated: number }>;
export function validateProfile(p: unknown): ValidationReport;                     // static only
export function exportPack(db: Db, userId: string, profileId: string): Promise<SearchProfilePack>;
export function importPack(db: Db, userId: string, pack: unknown): Promise<ImportPreview>;

// expressions (pure, browser-safe subset re-exported from ./expr/*)
export function resolvePath(root: unknown, path: string): unknown[];
export function renderTemplate(tpl: string, ctx: TemplateCtx): string | null;
export function evalExpr(expr: Expr, ctx: TemplateCtx): unknown;
export function evalPredicate(src: string, ctx: TemplateCtx): boolean;

// engine
export function runSource(ctx: EngineCtx, sourceId: string, opts?: RunOptions): Promise<RunSummary>;
export function normalize(profile: SearchProfile, raw: RawRecord, env: NormalizeEnv): NormalizedItem;
export function remapSource(ctx: EngineCtx, sourceId: string): Promise<{ remapped: number }>;
export function ensureSources(ctx: EngineCtx, userId: string): Promise<SourceRow[]>;   // one per indexable connection x enabled profile
export function sourceHealth(db: Db, sourceId: string): Promise<SourceHealth>;

// entities
export function runEntityMatch(ctx: EngineCtx, userId: string): Promise<{ merged: number; pending: number }>;
export function mergeEntities(db: Db, userId: string, keepId: string, mergeId: string, by: "jev" | "user" | "fixture"): Promise<void>;
export function unmergeEntity(db: Db, userId: string, entityId: string): Promise<void>;

// embeddings
export function pickEmbedder(settings: SettingsData, mode: "fixture" | "connect"): EmbedderSpec;
export function embedPending(ctx: EngineCtx, userId: string, limit?: number): Promise<{ embedded: number; cached: number; failed: number }>;
export function embedQuery(ctx: EngineCtx, userId: string, text: string): Promise<number[] | null>;

// classification
export function classifyPending(ctx: EngineCtx, userId: string, limit?: number): Promise<{ judged: number; failed: number }>;
export function laneFor(answers: JevItemAnswers, item: ItemRow, vips: Set<string>): Lane;

// search
export function parseQuery(text: string): ParsedQuery;                 // browser-safe
export function formatQuery(q: ParsedQuery): string;                    // browser-safe
export function applyChip(text: string, chip: ChipEdit): string;        // browser-safe
export function hybridSearch(ctx: EngineCtx, userId: string, req: SearchRequest): Promise<SearchResponse>;
export function countOnly(ctx: EngineCtx, userId: string, query: string): Promise<number>;
export function jevRerank(ctx: EngineCtx, userId: string, req: RerankRequest): Promise<RerankResponse>;
export function suggest(ctx: EngineCtx, userId: string, prefix: string): Promise<SuggestResponse>;

// chat
export function runChatTurn(ctx: EngineCtx, userId: string, input: ChatTurnInput): AsyncGenerator<ChatEvent>;
export function answerOnce(ctx: EngineCtx, userId: string, input: AnswerRequest): Promise<AnswerResponse>;

// mapper (New profile)
export function listPlatforms(ctx: EngineCtx, q?: string): Promise<CatalogPlatform[]>;      // public endpoint, cached
export function createDraft(ctx: EngineCtx, userId: string, input: CreateDraftInput): Promise<ProfileDraft>;
export function dryRun(ctx: EngineCtx, userId: string, draftId: string, actionId: string): Promise<DryRunResult>;
export function previewDraft(ctx: EngineCtx, userId: string, draftId: string, model: string): Promise<DraftPreview>;
export function validateDraft(ctx: EngineCtx, userId: string, draftId: string): Promise<ValidationReport>;
export function saveDraft(ctx: EngineCtx, userId: string, draftId: string, input: SaveDraftInput): Promise<SaveDraftResult>;

// ledger
export function listLedger(db: Db, userId: string, q: LedgerQuery): Promise<LedgerRow[]>;

// sample
export function loadSampleWorld(root: string, now?: Date): SampleWorld;
export function fixtureTransport(world: SampleWorld): FixtureTransport;
export function runDemo(deps: DemoDeps, out: (line: string) => void): Promise<DemoResult>;
```

Context objects:

```ts
export interface EngineCtx {
  db: Db;
  oneConnect: OneConnectKeyClient | null;     // null in sample-only processes
  capability: Capability;
  settingsFor(userId: string): Promise<SettingsData>;
  transport: FixtureTransport | null;          // sample world, loaded once
  emit(userId: string, ev: ServerEvent): void; // server's SSE hub; no-op in demo
  log(line: string): void;
  now(): Date;
}
export interface CallCtx {
  db: Db;
  userId: string;
  sourceId?: string;
  actor: LedgerActor;
  clientId?: string;
  mode: "fixture" | "connect";
  oneConnect: OneConnectKeyClient | null;
  transport: FixtureTransport | null;
  connectionKey?: string;                      // the source's; AI platforms resolve from the grant
  rollup?: LedgerRollup;                       // indexer: one row per action per run
}
export interface Capability {
  mode: "hybrid" | "keyword";
  reason?: "no_build_for_platform" | "extension_unavailable" | "cannot_create_extension" | "flags_missing" | "forced" | "embedding_not_granted";
  pgvector?: string;                           // "0.8.7"
  where: "embedded" | "external";
  vectorSchema?: string;                       // "public" | "extensions"
}
```

## 4. Profile types and JSON schema

### 4.1 `SearchProfile`

```ts
export type Path = string;      // a.b | a.0 | a[0] | a[-1] | a[] | a[name=From]
export type Template = string;  // "{{ expr | filter:arg }}" or a literal

export type Expr =
  | Path
  | { path: Path; pick?: "first" | "last" | "all" | "join" | "count"; sep?: string; decode?: Decoder }
  | { template: Template }
  | { coalesce: Expr[] }
  | { join: Expr[]; sep?: string }          // drops empty parts
  | { test: string };                        // predicate -> boolean

export type Decoder =
  | "text" | "html" | "markdown" | "mail-strip" | "graph-body" | "mime-body"
  | "notion-blocks" | "notion-title" | "slack-mrkdwn" | "prosemirror"
  | "email" | "domain" | "datetime" | "address";   // address -> { name, email }[]

export interface RequestSpec {
  actionId: string;                          // conn_mod_def::..., sample::... (fixture only), TBD:... (refused at runtime)
  pathVars?: Record<string, Template>;
  query?: Record<string, Template | Template[]>;
  body?: unknown;                            // JSON; any string inside is a Template
  headers?: Record<string, Template>;
}

export type PassAs = `${"query" | "body" | "header"}:${string}`;
export type Pagination =
  | { type: "none" }
  | { type: "cursor"; next: Path; passAs: PassAs; hasMore?: Path; hasMoreInverted?: boolean }
  | { type: "offset"; passAs: PassAs; total?: Path; start?: 0 | 1; nextPath?: Path; hasMore?: Path }
  | { type: "page"; passAs: PassAs; start?: 0 | 1; totalPages?: Path }
  | { type: "lastId"; idPath: Path; passAs: PassAs; hasMore?: Path }
  | { type: "relay"; endCursor: Path; hasNextPage: Path; passAs: PassAs }   // GraphQL pageInfo; passAs e.g. "body:variables.after"
  | { type: "linkHeader" }
  | { type: "nextUrl"; next: Path };                                        // full URL: engine strips host, keeps query

export type Duration = string;               // "10m" | "1h" | "365d" | "all" | Template resolving to one of these

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
  as: string;                                // name in template ctx: "partition"
  resultsPath: Path;
  idPath: Path;
  pagination: Pagination;
  keep?: string;                             // predicate over the partition element
  order?: { by: Path; dir: "asc" | "desc" };
  max?: number | Template;                   // e.g. "{{ settings.maxChannels }}"
  next?: PartitionSpec;                      // nested (teams -> channels)
}

export interface ChildSpec {
  as: string;
  request: RequestSpec;
  resultsPath: Path;
  pagination?: Pagination;
  maxPages?: number;
  when?: string;                             // predicate over item
}

export interface Hydrate {
  request: RequestSpec;
  resultsPath?: Path;
  fingerprint?: Template;
  children?: ChildSpec[];
  concurrency?: number;                      // default 4
  notFoundIsDelete?: boolean;                // default true
}

export interface Deletes {
  when?: string;
  reconcile?: "never" | "onFullPass";
  fullPassEvery?: Duration;
}

export type ItemKind =
  | "person" | "company" | "email_thread" | "event" | "doc" | "task"
  | "message" | "meeting_note" | "deal" | "note" | "record";

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
  facets?: Record<string, Expr>;             // keys must be in the kind's facet type (section 4.3) or start with "x_"
}

export type EntityRole = "is" | "from" | "to" | "cc" | "attendee" | "organizer" | "owner" | "assignee" | "author" | "mentioned" | "about";

export interface EntityRef {
  role: Exclude<EntityRole, "is">;
  type: "person" | "company";
  email?: Expr;
  name?: Expr;
  address?: Expr;                            // "Name <email>" strings, comma lists
  domain?: Expr;
  externalId?: Expr;                         // "<platform>:<type>:<id>"
  response?: Expr;                           // events: accepted | declined | tentative | needsAction
}

export interface Entities {
  is?: { type: "person" | "company"; email?: Expr; domain?: Expr; name?: Expr; externalId?: Expr; title?: Expr; companyName?: Expr };
  refs?: EntityRef[];
  ignoreDomains?: string[];
  directory?: boolean;                       // records only resolve externalIds; not shown as results unless they have an email
}

export interface Chunking {
  strategy: "whole" | "paragraph" | "message" | "heading";
  unit?: Path;
  unitBody?: Expr;
  maxTokens?: number;                        // default 400
  overlapTokens?: number;                    // default 50
  header?: Template;
}

export interface ClassifyExtra {
  key: string;                               // question_set name
  jev: { question: Template; output: "labels" | "boolean" | "score"; labels?: string[]; into: string };  // into: "facets.x_<name>"
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
  id: string;                                // "<platform>.<model>", [a-z0-9-]+\.[a-z0-9-]+
  platform: string;
  model: string;
  kind: ItemKind;
  title: string;
  description?: string;
  author?: string;                           // "builtin" | "community" | user id | URL
  revision?: number;
  verified?: "none" | "fixture" | "real";
  proposal?: { by: string; draftId: string; at: string };
  sampleOnly?: boolean;
  enabledByDefault?: boolean;                // built-ins: SPEC 5.6 column
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
  name: string;                              // "HubSpot"
  platform: string;
  profiles: SearchProfile[];
}

export interface EngineVersions { decoder: number; chunker: number; normalize: number }  // bump on output change
export interface ProfileHashes { fetchHash: string; mapHash: string; indexHash: string; profileHash: string }
```

Hash coverage (canonical JSON, sha256 hex, first 16 chars stored):

| Hash | Covers | On change |
|---|---|---|
| `fetchHash` | `list`, `partitions`, `incremental`, `hydrate`, `keep`, `deletes`, `account` | drop cursors (`watermark`, `delta_token`, `page_cursor`) of every partition; next run full pass with reconcile; hydrate fingerprints cleared only when `hydrate` changed |
| `mapHash` | `kind`, `fields`, `entities`, `chunk`, `EngineVersions.decoder`, `.normalize`, `.chunker` | `remapSource`: re-normalize from `raw_items` (zero API calls), re-cut chunks; unchanged `text_hash` keeps its embedding |
| `indexHash` | `classify`, embedding model id (from settings), `EngineVersions.chunker` | enqueue missing embeddings and judgments for the new key |
| `profileHash` | sha256(fetch + map + index) | identifies a shared profile; built-in update detection |

Excluded from every hash: `title`, `description`, `author`, `revision`,
`verified`, `proposal`, `schedule`, `limits`, `settings` defaults,
`enabledByDefault`.

### 4.2 JSON Schema

`profiles/schema/profile-1.json` is generated from `profileSchema`
(`zod` v4 `z.toJSONSchema`) by `pnpm --filter @search/core gen:schema` and
committed. Hand edits are forbidden; the test `schema.test.ts` fails when the
committed file differs from the generated one. Top-level contract the
generator must produce:

```json
{
  "$id": "https://search.forkable.dev/schema/profile-1.json",
  "type": "object",
  "required": ["$schema", "id", "platform", "model", "kind", "title", "list", "incremental", "fields"],
  "additionalProperties": false,
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z0-9-]+\\.[a-z0-9-]+$" },
    "kind": { "enum": ["person", "company", "email_thread", "event", "doc", "task", "message", "meeting_note", "deal", "note", "record"] },
    "fields": { "type": "object", "required": ["title", "occurredAt"] },
    "list": { "type": "object", "required": ["actionId", "resultsPath", "idPath", "pagination"] }
  }
}
```

Static rules `validateProfile` adds beyond the schema: every path parses;
every template parses and uses only known roots and filters; every predicate
parses; facet keys belong to the kind (section 4.3) or start with `x_`;
`TBD:` action ids are an error for `author: "builtin"`; `sample::` ids need
`sampleOnly: true`; a `delta` strategy has `tokenPath`; `restartOnCap`
needs `order: "asc"`.

### 4.3 Normalized item per type

```ts
export interface NormalizedItem {
  externalId: string;
  kind: ItemKind;
  title: string;                             // never empty: "(untitled)" fallback
  body: string;                              // plain text, <= 200,000 chars
  snippet: string | null;                    // <= 280 chars; derived from body when absent
  occurredAt: string;                        // ISO 8601 UTC
  updatedAt: string | null;
  url: string | null;                        // absolute https or null
  container: string | null;
  groupKey: string | null;
  status: string | null;
  labels: string[];
  facets: ItemFacets;
  refs: ResolvedRef[];                       // before entity upsert
  is: ResolvedIs | null;
  deleted: boolean;
}

export interface ResolvedRef { role: EntityRole; type: "person" | "company"; email?: string; name?: string; domain?: string; externalId?: string; response?: string }
export interface ResolvedIs { type: "person" | "company"; email?: string; domain?: string; name?: string; externalId?: string; title?: string; companyName?: string }

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
// Every facet type also allows `x_<name>: unknown` extras.

export interface PersonFacets { email?: string; phone?: string; jobTitle?: string; companyName?: string; companyDomain?: string; lifecycle?: string; owner?: string; location?: string }
export interface CompanyFacets { domain?: string; industry?: string; size?: string; owner?: string; location?: string; categories?: string[] }
export interface EmailThreadFacets { messageCount: number; unread?: boolean; hasAttachment?: boolean; lastFrom?: string; participants?: string[]; folder?: string }
export interface EventFacets { start: string; end: string; allDay?: boolean; timeZone?: string; location?: string; joinUrl?: string; organizerEmail?: string; attendees?: { email?: string; name?: string; response?: string }[]; selfResponse?: string; recurring?: boolean; calendar?: string; calendarColor?: string }
export interface DocFacets { parentTitle?: string; path?: string[]; editedBy?: string; wordCount?: number }
export interface TaskFacets { key?: string; state?: string; stateType?: "backlog" | "unstarted" | "started" | "completed" | "canceled"; assignee?: string; priority?: 0 | 1 | 2 | 3 | 4; due?: string; project?: string; team?: string }
export interface MessageFacets { channel?: string; channelType?: "channel" | "private" | "dm" | "group" | "chat"; sender?: string; threadId?: string; replyCount?: number; isReply?: boolean }
export interface MeetingNoteFacets { start?: string; end?: string; durationMin?: number; attendees?: { email?: string; name?: string }[]; takeaways?: string[]; hasTranscript?: boolean; eventId?: string }
export interface DealFacets { amount?: number; currency?: string; stage?: string; closeDate?: string; pipeline?: string; owner?: string; companyName?: string }
export interface NoteFacets { parentKind?: ItemKind; parentTitle?: string; parentExternalId?: string }
```

### 4.4 Runtime records

```ts
export interface RawRecord { item: unknown; detail?: unknown; children?: Record<string, unknown[]>; partition?: unknown; fetchedAt: string }
export interface NormalizeEnv { account: Record<string, unknown>; settings: Record<string, unknown>; now: Date; selfAddresses: string[] }

export interface RunOptions { trigger: RunTrigger; full?: boolean; maxPages?: number; signal?: AbortSignal }
export type RunTrigger = "schedule" | "manual" | "first" | "remap" | "reindex" | "resume";
export type RunOutcome = "ok" | "partial" | "failed" | "rate_limited" | "auth_needed" | "grant_blocked" | "cancelled" | "running";
export interface RunSummary {
  runId: string; sourceId: string; outcome: RunOutcome; fullPass: boolean;
  pages: number; fetched: number; hydrated: number; upserted: number; unchanged: number;
  tombstoned: number; skipped: number; calls: number; retries: number;
  startedAt: string; finishedAt: string; retryAt?: string; error?: SourceError;
}
export type SourceStatus = "new" | "syncing" | "healthy" | "degraded" | "rate_limited" | "auth_needed" | "grant_blocked" | "paused" | "error";
export interface SourceError { code: ErrorCode; message: string; at: string; actionId?: string; httpStatus?: number }
export interface SourceHealth { status: SourceStatus; lastSuccessAt: string | null; lastAttemptAt: string | null; nextRunAt: string | null; retryAt: string | null; consecutiveFailures: number; itemCount: number; added24h: number; updated24h: number; failed24h: number; lastError: SourceError | null; progress?: { done: number; estimate: number | null } }
```

### 4.5 Settings

```ts
export interface SettingsData {
  embedding: { provider: "local" | "openai" | "gemini" | "cohere" | "mistral-ai"; model: string; dims: 1536 };
  rerank: boolean;                           // default true
  engine: "auto" | "claude-code" | "codex" | "one"; // who writes chat, answers, proposals; default "auto"
  chatModel: string;                         // "claude-sonnet-5-5", Anthropic through One (and the local fallback)
  proposalModel: string;                     // "claude-haiku-5-5", Anthropic through One
  localChatModel: string;                    // Claude Code --model or "default"; Codex always picks its own
  localProposalModel: string;                // same, for New profile proposals
  jevModel: string;                          // "jev-latest"
  backfillDefault: "30d" | "365d" | "all";
  slackTier: "limited" | "marketplace";
  vipEntityIds: string[];
  lanesOn: boolean;
  paused: boolean;
}
export const DEFAULT_SETTINGS: SettingsData;  // openai text-embedding-3-small for real users; local hash for sample users
```

The AI engine (`packages/core/src/local-agent.ts`). Everything an LLM writes (the
chat dock, the answer strip, MCP `ask`, CLI `ask`, New profile proposals) runs on
one engine: `auto` takes the local Claude Code, else Codex, else Anthropic through
One on the grant; `claude-code` and `codex` pick one (a CLI that is not installed
or signed in runs on One); `one` always uses One. `SEARCH_LOCAL_ENGINE`
(`off|auto|claude-code|codex|one`, off reads as one) wins over the setting;
`SEARCH_HOSTED=1` forces One and lists no CLIs. Local runs are tool-less and log one
Activity row (`platform` claude-code or codex, `method` EXEC); a failed local run
falls back to One with its own row, and when Anthropic is not in the grant the
error says so (`model_unavailable`). Jev judgments and embeddings always run on
the grant; they are not writing.

```ts
export interface EngineStatus {
  engine: "local" | "one";                   // what runs now
  local: { id: "claude-code" | "codex"; name: string; path: string } | null;
  hosted: boolean;
  choice: EngineChoice;                      // the saved setting
  override: EngineChoice | null;             // SEARCH_LOCAL_ENGINE when set
  effective: EngineChoice;                   // after hosted and the override
  reason: "hosted" | "off" | "chosen" | "not_found" | "unavailable" | null;  // why One, when One
  clis: { id; name; installed: boolean; path: string | null; signedIn: boolean | null; ready: boolean; reason: string | null; models: { value: string; label: string }[] }[];
}
```

### 4.6 Mapper (New profile) types

```ts
export interface CatalogPlatform { platform: string; name: string; title?: string; description?: string; category?: string; image: string; tags: string[]; actionCount?: number; oauth?: boolean; active: boolean }
export interface CatalogAction { actionId: string; title: string; method: string; path: string; tags: string[]; listLike: boolean; readOnly: boolean; permitted: boolean }
export interface ActionDoc { actionId: string; knowledge: string; ioSchema?: unknown; method: string; path: string; tags: string[] }

export interface CreateDraftInput { platform: string; connectionKey?: string }   // connectionKey absent: first connection for the platform in the grant
export interface ProfileDraft {
  id: string; platform: string; step: DraftStep; status: "open" | "saved" | "discarded";
  connection: { key: string; label: string } | null;
  inGrant: boolean;                          // false: show the widen-the-ask path (SPEC D26)
  candidates: CatalogAction[];
  samples: Record<string, DryRunResult>;     // by actionId
  proposal: ProposalOutput | null;
  proposedBy: string;                        // "anthropic:claude-haiku-5-5" | "rules" | "fixture"
  edits: DraftEdits;
  validation: ValidationReport | null;
}
export type DraftStep = "platform" | "models" | "fields" | "identity" | "review";
export interface DryRunResult { actionId: string; status: number; ok: boolean; count: number; estimate: number | null; sample: unknown[]; topLevelKeys: string[]; error?: string }
export interface DraftEdits { selected: string[]; profiles: Record<string, Partial<SearchProfile>> }   // keyed by profile id; deep-merged over proposal
export interface DraftPreview { profileId: string; samples: { externalId: string; item: NormalizedItem; row: ResultRow }[] }
export interface SaveDraftInput { name?: string; profiles: string[] }           // profile ids from the proposal to save
export interface SaveDraftResult { profileIds: string[]; sourceIds: string[]; firstRunIds: string[] }

export interface ProposalInput {
  platform: CatalogPlatform;
  candidates: { actionId: string; title: string; method: string; path: string; knowledgeExcerpt: string; ioSchema?: unknown; sample: unknown; inference: InferenceHints }[];
  vocabulary: { kinds: ItemKind[]; fields: (keyof FieldMap)[]; facetsByKind: Record<ItemKind, string[]>; decoders: Decoder[]; filters: string[] };
  grammar: string;                           // short path/template/predicate summary
  previousErrors?: ValidationIssue[];        // repair rounds
}
export interface InferenceHints { resultsPath?: string; idPath?: string; pagination?: Pagination; titleCandidates: string[]; bodyCandidates: string[]; dateCandidates: string[]; emailCandidates: string[]; urlCandidates: string[]; incrementalParam?: string; kindGuess?: ItemKind }
export interface ProposalOutput {
  models: {
    recommended: boolean;
    reason: string;                          // <= 140 chars
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
```

## 5. `one.call` and fixture mode

```ts
export type LedgerActor = "indexer" | "assistant" | "mapper" | "classifier" | "embedder" | "user" | "api" | "mcp";

export interface CallInput<Out, T> {
  platform: string;
  action: string;                            // short ledger name: "list", "hydrate", "embed", "systemone"
  level: "read" | "write";
  actionId: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;                              // with {{var}} placeholders
  pathParams?: Record<string, string>;
  query?: Record<string, string | string[]>;
  body?: unknown;
  headers?: Record<string, string>;
  summary: string;                           // why, shown in Access
  fixtureKey?: string;                       // override for the transport lookup
  pick?: (data: Out) => T;                   // live answers only
}

export interface RawCallResult { status: number; ok: boolean; data: unknown; blockedByGrant: boolean; refusal: "grant" | "plan_limit" | "rate_limit" | "one_error" | null; retryAfterMs: number | null; ms: number; ledgerId: string | null }

export interface GrantedConnection { key: string; platform: string; name?: string; title?: string; image?: string; access: { policy: "full" } | { policy: "methods"; methods: string[] } | { policy: "actions"; actions: string[] } }
```

Behaviour:

1. Mode is `ctx.mode`. `fixture`: `ctx.transport.answer({ actionId, method, path, pathParams, query, body })`.
   `connect`: `ctx.oneConnect.runAction(ctx.userId, { connectionKey, actionId, method, path: fillPath(path, pathParams), query, body, headers })`.
2. `connectionKey`: `ctx.connectionKey` for source calls; for `openai`, `gemini`,
   `cohere`, `mistral-ai`, `anthropic`, `typesafe` the first key for that
   platform in `grantedConnections` (cached 60 s per user). None: throw
   `NotConnected(platform)`.
3. One-served actions (`path` starts with `/v1/`): add `connectionKey` to the
   JSON body.
4. Query params never go in the body.
5. `actionId` starting `sample::` in `connect` mode throws `SampleActionLive`;
   starting `TBD:` throws `UnresolvedAction`.
6. Ledger: one row per call, or an increment of `ctx.rollup` for indexer list,
   hydrate and children calls (flushed as one row per action per run).
7. `call` throws `BlockedByGrant` on a grant refusal, `HttpError(status, body)`
   on other non-2xx, rethrows `OneConnectError`. `raw` never throws on status.
   `attempt` writes the row and returns it.
8. `retryAfterMs` from the response's `Retry-After` when the package exposes
   it, else null.

`FixtureTransport`:

```ts
export interface FixtureRequest { actionId: string; method: string; path: string; pathParams?: Record<string, string>; query?: Record<string, string | string[]>; body?: unknown; platform?: string; fixtureKey?: string; cursor?: string | null; partition?: string | null }
export interface FixtureAnswer { status: number; data: unknown; blockedByGrant?: boolean; refusal?: RawCallResult["refusal"] }
export interface FixtureTransport { answer(req: FixtureRequest): Promise<FixtureAnswer> }
```

Lookup order: `fixtures/sample/<platform>/<model>.pages.json` holds
`{ actionId, pages: [{ match: { cursor?: string | null, partition?: string, since?: "any" }, response }] }`;
the transport reads the request's pagination value (by the profile's
`passAs`) and partition path var, returns the matching page, and filters items
by the since filter when `since: "filter"` is set. `*.details.json` holds
`{ actionId, byId: { "<id>": response } }` for hydrate and children (missing
id = 404). `account.json` answers account calls. AI calls answer from
`judgments.json`, `matches.json`, `rerank.json`, `chat.json`,
`proposals/*.json`, keyed by a stable hash of the request's subject (item
external id, pair ids, normalized query). Any write action answers
`{ status: 403, blockedByGrant: true, refusal: "grant", data: { error: "not in grant" } }`.
An unmatched request answers 404 with `{ error: "no fixture", request }` so
tests fail loudly.

Fixture file formats, exactly as `sample/world.ts` reads them (Phase 1, core):

- The engine adds two fields to every fixture request: `cursor` (the
  pagination value it sent, `null` on a first page; for a `delta` run's first
  page it is the stored delta token) and `partition` (the partition element's
  id, when the profile has `partitions`). Page matching therefore needs no
  knowledge of `passAs`.
- `<platform>/<name>.pages.json`: `{ "$shapedFrom", "actionId", "pages": [{ "match": { "cursor"?: string | null, "partition"?: string, "request"?: { "pathParams"?, "query"?, "body"? } }, "response": <documented response> }] }`.
  Any file name works; files are indexed by `actionId`. A page matches when
  `match.cursor` equals the request's cursor (absent or `null` = first page),
  `match.partition` (when given) equals the request's partition, and every key
  in `match.request` (when given) deep-equals the request's value (use it when
  two models share one action id, e.g. `{ "pathParams": { "objectType": "deals" } }`).
  First matching page wins. Partition lists (channels, calendars, chats) are
  ordinary pages files for their own action id.
- `<platform>/<name>.details.json`: `{ "$shapedFrom", "actionId", "byId": { "<id>": <response> } }`.
  The transport tries every scalar value of the request's `pathParams`, then
  `query`, then top-level `body` against `byId`; none found answers 404 (which
  tombstones when `notFoundIsDelete`). Used for hydrate and children.
- `<platform>/account.json`: `{ "<actionId>": <response> }` (several account
  actions allowed in one file).
- `judgments.json`: `{ "items": { "<platform>:<externalId>": { "kind": "<item-v1 kind>", "needs_you": 0..1, "ball": "me"|"them"|"nobody", "ball_p": 0..1, "importance": 0..3 } } }`.
  Items not listed get the rules classifier.
- `matches.json`: `{ "pairs": [{ "a": "<entity key>", "b": "<entity key>", "same": 0..1 }] }`,
  keys as in `entity_keys` (`email:priya@globex.com`, `name:priya s.`).
- `rerank.json`: `{ "queries": { "<lowercased query>": ["<platform>:<externalId>", ...] } }` (best first).
- `chat.json`: `{ "answers": [{ "q": "<lowercased question>", "text": "... [1] ... [2]", "cite": ["<platform>:<externalId>", ...], "proposal"?: { "query", "reason" }, "followups"?: string[] }] }`;
  `[n]` in `text` is the n-th entry of `cite`.
- `proposals/<platform>.<model>.json`: a `ProposalOutput`.
- `expect-demo.json`: `{ "items": n, "bySource": { "<platform>": n }, "queries": { "<query>": n } }`.
- `world.md`, relative dates as in the first bullet of this section.

## 6. HTTP API

All JSON. Prefix `/api/v1` unless shown. Auth: `search_sid` cookie or
`Authorization: Bearer <token>` with the scope shown. Errors:
`{ error: { code: ErrorCode, message: string, data?: unknown } }`.

### 6.1 Shared response types (`api-types.ts`)

```ts
export interface ApiUser { id: string; name: string | null; email: string | null; avatarUrl: string | null; isSample: boolean }
export interface MeResponse { user: ApiUser | null; signedIn: boolean; connect: { configured: boolean; signInUrl: string | null }; capability: Capability; settings: SettingsData | null }

export interface ResultRow {
  id: string; kind: ItemKind; platform: string; sourceId: string; sourceName: string; logoUrl: string;
  title: string; titleHighlights: [number, number][];
  context: string | null;                    // inline context per type (SPEC 15.3)
  snippet: string | null; snippetHighlights: [number, number][];
  occurredAt: string; updatedAt: string | null; url: string | null;
  people: { entityId: string; name: string; role: EntityRole; avatarUrl: string | null }[];
  facets: ItemFacets; lane: Lane | null; importance: number | null;
  groupCount: number;                        // items collapsed into this one by groupKey
  alsoIn?: string[];                         // other platforms whose records for this person or company folded in (D43)
  exact?: "email" | "domain" | "id" | "name" | null; // why the exact lane put it first (D42)
  score: number; ranks: { kw: number | null; vec: number | null; title: number | null; rerank: number | null };
}
export type Lane = "vip" | "needs_you" | "waiting" | "fyi" | "low";

export interface ParsedQuery {
  text: string;                              // free words and phrases, as typed
  clauses: QueryClause[];
  errors: { at: number; message: string }[];
}
export type QueryClause =
  | { kind: "word"; value: string; negate: boolean }
  | { kind: "phrase"; value: string; negate: boolean }
  | { kind: "or" }
  | { kind: "op"; key: OperatorKey; values: OpValue[]; negate: boolean; raw: string };
export type OperatorKey = "source" | "type" | "is" | "from" | "to" | "with" | "about" | "before" | "after" | "on" | "updated" | "during" | "has" | "status" | "stage" | "lane" | "label" | "container" | "amount" | "id";
export type OpValue =
  | { t: "text"; v: string }
  | { t: "date"; v: string; resolved: { from: string; to: string } }
  | { t: "range"; from: string; to: string }
  | { t: "cmp"; op: ">" | ">=" | "<" | "<="; v: string | number; resolved?: string };
export interface ChipEdit { key: OperatorKey; values: string[] | null; negate?: boolean }   // null removes the chip

export interface SearchRequest { q: string; fresh?: boolean; limit?: number; offset?: number; sort?: "best" | "newest" | "oldest"; scope?: ItemKind | "all"; selectedEntityIds?: string[] }
export interface SearchResponse {
  queryId: string;                           // for rerank and chat context
  parsed: ParsedQuery;
  total: number;                             // after filters, before limit
  hiddenByFilters: number;                   // matches the text alone would add
  counts: { scope: Record<ItemKind | "all", number>; source: Record<string, number> };
  entities: EntityChip[];                    // top strip, max 3
  results: ResultRow[];
  mode: "hybrid" | "keyword";
  embedder: EmbedderStatus;
  fallback: "or" | null;           // the keyword arm found nothing with every word, so it ran with OR (D44)
  dateProposals: DateProposal[];   // plain dates read from the text, offered as chips, never applied (D44)
  didYouMean: EntityChip | null;   // the closest entity name when every word together found nothing (D43)
  ms: number;
}
export interface EntityChip { id: string; type: "person" | "company"; name: string; subtitle: string | null; avatarUrl: string | null; logoUrl: string | null; itemCount: number; sources: string[]; isSelf: boolean; email: string | null }

export interface RerankRequest { queryId: string; fresh?: boolean }   // fresh: ask Jev about every candidate again (Refresh)
export interface RerankResponse { queryId: string; order: string[]; reranked: boolean; ms: number; reason?: "off" | "short_query" | "timeout" | "jev_missing" | "sample_no_fixture"; stored?: number; asked?: number }
// stored: candidates scored from rerank_scores; asked: candidates sent to Jev in this request (0 = no Jev call)

export interface SuggestResponse { operators: { insert: string; label: string; avatarUrl?: string; logoUrl?: string }[]; entities: EntityChip[]; recent: string[] }

export interface ItemDetail {
  row: ResultRow; body: string; bodyHighlights: [number, number][];
  parts: { kind: "message" | "section"; title: string | null; author: string | null; at: string | null; text: string }[];  // email messages, doc sections
  properties: { label: string; value: string }[];
  classification: { lane: Lane | null; importance: number | null; kindGuess: string | null; needsYou: number | null; by: "jev" | "rules" | "fixture" | null };
  related: ResultRow[];                      // same group or shared entities, max 5
  rawAvailable: boolean;
}

export interface EntityDetail {
  entity: { id: string; type: "person" | "company"; name: string; emails: string[]; domain: string | null; title: string | null; company: EntityChip | null; avatarUrl: string | null; isSelf: boolean; sources: { platform: string; count: number; lastAt: string }[] };
  timeline: ResultRow[];                     // newest first, 50
  pendingMatches: { matchId: string; other: EntityChip; probability: number; reason: string }[];
}

export interface Citation { n: number; itemId: string; chunkId: string | null; kind: ItemKind; title: string; platform: string; url: string | null; quote: string; occurredAt: string }
export interface QueryProposal { query: string; diff: { op: "+" | "-"; clause: string }[]; count: number; reason: string }
export type ChatStep = { id: string; label: string; state: "running" | "done" | "error"; query?: string; count?: number }
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
}
/** semantic false says why: not_in_grant, error, keyword_mode or sample (D41). */
export interface EmbedderStatus { model: string; semantic: boolean; reason: "not_in_grant" | "error" | "keyword_mode" | "sample" | null; platform: string | null; message: string | null }
export interface DateProposal { phrase: string; insert: string; label: string; remove: string }
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
```

### 6.2 Routes

```
GET    /api/health                                  -> { ok: true, version, capability: Capability, db: "embedded" | "external", publicUrl }
GET    /me                                          -> MeResponse
POST   /signout                                     -> 204
GET    /api/one/authorize                           -> 302 to One (Connect sign-in; ?returnTo=)
GET    /api/one/callback                            -> 302 (web sign-in, or OAuth code when search_oauth_pending is set)
POST   /connect/disconnect                          -> 204 (local only; revoke is in One)

GET    /search?q=&limit=30&offset=0&sort=best&scope=all     [search:read]  -> SearchResponse   (&fresh=1 skips the query vector cache)
POST   /search/rerank   body RerankRequest                  [search:read]  -> RerankResponse
GET    /search/count?q=                                     [search:read]  -> { count: number }
GET    /suggest?prefix=                                     [search:read]  -> SuggestResponse
GET    /items/:id                                           [search:read]  -> ItemDetail
GET    /recent-items?limit=8                               [search:read]  -> ResultRow[] (items whose preview was opened, newest first)
GET    /items/:id/raw                                       [account:read] -> { item, detail, children } (cookie only, for the Fields tab)
GET    /entities?q=&type=person|company&limit=10            [search:read]  -> EntityChip[] (limit 1 to 200; self first, then by item count)
GET    /entities/:id                                        [search:read]  -> EntityDetail
POST   /entities/:id/merge     body { otherId }             [sources:write] -> EntityDetail
POST   /entities/:id/unmerge                                [sources:write] -> EntityDetail
POST   /entity-matches/:id     body { decision: "merge" | "reject" } [sources:write] -> 204

GET    /chats                                               [search:ask]   -> { id, title, updatedAt }[]
GET    /chats/:id                                           [search:ask]   -> { id, title, messages: ChatMessage[] }
POST   /chat            body ChatTurnInput                  [search:ask]   -> text/event-stream of ChatEvent (section 7)
POST   /answer          body AnswerRequest                  [search:ask]   -> AnswerResponse
DELETE /chats/:id                                           [search:ask]   -> 204

GET    /sources                                             [search:read]  -> SourcesResponse
POST   /sources/sample                                      cookie         -> SourcesResponse (idempotent; makes the sample user's sources and runs them)
POST   /sources         body { platform, connectionKey, profileId } [sources:write] -> ApiSource
GET    /sources/:id                                         [search:read]  -> ApiSource
PATCH  /sources/:id     body { paused?, scheduleEvery?, settings? } [sources:write] -> ApiSource
POST   /sources/:id/sync        body { full?: boolean }     [sources:write] -> { runId }
POST   /sources/:id/update-profile  body { versionId? }     [sources:write] -> ApiSource (move to the latest built-in version)
DELETE /sources/:id     body { keepItems?: false }          [sources:write] -> 204
GET    /sources/:id/runs?limit=50                           [search:read]  -> ApiRun[]
GET    /sources/:id/errors?stage=                           [search:read]  -> ApiItemError[]
POST   /sources/:id/errors/retry  body { externalIds? }     [sources:write] -> { queued: number }

GET    /profiles                                            [search:read]  -> ApiProfile[] (built-ins + mine)
GET    /profiles/:id                                        [search:read]  -> ApiProfile (json always filled)
GET    /profiles/:id/versions                               [search:read]  -> { version, profileHash, createdAt, note }[]
PUT    /profiles/:id    body { json: SearchProfile, note? } [sources:write] -> { profile: ApiProfile, report: ValidationReport, effect: "none" | "remap" | "refetch" | "reindex", affectedItems: number }  (user profiles; built-ins are copied to a user profile first)
POST   /profiles/:id/fork                                   [sources:write] -> ApiProfile
GET    /profiles/:id/export                                 [search:read]  -> SearchProfilePack (Content-Disposition attachment)
POST   /profiles/import body { pack } | { url }             [sources:write] -> ImportPreview
POST   /profiles/import/:importId/accept                    [sources:write] -> ApiProfile[]
POST   /profiles/validate  body { json }                    [search:read]  -> ValidationReport (static)

GET    /catalog/platforms?q=                                [search:read]  -> { platforms: (CatalogPlatform & { inGrant: boolean; connectionLabel: string | null; builtin: boolean })[] }
GET    /connections                                         [search:read]  -> GrantedConnection[] (labels resolved)
POST   /profile-drafts       body CreateDraftInput          [sources:write] -> ProfileDraft (reads the actions and groups them into models, no AI; with `models` it also maps them; progress over SSE "draft")
POST   /profile-drafts/:id/models    body { models: string[] } [sources:write] -> ProfileDraft (docs, dry runs, proposal and checks for just these model keys, up to 8; may take 10 to 60 s)
GET    /profile-drafts/:id                                  [sources:write] -> ProfileDraft
PATCH  /profile-drafts/:id   body { step?, edits? }         [sources:write] -> ProfileDraft
POST   /profile-drafts/:id/dry-run   body { actionId }      [sources:write] -> DryRunResult
POST   /profile-drafts/:id/repropose body { hint? }         [sources:write] -> ProfileDraft
POST   /profile-drafts/:id/preview   body { profileId }     [sources:write] -> DraftPreview
POST   /profile-drafts/:id/validate                         [sources:write] -> ValidationReport
POST   /profile-drafts/:id/save      body SaveDraftInput    [sources:write] -> SaveDraftResult (one source per account in `connectionKeys`, every account of the platform when it is left out; ProfileDraft.accounts lists them)
POST   /profile-drafts/:id/widen-ask body { profiles }       cookie, local  -> { written: "connect.extra.json" | null, next: "update_connect_app" | "none" | "sample", added: string[] } (the UI calls it on Save: the profiles' exact action ids not yet in the ask; no profiles adds the platform read-only, the old shape)
DELETE /profile-drafts/:id                                  [sources:write] -> 204

GET    /settings                                            [account:read] -> SettingsData
PUT    /settings        body Partial<SettingsData>          cookie         -> { settings: SettingsData, effect: null | { reembed: { chunks: number, estimateCalls: number } } }
GET    /assistant/engine                                    [account:read] -> EngineStatus (for the saved engine setting)
POST   /assistant/engine/redetect                           cookie         -> EngineStatus (Check again: looks for the CLIs anew)
GET    /saved-searches                                      [search:read]  -> { id, name, query, position }[]
POST   /saved-searches  body { name, query }                cookie         -> saved row
PATCH  /saved-searches/:id  body { name?, query?, position? } cookie       -> saved row
DELETE /saved-searches/:id                                  cookie         -> 204
GET    /recent-searches                                     [search:read]  -> { query, at, resultCount }[]
DELETE /recent-searches                                     cookie         -> 204

GET    /access                                              [account:read] -> AccessResponse
POST   /access/receipt-demo                                 cookie         -> LedgerRow (Gmail delete attempt: 403 blockedByGrant)
GET    /ledger?limit=100&actor=&sourceId=&before=           [account:read] -> LedgerRow[]

GET    /setup/connect                                       cookie, localhost -> ConnectSetupResponse
POST   /setup/connect   body Partial<Record<FieldName, string>> cookie, localhost -> ConnectSetupResponse | 400 invalid_fields { fields: { NAME: message } }
DELETE /setup/connect/:name                                 cookie, localhost -> ConnectSetupResponse
POST   /setup/connect/create                                cookie, localhost -> ConnectSetupResponse (spawns `one --agent connect create --no-open`)
GET    /setup/connect/create                                cookie, localhost -> ConnectSetupResponse (poll)
DELETE /setup/connect/create                                cookie, localhost -> ConnectSetupResponse (stops a run in flight)

GET    /oauth-clients                                       cookie         -> OAuthClientRow[]
DELETE /oauth-clients/:clientId                             cookie         -> 204 (revokes every token family of that client for this user)

GET    /events                                              cookie or [search:read] -> text/event-stream of ServerEvent
```

OAuth and MCP (no `/api/v1` prefix):

```
GET  /.well-known/oauth-authorization-server     metadata (issuer = the origin asked, S256 only, auth methods none | client_secret_post | client_secret_basic, scopes section 6.3); also at /.well-known/openid-configuration
GET  /.well-known/oauth-protected-resource       { resource: "<origin>/mcp", authorization_servers: ["<origin>"], scopes_supported: ["search:read", "search:ask"] }
GET  /.well-known/oauth-protected-resource/mcp   the same
GET  /.well-known/oauth-protected-resource/api/v1   resource "<origin>/api/v1", all four scopes
POST /register                                   DCR (RFC 7591, JSON); public clients (token_endpoint_auth_method "none") get no secret; 201
GET  /authorize                                  validates, stores oauth_pending, sets search_oauth_pending, renders the consent page
POST /oauth/consent  form { pending, action: allow | one | sample | deny }   the consent page's buttons (see section 15)
POST /token                                      form or JSON: authorization_code (PKCE S256) | refresh_token
POST /revoke                                     form or JSON (RFC 7009); revokes the token's whole family; 200 for unknown tokens
POST /mcp                                        Streamable HTTP (stateless JSON responses); 401 + WWW-Authenticate resource_metadata=".../.well-known/oauth-protected-resource/mcp" when no token; GET and DELETE answer 405
```

### 6.3 Scopes

`search:read`, `search:ask`, `sources:write`, `account:read`. The cookie
session has all four. Default for MCP clients: `search:read search:ask`;
for the CLI: all four.

## 7. Streaming

### 7.1 Chat (`POST /api/v1/chat`)

Response `Content-Type: text/event-stream`. Each event is
`event: <type>\ndata: <json>\n\n`. Order: `chat` first, `done` last.

```ts
export type ChatEvent =
  | { type: "chat"; chatId: string; messageId: string }
  | { type: "step"; step: ChatStep }                                   // same id updates in place
  | { type: "results"; items: (ResultRow & { n: number })[] }          // numbered context items added this round
  | { type: "answer"; text: string; citations: Citation[]; grounded: boolean; model: string }
  | { type: "proposal"; proposal: QueryProposal }
  | { type: "followups"; items: string[] }
  | { type: "error"; error: { code: ErrorCode; message: string } }
  | { type: "done"; messageId?: string };                             // messageId: the stored assistant message
```

The UI renders `[n]` markers in `answer.text` as citation pills matched to
`citations` by `n`. A client that disconnects cancels the turn (AbortSignal
through `runChatTurn`). The finished assistant message is stored before
`done`.

### 7.2 Server events (`GET /api/v1/events`)

```ts
export type ServerEvent =
  | { type: "source"; sourceId: string; health: SourceHealth }
  | { type: "run"; sourceId: string; run: ApiRun }
  | { type: "index"; added: number; updated: number; removed: number; sourceId: string }
  | { type: "entity"; entityId: string; change: "merged" | "match_pending" | "unmerged" }
  | { type: "draft"; draftId: string; stage: "actions" | "docs" | "dry_run" | "propose" | "validate" | "ready" | "failed"; message?: string }
  | { type: "health"; capability: Capability }
  | { type: "ledger"; row: LedgerRow }
  | { type: "ping" };                                                 // every 25 s
```

The UI invalidates TanStack Query keys per event (`["sources"]`,
`["source", id]`, `["search"]` on `index` only when the results page is idle).

## 8. Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `bad_request` | 400 | malformed input |
| `invalid_fields` | 400 | setup form; `data.fields` |
| `invalid_query` | 400 | parse errors; `data.errors` (search still answers 200 with `parsed.errors` for soft errors; this is for unparseable input only) |
| `invalid_profile` | 400 | `data.report: ValidationReport` |
| `unauthorized` | 401 | no session or token |
| `token_expired` | 401 | bearer expired; refresh |
| `insufficient_scope` | 403 | `data.required` |
| `not_signed_in` | 401 | cookie session has no user |
| `forbidden` | 403 | not your resource |
| `local_only` | 403 | setup routes from a non-localhost host or origin |
| `not_found` | 404 | |
| `conflict` | 409 | e.g. a run already in flight |
| `not_connected` | 409 | platform not in the grant (`data.platform`) |
| `blocked_by_grant` | 403 | One refused the action (`data.actionId`) |
| `reconnect_required` | 409 | grant gone; sign in again |
| `rate_limited` | 429 | `data.retryAt` |
| `plan_limit` | 402 | One plan limit |
| `upstream_error` | 502 | provider or One failed after retries (`data.status`, body cut to 500 chars) |
| `model_unavailable` | 409 | chat or proposal model platform not in the grant |
| `embedding_unavailable` | 409 | embedding platform not in the grant |
| `keyword_only` | 409 | a vector-only operation in keyword mode |
| `sample_action_live` | 500 | `sample::` id reached connect mode (bug) |
| `unresolved_action` | 500 | `TBD:` id reached runtime (bug) |
| `internal` | 500 | |

`SourceError.code` uses the same list.

## 9. UI contract

- Vite + React 19 + Tailwind 4, alias `@` -> `src`, `@search/core` -> core src
  (browser-safe files only: `api-types.ts`, `keymap.ts`, `query/*`,
  `contract.ts` types).
- API client `ui/src/lib/api.ts`: `request<T>(method, path, body?)` on
  `/api/v1`, `credentials: "same-origin"`, throws `ApiError(status, code,
  message, data)`. Chat via `fetch` + a stream reader that parses section 7.1.
- Query keys: `["me"]`, `["search", q, sort, scope]`, `["item", id]`,
  `["entity", id]`, `["sources"]`, `["source", id]`, `["runs", id]`,
  `["profiles"]`, `["draft", id]`, `["settings"]`, `["access"]`,
  `["ledger", filters]`, `["saved"]`, `["recent"]`, `["catalog", q]`.
- Search box state is the URL (`/?q=`). Chips are derived from
  `parseQuery(q)` and edited with `applyChip(q, edit)`; never a second state.
- Debounce: 120 ms on typing; `GET /search` aborts the previous request.
  After results, `POST /search/rerank` once; apply `order` only when the
  selected row is still the first row and the user has not pressed a key in
  the list since.
- Saved results (D47, `ui/src/lib/searchCache.ts`): localStorage
  `search.results.v1`, per signed-in user, the last 20 pages keyed by the exact
  `[q, scope, sort]`, 30 minutes, each with its `SearchResponse`, Jev `order`
  and answer strip answer. A saved page renders with no search, rerank or
  answer call (rerank only when the saved one timed out), under "Saved results
  from N min ago" and Refresh (`⇧ R`). The quiet check reruns `GET /search`
  and shows "N new results" for ids the saved page lacks; a click applies them.
  Refresh drops the entry and sends `fresh=1` to `GET /search` and
  `fresh: true` to `POST /search/rerank`. `api.signout` and `api.disconnect`
  clear the store; another user id clears it on read.
- Logos: `https://assets.withone.ai/connectors/<platform>.svg`, `loading="lazy"`,
  letter-tile fallback on error.
- Keyboard: one global handler (`ui/src/lib/keys.ts`, ported from Rill),
  bindings from `@search/core/keymap`.
- Routes and screens: SPEC section 15.1. Tokens: `ui/src/index.css` copies
  Rill's `@theme` with the Forkable palette and the `design/SPACING.md` ladder.
- Mock mode `VITE_MOCK=1` answers every route in section 6.2 from
  `ui/src/mock/` built on the sample world JSON, so the UI agent can build
  before the server exists.

## 10. CLI contract

`cli/bin/search.mjs` imports `../src/index.ts` with `tsx/esm/api`. Depends on
`@search/core` and `@search/server` (workspace). Commands and exit codes in
SPEC 16.3. Remote commands read `~/.search/cli-token.json`:

```json
{ "server": "http://localhost:52289", "clientId": "...", "accessToken": "...", "refreshToken": "...", "expiresAt": "2026-10-29T12:00:00Z", "scopes": ["search:read", "search:ask", "sources:write", "account:read"] }
```

File mode 0600, refreshed on 401 `token_expired`. `search demo` imports
`runDemo` and never needs the file.

## 11. MCP contract

Tool input schemas (zod), outputs as `content: [{ type: "text", text }]` plus
`structuredContent` on success only:

```ts
search:       { query: z.string().min(1).max(500), limit: z.number().int().min(1).max(50).default(10) }
              -> { results: { id: string; title: string; url: string | null; source: string; kind: ItemKind; date: string; snippet: string | null }[] }
fetch:        { id: z.string() }
              -> { id: string; title: string; url: string | null; text: string; metadata: { source: string; kind: ItemKind; date: string; people: string[]; facets: ItemFacets } }
get_entity:   { query: z.string().min(1) }
              -> { entity: EntityDetail["entity"]; recent: { id: string; title: string; source: string; date: string }[] }
list_sources: {}
              -> { sources: { id: string; platform: string; status: SourceStatus; items: number; lastSync: string | null }[] }
ask:          { question: z.string().min(1).max(2000), query: z.string().optional() }
              -> { answer: string; grounded: boolean; citations: { n: number; id: string; title: string; url: string | null; quote: string }[] }
```

Every tool resolves the user from `authInfo.extra.userId` and calls the same
core function as the REST route. Ledger actor `mcp`, `client_id` set.

## 12. Fixtures and tests

- `fixtures/sample/world.md` is the cast (SPEC 11). JSON fixtures carry
  `"$shapedFrom": "<actionId> Response Fields, one-actions.md section N"` at
  the top of each file. Relative dates use `{ "$rel": "-2d 14:00" }` or
  `{ "$relMs": "-2d" }` / `{ "$relUnix": ... }` / `{ "$relSlackTs": ... }`
  wherever the documented field is a date in that format; `loadSampleWorld`
  resolves them in America/Los_Angeles.
- `packages/core` tests: `node --test` via tsx (`pnpm --filter @search/core test`),
  database tests on a scratch database created with `ensureDatabase` on the
  embedded server and dropped after.
- `test:profiles`: for every pack, run the engine on fixtures, assert counts
  in `fixtures/sample/<platform>/expect.json` (`{ items, kinds, tombstoned,
  entities: { "<email>": { sources } } }`), static validation clean, every
  action in the manifest.
- Expected demo numbers live in `fixtures/sample/expect-demo.json`; the demo
  test compares against it.
</content>
</invoke>

## 13. Phase 1 deviations (core, 2026-10-29)

- `EngineCtx` and `CallCtx` live in `packages/core/src/ctx.ts`, not `contract.ts`, so `contract.ts`
  stays browser-safe. `EngineCtx` gains `sleep?(ms)` (retry backoff; tests replace it).
- `bootDatabase(opts)` is a core export (`db/boot.ts`), shared by the server and the cli:
  `{ home, pgPort?, databaseUrl?, forceKeyword?, schema?, dbName?, log? } -> { db, url, kind, dataDir, port, capability, extDir, serverVersion, startedEmbedded, stop() }`.
  `createDb(url, { max?, schema?, extraSearchPath? })`, `runMigrations(db, { schema? })`, `dropSchema(db, name)`.
  `Db` is the Drizzle client with `$client: pg.Pool`; `Tx` is a Db or an open transaction.
- Engine calls pass `path: ""` to `one.call`: `runAction` then looks method, path and the
  `custom` tag up from the action id (the package adds `connectionKey` to One-served bodies).
  `pick` applies to fixture answers too (fixtures are response-shaped).
- `CallInput` and `FixtureRequest` gain `cursor`, `partition` and `delta` (fixture page matching)
  and `FixtureRequest` gains `platform` and `fixtureKey`. AI fixtures answer by `fixtureKey`:
  `judgment:<platform>:<externalId>`, `match:<keyA>|<keyB>`, `rerank:<query>`, `chat:<question>`,
  `proposal:<platform>.<model>`.
- Fixture pages may carry `status` (default 200) and `match.delta`. `judgments.json` items are
  `{ kind, needs_you, ball, ball_p, importance, lane? }` with a top-level `vips` list of entity keys;
  `chat.json` answers are keyed by normalized question with `citations: [{ n, ref, quote }]` and `searches`.
- Profile format additions (SPEC 21): `EntityRef.each`, `Hydrate.when`, decoder `number`, filters
  `firstline`, `truncate`, `striphtml`, template root `el`. `profiles/schema/profile-1.json` is regenerated.
- Decoder list and `ItemFacets` are unchanged otherwise. `ResultRow` has no `externalId`.
- Not yet exported from core (later phases): `jevRerank`, `suggest`, the mapper functions,
  `exportPack`, `importPack`, `listPlatforms`.
- `connect.manifest.json` is generated by `node packages/core/scripts/gen-manifest.mjs` from the packs
  plus core's own actions; `test:profiles` fails when a pack names an action it lacks.

## 14. Phase 2 decisions (server, 2026-10-29)

The server agent closed the 13 gaps `ui/README.md` listed, and core gained the
mapper. Mock (`ui/src/mock`) and server answer the same shapes.

| # | Gap | Decision |
|---|---|---|
| 1 | No `GET /profiles/:id`; `ApiProfile.json` not guaranteed | Added `GET /profiles/:id`. Every `ApiProfile` (list, get, PUT, fork, accept) carries `json`. |
| 2 | `fieldNotes[].target` vocabulary | Targets are `fields.<FieldMap key>`, `fields.facets.<key>` (or `facets.<key>`), `list.idPath`, `entities.refs[<i>]` / `refs.<role>`, `entities.is.<key>` / `is.email`. Field paths in profiles are rooted at `item.`; `list.idPath` is relative to the record. The UI field map writes `item.` paths and seeds the id row from `list.idPath` when no note names it. |
| 3 | `sampleIds` order | `ValidationIssue.sampleIds` are the failing samples' external ids (`list.idPath`, else `#<n>`), in the order of `ProfileDraft.samples[actionId].sample`. |
| 4 | `Citation` has no kind | `Citation.kind: ItemKind` added. |
| 5 | Sample model names | `ChatMessage.model` / answer `model` is `"fixture"` for replayed `chat.json` answers and `"extractive"` for the no-model answerer; live is `anthropic:<model>`. |
| 6 | No message id on `done` | `{ type: "done", messageId }` once the assistant message is stored (absent after an `error`). |
| 7 | "The ask changed" | `ConnectSetupResponse.create.askChanged`: true when a client id is known and the sha256 of `connect.manifest.json` + `connect.extra.json` differs from the one recorded at the last approved `one connect create` (`~/.search/connect-ask.json`), or, with none recorded, when `connect.extra.json` names a platform. |
| 8 | Access grant status and mode | `AccessResponse.status` (`active`, `reconnect_required`, `revoked`, `none`; `revoked` is reserved, One reports a revoked key-mode grant as `reconnect_required`) and `mode` (`fixture` for the sample). Actions come from `connect.manifest.json`; `grant: false` rows are the writes Search never has. |
| 9 | `EntityChip` lacks self and email | `EntityChip.isSelf` and `EntityChip.email` (primary email) added. |
| 10 | `/entities` capped at 10 | `limit` 1 to 200. Without `q`, the UI asks for 200. |
| 11 | Scope and sort not in the URL contract | The results URL is `/?q=...&scope=<kind>&sort=<best|newest|oldest>`; `GET /search` takes the same three. |
| 12 | No recently opened items | `GET /recent-items` (ResultRow[], newest first). Opening an item's preview (`GET /items/:id`) records it. Kept in server memory per user (lost on restart) until a `recent_items` table lands. |
| 13 | Rerank on the sample | `POST /search/rerank` replays `fixtures/sample/rerank.json` for sample users (fixture key `rerank:<query>`, any word count) and answers `reranked: false, reason: "sample_no_fixture"` for other queries. Live: one Jev call, 2.5 s budget, `jev_missing` when TypeSafe is not granted. |

Other interface facts from Phase 2:

- **Events framing.** `GET /api/v1/events` frames carry no `event:` name, only `id:` and `data: <ServerEvent>`, so `EventSource.onmessage` sees every event. A `ping` is sent on connect and every 25 s. Chat (`POST /chat`) frames do carry `event: <type>`.
- **Sample sign-in.** `POST /sources/sample` (cookie only) points the session at the one shared sample user (`usr_sample`, Dana Oyelaran, `is_sample`), makes every enabled built-in source on `sample:<platform>` and, the first time, indexes the world in the request (directories and CRM records first, two passes, VIPs from `judgments.json`, embed, match, classify). The sample grant is every built-in platform, every fixture-catalog platform (`zendesk`) and the AI platforms. A sample session that starts Sign in with One is moved to a fresh user first, so a real grant never lands on the sample user.
- **Signed in** means the sample user, or a user with a `connect_users` row. Other routes answer `401 not_signed_in`.
- **`SourceHealth.progress`** is `{ done: 0, estimate }` while a run is in flight (the estimate is the last item count, or the dry run's for a new profile) and `{ done: 0, estimate: null }` for a `new` source. Core does not report mid-run counts yet.
- **`PATCH /sources/:id`** with a setting the fetch reads (`{{ settings.x }}` in list, hydrate and the other fetch parts) makes `refetchPending` true and starts a run now: cursors reset, a full pass, and a hydrate that reads the setting fetches every item again. See docs/profiles.md, Hashes.
- **`POST /sources/:id/sync`** answers once the run row exists (up to 1.5 s); `runId` is `pending:<sourceId>` if it does not appear in time. 409 `conflict` when a run is in flight.
- **`POST /profile-drafts/:id/save`** kicks each new source's first run and fills `firstRunIds` the same way.
- **Error codes** add nothing new; `local_only` (403) is what the setup routes and `widen-ask` answer to a non-local Host or Origin.
- **Core exports added** (CONTRACT 3): `listPlatforms(ctx, userId, q?)` (needs the user for the grant), `connectionsFor`, `sampleGrant`, `listCatalogActions`, `actionDoc`, `inferHints`, `profileFromHints`, `propose`, `rulesProposal`, `createDraft`, `getDraft`, `patchDraft`, `discardDraft`, `dryRun`, `reproposeDraft`, `previewDraft`, `validateDraft`, `saveDraft` (returns empty `firstRunIds`; the server kicks), `draftEstimate`, `exportPack`, `importPack(db, userId, pack, { origin?, url? })`, `acceptImport(db, userId, importId) -> profileIds`, `fetchPackUrl`, `suggest`, `jevRerank`, `fuseRerank`, `toResultRows`. `EngineCtx.world?: SampleWorld` gives the mapper the fixture catalog. Import previews live in memory for 30 minutes.
- **Mapper modes.** Sample users read `fixtures/sample/catalog` and replay `proposals/<platform>.*.json` (`proposedBy: "fixture"`); a platform with fixture actions but no proposal gets the rules proposal. Real users: public `/v1/available-connectors` (cached 24 h), `listActions` (6 h) and `getActionKnowledge` (24 h) on the grant, one-page dry runs with `path: ""` (catalog lookup), then Haiku through One with up to 2 repair rounds, else rules (`proposedBy: "rules"`). Actions with `{{path vars}}` are not dry-run in real mode.
- **Settings.** `PUT /settings` with a new embedding model queues every chunk for it and answers `effect.reembed`; search uses the new model at once (no 95% flip yet).

## 15. Phase 3 decisions (OAuth, MCP, CLI, 2026-10-29)

Server files: `server/src/oauth.ts` (provider, routes, bearer), `server/src/oauth-pages.ts`
(consent and message pages), `server/src/mcp.ts`. Tests: `server/scripts/smoke-oauth.ts`
(59 checks), `server/scripts/smoke-mcp.ts` (18, the MCP SDK client doing the whole auth
dance itself), `cli/scripts/smoke-cli.ts` (27, the real `search` bin as a child process).

| Item | Decision |
|---|---|
| `@hono/mcp` | Used for request validation only: `authorizeHandler` (client, redirect URI with RFC 8252 loopback ports, S256, scope), `tokenHandler` (PKCE check, grant dispatch), `clientRegistrationHandler`. Not used: `mcpAuthRouter` (it compares `client_secret` in plain text against `getClient()`, so secrets would have to be stored in the clear; `/revoke` reads only JSON; metadata advertises only `client_secret_post`; the rate limiter needs `hono-rate-limiter`). Our own client authentication compares SHA-256 hashes in constant time, our `/revoke` takes a form or JSON, our metadata lists `none`. |
| Public clients | Checked and tested: `@hono/mcp`'s token path passes a client with no stored secret, and ours does too. DCR with `token_endpoint_auth_method: "none"` returns no secret. |
| Consent POST | `POST /oauth/consent`, not `POST /authorize` (that path belongs to `authorizeHandler`, which parses JSON). The form's `pending` must equal the httpOnly, SameSite=Lax `search_oauth_pending` cookie; a foreign `Origin` is refused. Actions: `allow` (the browser's signed-in user, straight to a code), `one` (302 to `/api/one/authorize?oauth=1`), `sample` (the shared Acme sample user, bootstrapped like `POST /sources/sample`, then a code), `deny` (`error=access_denied`). |
| Callback | `/api/one/callback` with a live pending cookie mints the code for the account `onConnected` returns (after the merge) and 302s to the client; a Connect outcome other than connected answers the client `error=access_denied`. A plain `/api/one/authorize` (no `oauth=1`) clears a stale pending cookie so an abandoned CLI login never hijacks a web sign-in. The browser's `search_sid` is signed in as well. |
| Codes and tokens | Opaque, prefixed: codes `sac_`, access `sat_` (1 h), refresh `srt_` (30 d); only SHA-256 stored. A code is burned by its first exchange that passes PKCE, even if the redirect URI then mismatches. Redirects carry `iss` (RFC 9207), the origin of the request's resource. |
| Refresh | Rotation under `select ... for update`: the old refresh row gets `replaced_by` and `revoked_at`. Presenting a rotated or revoked refresh token revokes every token of the family. A refresh may narrow scopes, never widen them. |
| Resources | Tokens are bound to their resource: `<origin>/mcp` tokens work only on `/mcp`, `<origin>/api/v1` tokens only on `/api/v1`; a token with no resource (or the bare origin) works on both. Origins are `SEARCH_PUBLIC_URL` plus `http://localhost:<port>` and `http://127.0.0.1:<port>`; metadata answers with the origin the request came in on. |
| Scopes | A request with no `scope` gets `search:read search:ask` for `/mcp` and all four for `/api/v1` (intersected with the client's registered scopes). DCR with no `scope` registers all four. `/mcp` metadata advertises only read and ask because SDK clients request whatever `scopes_supported` lists. |
| Redirect URIs | DCR accepts https, http on loopback only, and app schemes. |
| Bearer on REST | `Authorization: Bearer` on `/api/v1/*` sets the request's user, scopes and client id; no `search_sid` is minted. Errors: 401 `unauthorized` (unknown, revoked, wrong resource) or `token_expired`, with `WWW-Authenticate: Bearer ... resource_metadata=".../oauth-protected-resource/api/v1", error="invalid_token"`. Cookie-only routes answer 403 `forbidden`. |
| `GET /oauth-clients` | Every client this user has tokens from, active first. `scopes` are the latest grant's, `activeTokens` counts live refresh tokens (a sign-in). Revoked clients stay listed with `activeTokens: 0`; the UI shows them as Signed out with no Revoke. |
| MCP tools | Exactly section 11, plus annotations `readOnlyHint: true`. `search` text is a numbered list with ids; `get_entity` matches an exact email or domain key first, then a name substring; `ask` runs one chat turn with `context.query = query ?? question`. Errors are text with `isError` and no `structuredContent`. Transport: DNS rebinding protection on, allowed hosts the three origins. |
| Ledger actor | Done in Phase 4: `runChatTurn(ctx, userId, input, signal?, via?)` and `answerOnce(..., via?)` take `{ actor: "assistant" \| "mcp" \| "api", clientId }`. MCP `ask` logs as `mcp`, a bearer `/api/v1/chat` or `/answer` as `api`, each with the client id. |
| CLI | `cli/src/index.ts` (commands), `remote.ts` (token file, refresh once on 401 or within 30 s of expiry, exit codes), `login.ts`, `mcp-config.ts`. `search login` reuses the stored client id when the server still knows it (a `/token` probe answers `invalid_client` otherwise), registers "Search CLI on <host>" with redirect `http://127.0.0.1/callback`, and listens on a random 127.0.0.1 port. `SEARCH_SERVER` overrides the server; `search profiles validate` is offline static checks only (fixture runs stay `test:profiles`). `mcp-config --client claude-desktop` prints an `mcp-remote` bridge config. |


## 16. Phase 4 additions (2026-10-29)

| Item | Shape |
|---|---|
| `EntityDetail.merged` | `{ id, name, email, platforms, decidedBy: "jev" \| "user" \| "fixture" \| null, probability }[]`: people merged into this one by a match decision. Unmerge with `POST /entities/:id/unmerge` using that `id`. Email merges inside a run are not listed (nothing to undo). |
| `ChatVia` | Exported from core; see 15, Ledger actor. |

## 17. Actions in the ask (2026-10-29, after the first real sign-in)

Every profile calls the provider's own (native) actions. One's composite
actions, the `POST /v1/<platform>/get-*` family (Attio "Get and View
Companies/People/Deals", Gmail "List and View Email Threads"), are not used.

Why. On the first real grant (2026-10-29) One answered 403
`blockedByGrant` on all four composites, while `listConnections` showed the
grant as `policy: "actions"` with exactly those action ids in it. In the same
grant, native POST reads went through (Linear GraphQL, Notion search, Slack
`auth.test`, OpenAI embeddings, TypeSafe systemone), as did every GET.

- Verified on the real grant: the grant listed the composites and One still
  refused them; native POST and GET actions in the same Custom grant were
  allowed. So "One treats POST as a write" is not what happened under a
  Custom ask (it would matter under Read only: Connect's docs map Read only
  to `methods: ["GET"]`, `documentation/connect/management.mdx`).
- Inferred, not verified: a composite is One-served (its docs say it runs
  native calls itself, e.g. `get-companies` does one
  `POST /objects/companies/records/query`), and the grant check seems to
  apply to those inner native actions, which were not in the ask. Neither
  the Connect docs nor `@withone/connect` 0.19 say how composites are
  checked; the SDK reports a bare 403 as `blockedByGrant` when the consent
  still stands.

What replaced them:

| Profile | Was | Now |
|---|---|---|
| `attio.people`, `attio.companies`, `attio.deals` | POST `/v1/attio/get-{people,companies,deals}` | POST `/objects/{object}/records/query` (`conn_mod_def::GJ0CbN-LPiU::A6h6M9QkS0Cs2Lt9CdPH7Q`, Attio's only list endpoint for records; `object` is a path var; fields read from `values.<slug>[0]`) |
| `gmail.threads` | POST `/v1/gmail/get-threads` | GET `/gmail/v1/users/{userId}/threads` (`conn_mod_def::GJ3ok-Q0D40::oLWNlcx4QDORaL_18z-MsQ`) then hydrate GET `.../threads/{id}?format=full` (`conn_mod_def::GJ3ok0Eq0R8::AAzgZVLqTg2iBuITKpJLZg`), fingerprint `historyId`; bodies through the new `mime-body` decoder |

Rules that follow:
- `connect.manifest.json` entries carry `method` and `path`
  (`node packages/core/scripts/gen-manifest.mjs --fill` asks the One CLI for
  new ones). `test:profiles` fails on a missing method or a `/v1/<platform>/`
  composite.
- `ApiSource.actions` lists `{ actionId, method, path }`; the source screen
  says "All GET, read only." only when that is true, and otherwise names how
  many actions read with POST and that they must be in the ask by name.
- `AccessResponse` `granted` under a `methods` policy now checks the
  action's method against the granted methods (it was always true).
- The ask is still Custom per platform (`one.connect.ts`), so native POST
  reads (Attio records query, HubSpot and Intercom search, Linear GraphQL,
  Notion search, Slack `auth.test`) are granted by id. A user who narrows a
  platform to Read only keeps only its GET actions.
- `stripLarge` keeps the base64url body of MIME `text/*` parts (the message
  text), and still strips attachments.
