# Rill

## What this is
An AI email client on your own Gmail or Outlook. Your goals and VIP list
decide what you see first; Jev judges every message; an LLM writes, never
sends. Built as a Forkable business: One Connect wired up, a manifest of
every action it asks for, one runtime agent, a keyless Acme Inc demo that
exits 0. Unlike `forkable-starter`, Rill already has a real stack
underneath (a pnpm workspace, embedded Postgres, a Vite + React UI) rather
than the starter's single flat package; see "What's here that the starter
doesn't have" below for why the two shapes differ on purpose.

## Status
A real, working product (`pnpm start`, `pnpm dev`, three smoke suites all
green; see `docs/CONTRACT.md` for the full build contract and what each
package owns). The Forkable contract files were added after the fact
(`connect.manifest.json`, this file, `agents/rill.md`, `local/profile.md`,
`forkable.json`), so Rill can be registered as a `create-forkable`
template and extended the same way `forkable-starter` is. Not yet done:
`gtm/` (the starter's seven draft-only go-to-market skills), and Rill is
not yet copied into `create-forkable`'s `templates/` directory, so
`npm create forkable rill` does not produce this app yet. Both are
tracked as follow-up work, not guessed at here.

## Rules
- **No secrets in `.env`, ever.** `ONE_CLIENT_SECRET` and `ONE_CONNECT_KEY`
  are read from the environment (`server/src/config.ts`); never
  committed, logged, or pasted into a prompt. Every platform call,
  Jev and the LLMs included, runs on the signed-in user's Connect grant,
  never a key.
- **Acme Inc only.** `fixtures/` and the keyless demo use the Acme Inc
  sample. Never swap in a real company, a prospect, or a recognizable
  person, even as a placeholder.
- **Delete stays outside the grant.** Rill never asks for delete on mail
  or calendar. The keyless demo also prints the declined lines
  (`Gmail · delete   declined, 403`, `Google Calendar · delete   declined,
  403`) as an optional check that a call outside the grant is refused.
  They are a developer detail, not the point of the demo; the demo should
  show the inbox working.
- **The manifest is the source of truth for what this fork asks for.**
  `connect.manifest.json` must list every `one.call`/`one.attempt` call in
  `packages/core/src`, with the access level and the one-line reason shown
  at consent. Adding a call without adding it to the manifest is a bug.
- **MIT.** Rill ships MIT, like every official Forkable template, so a
  fork can go closed-source on its own changes once it has diverged while
  Rill itself stays mergeable.
- **Public repo push gate.** Never `git push`, `npm publish`,
  `gh pr create`, or deploy from this fork without the founder's direct
  approval in the current conversation. Build and verify locally, then
  ask.

## How to add things
- **A new integration or action:** add it to the right provider under
  `packages/core/src/providers/<platform>/`, following the pattern the
  existing Gmail and Outlook providers use (one `one.call`/`one.attempt`
  per action, real catalog ids from `one --agent actions find/load`), then
  add it to `connect.manifest.json`.
- **A new runtime agent:** write `agents/<name>.md` first (job, trigger,
  model if any, allowed actions, the "may never" line), matching
  `agents/rill.md`.
- **Go-to-market:** not built yet for this fork. Follow `gtm/skills/` in
  `forkable-starter` as the pattern once that lands here.

## Architecture
See `docs/CONTRACT.md` for the full package-by-package build contract
(shape, every file's job, the HTTP routes, the UI keyboard map). In short:
`packages/core` (schema, provider registry, Jev, policy, writer engines,
ledger), `server` (Hono on Node locally, a Cloudflare Worker skeleton
hosted), `ui` (Vite + React), `cli` (`npx @withone/rill`).

## What's here that the starter doesn't have
`forkable-starter` deliberately ships no database, no UI framework and no
scheduler, because most forks of it will not need them on day one. Rill
needed all three for a real email client: embedded Postgres (local) or
Hyperdrive/Neon (hosted), Drizzle, a scheduler tick every 2 minutes, and a
full UI. A fork of Rill that needs less should still be able to start from the
starter's smaller shape; a fork that needs more than the starter offers
should look at how Rill solved it before reaching for a new pattern.
