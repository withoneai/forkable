# The Acme Inc sample world

Hand-written fixtures for Search's keyless sample (SPEC 11). Every JSON file is
shaped from the documented response of the action it answers (the Response
Fields sections loaded with the One CLI on 2026-10-29), not recorded from a
real account. Each file says where its shape came from in `$shapedFrom`.
Everything here is fixture-verified, nothing is real-grant-verified.

Regenerate with `python3 fixtures/sample/tools/generate.py` (edit the
generator, not the JSON). The generator reads the Zendesk docs and the public
connector list from `/tmp/srchpk/`; when those caches are gone it keeps the
committed copies.

## Cast

| Who | Where | Addresses | Shows up in |
|---|---|---|---|
| Dana Oyelaran, Head of Sales (the user) | Acme Inc | dana@acme.com (Google), dana@acme.eu (Acme Europe, Microsoft 365), Slack U01DANA | every source |
| Mia Park, Engineering lead | Acme | mia@acme.com, Slack U02MIA, Teams guest | Linear, Slack, Teams, Gmail, Google Calendar, Notion |
| Theo Lund, Product manager | Acme | theo@acme.com, Slack U03THEO | Linear, Notion, Slack, Gmail, Google Calendar, Granola |
| Sam Okafor, Sales ops | Acme | sam@acme.com, Slack U04SAM | HubSpot owner, Slack, Gmail, Google Calendar, Granola |
| Lena Vogt, EU account manager | Acme Europe | lena@acme.eu, Slack U06LENA | Teams, Outlook Mail, Outlook Calendar, Slack |
| Priya Shah, VP Partnerships | Globex | priya@globex.com, Slack U05PRIYA (Slack Connect) | HubSpot, Attio, Gmail, Google Calendar, Slack, Outlook Mail (cc), Notion, Linear, Granola (as "Priya S.") |
| Marco Bellini, Legal counsel | Globex | marco@globex.com | Outlook Mail, Outlook Calendar, HubSpot, Attio, Gmail |
| Ravi Menon, CTO | Initech | ravi@initech.io | Attio, HubSpot, Gmail, Google Calendar, Granola, Linear (customer) |
| Anika Rao, Head of Data | Initech | anika@initech.io | Attio, Gmail, Google Calendar, Granola |
| Hannah Cole, Procurement lead | Umbrella | hannah.cole@umbrella.co | HubSpot, Outlook Mail, Outlook Calendar, Granola, Teams (mentioned) |
| Felix Wagner, CFO | Umbrella | felix.wagner@umbrella.co | HubSpot, Outlook Mail, Outlook Calendar |
| Owen Price, Partner | Northwind Ventures | owen@northwind.vc | Gmail, Google Calendar, HubSpot, Attio, Notion |
| Jules Martin, Founder | Hooli | jules@hooli.dev | Gmail (cold pitch), Attio, HubSpot, Google Calendar (cancelled) |
| Tom Reyes, CTO | Hooli | tom@hooli.dev | Attio |
| Grace Liu, Head of Operations | Initrode | grace.liu@initrode.com | HubSpot, Gmail |
| Newsletters, receipts, notices | `.example` domains, it@acme.com, people@acme.eu | | Gmail, Outlook Mail (low lane) |

Companies: Acme (self), Globex, Initech, Umbrella, Northwind Ventures, Hooli,
Initrode.

Look-alikes for the entity match check (`matches.json`):

| Pair | Jev `same` | Outcome |
|---|---|---|
| Priya Shah (priya@globex.com) and "Priya S." (priya.shah@gmail.com, Granola attendee) | 0.93 | merged |
| Ravi Menon (ravi@initech.io) and "Ravi M." (ravi.menon@protonmail.com, Granola, Initech security review) | 0.72 | pending, the one possible match the UI shows |
| Mia Park (mia@acme.com) and Mia Park (mia.park@hooli.dev, cc on the Hooli cold pitch) | 0.08 | rejected |

## Storylines

