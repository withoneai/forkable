# Rill build contract

Read this before touching any package. It is the glue between the four
packages, which are built in parallel. Deviations must be made here first.

## Shape

pnpm monorepo, Node 22, ESM, TypeScript strict, tsx in dev.

```
INBOX.md                      plain-English lanes and rules (compiled by packages/core/src/policy.ts)
fixtures/inbox.json           the Acme sample inbox (40 threads), made-up senders only
fixtures/recorded/<threadId>.json   recorded Jev + writer answers, replayed on sample runs
packages/core/src/
  types.ts                    domain types (browser-safe)
  api-types.ts                HTTP contract (browser-safe)
  db/schema.ts, db/client.ts  Drizzle (pg) schema, createDb, runMigrations, ensureDatabase
  db/migrations/              drizzle-kit output; run `pnpm db:generate` after schema edits
  one.ts                      every platform call: fixture | connect | key; writes the ledger
  gmail.ts                    sync (get-threads), labels, drafts, send, delete-attempt
  sanitize.ts                 html->text, quote stripping, hidden text, From parsing
  jev.ts                      the question set, parse, screen thresholds, fallback
  policy.ts                   INBOX.md -> rules; decide(facts, answers, goals, vips) -> Decision
  facts.ts                    hard facts from the db (vip match, first-time sender, team, …)
  judge.ts                    judge one message end to end: facts -> jev -> policy -> store
  writer/index.ts             Writer interface + pick engine
  writer/engines/local.ts     claude / codex / gemini CLIs, tool-less, headless
  writer/engines/one.ts       Anthropic / OpenAI / Gemini through One on the user's grant
  writer/prompts.ts           summary, draft, brief, ask, jev-fallback prompts
  writer/validate.ts          draft validator (no new URLs, no claimed actions, no dashes, …)
  agents.ts                   find installed CLIs (PATH, well-known dirs, login shell), probe sign-in
  ledger.ts                   record(), list(), today()
  sync.ts                     import/poll a mailbox, enqueue judging
  brief.ts                    morning brief from stored judgments
  ask.ts                      ask your inbox: retrieval in code, LLM answers with citations
  fixtures.ts                 load fixtures/inbox.json into a sample mailbox; recording helpers
  ids.ts                      newId()
server/src/
  node.ts                     local entry: embedded Postgres, migrations, Hono on 51789, static ui/dist
  app.ts                      createApp(deps) -> Hono app (all routes)
  connect.ts                  key-mode client, rill_sid, whoami, dedup by cu_/email
  routes/*.ts                 one file per resource
  events.ts                   SSE hub per mailbox
  scheduler.ts                every 2 min: sync due mailboxes; in-process judge queue
  worker.ts                   Cloudflare entry (fetch/scheduled/queue), createOneConnectRoutes. Skeleton only.
ui/src/                       Vite + React 19 + Tailwind 4; see "UI" below
cli/src/index.ts              `rill` (start server + open browser), `rill demo` (keyless, exits 0), `rill record`
cli/bin/rill.mjs              bin shim
```

## Identity

- `rill_sid` cookie (httpOnly, SameSite=Lax, Secure when https). Middleware
  mints it when missing and creates a `users` + `sessions` row lazily on first
  write (mailbox creation). `identifyUser` returns the user id for the sid.
