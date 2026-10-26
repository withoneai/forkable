---
name: record-fixtures
description: Refresh this fork's sample fixtures (the Acme Inc data the keyless demo shows) from a real connected account, with everything scrubbed to the sample company before it is committed. Use when the demo data looks stale or thin, never to capture a real user's data as-is.
---

# record-fixtures

The keyless demo must never ship a real person's or company's data.

1. Run this fork with a real One Connect grant (sign in, connect the
   platform the fixture covers).
2. Pull a small, representative sample through `oneConnect.runAction`, the
   same call path the agent itself uses.
3. Scrub every name, email, and identifying detail to the Acme Inc
   convention (`*@acme-inc.example`, "Acme Inc", no real company or person
   named, even a friendly one).
4. Write the scrubbed sample into `fixtures/`, matching the existing
   file's shape so `src/hello-agent.ts` (or whichever agent reads it)
   needs no change.
5. Run `npm start` and confirm the demo still exits 0 and the receipt line
   still reads as expected.

Never commit a fixture that has not been scrubbed, and never widen the
grant used to record beyond what `connect.manifest.json` already lists.
