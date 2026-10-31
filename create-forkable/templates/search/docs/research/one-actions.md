# One actions for Search: what to call to index each source

Date: 2026-10-29. One CLI 2.10.0 (`/opt/homebrew/lib/node_modules/@withone/cli`), run
with the local Node 22.23.4. Every id below came from `one --agent actions find`
and, unless marked otherwise, its docs were read with `one --agent actions load`
(digest, plus `--section "Response Fields"` where the digest left it out). Nothing
was executed against a live connection. Raw finds and docs are in `/tmp/srch/`
(`*.json` finds, `load/` docs, `resp/` response sections) until the machine is
cleaned.

Legend for the "Docs" column: **V** = docs loaded and read; **I** = inferred (from
the provider's public API, from Rill's code, or from a sibling action) and not
confirmed by a loaded doc.

Two calling rules that apply to every table:

- Actions whose path starts with `/v1/<platform>/...` (Gmail `get-threads`,
  `get-emails`, Attio `get-people` and siblings) are served by One itself (tag
  `custom`). They take `connectionKey` in the JSON body. `runAction` adds it only
  when it looks the action up itself; if Search passes `method` and `path`
  explicitly (as Rill does in its `packages/core/src/one.ts`), Search must add
  `connectionKey` to the body or One answers 400.
- Query parameters go in `query`, never the body (several docs repeat this; Graph
  silently ignores OData keys in a body and returns the unfiltered list).

---

## 1. HubSpot (`hubspot`)

| Action | Action id | Method / path | Pagination | Incremental | Id path | Key fields | Link idea | Docs |
|---|---|---|---|---|---|---|---|---|
| List Contacts (CRM) | `conn_mod_def::GJ3kRzSx4jI::FYKI80bDTNSwlOH-jg84nQ` | GET `/crm/v3/objects/contacts` | cursor: `after` query, next = `paging.next.after`; `limit` | none on list; use search below | `results[].id` | `properties` (ask via `properties=email,firstname,lastname,company,...`), `associations` (`associations=companies`), `createdAt`, `updatedAt`, `archived` | `https://app.hubspot.com/contacts/{portalId}/record/0-1/{id}` (portalId needs an account call) | V |
| Search CRM Contacts | `conn_mod_def::GJ3kSC2Sp7I::L6cYnwOfTUatg0cXeWjCBA` | POST `/crm/v3/objects/contacts/search` | cursor: body `after`; `limit` | `filterGroups:[{filters:[{propertyName:"lastmodifieddate",operator:"GT",value:<ms>}]}]`, `sorts` | `results[].id` | same as list, `total` | as above | V (doc says `after`, `sorts`, `properties`, `filterGroups` are all required in the body) |
| Retrieve CRM Objects (Companies) | `conn_mod_def::GJ3kQmzWqjk::4wv6BrTUQQi_AdAfZdTLsQ` | GET `/crm/objects/2026-03/{{objectType}}` (`objectType=companies`) | cursor `after` / `paging.next.after` (+ `paging.next.link`) | via search | `results[].id` | `properties` (`name,domain,...`), `updatedAt`, `results[].url` | `.../record/0-2/{id}` | V |
| Search CRM Objects (Companies) | `conn_mod_def::GJ3kQvNreBM::Zpab8Ig5TSivqCj1UhG37w` | POST `/crm/objects/2026-03/{{objectType}}/search` | body `after` | `hs_lastmodifieddate GT` filter | `results[].id` | | | V (find); generic search doc below |
| List CRM Objects (Deals) | `conn_mod_def::GJ3kZwJB6ZM::EwizjHo3RHOfHbNXzQSw0A` | GET `/crm/objects/2026-03/{{objectType}}` (`deals`) | cursor `after` | via search | `results[].id` | `properties` (`dealname,amount,dealstage,closedate`), associations to contacts/companies | `.../record/0-3/{id}` | V |
| List CRM Objects (Notes) | `conn_mod_def::GJ3k1XrSYzg::fFIQ85lYSemSbKjrngwQSQ` | GET `/crm/objects/2026-03/{{objectType}}` (`notes`) | cursor `after` | via search | `results[].id` | `properties` (`hs_note_body,hs_timestamp`), `associations` | link the associated record | V |
| Search CRM Objects (Notes) | `conn_mod_def::GJ3k1yj_vd8::B3vvaICzRKeqGbG66JUHDQ` | POST `/crm/objects/2026-03/{{objectType}}/search` | body `after` | `hs_lastmodifieddate GT` | `results[].id` | | | V (loaded on retry) |
| Search CRM Objects by Type (generic) | `conn_mod_def::GJ3kYWYoo38::XLCOkotzRHyXigkeSyVCKg` | POST `/crm/objects/2026-03/{{objectType}}/search` | body `after`, `limit` up to **200** | `filterGroups` (up to 6 groups), `query` up to 3000 chars, operators `GT/GTE/BETWEEN/...` | `results[].id` | | | V |

