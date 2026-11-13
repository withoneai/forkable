# Search

## What this is
A personal search app you can fork and run. It indexes whatever a user
connects through One (a CRM, mail, calendars, docs, an issue tracker,
chat, meeting notes), keeps a hybrid keyword and semantic index in
Postgres, and docks an AI on the right that answers from the results and
cites them. Web UI, CLI, REST API and an MCP server, all behind Sign in
with One. A Forkable business: One Connect wired up, a manifest of every
action it asks for, two runtime agents, a keyless Acme Inc demo that
exits 0. MIT.

`docs/SPEC.md` is the build spec and wins where files disagree.
`docs/CONTRACT.md` is the interface between `packages/core`, `server`,
`ui` and `cli`. Read both before changing structure.

## Status (2026-11-12)
Phases 0 to 5 done on local `main` (2026-10-29), nothing pushed, published or deployed.
Working: `pnpm start` (the Acme demo across 11 sources, exits 0, hybrid or
keyword-only), `pnpm dev` (the full UI on the sample: search with
operators, preview, entities, lanes, chat with citations and proposals,
New profile, Settings, Access, `/setup/connect`), Sign in with One with a
write-only setup store, OAuth for the CLI, REST and MCP, the CLI
(`search login`, queries, `ask`, `profiles`, `mcp-config`), the MCP tools
`search`, `fetch`, `get_entity`, `list_sources` and `ask`, and the
`add-search-profile` skill (tested by a fresh agent on Intercom).
Agents (2026-11-12, branch `agent-connect`): Settings, Agents connects
Claude Code, Codex, Cursor or Claude Desktop in one click, or an agent sets
itself up from `/start.md`; `search mcp` is a stdio bridge; MCP `search` has
filters and pages, `fetch` reads long items in parts (SPEC 16.5, CONTRACT 18).
Tests that touch agent configs must set `SEARCH_AGENT_HOME` to a temp folder.
Plain sentences (2026-11-12, D48, D49): the box reads "emails from Priya last
week" as filter chips (`packages/core/src/query/understand.ts`); on by default
for the web app only, bearer callers send `understand=1` (the CLI always does,
with `tz`), MCP `search` has `understand`, off by default. Home shows each tool
on its first read. Plain words on every screen, enforced by `pnpm check:copy`
(Words on screen, below).
Integration (2026-11-12, branch `easy`): search quality, the agent bridge and
the screens polish run together. Jev's name is off everyday faces ("marked
automatically", "Best results first", the name in a tooltip), chat rows read
"Message" with the channel after the author, counts drop rows folded into a
thread so tabs, lanes and lists agree, and SPEC, CONTRACT, README, `/skill.md` and the Cheatsheet agree on
the filters fallback, `hiddenBy`, `container` and the 30 s refresh grace. Checks:
typecheck with `check:copy`, core 397, `pnpm start`, smokes api 150, oauth 65,
mcp 47, whoami 28, connect-env 19, scheduler 6, agents 82, CLI 68, the refresh
stress test, and on a production build smoke-ui 10 (mock and real), smoke-plain
54, smoke-cache 39, smoke-agents 30 mock and 28 real. All on the Acme sample and
stubbed grants; never on a real grant, a real One sign-in or a real agent's own
config. smoke-assistant's AI steps need a signed-in Claude Code or Codex and did
not run (the tests use temp config folders).
Polish (2026-11-12, branch `plain-language`, from two final testers): a negation never
searches its target (its exclusion is offered); "hides N" is what dropping that filter adds,
counted by running the Drop button's own search; `in:#deals` and "in the deals channel" are
the container filter everywhere; fallbacks put the rows with more of the words first and
the rest under a collapsed divider (`topRows`, `restLabel`); "need to reply" reads as Needs
you; `during:` skips deals with no close date (`undated`); the answer strip streams its steps;
answers say "Answered by Claude" with lists and plain dates; a card and its page share one
count (`search/entity-items.ts`); RSVPs read Going, Maybe, Not going or Invited. Tests in
`packages/core/test/polish.test.ts`.
Final merge (2026-11-12, branch `easy`): `agent-connect` (sign-in fixes in `cli/src/remote.ts`
and `server/src/oauth.ts`, the sample never ending agent sign-ins, the plain receipt, Agents
wording) and `plain-language` together. A person or company has one count: `entityItemStats`
(`packages/core/src/search/entity-items.ts`) gives the card and the page the same number and
tools (live items linked to it, a company's people's too); the page's timeline is a view of
that set without its own records, copies shown once, newest 50, and a line under it says why
it is shorter. Checks, all passing together: typecheck with `check:copy`, core 444,
`pnpm start` exits 0, smokes api 160, oauth 65, mcp 50, whoami 28, connect-env 19, scheduler
6, agents 86, CLI 70, the 90 s refresh stress test, and on a production build smoke-ui 15
(mock and real), smoke-plain 54, smoke-cache 39, smoke-agents 30 mock and 28 real. Spot-checked
by hand in a headless browser on the Acme sample. Never run: anything on a real grant, a real
One sign-in, Search inside a real Cursor, Claude Desktop, Claude Code or Codex (every agent
config test writes to temp folders), and a written answer from a local engine in this pass
(the sample answered with its recorded text).
Not yet: any profile run on a real grant (every built-in is
`verified: "fixture"`), Gmail history delta, a hosted Worker build, push
subscriptions, the `create-forkable` catalog entry and the npm package.

