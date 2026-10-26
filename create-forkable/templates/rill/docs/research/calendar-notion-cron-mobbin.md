# Notion Calendar (Cron) and peers on Mobbin

Pulled 2026-10-22 via the Mobbin MCP for the calendar polish pass. Mobbin has no "Notion Calendar"; it has the same product as **Cron Calendar** (web, April 2023).


## Week grid and event blocks

**Cron Calendar, "Week view with selected event"** ([link](https://mobbin.com/screens/db8dcd14-f677-4e5f-96e2-0bc450651a4f)). Event block is a pale tint of the calendar color with a solid 3px bar on the left edge. Title is 12px medium, time is 10px lighter underneath. Day columns are separated by hairlines. Every day header shows a small count line ("2 events", "3 events") under the date. Events from a second account render as dashed outline with strikethrough for declined. The all-day strip is a single hairline row at the top labeled "All-day" and holds pill chips.

**Cron Calendar, "Week view, selected event dark fill"** ([link](https://mobbin.com/screens/da1cce87-e265-465f-8f33-286129aa1b3e)). The selected event flips from tint to solid fill in its calendar color with white text. That is the only selection state. Unselected events on the same day stay tinted.

**Cron Calendar, "Overlapping events after duplicate"** ([link](https://mobbin.com/flows/991ca255-a0b7-487e-b2db-c2cbebc34eeb)). Two 9 to 10 AM events sit side by side at half column width, each keeping its own left bar. No cascading offset.

**Cron Calendar, "Short event"** ([link](https://mobbin.com/screens/d1396129-4c2e-4a1f-b6aa-0e251e3c8a9a)). A 30-minute event ("Meeting with Jane") collapses to a single line. Title only, time dropped, left bar still present, text vertically centered.

**Amie, "Week view"** ([link](https://mobbin.com/screens/ff9b0ff4-cdf3-465c-9959-eba67c46fa3f)). Same tint-plus-bar recipe but with 6px rounded corners and a 1px border of the same hue. Very short recurring events ("Product team standup") render as tiny pill chips with a dot. Three overlapping events split a column into equal thirds.

**Rise, "Week view dark"** ([link](https://mobbin.com/screens/f15eb649-3709-4797-9f89-d893074ed733)). Overlaps use a 2px gap between side-by-side blocks. Events needing attention get a diagonal hatch stripe on the left bar instead of a solid bar.

## Now line

**Cron Calendar, "Today column highlight"** ([link](https://mobbin.com/screens/d6415b34-7da3-4325-829b-bb85298f4eb2)). The now line is a thin black rule with a small dot at the left, confined to today's column only. The current time ("11:38PM") is printed in bold in the time gutter in place of the hour label. Today's column may be tinted in the accent at low opacity.

**Amie, "Week view"** ([link](https://mobbin.com/screens/b7b75039-499c-4834-b124-09bd04615745)). Red now line spans the full grid width, red time label ("3:57 am") in the gutter, and a 2px darker segment over today's column.

**Clockwise, "Week view"** ([link](https://mobbin.com/screens/c6dbfcf9-74eb-4741-aa55-193a0b693151)). Red line with a filled circle at the left edge of today's column, extending only across today and the days to its right.

## Header

**Cron Calendar, "View switcher menu"** ([link](https://mobbin.com/screens/fa751310-8f2f-4b07-a5bb-0c1d02fa6108)). Left: month name in large bold with year in regular weight ("April 2023"). Right cluster: avatar, "Week" dropdown with keyboard hints (Day 1 or D, Week 0 or W, Month M), "Today" button, then chevron prev and next. The dropdown nests "Number of days" (2 to 9) and "View Settings" (weekends, declined events, week numbers).

**Cron Calendar, "Time zone column"** ([link](https://mobbin.com/screens/7ff4dd62-f291-45d3-ad4e-531b90face2f)). Time zone appears as a tiny "GMT-4" label at the top of the time gutter. A plus button beside it opens a second gutter and a searchable zone list. Day headers are "Sun 23", "Mon 24" with today's number in a solid accent pill.

**Rise, "Header with view menu"** ([link](https://mobbin.com/screens/e6507dfb-30e8-4018-b082-710801fbb28f)). Same structure but the three-dot menu holds view options. "Meet" is the single accent button at top right.

## Clicking an event

**Cron Calendar, "Event side panel"** ([link](https://mobbin.com/screens/d1396129-4c2e-4a1f-b6aa-0e251e3c8a9a)). Clicking opens a fixed right panel, not a popover. Order top to bottom: panel title "Event" with a three-dot menu, event title as an editable text line, then time row "9AM → 10AM 1h", date row, All-day toggle, time zone, repeat rule. Participants section with avatars and "Optional" subtitle. Below that conferencing, location, description, then calendar account, Busy and visibility, reminders.

**Cron Calendar, "Right-click context menu"** ([link](https://mobbin.com/screens/d7dc5d5e-c542-4338-880a-43427d1d310d)). Right-click on an event shows a dark menu with a color swatch row on top, then RSVP options (Yes, No, Maybe with E then Y shortcuts), Email participant, Join Google Meet, Cut, Copy, Duplicate, Delete.

**Amie, "Event popover"** ([link](https://mobbin.com/screens/e0aa2b7a-da53-4755-a486-887651fc5e54)). Amie uses a floating card anchored near the event instead of a panel. Title and description first, then Add guests with a green "Send event" button inline, location with Google Meet chip, time range, All day and Repeat toggles. Bottom row is small icon toggles plus "Busy" and "Going" status.

**Proton Calendar, "Event popover"** ([link](https://mobbin.com/screens/bec0d72e-934b-42c3-a3c3-1c91d1eac278)). Popover with a thick colored left border matching the event, title, date range, location, participants collapsed with "2 pending" count.

## Creating an event

**Cron Calendar, flow "Creating an event"** ([link](https://mobbin.com/flows/d9fb870e-7981-49ca-8371-d70c03a97abe)). Right-click an empty slot shows a two-item menu: "Create event C" and "Paste event ⌘V". The new event immediately appears as a solid 30-minute block labeled with its start time ("9 AM") and the right panel opens with an empty "Title" field focused. No modal.

**Cron Calendar, "Command palette"** ([link](https://mobbin.com/screens/d04b0985-ce68-4d9f-b64e-65616e3548af)). Cmd+K opens a dark palette with "Share availabilities", "Meet with", "Create event", "Go to", "Go to today", each with a single-letter shortcut.

**Superhuman Mail, "Drag to share availability"** ([link](https://mobbin.com/screens/d05f33d5-ae04-4211-95af-7a7986dc117a)). Drag on the grid draws a solid blue block with a dashed border and the time range in the top-left corner. A small floating card at the bottom collects title, attendees and duration.

**Motion, flow "Creating an event"** ([link](https://mobbin.com/flows/7fb07f5b-e929-4bf3-8e40-4ffc86c9577c)). Click opens a floating card at the slot with an Event/Task tab switch, date and time chips, then guests, description, conferencing, location, and a "Create ⌘↵" button.

**Amie, flow "Creating an event"** ([link](https://mobbin.com/flows/2901ed8e-9087-46e6-b829-3d4a75466e33)). Drag creates a block, then typing a title shows "Copy from history" suggestions with participant avatars.

## Event detail panel with Join and RSVP

**Cron Calendar, "Event panel with Join button"** ([link](https://mobbin.com/screens/d8beae33-53a0-43d1-9b13-769294e96d66)). The accent-colored "Join Google Meet meeting" button is full width and sits directly under the participants list, above the meeting code, location and description. It carries a "J" keyboard hint. Participants show avatar, name, "Optional" subtitle, and a small dot for pending status. When the user is organizer the button becomes "Send invite" with a dropdown.

**Cron Calendar, "Participant hover card"** ([link](https://mobbin.com/screens/ef3fe02f-cc9c-4059-bea7-ff4494bab30b)). Hovering a participant reveals their email in a gray card with reply-all and more icons.

**Rise, "Event panel dark"** ([link](https://mobbin.com/screens/fa011ad5-2527-4335-af9d-f6c903c606dc)). Participants first with availability status ("Available & organizer"), then date and time with a Flexible / Normal / All-day segmented control. Footer has a delete icon, Reschedule, and a "Save ⌘↵" accent button.

**Microsoft Teams, "Calendar with Join"** ([link](https://mobbin.com/screens/7bbe076d-dc1f-4dc3-9d94-639fb2aca167)). The Join button appears inside the event block itself for the current meeting, top right corner.

## All-day strip

**Cron Calendar, "All-day with chips"** ([link](https://mobbin.com/screens/db8dcd14-f677-4e5f-96e2-0bc450651a4f)). Single-line strip. Chips are tinted with a left bar, 18px tall, and the per-day event count shares the row.

**Amie, "All-day stack"** ([link](https://mobbin.com/screens/8f62be10-2a47-48e0-b9ae-ad3674d27962)). Strip grows to fit up to five stacked chips. Chips show a lock icon for private items.

**Rise, "Out of office banner"** ([link](https://mobbin.com/screens/587920f0-a29c-4954-bcb8-b053561e2d26)). Multi-day all-day events span across columns as one bar with an icon prefix.

## Dark mode

**Cron Calendar, "Dark mode week view"** ([link](https://mobbin.com/screens/44bdd96d-04b1-46d0-a07e-150d9ac70af7)). Background is near-black, grid lines are one step lighter, gutter text is mid-gray. Event tints become darker versions of the same hue with brighter text. The selected event stays solid accent. The accent orange is unchanged between modes.

**Cron Calendar, "Dark mode calendar panel"** ([link](https://mobbin.com/screens/c0e642d8-8a7b-44ec-b293-875dd37d6597)). The right panel uses a slightly lighter surface than the grid so the split is visible without a border.

**Cron Calendar, "Theme setting"** ([link](https://mobbin.com/screens/13766011-4e5a-4a1a-aca0-f21b506f18cf)). Auto, Light, Dark radio group in Settings.

**Amie, "Appearance settings"** ([link](https://mobbin.com/screens/a48f080b-552b-4575-839b-22d63a9804da)). Live preview of the grid above the theme radio group.

## Top 10 details to copy into a Tailwind monochrome-plus-accent build

1. **Event block recipe.** Tinted background at roughly 15 percent of the color, a 3px solid left bar, 12px medium title, 10px muted time beneath. In monochrome use neutral-100 fill and neutral-800 bar, reserve the accent for the selected event. Source: Cron "Week view with selected event" above.
2. **Selection flips to solid.** Clicked event becomes solid fill with inverted text, nothing else changes. One state, no outline or shadow. Source: Cron "selected event dark fill".
3. **Short events collapse to one line.** Under 30 minutes, drop the time and center the title vertically. Under 15 minutes, render a pill chip. Source: Cron "Short event" and Amie standup chips.
4. **Overlaps split the column equally.** Two events share 50/50, three share thirds, each keeps its left bar, 2px gap between them. No staggered offsets. Source: Cron duplicate flow and Rise.
5. **Now line scoped to today.** Thin accent rule with a 6px dot at its left end, drawn only across today's column, and the current time replaces the hour label in the gutter in bold. Source: Cron "Today column highlight".
6. **Today pill in the header.** Day headers are "Mon 24" in neutral text and only today's number gets a solid accent pill. This is the one place besides the now line where accent appears in the chrome. Source: Cron view switcher screen.
7. **Right side panel, not popover.** Clicking opens a fixed panel. Order: title field, time row with arrow and duration ("9AM → 10AM 1h"), date, All-day toggle, zone, repeat, participants, then the full-width accent Join button, then location and description. Source: Cron "Event panel with Join button".
8. **Create on click without a modal.** Clicking or dragging on the grid drops a solid block showing only its start time and opens the panel with an empty title focused. Drag state uses a dashed border. Source: Cron creating-an-event flow and Superhuman drag.
9. **Time zone lives in the gutter.** A small "GMT-4" label at the top of the time column with a plus to add a second gutter, rather than a header dropdown. Source: Cron "Time zone column".
10. **Dark mode is a surface swap, not a repaint.** Keep hue and accent identical, move neutrals to near-black grid and a one-step-lighter panel, raise event tint opacity so text contrast holds. Source: Cron dark mode screens.

All image URLs from Mobbin expire in 30 days. The Mobbin page links above are permanent.
