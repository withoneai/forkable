# One CLI sync study, and a profile format for Search

Date: 2026-10-29. Source read: the One CLI repo, `src/lib/memory/sync/`
(every file listed in the brief, plus `mem-writer.ts`, `hooks.ts`, `db.ts`,
`test.ts`, `index.ts`), `lib/memory/schema.ts`, `lib/memory/runtime.ts`, and the
shipped profiles in the One CLI repo's `profiles/`. All `file:line`
citations below are relative to `cli/src/lib/memory/sync/` unless a path is given.

Short version: the CLI engine is a solid single-model "list, optionally get each,
dump JSON into a memory row" loop with careful guards (pagination-complete
reconcile, enrichment fingerprints, identity fan-out guard). It is not an index
builder. It has no watermark cursors, no delete signals other than absence, no
normalized document shape, no chunking, no per-source health that survives a
run, and it re-embeds every record on every sync. Search should copy its path
resolver, identity key code, pagination helpers, extraction and retry
classification, and redesign everything around them.

---

## 1. How it works today

### 1.1 Where things live

| Concern | Where |
|---|---|
| Profile files | `.one/sync/profiles/<platform>_<model>.json`, cwd relative (`profile.ts:7-11`) |
| Built-in profiles | `<cli package>/profiles/<platform>/<model>.json` (`builtin-profiles.ts:28-57`) |
| State (cursor, status) | `mem_sync_state` table in the memory Postgres (`state.ts`, `lib/memory/schema.ts:94-105`) |
| Records | `mem_records` (JSONB `data`, `keys[]`, `identity_keys[]`, generated `tsvector`, `vector(1536)`) |
| SQLite mirror | `.one/sync/<platform>.db`, only opened when the profile has `enrich` (`runner.ts:178`) |
| Locks | `.one/sync/locks/<platform>_<model>/pid`, mkdir based (`lock.ts`) |
| Schedules | user crontab plus `~/.one/sync/schedules.json` (`schedule.ts`, `schedule-registry.ts`) |

One profile is one `(platform, model)`, one list action, optionally one detail
action. A platform with several models is several profile files.

### 1.2 The profile format (verbatim, `types.ts:1-191`, `337-379`)

```ts
export type PaginationType = 'cursor' | 'token' | 'offset' | 'id' | 'link' | 'none';

export interface PaginationConfig {
  type: PaginationType;
  /** Dot-path to the next page indicator in the response */
  nextPath?: string;
  /** Format: "{location}:{paramName}" where location is query or header */
  passAs?: string;
  /** For offset pagination: dot-path to total count in response */
  totalPath?: string;
  /** For id pagination: which field on the record is the ID */
  idField?: string;
  /** For id pagination: dot-path to has_more boolean in response */
  hasMorePath?: string;
}

export interface DateFilterConfig {
  param: string;
  format: 'iso8601' | 'unix' | 'date';
}

export interface SyncProfile {
  platform: string;
  model: string;
  connectionKey?: string;            // legacy literal key
  connection?: ConnectionRef;        // { platform, tag? }, late bound, survives re-auth
  actionId: string;
  resultsPath: string;               // "" | "$" | "." = root array
  idField: string;                   // dotted allowed ("id.record_id")
  pagination: PaginationConfig;
  dateFilter?: DateFilterConfig;
  defaultLimit?: number;             // default 100
  limitParam?: string;               // default "limit"; "" = send none
  pathVars?: Record<string, string | number | boolean>;
  queryParams?: Record<string, unknown>;
  body?: Record<string, unknown>;
  limitLocation?: 'query' | 'body';
  identityKey?: string;              // ENTITY key, goes into keys[] and drives merge
  identityKeys?: Array<{ prefix: string; path: string }>; // ASSOCIATION keys, identity_keys[]
  exclude?: string[];                // dot-paths stripped before storing
  transform?: string;                // shell command, JSON array on stdin/stdout
  derive?: Record<string, string | { path: string; extract?: 'email' }>;
  enrich?: EnrichConfig;
  onInsert?: string;                 // shell command or "log"
  onUpdate?: string;
  onChange?: string;
  memory?: MemorySyncOptions;        // { embed?: boolean; searchable?: string[] }
}

export interface EnrichConfig {
  actionId: string;
  pathVars?: Record<string, string | number | boolean>;  // {field} / {{field}} interpolation
  queryParams?: Record<string, string | number | boolean>;
  body?: Record<string, unknown>;
  resultsPath?: string;
  fields?: string[];                 // pick
  exclude?: string[];
  merge?: boolean;                   // deep merge into list record (default true)
  concurrency?: number;              // default 5
  delayMs?: number;                  // default 200
  timestampField?: string;           // default "_enriched_at"
  invalidateOn?: string;             // list field used as change fingerprint (#174)
}

export interface ModelSyncState {
  lastSync: string | null;
  lastCursor: unknown;
  totalRecords: number;
  pagesProcessed: number;
  since: string | null;
  status: 'idle' | 'syncing' | 'failed';
}
```

Validation at write time is minimal (`profile.ts:24-61`): required
`platform, model, actionId, idField, pagination, resultsPath`, exactly one of
`connectionKey`/`connection`. There is no `version` field and no schema.

### 1.3 How a profile is inferred (`infer.ts`, `index.ts:218-300`)

No LLM. `sync init <platform> <model>` without `--config`:

1. `discoverModels` (`models.ts:40-104`) lists the platform's actions, keeps
   `get_many | list | get_all` action types, drops `custom`-tagged ones, then
   resolves each to an executable `conn_mod_def::` id via `searchActions`.
2. If a built-in profile exists, it is copied (description dropped) and
   inference is skipped.
3. Otherwise `inferProfileFromKnowledge(details.knowledge, model, platform)`
   runs regexes over the action's knowledge markdown:
   - **Pagination**: first match wins over an ordered list (`infer.ts:24-79`):
     `start_cursor|next_cursor` -> Notion body cursor; `starting_after` -> Stripe
     id pagination; `Link: <...>; rel="next"|page_info=` -> link; 
     `next_page_token|nextPageToken|paging.next.after` -> token with
     `nextPath: "paging.next.after"`, `passAs: "query:after"`; bare `cursor` ->
     generic cursor; `offset.*limit|page.*per_page` -> offset.
   - **resultsPath** (`88-131`): first of `data, results, items, records, rows,
     entries` seen as `"key": [`, else the model name and singular/plural
     variants.
   - **idField** (`191-197`): `id`, else `_id`, else `uuid`.
   - **dateFilter** (`200-206`): first of `updated_since, updatedSince,
     modified_since, since, updated_after, created_after` mentioned anywhere.
   - **pathVars** (`142-188`): every `{{var}}` in the knowledge, minus secrets and
     record-level ids, with defaults `calendarId=primary`, `userId=me`.
   - **POST bodies** (`265-282`): if the doc says POST and mentions a page-size
     word, limit and cursor move to `body:`.
4. The agent then iterates with `sync test` (single page fetch, checks in
   `test.ts:134+`) and `sync init --config '<json>'` (merged into the existing
   file).

