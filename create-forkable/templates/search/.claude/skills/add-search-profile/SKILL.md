---
name: add-search-profile
description: Add a new built-in profile pack to Search (a new source such as Intercom conversations, Zendesk tickets or Asana tasks), end to end - find and read the One actions, write profiles/<platform>/pack.json, write Acme fixtures shaped from the documented responses, expect.json, regenerate connect.manifest.json, pass test:profiles. Use whenever someone asks to make a new tool searchable as a built-in, or to add a model (a new profile) to an existing pack.
---

# add-search-profile

A profile is plain JSON that tells the engine how to list, fetch, map and
index one model of one platform. A pack is every profile for one platform,
in `profiles/<platform>/pack.json`. No per-platform code: if you feel you
need TypeScript to make a source work, stop and re-read the format
(`docs/profiles.md`, `docs/CONTRACT.md` section 4).

You are done when `pnpm --filter @search/core test:profiles` passes with
your pack in it and `pnpm start` still exits 0. Nothing in this recipe
calls a real platform.

## Hard rules

- **Never execute an action.** Use `one --agent actions find` and
  `one --agent actions load` only. Fixtures are written by hand from the
  documented response, never recorded from a real account.
- **Read actions only.** A built-in pack never names a write action.
- **Acme Inc only.** Fixture people and companies come from
  `fixtures/sample/world.md` (Dana Oyelaran at Acme, Priya Shah at Globex,
  Initech, ...). No real company, customer or person.
- **No secrets, no connection keys** in a pack or a fixture. A profile
  names `actionId`s only; the connection comes from the user's grant.
- **`verified: "fixture"`** on every profile you add. Only a run on a real
  grant may flip it to `"real"`, and that is a separate, human-run step.
- **Do not touch** `fixtures/sample/expect-demo.json` or the demo. New
  packs are not part of the Acme demo (the demo indexes the 11 original
  sources only), so they cannot change its numbers.
- No push, no PR. A human opens the PR (step 10).

## The One CLI

Install it with `npm install -g @withone/cli`, then `one init`. It needs Node ^22.23.4, ^24.22.1 or >=26.12.1; if `one` refuses your Node, put a supported Node first on your PATH.

```sh
one --version   # 2.10.0 or later
```

## 1. Pick the platform slug and the models

```sh
one --agent actions find <platform> "list <things>" --task "index <things> for a search box"
```

The `platform` field in the answer is the slug: it becomes the pack folder,
`pack.platform`, every profile's `platform` and the prefix of every
profile id (`<platform>.<model>`, lower case, `[a-z0-9-]`). Check the
slug is not already a folder in `profiles/`.

Decide the model(s) and their `kind` (closed list): `person`, `company`,
`email_thread`, `event`, `doc`, `task`, `message`, `meeting_note`, `deal`,
`note`, `record`. Pick the one whose facets fit (CONTRACT 4.3). A support
conversation or ticket thread is usually `message` (one item per
conversation, the parts in the body) or `email_thread` if it reads like
mail; a ticket with a status and assignee can be `task`.

## 2. Load the docs for every action you will use

The `find` answer documents its pick inline as a digest. Load whatever it
left out, especially the response shape:

```sh
one --agent actions load <actionId> --section "Response Fields"
one --agent actions load <actionId> --section response     # the worked response example, when there is one
one --agent actions load <actionId> --full                 # everything
```

Both commands answer JSON. The docs are markdown inside it: the pick's
`knowledge` field in `find`'s `answers[].selected[]`, and
`loaded[0].knowledge` for `load`. Pipe through
`node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).loaded[0].knowledge))'`
to read it as text.

Write down for each action: method and path, path variables, query and
body parameters, the pagination fields (cursor name, `has_more`, next URL,
page number), the filter that limits to "updated since" (if any), the
date format of each date field (ISO string, unix seconds, unix ms), and
which fields hold the title, body, people (emails) and URL. If the list
answer is thin (ids only, or no body), find the "retrieve one" action for
`hydrate`. Where the docs say a field's structure is "not provided", note
your assumption; it goes in the fixture's `$shapedFrom` and the PR body.

