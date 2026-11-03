# Builder

Fork Builder and run an app builder of your own. You describe an app, the coding agent already on your computer (Claude Code or Codex) writes it in a real git repo, and you watch it run in a live preview. One dialog publishes it.

Every app it makes comes with its integrations and Sign in with One. People sign in with One and connect their own Gmail, Slack, Stripe and the rest, with no provider keys in the code.

Secured by One. Each person connects their own accounts and can revoke them at any time.

There are no credits. Your agent's own plan pays for the turns.

## Quickstart

Fork it with Forkable:

```
npm create forkable@latest builder
```

Or clone it:

```
git clone https://github.com/withoneai/forkable-builder builder && cd builder
pnpm install
```

You'll need macOS or Linux, Node 22 or later and pnpm 10 (`corepack enable`). Postgres comes with it. The demo needs nothing else. The real editor needs Claude Code or Codex, installed and signed in.

### Try it with no keys

```
pnpm start
```

This replays a recorded session on the real engine, offline: a task list for Acme Inc, a type error and its fix, a restore, a Gmail action added from One's catalog, a call the grant refuses and a stub publish. It takes under a minute and exits 0.

### Open the editor

```
pnpm serve
```

This builds the editor and serves it on http://127.0.0.1:51989. Type what you want on Home and press Start building. The first run sets up its own Postgres and installs the app template once, about a minute. After that a new project is ready in a few seconds, and a first version usually lands in one to two minutes.

`pnpm run doctor` says what it found: Node, your agents, the One CLI, ports and each project's One Connect state.

The One CLI (`npm install -g @withone/cli`, then `one init`) is optional. Builder uses it to read One's catalog for apps that reach other tools, and to publish.

## Sign in with One in your apps

Builder has no Connect app of its own. Each project turns on its own, and it stays off until you want it.

Until then the preview signs you in as a local "You (preview)" user, so the app works from the first prompt. Calls to other tools stay off, and a published app has no preview user. To turn it on:

1. Create a Connect app at https://app.withone.ai and add the redirect URI `http://127.0.0.1:51990/api/one/callback`. It's the same one for every project.
2. In the project, open Settings, then One Connect, and paste the client id, secret and Connect key. They're write-only, stored in your macOS Keychain (anywhere else, a 0600 file under `~/.builder`), and never written to the project.
3. Sign in on the preview. Calls in preview run on your own grant.

A project's ask comes from its code. Builder reads every action the app calls and writes the list to `.builder/scopes.json`, so the app asks for those actions and nothing else.

## What it does

- A real repo for every app, with a checkpoint on each turn, and restore that never rewrites history.
- A live preview that reports its own build, type and runtime errors. The agent fixes them in up to three turns.
- Visual edits: change text, leave a comment or adjust styles in the preview, then apply.
- Plan mode, image attachments and steering a turn while it runs.
- Publish in one dialog: typecheck, build, a secret scan, the manifest check and `pnpm audit`, then a private GitHub repo or a Vercel deploy on your own One account.
- Public pages on the owner's grant, allowed per action, off by default. The agent asks and you decide.

## Ports and data

| Thing | Value |
| --- | --- |
| Editor and API | http://127.0.0.1:51989 |
| Previews | `http://<project>.localhost:51990/` |
| Editor in `pnpm dev` | http://127.0.0.1:5380 |
| Project dev servers | 52000 to 52999 |
| Embedded Postgres | first free from 51995 |
| Landing page in `site/` | 5790 |
| Your projects, database, caches | `~/.builder` (`BUILDER_HOME` overrides) |

## Development

```
pnpm dev            # server with reload, editor on Vite
pnpm typecheck
pnpm test
pnpm exec tsx scripts/smoke-ui.ts --no-shots
pnpm exec tsx server/scripts/smoke-one.ts
```

`docs/CONTRACT.md` is the contract between the packages. `docs/RENAME.md` lists what to change when you give your fork its own name.

## Layout

```
packages/harness   find and drive the coding agents
packages/template  the app every project starts from
packages/core      database, workspace, turns, checkpoints, catalog, publish
server             Hono API, preview proxy, injected preview client
ui                 the editor, Vite + React
cli                start, demo, doctor
fixtures/          recorded turns and catalog entries for the keyless demo
agents/            the coding agent's job and limits
gtm/               draft-only go-to-market skills
local/profile.md   who this fork is for, and where
site/              the landing page (static, its own install)
```

## License

MIT. `LICENSES/` holds the notice for code carried over from an earlier MIT project.