Known inference bug: Google's `nextPageToken` matches the HubSpot rule, so a
Google list gets `nextPath: "paging.next.after"` and `passAs: "query:after"`,
both wrong (`infer.ts:58-66`). The built-ins paper over it by hand.

### 1.4 Pagination (`pagination.ts`)

`getNextPageParams(response, config, page, pageSize, records)` returns the next
request's `{queryParams | bodyParams | headers}` or `null` to stop:

- `cursor | token | link`: read `nextPath`, pass as `passAs`. Stops on null/empty.
  `link` is not a real RFC 5988 parser: it just reads `headers.link` as a value.
- `offset`: `(page+1)*pageSize`, stop on empty page or `>= totalPath`.
- `id`: last record's `idField`, stop on `hasMorePath === false` or empty page.
- `none`: single request.

`passAs` is `query:name | body:name | header:name` (`pagination.ts:5-15`).
Note `hasMorePath` is ignored for `cursor` type (only `id` reads it).
`runner.ts:630` computes next params from the records AFTER `transform` and
`exclude` mutated them, so a transform that drops the id breaks `id` paging.

### 1.5 Extraction, paths and templates

There is no mapping DSL. A record is the raw API object, stored as-is in
`mem_records.data`. Shaping tools:

- `resultsPath` + `extractRecords` (`extract.ts:51-99`): dot path to the array,
  root-array tokens, primitives wrapped as `{[idField]: String(v)}`, a useful
  error that names the top-level keys.
- `exclude`: two different implementations. Runner `stripFields`
  (`runner.ts:56-96`) understands `messages[]` segments; enrich
  `stripExcludedFields` (`enrich.ts:91-131`) rewrites `[]` to `.*`.
- `derive` (`mem-writer.ts:438-470`): flat top-level fields from a path, first
  value wins, optional `extract: "email"`.
- `memory.searchable` (`mem-writer.ts:116-155`): list of paths whose string,
  number and boolean leaves are joined with spaces into `searchable_text`.
  Objects are not walked. Without it, `defaultSearchableText` walks the whole
  record (capped at 4000 chars, `lib/memory/embedding.ts:214`).
- `transform`: `sh -c <command>`, 60 s timeout, falls back to the original
  records on any failure (`transform.ts`). Not usable on a server or Windows.
- Enrich templates: `{field}` / `{{field.sub}}` regex interpolation over the
  list record (`enrich.ts:37-59`). No filters, no defaults, no array index.

Path syntaxes in play (this is the main thing to clean up):

| Resolver | Syntax | Used by |
|---|---|---|
| `lib/dot-path.ts getByDotPath` | `a.b.0.c` | resultsPath, idField, pagination |
| `enrich.ts:76 getByDotPath` (local copy) | `a.b` only | enrich resultsPath, `fields` |
| `mem-writer.ts:60 resolveWildcardPath` | `a[].b`, `a[0].b` | `memory.searchable` |
| `mem-writer.ts:484-549 resolveIdentityPath` | `a[].b`, `a[0]`, `a.0`, `a[name=From].value` | identityKey(s), derive |

`resolveIdentityPath` is the superset and the one to keep.

### 1.6 Enrichment, "phase 2" (`enrich.ts`)

Runs after the whole list has been paged:

1. Requires the SQLite mirror. Selects rows `WHERE _enriched_at IS NULL`.
2. If `invalidateOn` is set, first clears the stamp on rows whose stored
   fingerprint (`_enrich_fp`) differs from the list value (`enrich.ts:320-355`),
   null safe, never for rows that were never fingerprinted. `--re-enrich` clears
   all stamps.
3. Batches of `concurrency` (default 5), `Promise.allSettled`, one detail call
   per row with interpolated pathVars/query/body (`enrich.ts:646-708`).
4. Retry per row, 3 attempts: 429 sleeps `Retry-After` or `2s*2^n` capped 60 s;
   5xx sleeps `3s*2^n` capped 20 s; 401/403 rethrow; other errors back off
   `2s*2^n`. After 3 failures the row is skipped (counted `rateLimited` or
   `skipped`) and retried next run because it stays unstamped. "Shared backoff"
   means the next batch waits after any 429.
5. `fields` pick, `exclude`, deep merge into the list record (or replace),
   stamp `_enriched_at`, run `transform`, write to SQLite and to memory.

Subtle rule (`mem-writer.ts:213-264`): on later runs phase 1 still writes the
thin list shape for already-enriched rows, but non-authoritatively (`replace:
false`, `preserveDerived: true`) so it does not erase the enriched payload.
This complexity exists only because list and detail are merged into one blob.

### 1.7 Scheduling (`schedule.ts`, `schedule-registry.ts`)

`sync schedule add <platform> --every 15m` writes a crontab line
`cd <cwd> && <node> <cli> sync run <platform> [--models] >> log 2>&1 # one-sync:<id>`
and records it in `~/.one/sync/schedules.json`. `durationToCron` only accepts
`Nm` dividing 60, `Nh` dividing 24, or `1d` (`schedule.ts:25-44`). `status`
reports drift (cron line missing, node or CLI path moved) and `repair`
reinstalls. No jitter, no backoff after failures, no per-model intervals.

### 1.8 State and cursors (`state.ts`, `runner.ts`)

- `since` for a run: `--full-refresh` -> none; `--since` -> parsed; else
  `lastSync` (end time of the last successful run); else now minus 90 days
  (`runner.ts:263-275`). It is only sent if the profile has `dateFilter`, and
  only as a query param (`runner.ts:304-318`). Without `dateFilter` every run
  re-lists the whole collection (a warning is printed).
- After every page the NEXT page's cursor is saved with status `syncing`
  (`runner.ts:638-649`). If the previous run is `failed` and has a cursor, the
  next run resumes from it (`runner.ts:345-369`).
- On success: `lastSync = now`, `lastCursor = null`, `status = idle`.
- `mem_sync_state.last_error` exists in the table but `updateModelState` never
  passes an error, so it is always written as NULL (`state.ts:42-54, 134-152`).
  Errors only live in the thrown message.

### 1.9 Locking (`lock.ts`)

`mkdirSync` of `.one/sync/locks/<platform>_<model>` (atomic), pid file inside.
Takeover if the pid is dead or the directory is older than 30 minutes. SIGINT
and SIGTERM handlers mark state `failed`, close the backend and release the lock
(`runner.ts:216-243`). Single machine only.

### 1.10 Search (`search.ts`, `lib/memory/schema.ts:515-573`)

- Index: one row per record in `mem_records`. `searchable tsvector GENERATED
  ALWAYS AS (to_tsvector('english', searchable_text))` with a GIN index;
  `embedding vector(1536)` with an HNSW index; GIN on `keys`, `identity_keys`,
  `data jsonb_path_ops`.
- `mem_hybrid_search`: FTS ranked by `ts_rank_cd(websearch_to_tsquery)` and
  vectors by cosine distance, each top `2*match_count`, fused with Reciprocal
  Rank Fusion (`k = 50`, weights 0.3 FTS and 0.7 semantic).
- `searchSyncedData` embeds the query once (OpenAI) and calls the function
  once per `platform/model` type, then sorts all results together by score.