Path variables: `pathVars` keys must be the placeholder names in the
action's `path` as `find` prints it (`/conversations/{{conversationId}}`
means `"pathVars": { "conversationId": "{{ item.id }}" }`), even when the
prose docs spell the parameter differently (`conversation_id`).

## 3. Choose the strategies

| Question | Answer in the profile |
|---|---|
| Can the list filter by updated time (query or search body)? | `incremental: { strategy: "watermark", field: "item.<updated>", order: "asc", overlap: "5m", initial: "{{ settings.backfill }}" }` and pass `{{ run.since \| iso }}` (or `\| unix`) in the request |
| Filters by updated time but cannot sort? | `watermark` with `order: "asc"` still works: the watermark is the highest value seen in the pass, whatever the page order |
| Sorted newest first and no filter? | `watermark` with `order: "desc"`: paging stops below the watermark |
| Sync token / delta link? | `strategy: "delta"`, `tokenPath`, `resetOn: [410]` |
| None of the above | `strategy: "full"` plus `deletes.reconcile: "onFullPass"` |
| Pagination | `cursor` (`next`, `passAs: "query:<param>"`, `hasMore`), `offset`, `page`, `lastId`, `relay` (GraphQL), `nextUrl`, `none`. `passAs: "body:a.b"` writes a nested body field, and `pageSize: { "param": "a.per_page", "in": "body" }` does the same for the page size |
| List lacks the body | `hydrate.request` on the retrieve action, `pathVars` from `{{ item.id }}`, `fingerprint: "{{ item.<updated> }}"` so unchanged items are not fetched again |
| Deleted or archived flag | `deletes.when: "item.<flag> == true"` |
| A 404 on hydrate | `hydrate.notFoundIsDelete: true` (the default) |

Settings the user can turn: copy the `backfill` setting from an existing
pack (`"backfill": { "type": "duration", "default": "365d", "label": "How far back" }`).

## 4. Write `profiles/<platform>/pack.json`

Start from the closest existing pack and change it, do not start blank:

- list + hydrate + watermark: `profiles/granola/pack.json`
- search body with filters and paging: `profiles/hubspot/pack.json`
- one item per message grouped into conversations: `profiles/outlook-mail/pack.json`
- partitions (channels) and child fetches (thread replies): `profiles/slack/pack.json`
- GraphQL with `relay` paging: `profiles/linear/pack.json`

Shape:

```json
{
  "$schema": "https://search.forkable.dev/schema/pack-1.json",
  "name": "<Display name>",
  "platform": "<slug>",
  "profiles": [ { "$schema": "https://search.forkable.dev/schema/profile-1.json", "id": "<slug>.<model>", "platform": "<slug>", "model": "<model>", "kind": "...", "title": "...", "description": "...", "author": "builtin", "revision": 1, "verified": "fixture", "enabledByDefault": true, "settings": {}, "list": {}, "incremental": {}, "fields": {}, "entities": {}, "chunk": {}, "limits": {}, "schedule": { "every": "15m" } } ]
}
```

Rules that trip people up:

- Paths: `a.b`, `a[0]`, `a[-1]`, `a[]` (every element), `a[type=admin]`,
  `a["key.with.dots"]`. Roots in fields: `item` (list element), `detail`
  (hydrate answer), `children.<as>`, `partition`, `account`, `settings`.
- Templates: `{{ expr | filter }}`, filters are a closed list: `iso`,
  `unix`, `unixms`, `date:"yyyy-MM-dd"`, `lower`, `upper`, `email`,
  `domain`, `urlencode`, `json`, `join:","`, `first`, `last`,
  `default:"x"`, `slackts`.
- `fields.title` and `fields.occurredAt` are required. Use
  `{ "path": "...", "decode": "datetime" }` for dates; it reads ISO
  strings, unix seconds and unix ms alike.
- Decoders: `text`, `html`, `markdown`, `mail-strip`, `graph-body`,
  `notion-blocks`, `notion-title`, `slack-mrkdwn`, `prosemirror`, `email`,
  `domain`, `datetime`, `address`, `number`. HTML bodies want `html`.
