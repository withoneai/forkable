# Forkable blocks

Blocks that come with their backend. Each one is the React interface, the
Hono route behind it, and the One actions it needs from the user's own
accounts. `npx @withone/forkable add <name>` copies all three into your app,
and the code is yours from then on. Browse them running live at
[forkable.dev/blocks](https://forkable.dev/blocks).

```
npx @withone/forkable add mail-app     # in your app
npx @withone/forkable list
```

Work on the blocks themselves:

```
pnpm install
pnpm dev                 # gallery on http://localhost:5590, routes on :52190
pnpm forkable add mail-app --cwd <your-app> --registry ./gallery/public/r
pnpm typecheck
pnpm build               # static gallery under /blocks/, the registry in dist/r
```

Every route answers from the Acme Inc sample until the app has a One
Connect app, then it runs on the signed-in user's grant (`meta.mode` says
which). Setting up the Connect app: see `../mcp/README.md`, "Create the
Connect app in One"; for an app, the redirect URI is your own
`/api/one/callback`.

## Layout

- `registry/<name>/block.json` what a component ships: files and where they
  land, the components it requires, its routes, and the One actions it calls.
- `registry/<name>/*.tsx` the interface. Tailwind on shadcn-style tokens
  (`background`, `foreground`, `muted-foreground`, `card`, `raised`, `border`,
  `strong`, `accent`, `primary`, `primary-foreground`, `primary-hover`,
  `primary-press`, `danger`, `shadow-soft`, `shadow-overlay`, radius
  `sm`/`md`/`lg`/`xl`), the palette of blocks.forkable.dev. `registry/lib/blocks.css`
  fills any a fork lacks, so a fork restyles from its own CSS.
- `registry/<name>/route.ts` the route. Every platform call goes through
  `one.call()` in `registry/lib/one-server.ts`, on the signed-in user's
  grant. Before a Connect app exists it answers from the component's sample
  (the Acme inbox), and `meta.mode` says which.
- `registry/lib`, `registry/gmail` shared pieces, installed once.
- `cli/add.ts` the add command: resolves `requires`, copies files, rewrites
  relative imports for where they land, merges `connect.manifest.json`, and
  regenerates `server/src/routes/forkable/index.ts` so one `mountForkable()`
  mounts every route.
- `gallery/` the docs site. Every preview calls its real route on
  `server/dev.ts`.

## Components

Sign in with One, Gmail Inbox, Gmail Thread, Gmail Thread Actions, Gmail
Compose, Gmail AI Reply (Claude through One), and the Mail app block that
composes them. Google Calendar Agenda, Week, Event, New Event, Offer Times
and the Calendar app.

### From Forkable businesses

Blocks lifted out of four Forkable businesses, each with a shared lib
(`registry/rill`, `brief`, `lead`, `builder`) that holds the logic, the
config file a fork edits and the Acme sample.

| Business | Block | Routes | One actions |
|---|---|---|---|
| Rill | `rill-lanes` Lane inbox | `GET /api/rill/lanes` | Gmail Get threads, Jev (System One) |
| Rill | `rill-morning-brief` Morning brief | `GET /api/rill/brief`, `POST /api/rill/brief/write` | Gmail, Jev, Anthropic Create a message (optional) |
| Rill | `rill-ask-inbox` Ask your inbox | `POST /api/rill/ask` | Gmail Get threads, Anthropic Create a message |
| Rill | `rill-vip-suggestions` VIP suggestions | `GET /api/rill/vip-suggestions` | Gmail Get threads |
| Brief | `brief-visibility-check` Prompt visibility check | `POST /api/brief/check` | OpenAI, Anthropic, Gemini, Perplexity, Jev |
| Brief | `brief-share-of-voice` Share of voice | `GET /api/brief/report` | none (reads stored runs) |
| Brief | `brief-citations` Citations | uses the report route | none |
| Lead | `lead-people-search` People search | `POST /api/lead/search` | People Data Labs, Coresignal |
| Lead | `lead-enrich` Enrich a person | `POST /api/lead/enrich` | People Data Labs, Coresignal |
| Lead | `lead-email-finder` Email find and verify | `POST /api/lead/email`, `POST /api/lead/verify` | Findymail, Hunter, Clearout |
| Builder | `builder-action-search` Action catalog search | `GET /api/builder/actions`, `GET /api/builder/actions/:id` | One's catalog on the grant |
| Builder | `builder-manifest` Manifest viewer | `POST /api/builder/manifest` | One's catalog (titles) |
| Builder | `builder-publish-github` Publish to GitHub | `POST /api/builder/publish/github` | GitHub: repo, blob, tree, commit, ref |

Things to know:

- Lead's providers all need a data contract before they can serve real
  lookups. `lead/config.ts` ships every provider off with no cost; a
  provider with no cost never runs. The blocks work on the Acme sample with
  sample costs only.
- Rill's lanes and brief call Jev once per thread (cached per process by
  thread and last message). Goals and VIPs come from `rill/config.ts`.
- Brief's report reads runs the visibility check stored in this process
  (`brief/store.ts`); swap it for your own table.
- Writes and spends only run from a button that says what will happen:
  Write with Claude, Ask N engines, Search, Find email, Verify, and Publish
  (a confirm with the exact repository, visibility and call count; public
  needs a checkbox the server checks again).
- These blocks use three additions to `lib/one-server.ts`: `headers` on
  `one.call`, `one.mode()` and `one.catalog`. A fork that already has an
  older `lib` needs `forkable add <block> --overwrite` to pick them up.

## Verified

Sample mode only: every route, the gallery, and `add` into a scratch fork
(typechecks, serves). Not run on a real grant yet. Live paths reuse Rill's
action ids and call shapes, but the components' own mappers have not seen a
real Gmail answer. In live mode, opening a thread does not mark it read
(that would need the modify action on the thread component).

The business blocks are sample-only too: every action id is real (lifted
from Rill, Brief, Lead and Builder, or loaded with `one actions load`), but
none of their live paths has run on a real grant. Rill's sample replays the
Jev answers Rill recorded live (38 of 40 threads land in the lane Rill's
fixture expects; t17 and t31 go to Goals on a 0.99 and 0.69 goal answer).
Brief's sample answers are generated, not real engine output. Lead's
sample answers follow each provider's documented response shape. PDL search
sends `sql` and Coresignal's search filters are a guess from the docs; both
unverified.
