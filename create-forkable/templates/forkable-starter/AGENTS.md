# forkable-starter

## What this is
The base every Forkable business starts from. `npm create forkable` copies
this (or a template built on it) into a new project, fills in
`local/profile.md` from `--for`/`--in`, installs, and runs the keyless
demo. Nothing here is a real business; it is the smallest thing that is
true of every one: One Connect wired up, one agent, one manifest, a
sample that exits 0.

## Status
Pulled from Orez (`orez/`), not yet rebased onto it. What is here:
`src/` (a Hono server with One Connect's node adapter wired at
`/api/one/authorize` and `/api/one/callback`, a `/api/hello` route, and
`src/demo.ts`, the keyless entry point), `agents/hello.md` (the one
runtime agent), `connect.manifest.json`, `fixtures/acme.json`,
`gtm/` (positioning plus seven draft-only skills), `.claude/skills/`
(five build skills), `local/profile.md`. `npm start` runs the demo and
exits 0 with no `.env` and no account.

Not yet ported from Orez, per the "Kept" list in the Forkable strategy
(page 8cfcde60): the second-device merge by `cu_…`/email, the Access
screen (scopes, agents, Activity, Disconnect, Manage in One), Settings,
Cmd+K, light/dark, the design ladder, the scheduler tick, the Workers
skeleton, the fixed callback port convention. Add these when a template
actually needs them rather than guessing ahead of demand.

## Rules
- **No secrets in `.env`, ever.** `ONE_CLIENT_SECRET` and `ONE_CONNECT_KEY`
  are read from the environment (see `src/env.ts`); they are never
  committed, logged, or pasted into a prompt. If a founder needs to set
  one, build a guided write-only setup step rather than asking them to
  hand-edit `.env` or paste a value into chat.
- **Acme Inc only.** `fixtures/` and anything the keyless demo prints uses
  the Acme Inc sample. Never swap in a real company, a prospect, or a
  recognizable person, even as a placeholder.
- **The receipt stays.** The keyless demo always ends on a declined
  action (`Gmail · delete-message   declined, 403` by default). That
  receipt is the proof Connect enforces the grant; do not remove it or
  make every action in the manifest succeed.
- **The manifest is the source of truth for what this fork asks for.**
  `connect.manifest.json` must list every `runAction` call in the code,
  with the access level and the one-line reason shown at consent. Adding
  a call without adding it to the manifest is a bug; see the
  `add-integration` skill.
- **MIT.** This starter and every official template ship MIT. A fork can
  go closed-source on its own changes once it has diverged; the starter
  itself stays MIT so `forkable upgrade` can keep merging it into every
  fork.
- **Public repo push gate.** Never `git push`, `npm publish`, `gh pr
  create`, or deploy from this fork without the founder's direct approval
  in the current conversation. Build and verify locally, then ask.

## How to add things
- **A new integration or action:** `.claude/skills/add-integration/SKILL.md`.
- **A new runtime agent:** `.claude/skills/add-agent/SKILL.md`. Write
  `agents/<name>.md` before writing its code.
- **Renaming this fork into a real business:** `.claude/skills/rename/SKILL.md`.
- **Deploying:** `.claude/skills/deploy/SKILL.md`. Only when the founder
  asks, in this conversation, for this specific deploy.
- **Refreshing sample data:** `.claude/skills/record-fixtures/SKILL.md`.
  Scrub to Acme Inc before committing; never ship a real user's data.
- **Go-to-market:** `gtm/skills/`. Start with `positioning.md`; every
  other GTM skill reads `gtm/positioning.md` first. All of them write
  drafts to `gtm/out/` and never post, send, or publish on their own.

## Architecture
- `src/env.ts` — reads `ONE_CLIENT_ID`/`ONE_CLIENT_SECRET`/`ONE_CONNECT_KEY`/
  `ONE_REDIRECT_URI`/`ONE_PERMISSION_SET` from the environment. All
  optional: unset, the app runs in keyless mode.
- `src/connect.ts` — `createOneConnectClient` (the `@withone/connect/server`
  client, `null` when unconfigured) and `createOneConnectRouteHandlers`
  (the node adapter's `authorize`/`callback` handlers).
  `userStore` is an in-memory map; swap it for a column on this fork's own
  user table once it has a database.
- `src/hello-agent.ts` — the hello agent's logic: load the fixture, return
  its messages and the declined-delete receipt. Pure, so the keyless demo
  and the real server route call the same code.
- `src/server.ts` / `src/node.ts` — the Hono app and its Node entry point
  (`npm run dev`). Mounts the One Connect routes only when configured.
- `src/demo.ts` — the keyless demo (`npm start`): no server, no database,
  no account. This is the 60-second "it works" moment `npm create
  forkable` promises.

## What's deliberately not here
No database. No embedded Postgres. No UI framework. Orez needed those for
a real email client; this starter does not assume any business needs
them. Add a database, a frontend, or a scheduler when a specific fork's
job actually requires one, following the pattern in `src/connect.ts` (an
interface a fork can point at whatever storage it ends up using) rather
than baking in Orez's stack by default.
