# Calendar reference research for an AI email client (Mobbin)

Source: Mobbin MCP only, web platform. Every link below was returned by the tools; none were made up. Searched 2026-10-22.

## Mobbin MCP tools: what's there and how they work

| Tool | What it does | Notes |
|---|---|---|
| `search_screens` | Natural-language search for single UI screens (iOS or web) | `mode: deep` (default) has an AI judge each candidate; `standard` is faster. Up to 30 results. Returns inline previews plus `mobbin_url` / `image_url` |
| `search_flows` | Search multi-step journeys (onboarding, "creating an event") | Up to 10 per page, 3 preview screens each, paginated. Each flow lists every screen ID |
| `search_sections` | Marketing-website sections (hero, pricing, footer) | Not useful here |
| `list_collections` | The user's saved Mobbin collections, with counts | Not used: the brief was public references |
| `get_collection_contents` | Reads one saved collection, or `all-saved` | Not used |

Every search takes `task_intent` / `output_destination` hints that steer ranking. One query should describe one screen or one journey. Name an app in the query to filter to it.

**Coverage caveat:** Mobbin web has a lot of **Superhuman Mail, Amie, Rise, Clockwise, Motion, Skiff, SavvyCal, Calendly, ClickUp, Notion**. Searches for Vimcal and Notion Calendar (the standalone app) found nothing for Vimcal and only the Notion-workspace calendar/meetings surfaces for Notion. Fantastical, Cron, Morgen, Akiflow and Google Calendar web never appeared in any result. **Rise** is a Cron/Vimcal-style, keyboard-first, dark calendar, so it's the closest stand-in for Notion Calendar (ex-Cron) and Vimcal.

---

## 1. Week view

