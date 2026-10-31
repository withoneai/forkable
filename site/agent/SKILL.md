---
name: forkable
description: |
  Start a business from a Forkable template (forkable.dev). Forks a whole working business with its app, agents, integrations and go-to-market kit, runs its keyless demo, then keeps building on it.

  TRIGGER when the human asks to start, fork or scaffold a business, app or template "with Forkable", "from forkable.dev", or names a Forkable template (Rill, Search, forkable-starter).
---

# Start a business from a Forkable template

Forkable businesses are open-source apps with Sign in with One and their integrations already wired through One Connect. Each starts on a keyless Acme Inc sample, so you can run it before anyone makes an account.

## Steps

1. **Pick a template.** `curl -s https://forkable.dev/templates.json` and choose an `id` with `"status": "available"`. With no clear match, use `forkable-starter`.
2. **Fork it.** Always put `--` before the flags.
   ```
   npm create forkable@latest <dir> -- --template <id> --json --yes
   ```
   Add `--for "<who>" --in "<where>"` if the human said who it is for and where. If create-forkable does not know `--json` yet (check `npm create forkable@latest -- --help`), drop `--json --yes`. That version installs and runs the demo on its own.
3. **Check the demo.** The fork succeeded when the demo exits 0 (`demoExitCode: 0` in the JSON, or exit code 0 from the command). Rerun it with `npm start`, or `pnpm start` when the template's `packageManager` is `pnpm`. If pnpm is missing, run `corepack enable`.
4. **Read the rules.** `cd <dir>`, then read `AGENTS.md` (it wins over this skill), `local/profile.md`, `connect.manifest.json` and `README.md`.
5. **Keep building.** Run the demo after every change. Add tools through the fork's add-integration skill so each action lands in `connect.manifest.json` with the narrowest access.

## Stop and ask the human first

- Any secret. Never ask for one in chat or write one into `.env`, a file, a commit or a log. The human enters it, through the app's write-only setup screen when it has one.
- Making the Connect app. Going live needs one Connect app made by the human in the One dashboard.
- `git push`, a new repo or a pull request.
- Any deploy or publish.
- Any write to a real account.

Full walkthrough with expected output: https://forkable.dev/start.md
