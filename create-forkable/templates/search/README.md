# Search

Fork Search and run a search business of your own. One search box over your CRM, mail, calendars, docs, issues, chat and meeting notes, with an AI that answers from what it finds and links each claim to the result it came from.

It comes with its integrations and Sign in with One. HubSpot, Attio, Gmail, Outlook Mail, Google Calendar, Outlook Calendar, Notion, Linear, Slack, Teams and Granola are built in. For any other tool One connects to, you add a JSON profile.

Secured by One. Each person connects their own accounts and can revoke them at any time.

## What it does

- Postgres full text plus pgvector, fused and reranked. When pgvector is missing it falls back to keyword search.
- Type it the way you would say it. "emails from Priya last week", "open deals" or "meetings with Lena this month" turn into filters you can see and remove with one click. When in doubt Search asks instead of guessing: a name two people share, a last name on its own, a word that is also a tool ("notes on linear algebra"), "not from Priya". "Search the exact words instead" is always one click away, and every chip works from the keyboard.
- Typed filters for exact control, such as `from:priya after:30d type:mail`, `with:globex.com`, `lane:needs-you`, `amount:>=50000`. They always win over a sentence, and the Cheatsheet (`?`) lists them. The filter chips and the search box stay in sync.
- While your tools come in for the first time, home shows each one with a bar, and you can search right away.
- Priya in HubSpot, Gmail, Slack and a Granola note is one person with one page.
- Lanes: VIP, Needs you, Waiting, FYI and Low. Jev picks one for every item.
- An AI dock that answers only from results it can cite, and suggests follow-up queries as chips.
- A web app, a CLI, a REST API and an MCP server, all signed in with One.

## Quickstart

Fork it with Forkable:

```
npm create forkable@latest search
```

Or clone it:

```
git clone https://github.com/withoneai/forkable-search my-search && cd my-search
pnpm install
```

You'll need Node 22.12 or later and pnpm 10. Nothing else to install: Postgres and pgvector come with it.

### Try it with no keys

```
pnpm start
```

This indexes the Acme Inc sample across 11 tools, runs a few searches, asks one question and prints the answer with its citations, then exits 0. It works in a scratch schema that gets dropped on exit.

```
pnpm dev
```

Then open http://localhost:5680 and click **Try the Acme sample**. You get the full app on the same sample, no account needed.

### Connect your own tools

```
pnpm connect
```

`pnpm connect` creates your Connect app from `one.connect.ts` (needs the One CLI: `npm install -g @withone/cli`, then `one init`). You approve it in the browser, and the CLI writes its ids to `.env`. The app asks for everything: each person sees every tool they have connected in One, picks what Search may use and can narrow it, so adding a source never means updating the app. Search itself only reads.

The approval page shows a client secret and a Connect key, one time only. With `pnpm dev` running, open http://localhost:5680/setup/connect and paste them there. They go into your macOS Keychain (anywhere else, into `~/.search/connect.env` with mode 0600), and sign-in turns on without a restart. Keep them out of `.env`, git and chat.

Redirect URI: `http://localhost:52289/api/one/callback`. The server stays on 52289 so the redirect never changes.

Sign in with One, connect your tools in the three-step consent, and indexing starts. Embeddings, Jev and the AI run on your grant too, so connect an embeddings provider (OpenAI, Gemini, Cohere or Mistral), TypeSafe and Anthropic in One and grant them to Search. Without an embeddings grant it runs keyword-only and Settings says so. Without TypeSafe, lanes come from rules.

### Update your fork

When a new version of Search ships, take it into your fork with one command, run inside the fork's folder:

```
npm create forkable@latest update
```

Commit your own changes first. The update is a git merge: what only the new version changed comes in, what only you changed stays, and a file you both changed shows up as a normal git conflict to resolve (or undo with `git merge --abort`). `.env`, your data and `local/profile.md` are never touched. Add `--dry-run` to see the changed files first.

After this update, run `pnpm connect` once and approve: the Connect app now asks for everything, so adding a source never needs another app update. Search keeps to your One plan's calls a minute by itself (Settings, General).

## Connect your agent

Open Search, then Agents in the sidebar (the screen is "Use Search in your AI app"; Cmd+K finds it too). Each AI app on your computer
(Claude Code, Codex, Cursor, Claude Desktop) has a Connect button: it adds
Search to the agent's own settings, keeps a backup of the old file, and signs
the agent in, so there is nothing to type (Codex asks you to allow it in a
browser tab). If the agent already has something called search, Search leaves
it alone and adds itself as search-local. From the Search folder, `pnpm run
search install <agent>` does the same. Or paste one sentence into any agent:

```
Set up Search for me with http://localhost:52289/start.md
```

The agent reads the steps, adds Search to itself and checks it with
`list_sources`. Search also serves the usage skill at `/skill.md` (Connect
installs it for Claude Code) and `/llms.txt`. No token ever goes into an
agent's config: the sign-in Connect makes stays in Search's own folder, and an
agent added by hand or with `search install` signs in with Search's OAuth the
first time it starts.

## CLI

Run it from the Search folder (`pnpm search` is npm's own command, so it is
`pnpm run search`):