| Storyline | Items |
|---|---|
| Globex renewal, 84,000 a year, contract sent | HubSpot contact Priya, company Globex, deal "Globex renewal 2027", notes 501 and 504; Attio person Priya and deal "Globex renewal 2027"; Gmail "Globex renewal terms" (5 messages, last one 6h ago from Priya), "Globex security questionnaire", "Intro: Marco from Globex legal"; Outlook "Globex legal redline, final" (Marco to dana@acme.eu, cc Priya) and the DPA thread; Google Calendar "Globex x Acme contract review" (2 days ago) and "Globex renewal signature call"; Granola note of the review (Priya asks for a multi-year discount); Slack #deals "Globex is basically closed, waiting on signature" with a thread, #acme-globex shared channel; Linear ACME-311 "SSO for Globex rollout" (asked by Priya, customer Globex); Notion "Globex account plan" (Champion = priya@globex.com). |
| Initech pilot | Attio deal "Initech pilot" (Discovery); Gmail "Pilot data import" (Ravi asks for a fix date), kickoff agenda, CSV sample from Anika; Google Calendar kickoff and the weekly check-in Dana has not answered; Granola kickoff note; Linear ACME-298 "CSV import fails over 50 MB" (In Review) and ACME-315; Slack #eng thread with 3 replies; Notion "Initech account plan" and "Pilot playbook"; Linear doc "Initech pilot import runbook". |
| Umbrella EU expansion | HubSpot company Umbrella and deal "Umbrella EU expansion" (EUR 120,000); Outlook "Procurement questionnaire" (Hannah wants it by Friday) and "Umbrella EU expansion pricing"; Outlook Calendar "Umbrella procurement call"; Teams chat "Umbrella pricing" (Lena needs Dana's OK on a 12% ask); Granola note of the call; Notion brief; Linear LED-161 tax IDs. |
| Northwind investor update | Gmail "Q3 update and board date" with Owen; Notion "Q3 investor update"; Google Calendar "Northwind board prep"; Slack DM Dana and Theo; Gmail "Board deck draft" from Theo. |
| Ledger 2.0 launch (internal) | Linear project "Ledger 2.0", LED-142, LED-158, LED-160, LED-161; Linear doc "Ledger 2.0 PRD"; Notion "Ledger 2.0 launch plan"; Teams chat "Eng sync"; Outlook Calendar "Ledger 2.0 go/no-go". |
| Noise | Gmail newsletters (3), receipts (2), IT notice, Hooli cold pitch; Outlook all-hands notice and a renewal receipt; Slack HubSpot bot posts (2). |

## Sizes (SPEC 11.3)

| Source | Fixture | Indexed after the sample runs |
|---|---|---|
| HubSpot | 8 contacts (2 pages), 6 companies, 4 deals, 5 notes | 23 |
| Attio | 8 people (Owen Price twice, the two records share owen@northwind.vc and fold into one person), 5 companies, 3 deals, 3 notes | 19 |
| Gmail | 24 threads (2 pages of 12) on dana@acme.com; a second account, dana@acme.dev (`gmail-personal/`, connection `sample:gmail:personal`): 3 personal threads (Lisbon trip, book club, climbing gym) | 24 + 3 |
| Outlook Mail | 14 messages in 8 conversations (2 pages) | 14 |
| Google Calendar | 2 calendars, 16 events, one cancelled; second run is a sync token with no changes. A second account, dana@acme.dev (`google-calendar-personal/`, connection `sample:google-calendar:personal`): 4 events, one an instance of an endless series 900 days out that is not indexed | 15 + 3 |
| Outlook Calendar | 1 calendar, 6 events (2 pages); the second delta removes "EU pipeline sync" | 5 |
| Notion | 8 pages (2 pages of results), markdown for each | 8 |
| Linear | 14 issues (2 pages), 2 projects, 3 documents, 6 comments (comments off by default) | 19 |
| Slack | 6 users, 4 conversations (#deals 18 messages, #eng 14, #acme-globex 10, DM with Theo 6), 2 threads with replies | 48 |
| Teams | 2 chats, 18 messages (10 + 8, each in 2 pages); 1 team, 1 channel, 3 channel messages (off by default) | 18 |
| Granola | 6 notes (2 pages), details for each | 6 |
| Zendesk (New profile only) | 10 catalog actions (5 read, 5 write), 5 knowledge docs, 12 tickets | 12 after saving the proposal |

The second Gmail account shows the multi-account path: its pages carry
`match.connection`, so only that connection reads them, and its `account.json`
names the connection, platform and label that the sample grant adds.

Per-platform expectations for `test:profiles` are in `<platform>/expect.json`;
the demo's numbers are in `expect-demo.json`.

## Lanes (SPEC 9.1)

VIPs in the sample are Priya Shah and Owen Price. `judgments.json` gives every
judged item its Jev answers and the expected `lane`. The six items in
`lane:needs-you`, all in different groups:

1. Gmail "Need sales input on SSO priority" (Mia)
2. Gmail "Pilot data import" (Ravi wants a fix date)
3. Outlook "RE: Procurement questionnaire" (Hannah, by Friday)
4. Gmail "Board deck draft" (Theo, edits by Wednesday night)
5. Teams "Umbrella pricing" (Lena needs an OK on 12%)
6. Google Calendar "Initech pilot weekly check-in" (invite not answered)

Items older than 90 days have no judgment (rules). Slack judgments are written
with relative ts keys that core now resolves, so Slack items are judged too.

## New profile sample (Zendesk)

`catalog/platforms.json` is a bare array of real rows from the public
`GET /v1/available-connectors`. `catalog/actions/zendesk.json` lists ten
`sample::zendesk::*` actions; each names the real catalog id it mirrors.
`catalog/knowledge/` holds the real Markdown docs of the five read actions
with a fixture `ioSchema`. Dry runs answer from `zendesk/*.pages.json`.
`proposals/zendesk.tickets.json` is the `ProposalOutput`: `zendesk.tickets`
recommended (cursor export, `after_cursor` / `end_of_stream`, watermark on
`updated_at`, link `https://acme.zendesk.com/agent/tickets/{{ item.id }}`),
`zendesk.users` offered but not recommended. Both use `sample::` ids with
`sampleOnly: true`. The sample grant needs a `sample:zendesk` connection.

## Fixture conventions

Exactly the formats in CONTRACT 5 and `packages/core/src/sample/world.ts`:

- Dates are relative markers: `{ "$rel": "-2d 14:00" }` (ISO), `$relMs`,
  `$relMsString` (Gmail `internalDate`), `$relUnix`, `$relSlackTs`, `$relDate`
  (all-day and due dates), `$relLocal` with `"$tz": "UTC"` (Graph `dateTime`,
  Attio `createdAt`, which carry no zone). Specs are `-2d 14:00` (Los Angeles
  wall time), `-6h`, `-90m`, `+7d`.
- Pages match on `cursor` (the value the engine sent: the next token, the
  full `@odata.nextLink` for `nextUrl`), `partition` (nested Teams channels are
  `<teamId>/<channelId>`), `delta` (the token a delta run's first page sent;
  `null` on bootstrap pages) and `request` (Slack replies match on
  `query.channel` and `query.ts`).
- Details (`notion/pages.details.json`, `granola/notes.details.json`) are
  keyed by the hydrate request's path id.
- `account.json` is `{ "actionId", "response" }` per platform.
- Item ids are stable strings (Gmail hex ids, HubSpot 201..505, uuid5 for
  Attio, Notion and Linear, `not_` ids for Granola, 13-digit Teams ids), so
  `judgments.json`, `rerank.json` and `chat.json` can key by
  `<platform>:<externalId>`. Slack ids are message timestamps and move with
  the clock.

## Account actions found for D40

| Platform | Action | Id | Vars |
|---|---|---|---|
| HubSpot | Get HubSpot Account Details, GET `/account-info/v3/details` | `conn_mod_def::GJ3jRLECRkM::lBDjqllWStu_7SjZb1LvSg` (V) | `portalId`, `uiDomain` |
| Slack | Test Authentication (auth.test), POST `/auth.test` | `conn_mod_def::GJ7H8UJsJpw::WIAkGZl2QGG-xp0x9a-c9w` (V) | `url` (ends in `/`), `user_id`, `team`, `team_id` |
| Gmail | Get a User's Gmail Profile | `conn_mod_def::GJ3oa8bJZNA::ZS9kXmE_Rzi4utfESor_ng` (now V) | `emailAddress` |
| Outlook Mail | Get the Signed-in User Profile | `conn_mod_def::GMIYxNZ51eU::xY4rcCXiTTyrarjC9ac97w` (now V) | `mail`, `userPrincipalName` |

The first two are not in `connect.manifest.json` yet (a root file this pack
work does not own).

## Pack needs

Status 2026-10-29 (core Phase 1): 1 to 10, 14 and 15 are done in core and the packs use them
(SPEC section 21). 11 can be expressed with `each` and `el` but the Slack pack does not use it yet;
12 and 13 are open.

Things the profile format or engine cannot express yet. Each pack works
without them; the note says what is lost.

1. **RFC 2822 date marker.** Gmail `messages[].time` is the Date header
   (`Mon, 8 Jan 2025 10:30:00 -0800`). There is no `$relRfc2822`, so the
   fixture writes ISO there. Add the marker and switch `rel_rfc` in the
   generator.
2. **Relative values in map keys.** Slack message ids are `ts`, which move with
   the clock, so `judgments.json` keys them as `slack:$relSlackTs(-3h)`. Core
   does not resolve markers inside keys, so Slack items get rules lanes and
   cannot be cited in `rerank.json` or `chat.json`. Resolve `$rel...(spec)`
   tokens in keys (and in string values), or key fixtures by another field.
3. **Path filters over object values.** `item.properties[type=email].email`
   (Notion) filters arrays only. Notion properties are an object keyed by
   column name, so the Champion and People columns never link (Priya loses her
   Notion source, 8 of 9) and `status` from a status column is empty. Let `[]`
   and `[k=v]` iterate an object's values.
4. **Zipped ref arrays.** A ref with `email`, `name` and `response` as
   `pick: "all"` paths is zipped by index, and `resolvePath` drops missing
   values, so one attendee without a `displayName` shifts every later name.
   Affects Google and Outlook attendees, Outlook recipients, Granola
   attendees, Teams members, Linear customers. Add `each: <path>` on a ref
   with paths relative to each element.
5. **`hydrate.when` (or children without a hydrate request).** Slack hydrates
   every message with `conversations.replies`; at Slack's limited tier (one
   call a minute) that spends the whole budget on messages with no thread.
   Today the pack relies on the fixture answering an empty thread. Needed:
   `when: "item.reply_count > 0"`.
6. **Zone-less datetimes.** Graph `start.dateTime` (asked for in UTC with
   `Prefer: outlook.timezone="UTC"`) and Attio `createdAt` have no offset;
   `new Date()` reads them as the server's local time. The `datetime` decoder
   should treat a zone-less ISO string as UTC.
7. **Look-ahead windows.** `run.until` is now, so the Outlook Calendar delta
   window (`startDateTime`..`endDateTime`) never includes future events. Needs
   `run.until = now + lookahead` (a profile setting) or date arithmetic in
   templates.
8. **Status on fixture pages.** The transport answers every page with 200;
   the Google Calendar `410` page (`delta: "gcal-expired-sync"`) carries a
   `status` the transport ignores, so the delta reset is not testable from
   fixtures.
9. **First line / truncate filter.** HubSpot notes have no title; the pack
   uses the whole decoded note as the title.
10. **Self `ext` values.** `account.self` with `kind: "ext"` stores the raw
    `U01DANA`, but entity keys are `ext:slack:u01dana`. Prefix with the
    platform and lowercase so Dana's Slack person is marked self.
11. **Templates over arrays.** No way to turn each mention id into
    `slack:<id>`, so Slack mentions and reply authors are not linked; Priya's
    Slack link comes from her own messages in #acme-globex.
12. **HubSpot deal associations.** Deals link to no company or contact; that
    needs a second call (`associations=` on the list action) or a per-deal
    hydrate.
13. **Ref type by value.** Attio notes can belong to a person or a company;
    the ref is typed `person` with `externalId attio:{{ parent_object }}:...`,
    which resolves only when that key exists already.
14. **Number coercion.** HubSpot `amount` and `numberofemployees` are strings;
    `DealFacets.amount` is a number. A `number` decoder would fix it.
15. **Self across tenants.** In an engine run where Outlook Calendar indexes
    before Outlook Mail's account call, `dana@acme.eu` becomes a person that is
    not marked self. Re-mark entities when `self_addresses` grows.