| App | Screen | Link | Pattern worth stealing |
|---|---|---|---|
| Rise (dark) | Week view | [screen](https://mobbin.com/screens/19ebd6b1-e3fc-4c61-b57b-677aca7ea63f) | Dense dark grid with ISO week numbers in the mini-cal, `Find calendar or room… C` search with a shortcut hint, and hatched travel/buffer strips beside events. The bar to beat for a keyboard-first dark mode |
| Amie | Week view + todo list | [screen](https://mobbin.com/screens/6f1e228f-3a2e-416e-8205-5e1b300610cf) | Breadcrumb header `Calendar › Apr 2025 › W16`, a stacked calendar-color dot cluster `10 calendars` as a single toggle, `Meet`/`Share` as top-level actions |
| Clockwise | Week view, AI rail | [screen](https://mobbin.com/screens/8a83a86d-a0de-41fe-9fae-7bf776671fa6) | Left rail starts with a human status line ("No upcoming meetings today — Your time is all yours") and a docked NL input "Schedule or reschedule…". Proposed holds are drawn ghosted/dashed so they read differently from real events |
| Front | Calendar inside a shared-inbox app | [screen](https://mobbin.com/screens/a1949523-861d-4384-ae89-bb62d192eddd) | Closest analogue to "calendar inside an email product": mini-cal, Find people, calendar checkboxes including a visible `[DISCONNECTED]` calendar state |
| Proton | Week view with TZ switcher | [screen](https://mobbin.com/screens/7b744a4c-91d4-478a-a8e2-52da99ea0562) | Time zone selector lives in the toolbar (`GMT-4 • America/New_York`) beside a Day/Week/Month dropdown, so the display TZ is never hidden |
| ClickUp | Week with per-day counts | [screen](https://mobbin.com/screens/b26915c0-01e1-444d-a4fd-9ba7a4bb523a) | All-day row shows a `3 events` count per day: cheap density signal before you scroll |

## 2. Day view + agenda / list

| App | Screen | Link | Pattern worth stealing |
|---|---|---|---|
| Superhuman Mail | Inbox + docked day column | [screen](https://mobbin.com/screens/1acb59d1-7aa9-4d49-bba5-b7068db977e6) | The day view *is* the right rail of the inbox: one narrow column with a now-line, no chrome. The `Calendar` split tab filters invite emails |
| Motion | Day grid + right-hand agenda | [screen](https://mobbin.com/screens/59d06cc1-1a15-4c3c-8834-99b5962067eb) | Day grid on the left, scrolling agenda on the right grouped by date headers (`30 Sep MON`). Gives "what's next" and "where's my gap" at once |
| Calendly | Meetings agenda list + side panel | [screen](https://mobbin.com/screens/48599d7e-cae2-443e-a3a3-c011e535f1d3) | `Up next` label and `Today` chip on the current item, inline `Join meeting` button on the row, right panel with Reschedule/Cancel and private notes |
| Rox | Agenda rows with RSVP tallies | [screen](https://mobbin.com/screens/b02e5687-c919-45e4-a3b3-cbb5f37f873f) | Each meeting row carries ✓1 ✗0 ?0 RSVP counts and an agent action, a good fit for an AI-email list view |
| Clockwise | Day view with pinned teammate | [screen](https://mobbin.com/screens/eb1f6f40-bd78-4605-9e0b-aac96b483533) | Pinned person shows "Outside working hours · 2:11am PDT": the other person's local time is visible without a TZ column |
| ClickUp | Day view + floating command bar | [screen](https://mobbin.com/screens/98725157-dec0-46de-a5d8-3e929a80e05e) | Bottom-center "Search events, teammates, commands…" bar always present over the grid |

## 3. Month view

| App | Screen | Link | Pattern worth stealing |
|---|---|---|---|
| Amie | Dense month | [screen](https://mobbin.com/screens/0f996ad5-82d7-4393-8542-71bed35b234f) | Each event is one line: color bar, title, right-aligned time. Strikethrough for declined/past, `3 more` overflow, AI ask bar docked at the bottom |
| Todoist (dark) | Upcoming month | [screen](https://mobbin.com/screens/8595d229-ec79-4112-a5dd-f61689e8d066) | Dark month that mixes tasks (circle glyph) and events (bar glyph) at the same row height, with times right-aligned. Very legible in dark mode |
| Skiff | Sparse month | [screen](https://mobbin.com/screens/940774ea-77a5-4594-a075-d600b53d2b63) | Minimal dot + time + title, dimmed out-of-month days. Good light-mode baseline |
| Notion | Database calendar (month) | [flow](https://mobbin.com/flows/4c9b91d1-4168-489d-916a-b495e3bd0c21) | Weekends tinted grey, `Manage in Calendar` hand-off button, hover `+` on a day cell to create |

## 4. Event detail popover / side panel

| App | Screen | Link | Pattern worth stealing |
|---|---|---|---|
| Clockwise | Event popover | [screen](https://mobbin.com/screens/fffa4e21-4eae-40cd-b3c9-399b35a1a3ed) | Primary action is `Join Google Meet` at the top. Edit/delete as icons. "Show attendees' calendars", inline reschedule suggestions, `Yes / No / Maybe` RSVP footer |
| Amie | Bottom-docked editable card | [screen](https://mobbin.com/screens/0fa12ee1-9694-4add-94b1-2f324d5bfe97) | Detail and edit are the same surface. "1 going, 1 awaiting" summary, `⋯` menu with shortcuts shown (Duplicate ⌘D, Copy ⌘C, Delete ⌫), Busy/Going chips in the footer |
| ClickUp | Event card with send | [screen](https://mobbin.com/screens/c410b28a-f27d-497b-8c03-1cd4418a567c) | "Google Meet will be added" confirmation bar, `1 Pending` attendee status, `Send Invite ⌘↵` primary with its shortcut |
| Confluence | Compact popover | [screen](https://mobbin.com/screens/92347c49-6a9b-4d47-8e8e-8b47372c4a14) | Human-readable recurrence ("Repeats every other Wednesday"), icon rows for location/people/notes. Tight and scannable |
| Sweatpals (dark) | Dark event popover | [screen](https://mobbin.com/screens/a662efdb-abf6-4253-abf3-4021eff722e0) | Dark-mode popover with an RSVP facepile ("5 / 10 RSVPs") and three chunky actions. Good dark elevation reference |
| Evernote | Event → note actions | [screen](https://mobbin.com/screens/4980ad2d-e776-4a4a-ab13-8efd2e1049dc) | Popover's main CTA is `Create a note`, plus "Link a note… / Find related notes". In our case this becomes "Related emails / Draft follow-up" |

## 5. Quick event create (natural language, drag-to-create)

| App | Screen / Flow | Link | Pattern worth stealing |
|---|---|---|---|
| Superhuman Mail | Creating an event (flow) | [flow](https://mobbin.com/flows/b4ca3bce-acb9-4c1e-b65d-4c0f5a365ce2) | Create from the inbox without leaving it: the right rail becomes a form (title → people → time) and a live preview block appears in the docked day column while you type |
| Rise (dark) | Keyboard-driven proposal | [screen](https://mobbin.com/screens/d1ae391e-2dc8-41b9-8a77-2dc0fe08e1dc) | Single input "Add teammates or rooms…" with chip params `30 min ⇧Ctrl1`, `Within 7 days ⇧Ctrl2`, then `Show proposal`. Each parameter has a hotkey |
| ClickUp | Tokenized title input | [screen](https://mobbin.com/screens/b26915c0-01e1-444d-a4fd-9ba7a4bb523a) | Placeholder teaches the grammar: "Add title, @ for people, @@ for tasks". Tabs `Event / Task / Focus time / OOO` share one composer |
| Fibery | Drag-to-create on week grid (flow) | [flow](https://mobbin.com/flows/0e14a1e2-233f-4045-9c7e-4863b30ab622) | Drag a box, type the title straight into it, done. No modal |
| Skiff | Create with live grid preview (flow) | [flow](https://mobbin.com/flows/278b5778-83b4-4ad3-a5ea-296d26fa2abb) | Left panel form; changing times resizes the block on the grid in real time |
| ClickUp | Create in calendar view (flow) | [flow](https://mobbin.com/flows/3c84a536-305f-4119-95b9-a365df9bec15) | Inline card prefilled "Tomorrow, 9:00" at the clicked slot. Success toast with numbered actions `Open (1) · Tray (2) · Copy URL (3)` |
| Tana | "Ask or Capture" | [screen](https://mobbin.com/screens/8d7cd121-a672-42b1-ab6b-71415a3c2602) | One input above today's agenda with `Meet / Create / Search` intent chips: NL-first, agenda below |

## 6. Scheduling / share availability / booking links

| App | Screen | Link | Pattern worth stealing |
|---|---|---|---|
| Superhuman Mail | Insert times into email | [screen](https://mobbin.com/screens/37f12aa8-f8f3-45e5-bf60-034c9c289e59) | Full-screen week grid opened from the composer; a floating pill says "Select times to insert in your email" with title / 30 mins / location / `INSERT`. The canonical email-native pattern |
| Rise (dark) | Share availability panel | [screen](https://mobbin.com/screens/f0c48053-efdc-41bb-b2c7-d1c26e8a7c59) | Click slots, which become purple `Option` blocks on the grid. Right panel shows duration, TZ, a single-use-link toggle and a live text preview. `Copy availability Ctrl C`, `Close Esc`, toast "Times copied to clipboard!" |
| Motion | Generate message | [screen](https://mobbin.com/screens/59b4daf7-3f20-4b62-a394-8352480f6544) | "Add teammate (also check for conflicts)", date range, display TZ, editable generated message, "Clickable time slots" toggle, `Copy message ⌘C` |
| Front | Offering times inside a reply (flow) | [flow](https://mobbin.com/flows/47986f66-08e2-4e57-a1ac-a2b9dc9e3095) | Final email body contains linked slots ("Tuesday, April 16 • 10:00–10:30 AM GMT+8"), which shows what the recipient sees |
| SavvyCal | Link editor + live preview | [screen](https://mobbin.com/screens/15a0988c-1eda-446d-b1d3-929d8d180ccf) | Settings list on the left, a real week grid preview on the right with an `Overlay my calendar` toggle and a "Times shown in" TZ footer |
| Clockwise | Scheduling link options | [screen](https://mobbin.com/screens/2ba4074b-c4c5-4da9-804c-b723d34cda84) | "Highlight your best times" with a `BEST` badge on slots; event-title template preview ("Scheduler Name and Alex Smith") |

## 7. Meeting invite inside email (RSVP card)

Mobbin has no Gmail/Superhuman-style RSVP card inside a received email, so these come from nearby patterns.

| App | Screen / Flow | Link | Pattern worth stealing |
|---|---|---|---|
| Amie | Updating RSVP status (flow) | [flow](https://mobbin.com/flows/d262cdf4-2053-4624-b40b-dc7b51096bf8) | `Going?` chip opens Going **Y** / Not going **N** / Maybe **M**, each with a single-key shortcut. Toast "Updated — Guests will be notified · Undo ⌘Z". Copy this as-is |
| Workable | Inbox row with inline RSVP | [screen](https://mobbin.com/screens/add47441-f675-466f-b418-dbc5ec07af14) | Invite is a row in an inbox with ✓ / ? / ✗ icon buttons right on the row. Expanding shows attendees with per-person status badges and a `DECLINED` pill |
| Workable | Declining an event (flow) | [flow](https://mobbin.com/flows/1773c47f-bc4d-4df8-92d4-63a138611778) | Full decline sequence from the inbox row: no navigation away |
| Homerun | Invitation card | [screen](https://mobbin.com/screens/832a95e5-a119-46dd-8a00-e780fe724d3c) | Clean invite card: date tile (`OCT 17`), time + IANA TZ, video link, attendees, one big Accept button. Use the layout, not the single CTA |
| Clockwise | RSVP in popover | [screen](https://mobbin.com/screens/fffa4e21-4eae-40cd-b3c9-399b35a1a3ed) | `Yes / No / Maybe` segmented footer next to "Reschedule Suggestions": answer and counter-propose from the same place |
| Calendly | Meeting poll with "your schedule" | [screen](https://mobbin.com/screens/0c03afc3-7a10-4e39-bec5-3c817944e440) | Next to the time choices: "Your schedule from …@gmail.com — Looks like you're free this date!" Put the conflict check next to the RSVP |

## 8. Calendar sidebar / mini-calendar docked next to an inbox

| App | Screen | Link | Pattern worth stealing |
|---|---|---|---|
| Superhuman Mail | Inbox + day rail | [screen](https://mobbin.com/screens/23872261-bbe4-4f8d-9cd0-576c0a3524e9) | ~25% width right rail, day timeline with now-line, `‹ ›` day stepping, tiny footer icon row. Calendar is ambient, not a mode |
| Superhuman Mail | Create in the docked rail | [screen](https://mobbin.com/screens/dcad3d00-b5f3-4633-a86f-23c7bfc3ee95) | Same rail turns into a create form, and the new block previews in the timeline below it |
| Proton | Mail + calendar drawer | [screen](https://mobbin.com/screens/4bdf3650-29fe-43ce-9c74-2a97516fa290) | Right-edge app strip opens a calendar drawer with a week strip header over the inbox |
| HubSpot | Side-panel calendar | [screen](https://mobbin.com/screens/0820b4f1-621f-4e35-b51d-b76ee994d3fb) | Mini-month with dots under days that have events, selected-day list below, `View full calendar ↗` |
| Notion | Upcoming events in sidebar (flow) | [flow](https://mobbin.com/flows/601c6b07-ab5a-4a8b-8dfa-7f2d39b090b3) | Sidebar list "Upcoming events" with relative times ("In 2 min"), inline `Join` / `Transcribe` on the next meeting, `⋯` → Join Meet / Call ID / Participants / Open in calendar |

## 9. Find-a-time / multiple attendees / time zones

| App | Screen | Link | Pattern worth stealing |
|---|---|---|---|
| Clockwise | Event panel with Find time tab | [screen](https://mobbin.com/screens/ba80871d-4316-4430-b428-289ce8222ed7) | Tabs `Event / Find time / History`, attendee list with `Hide calendars`, amber **Conflicts · 1 attendee** box ("Outside of working hours") and a separate **Inconveniences** tier, AI "Refine proposal" input |
| Rise (dark) | Find-a-time proposal | [screen](https://mobbin.com/screens/d1ae391e-2dc8-41b9-8a77-2dc0fe08e1dc) | "Finds the best time… Handles timezone differences… Works with all your teammates" in one keystroke-driven bar |
| Pin | Dual time-zone gutter | [screen](https://mobbin.com/screens/356110e6-4f01-4df3-9501-4e3cccb500c7) | Two stacked hour columns (`WIB` / `EST`) on the left of a week grid in a schedule-meeting modal. "Select a time on the calendar to schedule a meeting" |
| SavvyCal | Preview as attendee + overrides | [screen](https://mobbin.com/screens/c92ef048-509d-40be-bb24-26e41935a6da) | `Preview as [Sam Lee]` dropdown, overlay toggle, click-a-slot `Override availability: Allow / Block` |
| Superhuman Mail | Secondary time zone setting | [screen](https://mobbin.com/screens/a192f110-43a0-4a16-a96d-6e0cb1553a95) | Typeahead for secondary TZ showing GMT offset + city + abbreviation (EDT/ADT/NDT) |
| Clockwise | Pinned person's local time | [screen](https://mobbin.com/screens/eb1f6f40-bd78-4605-9e0b-aac96b483533) | "Outside working hours · 2:11am PDT" on a pinned teammate, a lighter-weight alternative to a TZ column |

## 10. Daily brief / today's schedule summary

| App | Screen | Link | Pattern worth stealing |
|---|---|---|---|
| Tana | Pre-meeting "Get Ready" | [screen](https://mobbin.com/screens/26f8aad9-9550-48d9-ac73-861a7795579f) | Card "ASMobbin Stand Up — Tomorrow 9:00" with a `Get Ready` button opens AI talking points (yesterday / today / blockers) plus a private agent with chips "Find relevant documents", "List open action items from previous meetings" |
| Fireflies | Good Morning home | [screen](https://mobbin.com/screens/276f8391-0174-4501-9c3c-37ad3688710e) | "Personal Assistant" row of three cards: `Daily Digest` (2 meetings, 1 hour ago), `Meeting Prep`, `Popular Topics`, plus a `1 Upcoming` pill and an ask bar |
| Rox | "Here's your focus for today" | [screen](https://mobbin.com/screens/3f12d306-f98d-463d-a164-c75ffcf7506f) | Greeting, recommended actions, and a Today calendar widget whose empty state is the connect CTA (Google / Outlook buttons) |
| Notion | Home "Upcoming events" (flow) | [flow](https://mobbin.com/flows/0b3641f6-ca3a-4a04-999f-39814245cfe3) | Home module: Today/date column + timeline with `Join and take notes` on the next event, and a "Connect Notion Calendar" upsell |
| Charma | Today's Schedule column | [screen](https://mobbin.com/screens/3934bc00-0907-44de-a3d6-fe2e0a8c8d80) | Right column "Today's Schedule" with per-meeting `Add Agenda` dropdown (create / link existing) |

## 11. Command palette for calendar

| App | Screen | Link | Pattern worth stealing |
|---|---|---|---|
| Rise (dark) | "Search or type command" | [screen](https://mobbin.com/screens/1e6d5982-0315-4629-9110-8bd4d3a15a44) | Calendar-scoped commands, each with a single-key hint: Find a time to meet **F**, Share availability **S**, Show teammate calendar **C**, Search events **/**, Show secondary timezone **A**, Display day view **D**, … The best reference here |
| ClickUp | Floating command bar | [screen](https://mobbin.com/screens/f75a39f4-18b8-4991-996e-2dfa83a91ef2) | Persistent bottom "Search events, teammates, commands…" with an AI sparkle. Palette and AI share one input |
| Clockwise | `#` to search events | [screen](https://mobbin.com/screens/56792445-abb3-401c-95b1-c5790382f1a3) | AI input with sigils (`Schedule @`, `Reschedule #`) and the reassurance "Nothing will change until explicitly confirmed" |
| Motion | Scoped search | [screen](https://mobbin.com/screens/7d1c7025-f72d-4a18-9ba7-7c522637ad33) | Search modal with a `Tasks | Events` scope toggle in the input |

## 12. Conflict / double-booking warnings

| App | Screen | Link | Pattern worth stealing |
|---|---|---|---|
| Clockwise | Move-event confirm | [screen](https://mobbin.com/screens/d0f17573-9dc2-41f5-9a9c-abe93e0449c2) | New time above the struck-through original (`New` / `Original` labels). Amber **Conflicts · 1 attendee** box, collapsed **Inconveniences** |
| Clockwise | AI scheduling with conflict | [screen](https://mobbin.com/screens/671e0870-f520-4d92-bc16-8ee9b332bb3b) | "I can schedule this meeting, but there is a **conflict** for Sam", split into "conflicts I can't fix" vs "inconveniences (1 hour of Focus Time lost)", then `Confirm · Share · Cancel` and 👍/👎 |
| Clockwise | Share the conflict as text | [screen](https://mobbin.com/screens/d91d7384-97bf-415d-94e3-de3c3c57d4e6) | Copies a ready-to-send message ("Are you free… There are a few issues… Busy – Conflict") straight into email. A natural fit for an email client |
| Fresha | Inline amber warning | [screen](https://mobbin.com/screens/ac5e971e-8cfb-47ca-9b36-bb6ae392b53f) | Non-blocking amber callout in the edit panel ("Alex is not working between 7:00am and 7:45am") plus hatched non-working hours on the grid |
| Deputy | Overlap summary | [screen](https://mobbin.com/screens/72220748-d97c-4e5c-8e86-9647586a0caf) | Result summary "2 shifts have overlaps with existing shifts" (expandable) and ⚠ badges on the affected blocks |

## 13. Settings for connected calendars

| App | Screen | Link | Pattern worth stealing |
|---|---|---|---|
| Rise (dark) | Calendars integration | [screen](https://mobbin.com/screens/eb281784-a66c-41c6-946d-2c3b745a259b) | Per-calendar **Influences availability** toggle and **Block on** (cross-calendar blocking). Google `Connect` / Outlook / Apple. Separate **Primary calendar** (where others' events land) vs **Active calendar** (where yours land) |
| Amie | Calendars settings with live preview | [screen](https://mobbin.com/screens/20e5d9e1-c40a-49ed-a82b-7cc78c6edc63) | Mini week preview at the top that reflects changes, default calendar, per-calendar color + Type (`Regular` / `Background`), `Esc` to close |
| Todoist | Account sync status | [screen](https://mobbin.com/screens/40e15bd1-ed2c-4933-982f-536416b225b7) | `● Live` status, `Resync` / `Disconnect`, eye toggle per calendar, a visible `[DISCONNECTED]` row, progress copy "Syncing your calendar… Almost there!" |
| Calendly | Conflicts vs write-to | [screen](https://mobbin.com/screens/3627e9c9-b42f-49f2-88c9-295fe8ab6217) | Two clearly separated concepts: "Calendars to check for conflicts" (Checking 1 calendar) and "Calendar to add events to" |
| Lightfield | Mail *and* Calendar in one account | [screen](https://mobbin.com/screens/a231cc9f-7114-41e3-97f2-2c3c5a7752c5) | One connected Google account covers mail + calendar: Connected dot, visibility, **backsync range**, do-not-track list. Matches an AI email client's data model |
| Superhuman Mail | Calendar settings modal | [screen](https://mobbin.com/screens/9393815c-208e-4d74-908f-9cb86150d196) | Short modal: secondary timezone, auto-add Zoom/Meet links (radio), add Google/Microsoft account, event notifications |

---

## Patterns that recur across the best apps

1. **The calendar is ambient, not a separate mode.** Superhuman, Proton, HubSpot and Notion dock a single-day timeline or upcoming list beside the main work surface, and create/edit happens in that rail. For an email client, the rail should be the default and the full calendar the zoom-out.
2. **Detail and edit are one surface.** Amie, ClickUp and Motion use a single popover/card that is editable in place, with footer chips (Busy, Going, visibility) instead of a separate edit form.
3. **Every action shows its key.** Rise (`F`, `S`, `C`, `/`, `A`, `D`), Amie (`Y`/`N`/`M`, ⌘D, ⌘Z), ClickUp/Motion (`⌘↵` send/create, `Esc` cancel), Rise (`Ctrl C` copy availability). Hints are printed next to the control, not hidden in a help sheet.
4. **Availability is painted on the grid, then exported as text.** Superhuman ("Select times to insert in your email"), Rise (`Option` blocks), and Motion/Calendly (editable generated message + link) all put the result in the email body. Slot links in Front show what the recipient gets.
5. **Conflicts come in two tiers, in amber, and don't block.** Clockwise separates hard **Conflicts** from soft **Inconveniences**, names the attendee and reason, and shows new vs struck-through original. Fresha/Deputy use amber inline callouts and ⚠ badges, never a modal.
6. **Undo instead of confirm.** Amie's "Guests will be notified · Undo ⌘Z" toast and ClickUp's numbered-action toast. Clockwise's "Nothing will change until explicitly confirmed" covers the AI case.
7. **Time zone is always visible.** Toolbar TZ (Proton), gutter label (Skiff `MYT`, Pin dual gutter), the other person's local time inline (Clockwise), and "Times shown in…" footers on anything shareable (SavvyCal, Calendly).
8. **Settings split "what blocks me" from "where events go".** Rise (Influences availability / Primary vs Active), Calendly (check for conflicts vs add events to), plus explicit `Live` / `[DISCONNECTED]` / Resync states (Todoist, Front, Amie).
9. **AI input sits at the bottom of the calendar.** Amie, ClickUp, Clockwise and Fireflies all keep a persistent ask/command bar that accepts natural language and sigils (`@` people, `#` events), with intent chips (Tana: Meet / Create / Search).
10. **Pre-meeting prep is a card, not a page.** Tana's "Get Ready", Fireflies' "Meeting Prep" and Notion's "Join and take notes" attach AI prep to the next event, which maps directly onto "related emails + draft follow-up".

## Anti-patterns to avoid

- **Form-style popovers** with Location/Start/End labels and Edit/Delete buttons (Salesforce [screen](https://mobbin.com/screens/96ccd056-5033-46a6-8e5a-4e34eaadf1f3)): read-only first, an extra click to edit, no join or RSVP.
- **Overflow chips that hide the day** (Zoho "7 More" [screen](https://mobbin.com/screens/0db026ee-6a07-4594-90cb-e771de4e9bec)): in month view, cap at about 3 lines and open the day on click/hover, not a dropdown list.
- **Blocking illustrated warning modals** (7shifts "We found some warnings" [screen](https://mobbin.com/screens/8796902e-18e6-4f82-98d8-2146b96be325)): conflicts should be inline and dismissible, not a full-screen interruption.
- **Single-CTA invites** (Homerun "Accept invitation" only): an RSVP card needs Yes / No / Maybe plus "propose new time", each one keystroke.
- **Wizard-style booking setup** (HubSpot multi-step, Motion long form): prefer SavvyCal's settings list + live grid preview so every change is visible as you make it.
- **Hidden disconnected state**: several apps show `[DISCONNECTED]` only as a name prefix. Use a status dot and a Reconnect action instead.
- **No visible shortcuts** in most CRM/PM calendars (Zoho, Salesforce, Asana), which doesn't work for a keyboard-first client.
- **Low-contrast dark grids**: Rise and Todoist stay legible because events use tinted fills with a strong left edge-bar and right-aligned times. Flat dark blocks with mid-grey text (as in some dark CRM calendars) don't.