## Rules
- **Every platform call runs on the signed-in user's Connect grant.** Jev,
  the embeddings and the hosted LLM included. On the user's own computer
  the assistant and the New profile proposal run on the local Claude Code
  or Codex (`packages/core/src/local-agent.ts`, tool-less, like Rill; the
  choice is Settings, Assistant, "AI engine": auto, Claude Code, Codex or
  models through One); `SEARCH_HOSTED=1` forces models through One, which then
  needs Anthropic connected in the person's grant. No `ONE_SECRET`, no connection
  keys, no key mode. Code that reads one is a bug.
- **No secrets in `.env`, ever.** `pnpm connect` writes ids only
  (`ONE_CLIENT_ID`, `ONE_REDIRECT_URI`; no `ONE_PERMISSION_SET`, the app asks
  for everything). The client
  secret and the Connect key are pasted on `/setup/connect` and stored in
  the macOS Keychain (`search.connect`) or `~/.search/connect.env` (0600).
  Never ask for a secret in chat and never log one.
- **Search reads only.** Every profile action is `access: "read"`. The Connect
  app asks for everything (`ask: "everything"` in `one.connect.ts`, D50), so a
  person's grant may allow writes: reading only is the code's job, never the
  grant's. The one write in the manifest (Gmail delete) is `grant: false` and
  runs only on the Acme sample, where the Access screen shows One declining it.
- **Keep to the One plan.** Every call goes through `one.ts`, which waits on
  the per-user budget in `packages/core/src/one-budget.ts` (CONTRACT 19).
  Never call `runAction` around it.
- **The manifest is the source of truth.** `connect.manifest.json` lists
  every action `one.call` can make. It is generated by
  `node packages/core/scripts/gen-manifest.mjs` from the packs plus the
  core actions; `test:profiles` fails when a pack names an action it does
  not list. The Access screen reads it; the Connect ask no longer does.
- **Acme Inc only.** `fixtures/sample/` is the Acme world
  (`fixtures/sample/world.md`). Never a real company, customer, prospect or
  recognizable person, even as a placeholder.
- **MIT.**
- **Public repo push gate.** Never `git push`, `npm publish`,
  `gh pr create` or deploy without the owner's direct approval in the
  current conversation. Build and verify locally, then ask.
- **Copy.** No em or en dashes, no exclamation marks, none of seamless,
  frictionless, cutting-edge, revolutionary, AI-powered, leverage (as a
  verb). Lead with forking a working business, then the integrations and
  Sign in with One, then one short "Secured by One" line. Never type a
  platform count; fetch it.
- **Runs never hold the database.** A sync run must not keep a pooled pg
  client for its length (its advisory lock uses its own `pg.Client`), and
  every run, scheduled or kicked, waits for one of `SEARCH_SYNC_CONCURRENCY`
  slots (default 4, `server/src/scheduler.ts`). On start the scheduler closes
  runs a previous process left `running` and queues their sources again.
  `pnpm --filter @search/server smoke:scheduler` covers both.

## Words on screen
The app is for people who have never seen a config file. Every screen says
what a thing does for them, not how it is built. The code, the API, the
database and `docs/CONTRACT.md` keep the real terms; only the visible words
change. The terms and the phrases that repeat live in `ui/src/lib/copy.ts`;
use them instead of typing a second wording.

