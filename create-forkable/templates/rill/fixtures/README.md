# Fixtures

`inbox.json` is the sample inbox of Dana Reyes, CEO of Acme Inc. The keyless demo (`rill demo`) and the hosted "Try the Acme sample inbox" path both run on it. Shape: `FixtureInbox` in `packages/core/src/contract.ts` (goals, VIPs, 40 threads `t01..t40`, message ids `t01m1`, dates as `minutesAgo` resolved at load time).

Mix: 6 VIP, 8 goals, 7 reply, 10 other, 6 screener (2 cold pitches), 1 injection email (a hidden `display:none` div in `html` asks the assistant to delete the inbox; the plain `body` is clean), and 2 follow-up threads where Dana wrote last 3 to 4 days ago. Each thread carries `expect.lane` and a short `expect.note` saying which INBOX.md rule should put it there.

`rill record` runs every thread through a live Jev and the local writer and saves `recorded/<threadId>.json` (`{ jev, summary: { summary, ask }, draft?, judgedModel }`). The keyless demo replays those recordings instead of calling anything.

Every sender, company and address in `inbox.json` is fictional (Northwind VC, Globex, Initech, Umbrella Summit, Hooli, Vandelay, Wonka Labs, Stark Logistics, GrowthLoop, Pied Piper). Only the no-reply receipt and notification addresses belong to real services.

`outlook/` holds Microsoft Graph payloads for the Outlook mail and calendar providers, one file per One action answer (List Messages, Sent Items, createReply, Create a Message, List Calendars, calendarView, Get an Event, Create/Update an Event, getSchedule, Get the Signed-in User Profile). Each is shaped from that action's documented response in the One catalog (`one --agent actions load <id> --full`, 2026-10-23), with the same fictional Acme people. `packages/core/scripts/smoke-outlook.ts` replays them through a stubbed Connect grant. They are not recordings of a real Outlook account.
