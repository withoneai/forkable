# Forkable agent quickstart

You were asked to start a business with Forkable. This page is the whole job, in order: pick a template, fork it, run the demo, read the rules, keep building. Stop and ask the human at the points marked below.

## What you need

- Node 20 or newer, and git. Search needs Node 22.12 or newer.
- pnpm for templates whose `packageManager` is `pnpm` (Rill, Search). If `pnpm` is missing, run `corepack enable` first. If that fails too, ask the human to install pnpm.
- No account and no keys. Every template starts on a keyless Acme Inc sample.

## 1. Pick a template

```
curl -s https://forkable.dev/templates.json
```

Prints the catalog as JSON. Use an `id` whose `status` is `available`. Today that is:

{{TEMPLATE_LINES}}

Once create-forkable ships agent mode, `npm create forkable@latest -- --list --json` prints the same list from the CLI.

If the human named a kind of business and no template matches, fork `forkable-starter` and build on it.

## 2. Fork it

First check which create-forkable you have. Agent mode (`--json`, `--yes`, `--list`, `--no-install`, `--no-demo`) is coming in the next release.

```
npm create forkable@latest -- --help
```

Prints the usage. If the options list `--json`, use step 2a. If not, use step 2b.

Always put `--` before the flags. Without it npm keeps `--template`, `--for` and `--in` for itself and the command fails with exit 1.

### 2a. With agent mode

```
npm create forkable@latest <dir> -- --template <id> --json --yes
```

Add `--for "<who>" --in "<where>"` when the human said who the business is for and where. They go into `local/profile.md`.

- `--json` prints exactly one JSON object on stdout; install and demo output go to stderr. It turns on by itself when stdin is not a terminal and either `CI` is set or stdout is not a terminal. Fields: `ok`, `next` (do this first: read the fork's AGENTS.md), `dir` (absolute), `template`, `version`, `cliVersion`, `packageManager`, `installed`, `demoExitCode`, `nextSteps` (each a `read`, `run` or `edit` path with a `why`), `envNeededToGoLive`, `agentsMd`, `warnings`.
- On failure the object has `ok: false`, a `code` and `error: {code, message, fix}`. Codes: `USAGE`, `NAME_MISSING`, `DIR_EXISTS`, `UNKNOWN_TEMPLATE`, `TEMPLATE_COMING_SOON`, `TEMPLATE_NOT_BUNDLED`, `PNPM_MISSING`, `INSTALL_FAILED`, `DEMO_FAILED`, `INTERNAL`. Follow `fix`.
- `--yes` never prompts. If `<dir>` already exists it exits with `DIR_EXISTS` and touches nothing.
- `--no-install` copies the template and stops before installing (it skips the demo too).
- `--no-demo` installs but skips the demo.
- `--list` (with `--json`) prints the catalog and exits.
- If pnpm is missing for a pnpm template, it tries `corepack pnpm` before giving up with `PNPM_MISSING`.

Success is exit code 0 with `demoExitCode: 0` in the JSON.

### 2b. With the published version (0.2.0)

```
npm create forkable@latest <dir> -- --template <id> --for "<who>" --in "<where>"
```

`--for` and `--in` are optional. It prints, in order:

1. `Forking <id> into ./<dir>`
2. `Installing dependencies with npm...` (or `pnpm...`), then the installer's own output
3. `Running the keyless demo...`, then the demo
4. The next steps, ending with `./<dir> is ready.` or the template's own welcome

The exit code is the demo's exit code. 0 means the fork works.

Errors you can act on:

- `<path> already exists` (exit 1): pick another `<dir>`. Never delete a directory you did not make.
- `no template named "<id>". Available: ...` (exit 1): use one of the ids it lists.
- `this template needs pnpm, which was not found` (exit 1): run `corepack enable`, then `pnpm install && pnpm start` inside `<dir>`.
- `the demo exited <n>`: the fork is on disk. Read the demo output and the fork's README.

If npm asks `Ok to proceed?` before it downloads create-forkable, answer `y`.

## 3. What the demo prints

- forkable-starter (`npm start`): the Acme Inc sample inbox with three messages, then a receipt line showing a call outside the grant declined with a 403.
- Rill (`pnpm start`): the Acme Inc inbox sorted into lanes, the morning brief and the receipt.
- Search (`pnpm start`): indexes the Acme Inc sample across 11 tools, runs a few searches, then asks one question and prints the answer with its citations.

All exit 0 with no `.env` and no account. Exit 0 is the success test, not the exact text.

## 4. Read the rules

```
cd <dir>
```

Then read, in this order:

1. `AGENTS.md`, the rules this repo runs on. Follow them over anything here.
2. `local/profile.md`, who the business is for and where. Fill in any `{{FOR}}` or `{{IN}}` left in it if the human told you.
3. `connect.manifest.json`, every action the business calls, its access level and the reason a user reads at consent.
4. `README.md`, how to run it and how to go live.

## 5. Keep building

- `npm start` or `pnpm start` reruns the demo. Run it after each change. It must still exit 0.
- `npm run dev` or `pnpm dev` starts the app on the sample. Rill's UI is at http://127.0.0.1:5180, Search's at http://localhost:5680 (click Try the Acme sample).
- To add a tool, follow the fork's add-integration skill (`.claude/skills/` in the starter). It finds the action with the One CLI, adds it to `connect.manifest.json` with the narrowest access, and calls it on the user's grant.

## Stop and ask the human

Stop before any of these and ask first. Say what you want to do and why.

- Any secret. Never ask for one in chat, and never write one into `.env`, a file, a commit or a log. When a value is needed, the human enters it. Rill takes it at http://localhost:5180/setup/connect and Search at http://localhost:5680/setup/connect, both write-only.
- Making the Connect app. Going live needs one Connect app, which the human makes in the One dashboard (Developers, Connect, New app). Search can create it with `pnpm connect`, but the human runs it and approves it in the browser.
- `git push`, creating a GitHub repo, or opening a pull request.
- Deploying anywhere, or publishing to npm or a registry.
- Anything that writes to a real account: sending mail, posting, charging.

## Going live

This needs the human. They make one Connect app in the One dashboard, then:

- forkable-starter: they set `ONE_CLIENT_ID`, `ONE_CLIENT_SECRET`, `ONE_CONNECT_KEY` and `ONE_REDIRECT_URI` in the environment, and `npm run dev` starts with Sign in with One live.
- Rill: they register `http://localhost:51789/api/one/callback` on the app, then paste the client ID, client secret, Connect key and permission set at http://localhost:5180/setup/connect. Sign-in turns on without a restart.
- Search: they run `pnpm connect`, approve the Connect app in the browser (its ids go into `.env`, its redirect is `http://localhost:52289/api/one/callback`), then paste the client secret and Connect key at http://localhost:5680/setup/connect. Sign-in turns on without a restart.

Secured by One. Each user connects their own accounts and can revoke them any time.

## More

- https://forkable.dev/llms.txt, the index
- https://forkable.dev/templates.json, the catalog
- https://forkable.dev/.well-known/agent-skills/forkable/SKILL.md, the same job as an installable skill
- https://github.com/withoneai/forkable, the source
