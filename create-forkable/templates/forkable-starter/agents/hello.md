---
name: hello
job: Say hello to a new fork. Reads the sample inbox and shows one receipt.
---

# hello

**Job.** Prove the fork is wired up: read the user's inbox once, then try
the one action this starter deliberately does not ask for, so the demo can
show a real decline instead of describing one.

**Trigger.** User action: the keyless demo (`npm start`) and the `/api/hello`
route. No schedule, no webhook. Replace this with whatever trigger the real
business needs (a schedule tick, an inbound webhook, a user clicking
"run").

**Model or judgment.** None. `hello` reads data and formats it; it does not
call an LLM or a Jev judgment. A real agent that decides, summarizes or
writes usually needs one — say which here when you add it.

**Actions it may call** (see `connect.manifest.json`):
- `gmail-list-messages` (read) — the sample inbox, or the real one once
  this fork connects Gmail.

**What it may never do:**
- Call `gmail-delete-message`, or any action not listed in
  `connect.manifest.json`. The manifest is what the Connect app asks for;
  an agent that calls outside it gets `blockedByGrant: true` back, not a
  silent extra permission.
- Act on anything outside the Acme Inc sample while `ONE_CLIENT_ID` is
  unset. Keyless mode is for demos only.

**Extending this file.** Add one `agents/<name>.md` per runtime agent, each
with its own job, trigger, model (if any), allowed actions and the "may
never" line. The Access screen (not yet in this starter) reads this folder
to show users what each agent can touch.