- A list of parts into one body: `{ "path": "detail.parts[].body", "pick": "join", "sep": "\n\n", "decode": "html" }`.
- `facets` keys must belong to the kind (CONTRACT 4.3) or start with `x_`.
- `fields.url` is a template that must render an absolute https URL, or
  leave it out.
- People: `entities.refs` with `role` (`from`, `to`, `cc`, `attendee`,
  `organizer`, `owner`, `assignee`, `author`, `mentioned`, `about`),
  `type: "person"`, `email: { "path": "...", "decode": "email" }`, `name`.
  For arrays use `"each": "detail.contacts[]"` and paths relative to the
  element (or `el` for the element itself, `{{ el.id }}`). Without an
  email a person only links by `externalId`, and that is an expression
  like every other field, so a built string needs a template:
  `"externalId": { "template": "intercom:contact:{{ id }}" }`. A bare
  string is read as a path and `check-packs` will not catch it.
- `fields.url`: when the web link needs an account value (a workspace or
  app id), get it from an `account` request (`account.vars`, used as
  `{{ account.<var> }}`); if no action returns it, leave `url` out.
- `chunk.strategy`: `whole` for short records (people, deals), `heading`
  for markdown docs and notes, `message` when the item has a list of
  messages you can name with `unit` (each message becomes one chunk with
  its own header), `paragraph` for anything else that is long.
- `TBD:` action ids fail validation for `author: "builtin"`; `sample::`
  ids only run in fixture mode and need `sampleOnly: true`. Use real
  `conn_mod_def::...` ids from step 1 and 2.
- Every request field you send (`query`, `body`, `headers`, `pathVars`)
  goes where the action docs say. A header the docs mark required (an API
  version, for example) goes in `headers`.

Validate statically before writing fixtures:

```sh
cd packages/core && pnpm exec tsx scripts/check-packs.ts
```

Every line must be `ok`; `FAIL` lines name the bad path, template or facet.

## 5. Write the fixtures

Folder: `fixtures/sample/<slug>/`. One file per action:

`<model>.pages.json` for a list (and for partitions):

```json
{
  "$shapedFrom": "<actionId> Response Fields (One CLI <version> actions load, <date>)",
  "actionId": "<the list actionId>",
  "pages": [
    { "match": { "cursor": null }, "response": { "...": "page 1, exactly the documented response shape" } },
    { "match": { "cursor": "<the cursor value page 1 returns>" }, "response": { "...": "page 2, with has-more false / no next cursor" } }
  ]
}
```

`<model>.details.json` for a hydrate action, keyed by the id the request
carries (any path variable, query or body value is looked up):

```json
{ "$shapedFrom": "...", "actionId": "<the retrieve actionId>", "byId": { "<id>": { "...": "one documented retrieve response" } } }
```

How the fixture transport answers (`packages/core/src/sample/world.ts`):

- A page answers when `match.cursor` equals the cursor the engine sends
  (`null` on the first page). `match.partition` and `match.request` (a
  subset of `{ pathParams, query, body }`) narrow it further.
- A cursor no page lists gets an empty answer of the same shape, so the
  second pass of the test ends cleanly.
- The response must be the real shape: same field names, nesting and
  value types as the docs, including the paging fields your profile reads.
  Where the docs say "structure not provided", keep to the fields you
  actually map and note it in `$shapedFrom`.
- Dates are relative so the fixture never ages. Use the marker that
  matches the documented type: `{ "$rel": "-2d 14:00" }` (ISO),
  `{ "$relUnix": "-2d 14:00" }` (unix seconds), `{ "$relMs": "-2d" }`
  (unix ms), `{ "$relDate": "-2d" }` (yyyy-MM-dd), or inline
  `"$rel(-2d 14:00)"` inside a string. Times are America/Los_Angeles. Keep
  every date inside the default backfill.

