# forkable-starter

Fork a business. The team comes with it.

This is the base every [Forkable](https://forkable.dev) business starts
from: [One Connect](https://withone.ai) wired up, a keyless Acme Inc demo
that exits 0, one runtime agent to build on, and a go-to-market kit.

```
npm create forkable@latest my-business --for "real estate agents" --in "Los Angeles"
cd my-business
npm install
npm start
```

`npm start` runs with no account and no keys: it reads the Acme Inc sample
inbox and shows the one action this starter deliberately does not ask
for, declined (`Gmail · delete-message   declined, 403`). That receipt is
the proof: every call this fork makes runs on a user's own Connect grant,
never a shared credential.

## What's in here

| Path | What |
| --- | --- |
| `src/` | A Hono server with One Connect prewired, one route, and the keyless demo |
| `connect.manifest.json` | Every action this fork asks for, with access level and the reason shown at consent |
| `agents/hello.md` | The one runtime agent: job, trigger, allowed actions, what it may never do |
| `fixtures/acme.json` | The Acme Inc sample data the demo reads |
| `AGENTS.md` | Instructions for a coding agent working in this repo |
| `gtm/` | A go-to-market kit: positioning plus draft-only skills for launch copy, a demo video, SEO, creator outreach, and a launch checklist |
| `local/profile.md` | Who this fork is for and where, filled in by `--for`/`--in` |
| `.claude/skills/` | Build skills: add an integration, add an agent, rename, deploy, refresh fixtures |

## Going live

Once this is a real business: sign in to the One dashboard, make a
Connect app (Developers -> Connect -> New app), and set `ONE_CLIENT_ID`,
`ONE_CLIENT_SECRET`, `ONE_CONNECT_KEY`, and `ONE_REDIRECT_URI`. Then
`npm run dev` starts the server with Sign in with One live instead of the
fixture.

See `AGENTS.md` for the rules this repo runs on, and `.claude/skills/` for
how to extend it.

MIT licensed.
