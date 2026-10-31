# Search: UX research and recommended design

Research for **Search**, a personal, keyboard-first web app that indexes the
user's connected tools (Gmail, Outlook, Google and Outlook Calendar, HubSpot,
Attio, Notion, Linear, Slack, Teams, Granola, any other platform in the grant),
makes them searchable, and docks an AI chat on the right that reasons over the
results, cites them and can refine the query.

Done 2026-10-29. Sources: six Mobbin MCP runs (nested `claude -p`, raw notes in
`/tmp/search-mobbin/q1..q6*.md`, not kept in the repo), Glean's public search
docs for operators, and the sibling app's UI (Rill's `ui/`, the Rill email
client) for the house style. Measurements are read off Mobbin's ~1440px web
captures and are about +/-10%.

**Coverage gaps.** Mobbin has no screens for Glean, Dashworks, Guru, Google
Cloud Search, Fivetran, Airbyte, Segment, Census, Hightouch, Granola, Raycast
desktop or Dia. Stand-ins used: Dropbox Dash, Notion, Slack, Linear,
Confluence (Rovo), Databricks, Sana AI, Dovetail for search; Customer.io, Sana,
Attio, HubSpot, Pipedrive, Zapier, Retool, Linear, Stripe, Vercel for
connectors and health; Grain, Fireflies and Otter for meeting notes. Glean's
own docs confirm the operator model (`app:`, `from:`, `type:`, `updated:`;
same filter ORs, different filters AND; `-app:` negates; facets in a side
rail plus common ones across the top).

---

## Part 1. References by area

### 1.1 Search home and federated results