- Connect, key mode: `createOneConnect({ connectKey, userStore })`, userStore
  reads/writes `connect_users` by user id. `onComplete` with outcome
  `connected` runs `onConnected` (Node adapter and the Worker both):
  1. `whoami(oneConnect, userId)` = `oneConnect.fetch(userId, "/users/whoami")`
     plus `GET /v1/users/me` for the picture (`avatar`; One's picsum
     placeholder is dropped). Its `user.{id,name,email}` is the One account:
     written to `users.oneUserId/name/email/avatarUrl` (migration 0007).
     Both routes need the grant's OAuth scope `user:profile:read`
     (core-rust #1055, 2026-10-21); without it they answer 403. The
     package's default scopes leave it out, so `createConnect` passes
     `scopes` explicitly. A grant made before that needs one more sign-in.
  2. Account merge before anything else: an existing user with the same
     `connect_user_id` (parsed with `parseUserReference`), else the same
     `oneUserId`, else the same whoami email. If found, re-point the session
     at that user instead of creating a second account.
  3. The mailbox address comes from Gmail, never from whoami: the mail
     provider's `address(ctx)` (Gmail "Get a User's Gmail Profile",
     `GET /gmail/v1/users/me/profile`, `emailAddress`, a ledger row). The two
     emails differ whenever someone signs in to One with a work address and
     grants a personal Gmail; the mailbox address is what "from me" and the
     calendar's `self` match on. Until Gmail answers, the connection title
     is the guess. whoami failing never blocks the mailbox.
  `GET /me` backfills name/email/oneUserId with one whoami per process for
  users who signed in before whoami answered Connect users.
  Smoke: `cd server && pnpm exec tsx scripts/smoke-whoami.ts` (stubbed grant,
  scratch database on the embedded Postgres, dropped after).
- Revoke: `OneConnectError` code `reconnect_required` -> set the mailbox
  status `reconnect_required`, emit SSE `reconnect_required`, stop syncing it.

## Mailboxes and modes

- `source: sample` + `mode: fixture`: the Acme inbox. Every call replays
  fixtures. Created by `POST /mailboxes/sample`. Always available, no keys.
- `source: live` + `mode: connect`: one mailbox per mail connection in the
  grant. A grant can hold several connections of one platform (two Gmail
  accounts, a Gmail and an Outlook); the Connect callback (`onConnected`)
  makes or updates one mailbox for each, Gmail first, then Outlook, in
  One's list order. Matched by `connectionKey`, then by address (a
  connection made again gets a new key), then the lone mailbox of the
  single-account era. A mailbox whose connection left the grant goes
  `status: paused` with its mail kept, and resumes when the account is
  granted again. A new account copies the first live mailbox's settings row
  (so it skips the wizard); goals and VIPs stay per mailbox.
- Calendars pair per account (`pairCalendars`): keep a calendar the grant
  still reaches, else the calendar connection whose title is the mailbox's
  address, else the next unclaimed one of the mail's vendor whose title is
  not another address. Unproven on a real grant: whether One titles Gmail
  and Calendar connections with the account's address.
- All inboxes (`GET /inbox/all?lane=`, `AllInboxResponse`): every live
  mailbox's lane in one list, ranked by priority then the newest message,
  counts summed, each row tagged `mailbox: { id, label, address }`. The UI
  shows it at `/all/:lane` and `/all/thread/:threadId` once there are two
  live accounts (sidebar entry, switcher item, `G I`); a thread opens, and
  every action runs, on its own mailbox (the row's tag, else the thread
  id's `mbx_…:` prefix). It polls every 20 s, since the live stream is per
  mailbox. Compose and the Today rail use the mailbox picked in the switcher.
- The UI's mailbox switcher lists every mailbox (hint Gmail / Outlook /
  not granted / sample) and ends with "Add another account", which reopens
  Connect on the Gmail screen; on return the new mailbox opens.
- No key mode. Every platform call runs on the signed-in user's Connect grant:
  mail through the mailbox's connection (`connectionKey`), calendars through
  the mailbox's calendar connection (`calendarConnectionKey`; the grant's
  first calendar only for an old mailbox with none), TypeSafe (Jev) and the
  LLMs through the grant's connection for that platform (`one.grantedConnections`). No
  `ONE_SECRET` or `ONE_CONNECTION_*` anywhere; never ask Moe for one. Sample
  mailboxes replay recordings; `rill record` needs a user who signed in with
  One and granted TypeSafe, and runs through that grant.

## `one.ts` call layer (packages/core)

```ts
call<T>(ctx, { platform, action, level, method, path, summary, actionId, body?, pathParams?, query?, fixture: () => T, pick?: (data) => T })
```
- `ctx = { db, mailbox, user, oneConnect?, source }`. Resolves the mode from
  the mailbox (`fixture` for sample; `connect` via `oneConnect.runAction(userId,…)`
  with the mailbox's Gmail key or the grant's key for the platform).