Notes: HubSpot's own "search returns at most 10,000 results per query" and the
search endpoint's lower rate limit (about 5 requests a second) are not in the
loaded docs (I). For a first full sync use the list endpoints; for incremental use
search with `lastmodifieddate` (contacts) / `hs_lastmodifieddate` (others) `GT`
the watermark, sorted ascending (property names I, from HubSpot's API). Engagements
other than notes (calls, emails, meetings, tasks) are the same object-type actions
with another `objectType` (I).

## 2. Attio (`attio`)

| Action | Action id | Method / path | Pagination | Incremental | Id path | Key fields | Link | Docs |
|---|---|---|---|---|---|---|---|---|
| Get and View People (One-served) | `conn_mod_def::GGSOLgc5bQY::2Ou6Iu2sRf2TfK36ewCUJQ` | POST `/v1/attio/get-people` | offset: body `offset`, `limit` 1-500 (default 10); response has `hasMore` + `nextOffset` | Attio `filter` / `sorts` passed through (e.g. sort on `created_at`) | `people[].id` | `name`, `emailAddresses[]`, `phoneNumbers[]`, `jobTitle`, `description`, `company` (bare id), `primaryLocation`, `linkedin`..., `createdAt` | `webUrl` (Attio's `web_url`, else `https://app.attio.com/workspace/person/<id>`) | V |
| Get and View Companies | `conn_mod_def::GGSN-Se_DVY::kKduVE_yTiGJDjkspa5ScQ` | POST `/v1/attio/get-companies` | same offset | same | `companies[].id` | `name`, `domain` (first), `description`, `categories`, `team[]`, `associatedDeals[]`, `primaryLocation`, `socialLinks` | `webUrl` | V |
| Get and View Deals | `conn_mod_def::GGSOEZziaXI::fPKHa9ClROeMQoOXcUzr0g` | POST `/v1/attio/get-deals` | same offset | same | `deals[].id` | `name`, `stage` (title), `owner` (actor id), `value {amount,currency}`, `associatedCompany` (first only), `associatedPeople[]` | `webUrl` | V |
| Get and View Records of Any Object | `conn_mod_def::GNV60l9OE9U::T-1_eOcNSUq9RwkRJJpbGg` | POST `/v1/attio/get-records` (body `object`) | same offset | same | `records[].id` | raw `values` keyed by Attio slug, flattened per attribute type; custom attributes included | `webUrl` only when Attio sends one | V |
| List an Object's Records (raw Attio) | `conn_mod_def::GJ0CbN-LPiU::A6h6M9QkS0Cs2Lt9CdPH7Q` | POST `/objects/{{object}}/records/query` | body `offset`, `limit` (default 500) | `filter` (required, may be `{}`), `sorts` | `data[].id.record_id` | `values` (arrays of typed value objects), `created_at` | `data[].web_url` | V (this is the id the CLI's shipped sync profiles use) |
| List Notes | `conn_mod_def::GJ0CZucANAI::qH4Oc4NvS1GWLSVnKugSCA` | GET `/notes` | query `offset`, `limit` | none documented; `parent_object` + `parent_record_id` to scope | `data[].id.note_id` (I) | `title`, `content_plaintext` / `content_markdown`, `parent_object`, `parent_record_id`, `created_at` (I for field names beyond `content_markdown`) | link the parent record | V |
| Get a Note | `conn_mod_def::GJ0CZl2OhLs::1hB8984ySXu3WAzyBuduDA` | GET `/notes/{{noteId}}` | n/a | n/a | | | | find only (I) |
| Search Records Across Objects | `conn_mod_def::GJ0CbY6VDMk::bN2lStzmS0admyNa4K83hg` | POST `/objects/records/search` | | | | | | find only |

Rate limit (from the docs): 100 requests per second per workspace on the standard
plan; 429 comes back unaltered. The curated `get-*` actions drop custom attributes;
use `get-records` or the raw query when the user's workspace has them.
Incremental: Attio has no `updated_since`; sort by `created_at` desc for new
records and re-walk for changes, or rely on webhooks later (I).

## 3. Gmail (`gmail`)

| Action | Action id | Method / path | Pagination | Incremental | Id path | Key fields | Link | Docs |
|---|---|---|---|---|---|---|---|---|
| List and View Email Threads (One-served, Rill uses it) | `conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ` | POST `/v1/gmail/get-threads` | body `pageToken` / resp `nextPageToken`; `numberOfThreads` 1-100 (default 10) | body `query` with Gmail syntax: `after:<epoch>` or `newer_than:Nd`; `label`; `format` full/metadata/minimal; `maxBodyLength` | `threads[].id` | `snippet`, `historyId`, `messages[].{messageId, sender, receiver, time, subject, body (decoded), labelIds, snippet, attachments[]}`; `failures[]` | `https://mail.google.com/mail/u/0/#all/{threadId}` (I; `u/0` is the first signed-in account, better `#search/rfc822msgid:` or `?authuser=<email>`) | V |
| List and View Read or Unread Emails | `conn_mod_def::GGSNOTZxFUU::ZWXBuJboTpS3Q_U06pF8gA` | POST `/v1/gmail/get-emails` | same token style; `numberOfEmails` 1-100 | same `query` | `emails[].messageId`, `threadId` | `sender`, `receiver`, `time`, `subject`, `body`, `labelIds`, `historyId`, `internalDate` (epoch ms), `snippet`, `attachments[]` | as above | V |
| List a User's Gmail Threads (raw, ids only) | `conn_mod_def::GJ3ok-Q0D40::oLWNlcx4QDORaL_18z-MsQ` | GET `/gmail/v1/users/{{userId}}/threads` | query `pageToken` / `nextPageToken`; `maxResults` default 100, max 500 | `q` (Gmail syntax), `labelIds` | `threads[].id` | `id`, `snippet`, `historyId`, `resultSizeEstimate` | | V. Tagged `hidden:agents`, so `find` never offers it; the CLI's own sync profile uses it |
| Get a User's Thread | `conn_mod_def::GJ3ok0Eq0R8::AAzgZVLqTg2iBuITKpJLZg` | GET `/gmail/v1/users/{{userId}}/threads/{{id}}` | n/a | n/a | `id` | `historyId`, `messages[]` with `payload.headers` (From, To, Cc, Subject, Date, Message-ID), base64url `payload.body.data`, `internalDate` | | V |
| Get a User's Gmail Message | `conn_mod_def::GJ3ocvMGOS8::D__3BgQSSzWtDUoOqLuX2A` | GET `/gmail/v1/users/{{userId}}/messages/{{id}}` | n/a | n/a | `id`, `threadId` | `labelIds`, `snippet`, `internalDate`, `historyId`, `payload.headers`, `payload.body.data` | | V |
| List a User's Gmail History | `conn_mod_def::GJ3obKaXB1U::JWUEs9nESz2__4shMOpyIg` | GET `/gmail/v1/users/{{userId}}/history` | `pageToken`; `maxResults` default 100, max 500 | **`startHistoryId`** (required), `historyTypes` (`messageAdded`, `messageDeleted`, `labelAdded`, `labelRemoved`, repeated param), `labelId` | `history[].messages[].id/threadId` | response top-level `historyId` is the new watermark | | V. Stale `startHistoryId` gives 404, recover with a full sync |
| Get the user's profile (Rill) | `conn_mod_def::GJ3oa8bJZNA::ZS9kXmE_Rzi4utfESor_ng` | GET `/gmail/v1/users/{{userId}}/profile` | | gives the mailbox's current `historyId` and `emailAddress` | | | | I (from Rill's `providers/gmail/mail.ts`, not loaded here) |

Rate limit (from the get-threads doc): Gmail allows 250 quota units per second per
user; `threads.get` costs 10, a message get 5. One's get-threads bounds its own
concurrency and retries 429/403 `userRateLimitExceeded` up to three times.
Strategy: backfill with get-threads (`format: "full"`, `maxBodyLength` around
4000, `query: "after:<epoch> -in:chats"`), store each thread's `historyId`, then
incremental with history from the profile's or the last thread's `historyId`, and
fetch changed thread ids with Get a User's Thread.

## 4. Outlook Mail (`outlook-mail`)

| Action | Action id | Method / path | Pagination | Incremental | Id path | Key fields | Link | Docs |
|---|---|---|---|---|---|---|---|---|
| List Messages (Rill uses it) | `conn_mod_def::GMIYwcOQ0W0::zXQUrHvhTy-rXQG3h50Paw` | GET `/v1.0/me/messages` | `$top` + `$skip`, or follow `@odata.nextLink` (full URL; strip the host and pass `$skip`/`$skiptoken` as query) | `$filter=receivedDateTime ge 2026-10-01T00:00:00Z` or `lastModifiedDateTime ge ...`, `$orderby`, `$select` | `value[].id` | `subject`, `bodyPreview` (255 chars), `body {contentType, content}`, `uniqueBody`, `from`, `toRecipients[]`, `ccRecipients[]`, `receivedDateTime`, `lastModifiedDateTime`, `conversationId` | `value[].webLink` | V |
| List Messages in a Mail Folder | `conn_mod_def::GMIYwcTo-HI::GT_NIVtaThKotZiBeiCasw` | GET `/v1.0/me/mailFolders/{{mailFolderId}}/messages` | same | same | | | | find only (Rill uses it) |
| Get a Message for the Signed-in User | `conn_mod_def::GMIYwjHgCAs::cvBtMvGiSnS7ZRG8Sj-trw` | GET `/v1.0/me/messages/{{messageId}}` | n/a | n/a | `id` | full message; `$select` to trim | `webLink` | V |
| Delta Messages for the Signed-in User | `conn_mod_def::GMIYyZPGtXU::36XEPOMNQn61_ElgxJZx3w` | GET `/v1.0/me/messages/microsoft.graph.delta()` | `@odata.nextLink` pages, final page carries `@odata.deltaLink` (I for deltaLink on this action) | delta state token; `changeType=created/updated/deleted` | `value[].id` | same message fields; deletions come as `@removed` (I) | | V (loaded on retry) |
| Delta Messages in a Mail Folder | `conn_mod_def::GMIYyQA6TWk::GyZb5kHdTgKObfjpdkvc4A` | GET `/v1.0/me/mailFolders/{{mailFolderId}}/messages/microsoft.graph.delta()` | same | same | | | | find only. Graph's message delta is per folder in practice (I); prefer this one with Inbox and SentItems |
| Get the Signed-in User Profile (Rill) | `conn_mod_def::GMIYxNZ51eU::xY4rcCXiTTyrarjC9ac97w` | GET `/v1.0/me` | | | | mailbox address (needs User.Read) | | I (Rill) |

Graph fields guaranteed on every message: `id`, `conversationId`,
`createdDateTime`, `lastModifiedDateTime`, `parentFolderId`; everything else is
nullable. Graph throttling (about 10,000 requests per 10 minutes per mailbox) is not
in the docs (I). `webLink` cannot be opened inside an iframe.

## 5. Google Calendar (`google-calendar`)

| Action | Action id | Method / path | Pagination | Incremental | Id path | Key fields | Link | Docs |
|---|---|---|---|---|---|---|---|---|
| List the Authenticated User's Calendar List | `conn_mod_def::GJ6Rk8ghCfI::FsO0bmOYSHOsPSIvrcOZxQ` | GET `/users/me/calendarList` | `pageToken`; `maxResults` default 100, max 250 | `syncToken` | `items[].id` | `summary`, `accessRole`, `primary` | | V |
| List a Calendar's Events | `conn_mod_def::GJ6RlnIYK20::YzuWSmaVQgurletRDNJavA` | GET `/calendars/{{calendarId}}/events` | `pageToken` / `nextPageToken`; `maxResults` default 250, max 2500 | **`syncToken`** from the last page's `nextSyncToken` (410 GONE means full resync); or `updatedMin`; `timeMin`/`timeMax`, `singleEvents`, `showDeleted` | `items[].id` (+ `iCalUID`, `recurringEventId`) | `summary`, `description` (HTML), `location`, `start/end {date|dateTime,timeZone}`, `organizer.email`, `creator.email`, `attendees[].{email,displayName,responseStatus}`, `hangoutLink`, `conferenceData`, `status`, `created`, `updated` | `items[].htmlLink` | V |
| Get a Calendar Event | `conn_mod_def::GJ6RlPEQKQw::rxHzaO_TTtKVIcxgFrWUKA` | GET `/calendar/v3/calendars/{{calendarId}}/events/{{eventId}}` | n/a | | | | `htmlLink` | find (Rill uses it) |

The CLI's shipped profile for this source names `conn_mod_def::GJ5x5pOh2TU::gcal-events-list`,
which is not a real catalog id; use `GJ6RlnIYK20` above. With `syncToken` the
other filters must not change between calls (doc). Quota is per project and per
user per minute (I).

## 6. Outlook Calendar (`outlook-calendar`)

| Action | Action id | Method / path | Pagination | Incremental | Id path | Key fields | Link | Docs |
|---|---|---|---|---|---|---|---|---|
| List Calendars for the Signed-in User (Rill) | `conn_mod_def::GMIY1FxtnJw::naghBU_mSTKsg0Lv46gF1w` | GET `/v1.0/me/calendars` | `@odata.nextLink` | | `value[].id` | `name`, `owner` | | find (I fields) |
| List Events for the Signed-in User | `conn_mod_def::GMIY1e65D44::ZLrJ3iJQRxWl0M2stQ0TkA` | GET `/v1.0/me/events` | `$top`/`$skip`, `@odata.nextLink` | `$filter=lastModifiedDateTime ge ...` | `value[].id` | series masters, not expanded occurrences | `webLink` | V (loaded on retry) |
| List Calendar View for the Signed-in User | `conn_mod_def::GMIY1NvNnOo::PViAQ9ZqQZKOL-gHohYBDA` | GET `/v1.0/me/calendarView` | `$top`/`$skip`, `@odata.nextLink` | required `startDateTime`, `endDateTime` window; `$filter` | `value[].id` | `subject`, `bodyPreview`, `body`, `start/end {dateTime,timeZone}`, `organizer`, `attendees[].{emailAddress,type,status}`, `isOrganizer`, `createdDateTime`, `lastModifiedDateTime`, `onlineMeeting` (I) | `value[].webLink` | V |
| Delta Calendar Events in a User Calendar | `conn_mod_def::GMIY39C_Zus::f0YqbOZ_Tzi_jt6FfhYKHA` | GET `/v1.0/me/calendars/{{calendarId}}/events/microsoft.graph.delta()` | `@odata.nextLink`, then `@odata.deltaLink` | delta over a `startDateTime`/`endDateTime` window; first call is a full sync | `value[].id` | same as calendar view | | V |

Rill uses `conn_mod_def::GJ58LPpX-M4::e4__fu-6SUK_WBT15hJPoQ`
(`/users/{{userId}}/calendars/{{calendarId}}/calendarView`) for its week view.
Graph returns Windows time zone names unless `Prefer: outlook.timezone` is sent
(Rill converts them; I for the header on these actions).

## 7. Notion (`notion`)

| Action | Action id | Method / path | Pagination | Incremental | Id path | Key fields | Link | Docs |
|---|---|---|---|---|---|---|---|---|
| Search by Title (Search Pages and Data Sources) | `conn_mod_def::GJ5En67fz04::-CJAS419SVWm7L2l6brp6A` | POST `/search` | body `start_cursor` / resp `next_cursor` + `has_more`; `page_size` (100 max, I) | `sort: {timestamp: "last_edited_time", direction: "descending"}` and stop at the watermark; `filter: {property: "object", value: "page"}` | `results[].id` | `object` (page or data_source), `properties` (title lives in the `title`-type property), `parent`, `last_edited_time`, `last_edited_by`, `created_time` (I) | `results[].url` | V |
| Retrieve a Page as Markdown | `conn_mod_def::GJ5EntqNvy0::-VzfhSExTEGGnlXLUMqFcA` | GET `/pages/{{pageId}}/markdown` | n/a | n/a | `id` | `markdown`, `truncated`, `unknown_block_ids` | | V. One call per page instead of walking blocks; needs `Notion-Version: 2026-03-11` |
| Retrieve a Block's Children | `conn_mod_def::GJ5Emwl98w0::aNRlxEQlS3yp9jUDqcM4XA` | GET `/blocks/{{blockId}}/children` | query `start_cursor` / `next_cursor`, `has_more`; `page_size` | n/a | `results[].id` | typed blocks (`paragraph`, `heading_1`, `to_do`, ...), `has_children` (recurse) | | V. Header `Notion-Version: 2026-03-11` |
| Query a Data Source's Pages | `conn_mod_def::GJ5EnL2xERY::ib0N5v41TveieFZQUV-vuQ` | POST `/data_sources/{{dataSourceId}}/query` | body `start_cursor`, `page_size` | `filter: {timestamp: "last_edited_time", last_edited_time: {after: ...}}` (I for exact shape), `sorts` | `results[].id` | `properties`, `last_edited_time`, `parent` | `results[].url` | V |
| Retrieve a Page | `conn_mod_def::GJ5EnwZA3JE::sIXduRG5Qc-J8995P9OwGQ` | GET `/pages/{{pageId}}` | | | | | `url` | find only |

Notion's limit is about 3 requests per second per integration; 429 `rate_limited`
is documented, the number is not (I).

## 8. Linear (`linear`)

Every Linear action is POST `/graphql` with `{query, variables}`; the action id is
what the grant checks, so use the right id per query.

| Action | Action id | Pagination | Incremental | Id path | Key fields | Link | Docs |
|---|---|---|---|---|---|---|---|
| List Issues | `conn_mod_def::GJ4vJTdCQPY::f4IhKVnuTv6Us2d-GwWvCw` | Relay: `first` (default 50) + `after` = `pageInfo.endCursor`, `hasNextPage` | `orderBy: updatedAt`, `filter: {updatedAt: {gt: "<iso>"}}` (IssueFilter), `includeArchived` | `data.issues.nodes[].id` | select `identifier title description url createdAt updatedAt state{name} assignee{name email} creator{name email} team{key name} project{name} labels{nodes{name}}` | `url` | V (args); response node fields I (GraphQL lets you select them) |
| List Projects | `conn_mod_def::GJ4vMBSrKJo::YJPEPOfJQ76eTtZUfpjyUg` | same Relay | `orderBy: updatedAt`, `filter.updatedAt` | `data.projects.edges[].node.id` | `name description content url lead{...} updatedAt` | `url` | V |
| List Comments (GraphQL) | `conn_mod_def::GJ4vCs496v0::aGBcU2zYSISOg7tZZzSSfQ` | same Relay | `filter: {updatedAt: {gt: ...}}`, `orderBy: updatedAt` | `data.comments.edges[].node.id` | `body createdAt updatedAt url user{name email} issue{identifier title}` | `url` (in the doc's example query) | V |
| List Documents | `conn_mod_def::GJ4vFe4bH3Q::NcSFstL6Q9WSd4TqlvvyHg` | same Relay | `filter.updatedAt` | `nodes[].id` | `title content slugId url createdAt updatedAt` | `url` | V |

Linear's limit is complexity based (about 1,500 requests an hour per user for
OAuth apps; I).

## 9. Slack (`slack`)

| Action | Action id | Method / path | Pagination | Incremental | Id path | Key fields | Link | Docs |
|---|---|---|---|---|---|---|---|---|
| List Conversations (Channels) in a Workspace | `conn_mod_def::GJ7H9zmRFIk::1RxrzeicS-ibnXF4sFC5Ww` | GET `/conversations.list` | `cursor` / `response_metadata.next_cursor`; `limit` under 1000 (200 recommended) | n/a | `channels[].id` | `name`, `is_private`, `is_im`, `topic`, `purpose` (I) | | V. `types=public_channel,private_channel,mpim,im` |
| List the Calling User's Conversations | `conn_mod_def::GJ7IBJH4uK8::Q4MUFQEYRxucJ3uvw2Ibdw` | GET `/users.conversations` | same cursor; `limit` max 999 | n/a | `channels[].id` | only conversations the user is in; better for a personal index | | V |
| Fetch a Conversation's Message History | `conn_mod_def::GJ7H9XYEBzI::FkfMtDsaTzKxb92jFEqxHg` | GET `/conversations.history` | `cursor` / `next_cursor`, `has_more`; `limit` default 100, max 999 | **`oldest`** = last seen `ts` (Unix seconds string), `latest`, `inclusive` | `messages[].ts` (unique per channel) | `text`, `user`, `ts`, `thread_ts`, `reply_count`, `files` (I) | `https://<team>.slack.com/archives/{channel}/p{ts without dot}` (I) or Permalink action | V |
| Retrieve a Conversation Thread's Replies | `conn_mod_def::GJ7H99BNZZY::YUA8ceLYSMmIEPSjoukdNg` | GET `/conversations.replies` | cursor; `limit` default 1000 | `oldest` | `messages[].ts` | parent plus replies | | V |
| List Workspace Users | `conn_mod_def::GJ7IBQjys4M::0ZFuc5nOQAuLPd7qBVmGZA` | GET `/users.list` | `cursor` / `next_cursor`; set `limit` (200) or large teams fail | n/a | `members[].id` | `real_name`, `profile.email` (needs `users:read.email`), `tz`, `updated` | | V. Tier 2 (20+/min) |
| Retrieve a Message Permalink | `conn_mod_def::GJ7H85X11eQ::yuv72_aqQiWe41GP4rPp_Q` | GET `/chat.getPermalink` | n/a | | | `permalink` | `permalink` | V. Hundreds per minute allowed, but one call per message; build the link instead |
| Search Messages | `conn_mod_def::GJ7IAjr_Sns::-NYvPOrhQ_qbz8B8XmsJRg` | GET `/search.messages` | | | | | | find only |

Rate limits (from the docs): history and replies are Tier 3 (50+ per minute). For
commercially distributed apps installed outside the Slack Marketplace after
2025-05-29, Slack cut `conversations.history` and `conversations.replies` to
**1 request per minute and 15 objects per page**. Whether One's Slack app is
Marketplace-listed decides which applies (open question for the One team). Always
check `ok`; Slack answers HTTP 200 with `ok: false`.

## 10. Microsoft Teams (`teams`)

| Action | Action id | Method / path | Pagination | Incremental | Id path | Key fields | Link | Docs |
|---|---|---|---|---|---|---|---|---|
| List Chats | `conn_mod_def::GJ7M0XFmgfA::ccNbrhTlTROYTSZtYigXCg` | GET `/chats` | `$top`/`$skip`, `@odata.nextLink` | `$filter`, `$orderby=lastMessagePreview/createdDateTime desc` (I) | `value[].id` | `topic`, `chatType`, `lastUpdatedDateTime` (I) | `webUrl` (opaque) | V (loaded on retry) |
| List a Chat's Messages | `conn_mod_def::GJ7M1v_ty1I::z6ijZ292SHKR9tz7c9nEOQ` | GET `/chats/{{chatId}}/messages` | `$top` (Graph max 50, I), `@odata.nextLink` | `$filter=lastModifiedDateTime gt ...` with `$orderby=lastModifiedDateTime desc` (I) | `value[].id` | `body {contentType, content}` (HTML), `from.user.{displayName,id}`, `subject`, `chatId`, `createdDateTime`, `lastModifiedDateTime`, `mentions[]` | `value[].webUrl` | V |
| List a User's Joined Teams | `conn_mod_def::GJ7NUzqmPxU::KPH8i5-qTwG3rhZHepN3Fg` | GET `/users/{{userId}}/joinedTeams` (`userId=me` I) | `@odata.nextLink` | | `value[].id` | `displayName`, `webUrl` | `webUrl` | V |
| List a Team's Channels | `conn_mod_def::GJ7NFwMDWsI::zD6Vj-Z-SoKYto-H5m6G7A` | GET `/teams/{{teamId}}/channels` | `@odata.nextLink` | | `value[].id` | `displayName`, `webUrl` | `webUrl` | V |
| List a Team Channel's Messages | `conn_mod_def::GJ7NFu8gqzs::PDTTlBTESTOVm9vLTTpU9A` | GET `/teams/{{teamId}}/channels/{{channelId}}/messages` | `$top`, `@odata.nextLink` | none on this list; use delta | `value[].id` | top-level messages only, no replies | `webUrl` | V |
| Delta List a Team Channel's Messages | `conn_mod_def::GJ7NFaW12yo::D62bOYGhSkK1cOoDf-KCWA` | GET `/teams/{{teamId}}/channels/{{channelId}}/messages/microsoft.graph.delta()` | `@odata.nextLink`, then `@odata.deltaLink`; reuse the link as-is | delta token | `value[].id` | same; replies need the replies endpoint | | V |
| List Replies to a Chat Message | `conn_mod_def::GJ7M1InwLM0::jd10r85nRQONMgo1wrZcLg` | GET `/chats/{{chatId}}/messages/{{chatMessageId}}/replies` | | | | | | find only |

The `teams` platform is Graph; chat message reads usually need `Chat.Read`, and
channel messages `ChannelMessage.Read.All`, which needs admin consent in most
tenants (I). Graph throttles Teams reads per app per tenant (I).

## 11. Granola (`granola`)

| Action | Action id | Method / path | Pagination | Incremental | Id path | Key fields | Link | Docs |
|---|---|---|---|---|---|---|---|---|
| List Notes | `conn_mod_def::GKbJ53hO4Ng::02BNDFnhQ-CVKjaPxMIMrg` | GET `/v1/notes` (public-api.granola.ai) | query `cursor` / resp `cursor` + `hasMore`; `page_size` | **`updated_after`**, `created_after`, `created_before` | `notes[].id` (`not_` + 14 chars) | `title`, `owner`, `created_at`, `updated_at` (no body) | none documented; `https://notes.granola.ai/d/<id>` (I) | V |
| Get Note | `conn_mod_def::GKbJ523eLeg::Qnq0sQ9eSQGAepuzo55Jsw` | GET `/v1/notes/{{noteId}}` | n/a | n/a | `id` | `title`, `summary_text`, `summary_markdown`, `owner.{name,email}`, `attendees[].{name,email}`, `calendar_event.{event_title, invitees[].email, organiser, scheduled_start_time, scheduled_end_time, calendar_event_id}`, `folder_membership[].name`, `created_at`, `updated_at`; `include=transcript` adds `transcript[].{speaker,text,start_time,end_time}` | | V |

List returns only ids and titles, so index = list (with `updated_after`) then Get
Note per id. Rate limit not documented (I).

---

## 12. Embeddings through One

| Platform | Action | Action id | Method / path | Body | Dimensions | Batch limit | Docs |
|---|---|---|---|---|---|---|---|
| `openai` | Create Embeddings | `conn_mod_def::GJ564JtA2kg::RZSxROt_TaGPn5dj1cERcg` | POST `/embeddings` | `{model, input: string[], dimensions?, encoding_format?}`; models enum `text-embedding-3-small`, `text-embedding-3-large`, `text-embedding-ada-002` | 3-small 1536, 3-large 3072, `dimensions` shrinks either (I for the numbers) | OpenAI: 2048 inputs, 8192 tokens each, 300k tokens a request (I, not in the doc) | V |
| `gemini` | Generate a Content Embedding with a Model | `conn_mod_def::GKYsLrICU4k::-QdjkeYySpau6Z88kVWVog` | POST `/v1beta/models/{{model}}:embedContent` | path `model` = bare name (e.g. `gemini-embedding-001`); body `{model: "models/<name>", content: {parts: [{text}]}, taskType: "RETRIEVAL_DOCUMENT"/"RETRIEVAL_QUERY", title?, outputDimensionality?}` | `gemini-embedding-001` 3072 default, 768/1536 via `outputDimensionality` (I) | one input | V (loaded on retry) |
| `gemini` | Batch Embed Contents for a Model | `conn_mod_def::GKYsLheH12Q::Tpg2bcnfSjenI3U6jlwKzQ` | POST `/v1beta/models/{{model}}:batchEmbedContents` | `{requests: [{model: "models/<name>", content, taskType, title?, outputDimensionality?}]}`; every request's model must match the path | same | 100 requests a batch (I) | V |
| `gemini` | Async Batch Embed Content | `conn_mod_def::GKYsLhtiRsk::1x-8PgTPQ8Gi_RvnSuHoyw` | POST `/v1beta/models/{{model}}:asyncBatchEmbedContent` | long-running batch | | | find only |
| `cohere` | Embed Text and Images | `conn_mod_def::GOBI50QrjAs::W77uZN_sRAq12F_k0a3kEg` | POST `/v2/embed` | `{model, input_type: "search_document"/"search_query", texts[], embedding_types: ["float"], output_dimension?, truncate}` | `embed-v4` 256/512/1024/1536 via `output_dimension` (I for default) | **96 texts a call** (doc) | V (loaded on retry) |
| `mistral-ai` | Create Embeddings | `conn_mod_def::GMZh4j5K2IA::ZZRIBQWMS0-Kn1uey0EP4A` | POST `/v1/embeddings` | `{model: "mistral-embed", input: string[], output_dimension?, output_dtype?}` | `mistral-embed` 1024 (I) | not documented | V |
| `voyage-ai` | none | | | | | | `find` answers "No active platform is named voyage-ai"; not in the catalog under that key (V) |

Pick one model per index and record it with every vector; never mix models in one
index. The query side must use the matching task type (`RETRIEVAL_QUERY`,
`search_query`).

## 13. LLM and Jev (TypeSafe) through One

| Platform | Action | Action id | Method / path | Shape | Docs |
|---|---|---|---|---|---|
| `anthropic` | Create a Message | `conn_mod_def::GJfJ6hmtpYo::zy68VQHpRFmqayjAzxkjDA` | POST `/messages` | header `anthropic-version: 2023-06-01`; body `{model, max_tokens, system?, messages: [{role, content}], temperature?, output_config?, tools?}`; answer `content[].text`, `usage.{input_tokens,output_tokens}`, `stop_reason` | V. Rill calls it with `claude-sonnet-5-5` (draft) and `claude-haiku-5-5` (fast); the doc's model enum is older (`claude-opus-4-6`, `claude-3-5-haiku-latest`) and is not enforced by One (Rill's real calls with the 5.5 names work) |
| `anthropic` | Create a Message Batch | `conn_mod_def::GJfJ7IX9tYs::WHWA3B_BR6O8wkIHP0xHeQ` | POST `/messages/batches` | for bulk summarizing at index time | find only |
| `typesafe` | Answer Questions Using Systemone (Jev) | `conn_mod_def::GNh4bXcHPaU::V2ndvy5CQJmYHvkElwVM_w` | POST `/v1/systemone` (api.typesafe.ai) | body `{model, state, questions}`; answer `{answers, model, usage.{input_tokens, output_tokens}}` | V |
| `typesafe` | List Available Models | `conn_mod_def::GNh4bXKyZ0c::EN7s5YVdTMGFNL5Nhbyn1A` | GET `/v1/models` | `models[].{name, description, release_date}` | V |

How Rill calls Jev (Rill's `packages/core/src/jev.ts`, `one.ts`):

```ts
await one.call(ctx, {
  platform: "typesafe", action: "systemone", level: "read",
  actionId: "conn_mod_def::GNh4bXcHPaU::V2ndvy5CQJmYHvkElwVM_w",
  method: "POST", path: "/v1/systemone", credential: "grant",
  body: {
    model: "jev-latest",                         // env JEV_MODEL overrides
    state: { me, goals, email: {from, to, cc, subject, body}, thread, facts },
    questions: {
      needs_reply: { type: "noul", instructions: "...", criteria: { true: "...", false: "..." } },
      kind:        { type: "choice", instructions: { task, rules: [...] }, criteria: { person: "...", newsletter: "..." } },
      urgency:     { type: "score", instructions: "...", criteria: ["level 0 text", "level 1 text", ...] },
    },
  },
});
// answers.<q>.noul = P(true); choice: { choice, probabilities, confidence }; score: { score, confidence }
```

`one.call` ends in `oneConnect.runAction(userId, {connectionKey, actionId, method,
path, body, query, headers})` with the TypeSafe connection key from the user's
grant (`listConnections`). Jev is bad at dates and counting (Rill's note), so ask it
judgments (is this about X, which of these, how relevant), not arithmetic.

---

## 14. Catalog access with only a Connect grant

Question: can the Search server, holding only the user's Connect grant (no
`ONE_SECRET`), list platforms, list a platform's actions and read an action's docs?

### 14.1 What @withone/connect does (read in the 0.19.0 dist, `@withone/connect/dist/server/index.esm.js`)

Base URL `https://api.withone.ai/v1`. Every call goes through `oneConnect.fetch`,
which adds the grant's credential headers:

- key mode: `X-One-Secret: <the app's Connect key>` and `X-One-Connect-User-Id: cu_...`
  (plus `X-One-Organization-Id` / `X-One-Project-Id` when set);
- token mode: `Authorization: Bearer <access token>`.

| Client method | Endpoint | Returns |
|---|---|---|
| `listConnections(userId)` | GET `/v1/connections/reachable` | `rows[]` of `{key, platform, access}`: the platforms in the grant and the policy (`full`, `methods`, `actions`) |
| `listActions(userId, platform)` | GET `/v1/knowledge?connectionPlatform=<p>&limit=100&page=N` (up to 20 pages) | `{_id, title, method, path, tags}` for every catalog action, "what exists, not what is permitted" |
| `searchActions(userId, platform, query, {limit, mode})` | GET `/v1/available-actions/search/<p>?query=&limit=&executeAgent=true` (or `knowledgeAgent=true`) | ranked actions, 5 by default |
| `getActionKnowledge(userId, actionId)` | GET `/v1/knowledge?_id=<actionId>` | `{knowledge (Markdown), ioSchema, method, path, tags}`, cached per client |
| `runAction(userId, input)` | `/v1/passthrough<path>` with `x-one-connection-key`, `x-one-action-id` | `{status, ok, blockedByGrant, refusal, data}` |
| `fetch(userId, path, init)` | any `/v1` path (pass it without `/v1`, e.g. `/users/whoami`) | raw Response |

There is no `listPlatforms`. The package's own comment on the catalog calls warns
that "a One API that does not take the credential on its catalog answers the same
bare 403 as a consent that is gone", and it then probes `/connections/reachable`
to tell the two apart. So the package itself is not sure every One deployment
accepts a grant on `/knowledge` and `/available-actions/search`.

Evidence that it works in key mode: the Forkable blocks MCP
(`forkable-components/components/mcp/src/generative.ts`) runs `find_actions` =
`searchActions` and `action_docs` / `render_ui` = `getActionKnowledge` on a Connect
key-mode grant, deployed at blocks.forkable.dev, and it was used live from Claude
and ChatGPT on 2026-10-28. I did not re-run it (no grant and no secret here, by
rule). Token mode is unverified. Open question from Builder's research still
stands: do these answer for a platform the user has NOT granted? Treat that as
unknown until tested.

### 14.2 How the One CLI gets its data (2.10.0 dist, `chunk-5CPQHXTO.js`)

Header `x-one-secret: <ONE_SECRET>` (a personal API key) on every call, base
`https://api.withone.ai/v1`:

- `actions find`: POST `/v1/available-actions/find` with
  `{requests: [{platform, intent}], task, knowledgeAgent}` (up to 10 pairs), plus
  caller headers naming the agent and model.
- `actions load`: GET `/v1/knowledge?_id=<actionId>` (with ETag caching), then
  digests the Markdown locally.
- `platforms`: GET `/v1/available-connectors?page=N&limit=100`.
- list: GET `/v1/available-actions/<platform>?limit=500`; search: GET
  `/v1/available-actions/search/<platform>`.

Note: `actions load` reports "no such action, or this CLI may not use it" whenever
the knowledge fetch fails, including a 429. Several ids above first failed that
way and loaded on a slower retry. One's find/knowledge endpoints rate-limit a
burst of about ten parallel calls.

### 14.3 Unauthenticated tests (curl, 2026-10-29)

| Endpoint | Result |
|---|---|
| GET `https://api.withone.ai/v1/available-connectors?page=1&limit=100` | **200, public.** `{rows, total: 1052, pages: 11, page}`; each row has `platform`, `name`, `title`, `description`, `category`, `image` (assets.withone.ai SVG), `tags`, `tools` (action count), `oauth`, `status`, `active` |
| GET `https://api.withone.ai/open/count/platforms` | 200 `{"message":"1,052"}` (badge JSON) |
| GET `https://api.withone.ai/open/count/tools` | 200 `{"message":"138,973"}` |
| GET `/open/count/actions`, `/open/count`, `/open/knowledge`, `/open/platforms`, `/open/connectors`, `/v1/public/connectors` | 404 |
| GET `/open/knowledge/gmail`, `/open/knowledge/gmail/actions?page=1`, `/open/knowledge/gmail/actions/search?query=`, `/open/knowledge/gmail/auth` | 401 (documented as needing `x-one-secret`, a free API key) |
| GET `/v1/available-actions/gmail`, `/v1/available-actions/search/gmail`, `/v1/knowledge?_id=...` | 401 |
| GET `https://withone.ai/api/knowledge/gmail/search?query=list%20threads` (follow the 308) | **200, public.** The website proxies `/open/knowledge/<p>/actions/search` with its own public key; returns `[{id, title, modelName, method, path, tags}]` |
| GET `https://withone.ai/knowledge/gmail/md` | **200, public** Markdown: category, action count, and every action with method, path and a link |
| GET `https://withone.ai/knowledge/gmail/<actionId>/md` | **200, public** Markdown of the action's full knowledge with frontmatter |

### 14.4 Answer

- **List platforms: yes, with no credential at all.** GET
  `https://api.withone.ai/v1/available-connectors?page=N&limit=100` (11 pages
  today). Through the grant it is also reachable as
  `oneConnect.fetch(userId, "/available-connectors?...")` (I, same endpoint). The
  platforms the user actually granted come from `listConnections`.
- **List a platform's actions and read docs: yes through the grant, per the
  package and the live blocks MCP (key mode); not with curl alone.**
  `oneConnect.listActions` / `searchActions` / `getActionKnowledge` hit
  `/v1/knowledge` and `/v1/available-actions/search/<p>` with the grant's headers.
  `ioSchema` in the knowledge answer is the machine-readable input schema. Verify
  once in Search's own sign-in (token mode, and a platform outside the grant)
  before depending on it.
- **Fallbacks without any credential:** the withone.ai pages
  (`/knowledge/<p>/md`, `/knowledge/<p>/<actionId>/md`, `/api/knowledge/<p>/search`)
  are public but are website routes, not an API contract; fine for a dev-time
  generator, not for runtime.
- **Do not use** `/open/knowledge/*` or the CLI's `x-one-secret` routes from the
  Search server: both need a One API key, which breaks the Connect-only rule.

---

## 15. Verified vs inferred, per item

Verified by loading the docs in this session (V in the tables): every HubSpot list
and search id except the 10,000 cap and rate limit; all four Attio `get-*`, the raw
records query and List Notes; Gmail get-threads, get-emails, raw threads list,
thread get, message get, history; Outlook List Messages, Get Message, Delta
Messages; Google Calendar list and events; Outlook Calendar events, calendar view,
event delta; Notion search, page markdown, block children, data source query;
Linear issues, projects, comments, documents (arguments and pagination); Slack
channels, user conversations, history, replies, users, permalink; Teams chats,
chat messages, joined teams, channels, channel messages, channel delta; Granola
list and get; OpenAI, Gemini (single and batch), Cohere and Mistral embeddings;
Anthropic messages; TypeSafe systemone and models; the connect package endpoints
(read in source); the curl results.

Inferred (I in the tables), not confirmed by a loaded doc: web link templates for
HubSpot, Gmail, Slack and Granola; HubSpot property names for the modified-date
filter and the 10,000 search cap; Attio note field names beyond `content_markdown`
and its lack of an updated filter; Outlook `@odata.deltaLink` on the message delta
and the per-folder caveat; Graph, Notion, Linear and Teams rate-limit numbers;
Linear response node fields (selectable by GraphQL, not enumerated in the docs);
embedding dimensions and the OpenAI and Gemini batch limits; that catalog calls
work in token mode and for platforms outside the grant; Gmail profile, Outlook
`/me` and Outlook calendars list (taken from Rill's code, not loaded here); that
`oneConnect.fetch("/available-connectors")` behaves like the public call.

Found but not loadable in this session: Gemini Create a Text Embedding
(`GKYsLqn9paU`, deprecated `embedText`), refused after eight retries.