| Ref | Mobbin | Borrow |
|---|---|---|
| Dropbox Dash, results "All" | [d56674ce](https://mobbin.com/screens/d56674ce-4536-435f-bfc1-6fd136b2bf37) | Source logo sits **inside the meta line** ("[Gmail] Updated by Sam Lee · 3 days ago"), not as its own column. Content column ~680px. Rich objects earn taller rows, plain ones stay one line. |
| Dropbox Dash, home + typeahead | [151b0b43](https://mobbin.com/screens/151b0b43-dc4d-464f-8e33-daebd2c53199) | Dropdown attaches flush under the box, same width. **First row is the raw query** ("Search Dash"), objects follow at ~36px. |
| Dropbox Dash, zero results | [52bdbfa0](https://mobbin.com/screens/52bdbfa0-10ca-4c89-9c04-42afe1ae9e65) | The empty state names the fix: "couldn't find anything yet" plus connector tiles to add a source. |
| Dropbox Dash, search + filter flows | [4d90b02a](https://mobbin.com/flows/4d90b02a-8b55-4b33-828a-f87a09de8a68), [3609e125](https://mobbin.com/flows/3609e125-a971-4622-b203-e7484d35928e) | Filters are **written back into the box** as `in:dropbox type:image from:...`. The query string is the single source of truth. |
| Notion search modal | [1ad05716](https://mobbin.com/screens/1ad05716-44a3-48d5-9150-5780546dd323), [b1273bdd](https://mobbin.com/screens/b1273bdd-d65d-44be-a422-ffc0f601bacd) | The cleanest list-left / preview-right: ~585px list, ~330px preview. "Search results (16)" label with count, "Best matches" sort right. Empty query = recents grouped **Today / Yesterday / Past 30 days**. A "Search all sources with AI" row with a logo cluster. |
| Notion searching flow | [6903b640](https://mobbin.com/flows/6903b640-cf92-4822-83a4-143836ec876d) | **Progressive render**: the top hit appears at once, the rest are two-bar skeletons (icon square, title bar, short meta bar). |
| Confluence + Rovo | [34873bd6](https://mobbin.com/screens/34873bd6-d5a4-4008-9f1d-e1a27ec831bf), [011a7330](https://mobbin.com/screens/011a7330-6662-4621-9729-cb0e1b65be41) | Two stages: typeahead dropdown (recently viewed, then results, `↵` "search across products") escalating to a full page with an AI answer card above ranked rows and **source facets with logos and counts** (All 3, Confluence 3, Loom 0). |
| Dovetail | [e4a2b078](https://mobbin.com/screens/e4a2b078-4d85-472b-9539-696148bec4f2) | The AI summary card loads **independently** ("Generating summary...") while results are already on screen. |

### 1.2 Result rows per object type

| Ref | Mobbin | Borrow |
|---|---|---|
| Linear search, mixed types | [a2f96ae5](https://mobbin.com/screens/a2f96ae5-202c-4747-a959-d33d7e5c0f72) | ~34-38px rows, **fixed ~60-70px left column** holding either the type noun ("Project", "Document") or the issue key ("AS-6"); status icon; title with the **matched term bold**; doc breadcrumb inline (" › parent"); relative age right ("1d"). No dividers, no chrome. ~11 rows in 420px. |
| Linear issues tab | [8ea2170d](https://mobbin.com/flows/8ea2170d-b70c-4409-982e-1b058b210cd6) | **Second line only when the match is in the body** (snippet, match bold, ~60px row). Right-side metadata in a stable order: labels, project, dates, avatar. |
| Superhuman search | [7d0694e3](https://mobbin.com/screens/7d0694e3-f28d-417d-a6a0-ebb707695af9) | Email row on one line: unread dot, sender (~120px, bold if unread), subject, grey snippet, date right in 11px. ~25 rows per 460px. The autocomplete shows an **operators hint line** ("in:sent, is:unread, has:attachment") and a contact card for the hovered person. |
| Slack search | [2e2a77e0](https://mobbin.com/screens/2e2a77e0-8a73-4118-9586-b010166cfe81) | Message results carry an **overline with the container** ("# design"), then avatar, sender, time, body with match. Tabs with counts ("Messages 4 · Files 11 · People 0"). |
| Attio picker and tables | [3d3a3b51](https://mobbin.com/screens/3d3a3b51-40bb-4201-b526-e69acf4540ba), [e8183328](https://mobbin.com/screens/e8183328-914b-4606-a87f-876733c421e4) | Person/company rows: logo or avatar, name, domain inline grey, **object chip pinned right**. Relationship facts are the useful metadata: connection strength dot, "Last email interaction 43 minutes ago". Placeholder text ("No contact") instead of blank cells. |
| HubSpot global search + deals | [193b0292](https://mobbin.com/screens/193b0292-07d6-4bb7-b76c-24981a022640), [fe6fcfe5](https://mobbin.com/screens/fe6fcfe5-0785-4c91-b767-199cfe3c33f8) | Deal essentials in order: **name, stage, close date, owner**. Grouped-by-object sections capped at 5 rows with "See more". |
| Pipedrive deal card | [2ff3c977](https://mobbin.com/screens/2ff3c977-7902-48b5-8361-0c89710e5c2e) | Three lines: title, org/contact, value; one attention glyph top-right. |
| Grain / Fireflies / Otter | [94fdb2f9](https://mobbin.com/screens/94fdb2f9-2c49-4605-99f8-441c1c0d9137), [f84c0ac7](https://mobbin.com/screens/f84c0ac7-8e73-4302-b3af-26563fb47220), [d485899e](https://mobbin.com/screens/d485899e-175b-4c24-89f7-95f1ffa9c483) | Meeting note: title, then **date · duration · participant count**; Otter adds 1-2 takeaway bullets under the title, which is the right snippet for a search hit. |
| Calendly agenda | [2cb71f1d](https://mobbin.com/screens/2cb71f1d-cd9c-4675-8fd4-1b9dc19ddad5) | Event: 3px calendar-colour bar on the left, title bold, time range on line 2, "Today" marker on the day header. |

### 1.3 Filters, operators, typeahead

| Ref | Mobbin | Borrow |
|---|---|---|
| Slack, operators mirrored as chips | [72a3768c](https://mobbin.com/screens/72a3768c-70c1-4c8f-b2c0-0f94e3684fb0) | `design from:@Sam type:pdfs` in the box **and** "From Sam Lee" / "2 file types" as filled chips: one state, two views. The clearest two-way binding reference. |
| Slack "From" popover | [4c3b8718](https://mobbin.com/screens/4c3b8718-917a-434f-bb38-7d3e9bce14fc) | ~270px popover, 32px search, checkbox rows with avatars. Active chip turns filled with the avatar inline; many values **collapse to a count** ("2 file types"). |
| Slack filtered empty | [6068ba45](https://mobbin.com/screens/6068ba45-28aa-4670-b622-dc900c6ce65d) | Chips **stay on screen** in the empty state so the fix is one click away. |
| Linear filter chips | [90b0ca17](https://mobbin.com/screens/90b0ca17-b70a-425c-b28b-ce934231b2b9), [9dab540b](https://mobbin.com/screens/9dab540b-f7d4-47d4-be77-5facc75f89fa) | ~24px chips with segments "Status \| is \| In Progress \| ×". "Add filter" menu (~190px) opened with **F**, values show **counts** ("High 14"). Under an empty list: "**14 issues hidden by filters** · Clear filters". |
| Linear saved views | [0f263579](https://mobbin.com/screens/0f263579-9bcb-4815-991e-ad45b408814d) | "Clear" and "Save" appear at the end of the chip bar when any filter is set. |
| Slite pill filters | [c84f90cc](https://mobbin.com/screens/c84f90cc-7696-47d6-b516-1c32ec5548f3) | Unset chips spell their default: "In: All sources", "Edited by: Anyone". Legible before you touch them. |
| GitHub search | [6ce1e117](https://mobbin.com/screens/6ce1e117-4cf7-4193-bc09-2295e7417277) | Left facet rail with type counts; the empty state teaches syntax with a "ProTip! `updated:<2023-08-12`" line. |
| Height | [c030fe48](https://mobbin.com/screens/c030fe48-65cc-4127-9a9e-abf917a4a7ba) | Typing a free word after tokens shows "Search 'word' **⇥**": Tab accepts the suggestion. |
| Slack search history | [f5e86b35](https://mobbin.com/screens/f5e86b35-9c61-408f-bde5-a49fe1aa206b) | Recents stored as the **full operator string**, mixed with recent people and channels. |
| Shopify recents | [ff3011d8](https://mobbin.com/screens/ff3011d8-d1eb-4891-b255-b12a07922d19) | "Recent searches" eyebrow with "Clear history" right-aligned. |

### 1.4 Command palette

| Ref | Mobbin | Borrow |
|---|---|---|
| Superhuman Command | [85dc5994](https://mobbin.com/screens/85dc5994-9360-428d-9092-7425e070ed7f), [68b22cd4](https://mobbin.com/screens/68b22cd4-b6ef-48ee-a6a9-592e1c460570) | Single-key keycap flush right on **every** row, shown even to mouse users, so the palette teaches the shortcuts. After an action is run by typing it, a coach tip shows "Here's the shortcut for next time". |
| Vercel command menu | [d69bfc89](https://mobbin.com/flows/d69bfc89-9340-4478-b035-387a87b188a9), [20b91aab](https://mobbin.com/screens/20b91aab-e548-47fd-88b9-b1cb2289e77d) | `Esc` keycap inside the input; last row forwards the **quoted query to the assistant**. |
| Magnific | [6ad219c3](https://mobbin.com/screens/6ad219c3-e308-4d95-b4dc-70859de1e02d) | "Press **Tab** to Ask" button at the input's right edge: Tab escalates to the AI. Footer `↑↓ Navigate · ↵ Select · Esc Close · ⌘↵ Open in new tab`. |
| Height / Hex | [093bf6f5](https://mobbin.com/screens/093bf6f5-7485-445c-9f52-5115ef06001d), [74bb64f1](https://mobbin.com/screens/74bb64f1-a0a2-4977-b194-b388b2ce50e6) | Filter chips **inside the palette header**. |
| incident.io | [f1b4ccbd](https://mobbin.com/screens/f1b4ccbd-d6f6-4ccb-89b5-3c48d9fd2151) | Navigation rows as breadcrumbs ("Settings → Security → SSO"); status pill right-aligned on object rows. |
| Dropbox Dash Find | [0567ef26](https://mobbin.com/screens/0567ef26-d68b-4674-a6ee-8d255bbe7990) | Footer actions as keycap + verb: `⌘S` Summarize and ask, `⌘C` Copy link. Detached ~280px preview card with a "Found in [logo] Gmail" row. |

### 1.5 AI answer, citations, docked assistant

| Ref | Mobbin | Borrow |
|---|---|---|
| Perplexity | [e02a0b14](https://mobbin.com/screens/e02a0b14-ede7-4f09-bb44-0881b45b53dd), [9bd45c42](https://mobbin.com/screens/9bd45c42-abfc-4488-b961-0acfa0a60c0a), [fa28b1b4](https://mobbin.com/screens/fa28b1b4-e249-46f0-a225-087a1c36e00b) | Citation = **tiny grey pill (~20px, 10px text) at the end of the sentence** naming the source, "+1" when several back it. Hover opens a ~290px card (logo, title, 3-line snippet, `1/2 ‹ ›` pager). Each answer ends with a **logo stack + "3 sources"** button that opens a sources panel. |
| Microsoft Copilot | [e631b279](https://mobbin.com/screens/e631b279-cfc4-4c1c-85c9-f06c838b8df2), [ae62408b](https://mobbin.com/screens/ae62408b-0082-4e4b-a874-4eb1058be971) | References as numbered pill (number + logo + domain) over the title, collapsible. "See my thinking" timeline ("Searching...", "Reading...") as the loading state. |
| Notion AI dock | [7e25606f](https://mobbin.com/screens/7e25606f-869e-4867-8400-cfac83d7e1b1), [fec09ec2](https://mobbin.com/screens/fec09ec2-fba4-45b2-98ad-28e6366bd642) | ~345px dock, page reflows. Collapsible "Thought ›" line before the answer. **Context chips** prefilled in the composer (the current page). Small **square number pills** per line and an "8 citations" footer button. |
| Superhuman Ask AI | [92a9206f](https://mobbin.com/screens/92a9206f-1dd8-4c5a-bfbe-5d454cf5e53e), [7ae675ae](https://mobbin.com/screens/7ae675ae-2423-4231-b8be-2049b4333bec) | Numbered square pills after the sentence; `COPY` and `SOURCES ▾` as 10px caps text buttons. Setup state "Updating: 87 of many" while the index builds. |
| Intercom Fin Copilot | [de167a6f](https://mobbin.com/screens/de167a6f-a71c-46da-9260-8de2c094617d) | Right column has **tabs "Details | Copilot"**: the AI shares the column with the record, width never jumps. |
| ChatGPT deep research | [73833b79](https://mobbin.com/screens/73833b79-1dd5-4354-8fc4-a2e99c33a75e) | Dock with a segmented "**Activity | 23 Sources**"; footer "Research completed in 5m · 23 sources". |
| Customer.io agent | [fafcbfb9](https://mobbin.com/screens/fafcbfb9-fa85-4b4d-b17f-54df962305b5) | One popover lists all references for a paragraph with a pager, cheaper than per-sentence cards. |
| Attio Ask | [3fd10268](https://mobbin.com/screens/3fd10268-cb96-42b2-8886-0ab9dcf50793) | Follow-ups as `↳` rows above the composer. |

### 1.6 Connectors and the add-a-source flow with field mapping

| Ref | Mobbin | Borrow |
|---|---|---|
| Attio CSV import | [2c5ec636](https://mobbin.com/flows/2c5ec636-6d46-416e-b798-ae09d51881c3), [c1100b84](https://mobbin.com/screens/c1100b84-0dd6-4bee-9bc9-05a8a2ea3fec) | Inline stepper "1 Upload › 2 Map columns › 3 Review values › 4 Preview". Map table: File column → arrow (dashed grey unmapped, solid dark mapped) → attribute select with type icon and ×, ~42px rows. **Right "Data preview" pane (~360px)** shows the focused column's values. Review groups rows into **"Needs review 3" / "Automatically mapped 3"**. Best fit for an AI-proposed map. |
| HubSpot import | [d0ea3aaa](https://mobbin.com/screens/d0ea3aaa-65f0-4504-be57-d90953ef841a) | Columns: source header · **two sample values** · mapped check · destination select (required ones marked). Status filter with counts (Unmapped 2, Mapped 6, With errors 0). Sticky footer "You have 2 unmapped columns" gates Next. "Press Enter to continue" tip. |
| Salesforce match fields | [a037f8f5](https://mobbin.com/screens/a037f8f5-9fa8-41a8-b6a2-3af21fc2e097) | Live "20 fields found and 20 matched" count. **"Skip" pinned at the top** of each destination dropdown. Already-used targets marked with a check. |
| Zoho map fields | [dd0b3185](https://mobbin.com/screens/dd0b3185-dd51-4f4e-bcdd-fe4df8842a6e) | Per-row **format select** for dates and numbers; "Apply auto mapping" and "Reset" links. |
| WorkOS attribute mapping | [f93e92da](https://mobbin.com/flows/f93e92da-8afe-4bd8-b59f-68768793ef0d) | Machine field names in **mono**; a sample JSON payload beside the map. |
| Retool schedule + resource | [859dd7fd](https://mobbin.com/screens/859dd7fd-7f41-41e3-927f-9732f45b0e4a), [05e7d9d2](https://mobbin.com/flows/05e7d9d2-77e5-4d27-a628-0d0670c5e066) | Segmented **Interval | Cron**, timezone, and a plain **summary line** ("At 12:00 AM, every day"). |
| Zapier step editor | [8a47f273](https://mobbin.com/flows/8a47f273-e6d7-4583-8e32-78f9029770cf) | Setup › Configure › Test tabs each get a check; **disabled CTA says what is missing** ("To continue, choose an event"). |
| Linear integrations | [85bba678](https://mobbin.com/flows/85bba678-5dd5-4843-92aa-aed8f98e59fd) | Fixed ~600px settings column; detail page meta strip (ENABLED BY / DOCS); "● Connected ▾" as the row control. |
| Notion connections | [7d81411d](https://mobbin.com/flows/7d81411d-0e3c-4208-9930-bc11a237ec02) | "My connections" table separate from "Discover" cards. |

### 1.7 Sync health and source detail

| Ref | Mobbin | Borrow |
|---|---|---|
| Sana AI integrations | [8a256b7a](https://mobbin.com/flows/8a256b7a-92b0-424e-a70a-6f499c251740), [cb148035](https://mobbin.com/screens/cb148035-69d7-4c1b-ada8-a845fd5ef540) | **Two-line status cell**: "Synced" over "Today, 1:48 PM"; during a run a third line with a spinner "Processing 3 new files". Items count as its own column. Detail: problem-bucket chips with counts (Processing issue 0, Too large 0, Unsupported 0) and a ~300px summary rail. |
| Customer.io integration overview | [dac79f39](https://mobbin.com/screens/dac79f39-b619-4919-96cf-552530760314), [87bdb14a](https://mobbin.com/screens/87bdb14a-dc9d-49db-87e5-7a9dbdf63737) | **Status pill before the title**; Details key/value stack (~340px); four stat tiles; amber "needs to be authorized" bar with the action at its right edge. |
| Deel Slack detail | [7b7a9f07](https://mobbin.com/screens/7b7a9f07-cad9-4c17-807a-d9e2df6f45ac) | "Synced: Dec 17, 06:22 PM" right under the status pill; outlined "↻ Sync" button; a partial-failure card that **counts the problem** and offers the repair. |
| n8n executions | [8599968f](https://mobbin.com/screens/8599968f-6ca2-4e28-a058-17d5d5a9f110) | Run rows ~44px with a **3px coloured left edge**, "Succeeded in 44ms" / "Error in 58ms", ↻ retry inline on failed rows, Auto refresh toggle. |
| Databricks runs + event log | [c2906fac](https://mobbin.com/screens/c2906fac-d2b5-461d-a72a-0d01d690e233), [2a53f9eb](https://mobbin.com/screens/2a53f9eb-b8e1-4958-afb7-f441acbdf414) | Run histogram with **top error codes** rollup; "Launched: Manually / By scheduler" column; event log with severity tabs and a `level:` query. |
| Cursor automation runs | [8a1c7ab7](https://mobbin.com/screens/8a1c7ab7-54f3-4284-bb15-b929555ef3da) | Trigger column says why it ran ("Scheduled · every 15 min" vs "Manual"); Cancel on running rows. |
| Meetup disconnected | [9a6077fe](https://mobbin.com/screens/9a6077fe-c60a-4d32-8ce4-743766568e57) | Status pill and Reconnect on one line; everything downstream at 40% and disabled. |
| Coda expired creds | [8c9b4a22](https://mobbin.com/screens/8c9b4a22-2d88-4a27-b78c-51892a141f97) | Reauth ("Sign in again") is a different action from disconnect. |

### 1.8 Access and activity

| Ref | Mobbin | Borrow |
|---|---|---|
| GitHub installed app | [01bc9bde](https://mobbin.com/screens/01bc9bde-3eb5-41d1-b143-83fc0e0f8081) | Permission rows with the **verb in bold**: "**Read** access to...", "**Read** and **write** access to...". |
| Slack consent | [718f9ff1](https://mobbin.com/screens/718f9ff1-7d29-40ff-9ad8-301dc94475fa) | Group "can view" separately from "can take actions". |
| Devin permission diff | [7b19cb77](https://mobbin.com/screens/7b19cb77-7bc3-4e96-9f3a-9ea0b488211d) | "Was read-only" diff when the ask changes. |
| Toggl / PlanetScale audit | [2deef352](https://mobbin.com/screens/2deef352-1f6b-4757-a4c9-dcce106b0e6a), [be9aadee](https://mobbin.com/screens/be9aadee-f4bd-498b-9404-046564f8bc65) | Sentence-style event with actor first; **mono event code under the sentence**. |
| Gumloop activity | [200aea49](https://mobbin.com/screens/200aea49-95f5-44c3-872d-13ee256af405) | 24h tick strip (green/red) over a 28px-row table of tool calls with latency. |

---

## Part 2. Recommended design for Search

House style is Rill's: Inter 13px body, `text-11` metadata, `label-caps`
eyebrows, `h-8` palette rows, `h-11` list rows, `rounded-md`, hairline borders,
`bg-faint` sidebar, `shadow-float` dialogs, Kbd keycaps with "then" for chords,
blue accent. Use only the ladder in `design/SPACING.md` (`text-11`, `text-13`,
`text-15`, `text-xs`, `text-sm`, `text-xl`, `text-28`; gaps 2/4/6/8/10/12/16/24).
Copy Rill's `@theme` block and its `Kbd`, `Chip`, `Badge`, `Menu`, `Dialog`,
`Skeleton`, `EmptyState`, `Switch` and `Tabs` components as the base.

### 2.0 Shell

```
┌────────┬──────────────────────────────────────────────┬──────────────┐
│ Side   │  [ search box, h-11 ]          [Ask ⌘J]       │ Assistant    │
│ 220px  │  chips: Source · Type · From · Date · + ...   │ dock 360px   │
│ (rail  ├────────────────────────┬─────────────────────┤ (280-420,    │
│ 52px)  │ results list  min 440  │ preview  380-480     │ resizable,   │
│        │                        │                     │ persisted)   │
└────────┴────────────────────────┴─────────────────────┴──────────────┘
```

- Sidebar (Rill's `Shell`): Search, Ask (⌘J), then **Saved searches** (pinned
  operator strings), then **Sources** (one row per platform with a 6px health
  dot and item count, links to source detail), then Settings, Access. Footer:
  the One account chip and an indexing status chip ("Indexing HubSpot 62%").
- Breakpoints, same rules as Rill: sidebar folds to the 52px rail under
  1024px, or under 1536px when the dock is open. Below 1280px with the dock
  open, the preview pane stops being a column and becomes a takeover (Enter
  opens it full width over the list, Esc returns, the selection is kept).
  Under 1024px the dock is an overlay (`max-w-[420px]`, `slide-in-right`).
- Decision: **list + right preview pane, not cards.** Every reference that
  handles mixed types well at density (Linear, Superhuman, Notion, Dash Find,
  Customer.io search) uses rows plus a preview. Cards waste height and fight
  the dock for width. Rich types (meeting note, deal) get a second line, not
  a card.

### 2.1 Search home (empty query)

Route `/`. The box is the page.

- Box centred, `max-w-[640px]`, `h-12`, `rounded-lg`, `border-border-strong`,
  `text-15`, placeholder "Search everything, or ask a question". Right edge
  inside the box: `Tab` keycap + "Ask" (Magnific), `/` keycap when unfocused.
- Under it, three blocks at `gap-6`, each with a `label-caps` header:
  1. **Recent**: last 8 searches as the full operator string (Slack history),
     mixed with recently opened items (source logo + title + `text-11` age),
     grouped Today / Yesterday / Earlier (Notion). "Clear" at the header's
     right (Shopify). Rows `h-8`, like the palette.
  2. **Try**: three suggestion chips built from the user's own index
     (`from:<top VIP> after:7d`, `type:meeting with:<frequent person>`,
     `type:deal stage:open`), with a shuffle icon (Perplexity). Hidden until
     the index has data; never canned examples once real data exists.
  3. **Sources**: one compact strip of logos, each with its health dot and
     count ("HubSpot 3,214"), plus "+ Add a source". During first indexing
     each shows a thin progress bar and "Indexing 1,240 of about 3,000"
     (Superhuman's "Updating: 87 of many", but with a real number when the
     platform gives one).
- Brand new account, nothing indexed: one sentence ("Search reads the tools
  you connect. Add one to start.") and the connector tiles (Dash zero state),
  not an illustration.

### 2.2 Typing: instant results

- No dropdown. Typing on home moves the box to the top bar (150ms
  `ease-out-quart`) and fills the results page under it, Linear style; the
  URL becomes `/?q=...` so every search is linkable and lands in Recent.
- While a word is half typed, an inline suggestion row appears under the box:
  operator completions (`from:pri` → "from: Priya Shah" with avatar,
  accept with `Tab`, Height) and person/company matches. Max 5 rows, `h-8`.
- Results render progressively: local index hits first (top 1-3 immediately,
  the rest as Notion's two-bar skeletons, `shimmer`), then live API fallbacks
  for sources not yet indexed, marked with a `text-11` "live" tag.
- Footer line under the box, `text-11` muted, GitHub ProTip style, rotating one
  operator tip: "Tip: `from:me type:email before:2026-10-01`".

### 2.3 Results page

Top to bottom:

1. **Box** (`h-11`, full width of the main column, `px-4`).
2. **Scope tabs** with counts, Slack/Plane style, only where count > 0 plus
   All: `All 128 · Mail 54 · Calendar 9 · People 12 · Companies 4 · Docs 21 ·
   Issues 15 · Chat 10 · Meetings 3 · Deals 2`. `h-8`, `text-13`, underline
   active (Rill's Settings tabs). Keys `1`-`9` when the list has focus.
3. **Chip bar** (`h-7` chips, `gap-1.5`, `rounded-md`, `text-xs`): fixed order
   **Source · From · With · Date** plus type-specific chips that change with
   the tab (Mail: Has attachment, Unread; Issues: Status, Assignee; Deals:
   Stage, Owner; Calendar: Organizer, Upcoming/Past). Unset chips spell their
   default ("Source: All", "Date: Any time", Slite). Set chips fill
   (`bg-muted`, `text-foreground`), show the value (avatar for people, logo
   for sources) and a separate × hit target; several values collapse to a
   count ("3 sources"). `+ Filter` (key `F`) opens a Linear-style cascading
   menu with value counts. At the end, when anything is set: `Clear` and
   `Save` (Linear views), Save pins it in the sidebar.
   **Two-way binding** (Slack, Dash): every chip writes its operator into the
   box and every typed operator lights its chip. Operators: `in:` / `source:`,
   `type:`, `from:`, `to:`, `with:`, `before:`, `after:`, `updated:`,
   `is:unread`, `has:attachment`, `stage:`, `status:`, `-` to negate,
   quotes for phrases (Glean's OR-within / AND-across rule).
   Overflow: below ~720px main width, type-specific chips fold into
   `+ Filter (2)`; the four fixed chips never fold.
4. **Answer strip** (optional, top of the list, Confluence/Dovetail): when the
   query reads like a question (`?`, "who", "when", "what did"), a one-block
   AI answer (2-4 lines, citations as in 2.6) loads independently above the
   rows, with "Continue in chat ⌘J". Never blocks the list.
5. **List**, sorted "Best match" (menu right of the tabs: Best match, Newest,
   Oldest). `label-caps` header "128 results" and, under filters, Linear's
   "**14 hidden by filters** · Clear".
6. **Preview pane** (see 2.5).

Empty results: keep box, tabs and chips visible. One `text-13` line ("Nothing
matched `pricing from:dana` in 4 sources."), then concrete fixes as buttons:
"Remove From: Dana", "Search all time", "Ask the assistant", and if a likely
source is not connected, its tile ("Not searching Slack. Add it.").

### 2.4 Result rows by type

Shared anatomy (Linear + Dash): `h-9` (36px) single-line, `h-14` (56px) when a
second line exists. `px-3`, `gap-2.5`, hover `bg-card-hover`, selected `bg-muted`
plus a 2px accent bar on the left edge. Left to right:

`[16px source logo] [type column 64px, text-11 muted] [title text-13, match font-semibold] [inline context text-xs muted] ··· [right meta text-11 tnum muted]`

Second line (`text-xs` muted, starts under the title, 6px below it): the
**snippet with the match bold** when the match is in the body, otherwise
nothing (Linear). Never snippet and breadcrumb both (Notion).

| Type | Type column | Title + inline context | Right meta | Second line |
|---|---|---|---|---|
| Email thread | `Mail` | **Sender** (unread = semibold) · subject, `(3)` message count | date, paperclip if attachments | snippet of the matching message |
| Calendar event | `Event` | 3px calendar-colour bar replaces the logo tint; title · `Tue Oct 28, 14:00-14:30` | RSVP state chip (Going/Maybe/No/Invited) | attendees "Priya, Dana +3" · meeting link icon |
| Person | 20px avatar replaces type col text | Name · title at company | "Last email 2d ago" (Attio) | email · sources it was found in (logo cluster, max 4) |
| Company | logo/favicon | Name · domain | owner avatar, "3 open deals" | category · last interaction |
| Doc / page | `Doc` | Title › parent breadcrumb | edited age, editor avatar | snippet |
| Issue / task | issue key (`ENG-412`) | status icon · title | assignee avatar, priority bars, due date | snippet if body match |
| Chat message | `# channel` or DM name | **Sender**: message text (one line) | time | thread reply count "4 replies" |
| Meeting note | `Meeting` | Title · date · duration | participant count (people icon + n) | first matching takeaway bullet (Otter) |
| Deal | `Deal` | Name · company | amount (tnum), stage chip | close date · owner |

Grouping: the All tab is one flat ranked list (Linear), not per-type sections.
People and companies that match strongly get a **top strip** above the list
(max 3 person/company chips, Superhuman's contact suggestions), because
"everything about Priya" is the commonest personal search.

### 2.5 Preview pane

`w-[420px]` default (380-480, drag handle like the dock), `border-l`,
`bg-card`. Header `h-10`: source logo + "Found in Gmail" (Dash) + `Open in
Gmail ↗` (`O`) + copy link (`Y`) + close. Body per type: email = the matching
message expanded, others collapsed, query terms highlighted with
`bg-accent/15`; event = time, place, link, attendees with RSVP, description;
person/company = relationship card (last interactions per source as a mini
timeline, open deals, recent threads) and "Search everything about Priya"
(`with:"Priya Shah"`); doc/issue/note = rendered excerpt around the match plus
properties table (`text-11` labels over `text-13` values, Customer.io details
stack); deal = stage, amount, close date, owner, linked contacts. Footer bar
`h-8 bg-faint`: `Ask about this ⌘⇧J` (adds the item as a context chip in the
dock), `Open ↵`, `Next J`.

### 2.6 AI chat dock

Reuse Rill's `ChatPanel`: right dock, 360px default, 280-420, drag + arrow-key
resize, persisted width, `⌘J` toggles, `⌘⇧J` focuses the composer, overlay
under 1024px.

- **Header** `h-10`: chat title menu (history), segmented **Chat | Sources**
  (ChatGPT's Activity/Sources; Sources lists every item cited in this chat),
  close.
- **Context row** under the header (`text-11`, Rill's route-context line): "Looking
  at: `pricing from:dana after:30d` · 23 results" with a × to detach. The
  assistant always knows the current query, filters and the selected item.
- **Answer**: `text-13`/1.625. A collapsible "Searched 3 ways · read 12 items ›"
  line first (Notion "Thought", Copilot thinking); expanded, it lists each
  query the model ran as a clickable operator string. Loading state is that
  line live ("Searching HubSpot deals...").
- **Citations**: numbered square pills after the sentence, `h-4 min-w-4
  rounded-sm bg-muted text-10 font-medium tnum` (Notion/Superhuman), the
  number matching a footnote list. Hover (or focus) opens a ~300px card:
  source logo, type, title, the exact quoted span with the match highlighted,
  date, `↵ Open` (Perplexity hover card, with a pager when one pill covers
  several items). Clicking a pill **selects that item in the results list and
  opens the preview scrolled to the quoted span**: the dock and the list are
  one workspace. Under each answer: a logo stack + "8 sources" (Perplexity),
  and `Copy` / `Sources` text buttons.
- **Refining the query**: when the model wants a different search it returns a
  proposal card (Rill's `ProposalCard`) showing the diff as chips:
  `+ from:Dana` `+ after:2026-09-01` `− type:doc` and a result count preview
  ("41 results"). `Apply` (`⌘↵`) rewrites the box and chips; `Search in chat
  only` runs it without touching the page. The page never changes without a
  keypress.
- **Follow-ups**: two or three `↳` rows above the composer (Attio).
- **Composer**: context chips (current query, selected item, any pinned
  item), model picker (Rill's `ModelPicker`), `⌘↵` send. Empty state: three
  question rows derived from the current results ("Summarize what Dana said
  about pricing", "Which of these deals close this month?").
- **Grounding rule** stated in a `text-11` footer, like Rill's palette: "Answers
  come only from items Search found. Every claim links to one."

### 2.7 Command palette (⌘K)

Rill's palette as is (`max-w-[600px]`, `h-12` input, `h-8` rows, `label-caps`
groups, keycaps right, footer `h-8 bg-faint`). Groups: **Jump to** (top items
for the typed text, any source), **Searches** (recent and saved), **Sources**
(go to source detail), **Actions** (New profile, Sync all, Toggle dock,
Theme, Shortcuts). Last row always: `Ask: "<typed text>"` with `Tab` (Vercel,
Magnific). Footer: `↑↓ Navigate · ↵ Open · ⌘↵ Open in source app · Tab Ask ·
Esc Close`. After a command run by typing that has a shortcut, show
Superhuman's coach toast once: "Next time: G then I".

### 2.8 Settings → Integrations (source list with health)

Settings layout from Rill (`max-w-[760px]` column, `text-xl` title, tabs
General / Integrations / Assistant / Appearance). Integrations tab:

- Header row: "Sources" `text-15`, hint "Each source is a profile on one of
  your One connections.", primary `New profile` (`N`).
- **Table**, `h-12` rows, hairline dividers (Sana, Lindy): logo + name +
  account (`text-11` muted, "dana@acme.com") · models ("Contacts, Deals" or
  "3 models") · **status cell, two lines** (dot + word: Healthy / Syncing /
  Needs attention / Paused / Disconnected / Not in grant; under it
  `text-11` "Synced 4 min ago · next in 11 min", or while running
  "◌ 1,240 of ~3,000"; Vercel dot + word + duration) · items (tnum, right
  aligned) · `···` menu (Sync now, Pause, Edit profile, Reconnect, Remove).
- Above the table, only when something is wrong, one amber banner that counts
  it and carries the fix at its right edge (Customer.io, Deel): "Slack needs
  you to sign in again. Indexing stopped 2h ago. **Reconnect**".
- Below: **Available in your grant** (connections with no profile yet, logos
  with "Add") and **Not in your grant** (greyed, "Add in One ↗"), Notion's
  My connections vs Discover split.

States and colours: Healthy `text-success-text`, Syncing accent with
`pulse-dot`, Needs attention `text-warning-text`, Disconnected and Not in
grant `text-destructive-text`, Paused muted. Always dot + word, never colour
alone.

### 2.9 New profile flow

Full-screen sheet over the app (Attio's import sheet), `max-w-[960px]`, inline
stepper in the header `1 Platform › 2 Models › 3 Fields › 4 Identity & schedule
› 5 Review` (done steps get a check, Zapier), Back left, primary right; the
primary's label says what is missing when disabled ("Pick at least one model").
`↵` continues everywhere (HubSpot tip line), `Esc` asks before discarding.

1. **Platform.** Palette-style picker (Basedash): search input, rows `h-9` with
   logo, platform name and the One connection it would use ("HubSpot ·
   dana@acme.com"). Groups: In your grant / Needs adding in One. Choosing one
   shows the actions it will call (list/search/get ids from the catalog) in a
   `text-11` mono line: read-only is the default and is stated.
2. **Models.** Checkbox cards in a 2-col grid (Customer.io), one per object the
   platform exposes (HubSpot: Contacts, Companies, Deals, Notes, Meetings;
   Linear: Issues, Projects, Docs; Gmail: Threads). Each card: name, a `text-11`
   estimated count from a dry-run list call ("about 3,214"), the list action id
   in mono, and a sample record title. The AI pre-checks the likely ones and
   says why in one line.
3. **Fields (AI-proposed map).** Two panes. Left (`flex-1`): table
   `Source field (mono) · samples · → · Search field · format`. Rows `h-10`
   (`h-14` with two samples stacked, HubSpot). Search fields are a fixed
   vocabulary per result type: title, body, people (from/to/with/owner),
   company, date (created/updated/start/end/due), url, status, amount,
   stage, labels, id, plus "Keep as property" and **Skip pinned first**
   (Salesforce). Arrow dashed when unmapped, solid when mapped (Attio).
   Grouped sections **Needs review (n)** first, then **Mapped by AI (n)**
   collapsed (Attio), each AI row shows a `text-11` reason on hover ("values look
   like ISO dates"). Header count "16 of 19 mapped · 2 need review",
   status filter with counts (HubSpot). Required targets (title, id, date,
   url) marked; Next stays disabled until they are set. Right pane
   (`w-[340px]`): **live preview of one record as a search result row and as a
   preview pane**, re-rendered as mappings change, with `‹ ›` to page through
   5 sample records (Attio's data preview, WorkOS's sample payload). Keys:
   `J/K` rows, `↵` opens the target select, `S` skip, `R` reset to the AI
   proposal.
4. **Identity & schedule.** Unique id field (prefilled, uniqueness checked
   against the samples: "5 of 5 unique"); **link template** with a live
   resolved example and a `Test link ↗` (`https://app.hubspot.com/contacts/{portalId}/record/0-1/{id}`);
   title template for rows without a natural title; schedule as segmented
   **Every 5 / 15 / 60 min · Daily · Custom (cron)**, timezone, and a Retool
   summary line ("Every 15 minutes, incremental by updated date"); backfill
   window (30 days / 1 year / All). A `text-11` line on cost: "about 14 calls
   per run on your grant".
5. **Review.** Stat tiles (Pipedrive): Models 2 · Fields 16 · First run about
   3,400 items · Schedule every 15 min. Profile name (editable). `Save and start
   indexing ⌘↵`. Saving lands on the source detail with the first run live.

### 2.10 Source detail and health

Route `/sources/:id`, Rill settings width but two columns at ≥1280px:

- Header: status pill **before** the name (Customer.io), logo, "HubSpot ·
  dana@acme.com", under it `text-11` "Synced 4 min ago · next in 11 min ·
  every 15 min" (Deel). Right: `Sync now` outlined (`R`), `···` (Pause, Edit
  profile, Reconnect, Remove). Problem banner as in 2.8 when needed; when
  disconnected, everything below is at 40% and disabled (Meetup).
- Tabs: **Overview · Fields · Runs · Errors (3)**.
- Overview: four tiles `h-16` (`text-11` label over `text-xl tnum` value; Attio
  2x2): Items indexed · Added 24h · Updated 24h · Failed 24h. A 24h tick strip
  of runs (Gumloop/Databricks, green/red/grey). Per-model rows: model name,
  items, last change, own status dot. Right rail `w-[300px]` details stack:
  Connection, Actions used (mono), Created, Schedule, Backfill, Link template.
- Runs: rows `h-9` with a 3px coloured left edge (n8n): time · trigger
  (Scheduled / Manual / First run, Cursor) · "+42 new, 7 updated, 0 failed" ·
  duration · retry icon on failures. Hover shows the details card (Attio).
- Errors: problem buckets as chips with counts (Sana: Auth, Rate limited,
  Mapping, Too large), rows with the item, the `text-11` mono error, and Retry.
  Error copy says what to do, not the HTTP code alone.
- Fields: the map from step 3, editable; changes ask "Reindex 3,214 items?".

### 2.11 Access

Same model as Rill's Access screen (grant card, Available actions, Activity,
"Manage in One ↗" for the real revoke; Disconnect is local).

- Grant card: "Granted by Dana · 23 actions across 7 platforms · owned in your
  One account". Actions grouped by platform, each row with the **verb in
  bold** (GitHub): "**Read** HubSpot contacts", "**List** Slack messages".
  Search asks for read actions only; one `text-xs` line says so: "Search can
  read. It has no action that sends, edits or deletes." Ungranted write rows
  stay listed and clickable to show the `declined, 403` receipt, as in Rill.
- When a new profile needs an action not in the grant, the row shows "Was not
  granted" (Devin diff) and a button to widen the ask in One.
- Activity ledger: Gumloop tick strip over 28px rows: time (mono) ·
  sentence ("Indexed 42 HubSpot deals") · mono action id under it
  (PlanetScale) · latency · result. Assistant calls appear here too, tagged
  "Assistant", so the user can see what the AI read.

### 2.12 Loading, empty and error states (summary)

| Where | State |
|---|---|
| Home, nothing connected | One line + connector tiles (Dash) |
| Home, first index running | Source strip with per-source progress and real counts |
| Results loading | Top hits at once, two-bar skeleton rows for the rest (Notion) |
| Results empty | Chips stay, one line naming query and sources searched, fix buttons, "n hidden by filters" (Slack, Linear, GitHub) |
| Answer strip / dock loading | Live "Searching..." step line, never a bare spinner |
| Source error | Amber banner with counted problem and fix at the right edge |
| Load failed | Rill's `LoadError` with Retry, never an empty list |

---

## Part 3. Keyboard map

Single keys work when focus is not in a text field. Chords use "then" (Rill's
`Keys`). The `?` sheet and the palette show these exactly.

| Group | Keys | Action |
|---|---|---|
| Global | `/` | Focus the search box |
| | `⌘K` | Command palette |
| | `⌘J` | Toggle the assistant dock |
| | `⌘⇧J` | Focus the assistant composer (adds the selected item as context) |
| | `?` | Shortcut sheet |
| | `G` then `H` | Home |
| | `G` then `I` | Settings → Integrations |
| | `G` then `A` | Access |
| | `G` then `,` | Settings |
| | `G` then `1`-`9` | Saved search n |
| Search box | `Tab` | Accept the operator suggestion; on an empty suggestion, ask the assistant |
| | `↵` | Search (or open the top hit if it is selected) |
| | `⌘↵` | Ask the assistant about these results |
| | `↓` | Move into the results list |
| | `Esc` | Clear the box; again, leave it |
| Results | `J` / `K` or `↓` / `↑` | Next / previous result |
| | `↵` | Open preview (takeover when the pane is hidden) |
| | `O` or `⌘↵` | Open in the source app |
| | `Space` | Toggle the preview pane |
| | `Y` | Copy link |
| | `1`-`9` | Scope tab n (All, Mail, Calendar, ...) |
| | `F` | Add filter menu |
| | `⇧F` | Clear all filters |
| | `S` | Save this search |
| | `P` | Find everything about this person or company (`with:`) |
| | `Esc` | Close preview, then back to the box |
| Assistant | `⌘↵` | Send; on a query proposal, Apply |
| | `⌥1`-`⌥9` | Open citation n in the preview |
| | `Esc` | Back to the results list (dock stays open) |
| Integrations | `N` | New profile |
| | `R` | Sync now (source detail) |
| | `J` / `K`, `↵` | Move through sources, open one |
| New profile | `↵` | Continue |
| | `⌘↵` | Save and start indexing (last step) |
| | `J` / `K`, `S`, `R` | Field map: move, skip field, reset to the AI proposal |
| | `Esc` | Leave (asks first if anything changed) |

Conflicts checked against Rill: `G` chords and `⌘J`/`⌘⇧J`/`⌘K`/`?` keep
Rill's meanings, so a user of both apps keeps their hands.

---

## Part 4. Open questions for the build

- Whether the answer strip on the results page (2.3 item 4) is worth having
  next to the dock, or the dock alone answers. Recommend shipping it behind
  question-shaped queries only, then judging it on real use.
- Granola's catalog actions and data shape were not checked here; confirm in
  the One catalog before promising meeting-note snippets with takeaways.
- Glean, Fivetran and Airbyte screenshots were not available on Mobbin; the
  stand-ins above cover the same patterns, but a live look at Glean's results
  page and Fivetran's connector status page is the best next reference if a
  screen feels unresolved.