- Always writes one `ledger` row (platform, action, method, path, mode,
  level, status, ok, blockedByGrant, refusal, ms, summary). `blockedByGrant`
  from `RunActionResult`. In fixture mode a call outside the sample grant
  (delete) replays `{ status: 403, blockedByGrant: true, refusal: "grant" }`.
- Throws `NotConnected`, rethrows `OneConnectError` (server maps
  `reconnect_required`).

Action ids (One catalog, verified 2026-10-21):
- gmail get-threads `conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ` POST /v1/gmail/get-threads
  body `{ connectionKey, label?, query?, numberOfThreads (1..100), pageToken?, format?, maxBodyLength? }`
  -> `{ threads[]: { id, snippet, historyId, messages[]: { messageId, sender, receiver, time, subject, body, labelIds, snippet } }, nextPageToken? }`
  Custom action (tag custom): the connection key goes in the body; the Connect package does that itself.
- gmail get thread `conn_mod_def::GJ3ok0Eq0R8::AAzgZVLqTg2iBuITKpJLZg` GET /gmail/v1/users/{{userId}}/threads/{{id}}
- gmail list labels `conn_mod_def::GJ3obtut_gA::L4R17Zu8QL-awsrk5_4b8w` GET /gmail/v1/users/{{userId}}/labels
- gmail create label `conn_mod_def::GJ3obSDbZXA::SU-y_lLPQwWPvwvrPRPbEg` POST /gmail/v1/users/{{userId}}/labels
- gmail modify thread labels `conn_mod_def::GJ3olIfJ9E0::xBAV1bF_RXG94_j4bmye2A` POST /gmail/v1/users/{{userId}}/threads/{{id}}/modify `{ addLabelIds, removeLabelIds }`
- gmail create draft `conn_mod_def::GGZUe0SIuk8::nhwEKp2cQ6uARsH3513VeQ` POST /v1/gmail/create-draft `{ to, subject, body, threadId?, inReplyTo?, references? }`
- gmail send email `conn_mod_def::GGXAjWkZO8U::uMc1LQIHTTKzeMm3rLL5gQ` POST /v1/gmail/send-email `{ to, subject, body, threadId?, inReplyTo?, references? }`
- gmail delete message `conn_mod_def::GJ3ocgKltKQ::s8UCfiDLSaO9w9oPU32TYA` DELETE /gmail/v1/users/{{userId}}/messages/{{id}}  (NEVER in the grant; used only for the receipt demo)
- gmail history `conn_mod_def::GJ3obKaXB1U::JWUEs9nESz2__4shMOpyIg` GET /gmail/v1/users/{{userId}}/history (later)
- typesafe systemone `conn_mod_def::GNh4bXcHPaU::V2ndvy5CQJmYHvkElwVM_w` POST /v1/systemone
  body `{ model: "jev-latest", state, questions }`; answers: choice `{ choice, confidence, probabilities }`, noul `{ noul }`, score `{ score, confidence, probabilities }`
- anthropic create message `conn_mod_def::GJfJ6hmtpYo::zy68VQHpRFmqayjAzxkjDA` POST /messages, header `anthropic-version: 2023-06-01`, body `{ model, max_tokens, system, messages }`

