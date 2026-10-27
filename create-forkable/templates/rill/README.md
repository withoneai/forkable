# Rill

An AI email client on your own Gmail. Your goals and your VIP list decide what you see first. Jev judges every email and an LLM writes. Sign in with One and Gmail or Outlook integrations come built in.

Free and open source. Runs on your machine with one command, or hosted at rill.forkable.dev.

```
npx @withone/rill
```

## What it does

- Five lanes: VIP, Goals, Reply, Other, Screener. Every row shows why it is there, with Jev's judgments and their percentages.
- Goals steer triage. Tell it "close the round, hire two engineers, land three design partners" and the inbox sorts by that.
- VIPs match by address, domain or a plain description ("anyone on our board"). Per-VIP rules: always top, never auto-draft, reply-within reminders, follow-ups.
- Drafts ready before you open the thread, in your voice. The AI never sends. Only your keypress sends.
- A morning brief, follow-up nudges, snooze, reply later, Ask your inbox with cited emails, Cmd+K for everything.
- Calendar built in: Day, Week, Month and Agenda, invites, Offer times and meeting links.

Secured by One. Each user connects their own accounts, and they can revoke them any time.

## Three ways to run the writer

| Engine | When | Who pays |
| --- | --- | --- |
| Claude Code or Codex on your machine | local mode, tool-less | your subscription |
| Claude, GPT or Gemini through One | you granted that connection to Rill | you, on your One account |
| Your own model, connected through One | you connect Anthropic, OpenAI or Gemini like you connected Gmail | you |

Same prompts, same validator, on every engine. The writer has no tools and cannot act.

## Try it with no keys

```
pnpm install
pnpm start          # triages the Acme sample inbox, prints lanes and the brief, exits 0
pnpm dev            # the full UI on the sample inbox at http://127.0.0.1:5180
```

## Connect your Gmail

Create a Connect app in the One dashboard (Developers, Connect, New app) and register `http://localhost:51789/api/one/callback`. Then open http://localhost:5180/setup/connect (or Settings, General, Sign in with One) and paste the client ID, client secret, Connect key and permission set. They go to your macOS Keychain (elsewhere, `~/.rill/connect.env`, mode 0600) and sign-in turns on without a restart. Setting them in `.env` still works as a fallback. Signing in with One is the only login.

Jev runs on your grant too: connect TypeSafe in One and grant it to Rill. Without it, the writer answers Jev's questions and rows get a Check badge. The app never holds a platform key or an API secret, only the grant.

## Database

Rill keeps everything in Postgres through Drizzle: mailboxes, threads, judgments, drafts, goals, VIPs, calendar events and the ledger. Nothing to install.

- **Local (default).** Rill starts its own embedded Postgres on first run, with its data in `~/.rill/db` on port 55439. `pnpm start`, `pnpm dev` and `npx @withone/rill` all use it. If one from an earlier run is still up, Rill reuses it. Settings, Database shows which one is in use and where it lives.
- **Your own Postgres.** Set `DATABASE_URL` in `.env` and Rill uses that instead of the embedded one.
- **Hosted.** The Cloudflare Worker reaches Neon Postgres through Hyperdrive, same schema as local.

Migrations run on every start, so a fresh database comes up with the full schema. After a schema change in `packages/core/src/db/schema.ts`, run `pnpm db:generate` and commit the new file in `packages/core/src/db/migrations/`.

| Variable | Default | What it does |
| --- | --- | --- |
| `DATABASE_URL` | unset | use this Postgres, skip the embedded one |
| `RILL_HOME` | `~/.rill` | data directory, the database lives in `<RILL_HOME>/db` |
| `RILL_PG_PORT` | `55439` | port for the embedded Postgres |

To start over, stop Rill, check nothing still holds `~/.rill/db` (`head -1 ~/.rill/db/postmaster.pid` names the process), then delete the folder. The next start makes a new, empty database.

## Layout

```
INBOX.md          plain-English lanes and rules the code compiles
fixtures/         the Acme sample inbox and recorded answers
packages/core     schema, Gmail sync, Jev, policy, writer engines, ledger
server            Hono on Node (local) and a Cloudflare Worker skeleton (hosted)
ui                Vite + React
cli               npx @withone/rill
```

Platforms One connects to: https://withone.ai/llms.txt

License: MIT