- Embedding: one vector per record from `searchable_text`, sliced to 8000 chars
  (`lib/memory/embedding.ts:63`). `prepareRecord` (`lib/memory/runtime.ts:222-243`)
  embeds on every upsert when embedding is on, even if `content_hash` did not
  change, so every sync re-pays for every unchanged record.

### 1.11 suggest-searchable (`suggest-searchable.ts`)

Walks a sample of records (`test.ts` uses 5), collects every string, number and
boolean leaf path in `a.b[]` syntax, and scores each:
`hitRate * log1p(min(avgLen, 500)) * (1 - noiseFraction)^2 * shortPenalty * typePenalty`.
Noise is UUID, ISO timestamp, short URL, numeric string or an enum marker
(`suggest-searchable.ts:31-59`); booleans weigh 0.05, numbers 0.1, mixed 0.5.
Paths starting with `_` are skipped. Output is the top 15 with a sample value,
which an agent pastes into `memory.searchable`. This is directly useful for
Search's Settings mapper ("suggest fields").

### 1.12 Identity keys and dedupe (`mem-writer.ts:383-686`, `identity-keys.test.ts`)

Two kinds, deliberately in separate columns:

- **Entity key** (`identityKey`, singular): "this record IS this entity". Goes
  into `keys[]`, which drives upsert merge and a uniqueness trigger, so an Attio
  person and a Stripe customer with the same email collapse into ONE row. The
  prefix comes from the path name: contains `email` -> `email:`, `phone` ->
  `phone:`, `domain` -> `domain:`, else `id:` (`383-389`). Email values are
  pulled out of `"Jane <jane@acme.com>"` with a liberal regex (`393`), with a
  scalar fallback. A path that resolves to more than one distinct value yields
  NO key (`610-623`), so a fan-out can never merge two entities.
- **Association keys** (`identityKeys`, plural): "this record INVOLVES these
  people". `[{prefix, path}]`, `[]` fan-out, `[name=From]` filters, email
  extraction from headers and comma lists, prefixes normalized to `[a-z0-9_]+`,
  deduped in first-seen order. Stored in `identity_keys[]`, never merged.
  Queried by `one mem find-by-key email:jane@acme.com`.
- Record dedupe: the source key `<platform>/<model>:<id>` is always in `keys[]`,
  so a re-sync upserts the same row. Sync writes with `replace: true` so removed
  fields disappear.
- Tri-state contract for `identity_keys`: `undefined` keeps, `[]` clears,
  `[a,b]` replaces. Used so the pre-enrich list shape never wipes keys.

Not done: no domain-to-company keys, no free-mail domain list, no name
handling, no entity table. "People" exist only as merged CRM rows plus strings
in other rows' `identity_keys`.

### 1.13 Deletes

Only `--full-refresh`: after a run where pagination finished naturally and at
least one page was fetched, rows of that type whose source key was not seen are
archived with reason `deleted_upstream` (`runner.ts:661-758`). The guard exists
because `--max-pages 3 --full-refresh` once archived 57 valid Fathom rows. An
incremental run never deletes anything; there is no tombstone predicate and
no handling of a 404 from the detail call.

### 1.14 How profiles are shared

- **Built-ins** ship inside the npm package, `one sync profiles [platform]`
  lists them, `sync init` copies one into the project. `findMissingBuiltinCapabilities`
  (`builtin-profiles.ts:73-95`) warns when a shipped built-in has gained one of
  `identityKeys, identityKey, enrich, dateFilter, memory` that the installed
  copy lacks. That curated list is the only versioning there is.
- **No export, import, URL or registry.** `mem export/import` move records
  (JSONL), not profiles. Sharing a profile today means copying the JSON file or
  pasting it into `sync init --config`.
- `mem migrate --heal` re-reads the built-in to fix a stale `idField`.

---

## 2. Built-in profiles

the One CLI repo's `profiles/`:

| Platform | Model | List action | Paging | Incremental | Enrich | Identity |
|---|---|---|---|---|---|---|
| attio | attioCompanies | records query (POST) | offset, body | none | no | (see file) |
| attio | attioPeople | records query (POST) | offset, body | none | no | `identityKey` first email |
| fathom | meetings | meetings list | cursor + has_more | `created_after` iso8601 | yes, transcript | recorded_by, invitees |
| gmail | gmailThreads | threads.list | token | none | yes, threads.get full | From/To/Cc/Bcc headers |
| google-calendar | events | events.list | token | none | no | organizer, attendees |
| hacker-news | topStories | topstories.json | none | none | no | none |
| notion | search | POST /v1/search | body cursor | none | no | none |
| stripe | balanceTransactions | list | id | (see file) | no | none |
| stripe | customers | list | id | none | no | `identityKey: email` |

Gmail threads, in full:

```json
{
  "description": "Gmail email threads, primary inbox with full message bodies (no attachments)",
  "platform": "gmail",
  "model": "gmailThreads",
  "connection": { "platform": "gmail" },
  "actionId": "conn_mod_def::GJ3ok-Q0D40::oLWNlcx4QDORaL_18z-MsQ",
  "resultsPath": "threads",
  "idField": "id",
  "pagination": { "type": "token", "nextPath": "nextPageToken", "passAs": "query:pageToken" },
  "limitParam": "maxResults",
  "defaultLimit": 100,
  "pathVars": { "userId": "me" },
  "queryParams": { "q": "category:primary" },
  "identityKeys": [
    { "prefix": "email", "path": "messages[].payload.headers[name=From].value" },
    { "prefix": "email", "path": "messages[].payload.headers[name=To].value" },
    { "prefix": "email", "path": "messages[].payload.headers[name=Cc].value" },
    { "prefix": "email", "path": "messages[].payload.headers[name=Bcc].value" }
  ],
  "derive": {
    "from_email": { "path": "messages[0].payload.headers[name=From].value", "extract": "email" }
  },
  "enrich": {
    "actionId": "conn_mod_def::GJ3ok0Eq0R8::AAzgZVLqTg2iBuITKpJLZg",
    "pathVars": { "userId": "me", "id": "{id}" },
    "queryParams": { "format": "full" },
    "exclude": ["messages[].payload.parts[].body.data", "messages[].payload.body.data"],
    "concurrency": 5
  }
}
```

(The description is quoted from the file with its dash swapped for a comma.) Three things
to notice for Search: it strips `body.data`, so message bodies are never stored
or searchable despite the description (only snippets and headers survive); it
has no `dateFilter`, so every run re-lists all primary threads; and it has no
`enrich.invalidateOn: "historyId"`, so a thread that gets a new reply is never
re-fetched.

Fathom meetings, in full (the one built-in with both incremental and enrich):

```json
{
  "platform": "fathom",
  "model": "meetings",
  "connection": { "platform": "fathom" },
  "actionId": "conn_mod_def::fathom::meetings-list",
  "resultsPath": "items",
  "idField": "recording_id",
  "pagination": { "type": "cursor", "nextPath": "next_cursor", "passAs": "query:cursor", "hasMorePath": "has_more" },
  "dateFilter": { "param": "created_after", "format": "iso8601" },
  "defaultLimit": 50,
  "queryParams": { "include_action_items": "true" },
  "identityKeys": [
    { "prefix": "email", "path": "recorded_by.email" },
    { "prefix": "email", "path": "calendar_invitees[].email" }
  ],
  "enrich": {
    "actionId": "conn_mod_def::GIpBYFV5Mog::G6aag6ykQ-uD6XCeUUnq7Q",
    "pathVars": { "RECORDING_ID": "{recording_id}" },
    "concurrency": 3
  }
}
```

