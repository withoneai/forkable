# Builder

## What this is
An app builder you can fork and run. A person types what they want, the
coding agent already on their computer (Claude Code or Codex, OpenClaw as a
preview) writes a real app in a real git repo, and a live preview updates
as it works. Every generated app comes with its integrations and Sign in
with One. A Forkable business: `agents/builder.md` describes the agent's
job, `pnpm start` is a keyless Acme Inc demo that exits 0. MIT.

`docs/CONTRACT.md` is the interface between `packages/harness`,
`packages/core`, `packages/template`, `server`, `ui` and `cli`. Read it
before changing structure. Where it and the code disagree on a field name,
the code wins.

## Status
Working: `pnpm start`, the editor (`pnpm serve`), real turns on Claude Code
and Codex, visual edits, Plan mode, checkpoints and restore, per-project
One Connect, the catalog through the One CLI, the publish dialog.
Not verified live: a real GitHub export and Vercel deploy, and real calls
on a real grant through a project's Connect app. Those paths run on the
stub grant in the tests and the demo.

## Rules
- **No Builder-level Connect app.** Builder knows One through the local One
  CLI (catalog, publish). Each project optionally turns on its own One
  Connect in its Settings. Never add a Connect step to Builder itself, and
  never add `ONE_SECRET` or connection keys to it.
- **No secrets in `.env`, in a project or in chat.** Connect values and app
  values go through the write-only setup UI into the macOS Keychain, or a
  0600 file under `~/.builder`. Never log one and never pass one to a
  harness. If a product change needs an env var, build the guided UI for it
  (see `docs/CONTRACT.md` section 16).
- **The agent writes code and Builder runs everything else.** Installs, dev
  servers, migrations, checkpoints and platform calls stay out of the
  agent's hands. `DENY_LIST` in `packages/harness/src/permissions.ts` holds
  at every permission level, `full` included.
- **The product name lives in `packages/core/src/brand.ts`.** Everything
  else derives from it. `docs/RENAME.md` lists what cannot.
- **Template files that would act inside this workspace stay renamed**
  (`_AGENTS.md`, `_CLAUDE.md`, `_claude/`, `_agents/`, `_gitignore`,
  `_project_dir_/`). `packages/template/render.ts` gives them their real
  names. House rules for generated apps are `packages/template/_AGENTS.md`.
- **Acme Inc only.** Samples, fixtures and tests use Acme Inc. Never a real
  company, customer, prospect or recognizable person, even as a placeholder.
- **MIT.** Keep `LICENSES/harness-MIT.txt` and the file headers that point
  to it.
- **Public repo push gate.** Never `git push`, `npm publish`,
  `gh pr create` or deploy without the owner's direct approval in the
  current conversation. Build and verify locally, then ask.
- **Copy.** No em or en dashes, no exclamation marks, none of seamless,
  frictionless, cutting-edge, revolutionary, AI-powered, leverage (as a
  verb). Lead with forking a working business, then the integrations and
  Sign in with One, then one short "Secured by One" line. Never type a
  platform count; fetch it (`site/scripts/platform-count.mjs` does).
- **UI.** Type and spacing come from the `@theme` ladder in
  `ui/src/index.css`, never `text-[Npx]`. Dropdowns use
  `ui/src/components/ui/Select.tsx`, never a native `<select>`.

## How to add things
- **A coding agent:** an adapter in `packages/harness/src/adapters/`, a
  parser in `packages/harness/src/parsers/`, and recorded output in
  `fixtures/harness/`.
- **A change to what every app starts with:** edit `packages/template`.
  `TEMPLATE_VERSION` is a content hash, so the warm cache rebuilds itself.
- **A schema change:** edit `packages/core/src/db/schema.ts`, run
  `pnpm db:generate`, commit the new migration.
- **A new runtime agent:** write `agents/<name>.md` first (job, trigger,
  model, allowed actions, the "may never" list).
- **Go-to-market:** `gtm/skills/`, starting with `positioning.md`. Every
  skill writes drafts to `gtm/out/` (git-ignored) and never posts, sends
  or deploys.

## Architecture
```
packages/harness   resolver, executor, parsers, adapters (claude-code, codex,
                   openclaw, replay), env, permission flags, model catalogs
packages/template  the generated app, render.ts, warm.ts, TEMPLATE_VERSION
packages/core      domain logic, no HTTP: DB, workspace, git, turns, auto-fix,
                   errors, dev servers, verifier, shims, catalog, publish
server             Hono API, SSE hub, preview proxy, injected preview client
ui                 Vite + React editor
cli                `builder start|demo|doctor`
fixtures/          replay scenarios, catalog entries, the stub grant
site               the landing page (static, outside the workspace, install
                   with `pnpm install --ignore-workspace`)
```

## Ports and data
| Thing | Value |
|---|---|
| Server | 51989 (`BUILDER_SERVER_PORT` for scratch runs only) |
| Preview proxy | 51990 (`BUILDER_PROXY_PORT`; pinned, the shared Connect callback lives here) |
| UI (Vite dev) | 5380 |
| Project dev servers | 52000 to 52999 |
| Embedded Postgres | first free from 51995 |
| Landing site | 5790 |
| Data dir | `~/.builder` (`BUILDER_HOME`) |

## Checks before a commit
`pnpm typecheck`, `pnpm test`, `pnpm start` (exits 0). UI and server
changes: `pnpm exec tsx scripts/smoke-ui.ts --no-shots`, plus the smokes in
`server/scripts/`. `scripts/smoke-harness.ts` spends a real turn on an
installed agent.