Outlook (Microsoft Graph through One's `outlook-mail` and `outlook-calendar`; ids read from the catalog 2026-10-23, fixture-verified by `packages/core/scripts/smoke-outlook.ts`, no real grant yet). Graph's verb actions take PascalCase parameters (`Comment`, `SendResponse`, `Schedules`, `StartTime`), exactly as the catalog documents them; resource bodies stay camelCase.
- outlook-mail get profile `conn_mod_def::GMIYxNZ51eU::xY4rcCXiTTyrarjC9ac97w` GET /v1.0/me (`mail`, else `userPrincipalName`; needs User.Read on the connection, else 403 and the title stays the guess)
- outlook-mail list messages `conn_mod_def::GMIYwcOQ0W0::zXQUrHvhTy-rXQG3h50Paw` GET /v1.0/me/messages, OData in the query: sync sends `$filter=isDraft eq false and receivedDateTime ge …`, a thread is `$filter=conversationId eq '…'`, pages are `@odata.nextLink`'s `$skip`
- outlook-mail list folder messages `conn_mod_def::GMIYwcTo-HI::GT_NIVtaThKotZiBeiCasw` GET /v1.0/me/mailFolders/{{mailFolderId}}/messages (`sentitems`, VIP suggestions)
- outlook-mail update message `conn_mod_def::GMIYzPogSbc::Y193gU4vTjGvD4AHVZ1n7A` PATCH /v1.0/me/messages/{{messageId}} `{ categories }` (the whole array; lanes are categories)
- outlook-mail create message `conn_mod_def::GMIYvMTGW44::v0l2HirsSfy0SUTNwcsCAw` POST /v1.0/me/messages (a new draft: Compose)
- outlook-mail create reply `conn_mod_def::GMIYxdg2AH8::ZxbBRaXcQsGVvtiWQl5pFg` POST /v1.0/me/messages/{{messageId}}/microsoft.graph.createReply `{ Comment }` (Save to Drafts)
- outlook-mail reply `conn_mod_def::GMIYyGDPmeM::46r7Kmr7RnuPgS8FJJjqpA` POST …/microsoft.graph.reply `{ Comment }` (Send on a reply)
- outlook-mail send draft `conn_mod_def::GMIYyRYRR_M::DICn4DLuT_OjefG-EBoBZQ` POST /v1.0/me/messages/{{messageId}}/microsoft.graph.send (a fresh send: create message, then this)
- outlook-mail delete message `conn_mod_def::GMIYvl8Sywk::YzE-MOO4TeeYwXkMGPVuKQ` DELETE /v1.0/me/messages/{{messageId}} (NEVER in the grant; the receipt, "Outlook · delete")
- outlook-calendar list calendars `conn_mod_def::GMIY1FxtnJw::naghBU_mSTKsg0Lv46gF1w` GET /v1.0/me/calendars
- outlook-calendar calendarView `conn_mod_def::GJ58LPpX-M4::e4__fu-6SUK_WBT15hJPoQ` GET /users/{{userId}}/calendars/{{calendarId}}/calendarView (`userId=me` is a documented valid example; `startDateTime`/`endDateTime` required)
- outlook-calendar get event `conn_mod_def::GMIY1Ut6_5I::obpJ0K6KQLeDXH7pylwnnA` GET /v1.0/me/calendars/{{calendarId}}/events/{{eventId}}
- outlook-calendar create event `conn_mod_def::GMIYzzLtyCs::pxfz0Zs8RAOgUEAaupZnwQ` POST /v1.0/me/calendars/{{calendarId}}/events (Teams: `isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness"`, link back in `onlineMeeting.joinUrl`)
- outlook-calendar update event `conn_mod_def::GMIY4VeTZko::hZ-fygB-SKG-v62mbL9Q4A` PATCH /v1.0/me/calendars/{{calendarId}}/events/{{eventId}} (no sendUpdates: Outlook tells guests itself, so `notify` is not sent and the card offers no "Don't send"; Outlook ignores later changes to isOnlineMeeting, so a Teams link cannot be removed)
- outlook-calendar cancel event `conn_mod_def::GMIY2iX6VWo::PKMpKfnYSc--zC-KNUrxZg` POST …/events/{{eventId}}/microsoft.graph.cancel `{ Comment }` (organizer only; guests get a cancellation; the event goes to Deleted Items, so the next sync marks it cancelled)
- outlook-calendar accept / tentativelyAccept / decline `conn_mod_def::GMIY2cTKoZQ::6Ad3ITA7TceVX2rwD20liw` / `conn_mod_def::GMIY3h5hWBg::TaB9FQDbTrajyJOIM_Ui8g` / `conn_mod_def::GMIY23ekoXk::KJRqXy5bRe665p0W1lQ1zw` POST /v1.0/me/calendars/{{calendarId}}/events/{{eventId}}/microsoft.graph.<verb> `{ SendResponse: true, Comment? }`
- outlook-calendar getSchedule `conn_mod_def::GMIY3HWTwYM::wFSj8jG2QUm8a7Kwqg3V4w` POST /v1.0/me/calendar/microsoft.graph.getSchedule `{ Schedules: [<mailbox address>], StartTime, EndTime }` (per SMTP address, not per calendar)
- outlook-calendar delete event `conn_mod_def::GJ58Ko4_2AA::Q2rSSZEERHKLX7is1w_8Ng` DELETE /users/{{userId}}/calendars/{{calendarId}}/events/{{eventId}} (NEVER in the grant; `userId` is the mailbox address; the receipt, "Outlook Calendar · delete")
- outlook-calendar subscriptions create/delete `conn_mod_def::GL-UqszYiaA::j_GK5FFxSNCkhTfCnEtzBA` / `conn_mod_def::GL-Uquoca4A::ZFSQGF6-QfeF6lZ6y1BPUw` (hosted push, Phase C, not exercised)
Graph event times are a wall clock plus a zone name, often a Windows one ("Pacific Standard Time"); reads convert through `tz.ts` (`ianaZone`, `wallClockToUtc`), writes go out as a UTC wall clock with `timeZone: "UTC"`.
The Connect callback makes the mailbox over the grant's Gmail, else its Outlook Mail (`mailboxes.mail_provider`), and takes the calendar of the same vendor first. `outlook-mail` calls run on the mailbox's connection, like Gmail; `outlook-calendar` on the grant's connection for it. The Connect app's permission set has to offer Outlook Mail and Outlook Calendar for any of this to reach a user.

## Jev (packages/core/src/jev.ts), one request per message

state: `{ me, goals: {id: "title: detail"}, vips_by_description: {id: description}, email: { from, to, cc, subject, is_reply_in_thread, has_list_unsubscribe, body }, hidden_text, facts: { sender_is_vip, first_time_sender, team_domain } }`

questions (keys fixed, used as `judgments.question`):
- `inj_agent_addressed`, `inj_override`, `inj_action_request` (noul), `inj_hidden` (noul, only when hidden text)
- `kind` (choice: person, newsletter, receipt, notification, calendar, cold_pitch)
- `goal` (choice over goal ids + `none`), omitted when no goals
- `needs_reply` (noul), `ball` (choice me/them/third_party/nobody), `urgency` (score, 4 levels)
- `vip_<id>` (noul) per description VIP
- `commitment` (noul)
Labels (for the UI): "Addressed to an AI", "Tries to override instructions", "Pushes for an action", "Hidden text", "Kind of email", "Which goal does this move?", "Does it need a reply from you?", "Whose move is next?", "Urgency", "Matches VIP: <name>", "Did you promise something?".
Fallback when Jev is not in the grant (`code: "jev_missing"`): the writer answers the same questions as JSON (`writer.judgeFallback`), `confidence` capped at 0.6, `judgedBy = "writer-fallback"`. When Jev is in the grant but failing, a live mailbox fails closed: the first failure sets `mailboxes.sync_state.jevDownSince`, every message stays unjudged (`judgePending` returns it as `held`, one Jev attempt per run), and only after `JEV_HOLD_MS` (1 hour) does the writer judge, with `draft` forced off, Check on and `checkReason` saying so. The next good Jev answer clears `jevDownSince`. Sample mailboxes keep the old path (recordings, then the writer, then the fixture's expectation).

## Policy (packages/core/src/policy.ts)

`compileInbox(markdown) -> Policy` reads the bullets in INBOX.md (the grammar is the file as written; unknown lines throw with the line number). `decide(input) -> Decision` where input = `{ facts, answers, goals, vips, senderStatus, thresholds }`. Priority per the INBOX.md formula, clamped 0..100. Pausing a goal or moving a weight re-runs `decide` over stored judgments only (no Jev call).

Ported from email2 (2026-10-27):
- **Check band.** Besides the low-confidence rule, Check shows when a deciding probability sits within `thresholds.checkBand` (0.15, INBOX.md "within 0.15 of its line") of its line: needs-reply, the best goal, or an injection signal just under quarantine. `Decision.checkReason` (stored as `thread_state.check_reason`) says which, in words; the borderline reason wins over the confidence one.
- **Facts code knows.** `facts.firstTimeSender` now also needs "never met": any calendar event with them makes them known. `facts.meetingSoon` is an event with them in the next 48 hours (INBOX.md "a meeting with them in the next 48 hours adds 15"). Cold outreach: a first-time sender, not a reply, with `cold_pitch` >= 0.35 (lower than `coldPitch` 0.7 because code already knows they are a stranger) owes no reply, gets no draft and takes the cold pitch penalty.
- **Follow-ups.** `sync.followUps(ctx)` runs after every scheduler pass and recomputes timers from the messages (a reply sent from Gmail never passes through the judge). You wrote last and the timer ran out: the thread comes back once per round (undone, unsnoozed, `follow_up_shown_at` set) and the row carries `followUpDue` (the "Follow up" chip). INBOX.md "N business days" skips weekends.

## Inbox tabs and reconcile (packages/core/src/categories.ts, sync.ts)

`settings.mail_categories` (default `["primary"]`; sample mailboxes get all five Gmail tabs so the demo keeps its newsletters). Gmail: `primary, promotions, updates, social, forums`; Outlook: `primary` (Focused) and `other`. The same list filters three places: the provider query (`categoryQuery`: `in:inbox -category:x ...`; the Outlook mapper turns `-category:other` into `inferenceClassification eq 'focused'` and ignores `in:inbox` so sent replies stay in the thread), the judging queue (`inReadTabs`), and the inbox rows and lane counts (a thread shows when it has an inbound message in a tab that is on). Turning a tab on kicks a full 7-day sync.

`sync.reconcile(ctx, listedIds)` runs at the end of every `syncMailbox`: listed threads missing from the database (`missing`), listed threads with judged messages but no lane (put back in the queue, `requeued`), and inbound messages in read tabs unjudged for over 30 minutes (`stuck`). Stored in `sync_state.reconcile`. `InboxResponse.health` (`MailHealth`) carries it with `stale` (live, no finished sync in 2 hours), `jevDownSince`, `jevFallback`, `held` and `hiddenByTabs`; the inbox shows a one-line warning and Settings -> General a Mail health card. SSE event `{ type: "health" }` refreshes both. Tests: `packages/core/scripts/smoke.ts` section 7, `server/scripts/smoke-filtering.ts` (live path on a stubbed grant).

## Writer (packages/core/src/writer)

```ts
interface Writer { engine: WriterEngine; provider: string; model: string;
  complete(input: { system: string; user: string; json?: boolean; maxTokens?: number }): Promise<{ text: string; model: string; costUsd: number | null }> }
pickWriter(settings, env, detected) -> Writer     // local when a signed-in CLI, else one, else null
summarize(mail, thread) -> { summary, ask }      // haiku-class model
draft(mail, thread, me, person, goal) -> { body, validator }  // sonnet-class; validated; 2 attempts
brief(...)-> BriefResponse, ask(...) -> AskResponse, judgeFallback(...) -> JevAnswers
```
Local engine commands (never a bypass-permissions flag, never tools):
- `claude -p --model <sonnet|haiku> --tools "" --output-format json --system-prompt <s> <user>` -> parse `.result`
- `codex exec --json --sandbox read-only <prompt>` -> last `item.completed` agent message
- `gemini -p <prompt> --output-format json` -> `.response`
Sign-in probe: a one-token call with a 20s timeout; cache the result for the process.
Every writer call writes a ledger row (platform claude-code|codex|gemini-cli|anthropic|…, mode local|key|connect, level read, engine, model, cost).

## Server API (all JSON, prefix /api/v1 unless noted)

```
GET  /api/health                              -> { ok: true, version }
GET  /me                                      -> MeResponse
POST /signout                                 -> 204 (clears rill_sid; data stays)
GET  /api/one/authorize, GET /api/one/callback (Connect, Node adapter)
POST /connect/disconnect                      -> 204 (drops our copy; the user revokes in One)
POST /mailboxes/sample                        -> ApiMailbox (idempotent per user; loads fixtures, judges from recordings)
GET  /mailboxes/:id/inbox?lane=vip&includeDone=0 -> InboxResponse (sorted by priority desc, then date)
GET  /mailboxes/:id/threads/:threadId         -> ThreadResponse
POST /mailboxes/:id/threads/:threadId/actions  body ThreadAction -> InboxRow
POST /mailboxes/:id/threads/:threadId/draft    body { instructions?: string } -> ApiDraft (writes/rewrites)
POST /mailboxes/:id/compose                    body ComposeInput { to, subject, body } -> ComposeResponse { gmailDraftId } (a new, non-reply draft; no thread, no drafts-table row)
PUT  /mailboxes/:id/drafts/:draftId            body { body } -> ApiDraft (status edited)
POST /mailboxes/:id/drafts/:draftId/save       -> ApiDraft (Gmail Drafts; fixture ok)
POST /mailboxes/:id/drafts/:draftId/send       -> ApiDraft (status sent; the ONLY path that calls send-email)
POST /mailboxes/:id/drafts/:draftId/discard    -> 204
GET/POST /mailboxes/:id/goals, PUT/DELETE /mailboxes/:id/goals/:goalId  (ApiGoal, GoalInput). Changing goals re-decides stored judgments; adding/editing title or detail re-judges unjudged + marks others stale (re-judge lazily, sample: recordings only)
GET/POST /mailboxes/:id/vips, PUT/DELETE /mailboxes/:id/vips/:vipId     (ApiVip, VipInput)
POST /mailboxes/:id/vips/suggest               -> VipSuggestion[] (from sent mail / fixtures)
GET  /mailboxes/:id/onboarding/suggestions     -> OnboardingSuggestions
GET  /mailboxes/:id/brief?date=YYYY-MM-DD      -> BriefResponse (generated on first ask per day, cached in briefs)
POST /mailboxes/:id/ask                        body { q } -> AskResponse
GET  /mailboxes/:id/access                     -> AccessResponse
POST /mailboxes/:id/access/receipt-demo        -> LedgerRow (the injection email's delete attempt: 403 blockedByGrant)
GET  /mailboxes/:id/ledger?limit=100           -> LedgerRow[]
POST /mailboxes/:id/sync                       -> SyncResponse
GET  /mailboxes/:id/events                     SSE of MailboxEvent
GET  /mailboxes/:id/palette?q=                 -> PaletteResponse
GET  /mailboxes/:id/settings, PUT …            -> ApiSettings
GET  /engines                                  -> EnginesResponse
GET  /mailboxes/:id/calendar?from=&to=        -> CalendarResponse (events in the window, conflicts marked)
GET  /mailboxes/:id/events/:eventId            -> EventResponse; GET …/prep -> meeting prep; POST …/rsvp body RsvpAction
POST /mailboxes/:id/events                     body CreateEventInput -> CreateEventResponse (201; sample mailboxes answer from the fixture closure). `conferencing: "zoom"` first calls Zoom "Create a User's Meeting" on the grant, then puts the join URL in the event's location and description; 400 when the provider is not in `available`
PATCH /mailboxes/:id/events/:eventId          body EventPatchInput -> ApiEvent. Only when `event.editable` (you organize it, or it has no organizer): title, description, location, start/end/timeZone/allDay, attendees (existing guests keep their reply; new ones are needsAction), conferencing (google-meet/teams made by the calendar, zoom created first on the grant, null strips the link), status "cancelled". `notify: "all" | "none"` (default none) is Google's sendUpdates: the UI asks "Send update to guests?" before any change guests would see, the way Notion Calendar does. Delete stays outside the grant (the 403 receipt); the organizer cancels with status, a patch. 403 when not editable, 409 when already cancelled.
PUT  /mailboxes/:id/calendars/:calendarId      body CalendarPatchInput
POST /mailboxes/:id/freebusy                   body FreeBusyRequest
POST /mailboxes/:id/threads/:threadId/offer-times | propose-time
GET  /mailboxes/:id/conferencing               -> ConferencingResponse. `available` lists only what the grant has: google-meet with a Google calendar, teams with an Outlook calendar (Graph makes the link on the event), zoom when `zoom` is a connection in the grant (works with either calendar). `default` is the settings value when still available.
GET  /mailboxes/:id/contacts?q=&limit=8        -> ContactsResponse. People to invite, ranked from stored mail (sent-to weighs most, then received-from) and recent event attendees, newer first. Read from the database only; no platform call. Excludes the mailbox's own address and no-reply senders.
```
Errors: `{ error: { code, message } }` with 400/403/404/409/502. Code `reconnect_required` when the grant is gone.

Connect setup (local mode only, `server/src/routes/setup.ts`, types in `packages/core/src/connect-setup.ts`). Write-only: no route ever returns a stored value, only `saved`, `where` (keychain or file), `updatedAt` and the last four. Answers only when Host is 127.0.0.1/localhost and a write's Origin is too. Hosted (`connectSetup: null`) answers `{ available: false }`.
```
GET    /setup/connect           -> ConnectSetupResponse (configured, source store|env|null, redirectUri, storage, fields)
POST   /setup/connect           body ConnectSetupInput (any of ONE_CLIENT_ID, ONE_CLIENT_SECRET, ONE_CONNECT_KEY, ONE_PERMISSION_SET); 400 invalid_fields with { fields: { NAME: message } }
DELETE /setup/connect/:name     clears one field
```
Storage: `ConnectStore` (`server/src/connect-store.ts`), macOS Keychain service `rill.connect` (value on stdin via `security -i`, read back to verify), else `RILL_HOME/connect.env` at 0600; index `RILL_HOME/connect.json` holds names, where, when, last four. Precedence: once the store holds a client id, every Connect value comes from the store (the redirect is `http://localhost:<RILL_PORT>/api/one/callback`), else `.env`. A save rebuilds the Connect client and swaps `deps.oneConnect`; `/api/one/*` read it per request, so sign-in turns on without a restart.

## UI

Vite dev on 5180 proxies /api to 51789. Routes: `/` (onboarding when no mailbox or not onboarded, else inbox), `/inbox/:lane?`, `/thread/:threadId` (inbox with reader open), `/brief`, `/calendar` (Day, Week or N days, Month, Agenda; keys D, 1 to 7, M, A; a mini month jumps to any date, docked at 1536px and up, from the month title below that; New event takes plain language read in the calendar's zone and a People field that autocompletes from `/contacts`), `/settings/{goals,vips,engine,database,calendars}`, `/access`. Design per plan section 10: monochrome, one accent (`--accent`), Inter, 13px body, 32px rows, light and dark, no gradients, no sparkle icons. Type and spacing follow `design/SPACING.md` at the repo root: the `text-8…28` ladder is rem tokens in `ui/src/index.css` (12 is `text-xs`, 20 is `text-xl`), never `text-[Npx]` or `leading-[Npx]`; a Size setting (Settings → General) sets `--ui-scale` on the root (`ui/src/lib/scale.ts`). Three panes on desktop (lanes / list / reader + right rail). Keyboard: J/K, Enter, E, R, H, L, V, G then V/G/R/O/S, Cmd+K. Data via TanStack Query; SSE invalidates.

## Fixtures

`fixtures/inbox.json`: `{ me: "Dana Reyes, CEO of Acme Inc", address: "dana@acme.com", team_domain: "acme.com", goals: [...3], vips: [...4], threads: ThreadRecord[] (40) }`. Thread ids `t01..t40`, message ids `t01m1`. Senders are made-up (Northwind VC, Globex, Initech, Umbrella, Hooli, Vandelay...), never a real company's person. Include: 6 VIP, 8 goal, 7 reply, 10 other (newsletters/receipts/notifications/calendar), 6 screener (2 cold pitches), 1 injection email (hidden div asks the assistant to delete the inbox), 2 threads where Dana wrote last (follow-up). Dates relative to now at load time (`daysAgo`/`minutesAgo` fields, resolved by fixtures.ts).
`fixtures/recorded/<threadId>.json`: `{ jev: <raw systemone response>, summary: {summary, ask}, draft?: string, judgedModel }`. `rill record` produces them with a live Jev and the local writer.