There are no built-ins for HubSpot, Outlook Mail, Outlook Calendar, Linear,
Slack, Teams or Granola, all of which Search needs.

---

## 3. Gaps against what Search needs

| Need | CLI today | Gap and consequence |
|---|---|---|
| Incremental cursors | `lastSync` wall-clock end time as `since`, query-only `dateFilter` (`runner.ts:270, 304-318, 839-840`) | Records modified while a run is in flight are missed (since = end time, no overlap). No body or templated filters, so Gmail `q=after:`, HubSpot `filterGroups`, Linear `filter.updatedAt.gt` and Graph `$filter` cannot be expressed. No delta/sync tokens (Graph delta, Calendar `syncToken`, Gmail `history.list`). No watermark from the data itself. |
| Retries, 429, Retry-After | Per page: 3 retries, Retry-After honoured else 30 s doubling to 120 s; 5xx 5/10/20 s; network 2/4/8 s (`runner.ts:376-424`). Enrich has its own copy with other numbers. | Logic is fine but duplicated, has no jitter, no per-connection rate budget shared across models, and the run fails after 3 tries with no scheduled retry. Need to check that Connect's `runAction` surfaces the provider's `Retry-After`; and `blockedByGrant` 403 must never be retried. |
| Deletes, tombstones | Archive by absence on `--full-refresh` only | No delete signals from incremental feeds (Graph `@removed`, Calendar `status: cancelled`, Notion `in_trash`/`archived`, HubSpot `archived: true`, Slack `message_deleted`), no 404-on-hydrate tombstone, no scheduled reconcile. Deleted mail stays searchable forever. |
| Per-source health | Status `idle/syncing/failed` plus a thrown string; `last_error` always NULL (`state.ts:42-54`) | No run history, no last success vs last attempt, no counts per run persisted, no auth-needed vs grant-blocked vs rate-limited distinction, nothing to drive a Settings "Sources" card. |
| Re-index on map change | Curated capability field diff for built-ins only (`builtin-profiles.ts:73`) | No profile version or hash. Editing `searchable` does not rewrite existing rows' text; editing `exclude` or `identityKeys` needs a full re-sync with API calls. Search needs map changes re-applied from stored raw payloads with zero API calls. |
| Entity mapping | Entity key (merge) and association keys, email only | No people/company tables, no display names, no domain-to-company with a free-mail denylist, no "self" detection, no roles (from/to/attendee/owner). |
| Link templates | none | No way to build "open in Gmail/HubSpot/Linear" URLs; needs per-connection variables (Gmail account email, HubSpot portal id, Slack team domain). |
| Jev classification | none | Needs an async stage after upsert, gated by content hash, never on the sync path. |
| Multi-model per source | one file per `(platform, model)`, all models run sequentially by `sync run <platform>` | Fine as a unit, but nothing groups them for sharing, and there is no shared rate budget per connection. |
| Get-by-id hydration | `enrich` exists, needs the SQLite mirror, deep merges list and detail into one blob | The merge creates the "never degrade" special case (`mem-writer.ts:213-264`). Search should keep `item` and `detail` as separate raw parts and hydrate in the same page pass (page then its hydrations then upsert), so a crash never leaves thin documents searchable. Also needs batch hydration (Gmail batch, HubSpot batch read, Graph `$batch`) and sub-resource fetches (Notion block children, Slack thread replies). |
| Rich text to plain text | none (Gmail body bytes are stripped instead) | Needs named decoders: Gmail MIME (base64url parts, prefer text/plain, else HTML), HTML (Graph `body.contentType: html`, HubSpot notes), Notion blocks, Slack mrkdwn with user mentions, ProseMirror (Linear), quoted reply and signature trimming for mail. |
| Chunking for embeddings | one vector per record, 8000 chars, re-embedded on every sync (`runtime.ts:222-243`) | Long threads and docs lose everything after 8000 chars; unchanged records cost an embedding call every run. Need chunks with a text hash and an embedding cache keyed by `(sha256(text), model)`. |
| Server runtime | shell `transform` and hooks, crontab, filesystem lock, cwd-relative files | None of these work in the Search server or a Worker. Replace with pure-JS named functions, an in-process scheduler, and Postgres advisory locks. |
| Search ranking | one `tsvector` per row, `english` config hard-coded, no field weights, per-type search then merge | No title vs body weighting, no language handling, no filters by person/date/source in the SQL function, and each type gets its own top-N before fusion. |

---

## 4. Proposed profile format for Search

Design rules:

1. One engine, one declarative format, for built-ins and for whatever the user
   maps in Settings. No code per platform except named decoders (`gmail-mime`,
   `html`, `notion-blocks`, ...) which are pure functions in the engine.
2. One path syntax everywhere: the CLI's `resolveIdentityPath` grammar
   (`a.b`, `a.0`, `a[0]`, `a[]`, `a[name=From]`).
3. One template syntax for every request value, link and text template:
   `{{ expr | filter:arg }}`.
4. Raw payloads (`item`, `detail`) are stored as fetched, so mapping changes
   re-run from storage with no API calls.
5. Every call runs on the user's Connect grant (`runAction`). The profile names
   `actionId`s only, never keys.

### 4.1 TypeScript type

