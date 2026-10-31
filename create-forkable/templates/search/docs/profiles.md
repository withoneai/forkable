# Profiles

A profile tells Search how to index one model of one tool: which One action
lists it, how to page and stay incremental, how a raw record becomes a
search result, who it is about, and how to cut it into chunks. It is plain
JSON. The engine has no per-platform code, only a few named decoders.

A **pack** is every profile for one platform. Built-in packs live in
`profiles/<platform>/pack.json`. Packs you make in the app (New profile)
live in your database, and both kinds travel as the same file.

- Types: `docs/CONTRACT.md` section 4.1 (`SearchProfile`, `SearchProfilePack`).
- JSON Schema: `profiles/schema/profile-1.json`, generated from the zod
  schema (`packages/core/src/profile/schema.ts`) by
  `pnpm --filter @search/core gen:schema`. Never edit it by hand; run the
  script again after a schema change and commit both. Point your editor at it
  with `"$schema": "https://search.forkable.dev/schema/profile-1.json"`.
- Static checks beyond the schema: `validateProfile`
  (`packages/core/src/profile/validate.ts`), run by
  `pnpm exec tsx scripts/check-packs.ts` in `packages/core`, by
  `search profiles validate <file>` and by `POST /api/v1/profiles/validate`.

## A pack

```json
{
  "$schema": "https://search.forkable.dev/schema/pack-1.json",
  "name": "Granola",
  "platform": "granola",
  "profiles": [ { "id": "granola.notes", "...": "..." } ]
}
```

Every profile's `platform` equals the pack's, and every id is
`<platform>.<model>` (`^[a-z0-9-]+\.[a-z0-9-]+$`).

## A profile, top to bottom

| Key | Required | What it does |
|---|---|---|
| `id`, `platform`, `model` | yes | identity; `platform` is the One platform slug |
| `kind` | yes | `person`, `company`, `email_thread`, `event`, `doc`, `task`, `message`, `meeting_note`, `deal`, `note` or `record`; decides the result row, the preview and the allowed facets |
| `title`, `description` | `title` | shown in Settings, Integrations |
| `author` | no | `builtin`, `community`, a user id or a URL |
| `revision` | no | bump when you change a built-in |
| `verified` | no | `none`, `fixture` (ran on fixtures shaped from the docs) or `real` (ran on a real grant) |
| `enabledByDefault` | no | built-ins: start a source on connect |
| `sampleOnly` | no | needed for `sample::` action ids |
| `account` | no | one call per connection that sets `account.<var>` (the mailbox address, a portal id) and, with `self`, tells Search which addresses are you |
| `settings` | no | knobs the user can turn per source (`duration`, `string`, `number`, `boolean`, `choice`), read as `settings.<key>` |
| `partitions` | no | list containers first (calendars, channels, chats), then run `list` once per container; `next` nests (teams, then channels) |
| `list` | yes | the action that lists items, plus `resultsPath`, `idPath`, `pagination`, `pageSize` |
| `incremental` | yes | `full`, `watermark` or `delta` |
| `hydrate` | no | fetch each item's detail, with `fingerprint` to skip unchanged ones and `children` for extra lists (thread replies) |
| `deletes` | no | `when` (a predicate) and `reconcile` |
| `keep` | no | predicate; items that fail it are skipped |
| `fields` | yes | how a record becomes a result (`title` and `occurredAt` required) |
| `entities` | no | the person or company this item is (`is`) or mentions (`refs`) |
| `chunk` | no | `whole`, `paragraph`, `message` or `heading` |
| `classify` | no | extra Jev questions written into `facets.x_<name>` |
| `limits` | no | `requestsPerMinute`, per action limits, page and item caps per run |
| `schedule` | no | `{ "every": "15m" }` |

## Paths

One grammar everywhere:

| Path | Means |
|---|---|
| `a.b`, `a.0`, `a[0]` | a key, an index |
| `a[-1]` | the last element |
| `a[]` | every element (and every value of an object) |
| `a[name=From]` | elements whose `name` is `From` |
| `a["@odata.nextLink"]` | a key with dots or symbols |

Roots: `item` (the list element), `detail` (the hydrate answer),
`children.<as>`, `partition` (and `partition.parent`), `unit` (the chunk
unit), `doc` (already-mapped fields, in `url`, `chunk.header` and
`classify`), `cursor.watermark`, `cursor.token`, `run.since`, `run.until`,
`run.now`, `run.full`, `account.<var>`, `settings.<key>`.

## Templates and filters

`{{ expr | filter:arg }}`, anywhere a request or a field takes a string.
Filters are a closed list:

| Filter | Example |
|---|---|
| `iso`, `unix`, `unixms` | `{{ run.since \| unix }}` |
| `date:"yyyy-MM-dd"` | `{{ unit.time \| date:"yyyy-MM-dd" }}` |
| `lower`, `upper` | |
| `email`, `domain` | `{{ item.from \| domain }}` |
| `urlencode`, `json` | |
| `join:","`, `first`, `last` | |
| `default:"x"` | `{{ settings.include \| default:"summary" }}` |
| `slackts` | `1730000000.123456` to `p1730000000123456` |
| `firstline`, `truncate:N`, `striphtml` | text clean-up |
| `plus:<duration>` | `{{ run.now \| plus:365d \| iso }}`, a date moved forward (a calendar's `timeMax`) |

## Field expressions

A field is a path string or one of:

```json
{ "path": "item.messages[].body", "pick": "join", "sep": "\n\n", "decode": "mail-strip" }
{ "template": "Untitled meeting" }
{ "coalesce": ["detail.title", "item.title", { "template": "(untitled)" }] }
{ "join": ["detail.summary", "detail.notes"], "sep": "\n\n" }
{ "test": "len(detail.transcript) > 0" }
```

`pick` is `first` (default), `last`, `all`, `join` or `count`. Decoders:
`text`, `html`, `markdown`, `mail-strip`, `graph-body`, `mime-body`
(a MIME part tree such as Gmail's `payload`: base64url text/plain, else text/html, then mail-strip), `notion-blocks`,
`notion-title`, `slack-mrkdwn`, `prosemirror`, `transcript` (meeting
transcript segments `[{ speaker, text }]` to a `Transcript` heading and one
`Speaker: text` line per turn; a speaker object reads its name or
diarization label, else Granola's `attribution` (`me`, `them`) or `source`
(`microphone` is Me, `speaker` and `system` are Them)), `email`, `domain`,
`datetime` (ISO, unix seconds or unix ms), `address` (`Name <email>`
lists) and `number`.

Predicates (`keep`, `deletes.when`, `classify.when`, `children.when`,
`{ test }`) use a small parsed language, never `eval`:
`== != > >= < <= && || ! in`, `len(x)`, `contains(x, y)`, paths, string
and number literals and `now - 30d`.

`facets` keys must belong to the kind (`docs/CONTRACT.md` section 4.3) or
start with `x_`.

## Links

`fields.url` is a template that must render an absolute https URL. It
can use `item`, `detail`, `account` and `doc`:

```json
"url": "https://mail.google.com/mail/u/?authuser={{ account.email | urlencode }}#all/{{ item.id }}"
"url": "https://notes.granola.ai/d/{{ item.id }}"
```

Leave it out when the tool has no stable web link; the result then opens
in Search's own preview.

## Strategies

| Strategy | Use when | Keys |
|---|---|---|
| `watermark` | the list can filter or sort by updated time | `field` (path on the item), `order` (`asc`, or `desc` to stop paging below the watermark), `overlap`, `initial`, `restartOnCap` (asc only) |
| `delta` | the API hands back a sync token or delta link | `tokenPath`, `tokenPassAs` (or `url`), `bootstrap`, `resetOn` (`[410]`), `initial` |
| `full` | neither | pair with `deletes.reconcile: "onFullPass"` |

Pagination types: `none`, `cursor`, `offset`, `page`, `lastId`, `relay`
(GraphQL `pageInfo`), `linkHeader` and `nextUrl`. `passAs` says where the
next value goes: `query:<name>`, `body:<dotted.path>` or `header:<name>`.

Deletes: `deletes.when` marks an item deleted from its own fields
(`item.archived == true`), a 404 on hydrate deletes by default, and
`reconcile: "onFullPass"` removes what a full pass no longer sees (only
when the pass fetched at least one item).

## Entity refs

```json
"entities": {
  "is": { "type": "person", "email": { "path": "item.properties.email", "decode": "email" }, "name": "item.properties.firstname" },
  "refs": [
    { "role": "from", "type": "person", "address": { "path": "item.messages[].sender", "pick": "all" } },
    { "role": "attendee", "type": "person", "each": "detail.attendees[]", "email": { "path": "email", "decode": "email" }, "name": "name" },
    { "role": "about", "type": "company", "domain": "item.properties.domain" }
  ]
}
```

`is` makes the item a person or company record (CRM contacts). `refs`
link people and companies to the item with a role: `from`, `to`, `cc`,
`attendee`, `organizer`, `owner`, `assignee`, `author`, `mentioned`,
`about`. `each` makes one ref per array element, with paths relative to
it. People merge across tools by email; a ref with only an
`externalId` (`"slack:user:U01..."`) resolves through a `directory`
profile such as `slack.users`.

## Hashes

Each saved version carries four hashes (canonical JSON, sha256, first 16
hex characters), and they decide what a change costs:

| Hash | Covers | When it changes |
|---|---|---|
| `fetchHash` | `list`, `partitions`, `incremental`, `hydrate`, `keep`, `deletes`, `account` | cursors reset, next run is a full pass with reconcile |
| `mapHash` | `kind`, `fields`, `entities`, `chunk`, decoder and normalizer versions | items re-map from stored raw records, zero API calls |
| `indexHash` | `classify`, embedding model, chunker version | missing embeddings and judgments are queued |
| `profileHash` | all three | identifies a shared profile; built-in update detection |

Title, description, author, revision, verified, schedule, limits, setting
defaults and `enabledByDefault` are in no hash, so editing them costs
nothing.

Settings the fetch reads are the exception at run time. When `list`,
`partitions`, `incremental`, `hydrate`, `keep`, `deletes` or `account` use
`{{ settings.x }}`, the source's resolved value of `x` is folded into the
fetch hash it runs under. Changing such a setting on a source (`PATCH
/sources/:id`) or moving to a version whose default for it differs resets
cursors and runs a full pass; a setting the hydrate request reads is also
part of every hydrate fingerprint, so items already indexed are fetched
again (Granola's `include=transcript`). The source answers
`refetchPending: true` until that pass succeeds, and the source page says
so. A setting only fields read just re-maps.

## Share, export and import

| How | Where |
|---|---|
| Export | a source's page, Export profile. Or `GET /api/v1/profiles/:id/export`, or `search profiles export <id> [file]`. A pack file with no connection, no account values and no user id (`author` becomes `community`) |
| Import a file | `search profiles import ./pack.json`, or `POST /api/v1/profiles/import` with `{ "pack": ... }` |
| Import a URL | `search profiles import https://example.com/pack.json`, or the same route with `{ "url": ... }`. https only, 256 KB at most, 5 second timeout, no redirects, no private addresses |
| Check before import | `search profiles validate ./pack.json` |

An import is a preview first: the validation report and a diff against
any copy you already have. Nothing is installed until you accept it
(`--yes` on the CLI, `POST /api/v1/profiles/import/:importId/accept` on the API).
There is no import screen in the app yet.

## Contribute a built-in

1. Follow `.claude/skills/add-search-profile/SKILL.md`. A coding agent can
   run it start to finish: it finds and reads the actions with the One
   CLI, writes the pack, fixtures shaped from the documented responses and
   `expect.json`, and regenerates the manifest.
2. `pnpm --filter @search/core test:profiles` and `pnpm start` pass.
3. Open a pull request with the pack, its fixtures, the manifest diff and
   a row in the table below. Say which actions it uses and which fields
   the docs left undescribed.

A new pack ships `verified: "fixture"`. It becomes `real` after someone
runs it on a real grant and checks the counts.

## Built-in profiles

| Pack | Profile | Kind | List | Incremental | Hydrate, children | Deletes | Every | Verified |
|---|---|---|---|---|---|---|---|---|
| hubspot | `hubspot.contacts` | person | Search CRM Contacts | watermark `lastmodifieddate` | none | archived, reconcile | 15m | fixture |
| hubspot | `hubspot.companies` | company | Search CRM Objects (companies) | watermark `hs_lastmodifieddate` | none | archived, reconcile | 15m | fixture |
| hubspot | `hubspot.deals` | deal | Search CRM Objects (deals) | watermark `hs_lastmodifieddate` | none | archived, reconcile | 15m | fixture |
| hubspot | `hubspot.notes` | note | Search CRM Objects (notes) | watermark `hs_lastmodifieddate` | none | archived, reconcile | 30m | fixture |
| attio | `attio.people`, `attio.companies`, `attio.deals`, `attio.notes` | person, company, deal, note | List an Object's Records, List Notes | full | none | reconcile | 60m | fixture |
| gmail | `gmail.threads` | email_thread | List Threads | watermark last message time | Get Thread (`historyId` fingerprint) | reconcile 14d | 5m | fixture |
| outlook-mail | `outlook-mail.messages` | email_thread | List Messages | watermark `lastModifiedDateTime` | none | reconcile 14d | 5m | fixture |
| google-calendar | `google-calendar.events` | event | Calendar List, then Events | delta `nextSyncToken` | none | cancelled | 10m | fixture |
| outlook-calendar | `outlook-calendar.events` | event | List Calendars, then Delta Events | delta `@odata.deltaLink` | none | `@removed` | 10m | fixture |
| notion | `notion.pages` | doc | Search | watermark desc | page as markdown | trashed, archived, 404 | 15m | fixture |
| linear | `linear.issues`, `linear.projects`, `linear.documents`, `linear.comments` | task, doc, doc, message | List Issues, Projects, Documents, Comments | watermark `updatedAt` | none | archived | 10m to 60m | fixture |
| slack | `slack.users`, `slack.messages` | person (directory), message | Users; Conversations, then History | full; watermark `ts` per channel | thread replies | deleted | 24h, 30m | fixture |
| teams | `teams.chat-messages`, `teams.channel-messages` | message | Chats, then Messages; Teams, Channels, then Delta | watermark; delta | none | `deletedDateTime` | 15m, 30m | fixture |
| granola | `granola.notes` | meeting_note | List Notes | watermark `updated_at` | Get Note with the transcript (setting `include`) | 404 | 30m | fixture |
| intercom | `intercom.conversations` | message | Search Conversations (`updated_at >`) | watermark `updated_at` | Retrieve a Conversation (parts) | 404, reconcile 14d | 15m | fixture |

`linear.comments` and `teams.channel-messages` are off by default. The
Acme demo (`pnpm start`) indexes these 11 packs; packs added after them
are checked by `test:profiles` on their own fixtures.
