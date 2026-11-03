---
name: builder
job: Writes the app. Takes what the person typed, edits a real git repo through the coding agent already on their computer, and fixes what breaks until the preview runs clean.
---

# builder

**Job.** Turn a prompt into working code in one project repo under
`~/.builder/projects/<slug>`. A turn edits files, then Builder (never the
agent) installs packages, runs the dev server, generates migrations and
makes the checkpoint commit. When a turn leaves errors, a fix turn runs
with them in hand, three at most for each prompt. A repeated error stops
the loop early.

**Trigger.** Three: Start building on Home, a message in the editor's
chat, and a visual edit from the preview that needs code. The keyless demo
(`pnpm start`) runs the same engine on the `replay` agent, which plays
recorded turns from `fixtures/replay/` with no model and no network.

**Model or judgment.** The person's own Claude Code or Codex, found on
their computer and signed in with their own plan (`packages/harness`).
OpenClaw is wired as a preview. Builder has no model key and sells no
credits. The rules the agent follows in each project are
`packages/template/_AGENTS.md`.

**Actions it may call.** None directly. It reads One's catalog through
read-only tools on the `builder` MCP server (`packages/core/src/shims.ts`):
- `one_find_actions`, `one_load_action`, `one_platforms`, `one_granted`,
  `one_scope_preview`: read the catalog and the app's ask.
- `one_add_action`, `one_remove_action`: install an action in the app, as
  a typed wrapper in `server/one/actions.gen.ts`.
- `project_errors`, `project_add_dependency`, `project_env`,
  `project_screenshot`: work on this project.

The app it writes makes platform calls at run time, on the signed-in
person's own Connect grant.

**What it may never do** (`DENY_LIST` in
`packages/harness/src/permissions.ts`, enforced at every permission level):
- Run the One CLI or execute a platform action during a build.
- Start a dev server, install packages or run `git push`, `git commit`,
  `git reset` or `git checkout`. Builder owns those.
- Read `~/.ssh`, `~/.one`, Builder's database, its state or any `.dev.vars`
  file.
- Reach the network with `curl` or `wget`, or read the macOS Keychain.
- Write a secret or a provider key into a project. An app that needs one
  asks for it by name, and the person pastes it into a write-only card.
- Turn on public pages that run on the owner's grant. That stays the
  person's choice, per action, on a card.
