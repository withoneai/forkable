# Contribute to Forkable, build the business, skip the plumbing

Every template starts from one starter with sign-in, user consent and integrations already wired. Build a business on it, then publish it for anyone to fork.

```
npm create forkable@latest my-business
```

Contributing guide: https://github.com/withoneai/forkable/blob/main/CONTRIBUTING.md

## Auth comes done

`npm create forkable@latest` copies the starter, installs it and runs the demo. Here is what is already handled before you write a line.

- **Sign in with One** (`src/connect.ts`). The authorize and callback routes, PKCE, state and the code exchange.
- **Each user's own grant** (`runAction`). Every call runs on the signed-in user's Connect grant. No shared admin key.
- **The consent ask** (`connect.manifest.json`). Each action, its access level and the line your user reads before they agree.
- **A demo with no keys** (`npm start`). Runs on the Acme Inc sample with no account and exits 0.
- **Grant enforcement** (403). A call outside the user's grant is refused with a 403 before the provider sees it.
- **Notes for your agent** (`AGENTS.md`). Build skills, a runtime agent to copy and a go-to-market kit.

Try it now, with no account and no keys. It installs and runs the demo on the Acme Inc sample.

```
npm create forkable@latest my-business -- --for "dental clinics" --in "Madrid"
```

Go live with real sign-in. Make one Connect app in the One dashboard (Developers, Connect, New app). Set its values in your environment, then run `npm run dev`. Never commit them.

```
ONE_CLIENT_ID
ONE_CLIENT_SECRET
ONE_CONNECT_KEY
ONE_REDIRECT_URI
```

## Give your agent every integration

Install the One CLI globally, or add One's MCP server if you'd rather not install anything. Either one connects your coding agent to One's knowledge base of integrations, so it writes each one correctly the first time.

**One CLI.** Install it once, globally. `one init` signs you in and installs the One skill into Claude Code, Claude Desktop and Codex, or Cursor, Windsurf, Kiro and others if you pick them. Works with any agent that can run a shell.

```
npm install -g @withone/cli
one init
# then tell your agent: Please run "one onboard"
```

**MCP, Claude Code.** Adds One's hosted MCP server. A browser opens so you can sign in and choose what Claude Code can reach.

```
claude mcp add --transport http one https://mcp.withone.ai/mcp
```

**MCP, Codex.** Add the server to `~/.codex/config.toml`, then run `codex mcp login one`.

```
[mcp_servers.one]
url = "https://mcp.withone.ai/mcp"
```

**MCP, Cursor and others.** Any MCP client that takes a config file. In Cursor that is `~/.cursor/mcp.json`.

```
{
  "mcpServers": {
    "one": {
      "type": "http",
      "url": "https://mcp.withone.ai/mcp"
    }
  }
}
```

Only want docs and code, never a live call? Turn on Knowledge only mode on the sign-in screen. Docs: https://withone.ai/docs/cli and https://withone.ai/docs/mcp.

How your agent adds a tool, following the starter's add-integration skill:

1. `one actions find <platform> "<intent>"` finds the exact action, with its docs.
2. `one actions load <actionId>` reads any part of the docs it still needs.
3. `connect.manifest.json` gets the action with the narrowest access and a reason your user reads.
4. `oneConnect.runAction(...)` calls it on the user's grant. Never a hand-built request.

## Send it as a template

Templates ship in `create-forkable`, so anyone can fork yours by name. A maintainer reviews each pull request against the same checklist.

1. **Fork the repo.** withoneai/forkable on GitHub, on a new branch.
2. **Add your template.** Copy it into `create-forkable/templates/<id>`. The id is what people type.
3. **Fork it once.** Run the CLI from your clone and check the copy works on its own.
4. **Open a pull request.** The PR template has the checklist. Add who it is for, its tools and a screenshot.

The checklist. `forkable check` will run this for you. Until it ships, run it by hand.

- `npm start` runs the demo with no .env and exits 0
- `npm run typecheck` passes
- The manifest matches every runAction call, each with access and a reason
- Access is the narrowest that does the job
- No secrets, keys or .env anywhere, git history included
- Sample data is Acme Inc only
- AGENTS.md, agents/, gtm/positioning.md and forkable.json describe this business
- MIT, with a LICENSE file

Check the fork from your clone:

```
cd /tmp
node ~/forkable/create-forkable/bin/create-forkable.mjs try-it --template <id>
```

Not sure yet? Open a Template idea issue first: https://github.com/withoneai/forkable/issues/new?template=template-idea.md. Say what it does, who it is for and what it never does.

## Other ways to help

- **Improve the starter.** Fixes and small, general additions in starter/ reach every future fork. https://github.com/withoneai/forkable/tree/main/starter
- **Improve the CLI.** create-forkable copies, fills in, installs and runs. Make it better at that. https://github.com/withoneai/forkable/tree/main/create-forkable
- **Report a problem.** Say what you ran and what you saw. Remove any keys from the output first. https://github.com/withoneai/forkable/issues/new?template=bug.md