| Builder word | What the app says |
|---|---|
| Profile | Source ("Add a source", "Edit what it reads") |
| Models (of a platform) | What to search (Contacts, Deals, ...) |
| Grant, "in your grant" | Access, "connected", "Allowed" |
| "The Connect app's ask" | The tools Search can ask for |
| Operators | Filters |
| Semantic, hybrid, keyword-only, embeddings | Search by meaning, on or off, with the reason in plain words |
| Sync, syncing | Update, updating |
| Entity | Person or company |
| Lanes (the group) | Priority (VIPs, Needs you, Waiting, FYI, Low keep their names) |
| Index, indexing | fine; "reading" or "getting ready" where it reads better |
| Postgres, pgvector, localhost, a request line (`GET /api/...`) | "On this computer", what it reads; the real values under Advanced |
| Rerank, TypeSafe, hash-v1, Embed | "Put the best results first", an AI helper, "Sample, words only", "reads for meaning" |
| Jev (on everyday screens) | what it did ("Search thinks these are the same person, 93% sure"); the name in a tooltip, Settings and Access |

The real terms stay where a builder needs them: the Advanced disclosures
(New source flow, source detail), the Cheatsheet (the typed filters),
`/setup/connect` and the docs. An AI model is still a model ("AI model",
"Claude through One"). An error says what happened and what to do next.

`pnpm check:copy` (`scripts/check-copy.mjs`, also run by `pnpm typecheck`)
reads every visible string in `ui/src` (JSX text, title, label,
placeholder, aria-label and other text props, toast titles and details,
string constants that read like words) and fails on a builder word from the
left column and on the house copy rules: no em or en dashes, no exclamation
marks, no banned words, no typed platform or tool count, no native
`<select>`. A real term is allowed inside an element marked
`data-copy="advanced"`, on the line after a `// copy-ok: <why>` comment,
and in the files listed in `ALLOW_FILES` with their reason. `node
scripts/check-copy.mjs --dump` prints the whole inventory.

## How to add things
- **A new source (built-in):** `.claude/skills/add-search-profile/SKILL.md`.
  A source is a JSON profile in `profiles/<platform>/pack.json` plus Acme
  fixtures and `expect.json`, never per-platform code. Format reference:
  `docs/profiles.md`.
- **A new source (for one user):** Settings, Sources, Add a source in the
  app (the New profile flow in code). It proposes a profile from the
  platform's actions; the user confirms; indexing starts.
- **A new runtime agent:** write `agents/<name>.md` first (job, trigger,
  model, allowed actions, the "may never" list), like
  `agents/indexer.md` and `agents/assistant.md`.
- **A schema change:** edit `packages/core/src/db/schema.ts`, run
  `pnpm db:generate`, commit the new migration.
- **Go-to-market:** `gtm/skills/`, starting with `positioning.md`. Every
  skill writes drafts to `gtm/out/` (git-ignored) and never posts, sends
  or deploys.

## Architecture
```
packages/core      schema and migrations, one.call, the profile engine
                   (paths, templates, strategies, decoders), entities, Jev,
                   embeddings, hybrid search, chat, the mapper, the demo
packages/pgvector  pgvector 0.8.7 builds for the embedded Postgres
profiles/          built-in packs and the generated JSON Schema
fixtures/sample/   the Acme world, shaped from documented responses
server             Hono on Node: sessions, Sign in with One, setup store,
                   scheduler, REST, OAuth server, MCP
ui                 Vite + React
cli                @withone/search, bin `search`
site               the landing page (static)
```

## Ports and data
| Thing | Value |
|---|---|
| Server | 52289 (pinned, the Connect redirect depends on it) |
| UI (Vite dev) | 5680 |
| Embedded Postgres | 55441 (first free at or after) |
| Landing site | 5690 |
| Data dir | `~/.search` (`SEARCH_HOME`) |
| Core tests | their own Postgres on 55497 in a tmp dir (`SEARCH_TEST_PG_PORT`, `SEARCH_TEST_HOME`) |

## Checks before a commit
`pnpm typecheck` (runs `pnpm check:copy` first), `pnpm --filter @search/core
test`, `pnpm start` (exits 0). Server changes: the smokes in `server/scripts/` against
`pnpm dev:server`.
