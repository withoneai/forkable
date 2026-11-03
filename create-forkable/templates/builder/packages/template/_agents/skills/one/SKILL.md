---
name: one
description: What One offers this app and its builder - the actions catalog, One Connect (this app's Sign in with One), flows, relay webhooks, sync and memory - and when to use each. Read before planning any feature that touches another tool.
---

# One in this project

One connects AI products to the tools people already use, through scoped,
revocable grants. The builder has One through the One CLI on their computer;
this app has its own Connect app (One Connect, in the project's Settings).

## What you use while building

- `one_find_actions <platform> "<what it does>"`: real action ids from One's
  catalog, best first, with the top pick's docs.
- `one_load_action <actionId> [section]`: an action's full docs.
- `one_add_action <actionId>`: the typed wrapper in `server/one/actions.gen.ts`.
- `one_scope_preview`: what the app asks people to grant.
- `one_granted`: whether One Connect is on for this app.

Calls run in the app with `one(c).run(...)`, on the signed-in person's grant
(see the one-connect skill). Nothing you run executes an action: `one`
commands, `curl` and `npx @withone/*` are refused during builds.

## What the builder runs (never you)

| Offering | What it is | Use it when |
|---|---|---|
| Connect | Sign in with One for this app, a grant per person | Anything a signed-in person does in their own tools |
| Flows | Multi-step automations in `.one/flows/<key>/flow.json`, `one flow execute` | A job for the builder (a weekly report), not a feature for users |
| Relay | Platform webhooks that run actions on arrival, `one relay create` | Something must happen on an event while nobody has the app open |
| Sync | Platform records copied locally, `one sync` | The builder's own analysis, not app data |
| Memory | The builder's notes and records, `one mem` | Never app storage; the app has its own database |

When a request fits one of the builder-run offerings, build what belongs in
the app, then say in your reply what the builder would run and why. You may
write a flow file when asked. Never ask for a key or a Connect value in chat.
