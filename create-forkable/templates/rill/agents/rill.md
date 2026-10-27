---
name: rill
job: Triages your inbox and calendar into five lanes, drafts replies in your voice, never sends without your keypress.
---

# rill

**Job.** Sync your mailbox and calendar, run every message through Jev to
get a lane (VIP, Goals, Reply, Other, Screener) and a reason, write a
draft reply when one is owed, and keep a morning brief, Offer times and
Ask your inbox answers current. The writer never sends and never takes
any other action; only your keypress sends a reply or confirms a
calendar RSVP.

**Trigger.** Three: the scheduler tick (`server/src/scheduler.ts`, every
2 minutes, syncs every connected mailbox and calendar); a user action
(open a thread, send a reply, RSVP, create or edit an event); and the
keyless demo (`pnpm start` / `npm start`), which replays recorded
judgments and drafts against the Acme Inc sample instead of calling
anything live.

**Model or judgment.** Jev (TypeSafe, `typesafe` platform) answers a
fixed question set per message (addressed to an AI, tries to override
instructions, pushes for an action, needs a reply, goal match, ...);
`packages/core/src/policy.ts` turns those answers plus `INBOX.md`'s rules
into the lane. The writer (`packages/core/src/writer/`) runs on Claude
Code or Codex on your machine, on Claude through One on your grant, or on
your own connected model, same prompts and the same no-dash/no-new-URL/
no-claimed-action validator on every engine.

**Actions it may call** (see `connect.manifest.json`):
- Gmail or Outlook Mail: read your threads and profile, apply lane
  labels/categories, save and send drafts.
- Google Calendar or Outlook Calendar: read events and free/busy, create
  and edit events, RSVP.
- Zoom: create a meeting link for a new event, when you pick Zoom.
- TypeSafe (`typesafe`): Jev's judgments.
- Anthropic, when you choose "through One" as the writer engine.

**What it may never do:**
- Call `gmail-delete-message`, `events-delete` on either calendar, or any
  action not listed in `connect.manifest.json`. Delete is never granted; a
  call to it comes back declined (403) and the provider is never called.
- Send a reply, RSVP, or confirm a booking without your keypress. The
  writer produces text; it has no tool that can act.
- Act on anything outside the Acme Inc sample while no mailbox is
  connected. Keyless mode is for demos only.

**Extending this file.** Rill is one agent today (one loop, three
triggers, several platforms). A fork that splits triage, drafting, or
calendar handling into separate runtime agents should add one
`agents/<name>.md` per agent, each with its own job, trigger, model (if
any), allowed actions and the "may never" line.
