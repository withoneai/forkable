# Forkable MCP

An MCP server whose login is **Sign in with One**. Add it to Claude or
ChatGPT, sign in, and ask for what you need. The agent finds the actions it
needs on your own accounts and writes a working interface right in the chat.
Every interface is saved, and opens again in the other chat app or on the
website this same Worker serves.

This is the code behind [blocks.forkable.dev](https://blocks.forkable.dev).
Fork it to run your own, or use it as the starting point for any MCP server
that should act on each person's own accounts instead of a shared key.

- One Cloudflare Worker: the MCP endpoint, its own OAuth server, the website.
- Sign in with One through a [One Connect](https://withone.ai) app. Each
  person connects their own tools and can revoke them any time.
- Works in sample mode with no account and no keys, on the Acme Inc sample.

## Contents

1. [How it works](#how-it-works)
2. [Run it on the sample](#run-it-on-the-sample)
3. [Create the Connect app in One](#create-the-connect-app-in-one)
4. [Deploy to Cloudflare](#deploy-to-cloudflare)
5. [Add it to Claude or ChatGPT](#add-it-to-claude-or-chatgpt)
6. [Make it yours](#make-it-yours)
7. [Security model](#security-model)
8. [Files](#files)
9. [Tests](#tests)
10. [Known limits](#known-limits)

## How it works

```
Claude / ChatGPT ──OAuth (DCR + PKCE)──▶ this Worker ──Sign in with One──▶ One Connect
       │                                     │                               (consent, 3 steps)
       │ tools/call                          │ runAction on the person's grant
       ▼                                     ▼
  canvas (trusted shell)                One ──▶ Gmail, Calendar, Slack, Stripe, ...
    └─ sandboxed frame running the agent's UI
```

1. The chat app adds `https://<your-host>/mcp`. The Worker is its own OAuth
   server (`@cloudflare/workers-oauth-provider`, dynamic client
   registration, PKCE), so the chat app registers itself and sends the
   person to `/authorize`.
2. `/authorize` shows a consent page naming the chat app, then hands off to
   Sign in with One. The person confirms their email, enters a 6-digit code
   and picks which tools to connect and how far.
3. One sends them back to `/api/one/callback`. The Worker saves one short
   reference per person in KV (key mode) and finishes the chat app's OAuth.
4. Every tool call runs on that person's grant. A call outside what they
   granted is refused by One before the provider is reached.

### Tools

| Tool | What it does |
|---|---|
| `list_connections` | The tools this person connected, from their grant. |
| `find_actions` | Searches One's catalog for actions on a connected platform. |
| `action_docs` | The parameters and response of one action. |
| `ui_guide` | The UI kit reference, the style rules and a full example. |
| `render_ui` | Compiles a TSX component the agent wrote, saves it, and shows it in the chat. |
| `update_ui` | A new version of a saved UI. |
| `list_my_uis`, `show_ui`, `rename_ui`, `delete_ui` | The person's saved UIs. |
| `run_action` | App-only. The UI calls it to read or write data. It refuses any action the UI did not declare. |

The UI resource is `ui://forkable/canvas-<hash>.html`. The hash changes with
the HTML, because chat apps cache a resource by its URI.

## Run it on the sample

Needs Node 20 or later, pnpm and a free Cloudflare account (only for deploy).

```bash
git clone https://github.com/withoneai/forkable.git
cd forkable/mcp
pnpm install
cp .dev.vars.example .dev.vars      # AUTH=off, no secrets in it
pnpm dev                            # builds the views, migrates local D1, serves :52290
```

- http://localhost:52290 is the website on the Acme Inc sample.
- `http://localhost:52290/mcp` is an open MCP endpoint (no sign-in) that
  answers from the sample. Point the MCP Inspector or the test host at it:
  `pnpm harness` serves one on http://localhost:52291.

Sample mode needs no Connect app and no keys. Chat apps need a public HTTPS
URL, so try sign-in on a deployed Worker (next two sections).

## Create the Connect app in One

You make one Connect app in the One dashboard. It is the login for your MCP
and decides which tools people can connect.

1. Sign in at [app.withone.ai](https://app.withone.ai) (free) and switch the
   dashboard to **Production**. Connect keys exist only there.
2. Go to **Developers → Connect → New app**. A studio opens with the form on
   the left and a live preview of the consent card on the right.
3. **Who is asking.** What people see on the consent page.
   - **Name** (required), for example "Acme MCP".
   - **Logo URL**, a public square image around 128px.
   - **Why you're asking**, up to 200 characters, for example "Acme MCP
     builds screens from your inbox and calendar inside your chat app."
4. **What it asks for.** Pick one:
   - **Specific connectors and scopes** (the default). Add each tool your
     MCP should reach (Gmail, Google Calendar, Slack, ...) and a level for
     each: Read only, Read & write, Full access, or Custom (exact actions).
     People can narrow this at consent, never widen it. Creating the app
     saves this list as its default ask, and its **Ask id** goes in
     `ONE_PERMISSION_SET`.
   - **Everything the user has connected.** Good for a general agent: the
     person ticks which of their connections to include. This mode has no
     Ask id, so leave `ONE_PERMISSION_SET` empty.
5. **Where users return.** Add your redirect URI, exactly:
   ```
   https://<your-host>/api/one/callback
   ```
   `<your-host>` is your Worker's URL, for example
   `forkable-mcp.<your-subdomain>.workers.dev` or your own domain. The match
   is exact (scheme, host, port, path). Use `https`; plain `http` works only
   for `localhost`. Register one line per environment.
6. Click **Create app**. On the app's page, under **Credentials**, copy:
   - **Client ID**.
   - **Client secret**, starts with `one_secret_`. Shown once. If you lose
     it, **Regenerate** makes a new one and the old one stops working.
   - **Connect keys → Create key**, name it for example `mcp-worker`. Starts
     with `sk_live_`. Shown once.
   - **Ask id**, from the **What it asks for** card (Specific mode only).

Keep the secret and the connect key out of chat, files and commits. They go
straight into Cloudflare as Worker secrets in the next section.

Key mode or token mode: with `ONE_CONNECT_KEY` set the Worker runs in key
mode (one permanent reference per person, nothing to refresh). Without it,
it falls back to token mode and keeps each person's access and refresh
tokens in KV. Key mode is the one to use; see [Known limits](#known-limits).

## Deploy to Cloudflare

```bash
npx wrangler login
npx wrangler d1 create forkable-mcp           # copy the database_id it prints
npx wrangler kv namespace create OAUTH_KV     # copy the id it prints
```

Edit `wrangler.jsonc`:

- `d1_databases[0].database_id` and `kv_namespaces[0].id`: the two ids.
- `vars.AUTH`: `"one"`.
- `vars.PUBLIC_URL`: your Worker's public URL, no trailing slash. It must be
  the same host you registered in the redirect URI.
- `vars.ONE_PERMISSION_SET`: the Ask id, or `""` for an Everything app.
- `name`: your Worker's name. Optional: uncomment `routes` for a custom domain.

Set the three secrets. Each command asks for the value at a prompt and
doesn't echo it:

```bash
npx wrangler secret put ONE_CLIENT_ID
npx wrangler secret put ONE_CLIENT_SECRET
npx wrangler secret put ONE_CONNECT_KEY
```

Then deploy (builds the views, applies the D1 migration, deploys):

```bash
pnpm deploy
```

Open `https://<your-host>/`. You should see the sign-in page. Sign in with
One to check the whole flow before you add it to a chat app.

If you first deploy to `*.workers.dev` and later move to your own domain,
update `PUBLIC_URL` and add the new redirect URI to the Connect app.

## Add it to Claude or ChatGPT

The MCP URL is `https://<your-host>/mcp`.

- **Claude:** add a custom connector with that URL (Settings, Connectors).
  Claude registers itself with your Worker, then opens your consent page and
  Sign in with One.
- **ChatGPT:** add it as a connector or app with that URL in its developer
  settings. Finish the sign-in in the window ChatGPT opens; if the flow
  leaves that window, ChatGPT can lose the callback ("Missing OAuth callback
  data"). Try again in the same window.

Then ask for something, for example "show the threads that need a reply
from me this week, with a button to reply yes". Reads run at once. A reply
waits for your Confirm.

Claude shows a custom connector's icon from Google's favicon service for
your registrable domain, not from the MCP server info, so a new domain can
show a generic icon for a while.

## Make it yours

- **Names.** `name` in `wrangler.jsonc` and `package.json`, the server name
  in `src/mcp.ts` (`serverInfo`) and `view/canvas.tsx`, the server
  instructions in `src/mcp.ts` (`INSTRUCTIONS`), and the website copy in
  `src/web-ui.ts`.
- **Brand.** `brand/` and `public/` hold the Forkable marks. The code is MIT,
  the Forkable name and marks are not: replace them with your own before you
  ship.
- **What the agent can reach.** That is your Connect app's ask, not code.
  Add or remove connectors in the dashboard.
- **New tools.** Tool definitions are in `src/mcp.ts` and their handlers in
  `src/tools.ts`. Call One with the person's grant through the Connect
  client from `src/connect.ts`. Never call a provider with a key of your own.
- **The UI kit.** `view/kit.tsx` (`@forkable/ui` to the agent) and the tokens
  in `view/runner.html`. `src/guide.ts` is what `ui_guide` teaches the agent;
  keep it in step with the kit. `src/stylecheck.ts` warns on off-kit styles.

## Security model

- **Each person's own accounts.** Every call runs on the grant that person
  gave your Connect app. There is no shared key that reaches everyone's data,
  and people can revoke your app from their One account.
- **Declared actions only.** `render_ui` takes the list of action ids the UI
  may call. `run_action` refuses anything else.
- **Writes wait for Confirm.** The canvas is a trusted shell. The agent's
  code runs in a sandboxed frame inside it (opaque origin, no network, no
  host bridge) and can only ask the shell to call a tool. A write answers
  `428 confirm_required` with a summary written by the server; the shell
  shows it in a dialog the frame can't reach, and only Confirm sends it again
  with a one-time token bound to the person, the UI, the action and the exact
  input (2 minutes, KV). Reads run at once.
- **What counts as a write.** GET is a read. A POST is a read only when the
  action is known or titled get/list/search/...; anything else is a write.
- **The website.** Its only data door is `POST /api/web/tool`, same origin
  only, `run_action` only.
- **Secrets.** `ONE_CLIENT_SECRET` and `ONE_CONNECT_KEY` live only as Worker
  secrets. The sign-in logs record hosts and parameter names, never codes,
  states or tokens.

## Files

| Path | What it is |
|---|---|
| `src/worker.ts` | Entry. Routes `/mcp`, the OAuth endpoints, the website. |
| `src/auth.ts` | `/authorize` consent page, hand-off to Sign in with One, `/api/one/callback`. |
| `src/connect.ts` | The One Connect client (key mode with `ONE_CONNECT_KEY`, else token mode) and the stable per-person id. |
| `src/mcp.ts` | MCP server: tool list, server instructions, the canvas resource. |
| `src/tools.ts` | Tool handlers, including `run_action`'s write check and one-time confirm tokens. |
| `src/generative.ts` | `render_ui`: compiling the agent's TSX (sucrase), declared actions, read or write classification. |
| `src/store.ts` | Saved UIs and versions in D1. |
| `src/guide.ts`, `src/stylecheck.ts` | What `ui_guide` returns, and the style warnings. |
| `src/web.ts`, `src/web-ui.ts` | The website: sign-in, "Your blocks", `/u/<id>`, consent and message pages. |
| `src/sample/` | The Acme Inc sample inbox for `AUTH=off`. |
| `view/canvas.*` | The trusted shell (built to one HTML file). |
| `view/runner.*`, `view/kit.tsx` | The sandboxed frame and the UI kit the agent writes with. |
| `migrations/` | D1 schema. |
| `harness/` | A local MCP Apps test host on :52291. |
| `scripts/` | Playwright tests and screenshot scripts. |

## Tests

With `pnpm dev` and `pnpm harness` running (sample mode):

```bash
pnpm test               # style check unit tests
pnpm typecheck
npx playwright install chromium-headless-shell   # once
pnpm test:render        # canvas (tool list, render, confirm, saved UIs), website, kit in both themes
```

## Known limits

- **Token mode refresh.** One rotates refresh tokens and treats reuse as
  theft. In token mode there is no lock around a refresh across Worker
  isolates; a production build would keep each person's tokens behind a
  Durable Object. Key mode has nothing to refresh, which is why it's the
  recommended mode.
- **`run_action` is app-only by host convention.** Chat apps hide app-only
  tools from the model. A host that let the model call it directly could
  confirm its own write.
- **Connect apps are made in the dashboard.** There is no API to create one
  for you yet.

## License

MIT for the code. The Forkable name and marks in `brand/` and `public/` are
not covered by the license.