```
pnpm run search --help
```

```
search                         start the app and open it
search demo                    the keyless Acme demo
search login                   sign in (your browser, Sign in with One)
search "globex renewal"        query, with the same filters as the app
search "emails from priya last week"   plain sentences read as filters (--exact: as typed)
search fetch <itemId>          the full text of one item (--json, --offset, --max-chars)
search ask "Where are we with Globex?"
search sources                 list, sync, pause, resume
search profiles validate ./pack.json
search install cursor          add Search to an agent (same as Connect)
search mcp                     stdio MCP bridge for clients that only run local servers
search mcp-config --client claude-code|codex|cursor|vscode|claude-desktop|json
```

`search login` uses OAuth with PKCE against your own Search server, and the token is stored in `~/.search/cli-token.json` (mode 0600). One sign-in works for the REST API and for `search mcp`; an agent's own sign-in works only on MCP. Every process shares the token file and refreshes under a lock, and an agent's sign-in ends when you sign out or switch accounts in the app. Exit codes: 0 ok, 1 error, 2 usage, 3 not signed in, 4 server not running.

## MCP

Search serves MCP at `http://localhost:52289/mcp`. Five read-only tools: `search` (a query plus filters for source, type, container (a channel, folder or project), from, with, after and before, with pages), `fetch` (long items in parts), `get_entity`, `list_sources` and `ask`. `search` runs the query as written; pass `understand: true` with a person's own words to have them read as filters, and the answer says what was read.

To add it by hand instead of from the Agents page:

```
claude mcp add --scope user --transport http search http://localhost:52289/mcp
```

In Claude Code, run `/mcp`, pick search and choose Authenticate. Your browser opens Search's sign-in. Claude Code, Cursor and Claude Desktop added from the Agents page run the stdio bridge through `cli/bin/search-mcp`, which finds Node 22 or newer each time it starts. Windows is not verified. The REST API at `/api/v1` uses the same OAuth server, and Settings, Agents lists every app that signed in and signs any of them out. A token searches the text exactly as sent; add `understand=1` to `/search`, `/search/count` or `/answer` to have sentences read the way the web app reads them.

## Database

Everything lives in Postgres through Drizzle: sources, raw records, items, chunks, vectors, entities, chat and the ledger. Migrations run on every start.

- **Local (default).** Search starts its own embedded Postgres 18 with its data in `~/.search/db` on port 55441 (or the first free port after it). pgvector 0.8.7 ships prebuilt for macOS (universal) and Linux (x64, arm64) in `packages/pgvector`. On any other platform Search runs keyword-only and says so.
- **Your own Postgres.** Set `SEARCH_DATABASE_URL` in `.env`. Search then uses `vector` if the extension is there or can be created, and keyword-only search if not.
- **Supabase.** Use the session pooler or the direct connection (port 5432). The transaction pooler on 6543 gets refused at boot, since Search needs session settings. pgvector is available there; Search creates it in the `extensions` schema and puts that on its search path.

`SEARCH_FORCE_KEYWORD=1` turns semantic search off, which is handy for testing the fallback. Settings, Database shows which database is in use and whether search by meaning is on (hybrid) or off (keyword-only).

| Variable | Default | What it does |
| --- | --- | --- |
| `SEARCH_HOME` | `~/.search` | data directory |
| `SEARCH_PG_PORT` | `55441` | embedded Postgres port |
| `SEARCH_DATABASE_URL` | unset | use this Postgres instead of the embedded one |
| `SEARCH_PORT` | `52289` | server port (the Connect redirect must match) |
| `SEARCH_FORCE_KEYWORD` | unset | `1` skips pgvector |

## Ports

| Port | What |
| --- | --- |
| 5680 | the UI in `pnpm dev` |
| 52289 | the server, REST API, OAuth and MCP |
| 55441 | embedded Postgres |
| 5690 | the landing page in `site/` |

## Add a source

A source is a profile: JSON that says which One action lists the records, how paging and incremental sync work, and how a record becomes a result. A pack is the set of profiles for one platform, in `profiles/<platform>/pack.json`.

- In the app, Settings, Sources, Add a source (the New profile flow in code) proposes a profile for any platform in One's catalog. You check it, and it indexes.
- As a built-in, follow `.claude/skills/add-search-profile/SKILL.md`. A coding agent can run it from start to finish, and the pack ships with fixtures and a test.
- To share one, export it from a source's page or with `search profiles export`. Import a file or an https URL with `search profiles import`.

The format, the strategies and how to contribute are in [docs/profiles.md](docs/profiles.md).

## Layout

```
profiles/          built-in packs, one folder per platform
fixtures/sample/   the Acme Inc world
packages/core      engine, search, entities, Jev, chat, demo
packages/pgvector  pgvector builds for the embedded Postgres
server             Hono: Sign in with One, REST, OAuth, MCP, scheduler
ui                 Vite + React
cli                the search command
agents/            the indexer's and the assistant's job and limits
gtm/               draft-only go-to-market skills
```

Platforms One connects to: https://withone.ai/llms.txt

Free and open source. License: MIT