```ts
/** A path in the CLI identity-path grammar: a.b, a.0, a[0], a[], a[name=From] */
type Path = string;

/** "{{ item.id }}", "after:{{ run.since | unix }}", or a literal. */
type Template = string;

/**
 * A field expression. A bare string is a Path. Object forms:
 *  - { path, pick }            first (default) | all | join
 *  - { template }              string template over the same context
 *  - { path, decode }          run a named decoder on the resolved value(s)
 *  - { coalesce: Expr[] }      first non-empty
 */
type Expr =
  | Path
  | { path: Path; pick?: 'first' | 'all' | 'join'; sep?: string; decode?: Decoder; filter?: string }
  | { template: Template }
  | { coalesce: Expr[] };

type Decoder =
  | 'text'            // trim, collapse whitespace
  | 'html'            // HTML to text, drop script/style, keep link text
  | 'markdown'        // strip markup
  | 'gmail-mime'      // Gmail payload: walk parts, base64url, prefer text/plain
  | 'graph-body'      // Graph { contentType, content }
  | 'notion-blocks'   // array of Notion blocks (rich_text[].plain_text)
  | 'notion-title'    // properties.*[type=title].title[].plain_text
  | 'slack-mrkdwn'    // <@U123> to names, <url|label> to label
  | 'prosemirror'     // Linear / Tiptap JSON
  | 'mail-strip'      // drop quoted replies and signatures after decoding
  | 'email'           // address out of "Jane <jane@acme.com>"
  | 'domain'          // domain of an email or URL
  | 'datetime';       // any of iso8601, unix s/ms, RFC 2822 to ISO 8601 UTC

interface RequestSpec {
  actionId: string;                       // conn_mod_def::...
  pathVars?: Record<string, Template>;
  query?: Record<string, Template | Template[]>;
  body?: unknown;                         // JSON with Template strings anywhere
  headers?: Record<string, Template>;
}

type Pagination =
  | { type: 'none' }
  | { type: 'cursor'; next: Path; passAs: `${'query' | 'body' | 'header'}:${string}`; hasMore?: Path }
  | { type: 'offset'; passAs: string; total?: Path; start?: 0 | 1 }
  | { type: 'page'; passAs: string; start?: 0 | 1; totalPages?: Path }
  | { type: 'lastId'; idPath: Path; passAs: string; hasMore?: Path }
  | { type: 'linkHeader' }                                   // RFC 5988 rel="next", follow full URL
  | { type: 'nextUrl'; next: Path };                          // Graph @odata.nextLink, Slack response_metadata

type Incremental =
  /** Re-list everything every run; deletes by reconcile. */
  | { strategy: 'full' }
  /**
   * Filter by a modified-time watermark taken FROM THE DATA (max of `field`
   * seen), not the wall clock. The filter lives in the list request as
   * {{ cursor.watermark }}. `overlap` re-reads a margin for clock skew.
   * `restartOnCap`: when the API caps a query (HubSpot search, 10k), re-issue
   * the query from the newest watermark seen; requires ascending sort.
   */
  | { strategy: 'watermark'; field: Path; overlap?: string; restartOnCap?: number; initial?: string }
  /**
   * Provider change feed. The token is read from the last page (`tokenPath`)
   * and passed on the next run as {{ cursor.token }}. `resetOn` statuses
   * (410 Gone for Google syncToken, Graph resync) drop the token and run a
   * full pass. `bootstrap` is the list request used when there is no token.
   */
  | { strategy: 'delta'; tokenPath: Path; request: RequestSpec; resultsPath: Path;
      pagination: Pagination; resetOn?: number[] };

interface Hydrate {
  /** Detail call per list item. Context: item. Result available as `detail`. */
  request: RequestSpec;
  resultsPath?: Path;                     // default: whole response
  /** Skip the call when this template renders the same as last time. */
  fingerprint?: Template;                 // e.g. "{{ item.historyId }}"
  /** Extra child fetches, e.g. Notion block children, Slack thread replies. */
  children?: Array<{ as: string; request: RequestSpec; resultsPath: Path; pagination?: Pagination; maxPages?: number }>;
  concurrency?: number;                   // default 4
  /** Detail 404/410 means the item is gone: tombstone it. Default true. */
  notFoundIsDelete?: boolean;
}

interface Deletes {
  /** Item-level predicate in the filter mini-language, e.g. "status == 'cancelled'". */
  when?: string;
  /** Reconcile by absence: after a COMPLETE full pass only. */
  reconcile?: 'never' | 'onFullPass';
  /** How often to force a full pass when incremental feeds have no delete signal. */
  fullPassEvery?: string;                 // "7d"
}

type Kind = 'message' | 'thread' | 'event' | 'person' | 'company' | 'deal'
          | 'doc' | 'issue' | 'meeting' | 'note' | 'task' | 'record';

/** The normalized document every source maps into. */
interface FieldMap {
  title: Expr;
  body?: Expr;                            // decoded to plain text
  snippet?: Expr;
  occurredAt: Expr;                       // sent / start / created
  updatedAt?: Expr;
  url?: Template;                         // link template, see 4.3
  container?: Expr;                       // folder, channel, calendar, pipeline, project, database
  status?: Expr;
  labels?: Expr;                          // array of strings
  facets?: Record<string, Expr>;          // extra filterable fields: amount, stage, priority...
}

interface EntityRef {
  role: 'from' | 'to' | 'cc' | 'attendee' | 'organizer' | 'owner' | 'assignee' | 'author' | 'mentioned' | 'about';
  type: 'person' | 'company';
  email?: Expr;                           // fan-out allowed: one ref per value
  name?: Expr;
  domain?: Expr;
  externalId?: Expr;                      // provider user id (Slack U123), resolved via a directory profile
}

interface Entities {
  /** This document IS an entity (CRM contact/company). At most one value, same guard as the CLI. */
  is?: { type: 'person' | 'company'; email?: Expr; domain?: Expr; name?: Expr };
  /** People and companies this document involves. Companies are also derived from email domains. */
  refs?: EntityRef[];
  /** Don't create companies for these domains (gmail.com, outlook.com, ...). Engine default list plus this. */
  ignoreDomains?: string[];
}

interface Chunking {
  strategy: 'whole' | 'paragraph' | 'message' | 'heading';
  /** For 'message': array path inside detail whose elements become chunks. */
  unit?: Path;
  unitBody?: Expr;
  maxTokens?: number;                     // default 400
  overlapTokens?: number;                 // default 50
  /** Prepended to every chunk so each embeds with context. */
  header?: Template;                      // "{{ doc.title }} | {{ doc.container }}"
}

interface Classify {
  /** Jev judgment run after upsert, only when the document's body hash changed. */
  jev: { question: Template; output: 'labels' | 'boolean' | 'score'; labels?: string[]; into: string };
  when?: string;                          // filter, e.g. "kind == 'thread' && occurredAt > now - 30d"
}

interface Limits {
  requestsPerMinute?: number;             // shared per connection across all of the source's models
  maxPagesPerRun?: number;                // a capped run never reconciles and keeps its cursor
  maxItemsPerRun?: number;
}

export interface SearchProfile {
  $schema: 'https://search.local/schema/profile-1.json';
  id: string;                             // "gmail.threads" (platform.model)
  platform: string;                       // One platform slug
  model: string;
  kind: Kind;
  title: string;                          // "Gmail threads"
  description?: string;
  author?: string;                        // "builtin" | user id | URL it came from
  revision?: number;                      // human revision, informative only; the hash decides re-index

  /** Per-connection variables, fetched once per connection and cached (Gmail address, HubSpot portalId). */
  account?: { request: RequestSpec; vars: Record<string, Path> };

  list: RequestSpec & { resultsPath: Path; idPath: Path; pagination: Pagination; pageSize?: { param: string; value: number; in?: 'query' | 'body' } };
  incremental: Incremental;
  hydrate?: Hydrate;
  deletes?: Deletes;

  /** Item filter applied after fetch (drop drafts, spam, bots). */
  keep?: string;

  fields: FieldMap;
  entities?: Entities;
  chunk?: Chunking;
  classify?: Classify[];
  limits?: Limits;
  schedule?: { every: string };           // "10m"; jittered by the engine
}

/** What gets shared: one file, several models of one source. */
export interface SearchProfilePack {
  $schema: 'https://search.local/schema/pack-1.json';
  name: string;                           // "Gmail"
  platform: string;
  profiles: SearchProfile[];
}
```

Template context, the same for every template in a profile:

| Name | Meaning |
|---|---|
| `item` | the list element |
| `detail` | the hydrate result (absent before hydrate) |
| `children.<as>` | child fetch results |
| `doc` | already-mapped fields (only in `url`, `chunk.header`, `classify`) |
| `cursor.watermark`, `cursor.token` | committed cursor |
| `run.since`, `run.now`, `run.full` | run parameters; `run.since` = watermark minus overlap, or `initial` |
| `account.<var>` | per-connection vars from `account` |
| `settings.<key>` | user settings for this source from the Settings screen (folders to skip, calendars to include) |

Filters (small, closed list): `iso`, `unix`, `unixms`, `date:"yyyy/MM/dd"`,
`lower`, `upper`, `email`, `domain`, `urlencode`, `json`, `join:","`, `first`,
`default:"x"`. The `keep`, `deletes.when` and `classify.when` predicates use a
tiny expression language (`== != > < && || in`, path operands, `now - 30d`).
Build it on a real parser, not regex, and never `eval`.

### 4.2 Examples

Gmail threads (reuses the CLI built-in's action ids, which are known to work):

```json
{
  "$schema": "https://search.local/schema/profile-1.json",
  "id": "gmail.threads",
  "platform": "gmail",
  "model": "threads",
  "kind": "thread",
  "title": "Gmail threads",
  "author": "builtin",
  "account": {
    "request": { "actionId": "<Gmail: Get the user's profile>", "pathVars": { "userId": "me" } },
    "vars": { "email": "emailAddress" }
  },
  "list": {
    "actionId": "conn_mod_def::GJ3ok-Q0D40::oLWNlcx4QDORaL_18z-MsQ",
    "pathVars": { "userId": "me" },
    "query": { "q": "-in:spam -in:trash -in:draft after:{{ run.since | unix }}" },
    "resultsPath": "threads",
    "idPath": "id",
    "pagination": { "type": "cursor", "next": "nextPageToken", "passAs": "query:pageToken" },
    "pageSize": { "param": "maxResults", "value": 100 }
  },
  "incremental": { "strategy": "watermark", "field": "detail.messages[].internalDate", "overlap": "1h", "initial": "365d" },
  "hydrate": {
    "request": {
      "actionId": "conn_mod_def::GJ3ok0Eq0R8::AAzgZVLqTg2iBuITKpJLZg",
      "pathVars": { "userId": "me", "id": "{{ item.id }}" },
      "query": { "format": "full" }
    },
    "fingerprint": "{{ item.historyId }}",
    "concurrency": 5
  },
  "deletes": { "reconcile": "onFullPass", "fullPassEvery": "7d" },
  "fields": {
    "title": { "coalesce": ["detail.messages[0].payload.headers[name=Subject].value", { "template": "(no subject)" }] },
    "body": { "path": "detail.messages[].payload", "pick": "all", "decode": "gmail-mime" },
    "snippet": "item.snippet",
    "occurredAt": { "path": "detail.messages[0].internalDate", "decode": "datetime" },
    "updatedAt": { "path": "detail.messages[-1].internalDate", "decode": "datetime" },
    "url": "https://mail.google.com/mail/u/{{ account.email | urlencode }}/#all/{{ item.id }}",
    "labels": { "path": "detail.messages[].labelIds[]", "pick": "all" }
  },
  "entities": {
    "refs": [
      { "role": "from", "type": "person", "email": { "path": "detail.messages[].payload.headers[name=From].value", "pick": "all", "decode": "email" }, "name": { "path": "detail.messages[].payload.headers[name=From].value", "pick": "all" } },
      { "role": "to", "type": "person", "email": { "path": "detail.messages[].payload.headers[name=To].value", "pick": "all", "decode": "email" } },
      { "role": "cc", "type": "person", "email": { "path": "detail.messages[].payload.headers[name=Cc].value", "pick": "all", "decode": "email" } }
    ]
  },
  "chunk": {
    "strategy": "message",
    "unit": "detail.messages[]",
    "unitBody": { "path": "payload", "decode": "gmail-mime" },
    "header": "{{ doc.title }}",
    "maxTokens": 400
  },
  "classify": [
    { "jev": { "question": "Is this thread a newsletter, receipt or automated notification?", "output": "labels", "labels": ["newsletter", "receipt", "notification", "personal"], "into": "facets.mailType" },
      "when": "occurredAt > now - 90d" }
  ],
  "limits": { "requestsPerMinute": 240 },
  "schedule": { "every": "5m" }
}
```

Notes: `[-1]` (last element) is a small extension to the CLI grammar. The
`account` action id is a placeholder to look up with `one actions find gmail
"get profile"`. Gmail `q` takes `after:<epoch seconds>`. A later upgrade is a
`delta` strategy on `users.history.list` with `startHistoryId`, which also gives
real delete signals; the watermark version is simpler and good enough to ship.

HubSpot contacts (action id from `one actions find hubspot`, "Search CRM
Contacts", `POST /crm/v3/objects/contacts/search`, read from the CLI cache):

```json
{
  "$schema": "https://search.local/schema/profile-1.json",
  "id": "hubspot.contacts",
  "platform": "hubspot",
  "model": "contacts",
  "kind": "person",
  "title": "HubSpot contacts",
  "author": "builtin",
  "account": {
    "request": { "actionId": "<HubSpot: account info / access token details>" },
    "vars": { "portalId": "portalId" }
  },
  "list": {
    "actionId": "conn_mod_def::GJ3kSC2Sp7I::L6cYnwOfTUatg0cXeWjCBA",
    "body": {
      "filterGroups": [{ "filters": [{ "propertyName": "lastmodifieddate", "operator": "GTE", "value": "{{ run.since | unixms }}" }] }],
      "sorts": [{ "propertyName": "lastmodifieddate", "direction": "ASCENDING" }],
      "properties": ["email", "firstname", "lastname", "company", "jobtitle", "phone", "lifecyclestage", "hs_lead_status", "notes_last_updated", "lastmodifieddate", "hubspot_owner_id"]
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
      { "template": "{{ item.properties.firstname }} {{ item.properties.lastname }}" },
      "item.properties.email" ] },
    "body": { "template": "{{ item.properties.jobtitle }} at {{ item.properties.company }}. Stage {{ item.properties.lifecyclestage }}. {{ item.properties.hs_lead_status }}" },
    "occurredAt": { "path": "item.createdAt", "decode": "datetime" },
    "updatedAt": { "path": "item.properties.lastmodifieddate", "decode": "datetime" },
    "url": "https://app.hubspot.com/contacts/{{ account.portalId }}/record/0-1/{{ item.id }}",
    "status": "item.properties.lifecyclestage",
    "facets": { "owner": "item.properties.hubspot_owner_id", "company": "item.properties.company" }
  },
  "entities": {
    "is": { "type": "person", "email": { "path": "item.properties.email", "decode": "email" },
            "name": { "template": "{{ item.properties.firstname }} {{ item.properties.lastname }}" } },
    "refs": [ { "role": "about", "type": "company", "name": "item.properties.company", "domain": { "path": "item.properties.email", "decode": "domain" } } ]
  },
  "chunk": { "strategy": "whole" },
  "limits": { "requestsPerMinute": 100 },
  "schedule": { "every": "15m" }
}
```

Template rendering rule needed here: a template that renders to only spaces and
connector words ("  at . Stage .") must count as empty. Simplest implementation:
templates drop a segment when its `{{ }}` value is empty, using `{{# ... }}`
optional sections, or the mapper builds `body` from `pick: "join"` over several
paths. Pick one before building; the join form is easier to explain in the UI.

Generic profile, what the Settings mapper writes for "any other One integration"
(here a hypothetical list of Acme Inc support tickets):

```json
{
  "$schema": "https://search.local/schema/profile-1.json",
  "id": "acme-desk.tickets",
  "platform": "acme-desk",
  "model": "tickets",
  "kind": "record",
  "title": "Tickets",
  "author": "user",
  "list": {
    "actionId": "conn_mod_def::<from actions find>",
    "query": { "updated_since": "{{ run.since | iso }}" },
    "resultsPath": "data",
    "idPath": "id",
    "pagination": { "type": "cursor", "next": "meta.next_cursor", "passAs": "query:cursor" },
    "pageSize": { "param": "limit", "value": 100 }
  },
  "incremental": { "strategy": "watermark", "field": "item.updated_at", "overlap": "10m", "initial": "180d" },
  "deletes": { "reconcile": "onFullPass", "fullPassEvery": "7d" },
  "fields": {
    "title": "item.subject",
    "body": { "path": "item.description", "decode": "html" },
    "occurredAt": { "path": "item.created_at", "decode": "datetime" },
    "updatedAt": { "path": "item.updated_at", "decode": "datetime" },
    "status": "item.status"
  },
  "entities": { "refs": [ { "role": "author", "type": "person", "email": "item.requester.email", "name": "item.requester.name" } ] },
  "chunk": { "strategy": "paragraph" },
  "schedule": { "every": "30m" }
}
```

The mapper fills this from: `actions find` (list action), a test fetch of one
page (pagination detected from the response, see 4.6), `suggestSearchablePaths`
over the sample (title and body candidates), and date-looking leaves for
`occurredAt`/`updatedAt` and the watermark field.

### 4.3 Link templates

`fields.url` is a template over `item`, `detail` and `account`. Variables a URL
needs that are not in the record (Gmail account address, HubSpot portal id,
Slack workspace domain, Notion has `item.url` already, Linear has `item.url`,
Graph messages have `webLink`) come from `account`, fetched once per connection
and cached in `sources.account_vars`. Prefer a URL the API returns (`url`,
`webLink`, `htmlLink`, `permalink`) over a template when one exists.

### 4.4 Engine stages

One run = one `(connection, profile)` source. Everything below is per page so a
crash loses at most one page of work.

```
acquire lease
  -> resolve account vars (cached)
  -> plan run: since, full pass?, cursor
  -> loop pages:
       fetch page            runAction(list) with retry policy
       extract               resultsPath, idPath, keep filter, delete predicate
       hydrate               only items whose fingerprint changed; children; 404 -> tombstone
       store raw             raw_items(item, detail, children, fetched_at)
       normalize             fields via Expr + decoders -> doc
       entity resolve        upsert people/companies, link doc <-> entity with role
       chunk                 chunk text, hash each chunk
       upsert                one transaction: documents, doc_entities, chunks (text, hash)
       tombstone             mark deleted docs from predicate / 404
       checkpoint            page cursor + max watermark seen (uncommitted)
  -> reconcile (only if full pass and pagination complete and pages > 0)
  -> commit cursor          watermark = max(field) seen; or delta token from last page
  -> release lease, write source_runs row, compute next_run_at
async workers (outside the run):
  embed                     chunks with no embedding for (text_hash, model); cache by hash
  classify                  Jev on docs whose body_hash changed since last judgment
```

Stage contracts worth stating:

- **Fetch.** One retry policy for list, hydrate and children. 429: wait
  `Retry-After` (seconds or HTTP date) else `min(30s * 2^n, 300s)` with plus or
  minus 20% jitter, up to 5 tries. 5xx and network errors: `min(2s * 2^n, 60s)`
  with jitter, up to 4. 401: source becomes `auth_needed`, stop. 403 with
  `blockedByGrant: true`: source becomes `grant_blocked`, stop, never retry.
  Other 4xx: fail the page with the response body truncated to 500 chars (the
  CLI's 500-char rule, `runner.ts:924`). A token bucket per connection, sized
  by `limits.requestsPerMinute`, is shared by every profile on that connection.
- **Hydrate.** Runs inside the page, before upsert, with
  `fingerprint` stored per document so an unchanged item costs zero calls.
  Batch variants (Gmail batch, HubSpot batch read, Graph `$batch`) can be a
  later `hydrate.batch` option; not needed for v1.
- **Store raw.** `item`, `detail`, `children` stored separately (JSONB, large
  binary fields stripped by a global rule: any string over 256 KB or any key
  named `data`/`attachment` with base64 content). Raw is what makes "re-index
  on map change" free.
- **Normalize.** Pure function `(profile.fields, raw, account) -> Doc`. Must be
  deterministic so its output can be hashed.
- **Entity resolve.** People keyed by lowercased email, companies by registrable
  domain (public suffix list), free-mail and the user's own domains excluded.
  `entities.is` merges the CRM record into the person/company (CLI fan-out
  guard: more than one distinct value means no merge). The connection's own
  address becomes `self`.
- **Chunk.** Token-counted chunks with `header` prefixed, `text_hash =
  sha256(header + text)`. Unchanged chunks keep their row and embedding.
- **Upsert.** Keyed by `(source_id, external_id)`. Write `map_hash`,
  `body_hash`. One transaction per page.
- **Tombstone.** `deleted_at` set, chunks deleted (or excluded from the search
  function), entity links kept for history. A tombstoned document that comes
  back un-deletes.
- **Cursor commit.** Per page: save `page_cursor` for resume. End of run: only
  if pagination completed, set `watermark = max(field)` across the run (data
  time, not wall clock), or the delta token from the final page. A capped run
  (`maxPagesPerRun`) keeps its page cursor and the old watermark, and never
  reconciles.

Postgres sketch:

```sql
sources(id, connection_key_ref, platform, model, profile_id, profile_hash, fetch_hash,
        status, -- ok | syncing | degraded | auth_needed | grant_blocked | paused
        watermark, delta_token, page_cursor, last_full_pass_at, account_vars jsonb,
        last_success_at, last_attempt_at, consecutive_failures, next_run_at, last_error jsonb)
source_runs(id, source_id, started_at, finished_at, outcome, pages, fetched, hydrated,
            upserted, tombstoned, skipped, http_status, retry_after, error jsonb, full_pass bool)
raw_items(source_id, external_id, item jsonb, detail jsonb, children jsonb, fingerprint, fetched_at)
documents(id, source_id, external_id, kind, title, body, snippet, url, container, status,
          labels text[], facets jsonb, occurred_at, updated_at, deleted_at,
          map_hash, body_hash, tsv tsvector)   -- setweight(title,'A') || setweight(body,'B')
chunks(id, document_id, ord, text, text_hash, embedding vector(N), embedding_model)
embedding_cache(text_hash, model, embedding)  -- dedupes across documents and re-indexes
people(id, email unique, name, company_id) ; companies(id, domain unique, name)
document_entities(document_id, entity_type, entity_id, role)
judgments(document_id, profile_classify_key, body_hash, output jsonb, judged_at)
```

Health for a Settings card comes straight from `sources` plus the last few
`source_runs`: "Synced 4 min ago, 12,301 items", "Rate limited, retrying at
10:42", "Needs reconnect", "Not in your grant".

### 4.5 Profile versioning and hashing

`revision` is for humans. The engine uses three hashes over the canonical JSON
(RFC 8785 JCS: sorted keys, no whitespace, numbers normalized) of parts of the
profile, plus the engine's own versions:

| Hash | Covers | On change |
|---|---|---|
| `fetch_hash` | `list`, `incremental`, `hydrate`, `keep`, `deletes`, `account` | Drop `watermark`, `delta_token`, `page_cursor`; next run is a full pass with reconcile. Hydrate fingerprints are cleared only if `hydrate` itself changed. |
| `map_hash` | `fields`, `entities`, `kind`, `chunk`, plus `DECODER_VERSION` | Re-normalize from `raw_items` for documents whose `map_hash` differs, in a background batch. Zero API calls. Chunks are re-cut; unchanged `text_hash` keeps its embedding. |
| `index_hash` | embedding model id and dimensions, `classify`, plus `CHUNKER_VERSION` | Embed or judge what is missing for the new key; the embedding cache makes swapping back free. |

`profile_hash = sha256(fetch_hash + map_hash + index_hash)` is what a shared
profile is identified by. Excluded from every hash: `title`, `description`,
`author`, `revision`, `schedule`, `limits` (they change behaviour, not data).
Bump `DECODER_VERSION` or `CHUNKER_VERSION` in code when a decoder or chunker
changes output, which re-maps every source using it.

Sharing: a `SearchProfilePack` JSON file is the unit. Import from a file, a
paste, or an https URL (fetched server-side, size capped, schema validated,
shown as a diff against the installed copy before saving). Built-ins ship as
packs in the repo. Since sources store `profile_hash`, a built-in update is
visible as "new version available" per source instead of the CLI's curated
field list.

### 4.6 Inference for "map any integration" in Settings

Better than the CLI's knowledge regexes:

1. List candidate list actions with `one actions find <platform> "list <thing>"`
   (or the catalog), dropping `custom` actions as `models.ts` does.
2. Do one real fetch on the user's grant. Detect `resultsPath` from the
   response (largest array of objects), `idPath` (`id`, `uuid`, `*_id`,
   nested `id.*`), and pagination from the response itself:
   `nextPageToken`, `next_cursor`, `paging.next.after`, `@odata.nextLink`,
   `response_metadata.next_cursor`, `has_more`, `meta.next`, `Link` header,
   in that order. Use `infer.ts`'s pattern list only as a fallback hint over
   the action knowledge, with the Google token rule fixed.
3. Rank text fields with `suggestSearchablePaths`, date fields by ISO/epoch
   shape, email fields by `EMAIL_RE`, and URL fields by name (`url`, `webLink`,
   `permalink`, `htmlLink`).
4. Optionally ask an LLM (on the grant) to propose `fields` from the sample and
   the action docs, then validate by rendering 5 sample documents in the UI
   before saving. The LLM output is a draft, never applied unseen.

### 4.7 Copy verbatim versus redesign

Copy (port to the Search engine package, keep the tests):

| What | From | Why |
|---|---|---|
| Path tokenizer and resolver (`[]`, `[0]`, `.0`, `[name=X]`) | `mem-writer.ts:484-549` | The one superset grammar; tested in `identity-keys.test.ts`. Add `[-1]`. |
| `EMAIL_RE`, `identityValuesFor` | `mem-writer.ts:393, 413-424` | Header and comma-list email extraction. |
| `normalizePrefix`, `dedupe` | `mem-writer.ts:567-583` | Key namespace hygiene. |
| Entity fan-out guard | `mem-writer.ts:599-623` | Never merge on an ambiguous value. |
| Entity vs association split | concept from `types.ts:70-107`, `schema.ts:56-63` | Maps directly to `entities.is` vs `entities.refs`. |
| `deriveFields` first-value semantics | `mem-writer.ts:438-470` | Same rule for `pick: "first"`. |
| `extractRecords` | `extract.ts:51-99` | Root arrays, primitive wrapping, good error text. |
| `parsePassAs`, `getNextPageParams` | `pagination.ts` | Base for cursor/offset/lastId; add `hasMore` to cursor, `page`, `linkHeader`, `nextUrl`. |
| `isNetworkError` | `runner.ts:29-38` | Network failure classification. |
| Retry classification (429 with Retry-After, 5xx, 401/403 stop) | `runner.ts:376-424`, `enrich.ts:646-708` | Merge into one policy with jitter. |
| Reconcile guards | `runner.ts:661-680, 745` | Only after a complete, non-empty full pass. |
| Fingerprint invalidation semantics | `enrich.ts:310-355` | Null-safe, never invalidate unfingerprinted rows. |
| `suggestSearchablePaths`, `isNoise` | `suggest-searchable.ts` (whole file) | Drives the Settings mapper. |
| RRF hybrid query | `lib/memory/schema.ts:515-573` | Adapt to `chunks` plus `documents.tsv`, add filters (source, kind, person, date range), group chunks to documents. |
| Signal cleanup idea | `runner.ts:216-243` | Mark the run failed and release the lease on shutdown. |

Redesign:

| What | CLI | Search |
|---|---|---|
| Storage | JSONB blob per record, SQLite mirror for enrich | `raw_items` + normalized `documents` + `chunks` |
| List and detail | deep merged, "never degrade" special case | stored separately, hydrate inside the page |
| Since | wall-clock `lastSync`, query param only | data watermark with overlap, delta tokens, templated anywhere |
| Deletes | absence on manual full refresh | predicates, 404 on hydrate, scheduled full pass |
| State | 6-field row, error dropped | `sources` + `source_runs` with typed statuses |
| Lock | mkdir + pid | `pg_try_advisory_lock(hashtext(source_id))` or a lease row with expiry |
| Schedule | crontab | in-process scheduler (Rill's scheduler tick pattern), jitter, backoff on `consecutive_failures` |
| Transform, hooks | shell commands | named decoders; internal events table |
| Embeddings | one per record, re-embedded every run, 8000-char cut | chunks, `embedding_cache` by text hash, async worker |
| Templates | `{field}` regex | `{{ expr \| filter }}` with a closed filter list |
| Inference | regex over docs | real sample fetch first, docs as hints, optional LLM draft |
| Versioning | curated capability field diff | three-part content hash |
| Sharing | none | packs by file, paste or URL, with a diff |

Also check before building: Rill's `packages/core` provider registry already has Gmail,
Outlook Mail, Google Calendar and Outlook Calendar provider mappers with
verified Gmail action ids and the Graph PascalCase gotchas listed in
Rill's `docs/CONTRACT.md`. Those are a good source for the Gmail and Outlook
built-in profiles and for the `gmail-mime` and `graph-body` decoders.
