---
name: add-integration
description: Add a new One Connect action (a new platform, or a new action on one already used) to this fork. Use whenever the founder asks to connect a new tool or call a new action on one already connected.
---

# add-integration

1. Find the action: `one --agent actions find <platform> "<intent>" --task "<the job, in general terms>"`.
2. Read its docs with `one --agent actions load <actionId>` for anything the digest left out.
3. Add it to `connect.manifest.json`: `platform`, `actionId`, `access` (`read` or `write`), `usedBy` (the `agents/<name>.md` file that calls it), and `reason` (the one line shown at consent — write it for the end user, not for a developer).
4. Call it from the agent file's code, through `oneConnect.runAction(...)` (see `src/connect.ts`), never with a hand-built request.
5. Update the matching `agents/<name>.md` file's action list.
6. Run `forkable check` (or, until that ships, `npm run typecheck` and `npm start`) to confirm the manifest still matches the code.

Never add an action the manifest does not list, and never widen `access`
beyond what the agent's job actually needs.
