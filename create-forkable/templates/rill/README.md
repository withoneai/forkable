# Rill

An AI email client on your own Gmail. Your goals and your VIP list decide what you see first. Jev judges every email, an LLM writes, and you connect your inbox through One Connect, so the app holds a grant, never your password.

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
- An Access screen that shows exactly what you granted, every call the app made today, and the ones One refused. A call outside the grant reads `Gmail · delete   declined, 403`.

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
pnpm start          # triages the Acme sample inbox, prints lanes, brief and the receipt, exits 0
pnpm dev            # the full UI on the sample inbox at http://127.0.0.1:5180
```

## Connect your Gmail

Create a Connect app in the One dashboard (Developers, Connect, New app) and register `http://localhost:51789/api/one/callback`. Then open http://localhost:5180/setup/connect (or Settings, General, Sign in with One) and paste the client ID, client secret, Connect key and permission set. They go to your macOS Keychain (elsewhere, `~/.rill/connect.env`, mode 0600) and sign-in turns on without a restart. Setting them in `.env` still works as a fallback. Signing in with One is the only login.

Jev runs on your grant too: connect TypeSafe in One and grant it to Rill. Without it, the writer answers Jev's questions and rows get a Check badge. The app never holds a platform key or an API secret, only the grant.

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
