---
name: add-agent
description: Add a new runtime agent to this fork (a new job the product does on a schedule, a webhook, or a user action). Use whenever the founder describes a new thing the product should do on its own.
---

# add-agent

1. Write `agents/<name>.md` first, before any code: job, trigger (schedule,
   webhook, user action), the model or Jev judgment it uses (or "none"),
   the actions it may call, and what it may never do. Follow
   `agents/hello.md`'s shape.
2. List every action the agent needs in `connect.manifest.json`
   (`usedBy: agents/<name>.md`).
3. Implement it as its own module under `src/`, built the same way
   `src/hello-agent.ts` is: pure where possible, taking the grant and
   fixture/data as arguments rather than reaching for globals.
4. Wire its trigger: a route for a user action, a scheduler tick for a
   schedule, a route for a webhook. Keep the keyless demo path working: a
   new agent should degrade to fixture data, not crash, when no grant is
   configured.
5. Add it to the keyless demo (`src/demo.ts`) if it has something worth
   showing with no account.

Never let an agent call an action that is not in its own `agents/<name>.md`
list, even if the manifest already grants that action to a different
agent.
