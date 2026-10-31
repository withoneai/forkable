# Search: build spec

Status: Phase 0 (2026-10-29). This file is authoritative. Where it differs
from the research in `docs/research/`, from `AGENTS.md` notes, or from any
plan page, this file wins. `docs/CONTRACT.md` holds the exact interfaces
between packages and must agree with this file; change both together.

Conventions in this file:

- `$RILL` means the Rill repo in this workspace (the sibling directory that
  still carries Rill's pre-rename directory name). Paths under it are code to
  port, not code to import.
- **V** = verified by reading the action's docs in `docs/research/one-actions.md`.
  **I** = inferred, not confirmed by a loaded doc.
- **fixture-verified** = proven by tests on fixtures shaped from documented
  responses. **real-grant-verified** = proven against a signed-in user's real
  Connect grant. Nothing in this spec is real-grant-verified on 2026-10-29.
  Every built-in profile ships with `verified: "fixture"` until a live run.

---

## 1. Product

Search is a personal search app. It indexes whatever the user connects through
One, keeps a hybrid keyword and semantic index in Postgres, and docks an AI on
the right that reasons over the results, cites them and proposes better
queries. It is a Forkable business: fork it, run it, own it.

| Line | What |
|---|---|
| Who uses it | One person searching their own tools. Personal index only: each user indexes their own grant, nothing is shared between users. |
| Who forks it | Builders. A product company embedding search over its users' tools, or someone building an internal tool where each teammate connects their own accounts. |
| Built-in sources | HubSpot, Attio, Gmail, Outlook Mail, Google Calendar, Outlook Calendar, Notion, Linear, Slack, Teams, Granola (11). |
| Any other source | Settings, Integrations, New profile: pick a platform from One's catalog, an LLM on the grant proposes a mapping profile, the user confirms, indexing starts. A new integration is a profile, never code. |
| Search | Postgres full text plus pgvector, fused with Reciprocal Rank Fusion, filtered by operators, reranked by Jev. Keyword-only when pgvector is not available, with a clear note. |
| AI | Chat dock on the right. Grounded only in items Search returned, every claim cited, proposes query refinements as chips. Runs on the grant (Anthropic through One). |
| Surfaces | Web UI, CLI (`search`), REST API with OAuth, MCP server with OAuth. Sign in with One behind every login. |
| Sample | Acme Inc, keyless. `pnpm start` indexes an Acme world across all 11 sources and exits 0. |
| License | MIT. |
| Copy order (Forkable rule) | 1. Fork a whole working search business. 2. Its integrations and Sign in with One come built in. 3. One line: Secured by One. |

### 1.1 Copy rules that apply to every file in this repo

From `AGENTS.md`: no em or en dashes; no colons in published headlines; banned
words (the list in `AGENTS.md`, Writing rules); no exclamation marks; never
name competitors or any name `AGENTS.md` retires; never type a platform or tool
count (fetch `api.withone.ai/open/count/*`); the consent flow is three steps;
the only company is Acme Inc; the old names of the sibling apps never appear
in new files (the siblings are Rill, Brief, Lead). Use the `humanize` skill
as the final pass on any user-facing copy.

---

## 2. Decisions

The owner's brief (2026-10-29) is the source for D1 to D20. D21 onward are decisions
this spec had to make; they are flagged in the build summary and can be
reversed in this file.

| # | Decision | Source |
|---|---|---|
| D1 | Built like Rill: `packages/core` + Hono `server` + Vite React `ui` + `cli`, pnpm workspace, Node 22, ESM, TypeScript strict. Keyboard-first, Cmd+K, light and dark, Access and Settings, write-only `/setup/connect`. | brief |
| D2 | Personal index. Every platform call runs on the signed-in user's Connect grant: sync, Jev, LLMs and embeddings. No `ONE_SECRET`, no connection keys, no provider keys in `.env`. | brief, AGENTS.md |
| D3 | Drizzle over Postgres. Embedded Postgres locally (data dir `~/.search/db`, port 55441), or any connection string in `SEARCH_DATABASE_URL`. Supabase must work. | brief |
| D4 | pgvector: we ship our own build. Darwin universal dylib built against PG 18.4 headers, committed in `packages/pgvector/` with a reproducible build script. Linux from PGDG prebuilt `.deb`s (extracted by script, checksummed) or the build script. Loaded with `extension_control_path` + `dynamic_library_path` on every boot. Capability check at boot. Keyword-only fallback with a Settings note. | brief, pgvector-embedded.md |
| D5 | Embeddings through One on the grant. Default OpenAI `text-embedding-3-small`; Gemini, Cohere, Mistral selectable. One model per index, recorded on every vector. Sample mode uses a local deterministic embedder, labelled as such everywhere it shows. | brief |
| D6 | 11 built-in profiles in `profiles/` using the action ids in `one-actions.md`. | brief |
| D7 | Cross-source object types: person, company, email thread, event, doc, task/issue, message, meeting note, deal, note (plus `record` for generic profiles). | brief |
| D8 | Records merge into entities (people, companies) by email and domain, plus a Jev match check for everything else. | brief |
| D9 | New profile flow (the most important feature): catalog from public `/v1/available-connectors`, actions and docs via the grant (`listActions`, `getActionKnowledge` with `ioSchema`), an LLM proposes the map, the user confirms models, schedule, id field, included data and link template, save, indexing starts automatically. | brief |
| D10 | Profiles live in Postgres with versions and the three-hash scheme from `cli-sync-study.md` §4.5. One declarative format, one engine. Incremental cursors, retries, rate-limit backoff, deletes and tombstones, per-source health, re-index on map change, Jev classification and reranking. | brief |
| D11 | Profiles are shareable: built-ins in the repo, user profiles export and import as a file and by URL, contributable by PR. A skill `.claude/skills/add-search-profile/` lets a coding agent add a built-in profile end to end. | brief |
| D12 | Search UX per `search-ux-mobbin.md` Part 2: source logos from `https://assets.withone.ai/connectors/<platform>.svg`, rich rows and preview per type, filters by source, type, person and date with operators, instant results, keyboard, AI chat docked right. | brief |
| D13 | Surfaces: web UI, CLI, REST API with OAuth, MCP with OAuth. The MCP is the local Node and Hono equivalent of the blocks MCP: `@hono/mcp` + `@modelcontextprotocol/sdk`, DCR + PKCE, Postgres token tables. | brief |
| D14 | Logo: an S in the Forkable letter system, made in the Forkable brand system (`design/brand/search/` in the Forkable repo). A placeholder S until then. | brief |
| D15 | Ports: UI 5680, server 52289 (Connect redirect `http://localhost:52289/api/one/callback`), embedded Postgres 55441, landing site 5690. Data dir `~/.search`. Env prefix `SEARCH_`. | brief |
| D16 | Packages `@search/core`, `@search/server`, `@search/ui`; CLI `@withone/search` with bin `search`. MIT. | brief |
| D17 | Slack's 2025 non-Marketplace limit is designed in (§7.6). | brief |
| D18 | Everything not run on a real grant is labelled fixture-verified. | brief |
| D19 | Forkable contract files plus `one.connect.ts` and `pnpm connect`. | brief |
| D20 | Phases 0 to 5 as in §19. | brief |
| D21 | Server port is **52289** as the brief set. | spec |
| D22 | **pgvector 0.8.7 everywhere** (PGDG's current Linux build and PGlite's). The spike verified the darwin recipe with 0.8.2; Phase 1 rebuilds the dylib at 0.8.7 with the same script and re-runs the spike SQL. | spec |
| D23 | **One vector width: `vector(1536)`.** Every model is asked for 1536 dims where it can shrink (OpenAI `dimensions`, Gemini `outputDimensionality`, Cohere `output_dimension`). Mistral (1024) is zero-padded to 1536, which leaves cosine similarity unchanged. One HNSW index, no per-model tables. | spec |
| D24 | **The profile proposal is written by Claude Haiku** (`claude-haiku-5-5`, Anthropic through One on the grant). Jev is a judgment model and is not asked to write maps. When Anthropic is not in the grant, the proposal falls back to the deterministic inference in §10.4 (labelled "Suggested by rules"). | spec |
| D25 | **Chat and query answers use `claude-sonnet-5-5` through One on the grant.** No local coding-agent engine in v1 (Rill's local CLI writer is not ported). Model id overridable in Settings. | spec |
| D26 | **Platforms outside the Connect app's permission set**: on Save the New profile flow writes the exact action ids its profiles call to `connect.extra.json` at the repo root (2026-10-29; read-only for a whole platform before that), `one.connect.ts` merges them into the platform's custom ask (a platform that already has a built-in pack included), sources whose actions are not granted yet wait as `awaiting_grant`, the setup screen offers "Update the Connect app", then the user signs in again to grant it. Untested against One; listed as a risk. | spec |
| D27 | **A source is one profile on one connection** (`sources` row per user x connection x profile). The UI groups sources by platform and connection. | spec |
| D28 | **Profile format extends the research format** with `partitions` (fan-out over channels, calendars, chats), descending watermarks, `groupKey`, `join`/`count`/`test` expressions, `limits.perAction`, `settings` (user-tunable knobs) and `verified`. | spec |
| D29 | **Chat streams steps, not tokens.** `runAction` returns a whole response, so SSE carries step, results, answer, proposal and done events; the answer arrives whole. If One's passthrough gains streaming, add a `delta` event. | spec |
| D30 | **Rerank is a second request.** `GET /search` answers from RRF at once; the UI then calls `POST /search/rerank`, and applies the new order only when the user has not moved the selection. | spec |
| D31 | **Lanes** (Jev): `vip`, `needs_you`, `waiting`, `fyi`, `low`, shown as VIPs, Needs you, Waiting, FYI, Low. Filter with `lane:`. | spec |
| D32 | **Sample new-profile flow** uses a fixture catalog entry for `zendesk` (real catalog slug, fixture actions). Fixture action ids are prefixed `sample::` and the engine refuses them outside sample mode, so they can never reach a live grant or an export. | spec |
| D33 | **CLI talks to the REST API with OAuth** (`search login`: DCR as a public client, PKCE, loopback redirect on a random 127.0.0.1 port per RFC 8252). `search demo` alone runs in process with no server. | spec |
| D34 | **MCP tool names `search` and `fetch`** match what chat hosts expect for retrieval connectors, plus `get_entity`, `list_sources`, `ask`. Read-only. | spec |
| D35 | **Forkable brand palette**, not Rill's blue: lime `#CCED73` as fill with black ink, never on white; light `#fbfdfc` with `#809d08` as the free-standing green; dark near black (`#0a0a0a`, cards `#161616`). | spec, AGENTS.md brand |
| D36 | **Acme world characters follow the landing page** (`site/src/lib/sample.ts`): the user is Dana Oyelaran, Head of Sales at Acme Inc; Priya Shah at Globex; Mia Park and Theo Lund on Acme's team. | spec |
| D37 | **Gmail built-in uses the native list threads plus per-thread get** (changed 2026-10-29). It first used One's composite `get-threads`, but on the first real grant One answered 403 `blockedByGrant` on every composite `/v1/<platform>/get-*` action although the grant listed them (CONTRACT 17). The hydrate is skipped for threads whose `historyId` did not change. History-based delta is a later upgrade. | spec |
| D38 | **Teams channel messages ship off by default** (admin consent `ChannelMessage.Read.All` in most tenants). Teams chats ship on. | spec |
| D39 | **Granola transcripts off by default**; summary and attendees always. A profile setting turns transcripts on. | spec |
| D40 | **HubSpot and Slack link templates need account vars whose action ids are not yet found** (HubSpot account details for `portalId`, Slack `auth.test` for the team domain). Phase 1 finds and documents them; the validator refuses `TBD:` ids in shipped built-ins, so Phase 1 cannot finish without them. Until found, the link falls back to the record URL the API returns, else none. | spec |
| D41 | **The semantic arm says when it is off.** A failed query embedding returns `embedder.semantic: false` with `reason` (`not_in_grant`, `error`, `keyword_mode`, `sample`) and a message; the last outcome per user (queries and the embed worker) feeds `GET /sources` (`semantic`, and the banner when no source is worse). A CLI or MCP sign-in that lands on an existing account keeps that account's stored Connect reference; only a web sign-in replaces it. | real-data review, 2026-10-30 |
| D42 | **Exact matches go first.** A query that is an email, a domain, an external id or a whole entity name puts that record ahead of RRF (`ResultRow.exact`). An exact title, or the query as a phrase in a title, adds one rank-1 hit to the RRF sum. | real-data review, 2026-10-30 |
| D43 | **One row per human.** On text queries, records linked `is` to one entity fold into the best one, the other platforms in `alsoIn`. A person or company record nothing else mentions weighs 0.6. A profile's `is.allEmails` makes each of a record's 2 to 5 addresses a merge key (Attio people). When every word together finds nothing, a 1 to 3 word text gets the closest entity name by trigram (`didYouMean`). | real-data review, 2026-10-30 |
| D44 | **Zero results fall back to any word**, said in `fallback: "or"`, when no semantic arm can stand in. Plain dates in the text ("last month", "in October", "this week") come back as `dateProposals`, chips that rewrite the query into `after:`/`before:`. | real-data review, 2026-10-30 |
| D45 | **Dates are when things happened.** occurredAt falls back to the profile's updatedAt, then the record's own modified/updated/created keys, then the day Search first saw it (kept, never the fetch time, never hashed). Nothing more than two years out; an event that far out is not indexed. Google Calendar expands a year ahead (`timeMax`, filter `plus:`). Normalize version 2 re-maps every source once from raw payloads. | real-data review, 2026-10-30 |
| D46 | **One source per account, named by its address.** An account call that learns an address relabels its connection's sources when One titled them with the platform name. The scheduler attaches connections that joined a grant every 10 minutes, and never adds a built-in where the user's own profile already calls the same list action. | real-data review, 2026-10-30 |
| D47 | **Never pay twice for one search.** The browser keeps the last 20 result pages (results, Jev order, answer) per user for 30 minutes and renders them with no call, says so ("Saved results from 4 min ago", Refresh `⇧ R`), and quietly reruns only the cheap search to offer "N new results" without moving the list. The server keeps Jev rerank scores in Postgres per user, query and item until the item changes, keeps a late Jev answer, and runs one call per missing set. Refresh skips every cache. AI answers are not stored on the server. | real-data review, 2026-10-30 |

---

## 3. Architecture and repo layout

```
search/
  AGENTS.md  CLAUDE.md (= @AGENTS.md)  README.md  LICENSE (MIT)
  package.json  pnpm-workspace.yaml  tsconfig.base.json  .env.example
  forkable.json  connect.manifest.json  one.connect.ts  connect.extra.json
  scripts/connect.mjs            pnpm connect (one --agent connect create)
  agents/indexer.md  agents/assistant.md
  local/profile.md
  gtm/positioning.md  gtm/skills/*.md  gtm/out/ (gitignored drafts)
  forkable/welcome.mjs
  profiles/                      built-in profile packs, one dir per platform
    schema/profile-1.json        JSON Schema, generated from the zod schema
    hubspot/pack.json  attio/pack.json  gmail/pack.json  outlook-mail/pack.json
    google-calendar/pack.json  outlook-calendar/pack.json  notion/pack.json
    linear/pack.json  slack/pack.json  teams/pack.json  granola/pack.json
  fixtures/sample/               Acme world (shaped from documented responses)
    world.md                     the cast and storylines (human readable)
    <platform>/<model>.pages.json   list pages as the API documents them
    <platform>/<model>.details.json hydrate and children answers by id
    <platform>/account.json      account var answers
    judgments.json  matches.json  chat.json  rerank.json
    catalog/platforms.json  catalog/actions/<platform>.json  catalog/knowledge/<id>.json
    proposals/zendesk.tickets.json
  packages/core/                 @search/core
  packages/pgvector/             @search/pgvector (committed binaries + build scripts)
  server/                        @search/server
  ui/                            @search/ui
  cli/                           @withone/search (bin search)
  site/                          landing page (exists, port 5690, not deployed)
  docs/SPEC.md  docs/CONTRACT.md  docs/research/  docs/qa/  docs/profiles.md
  .claude/skills/add-search-profile/SKILL.md
```

| Package / dir | Owner (who builds it) | Job |
|---|---|---|
| `packages/core` | core agent | Domain types, Drizzle schema and migrations, `one.call`, profile schema and engine, decoders, entity resolution, chunker, embedders, hybrid search, query parser, Jev classification and rerank, chat orchestration, proposal (mapper), sample world loader. No HTTP. |
| `packages/pgvector` | core agent | Committed pgvector builds per platform, build scripts, `SHA256SUMS`, `resolvePgvector()`. |
| `server` | server agent | Boot (embedded Postgres + pgvector flags), Hono app, REST routes, SSE, sessions, Connect sign-in, setup store, scheduler and workers, OAuth authorization server, MCP endpoint. |
| `ui` | UI agent | Vite + React 19 + Tailwind 4 app: search, results, preview, chat dock, palette, Settings (Integrations, New profile sheet, source detail), Access, setup, sign-in. |
| `cli` | server agent | `search` bin: start, demo, login, query, ask, sources, profiles, mcp-config. |
| `profiles/` | core agent, then contributors | Built-in packs. |
| `fixtures/sample` | core agent | The Acme world. |
| `site/` | landing chat | Already built; not part of this spec beyond port 5690. |
| `.claude/skills/add-search-profile` | Phase 5 | Agent recipe for a new built-in. |

Runtime picture (local):

```
browser (5680 dev / 52289 prod) ──REST + SSE──> server :52289 ──> Postgres :55441 (embedded) or SEARCH_DATABASE_URL
CLI ──OAuth bearer──> server :52289                              │
MCP host ──OAuth bearer──> server :52289/mcp                      └─ pgvector from ~/.search/pg-ext/vector-0.8.7-pg18
server scheduler (in process) ──one.call──> @withone/connect runAction (user's grant) ──> One ──> provider
```

---

## 4. Data model

Drizzle `pgTable`s in `packages/core/src/db/schema.ts`. Text ids from
`newId(prefix)` (`usr_`, `src_`, `prf_`, `pfv_`, `run_`, `raw_`, `itm_`, `chk_`,
`ent_`, `chat_`, `msg_`, `led_`, `drf_`). Timestamps `timestamptz`. JSONB
columns are typed with `$type<T>()` from `types.ts`. Vector objects live in a
second file, `schema-vector.ts`, applied by `ensureVectorSchema()` only when
the capability check passes (§4.13); drizzle-kit never generates them.

### 4.1 Identity and settings

| Table | Columns |
|---|---|
| `users` | `id` pk, `name`, `email`, `one_user_id`, `avatar_url`, `is_sample` bool, `created_at` |
| `sessions` | `sid` pk, `user_id` fk, `created_at`, `last_seen_at` |
| `connect_users` | `user_id` pk fk, `reference` (as given by the package), `connect_user_id` (`cu_`, indexed), `updated_at` |
| `settings` | `user_id` pk fk, `data` jsonb `SettingsData`, `updated_at` |
| `saved_searches` | `id` pk, `user_id`, `name`, `query`, `position` int, `created_at` |
| `recent_searches` | `id` pk, `user_id`, `query`, `result_count`, `at` (keep last 50 per user) |
| `rerank_scores` | pk (`user_id`, `query` normalized, `item_id`), `content_hash` (hash of the candidate Jev read plus the Jev model), `score` 0..3, `at` (D47) |
| `self_addresses` | `user_id`, `kind` (`email`\|`domain`\|`ext`), `value`, `source_id` null; pk (`user_id`,`kind`,`value`). The user's own addresses from every connection (Gmail profile, Graph `/me`, Slack self). |

`SettingsData`: `{ embedding: { provider, model, dims: 1536 }, rerank: boolean, engine: "auto"|"claude-code"|"codex"|"one", chatModel, proposalModel, localChatModel, localProposalModel, jevModel, backfillDefault: "30d"|"365d"|"all", slackTier: "limited"|"marketplace", vipEntityIds: string[], paused: boolean, lanesOn: boolean }`.

### 4.2 Profiles

| Table | Columns |
|---|---|
| `profiles` | `id` pk, `user_id` null (null = built-in, shared by all users), `slug` (`gmail.threads`), `platform`, `model`, `origin` (`builtin`\|`user`\|`import`\|`url`), `origin_url` null, `current_version_id` fk, `created_at`, `updated_at`. Unique (`user_id`, `slug`) nulls not distinct. |
| `profile_versions` | `id` pk, `profile_id` fk, `version` int, `json` jsonb `SearchProfile`, `fetch_hash`, `map_hash`, `index_hash`, `profile_hash`, `created_by` (`builtin`\|user id), `note`, `created_at`. Unique (`profile_id`,`version`). |
| `profile_drafts` | `id` pk, `user_id`, `platform`, `step` (`platform`\|`models`\|`fields`\|`identity`\|`review`), `input` jsonb (chosen actions, samples), `proposal` jsonb `ProposalOutput`, `edits` jsonb, `validation` jsonb `ValidationReport`, `model` (LLM id or `rules`), `status` (`open`\|`saved`\|`discarded`), `created_at`, `updated_at` |

Built-ins are upserted from `profiles/*/pack.json` at boot; a changed
`profile_hash` makes a new version and marks sources on the old one
"Update available" (they move only when the user accepts, or automatically
when `SEARCH_AUTO_UPDATE_BUILTINS=1`).

### 4.3 Sources, cursors, runs

| Table | Columns |
|---|---|
| `sources` | `id` pk, `user_id`, `platform`, `connection_key` (from `listConnections`; an identifier, not a secret), `connection_label` ("dana@acme.com"), `profile_id` fk, `profile_version_id` fk, `fetch_hash`, `map_hash`, `index_hash` (as applied), `mode` (`fixture`\|`connect`), `status` (`healthy`\|`syncing`\|`degraded`\|`rate_limited`\|`auth_needed`\|`grant_blocked`\|`paused`\|`error`\|`new`), `account_vars` jsonb, `settings` jsonb (profile knobs), `schedule_every` (ms), `next_run_at`, `last_attempt_at`, `last_success_at`, `last_full_pass_at`, `consecutive_failures` int, `retry_at` null, `last_error` jsonb `SourceError`, `item_count` int, `created_at`. Unique (`user_id`,`connection_key`,`profile_id`). |
| `source_cursors` | `source_id`, `partition_key` (`""` when unpartitioned, else e.g. `C024BE91L`), `watermark` text, `delta_token` text, `page_cursor` jsonb, `pending_watermark` text, `last_full_pass_at`, `updated_at`; pk (`source_id`,`partition_key`) |
| `runs` | `id` pk, `source_id`, `trigger` (`schedule`\|`manual`\|`first`\|`remap`\|`reindex`\|`resume`), `full_pass` bool, `started_at`, `finished_at`, `outcome` (`ok`\|`partial`\|`failed`\|`rate_limited`\|`auth_needed`\|`grant_blocked`\|`cancelled`\|`running`), `pages`, `fetched`, `hydrated`, `upserted`, `unchanged`, `tombstoned`, `skipped`, `calls`, `retries`, `http_status`, `retry_after_at`, `error` jsonb |
| `item_errors` | `source_id`, `external_id`, `stage` (`hydrate`\|`normalize`\|`embed`\|`classify`), `code`, `message` (500 chars max), `attempts`, `last_at`; pk (`source_id`,`external_id`,`stage`) |

### 4.4 Raw and normalized items

| Table | Columns |
|---|---|
| `raw_items` | `id` pk, `source_id`, `external_id`, `partition_key`, `item` jsonb, `detail` jsonb null, `children` jsonb null, `fingerprint` text null, `fetch_hash`, `fetched_at`, `deleted_at` null. Unique (`source_id`,`external_id`). Strings over 256 KB and base64 attachment bodies are stripped before insert. |
| `items` | `id` pk, `user_id`, `source_id`, `raw_item_id` fk, `external_id`, `platform`, `kind` (`ItemKind`), `title`, `body` (plain text, capped 200,000 chars), `snippet`, `url` null, `container` null, `group_key` null, `status` null, `labels` text[], `facets` jsonb (`ItemFacets` per kind), `occurred_at`, `updated_at`, `deleted_at` null, `map_hash`, `body_hash`, `importance` real null, `lane` null, `indexed_at`, `tsv` tsvector generated: `setweight(to_tsvector('simple', unaccent(title)),'A') || setweight(to_tsvector('english', coalesce(container,'') || ' ' || array_to_string(labels,' ')),'C') || setweight(to_tsvector('english', left(body,100000)),'B')`. Unique (`source_id`,`external_id`). Indexes: GIN(`tsv`), btree (`user_id`,`kind`,`occurred_at` desc), (`user_id`,`platform`), GIN(`labels`), GIN(`facets` jsonb_path_ops), GIN trigram on `title` (pg_trgm, for typo-tolerant title match). |
| `chunks` | `id` pk, `item_id` fk cascade, `user_id`, `ord` int, `text`, `text_hash` (sha256 of header + text), `tokens` int, `tsv` generated `to_tsvector('english', text)`. GIN(`tsv`), unique (`item_id`,`ord`). |

`unaccent` in a generated column needs an immutable wrapper; core ships
`search_unaccent(text)` as an `IMMUTABLE` SQL function in migration 0000.
When `unaccent` is not installable (some external databases), migration 0000
defines `search_unaccent` as identity.

### 4.5 Entities

| Table | Columns |
|---|---|
| `entities` | `id` pk, `user_id`, `type` (`person`\|`company`), `name`, `primary_email` null, `domain` null, `title` null, `company_id` null fk (people), `avatar_url` null, `is_self` bool, `merged_into_id` null, `attributes` jsonb, `item_count` int, `first_seen_at`, `last_seen_at`, `tsv` generated over name + primary_email + domain |
| `entity_keys` | `entity_id`, `user_id`, `key` (`email:priya@globex.com`, `domain:globex.com`, `ext:slack:U02ABC`, `ext:hubspot:contact:901`, `name:priya shah`), `source_id` null, `created_at`; unique (`user_id`,`key`) for every prefix except `name:` |
| `entity_links` | `item_id`, `entity_id`, `role` (`is`\|`from`\|`to`\|`cc`\|`attendee`\|`organizer`\|`owner`\|`assignee`\|`author`\|`mentioned`\|`about`), `source_id`; pk (`item_id`,`entity_id`,`role`) |
| `entity_matches` | `id` pk, `user_id`, `a_id`, `b_id`, `reason` (`name_same_company`\|`name_only`\|`ext_id_name`), `probability` real, `status` (`pending`\|`merged`\|`rejected`), `decided_by` (`jev`\|`user`\|`fixture`), `created_at`, `decided_at` |

### 4.6 Classifications

| Table | Columns |
|---|---|
| `classifications` | `item_id` fk, `user_id`, `question_set` (`item-v1` or a profile classify key), `body_hash`, `model` (`jev-latest`\|`fixture`\|`rules`), `answers` jsonb (raw Jev answers), `kind_guess`, `importance` real (0..1), `lane`, `needs_you` real, `judged_at`; pk (`item_id`,`question_set`) |

### 4.7 Embeddings (vector schema, gated)

| Table | Columns |
|---|---|
| `chunk_embeddings` | `chunk_id` pk fk cascade, `user_id`, `model` (`openai:text-embedding-3-small@1536`), `embedding` vector(1536), `created_at`. HNSW (`embedding` vector_cosine_ops) with `m = 16, ef_construction = 64`; btree (`user_id`,`model`). |
| `embedding_cache` | `text_hash`, `model`, `embedding` vector(1536), `created_at`; pk (`text_hash`,`model`) |
| `pending_embeddings` | `chunk_id` pk, `user_id`, `model`, `attempts`, `next_at` (plain table, lives in the main schema so the queue works before the capability flips) |

### 4.8 Chat

| Table | Columns |
|---|---|
| `chats` | `id` pk, `user_id`, `title`, `created_at`, `updated_at` |
| `chat_messages` | `id` pk, `chat_id`, `role` (`user`\|`assistant`), `content`, `context` jsonb (`ChatContext`), `citations` jsonb `Citation[]`, `steps` jsonb `ChatStep[]`, `proposal` jsonb null `QueryProposal`, `followups` text[], `model`, `grounded` bool, `created_at` |

### 4.9 OAuth (authorization server for REST, CLI, MCP)

| Table | Columns |
|---|---|
| `oauth_clients` | `client_id` pk, `client_secret_hash` null, `client_name`, `redirect_uris` jsonb, `token_endpoint_auth_method`, `grant_types` jsonb, `scope`, `metadata` jsonb, `created_at`, `last_used_at` |
| `oauth_pending` | `id` pk, `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method` (`S256` only), `scopes` jsonb, `resource`, `created_at`, `expires_at` (10 min) |
| `oauth_codes` | `code_hash` pk, `client_id`, `user_id`, `redirect_uri`, `code_challenge`, `scopes` jsonb, `resource`, `expires_at` (60 s), `used_at` |
| `oauth_tokens` | `token_hash` pk, `kind` (`access`\|`refresh`), `client_id`, `user_id`, `family_id`, `scopes` jsonb, `resource`, `expires_at`, `revoked_at`, `replaced_by`, `created_at`, `last_used_at`; index (`user_id`), (`family_id`) |

Every secret is stored as SHA-256 and compared in constant time. Access 1 h,
refresh 30 days rotated on use; reusing a rotated refresh token revokes the
family.

### 4.10 Ledger (Activity)

`ledger`: `id` pk, `user_id`, `source_id` null, `actor` (`indexer`\|`assistant`\|`mapper`\|`classifier`\|`embedder`\|`user`\|`api`\|`mcp`), `client_id` null, `platform`, `action` (short name), `action_id`, `method`, `path`, `mode` (`fixture`\|`connect`), `level` (`read`\|`write`), `status` int, `ok`, `blocked_by_grant`, `refusal`, `ms`, `summary`, `note`, `at`. One row per `one.call`, written by `one.call` itself. Indexer page calls are rolled up: a run writes one ledger row per distinct action per run with a `calls` count in `note` (so a 900-page Slack backfill is not 900 rows); every assistant, mapper and API call is its own row.

### 4.11 Catalog cache

`catalog_cache`: `key` pk (`platforms`, `actions:<platform>`, `knowledge:<actionId>`), `data` jsonb, `etag` null, `fetched_at`. Platforms 24 h, actions 6 h, knowledge 24 h.

### 4.12 Migrations

drizzle-kit output in `packages/core/src/db/migrations/` (`pnpm db:generate`).
Migration 0000 creates extensions it can (`pg_trgm`, `unaccent`, both in the
embedded bundle) inside a `DO` block that tolerates permission errors.

### 4.13 Capability (pgvector) and the vector schema

`ensureVectorSchema(db, cap)` runs after drizzle migrations when
`cap.mode === "hybrid"`: `create extension if not exists vector` (with
`schema extensions` when that schema exists), the three vector tables,
the HNSW index, `set hnsw.iterative_scan = relaxed_order` per connection.
Idempotent. When the capability later turns on, a backfill enqueues every
chunk into `pending_embeddings`.

---

## 5. The profile format

Full types are in `CONTRACT.md` §4 (`SearchProfile`). This section explains the
rules and gives three full examples.

### 5.1 Rules

1. One engine, one declarative format for built-ins and user profiles. No
   per-platform code except named decoders (pure functions).
2. One path grammar everywhere (the CLI's `resolveIdentityPath` superset):
   `a.b`, `a.0`, `a[0]`, `a[-1]`, `a[]`, `a[name=From]`, `a["key.with.dots"]`;
   `[]` and `[k=v]` also iterate an object's values (section 21).
3. One template syntax: `{{ expr | filter:arg }}`. Filters are a closed list:
   `iso`, `unix`, `unixms`, `date:"yyyy-MM-dd"`, `lower`, `upper`, `email`,
   `domain`, `urlencode`, `json`, `join:","`, `first`, `last`, `default:"x"`,
   `slackts` (`1730000000.123456` to `p1730000000123456`).
4. Predicates (`keep`, `deletes.when`, `classify.when`, `children.when`,
   `{ test }`) use a small expression language: `== != > >= < <= && || ! in`,
   `len(x)`, `contains(x, y)`, path operands, string and number literals,
   `now - 30d`. Parsed by a real parser; never `eval`.
5. Raw payloads (`item`, `detail`, `children`) are stored as fetched, so a map
   change re-runs from storage with no API calls.
6. Profiles name `actionId`s only. Never keys, never secrets. The connection is
   bound late from the grant by platform.
7. `sample::` action ids run only in fixture mode.

### 5.2 Template context

| Name | Meaning |
|---|---|
| `item` | the list element |
| `detail` | hydrate result |
| `children.<as>` | child fetch results (arrays) |
| `partition` | the partition element (channel, calendar, chat) and `partition.parent` for nested ones |
| `unit` | current chunk unit (message strategy) |
| `doc` | already-mapped fields (only in `url`, `chunk.header`, `classify`) |
| `cursor.watermark`, `cursor.token` | committed cursor for this partition |
| `run.since`, `run.until`, `run.now`, `run.full` | `since` = watermark minus overlap, or `now - initial`, or epoch for `initial: "all"` |
| `account.<var>` | per-connection vars from `account` |
| `settings.<key>` | per-source knobs from `profile.settings` |

### 5.3 Example: Gmail threads (built-in, fixture-verified)

```json
{
  "$schema": "https://search.forkable.dev/schema/profile-1.json",
  "id": "gmail.threads",
  "platform": "gmail",
  "model": "threads",
  "kind": "email_thread",
  "title": "Gmail threads",
  "description": "Every thread outside spam, trash and chats, with decoded bodies.",
  "author": "builtin",
  "revision": 1,
  "verified": "fixture",
  "account": {
    "request": { "actionId": "conn_mod_def::GJ3oa8bJZNA::ZS9kXmE_Rzi4utfESor_ng", "pathVars": { "userId": "me" } },
    "vars": { "email": "emailAddress" },
    "self": [{ "kind": "email", "var": "email" }]
  },
  "settings": {
    "backfill": { "type": "duration", "default": "365d", "label": "How far back" },
    "query": { "type": "string", "default": "-in:chats -in:spam -in:trash -in:drafts", "label": "Gmail filter" }
  },
  "list": {
    "actionId": "conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ",
    "body": {
      "query": "after:{{ run.since | unix }} {{ settings.query }}",
      "format": "full",
      "maxBodyLength": 8000
    },
    "resultsPath": "threads",
    "idPath": "id",
    "pagination": { "type": "cursor", "next": "nextPageToken", "passAs": "body:pageToken" },
    "pageSize": { "param": "numberOfThreads", "value": 50, "in": "body" }
  },
  "incremental": { "strategy": "watermark", "field": "item.messages[-1].time", "overlap": "1h", "initial": "{{ settings.backfill }}" },
  "deletes": { "reconcile": "onFullPass", "fullPassEvery": "14d" },
  "fields": {
    "title": { "coalesce": ["item.messages[0].subject", { "template": "(no subject)" }] },
    "body": { "path": "item.messages[].body", "pick": "join", "sep": "\n\n", "decode": "mail-strip" },
    "snippet": "item.snippet",
    "occurredAt": { "path": "item.messages[0].time", "decode": "datetime" },
    "updatedAt": { "path": "item.messages[-1].time", "decode": "datetime" },
    "url": "https://mail.google.com/mail/u/?authuser={{ account.email | urlencode }}#all/{{ item.id }}",
    "groupKey": "item.id",
    "labels": { "path": "item.messages[].labelIds[]", "pick": "all" },
    "facets": {
      "messageCount": { "path": "item.messages", "pick": "count" },
      "unread": { "test": "contains(item.messages[].labelIds[], 'UNREAD')" },
      "hasAttachment": { "test": "len(item.messages[].attachments[]) > 0" },
      "lastFrom": { "path": "item.messages[-1].sender", "decode": "email" }
    }
  },
  "entities": {
    "refs": [
      { "role": "from", "type": "person", "address": { "path": "item.messages[].sender", "pick": "all" } },
      { "role": "to", "type": "person", "address": { "path": "item.messages[].receiver", "pick": "all" } }
    ]
  },
  "chunk": {
    "strategy": "message",
    "unit": "item.messages[]",
    "unitBody": { "path": "body", "decode": "mail-strip" },
    "header": "{{ doc.title }} | {{ unit.sender }} | {{ unit.time | date:\"yyyy-MM-dd\" }}",
    "maxTokens": 400,
    "overlapTokens": 40
  },
  "limits": { "requestsPerMinute": 120 },
  "schedule": { "every": "5m" }
}
```

Notes: superseded 2026-10-29 (D37, CONTRACT 17). The example above is the
first version on One's composite `get-threads`, which a real grant refused
with 403. The built-in now lists with the native List Threads (GET, `q`,
`pageToken`, `maxResults` in the query), hydrates each changed thread with Get
Thread (`format=full`, fingerprint `{{ item.historyId }}`), reads subject,
From, To and Cc from `detail.messages[].payload.headers[name=...]`, dates from
`internalDate`, and bodies with the `mime-body` decoder. `profiles/gmail/pack.json`
is the source. The `u/?authuser=` link form is I.

### 5.4 Example: HubSpot contacts (built-in, fixture-verified)

```json
{
  "$schema": "https://search.forkable.dev/schema/profile-1.json",
  "id": "hubspot.contacts",
  "platform": "hubspot",
  "model": "contacts",
  "kind": "person",
  "title": "HubSpot contacts",
  "author": "builtin",
  "revision": 1,
  "verified": "fixture",
  "account": {
    "request": { "actionId": "TBD:hubspot.account-details" },
    "vars": { "portalId": "portalId" },
    "optional": true
  },
  "list": {
    "actionId": "conn_mod_def::GJ3kSC2Sp7I::L6cYnwOfTUatg0cXeWjCBA",
    "body": {
      "filterGroups": [{ "filters": [{ "propertyName": "lastmodifieddate", "operator": "GTE", "value": "{{ run.since | unixms }}" }] }],
      "sorts": [{ "propertyName": "lastmodifieddate", "direction": "ASCENDING" }],
      "properties": ["email", "firstname", "lastname", "company", "jobtitle", "phone", "lifecyclestage", "hs_lead_status", "lastmodifieddate", "hubspot_owner_id", "createdate"],
      "after": "0"
    },
    "resultsPath": "results",
    "idPath": "id",
    "pagination": { "type": "cursor", "next": "paging.next.after", "passAs": "body:after" },
    "pageSize": { "param": "limit", "value": 100, "in": "body" }
  },
  "incremental": { "strategy": "watermark", "field": "item.properties.lastmodifieddate", "overlap": "5m", "restartOnCap": 10000, "initial": "all" },
  "deletes": { "when": "item.archived == true", "reconcile": "onFullPass", "fullPassEvery": "7d" },
  "fields": {
    "title": { "coalesce": [
      { "join": ["item.properties.firstname", "item.properties.lastname"], "sep": " " },
      "item.properties.email"
    ] },
    "body": { "join": [
      { "join": ["item.properties.jobtitle", "item.properties.company"], "sep": " at " },
      { "template": "Lifecycle {{ item.properties.lifecyclestage }}" },
      "item.properties.hs_lead_status"
    ], "sep": ". " },
    "occurredAt": { "path": "item.createdAt", "decode": "datetime" },
    "updatedAt": { "path": "item.properties.lastmodifieddate", "decode": "datetime" },
    "url": "https://app.hubspot.com/contacts/{{ account.portalId }}/record/0-1/{{ item.id }}",
    "status": "item.properties.lifecyclestage",
    "facets": {
      "email": { "path": "item.properties.email", "decode": "email" },
      "phone": "item.properties.phone",
      "jobTitle": "item.properties.jobtitle",
      "companyName": "item.properties.company",
      "owner": "item.properties.hubspot_owner_id"
    }
  },
  "entities": {
    "is": {
      "type": "person",
      "email": { "path": "item.properties.email", "decode": "email" },
      "name": { "join": ["item.properties.firstname", "item.properties.lastname"], "sep": " " },
      "externalId": { "template": "hubspot:contact:{{ item.id }}" }
    },
    "refs": [
      { "role": "about", "type": "company", "name": "item.properties.company", "domain": { "path": "item.properties.email", "decode": "domain" } }
    ]
  },
  "chunk": { "strategy": "whole" },
  "limits": { "requestsPerMinute": 100 },
  "schedule": { "every": "15m" }
}
```

Rules shown here: a `join` drops empty parts, so a contact with no company
never reads "Engineer at ."; a template whose every `{{ }}` renders empty
renders as empty; a URL template with an empty variable renders as null (no
broken links); `account.optional` means a failing account call does not fail
the source. The `TBD:` id must be replaced in Phase 1 (D40). `"after": "0"` is
required by the action's doc (V).

### 5.5 Example: a generic user profile (what the New profile flow writes)

```json
{
  "$schema": "https://search.forkable.dev/schema/profile-1.json",
  "id": "zendesk.tickets",
  "platform": "zendesk",
  "model": "tickets",
  "kind": "record",
  "title": "Zendesk tickets",
  "author": "usr_8f2c1a",
  "revision": 1,
  "verified": "none",
  "proposal": { "by": "anthropic:claude-haiku-5-5", "draftId": "drf_91ab", "at": "2026-10-29T10:12:00Z" },
  "list": {
    "actionId": "conn_mod_def::<chosen in step 2>",
    "query": { "start_time": "{{ run.since | unix }}" },
    "resultsPath": "tickets",
    "idPath": "id",
    "pagination": { "type": "cursor", "next": "after_cursor", "passAs": "query:cursor", "hasMore": "end_of_stream", "hasMoreInverted": true },
    "pageSize": { "param": "per_page", "value": 100 }
  },
  "incremental": { "strategy": "watermark", "field": "item.updated_at", "overlap": "10m", "initial": "180d" },
  "deletes": { "when": "item.status == 'deleted'", "reconcile": "onFullPass", "fullPassEvery": "7d" },
  "fields": {
    "title": "item.subject",
    "body": { "path": "item.description", "decode": "html" },
    "occurredAt": { "path": "item.created_at", "decode": "datetime" },
    "updatedAt": { "path": "item.updated_at", "decode": "datetime" },
    "url": "{{ item.url }}",
    "status": "item.status",
    "labels": { "path": "item.tags[]", "pick": "all" },
    "facets": { "priority": "item.priority" }
  },
  "entities": {
    "refs": [ { "role": "author", "type": "person", "externalId": { "template": "zendesk:user:{{ item.requester_id }}" } } ]
  },
  "chunk": { "strategy": "paragraph", "maxTokens": 400 },
  "schedule": { "every": "30m" }
}
```

### 5.6 Built-in profiles (Phase 1)

All `verified: "fixture"`. Action ids from `one-actions.md`; every id below is
V there unless marked.

| Pack | Profile id | Kind | List action | Incremental | Hydrate / children | Deletes | Default schedule | On by default |
|---|---|---|---|---|---|---|---|---|
| hubspot | `hubspot.contacts` | person | Search CRM Contacts `GJ3kSC2Sp7I::L6cYnwOfTUatg0cXeWjCBA` | watermark `lastmodifieddate`, restartOnCap 10000 | none | `archived == true`, reconcile 7d | 15m | yes |
| hubspot | `hubspot.companies` | company | Search CRM Objects (Companies) `GJ3kQvNreBM::Zpab8Ig5TSivqCj1UhG37w` (`objectType=companies`) | watermark `hs_lastmodifieddate` (I) | none | archived, reconcile | 15m | yes |
| hubspot | `hubspot.deals` | deal | Search CRM Objects by Type `GJ3kYWYoo38::XLCOkotzRHyXigkeSyVCKg` (`objectType=deals`), `associations` via list action `GJ3kZwJB6ZM::EwizjHo3RHOfHbNXzQSw0A` on full pass | watermark `hs_lastmodifieddate` (I) | none | archived, reconcile | 15m | yes |
| hubspot | `hubspot.notes` | note | Search CRM Objects (Notes) `GJ3k1yj_vd8::B3vvaICzRKeqGbG66JUHDQ` | watermark `hs_lastmodifieddate` (I) | none | archived, reconcile | 30m | yes |
| attio | `attio.people` | person | List an Object's Records `GJ0CbN-LPiU::A6h6M9QkS0Cs2Lt9CdPH7Q` (`object=people`) | full (no updated filter in Attio) | none | reconcile every full pass | 60m | yes |
| attio | `attio.companies` | company | List an Object's Records `GJ0CbN-LPiU::A6h6M9QkS0Cs2Lt9CdPH7Q` (`object=companies`) | full | none | reconcile | 60m | yes |
| attio | `attio.deals` | deal | List an Object's Records `GJ0CbN-LPiU::A6h6M9QkS0Cs2Lt9CdPH7Q` (`object=deals`) | full | none | reconcile | 60m | yes |
| attio | `attio.notes` | note | List Notes `GJ0CZucANAI::qH4Oc4NvS1GWLSVnKugSCA` | full | none | reconcile | 60m | yes |
| gmail | `gmail.threads` | email_thread | List Threads `GJ3ok-Q0D40::oLWNlcx4QDORaL_18z-MsQ` | watermark last message time | Get Thread `GJ3ok0Eq0R8::AAzgZVLqTg2iBuITKpJLZg` (`format=full`), fingerprint `historyId` | reconcile 14d | 5m | yes |
| outlook-mail | `outlook-mail.messages` | email_thread (one item per message, `groupKey` = `conversationId`) | List Messages `GMIYwcOQ0W0::zXQUrHvhTy-rXQG3h50Paw`, `$filter=lastModifiedDateTime ge {{ run.since \| iso }} and isDraft eq false`, `$orderby=lastModifiedDateTime asc` | watermark `lastModifiedDateTime` | none | reconcile 14d | 5m | yes |
| google-calendar | `google-calendar.events` | event | partitions: Calendar List `GJ6Rk8ghCfI::FsO0bmOYSHOsPSIvrcOZxQ`; list: Events `GJ6RlnIYK20::YzuWSmaVQgurletRDNJavA` | delta `nextSyncToken`, resetOn 410; bootstrap `timeMin = now - backfill`, `singleEvents=true`, `showDeleted=true` | none | `status == 'cancelled'` | 10m | yes |
| outlook-calendar | `outlook-calendar.events` | event | partitions: List Calendars `GMIY1FxtnJw::naghBU_mSTKsg0Lv46gF1w` (I fields); list: Delta Calendar Events `GMIY39C_Zus::f0YqbOZ_Tzi_jt6FfhYKHA` window now-365d to now+180d | delta `@odata.deltaLink` | none | `@removed` present | 10m | yes |
| notion | `notion.pages` | doc | Search `GJ5En67fz04::-CJAS419SVWm7L2l6brp6A`, filter object page, sort `last_edited_time` desc | watermark, `order: "desc"` (stop paging when below the watermark) | Retrieve a Page as Markdown `GJ5EntqNvy0::-VzfhSExTEGGnlXLUMqFcA`, header `Notion-Version: 2026-03-11`, fingerprint `last_edited_time` | `in_trash == true \|\| archived == true`, 404 on hydrate | 15m | yes |
| linear | `linear.issues` | task | List Issues `GJ4vJTdCQPY::f4IhKVnuTv6Us2d-GwWvCw` (GraphQL body) | watermark `updatedAt`, `filter.updatedAt.gt` | none | `archivedAt != null` | 10m | yes |
| linear | `linear.projects` | doc | List Projects `GJ4vMBSrKJo::YJPEPOfJQ76eTtZUfpjyUg` | watermark `updatedAt` | none | archived | 60m | yes |
| linear | `linear.documents` | doc | List Documents `GJ4vFe4bH3Q::NcSFstL6Q9WSd4TqlvvyHg` | watermark `updatedAt` | none | archived | 60m | yes |
| linear | `linear.comments` | message (container = issue identifier) | List Comments `GJ4vCs496v0::aGBcU2zYSISOg7tZZzSSfQ` | watermark `updatedAt` | none | archived | 30m | no |
| slack | `slack.users` | person (directory: resolves `U…` ids, not shown as results unless they have an email) | List Workspace Users `GJ7IBQjys4M::0ZFuc5nOQAuLPd7qBVmGZA` | full | none | `deleted == true` | 24h | yes |
| slack | `slack.messages` | message | partitions: List the Calling User's Conversations `GJ7IBJH4uK8::Q4MUFQEYRxucJ3uvw2Ibdw`; list: Conversation History `GJ7H9XYEBzI::FkfMtDsaTzKxb92jFEqxHg` with `oldest = cursor.watermark` | watermark `ts` per channel | children: Thread Replies `GJ7H99BNZZY::YUA8ceLYSMmIEPSjoukdNg` when `item.reply_count > 0` | `subtype == 'message_deleted'`, reconcile never | 30m (see §7.6) | yes |
| teams | `teams.chat-messages` | message | partitions: List Chats `GJ7M0XFmgfA::ccNbrhTlTROYTSZtYigXCg`; list: Chat's Messages `GJ7M1v_ty1I::z6ijZ292SHKR9tz7c9nEOQ` | watermark `lastModifiedDateTime` (I filter) | none | `deletedDateTime != null` | 15m | yes |
| teams | `teams.channel-messages` | message | partitions (nested): Joined Teams `GJ7NUzqmPxU::KPH8i5-qTwG3rhZHepN3Fg` then Channels `GJ7NFwMDWsI::zD6Vj-Z-SoKYto-H5m6G7A`; list: Channel Messages Delta `GJ7NFaW12yo::D62bOYGhSkK1cOoDf-KCWA` | delta `@odata.deltaLink` | none | `deletedDateTime != null` | 30m | no (D38) |
| granola | `granola.notes` | meeting_note | List Notes `GKbJ53hO4Ng::02BNDFnhQ-CVKjaPxMIMrg`, `updated_after` | watermark `updated_at` | Get Note `GKbJ523eLeg::Qnq0sQ9eSQGAepuzo55Jsw`, `include=transcript` only when `settings.transcripts`; fingerprint `updated_at` | 404 on hydrate | 30m | yes |

Account vars: Gmail profile `GJ3oa8bJZNA::ZS9kXmE_Rzi4utfESor_ng` (I, from
Rill), Outlook `/me` `GMIYxNZ51eU::xY4rcCXiTTyrarjC9ac97w` (I, from Rill),
HubSpot portal id (TBD, D40), Slack team domain (TBD, D40). Every account
answer that carries the user's own address feeds `self_addresses`.

---

## 6. Embeddings and models (all on the grant)

| Use | Platform | Action id | Notes |
|---|---|---|---|
| Embed (default) | `openai` | `conn_mod_def::GJ564JtA2kg::RZSxROt_TaGPn5dj1cERcg` POST `/embeddings` | `{ model: "text-embedding-3-small", input: string[], dimensions: 1536 }`, batches of 128 inputs, 8,000 tokens each at most |
| Embed | `gemini` | `conn_mod_def::GKYsLheH12Q::Tpg2bcnfSjenI3U6jlwKzQ` POST batchEmbedContents | `gemini-embedding-001`, `outputDimensionality: 1536`, `taskType` `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY`, batches of 100 |
| Embed | `cohere` | `conn_mod_def::GOBI50QrjAs::W77uZN_sRAq12F_k0a3kEg` POST `/v2/embed` | `embed-v4`, `output_dimension: 1536`, `input_type` `search_document` / `search_query`, 96 texts a call |
| Embed | `mistral-ai` | `conn_mod_def::GMZh4j5K2IA::ZZRIBQWMS0-Kn1uey0EP4A` POST `/v1/embeddings` | `mistral-embed` (1024, zero-padded to 1536), batches of 64 |
| Embed (sample) | none | none | `local:hash-v1`: deterministic feature hashing (word unigrams and bigrams, char trigrams, signed hash into 1536 dims, L2 normalized). Not semantic. Every place it shows says "Sample embedder (local, not semantic)". |
| Chat, answer strip | `anthropic` | `conn_mod_def::GJfJ6hmtpYo::zy68VQHpRFmqayjAzxkjDA` POST `/messages` | `claude-sonnet-5-5`, header `anthropic-version: 2023-06-01`, `tools` for search and propose |
| Profile proposal | `anthropic` | same | `claude-haiku-5-5` |
| Jev | `typesafe` | `conn_mod_def::GNh4bXcHPaU::V2ndvy5CQJmYHvkElwVM_w` POST `/v1/systemone` | `jev-latest` (`SEARCH_JEV_MODEL` overrides) |

The model id string stored on every vector is `<provider>:<model>@<dims>`
(e.g. `openai:text-embedding-3-small@1536`). Changing the model in Settings
changes `index_hash` for every source; the embed worker fills the new model's
vectors (cache first) while search keeps using the old model until the new one
covers 95% of chunks, then flips `settings.embedding` atomically. Missing
embedding platform in the grant: Settings shows "Semantic search needs an
embeddings model in your grant" and search runs keyword-only for that user.

---

## 7. The engine

### 7.1 Stages per run

One run is one source (one profile on one connection). Per page, so a crash
loses at most one page.

```
acquire lease        pg_try_advisory_lock(hashtext(source_id)); skip if held
resolve account      account vars (cached in sources.account_vars, refreshed every 24 h)
plan                 per partition: since, full pass?, page cursor to resume
partitions           list partitions (paged), keep filter; one cursor row each
loop pages (per partition):
  fetch              one.call(list) through the shared token bucket and retry policy
  extract            resultsPath, idPath, keep, deletes.when
  hydrate            only items whose fingerprint changed; children when 'when' holds; 404/410 -> tombstone
  store raw          raw_items upsert (item, detail, children, fingerprint, fetch_hash)
  normalize          fields via Expr + decoders -> NormalizedItem (pure)
  entities           resolve refs and 'is' -> entities, entity_keys, entity_links
  chunk              cut text, sha256 per chunk; unchanged text_hash keeps its row
  upsert             one transaction: items, entity_links, chunks; enqueue pending_embeddings and classify
  tombstone          deletes.when or 404: items.deleted_at, chunks deleted, links kept
  checkpoint         page_cursor = next page; pending_watermark = max(field) seen
reconcile            only when full pass AND pagination completed AND pages > 0 AND not capped
commit cursors       watermark = pending_watermark (data time, never wall clock) or delta token
release, record      runs row, sources health, next_run_at, SSE source event
async workers (outside runs): embed, classify, entity match, remap, rerank cache cleanup
```

### 7.2 Retry, backoff and rate limits

One policy for list, hydrate, children and account calls.

| Response | Action |
|---|---|
| 2xx, `ok` | continue. Slack also needs `data.ok === true`; `ok: false` is mapped by error string (`ratelimited` = 429, `invalid_auth`/`token_revoked` = 401, `missing_scope` = 403 grant-like). |
| 429, or `refusal: "rate_limit"` | wait `Retry-After` (seconds or HTTP date) else `min(30s * 2^n, 300s)` with plus or minus 20% jitter; up to 5 tries; then the run ends `rate_limited`, page cursor kept, `retry_at` set, status `rate_limited`. |
| 5xx, network error, `refusal: "one_error"` | `min(2s * 2^n, 60s)` with jitter; up to 4 tries; then the page fails and the run ends `partial` (cursor kept). |
| 401, `OneConnectError` `reconnect_required` | status `auth_needed`, stop the source, SSE `source`. Never retried until the user signs in again. |
| 403 with `blockedByGrant: true` or `refusal: "grant"` | status `grant_blocked`, stop, never retry. The Settings row says which action was not granted. |
| 402 or `refusal: "plan_limit"` | status `degraded` with reason `plan_limit`, retry next schedule. |
| 404/410 on hydrate with `notFoundIsDelete` | tombstone the item. |
| 410 on a delta list (`resetOn`) | drop `delta_token`, run a full pass now. |
| other 4xx | fail the page with the body cut to 500 chars in `item_errors` / `runs.error`; run ends `partial`. |

Token bucket per `(user_id, connection_key)`, capacity = `limits.requestsPerMinute`
(default 60), refill per second; `limits.perAction[actionId]` adds a tighter
bucket per action. Every profile on the same connection shares the bucket.
After any 429 the bucket is drained to zero (shared backoff).

Source-level backoff: `next_run_at = now + min(every * 2^consecutive_failures, 6h)`
with jitter 10%. Success resets the counter. Schedules are jittered by up to
10% of `every`. The scheduler tick runs every 30 s and starts at most 4 runs
at once per process (`SEARCH_SYNC_CONCURRENCY`).

### 7.3 Incremental strategies

| Strategy | Behaviour |
|---|---|
| `full` | List everything every run. Reconcile by absence after a complete pass. Use only where the API has no change filter (Attio). |
| `watermark` (asc) | Filter `> since` where `since = watermark - overlap`. Watermark = max of `field` seen across the run, committed only when pagination completed. `restartOnCap`: when results reach the cap, restart the query from the newest watermark seen. |
| `watermark` with `order: "desc"` | API sorts newest first (Notion search). Stop paging at the first item whose field is at or below the watermark. |
| `delta` | Provider change token (Google `syncToken`, Graph `deltaLink`). First run uses `bootstrap`. Token taken from the last page (`tokenPath`). `resetOn` codes drop the token. |

`initial`: a duration (`365d`), `all`, or a template (`{{ settings.backfill }}`).
`fullPassEvery` forces a `full: true` run that ignores the watermark and
reconciles, for feeds with no delete signal.

### 7.4 Deletes and tombstones

- Predicate deletes (`deletes.when`), Graph `@removed`, Google `status:
  cancelled`, 404 on hydrate: set `items.deleted_at` and `raw_items.deleted_at`,
  delete chunks and their embeddings, keep `entity_links` (history), drop the
  item from search. A tombstoned item that comes back is restored.
- Reconcile by absence only after a complete, non-empty, uncapped full pass,
  and only for items in the pass's window (`occurred_at >= since` when the
  list was windowed).
- Never delete on an incremental run's absence.

### 7.5 Health

`sources.status` is derived after every run:

| Status | When | UI word |
|---|---|---|
| `new` | created, first run not started | Waiting |
| `syncing` | a run is in flight | Syncing |
| `healthy` | last run `ok` | Healthy |
| `degraded` | last run `partial`, or any `item_errors` in the last 24 h above 1% of fetched | Needs attention |
| `rate_limited` | last run `rate_limited`; `retry_at` set | Rate limited |
| `auth_needed` | 401 / `reconnect_required` | Needs sign-in |
| `grant_blocked` | 403 grant refusal | Not in your grant |
| `paused` | user paused | Paused |
| `error` | 3 or more consecutive failed runs | Failing |

Each status carries `last_error: { code, message, at, action? }` with a
sentence that says what to do (§15.6).

### 7.6 Slack and the 2025 non-Marketplace limit

Since 2025-05-29, Slack limits `conversations.history` and
`conversations.replies` to **1 request per minute and 15 objects per page** for
commercially distributed apps installed outside the Slack Marketplace. Whether
One's Slack app is Marketplace-listed is unknown (open question Q1). Design:

| Knob | Value |
|---|---|
| `settings.slackTier` | `limited` (default) or `marketplace`; Settings, Integrations, Slack shows it with one line explaining the limit. |
| `limits.perAction` (limited) | history and replies 1 request a minute each; page size 15 (`limit=15`). |
| `limits.perAction` (marketplace) | history and replies 50 a minute, page size 200. |
| Partition order | conversations ordered by `updated` desc (most recently active first), DMs and private channels first. |
| Partition cap | `settings.maxChannels` default 20 (limited) / 200 (marketplace). |
| Backfill | `settings.backfill` default 30d (limited) / 365d (marketplace). |
| Replies | only when `reply_count > 0` and the thread was updated since the watermark; they share the 1/min bucket. |
| Expected speed (limited) | about 900 messages an hour; the first-run estimate line says so ("Slack indexes slowly on this plan: about 900 messages an hour"). |
| Detection | if a history call returns 429 with `Retry-After` near 60 s while tier is `marketplace`, Search switches the source to `limited` and records why. |
| Fallback idea (not v1) | Search Messages `GJ7IAjr_Sns::-NYvPOrhQ_qbz8B8XmsJRg` as a live fallback for unindexed channels (find only, not loaded). |

---

## 8. Entities

### 8.1 Resolution (in the run, deterministic)

1. Each ref produces candidates: email (from `email` or parsed `address`),
   name, domain, externalId.
2. Email lowercased, plus-tags kept (they are distinct inboxes). People keyed
   `email:<addr>`. A company is derived from the email's registrable domain
   (public suffix list) unless the domain is free mail (built-in list:
   gmail.com, googlemail.com, outlook.com, hotmail.com, live.com, icloud.com,
   me.com, yahoo.com, proton.me, protonmail.com, aol.com, gmx.*, fastmail.com,
   plus `entities.ignoreDomains`) or one of the user's own domains.
3. `entities.is` merges the CRM record into the person or company. Fan-out
   guard: a path that resolves to more than one distinct email makes no merge.
4. `externalId` keys (`ext:slack:U02ABC`) bind directory records (Slack users
   with email) so later messages that carry only the user id resolve.
5. `self_addresses` mark `is_self`; the user's own person entity is one row
   across every connection (Dana's acme.com and acme.eu addresses).
6. A ref with a name and no email or external key creates a person with a
   `name:` key only, flagged for the match check.

### 8.2 Match check (async, Jev)

Candidates: pairs of person entities with the same normalized name (or one
name a prefix of the other, "Priya S." and "Priya Shah"), where at least one
side lacks a shared email; and pairs sharing an `ext:` id and a name.

Jev request per candidate pair (batched, up to 10 pairs per call as separate
questions):

```
state:     { a: { name, emails, company, title, sources, sample_items: [3 titles] },
             b: { ... } }
questions: { same_<n>: { type: "noul",
               instructions: "Are a and b the same real person? Judge from names, companies, email domains and what they wrote. Different people can share a name.",
               criteria: { true: "same person", false: "different people or not enough evidence" } } }
```

| P(same) | Action |
|---|---|
| >= 0.85 | merge (`merged_into_id`, keys and links move), `decided_by: jev` |
| 0.5 to 0.85 | `pending`; the person preview shows "Possible match: Priya S. (Granola)" with Merge and Not the same |
| < 0.5 | `rejected` |

Merges are reversible from the person preview (unmerge restores keys and
links from `entity_keys.source_id`). Sample mode reads `fixtures/sample/matches.json`.

---

## 9. Classification (Jev) and ranking

### 9.1 Item classification

Question set `item-v1`, one Jev call per item whose `body_hash` changed, for
items with `occurred_at` in the last 90 days (older items get `rules`
defaults). Runs in the classify worker, never on the sync path. Batch: up to
8 items per call, questions suffixed `_<n>`.

```
state: { me: { name, emails, company }, vips: [names], item: { kind, source, title, from, to, container, date, body (first 2,000 chars) } }
questions:
  kind_<n>:       choice  [person_email, team_chat, customer, vendor, investor, newsletter, receipt, notification, calendar, internal_doc, task, cold_pitch, other]
  needs_you_<n>:  noul    "Does this item ask the user to reply, decide or do something?"
  ball_<n>:       choice  [me, them, nobody]  "Whose move is next?"
  importance_<n>: score   4 levels: noise, routine, useful, important
```

Lane (D31), first match wins:

| Lane | Rule |
|---|---|
| `vip` | any linked person in `settings.vipEntityIds` and kind not newsletter/receipt/notification |
| `needs_you` | `needs_you >= 0.6` or `ball == me` with confidence >= 0.6 |
| `waiting` | `ball == them` and the user wrote last |
| `low` | kind in newsletter, receipt, notification, cold_pitch, or importance level 0 |
| `fyi` | everything else |

`importance` = score / 3. Jev failing: items stay unclassified (no lane), one
retry per worker pass, never blocks search. Jev not in the grant: `rules`
classifier (labels and sender heuristics), `model: "rules"`, labelled in the
preview. Sample: `fixtures/sample/judgments.json`.

### 9.2 Hybrid ranking

```
1. parse query (§9.3) -> { text, filters, negations }
2. candidate SQL (filters pushed into both CTEs, user_id always bound, deleted_at is null):
   kw   : top 100 items by ts_rank_cd(items.tsv, q) and chunks.tsv max per item
   vec  : top 100 chunks by embedding <=> qv (model = active), grouped to item by best chunk
   title: top 20 by similarity(title, text) when text has 1 to 3 words (pg_trgm)
3. RRF: rrf = 1/(60 + r_kw) + 1/(60 + r_vec) + 0.5/(60 + r_title)   (missing rank contributes 0)
4. boosts: score = rrf * (1 + 0.15 * importance) * (0.85 + 0.15 * exp(-age_days / 90))
           * (1.2 when an entity named in the query is linked to the item)
5. group: items sharing group_key within a source collapse to the best one (count shown)
6. return top N (default 30) with highlights (ts_headline on the best chunk) at once
7. rerank (async, D30): Jev on the top 30 when settings.rerank, real mode, text has >= 3 words
```

The core SQL (keyword list shown; vector list as in `pgvector-embedded.md`):

```sql
with q as (select websearch_to_tsquery('english', $text) as tq, $qv::vector as qv),
kw as (
  select i.id, row_number() over (order by greatest(ts_rank_cd(i.tsv, q.tq), coalesce(c.r, 0)) desc) as r
  from items i cross join q
  left join lateral (select max(ts_rank_cd(ch.tsv, q.tq)) as r from chunks ch where ch.item_id = i.id and ch.tsv @@ q.tq) c on true
  where i.user_id = $uid and i.deleted_at is null and (i.tsv @@ q.tq or c.r is not null) and <filters>
  order by 2 limit 100),
vec as (
  select item_id as id, row_number() over (order by d) as r from (
    select ch.item_id, min(e.embedding <=> q.qv) as d
    from chunk_embeddings e join chunks ch on ch.id = e.chunk_id join items i on i.id = ch.item_id, q
    where e.user_id = $uid and e.model = $model and i.deleted_at is null and <filters>
    group by ch.item_id order by d limit 100) t)
select i.*, kw.r as kw_rank, vec.r as vec_rank,
       coalesce(1.0/(60+kw.r),0) + coalesce(1.0/(60+vec.r),0) as rrf
from kw full outer join vec using (id) join items i on i.id = coalesce(kw.id, vec.id)
order by rrf desc limit 200;
```

Keyword-only mode drops `vec`. An empty text with filters only sorts by
`occurred_at` desc. The query embedding uses the query task type
(`RETRIEVAL_QUERY`, `search_query`) and is cached 10 min by text.

Jev rerank: one call, state `{ query, me, candidates: [{ n, kind, source, title, date, excerpt (300 chars) }] }`,
questions `rel_<n>: score` 4 levels (unrelated, mentions it, about it, exactly
what was asked). Final = `0.5 * (1 - rrf_rank/30) + 0.5 * rel/3`. Scores are
kept in `rerank_scores` (D47) per user, normalized query and item; Jev is asked
only about candidates with no stored score whose hash still matches. Budget
2.5 s; on timeout the RRF order stands, the call finishes and its scores are
stored. One call per missing set is in flight (single-flight). `fresh` asks
about every candidate again. Sample: `fixtures/sample/rerank.json` for the demo
queries, else no rerank.

### 9.3 Query operator grammar

```
query     = clause { ws clause }
clause    = [ "-" ] ( operator | phrase | word ) | "OR"
operator  = key ":" value
key       = "source" | "in" | "type" | "is" | "from" | "to" | "with" | "about"
          | "before" | "after" | "on" | "updated" | "during"
          | "has" | "status" | "stage" | "lane" | "label" | "container" | "amount" | "id"
value     = word | phrase | list | range | compare
list      = value "," value { "," value }
range     = date ".." date
compare   = ( ">" | ">=" | "<" | "<=" ) ( date | number )
phrase    = '"' { any char except '"' } '"'
date      = YYYY-MM-DD | YYYY-MM | today | yesterday | tomorrow | this-week | last-week
          | this-month | last-month | Nd | Nw | Nm | Ny            (N units ago)
```

| Operator | Meaning | Example |
|---|---|---|
| `source:` / `in:` | platform slug or its name | `in:gmail`, `source:hubspot,attio` |
| `type:` | item kind; aliases mail, email, thread, event, meeting, person, people, company, doc, page, issue, task, message, chat, note, deal | `type:deal` |
| `is:` | `unread`, `vip`, `needs-you`, `waiting`, `mine` (I am owner/assignee/organizer), `open` (status not done/closed/lost), `upcoming`, `past` | `is:needs-you` |
| `from:` | person (email, name prefix, `me`) in role from/author/organizer | `from:priya` |
| `to:` | person in role to/cc/attendee/assignee | `to:me` |
| `with:` | person or company in any role | `with:globex.com` |
| `about:` | entity linked with role `about` or `is` | `about:"Priya Shah"` |
| `before:` `after:` `on:` | `occurred_at` | `after:30d`, `on:2026-10-28` |
| `updated:` | `updated_at` with compare or range | `updated:>7d` |
| `during:` | event or meeting window overlaps | `during:this-week` |
| `has:` | `attachment`, `link`, `joinurl`, `transcript` | `has:attachment` |
| `status:` `stage:` `label:` `container:` | exact or prefix on those fields | `stage:"contract sent"`, `container:#deals` |
| `lane:` | Jev lane | `lane:vip` |
| `amount:` | deal amount compare | `amount:>=50000` |
| `id:` | item id or external id | `id:ACME-311` |

Rules: same key ORs (`in:gmail in:outlook-mail`), different keys AND, `-`
negates the clause, `OR` joins free words, quotes make phrases. Unknown keys
are treated as words (so `re:` in a subject still searches). A person value
that matches several entities ORs them and the chip says "Priya (2)". The
parser is `parseQuery(text) -> ParsedQuery` and `formatQuery(parsed) -> text`
in core; the UI chips are a view over `ParsedQuery` (two-way binding).

---

## 10. The New profile flow

### 10.1 Screens (sheet over the app, `max-w-[960px]`, stepper in the header)

| Step | Screen | Server calls |
|---|---|---|
| 1 Source | Palette picker (search, rows with logo, name, the connection it would use; groups "In your grant", "Not in this app yet", D26), then on the same step the platform's models grouped from One's catalog with no AI (`mapper/models.ts`; suggested first, built-ins marked). "Map N models" runs docs, one dry run and the proposal for the picked models only (2026-10-29). | `GET /catalog/platforms?q=`, `POST /profile-drafts`, `POST /profile-drafts/:id/models` |
| 2 Check | Merged Fields, Identity and Review (2026-10-30, after a design-critic review): three sample records as result rows with Open in the platform, anything to fix in plain words with "Fix in fields" / "Fix in Advanced" and "Ask AI to fix", then Name, Refresh, Start from and Searchable text. "Edit fields" opens the map table (source field by name and path, samples, Search field, format; Skip pinned first). "Advanced" holds record id, the Open link (an API address warns) and the title when empty. The primary only ever says what it does (`Save and start indexing`, Cmd+Enter); a "N things to fix" link beside it jumps to the problems. The assistant is closed until asked; its starters are the open problems. | `PATCH /profile-drafts/:id` then `POST /profile-drafts/:id/validate` on every edit, `POST /profile-drafts/:id/preview`, `POST /profile-drafts/:id/save` |

Disabled primary buttons say what is missing ("Pick at least one model",
"Title needs a field", "Link template does not resolve on 2 of 5 samples").

### 10.2 Draft creation (server)

1. `oneConnect.listActions(userId, platform)` (cached), keep actions whose
   method is GET, or POST with a path or title that reads as list, search or
   query (`list|search|query|get-many|get all|retrieve .*s$`), drop write verbs.
   Rank by title match to `list`, then path depth.
2. For the top 8 candidates: `getActionKnowledge(userId, actionId)`
   (`knowledge` Markdown, `ioSchema`).
3. Access check: `listConnections` gives the connection's `access` policy.
   A candidate the policy does not permit is shown greyed with "Not in your
   grant".
4. Dry run each permitted candidate on the grant: one page, smallest page
   size, no filters beyond what the action requires. Ledger actor `mapper`.
   Response trimmed (first 5 records, strings cut to 300 chars, arrays to 5).
5. Deterministic inference (§10.4) on each sample.
6. LLM proposal (§10.3) with the docs, `ioSchema`, trimmed samples and the
   inference hints.
7. Validation (§10.5), up to 2 repair rounds that send the errors back to the
   LLM. Result stored in `profile_drafts`.

### 10.3 Proposal prompt contract

Model: `claude-haiku-5-5` through One (D24). `max_tokens` 4,000,
`temperature` 0. System prompt (abridged; full text in
`packages/core/src/mapper/prompt.ts`):

```
You map one platform's list actions into Search profiles. Output JSON only,
matching the ProposalOutput schema you are given. Rules:
- Use only action ids from the candidates. Never invent ids, paths or fields.
- Every path must exist in the sample responses (path grammar: a.b, a[0], a[-1], a[], a[name=X]).
- Pick kind from: person, company, email_thread, event, doc, task, message, meeting_note, deal, note, record.
- title, occurredAt and idPath are required. Prefer a URL the API returns over a template.
- Incremental: prefer a provider filter on an updated time; else 'full'.
- Say for each field why you chose it, in under 12 words.
- Recommend which models a person would want in a personal search, and why.
- Read-only. Never choose an action that creates, updates, sends or deletes.
```

User message: JSON `ProposalInput` (`CONTRACT.md` §4.6): platform, catalog
metadata, candidates `[{ actionId, title, method, path, knowledgeExcerpt
(first 6,000 chars), ioSchema, sample, inference }]`, target vocabulary,
grammar summary.

Output schema `ProposalOutput` (`CONTRACT.md` §4.6): `models[]`, each with
`recommended`, `reason`, a complete `SearchProfile` draft, `fieldNotes`
(`{ target, path, confidence 0..1, reason }[]`), `questions` for the user
(e.g. "Which id is stable, `id` or `number`?").

### 10.4 Deterministic inference (also the fallback when Anthropic is not granted)

| Thing | Rule |
|---|---|
| `resultsPath` | the largest array of objects in the response |
| `idPath` | `id`, `uuid`, `*_id` at top level, nested `id.*`; must be unique across the sample |
| pagination | from the response, in order: `nextPageToken`, `next_cursor`, `paging.next.after`, `@odata.nextLink`, `response_metadata.next_cursor`, `nextOffset`/`hasMore`, `pageInfo.endCursor`+`hasNextPage`, `meta.next`, `Link` header; else `none` |
| title / body | `suggestSearchablePaths` scoring (ported from the CLI): short high-coverage string = title, long string = body |
| dates | ISO or epoch-shaped leaves; names `created*` -> occurredAt, `updated*`/`modified*` -> updatedAt and watermark |
| emails | `EMAIL_RE` leaves -> person refs (role from the key name: from, to, owner, assignee, author) |
| url | keys named `url`, `webLink`, `htmlLink`, `permalink`, `web_url` |
| incremental filter | `ioSchema` params named `updated_since`, `updatedSince`, `modified_since`, `since`, `updated_after`, `updatedMin`, `start_time`, `$filter` |
| kind | from model name and fields (email + name = person, domain = company, amount + stage = deal, start + end = event) |

### 10.5 Validation (before save, again on every edit)

| Check | Pass rule |
|---|---|
| Schema | zod parse of `SearchProfile` |
| Actions | every action id exists in the catalog for this platform, is read-only (GET, or POST listed as search/query), and is permitted by the grant's access policy |
| Fetch | a fresh one-page dry run returns 2xx and `resultsPath` is an array (empty is a warning, not an error) |
| Id | `idPath` resolves on 100% of samples and is unique |
| Title | non-empty on at least 80% of samples |
| Dates | `occurredAt` parses on at least 80% |
| Link | `url` renders an absolute `https://` URL on at least 80%, or is absent |
| Pagination | `none`, or the next value resolves on the first page when the page was full |
| Incremental | watermark field resolves and parses as a date on at least 80% |
| Size | normalized body under 200,000 chars on every sample |
| Hashes | computes `fetch_hash`, `map_hash`, `index_hash` |

The report (`ValidationReport`) lists each check with `ok | warn | error` and
the sample ids it failed on. Save needs zero errors.

### 10.6 After save

Profile row (`origin: user`), version 1, one source per selected model on the
chosen connection, first run kicked (`trigger: first`), SSE `source` events
drive the source detail screen.

### 10.7 Sharing

| Path | How |
|---|---|
| Export | `GET /profiles/:id/export` -> `SearchProfilePack` JSON file (no `author` user id, no connection, no account vars) |
| Import file or paste | `POST /profiles/import` `{ pack }` -> validation report and a diff against any installed copy; confirm with `POST /profiles/import/:importId/accept` |
| Import URL | `POST /profiles/import` `{ url }`; https only, fetched server-side, 256 KB cap, 5 s timeout, no redirects to private addresses |
| Contribute | copy the pack into `profiles/<platform>/pack.json`, set `author: "community"`, run `pnpm --filter @search/core test:profiles`, open a PR. `docs/profiles.md` explains it. |
| Agent | `.claude/skills/add-search-profile/SKILL.md` (Phase 5): find actions with the One CLI, load docs, write the pack, write fixtures shaped from the documented response, run the profile test, add the manifest lines, update the docs table. |

---

## 11. Sample mode: the Acme Inc world

`fixtures/sample/world.md` is the human-readable cast. Fixtures are written by
hand, shaped exactly like each action's documented response (field names,
nesting, pagination tokens) from `one-actions.md` and the loaded docs. They are
not recordings. Dates are relative (`"$rel": "-2d 14:00"`) and resolved at load
time in the sample user's zone (America/Los_Angeles), so the world is always
current.

### 11.1 Cast

| Who | Where | Addresses | Shows up in |
|---|---|---|---|
| Dana Oyelaran (the user, Head of Sales) | Acme Inc | dana@acme.com (Google), dana@acme.eu (Microsoft 365 tenant of Acme Europe), Slack U01DANA | every source; self across both tenants |
| Mia Park (Engineering lead) | Acme | mia@acme.com | Linear, Slack, Teams, Google Calendar, Notion |
| Theo Lund (Product manager) | Acme | theo@acme.com | Linear, Notion, Slack, Google Calendar |
| Sam Okafor (Sales ops) | Acme | sam@acme.com | HubSpot owner, Slack, Gmail |
| Lena Vogt (EU account manager) | Acme Europe | lena@acme.eu | Teams, Outlook Mail, Outlook Calendar |
| Priya Shah (VP Partnerships) | Globex | priya@globex.com, priya.shah@gmail.com (personal, in one Granola note) | HubSpot, Attio, Gmail, Google Calendar, Granola, Slack mentions, Notion |
| Marco Bellini (Legal counsel) | Globex | marco@globex.com | Outlook Mail, HubSpot |
| Ravi Menon (CTO) | Initech | ravi@initech.io | Attio, Gmail, Google Calendar, Granola, Linear (customer field) |
| Hannah Cole (Procurement lead) | Umbrella | hannah.cole@umbrella.co | HubSpot, Outlook Mail, Outlook Calendar, Teams mention, Granola |
| Owen Price (Partner) | Northwind Ventures | owen@northwind.vc | Gmail, Google Calendar, Notion |
| Jules Martin (Founder) | Hooli | jules@hooli.dev | Gmail cold pitch, Attio lead |
| Newsletters, receipts | various | news@, receipts@ | Gmail (low lane) |

Companies: Acme (self), Globex, Initech, Umbrella, Northwind Ventures, Hooli.

### 11.2 Storylines (the cross-source overlap)

| Storyline | Items |
|---|---|
| Globex renewal ($84,000 a year, close Nov 14) | HubSpot contact Priya, company Globex, deal "Globex renewal 2027" (stage Contract sent), note; Attio person Priya, company Globex (Acme is moving from HubSpot to Attio, so both CRMs hold her); Gmail thread "Re: Globex renewal terms" (Priya and Dana, 5 messages); Outlook message "Globex legal redline, final" from Marco to dana@acme.eu; Google Calendar "Globex x Acme contract review" (Thu); Granola note of that meeting (attendee "Priya S." with priya.shah@gmail.com); Slack #deals "Globex is basically closed, waiting on signature"; Linear ACME-311 "SSO for Globex rollout"; Notion "Globex account plan". |
| Initech pilot | Attio deal "Initech pilot" (Discovery); Gmail thread with Ravi "Pilot data import"; Google Calendar "Initech pilot kickoff"; Granola note of the kickoff; Linear ACME-298 "CSV import fails over 50 MB" with a comment; Slack #eng thread with replies; Notion "Pilot playbook". |
| Umbrella EU expansion | HubSpot company Umbrella and deal "Umbrella EU expansion" (Negotiation, EUR 120,000); Outlook thread with Hannah "Procurement questionnaire"; Outlook Calendar "Umbrella procurement call"; Teams chat Dana and Lena about Umbrella pricing; Granola note of the call. |
| Northwind investor update | Gmail thread with Owen "Q3 update and board date"; Notion "Q3 investor update"; Google Calendar "Northwind board prep"; Slack DM Dana and Theo. |
| Ledger 2.0 launch (internal) | Linear project "Ledger 2.0" with issues LED-142 "Ship usage-based billing", LED-158 "Invoice PDF redesign"; Notion "Ledger 2.0 launch plan"; Teams chat "Eng sync"; Outlook Calendar "Ledger 2.0 go/no-go". |
| Noise | Gmail newsletters (3), receipts (2), a cold pitch from Jules; Slack bot messages. |

Entity merge the demo must show: Priya Shah across 9 sources (HubSpot `is`,
Attio `is`, Gmail, Google Calendar, Granola via Jev match of "Priya S.", Slack
mention via `ext:` with email, Outlook via Marco's thread cc, Notion via body
mention as `mentioned` when the profile maps it, Linear via the issue's
customer field), Globex as one company from `globex.com`, Dana as one self
across `acme.com` and `acme.eu`.

### 11.3 Sizes

| Source | Items |
|---|---|
| HubSpot | 8 contacts, 6 companies, 4 deals, 5 notes |
| Attio | 7 people, 5 companies, 3 deals, 3 notes |
| Gmail | 24 threads (2 pages) |
| Outlook Mail | 14 messages in 8 conversations |
| Google Calendar | 2 calendars, 16 events (one cancelled) |
| Outlook Calendar | 1 calendar, 6 events (one `@removed` on the second delta) |
| Notion | 8 pages |
| Linear | 14 issues, 2 projects, 3 documents, 6 comments |
| Slack | 6 users, 4 conversations, 48 messages, 2 threads with replies |
| Teams | 2 chats, 18 messages |
| Granola | 6 notes |
| Zendesk (New profile sample only) | 12 tickets, fixture catalog |

### 11.4 How sample mode runs

- `users.is_sample`, sources `mode: fixture`. Every source is created from the
  built-in profiles; the engine runs exactly the live code path, with
  `one.call` answering from `fixtures/sample/<platform>/...` by
  `(actionId, request)` (pagination tokens drive which page).
- Sample connection keys are `sample:<platform>`; never sent anywhere.
- Embedder `local:hash-v1`; pgvector still used when available (so the demo
  exercises hybrid SQL); keyword-only when not.
- Jev, rerank, matches, chat and the proposal answer from their fixture files.
  A question the chat fixtures do not cover gets the extractive answerer:
  quotes the top 3 results with citations, labelled "Sample answer, no model".
- The sample grant includes every built-in read action plus the AI platforms.
  It excludes every write; `one.attempt` on a write replays
  `{ status: 403, blockedByGrant: true, refusal: "grant" }`.
- `POST /sources/sample` creates the sample user's sources (idempotent).

---

## 12. The `one.call` wrapper

Ported from Rill (`$RILL/packages/core/src/one.ts`), generalised from
mailbox to source. Exact signature in `CONTRACT.md` §5.

- Mode: `fixture` when the source or user is sample, else `connect`. There is
  no key mode.
- Connection: the source's `connection_key`; for AI platforms
  (`openai`, `gemini`, `cohere`, `mistral-ai`, `anthropic`, `typesafe`) the
  first connection for that platform in `listConnections` (cached 60 s per
  user, `forgetGrant(userId)` after sign-in or disconnect).
- One-served actions (path starts with `/v1/<platform>/`): `connectionKey`
  goes in the body.
- Query params always in `query`, never the body (Graph ignores OData keys in
  a body).
- Writes one ledger row per call (or the rolled-up indexer row, §4.10).
- Throws `NotConnected` (no connection for the platform), `BlockedByGrant`,
  rethrows `OneConnectError`. `attempt` returns the row instead of throwing.
- Returns `{ status, ok, data, headers.retryAfter }` to the engine so the retry
  policy sees `Retry-After`. Open question Q3: whether `runAction` exposes the
  provider's `Retry-After`; if not, the policy uses the exponential default.

---

## 13. Server

| Concern | Rule |
|---|---|
| Entry | `server/src/node.ts` `startServer({ env?, log?, startScheduler? })`, ported from Rill: load env, refuse to start if 52289 is busy (redirect is registered once), boot database (§13.1), Connect store, deps, `createApp`, serve on 127.0.0.1, start scheduler and workers. |
| Dev | `SEARCH_UI_URL` (set by `pnpm dev`) makes every non-`/api`, non-OAuth, non-`/mcp` path 302 to Vite on 5680. Prod serves `ui/dist` with SPA fallback. |
| Session | cookie `search_sid` (httpOnly, SameSite=Lax, Secure on https, 400 days). Lazy user creation. |
| Bearer | `Authorization: Bearer` on `/api/v1/*` and `/mcp` resolves the user from `oauth_tokens`; the cookie path is the browser's. A request never takes a user id from its body. |
| Connect | `createOneConnect` key mode with `userStore` over `connect_users`; sign-in through `startAuthorization` / `completeAuthorization` in Hono directly (the blocks MCP pattern), which also serves the OAuth flows. `onConnected`: forget grant cache, whoami + `/users/me`, account merge (cu_, then One user id, then email), then `ensureSources(user)` (one source per indexable connection per enabled built-in profile) and kick first runs off the request path. |
| Setup | `/api/v1/setup/connect` write-only, Keychain service `search.connect` else `~/.search/connect.env` 0600; localhost-only. Reconcile with `.env` written by `pnpm connect` as on Rill's Connect-from-code branch (`.env` client id wins for ids; secrets from the store when its client id matches). |
| Scheduler | 30 s tick: due sources (`next_run_at <= now`, not paused, not auth_needed/grant_blocked), at most 4 concurrent runs; workers: embed (batch 128, every 5 s while pending), classify (batch 8), entity match (every 60 s), remap (when `map_hash` differs), cleanup (expired OAuth rows hourly, ledger older than 90 days daily). |
| SSE | `GET /api/v1/events` per user: `source`, `run`, `index`, `entity`, `health`, `ledger`. Chat streams on its own endpoint. |
| Errors | `{ error: { code, message, data? } }`; codes in `CONTRACT.md` §8. |

### 13.1 Database boot

1. `SEARCH_DATABASE_URL` set: connect (`pg` Pool, `max 5`), detect where
   `vector` lives and set `search_path` per connection when needed, migrate,
   capability check (§4.13 / pgvector-embedded.md "Capability detection").
   Supabase: use the session pooler or direct connection (port 5432); the
   transaction pooler (6543) is refused at boot with a clear message because
   `pg` advisory locks and session settings need a session.
2. Else embedded: `resolvePgvector(home)` copies `@search/pgvector` for this
   platform into `~/.search/pg-ext/vector-0.8.7-pg18/` (atomic rename), then
   `EmbeddedPostgres` with `postgresFlags: ["-c", "extension_control_path=$system:<ext>/share", "-c", "dynamic_library_path=$libdir:<ext>/lib"]`,
   data dir `~/.search/db`, port 55441 (first free at or after), initdb only
   when `PG_VERSION` is missing, `hydrateEmbeddedSymlinks` from Rill. A live
   server found through `postmaster.pid` is reused only when
   `show dynamic_library_path` includes the ext dir; otherwise it is
   restarted with the flags.
3. Capability result `{ mode: "hybrid" | "keyword", reason?, pgvector?, where: "embedded" | "external" }`
   kept in memory, shown in Settings, Database and on `GET /api/health`.

---

## 14. AI chat

| Part | Rule |
|---|---|
| Grounding | The assistant sees only items Search returned: the current query's top results plus anything it searches for itself. Context per item: number, kind, source, title, date, people, url, best chunks (1,200 chars total). Max 12 items in context per round. |
| Tools (Anthropic `tools`) | `search({ query })` runs `hybridSearch` for the user and appends new numbered items (max 3 calls per answer); `propose_query({ query, reason })` returns a refinement for the UI; `answer({ text, citations, followups })` ends the turn. |
| Citations | Markers `[n]` in text. Server checks every `n` exists in the context, drops unknown ones, maps each to `{ n, itemId, chunkId?, quote }` (quote = the sentence span from the chunk that best matches the claim by trigram similarity). |
| Groundedness | An answer with zero citations while context is non-empty is retried once with "cite or say you could not find it". Still none: shown with "Not grounded in your results" and `grounded: false`. "I could not find that in your sources" is a valid answer. |
| Refinement chips | `propose_query` becomes a `QueryProposal { query, diff: [{ op: "+"|"-", clause }], count, reason }`; `count` is computed by the server with a filters-only count. Apply rewrites the box (Cmd+Enter); "Search in chat only" runs it inside the chat. The page never changes without a keypress. |
| Follow-ups | 2 or 3 short questions, shown as rows above the composer. |
| On the grant | `anthropic` connection required; missing shows "The assistant needs Anthropic in your grant" with Add in One. Every call is a ledger row with actor `assistant`. |
| Answer strip | Question-shaped queries (`?`, who/what/when/where/why/how/did/does) on the results page call `POST /answer` (same pipeline, one round, no tools) and render above the list without blocking it. |
| Sample | `fixtures/sample/chat.json` answers matched by normalized question; else the extractive answerer. |

SSE event sequence for one turn: `step` (Reading 12 results), `step`
(Searching "from:priya after:30d"), `results` (new numbered items), `step`
(Writing), `answer`, `proposal` (optional), `followups`, `done`. Errors arrive
as `error` then `done`. Details in `CONTRACT.md` §7.

---

## 15. UI

Follows `search-ux-mobbin.md` Part 2 and `design/SPACING.md` (ladder steps
only, never `text-[Npx]`). Rill's `@theme` block, components (`Kbd`, `Chip`,
`Badge`, `Menu`, `Dialog`, `Skeleton`, `EmptyState`, `Switch`, `Tabs`,
`ChatPanel`, `CommandPalette`, `LoadError`) are the base, with the Forkable
palette (D35). Fonts Inter Variable and JetBrains Mono. Light, dark, system.
Size setting (Small, Default, Large via `--ui-scale`).

### 15.1 Routes

| Route | Screen |
|---|---|
| `/` | Home (empty query) or results (`/?q=...`) |
| `/item/:id` | Results with that item previewed (deep link) |
| `/people/:entityId`, `/companies/:entityId` | Entity view: relationship card, timeline by source, "Search everything about X" |
| `/sources/:id` | Source detail (Overview, Fields, Runs, Errors) |
| `/settings/general` | Account, Size, sample data, Saved searches |
| `/settings/integrations` | Sources table, Available in your grant, Not in this app yet; `New profile` (N) |
| `/settings/integrations/new` | New profile sheet (§10) |
| `/settings/search` | Embedding model, capability note, rerank toggle, lanes, VIPs, Slack tier |
| `/settings/assistant` | Chat model, proposal model, chat history |
| `/settings/database` | Embedded or external, URL masked, capability, sizes |
| `/settings/api` | OAuth clients (CLI, MCP hosts, scripts) with last used and Revoke; MCP and CLI setup snippets |
| `/access` | Grant card, actions by platform (verb in bold), Activity ledger, Disconnect (local), Manage in One |
| `/setup/connect` | Write-only Connect setup, "Create my Connect app", "Update the Connect app" |
| `/start` | Sign in with One (split layout like Rill's), or "Try the Acme sample" |
| `/oauth/consent` | Server-rendered consent page for OAuth clients (names the client, Continue with One) |

### 15.2 Layout

Shell: sidebar 220px (rail 52px under 1024px, or under 1536px with the dock
open): Search, Ask (Cmd+J), Saved searches, Sources (health dot + count),
Settings, Access; footer account chip and indexing chip. Main: box, scope
tabs with counts, chip bar (Source, From, With, Date, plus per-type chips,
`+ Filter`, Clear, Save), answer strip, list, preview pane (420px, 380 to 480).
Dock: 360px (280 to 420), resizable, persisted, overlay under 1024px.

### 15.3 Result rows

Per `search-ux-mobbin.md` §2.4: `h-9` single line, `h-14` with a second line,
16px source logo from `https://assets.withone.ai/connectors/<platform>.svg`
(letter tile fallback), 64px type column, title with the match bold, inline
context, right meta. Per-type content table there is normative. People and
companies matching strongly get a top strip of up to 3 chips.

### 15.4 Preview pane

Header "Found in <Source>", Open in <Source> (O), Copy link (Y). Per-type
bodies per §2.5 of the UX research. Footer: Ask about this (Cmd+Shift+J),
Open, Next. Classification line (`text-11`): lane and importance with "by Jev"
or "by rules".

### 15.5 Keyboard map

Exactly `search-ux-mobbin.md` Part 3. Additions: `L` then a lane initial
(`L V`, `L N`, `L W`, `L F`, `L L`) filters by lane; `G` then `P` opens People.
The `?` sheet and the palette render from one `keymap.ts` table.

### 15.6 States and copy

| Where | Copy |
|---|---|
| Nothing connected | "Search reads the tools you connect. Add one to start." plus connector tiles and "Try the Acme sample" |
| First index | "Indexing HubSpot, 1,240 of about 3,000" per source |
| Empty results | "Nothing matched `<query>` in N sources." plus fix buttons |
| Keyword-only | Settings and a one-time banner: "Semantic search is off. <reason>." with the one SQL line for external databases |
| Sample embedder | "Sample embedder (local, not semantic)" in Settings, Search and in the demo output |
| Needs sign-in | "Slack needs you to sign in again. Indexing stopped 2h ago." Reconnect |
| Not in grant | "Search was not granted <action> on <platform>." Manage in One |
| Rate limited | "Slack is rate limiting Search. Trying again at 10:42." |
| Load failed | Rill's `LoadError` with Retry, never an empty list |

### 15.7 Logo

The Search mark is the S from the Forkable letter system (kit in
the Forkable repo's `design/brand/search/`, shipped 2026-10-29).
`node scripts/sync-brand.mjs` copies it into `ui/` and `site/` (marks into
`src/assets/brand/`, favicons, icons and the OG card into `public/`).
`Logo.tsx` in each renders the `-current` mark; never hand-edit the copies,
re-run the script after the kit changes.

---

## 16. Surfaces

### 16.1 REST API

Prefix `/api/v1`. Browser: cookie. Everyone else: OAuth bearer. Full shapes in
`CONTRACT.md` §6. Groups: health and me, search (`GET /search`,
`POST /search/rerank`, `GET /suggest`), items, entities, chat and answer,
sources and runs, profiles (list, versions, export, import), profile drafts
(the New profile flow), catalog and connections, settings, saved and recent
searches, access and ledger, setup, OAuth clients, events (SSE).

OAuth scopes:

| Scope | Allows |
|---|---|
| `search:read` | search, suggest, items, entities, sources list |
| `search:ask` | chat and answer (costs model calls on the grant) |
| `sources:write` | sync now, pause, settings of sources, profile import and drafts |
| `account:read` | me, access, ledger |

### 16.2 OAuth authorization server

`@hono/mcp` `mcpAuthRouter` with our
`OAuthServerProvider` over the four Postgres tables. Endpoints `/authorize`,
`/token`, `/register` (DCR), `/revoke`,
`/.well-known/oauth-authorization-server`,
`/.well-known/oauth-protected-resource` (resources `<origin>/mcp` and
`<origin>/api/v1`). PKCE S256 only. Public clients
(`token_endpoint_auth_method: none`) allowed. Issuer `SEARCH_PUBLIC_URL`
(default `http://localhost:52289`). Flow: `/authorize` stores
`oauth_pending`, sets `search_oauth_pending` cookie, renders `/oauth/consent`;
Continue runs `startAuthorization` to One's three-step consent;
`/api/one/callback` sees the pending cookie, completes Connect, runs
`onConnected`, mints the code, redirects to the client. A browser that already
has a signed-in `search_sid` skips One and goes straight from consent to code.

### 16.3 CLI (`@withone/search`, bin `search`)

| Command | Does |
|---|---|
| `search` / `search start` | start the server and open the browser |
| `search demo` | keyless Acme demo in process, exits 0 (`pnpm start` runs this) |
| `search login [--server URL]` | OAuth (DCR public client, PKCE, loopback redirect); token in `~/.search/cli-token.json` 0600 |
| `search logout`, `search whoami` | |
| `search "<query>" [--json] [--limit N] [--source s] [--type t]` | query; prints rows (source, type, title, date, url), `--json` prints `SearchResponse` |
| `search ask "<question>" [--json]` | one chat turn, prints answer with numbered sources |
| `search open <itemId>` | opens the item's url |
| `search sources [list\|sync <id>\|pause <id>\|resume <id>]` | |
| `search profiles [list\|export <id> [file]\|import <file\|url>\|validate <file>]` | `validate` runs offline schema checks plus fixture checks when fixtures exist |
| `search mcp-config [--client claude-code\|codex\|json]` | prints the config snippet for `http://localhost:52289/mcp` |

Exit codes: 0 ok, 1 error, 2 usage, 3 not signed in, 4 server not running.

### 16.4 MCP server

`POST /mcp`, Streamable HTTP, stateless (`sessionIdGenerator: undefined`,
`enableJsonResponse: true`), fresh `McpServer` + `WebStandardStreamableHTTPServerTransport`
per request, `bearerAuth` from `@hono/mcp`. Read-only. `instructions` explain
the operator grammar in five lines. Tools:

| Tool | Input | Output | Scope |
|---|---|---|---|
| `search` | `{ query, limit?: 1..50 (10) }` | `{ results: [{ id, title, url, source, kind, date, snippet }] }` (text content is the same as a numbered list) | `search:read` |
| `fetch` | `{ id }` | `{ id, title, url, text (body, 20,000 chars max), metadata: { source, kind, date, people, facets } }` | `search:read` |
| `get_entity` | `{ query }` (email, domain or name) | entity card: names, emails, company, sources, last 10 items | `search:read` |
| `list_sources` | `{}` | sources with status, counts, last sync | `search:read` |
| `ask` | `{ question, query? }` | `{ answer, citations: [{ n, id, title, url, quote }] }` | `search:ask` |

Hosts drop `structuredContent` when `isError` is set, so errors return text
only. Remote chat apps cannot reach `127.0.0.1`; local MCP clients (Claude
Code, Codex) use `http://localhost:52289/mcp` directly; remote hosts need a
tunnel or a hosted build (not in this spec).

---

## 17. Forkable files

| File | Content |
|---|---|
| `forkable.json` | `{ "starter": "0.1.1", "forkedFrom": null, "name": "search", "tagline": "One search box for everything you connect", "sample": "Acme Inc", "welcome": "forkable/welcome.mjs" }` |
| `connect.manifest.json` | every action `one.call` can make: all built-in profile actions (`access: read`, `usedBy` the pack path, one-line `reason`), the four embedding actions, Anthropic messages, TypeSafe systemone, account actions, One's `user:profile:read` (`platform: "one"`), and one `grant: false` write (`gmail` delete message `conn_mod_def::GJ3ocgKltKQ::s8UCfiDLSaO9w9oPU32TYA`) for the Access receipt. A test fails when a profile or core file names an action missing from the manifest. |
| `one.connect.ts` | Rill's Connect-from-code shape: reads the manifest, skips `platform: "one"` and `grant: false`, merges `connect.extra.json` action ids into the custom ask, older read-only platform entries as `read-only` (D26), `name: "Search"`, `redirectUris: ["http://localhost:52289/api/one/callback"]`, `reason` (under 200 chars), placeholder logo URL until the S mark exists. |
| `connect.extra.json` | `{ "platforms": {} }`; written by the New profile flow |
| `scripts/connect.mjs` + `"connect"` script | `pnpm connect` runs `one --agent connect create` |
| `agents/indexer.md` | Job: keep the index fresh. Trigger: scheduler. Judgment: Jev classification and entity match. Actions: the manifest's read actions. Never: write to any platform, read outside the grant, store secrets. |
| `agents/assistant.md` | Job: answer from search results with citations and propose refinements. Trigger: chat, answer strip, `ask` in CLI and MCP. Model: Sonnet through One. Never: answer without citing, change the page without a keypress, call a write action. |
| `AGENTS.md` (+ `CLAUDE.md`) | What this is, status, rules (Connect only, no secrets, Acme only, manifest is truth, MIT, push gate), how to add a profile, architecture, ports. |
| `local/profile.md` | frontmatter `for: "{{FOR}}"`, `in: "{{IN}}"`; body: who searches, which tools matter locally |
| `gtm/positioning.md`, `gtm/skills/` | positioning, launch-post, landing-copy, demo-video, creator-outreach, seo-geo, pricing, launch-checklist; drafts to `gtm/out/`, never posted |
| `forkable/welcome.mjs` | dependency-free, `--dir`, `--pm`, prints the S mark (placeholder glyph), source logos as text chips, three steps: open the sample (`pnpm dev`, http://localhost:5680), `/setup/connect` then sign in, files to edit (`profiles/`, `connect.manifest.json`); 80 columns, honours `NO_COLOR`/`CI` |
| `.env.example` | `ONE_CLIENT_ID=`, `ONE_PERMISSION_SET=`, `ONE_REDIRECT_URI=http://localhost:52289/api/one/callback`, commented `SEARCH_DATABASE_URL=`; no secrets |
| `LICENSE` | MIT |

Writing order in README and welcome: fork a working search business, its
integrations and Sign in with One come built in, Secured by One in one line.

---

## 18. Keyless demo output (`pnpm start`)

Target shape (numbers come from the fixtures; times relative):

```
Search · keyless demo · Acme Inc sample
Database   embedded Postgres 18.4 on 55441 · hybrid (pgvector 0.8.7)
Embedder   Sample embedder (local, not semantic) · local:hash-v1@1536

Indexing 11 sources
  HubSpot            contacts 8 · companies 6 · deals 4 · notes 5        23 items
  Attio              people 7 · companies 5 · deals 3 · notes 3          18 items
  Gmail              dana@acme.com 24 · dana@acme.dev 3                  27 items
  Outlook Mail       messages 14 (8 conversations)                       14 items
  Google Calendar    events 16 (1 cancelled, removed)                    15 items
  Outlook Calendar   events 6 (1 removed on delta)                        5 items
  Notion             pages 8                                              8 items
  Linear             issues 14 · projects 2 · documents 3                19 items
  Slack              messages 48 (2 threads)                             48 items
  Teams              chat messages 18                                    18 items
  Granola            notes 6                                              6 items
  201 items · 227 chunks · 227 vectors · 0 errors

Entities
  Priya Shah (Globex)   9 sources   merged: HubSpot, Attio by email; "Priya S." (Granola) by Jev 0.93
  Globex                globex.com  14 items
  Dana Oyelaran (you)   dana@acme.com, dana@acme.eu

Search "globex renewal"
   1 Deal     HubSpot           Globex renewal 2027 · Contract sent · $84,000      Nov 14
   2 Mail     Gmail             Priya Shah · Re: Globex renewal terms (5)          6h
   3 Mail     Outlook Mail      Marco Bellini · Globex legal redline, final        2d
   4 Meeting  Granola           Globex contract review                             Thu
   5 Message  Slack #deals      Dana: Globex is basically closed, waiting on...    1d

Search "from:priya after:30d type:mail"   3 results
Search "lane:needs-you"                    6 results

Ask "Where are we with Globex?"
  Priya Shah is your champion on the $84,000 renewal [1]. Globex legal sent the
  final redline two days ago [2], and on Thursday's call Priya asked for a
  multi-year discount before signing [3].
  [1] HubSpot · Globex renewal 2027   [2] Outlook Mail · Globex legal redline, final
  [3] Granola · Globex contract review
  Refine: + with:globex.com + after:14d   (7 results)

Access   Search reads only. Gmail · delete   declined, 403
Next: pnpm dev, then open http://localhost:5680
```

The demo uses its own sample user and a scratch schema of the same database
(`search_demo`), dropped on exit, so it never touches a real user's index.
`FORKABLE_CREATE=1` skips the "Next:" line. Exit code 0 on success, 1 when any
section fails (the failing section prints why).

---

## 19. Phases and done criteria

Every phase ends with `pnpm typecheck` clean, its tests green, `pnpm start`
exiting 0 (from Phase 1), AGENTS.md status updated, and a commit on a local
branch. No push, no deploy, no publish without the owner's approval.

| Phase | Scope | Done when |
|---|---|---|
| 0 | Research (5 docs), SPEC, CONTRACT | This commit. |
| 1 Core | Workspace skeleton; `@search/core` schema + migrations + vector schema; `@search/pgvector` with the darwin universal dylib at 0.8.7 (build script, `SHA256SUMS`), Linux `.so` from PGDG via `scripts/fetch-pgdg.mjs` (or documented as keyword-only until done); boot with capability check; `one.call` with fixture mode; path, template, predicate and expression engine; decoders; profile zod schema + JSON Schema generation + three hashes; engine stages with retries, backoff, cursors, partitions, tombstones, health; entity resolution (deterministic); chunker; embedders (local hash, OpenAI, Gemini, Cohere, Mistral request builders); hybrid search + query parser; all 11 built-in packs with D40's account ids found; Acme fixtures for all 11 sources; `search demo`. | `pnpm start` exits 0 with the §18 shape on embedded Postgres with pgvector, and again with `SEARCH_FORCE_KEYWORD=1` (keyword-only); `pnpm --filter @search/core test` covers: path grammar (CLI cases ported), templates and filters, predicates, each decoder, each strategy (asc and desc watermark, delta with 410 reset, full with reconcile guards), retry table rows (429 Retry-After, 5xx, 401, 403 grant, 404 tombstone), token bucket sharing, hashes (map change re-maps with zero calls, fetch change resets cursors), entity fan-out guard and free-mail rule, RRF ordering, every operator in §9.3; each built-in pack passes `test:profiles` on its fixtures; an external-database run against a scratch Postgres URL passes. |
| 2 Server + UI | Server (boot, sessions, Connect sign-in, setup store and screen, scheduler and workers, all REST routes for search, items, entities, chat, sources, profiles, drafts, catalog, settings, access, SSE); UI (home, results, preview, filters and chips with two-way binding, palette, chat dock with citations and proposals, Settings with Integrations table, source detail, New profile sheet end to end on the sample Zendesk catalog, Access, setup/connect, start). | `pnpm dev` serves 5680 and 52289; a Playwright smoke (`scripts/smoke-ui.mjs`) runs: sample sign-in, search with an operator, chip toggles rewrite the box, preview opens, chat answer with 3 citations, Apply a proposal, New profile for Zendesk to saved source with a first run, Access lists the grant; `server/scripts/smoke-api.ts` hits every route on the sample; a stubbed-grant smoke (Rill's `smoke-whoami` pattern) covers `onConnected`, account merge and source creation. |
| 3 CLI, API OAuth, MCP OAuth | OAuth server on Postgres, bearer on REST and `/mcp`, MCP tools, CLI commands, Settings, API (clients, revoke). | `server/scripts/smoke-oauth.ts`: DCR, authorize with pending cookie, stubbed Connect callback, code, token, refresh rotation, reuse revokes family, revoked token 401; `search login` then `search "globex"` and `search ask` against a running server on the sample; MCP Inspector (or the SDK client in a script) lists the 5 tools and runs each on the sample; `search mcp-config --client claude-code` output works in Claude Code locally. |
| 4 Jev, entities, quality | Classification worker and lanes, entity match worker and the possible-match UI, Jev rerank, answer strip, empty and error states, keyboard sheet, light and dark polish, 1024/1280/1536 layouts. | Sample judgments drive lanes (`lane:` filters return the fixture's expected counts); match fixture merges Priya and leaves one pending pair visible; rerank changes the order of at least one demo query; QA screenshots in `docs/qa/` (home, results, preview per type, chat with citations and a proposal, palette, Integrations, source detail, each New profile step, Access, setup, light and dark, 1024/1280/1536) via `node scripts/shoot.mjs`; a design-critic pass with fixes. |
| 5 Skill and docs | `.claude/skills/add-search-profile/SKILL.md`, `docs/profiles.md` (format reference, contribute by PR), README, AGENTS.md, gtm drafts, welcome. | A fresh coding agent following only the skill adds one new built-in profile (for example `intercom.conversations`) with fixtures and passes `test:profiles`; the README quickstart works from a clean clone; `humanize` pass on README and welcome. |
| Later | Real-grant pass per source (flip `verified` to `real` per profile), Gmail history delta, Worker hosting, push subscriptions. | Out of scope. |

---

## 20. Risks and open questions

| # | Item | Plan |
|---|---|---|
| Q1 | Is One's Slack app Marketplace-listed? Decides 1 request a minute vs Tier 3 for history and replies. | Ask the One team. Default `limited` (§7.6). |
| Q2 | Do `listActions` / `getActionKnowledge` answer on a key-mode grant for a platform the user has NOT granted? Token mode unverified. | Phase 2 tests it on a real sign-in. If not, step 1 shows only granted platforms plus a "widen the ask" path (D26). |
| Q3 | Does `runAction` expose the provider's `Retry-After`? | Phase 1 reads the 0.19.0 source; else exponential default. |
| Q4 | Can a Connect app's ask be widened by `one connect create` (update) and the user grant the new platform with one more sign-in? (D26) | Untested; first real run in Phase 2. |
| Q5 | Account var actions for HubSpot (`portalId`) and Slack (team domain). (D40) | Phase 1 finds them with `one actions find`. |
| Q6 | Gemini batch embed limit (100) and OpenAI limits are I. | Batch sizes are settings; the embedder splits on 400 "too many inputs". |
| Q7 | One's own rate limit on a single user's grant under a full backfill of 11 sources. | Global per-user cap `SEARCH_ONE_RPM` (default 300) on top of per-connection buckets. |
| Q8 | Teams channel messages need admin consent in most tenants. (D38) | Off by default; Settings explains. |
| Q9 | Supabase: `extensions` schema on `search_path`, transaction pooler. | Boot detects and sets `search_path`; refuses the 6543 pooler with a message. |
| Q10 | Linux pgvector is not verified live (Docker was off in the spike). | Phase 1 runs the spike SQL against linux-x64 and linux-arm64 embedded bundles in CI or a container; until then Linux may run keyword-only. |
| Q11 | Index size: a long Gmail history at 1536 dims is large (about 6 KB per chunk). | Backfill defaults (365d Gmail, 30d Slack limited); Settings shows database size. |
| Q12 | Running Jev on every item costs calls. | Only items from the last 90 days, only on `body_hash` change, batches of 8. |
| Q13 | `create-forkable` catalog entry and sync line for Search are changes to another repo. | The owner's call; not in this spec's phases. |
| Q14 | The landing page's sample data (`site/src/lib/sample.ts`) contains dash characters in titles. | Fix in the landing chat; not this spec. |
| Q15 | Remote chat apps cannot reach a local MCP. | Hosted build is a later phase; register a second redirect URI then. |
</content>
</invoke>

---

## 21. Phase 1 build notes (core, 2026-10-29)

Where the Phase 1 core differs from or adds to this spec. CONTRACT.md section 13 has the interface side.

| Item | What was built |
|---|---|
| pgvector | 0.8.7 as D22 says: darwin universal dylib built with `packages/pgvector/scripts/build-darwin.sh` (PG 18.4 headers-only prefix, minos 13.0, bundle loader), Linux x64 and arm64 `.so` extracted from PGDG's Ubuntu 22.04 `.deb`s by `scripts/fetch-pgdg.mjs` (pinned sha256). All three committed with `SHA256SUMS`. Linux is not run live yet (Q10 stands). |
| `items.tsv` title weight | `to_tsvector('english', ...)`, not `'simple'`: queries go through `websearch_to_tsquery('english')`, which stems ("renewal" to "renew"), so a `simple` title vector never matched its own words. |
| Foreign keys | None. The demo and tests run the same migrations inside a scratch schema, and drizzle-kit qualifies references with `"public"`. Cascades are done in code. |
| Extra columns | `items.content_hash` (unchanged detection, migration 0002) and `items.directory` (directory profiles such as `slack.users`). |
| Path grammar | Adds quoted keys `a["@odata.nextLink"]` and lets `[]` and `[k=v]` iterate an object's values (Notion properties keyed by column). |
| Profile format | Adds `entities.refs[].each` (one ref per element; paths resolve against the element, `el` for a scalar), `hydrate.when`, decoder `number`, filters `firstline`, `truncate:N`, `striphtml`, and the `lookahead` setting (`run.until = now + lookahead`; Outlook Calendar ships 180d). |
| Zone-less datetimes | Read as UTC (Graph `dateTime`, Attio). |
| Sample markers | `$relRfc2822`, `$relLocal` (+ `$tz`), `$relMsString`, `$relDate`, and inline `$rel(spec|fmt)` / `$relSlackTs(spec)` inside any string or map key. |
| Self | `account.self` ext values are stored as entity keys spell them (`slack:u01dana`). Every run folds people keyed by the user's own addresses into the one self person, so connection order no longer matters (pack need 15). |
| Q3 answered | `runAction` (0.19.0) returns no response headers, so `Retry-After` is read only from body hints (Slack `retry_after`, Graph `retryAfterSeconds`), else the exponential default. `linkHeader` pagination therefore runs one page. |
| Vector matches | A vector neighbour counts only under cosine distance 0.75 (`VEC_MAX_DISTANCE`), so a query no longer returns 100 unrelated neighbours. |
| Reconcile | Also needs at least one fetched item in the pass (an empty page is not "non-empty"). |
| Demo | Indexes every source twice (the second pass is the incremental run that shows Outlook Calendar's delta removal), prints `events 16 (1 removed)` style counts, and fails (exit 1) on any mismatch with `fixtures/sample/expect-demo.json` (items per source, the two counted queries, needs-you lane, match outcomes, citations). The "globex renewal" top row is ranked by RRF without Jev rerank (Phase 4), so it is a calendar event today, not the HubSpot deal. |
| Not in Phase 1 core | `jevRerank`, `suggest`, the mapper (`createDraft`, `dryRun`, `previewDraft`, `validateDraft`, `saveDraft`, catalog), `exportPack` / `importPack`. The chat turn is built (sample answers, extractive fallback, Anthropic tool loop on the grant) but the live loop is unverified. |
| Pack needs left | 11 (Slack mention ids: `each` plus `el` can express it, the pack does not use it yet), 12 (HubSpot deal associations), 13 (ref type chosen by value). |

## 22. Phase 4 build notes (Jev, entities, quality, 2026-10-29)

| Item | What was built |
|---|---|
| VIP lane | A VIP named in the title or text (full name, or the first name as a whole word) also makes `vip`, but only after `needs_you` and `waiting`: a mention is weaker than a link. Links alone missed CRM notes and deals ("Priya is the champion") and chat about a VIP (pack needs 11 and 12). |
| Lane counts | `expect-demo.json` `lanes` are now the `lane:` search totals (grouped): vip 37, needs-you 6, waiting 6, fyi 130, low 24. The demo checks every lane. They differ from the per-item `lane` notes in `judgments.json`: 10 judged refs are not indexed items, 21 items are older or records and get rules lanes, and the Procurement reply Dana sent last is `waiting` by 9.1, not `fyi`. |
| Rerank | The demo reranks "globex renewal" with `jevRerank` (sample: `rerank.json`, now explicit `{ rel: { ref: level } }` levels) and fails unless the order changed and the HubSpot deal is first. RRF alone puts the signature call first. Final order: HubSpot deal, Gmail terms, signature call, Attio deal, Outlook redline (hybrid). |
| Match UI | Person preview and entity page show "Possible match: Ravi M. (Granola)" with Merge and Not the same, and merged people ("Merged Priya S. (Granola) by Jev 0.93") with Unmerge. `EntityDetail.merged` added. |
| Activity actor | `runChatTurn` and `answerOnce` take who asked: MCP `ask` logs as `mcp`, a bearer REST chat or answer as `api`, each with the OAuth client id. |
| Rows | Senders and attendees show the linked person's name when the provider gave an address or a Slack id; chat rows read "Sender: message"; HubSpot default stage ids show as labels; numeric and UUID owners are hidden. |
| QA | `scripts/shoot.mjs` signs in to the sample on a real server and writes `docs/qa/phase4/` (37 screens, light and dark, 1024/1280/1536). |
