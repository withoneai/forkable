# Search

Fork Search and run a search business of your own. One search box over your CRM, mail, calendars, docs, issues, chat and meeting notes, with an AI that answers from what it finds and links each claim to the result it came from.

It comes with its integrations and Sign in with One. HubSpot, Attio, Gmail, Outlook Mail, Google Calendar, Outlook Calendar, Notion, Linear, Slack, Teams and Granola are built in. For any other tool One connects to, you add a JSON profile.

Secured by One. Each person connects their own accounts and can revoke them at any time.

## What it does

- Postgres full text plus pgvector, fused and reranked. When pgvector is missing it falls back to keyword search.
- Operators such as `from:priya after:30d type:mail`, `with:globex.com`, `lane:needs-you`, `amount:>=50000`. The filter chips and the search box stay in sync.
- Priya in HubSpot, Gmail, Slack and a Granola note is one person with one page.
- Lanes: VIP, Needs you, Waiting, FYI and Low. Jev picks one for every item.
- An AI dock that answers only from results it can cite, and suggests follow-up queries as chips.
- A web app, a CLI, a REST API and an MCP server, all signed in with One.

## Quickstart

Fork it with Forkable:

```
npm create forkable@latest my-search -- --template search
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

`pnpm connect` creates your Connect app from `one.connect.ts` (needs the One CLI: `npm install -g @withone/cli`, then `one init`). You approve it in the browser, and the CLI writes its ids to `.env`. The ask comes from `connect.manifest.json`, so the app asks for read access to exactly the actions Search calls.

The approval page shows a client secret and a Connect key, one time only. With `pnpm dev` running, open http://localhost:5680/setup/connect and paste them there. They go into your macOS Keychain (anywhere else, into `~/.search/connect.env` with mode 0600), and sign-in turns on without a restart. Keep them out of `.env`, git and chat.

Redirect URI: `http://localhost:52289/api/one/callback`. The server stays on 52289 so the redirect never changes.

Sign in with One, connect your tools in the three-step consent, and indexing starts. Embeddings, Jev and the AI run on your grant too, so connect an embeddings provider (OpenAI, Gemini, Cohere or Mistral), TypeSafe and Anthropic in One and grant them to Search. Without an embeddings grant it runs keyword-only and Settings says so. Without TypeSafe, lanes come from rules.

## CLI

```
pnpm --filter @withone/search exec search --help
```

```
search                         start the app and open it
search demo                    the keyless Acme demo
search login                   sign in (your browser, Sign in with One)
search "globex renewal"        query, with the same operators as the app
search ask "Where are we with Globex?"
search sources                 list, sync, pause, resume
search profiles validate ./pack.json
search mcp-config --client claude-code
```

`search login` uses OAuth with PKCE against your own Search server, and the token is stored in `~/.search/cli-token.json` (mode 0600). Exit codes: 0 ok, 1 error, 2 usage, 3 not signed in, 4 server not running.

## MCP

Search serves MCP at `http://localhost:52289/mcp`. Five read-only tools: `search`, `fetch`, `get_entity`, `list_sources` and `ask`.

```
claude mcp add --transport http search http://localhost:52289/mcp
```

In Claude Code, run `/mcp`, pick search and choose Authenticate. Your browser opens Search's sign-in. For Codex or Claude Desktop, `search mcp-config --client codex` (or `claude-desktop`) prints the config. The config holds only the URL; the token comes from the sign-in. The REST API at `/api/v1` uses the same OAuth server, and Settings, API lists every client and lets you revoke it.

## Database

Everything lives in Postgres through Drizzle: sources, raw records, items, chunks, vectors, entities, chat and the ledger. Migrations run on every start.

- **Local (default).** Search starts its own embedded Postgres 18 with its data in `~/.search/db` on port 55441 (or the first free port after it). pgvector 0.8.7 ships prebuilt for macOS (universal) and Linux (x64, arm64) in `packages/pgvector`. On any other platform Search runs keyword-only and says so.
- **Your own Postgres.** Set `SEARCH_DATABASE_URL` in `.env`. Search then uses `vector` if the extension is there or can be created, and keyword-only search if not.
- **Supabase.** Use the session pooler or the direct connection (port 5432). The transaction pooler on 6543 gets refused at boot, since Search needs session settings. pgvector is available there; Search creates it in the `extensions` schema and puts that on its search path.

`SEARCH_FORCE_KEYWORD=1` turns semantic search off, which is handy for testing the fallback. Settings, Database shows which database is in use and whether search is hybrid or keyword-only.

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

- In the app, Settings, Integrations, New profile proposes a profile for any platform in One's catalog. You check it, and it indexes.
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
