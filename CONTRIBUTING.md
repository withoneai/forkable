# Contributing to Forkable

Forkable is a gallery of open-source businesses you can fork. Every one
starts from the same base, [`starter/`](./starter), which already has
sign-in, user consent and per-user integrations wired through
[One Connect](https://withone.ai). You build the business. The plumbing
is done.

There are four ways to help:

- **Publish a template.** A business someone can fork with
  `npm create forkable@latest <your-template>`. This is the big one.
- **Improve the starter.** Fixes and small, general additions to
  `starter/` reach every future fork.
- **Improve `create-forkable`.** The CLI in `create-forkable/`.
- **Report a problem.** Open an issue with what you ran and what you saw.

The short version of this guide also lives at
[forkable.dev/contribute](https://forkable.dev/contribute).

## 1. Give your coding agent the integrations

Templates call third-party tools (Gmail, Slack, Stripe, HubSpot and the
rest of One's catalog) through One. Your coding agent needs One too: the
CLI or the MCP server connects it to One's knowledge base of thousands of
integrations, so it can look up the exact action, its parameters and its
docs while it writes the code. Pick one of these.

**The One CLI**, installed globally (works with any agent that can run a
shell):

```bash
npm install -g @withone/cli
one init
```

`one init` signs you in in the browser and installs the One skill into
the agents you pick (Claude Code, Claude Desktop and Codex by default;
Cursor, Windsurf, Kiro, Goose, Amp, OpenCode and Roo on request). Then
tell your agent:

```text
Please run "one onboard"
```

**Or the remote MCP server** at `https://mcp.withone.ai/mcp`, if you would
rather not install anything:

```bash
# Claude Code
claude mcp add --transport http one https://mcp.withone.ai/mcp
```

```toml
# Codex: add to ~/.codex/config.toml, then run `codex mcp login one`
[mcp_servers.one]
url = "https://mcp.withone.ai/mcp"
```

```json
// Cursor (~/.cursor/mcp.json) and other config-file clients
{
  "mcpServers": {
    "one": { "type": "http", "url": "https://mcp.withone.ai/mcp" }
  }
}
```

On first connect a browser opens so you can sign in to One and choose
what the agent can reach. If the agent should only read docs and write
code, never call a live API, turn on **Knowledge only mode** on that
screen. Guides for every client:
[withone.ai/docs/mcp](https://withone.ai/docs/mcp) and
[withone.ai/docs/cli](https://withone.ai/docs/cli).

## 2. Start from the starter

```bash
npm create forkable@latest my-business --for "dental clinics" --in "Madrid"
cd my-business
```

That copies the starter, fills in `local/profile.md`, makes a fresh git
history, installs and runs the keyless demo. What you get already done:

| Already done | Where |
| --- | --- |
| Sign in with One: `/api/one/authorize` and `/api/one/callback`, PKCE, state and the code exchange | `src/connect.ts`, `src/server.ts` |
| Per-user grants: every call runs on the signed-in user's own Connect grant, never a shared key | `oneConnect.runAction(...)` in `src/connect.ts` |
| The consent ask: each action, its access level and the line the user reads at consent | `connect.manifest.json` |
| A keyless demo on Acme Inc sample data that exits 0, with no account and no keys | `src/demo.ts`, `fixtures/acme.json` |
| The receipt: one action shown declined, `Gmail · delete-message   declined, 403` | `src/hello-agent.ts` |
| A runtime agent to copy, with its job, its trigger and its allowed actions | `agents/hello.md` |
| Instructions for your coding agent, plus build skills | `AGENTS.md`, `.claude/skills/` |
| A draft-only go-to-market kit | `gtm/` |

Open the folder in your agent and describe the business. It reads
`AGENTS.md` first. To add a tool, it follows
`.claude/skills/add-integration/SKILL.md`:

1. `one --agent actions find <platform> "<intent>"` to find the action.
2. `one --agent actions load <actionId>` for the parts of the docs it needs.
3. Add the action to `connect.manifest.json` with the narrowest access
   that does the job and a one-line reason written for the end user.
4. Call it through `oneConnect.runAction(...)`, never a hand-built request.
5. Update the matching `agents/<name>.md`.

To run it with real sign-in, make a Connect app in the
[One dashboard](https://app.withone.ai) (Developers, Connect, New app)
and set `ONE_CLIENT_ID`, `ONE_CLIENT_SECRET`, `ONE_CONNECT_KEY` and
`ONE_REDIRECT_URI` in your environment. Then `npm run dev`. Never commit
those values.

## 3. What a template must have

A maintainer checks every item before a template ships in
`create-forkable`. `forkable check` will automate this; until it ships,
run the commands below yourself.

- [ ] `npm start` (or `pnpm start` for a pnpm workspace) runs the keyless
      demo with no `.env` and no account, and exits 0.
- [ ] `npm run typecheck` passes.
- [ ] `connect.manifest.json` lists every `runAction` call in the code,
      each with `access` and a `reason`, and nothing the code doesn't call.
- [ ] Access is the narrowest that works. Read only unless the job writes.
- [ ] The demo still ends on a declined action and its 403 receipt.
- [ ] No secrets anywhere: no `.env`, no keys, no tokens, no connection
      keys, in code, fixtures, docs or git history.
- [ ] Sample data is Acme Inc only. No real company, customer or person.
- [ ] `AGENTS.md`, `agents/*.md`, `gtm/positioning.md`, `local/profile.md`
      and `forkable.json` are there and describe this business.
- [ ] `forkable.json` names what it was forked from (`forkedFrom`), so the
      gallery can show the lineage.
- [ ] MIT licensed, with a `LICENSE` file.

## 4. Send it

1. Fork [withoneai/forkable](https://github.com/withoneai/forkable) and
   make a branch.
2. Copy your template into `create-forkable/templates/<id>/`. Use a short,
   lowercase id; it is what people type after `npm create forkable@latest`.
   Leave out `node_modules`, `dist`, lockfiles you didn't mean to ship and
   any `.env`.
3. Check that it forks cleanly from your branch:

   ```bash
   cd /tmp
   node <path-to-your-clone>/create-forkable/bin/create-forkable.mjs try-it --template <id>
   ```

4. Open a pull request. The template fills in the checklist above, plus
   who the business is for, which platforms it connects and a screenshot.

Small fixes to `starter/` or `create-forkable/` don't need the template
checklist. Describe what changed and how you checked it.

## Tiers

- **Official**: built by the One team.
- **Verified**: passed the checklist and a human review of its scopes and
  its receipt.
- **Community**: passed the checklist.

## Ground rules

- Never commit a secret. If a value has to be set, read it from the
  environment and document its name.
- Ask for the least access the job needs. Users can narrow what you ask
  for, never widen it.
- Keep the receipt. It is how people see that the grant is enforced.
- Be kind in reviews and issues.

By contributing you agree your work is released under the MIT license.