Content: 5 to 10 items from the Acme cast in `fixtures/sample/world.md`,
with real-looking text that a search would find ("Globex renewal",
"Initech pilot"). Use at least one email that already exists in the world
(Priya Shah is `priya@globex.com`, Ravi Menon at Initech is
`ravi@initech.io`; check `world.md`, and note `priya.shah@gmail.com` is a
different, Granola-only address) so entity linking can be checked. If the
model has a delete flag, include one item with the flag set to exercise
`deletes.when`.

`fixtures/sample/tools/generate.py` writes the 11 original Acme sources
only. Write a new pack's fixture JSON by hand, or with a throwaway script
kept outside the repo; do not add it to `generate.py`.

## 6. Write `fixtures/sample/<slug>/expect.json`

```json
{
  "$comment": "test:profiles expectations (CONTRACT 12): items per profile after all fixture runs",
  "profiles": { "<slug>.<model>": 6 },
  "kinds": { "message": 6 },
  "tombstoned": 0,
  "entities": { "email:priya@globex.com": { "sources": ["<slug>"] } }
}
```

`profiles` counts live items per profile (deleted ones excluded); a
profile not listed here is not run. `kinds` counts live items per kind,
`tombstoned` counts items marked deleted: only a `deletes.when` flag on a
listed item produces one in the test, because the fixtures answer the same
on both passes and an item that 404s on its first hydrate is never stored.
Without a delete flag, write `"tombstoned": 0`. `entities` lists entity keys
(`email:<address>`) that must link to an item from this platform. Without
this file the indexing test is skipped, so always write it.

## 7. Regenerate the manifest

```sh
node packages/core/scripts/gen-manifest.mjs
git diff connect.manifest.json
```

It adds one `access: "read"` line per action your pack names. Never edit
`connect.manifest.json` by hand. `one.connect.ts` reads the manifest, so
the next `pnpm connect` asks for the new platform.

## 8. Run the tests

```sh
pnpm --filter @search/core test:profiles
```

The test boots its own embedded Postgres in a tmp folder on port 55497.
If that port is busy (another test run), pick a free one:
`SEARCH_TEST_PG_PORT=55511 SEARCH_TEST_HOME=/tmp/search-test-<slug> pnpm --filter @search/core test:profiles`.

Each pack gets three checks: validates statically (and `verified` is
`"fixture"`), names only manifest actions, and indexes its fixtures to
`expect.json` (two passes: a first run, then an incremental one). Reading
failures:

| Failure | Usual cause |
|---|---|
| `<id> items: expected N, got 0` | `resultsPath` or `idPath` wrong, a `keep` predicate drops everything, or dates outside the backfill |
| `pass 1: ... no fixture` | the request's `actionId` has no fixture file, or `match.cursor` does not equal what the engine sent |
| `pass 1: ... not found` on hydrate | the `byId` key is not one of the request's path, query or body values |
| count too high | the next page's cursor is missing from `pages`, or `hasMore` reads the wrong path so a page repeats under a new id |
| `kind x` mismatch | `kind` on the profile is not the one in `expect.json` |
| `<key> should link to <slug>` | the ref path or `each` is wrong, or the email is not decoded (`decode: "email"`) |

Then the full checks:

```sh
pnpm --filter @search/core typecheck
pnpm start          # the Acme demo, must still exit 0
```

## 9. Docs

- Add a row for each new profile to the built-in table in
  `docs/profiles.md` (pack, profile id, kind, list action, incremental,
  hydrate, deletes, schedule, verified).
- Optional: a display name in `PLATFORM_NAMES`
  (`packages/core/src/platforms.ts`) when the default title case is wrong
  ("Hubspot" for `hubspot`). Logos come from
  `https://assets.withone.ai/connectors/<slug>.svg` with no change.

## 10. Hand off

Commit only your paths:

```sh
git add profiles/<slug> fixtures/sample/<slug> connect.manifest.json docs/profiles.md
git commit -m "profiles: <Name> <models> (fixture-verified)"
```

Then stop. A human opens the pull request after reading the pack and the
fixtures. In the PR body say which actions it uses, that it is
fixture-verified only, and which fields the docs left undescribed. The
profile stays `verified: "fixture"` until someone with a real account
signs in, runs it on their grant, and checks the counts.
