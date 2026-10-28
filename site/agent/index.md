# Forkable, fork a business, not a blank page

Every business comes with its integrations and sign-in already wired. Fork the whole thing, add one block of it to your app, or use it right in chat.

Free and open source, MIT licensed.

```
npm create forkable@latest rill
```

Agents, start at https://forkable.dev/start.md or https://forkable.dev/llms.txt.

## Integrations and sign-in come with the fork

Copying an app that talks to Gmail or Stripe used to mean an OAuth app per provider, tokens to store and refresh, a login and a consent screen to build. A Forkable business ships with its integrations declared and Sign in with One wired in. You make one Connect app in the One dashboard, and every tool the business needs runs on your users' own accounts.

- **Declared in the repo.** `connect.manifest.json` lists every action the business calls and the access it asks for.
- **One app for every tool.** A single Connect app covers Gmail, Stripe, WhatsApp Business and whatever else the business uses.
- **No provider tokens to keep.** Your server stores one short reference per user. Nothing to refresh.
- **Sign in with One, built in.** Your users sign in with One and connect their own accounts in three steps.
- **Add a tool later.** The add-integration skill wires a new tool and updates the manifest.
- **Secured by One.** Each user connects their own accounts, and they can revoke them any time.

## Start from something that already works

Each business is a working app, its agent team, coding-agent instructions and a go-to-market kit. Its integrations come with it. A new official business every 10 days.

{{TEMPLATE_SECTIONS}}

The full list as JSON is at https://forkable.dev/templates.json.

## Take one piece of a business

A block is one feature pulled out of a Forkable business. It brings its interface, the route behind it and the actions it needs from your users' accounts. Add it to any app with one command, and the code is yours.

```
npx @withone/forkable add mail-app
```

- **The interface.** React on plain tokens, so it takes your fork's colors and type.
- **The route behind it.** A Hono route, mounted with every other block by one `mountForkable()`.
- **The actions it needs.** `add` writes them into `connect.manifest.json`, so your Connect app asks for exactly that.
- **Yours after that.** Plain code in your repo. Every block runs on the Acme Inc sample until you make a Connect app.

Blocks today: Sign in with One; Gmail Inbox, Thread, Thread Actions, Compose, AI Reply; Google Calendar Agenda, Week, Event, New Event, Offer Times; Mail app and Calendar app; from Rill, Lane inbox, Morning brief, Ask your inbox, VIP suggestions; from Brief, Visibility check, Share of voice, Citations; from Lead, People search, Enrich, Email finder; from the Builder, Action search, Manifest, Publish to GitHub. Browse them running live at https://forkable.dev/blocks/.

## Build a real interface in the conversation

Add https://blocks.forkable.dev/mcp as a connector in Claude or ChatGPT and sign in with One. Ask for what you need, and the agent builds a working screen right in the chat. It runs on your own accounts.

- **It finds the actions.** The agent looks up what it needs on your accounts and nothing else.
- **A screen you can click.** Real buttons, tables and forms on Forkable's kit. Reads run at once.
- **Writes wait for you.** Nothing sends or changes until you press Confirm.
- **Saved for next time.** Open it again in the other chat app, or at https://blocks.forkable.dev.

Build your own MCP from the same open source code (https://github.com/withoneai/forkable/tree/main/mcp). Sign in with One is its login, so every tool call runs on the person's own accounts.

## One command, a full business

1. **Pick.** Choose a template, or name one directly.
2. **Copy.** Clones the template and installs.
3. **Run.** Starts on the keyless Acme Inc sample. No account yet.
4. **Connect.** One Connect app covers every tool the business uses. You make it once in the One dashboard.

What comes with every fork:

- **The team comes with it.** `agents/` holds the agents that run the business, each with its own job written down.
- **A go-to-market kit.** `gtm/` has draft-only skills for positioning, launch and the first 50 customers.
- **Yours to change.** MIT licensed code and an `AGENTS.md`, so your coding agent knows the business from day one.

## Fork it again, keep the credit

Anyone can publish a template built on the starter, and every fork remembers where it came from in `forkable.json`. Before a template lists, it should pass these checks (a `forkable check` command to run them is planned, until then they are run by hand):

- The keyless demo exits 0
- The manifest matches the runAction calls in the code
- No secrets or .env values are committed
- The sample is Acme Inc only
- AGENTS.md, agents/ and gtm/positioning.md are there

Three tiers: **Official** (built by One, a new one every 10 days), **Verified** (passed the checks plus a human review of the code and its integrations) and **Community** (passed the checks, anyone can publish one).

How to build and publish a template: https://forkable.dev/contribute.md

## Fork the whole thing

All of Forkable is open source. Read the code, run your own copy and send a PR.

- Every business and the starter
- The blocks and the forkable CLI
- The blocks MCP and blocks.forkable.dev
- An MCP starter with Sign in with One
- forkable.dev, this site
- MIT licensed, built on One Connect

Source: https://github.com/withoneai/forkable. Built on One Connect (https://withone.ai).
