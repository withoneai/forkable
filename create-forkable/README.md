# create-forkable

```
npm create forkable@latest my-business --for "real estate agents" --in "Los Angeles"
```

Copies the [Forkable](https://forkable.dev) starter into `./my-business`,
fills in `local/profile.md` with who it's for and where, makes a fresh
git history, installs, and runs the keyless Acme Inc demo. No account and
no keys needed for any of that.

Every fork is a whole business to run: the app, its agents, a
go-to-market kit and the code. Integrations and Sign in with One come
built in, so your users sign in and connect their own tools. To go live
you make one Connect app in the One dashboard. Secured by One.

```
Usage: npm create forkable@latest <name> [options]
       npm create forkable@latest -- --list [--json]

  <name>              Directory and project name for the new fork.

Options:
  --for <who>         Who this fork is for, e.g. "real estate agents".
  --in <where>        Where, e.g. "Los Angeles". Written into local/profile.md.
  --template <id>     Template to copy. Default: forkable-starter.
                      A name that matches a template id (rill) picks it.
  --list              Print the template catalog and exit.
  --json              Machine output: one JSON object on stdout.
  --no-json           Force human output.
  --no-install        Copy and commit only. Skips install and the demo.
  --no-demo           Install, but do not run the keyless demo.
  -y, --yes           Never prompt (there are no prompts; accepted for scripts).
  -v, --version       Print the version.
  -h, --help          Show this help.
```

Two templates ship in this package: `forkable-starter` (the default, a
small single-package app), and `rill` (`--template rill`), a full AI
email client with its own pnpm workspace, database and UI. A template
that ships a `pnpm-workspace.yaml` installs and runs with pnpm instead of
npm; everything else needs nothing beyond Node. More official and
community templates are coming; see [forkable.dev](https://forkable.dev).

## For coding agents

create-forkable never prompts, and it never overwrites a directory.

```
npm create forkable@latest -- --list --json
npm create forkable@latest my-inbox -- --template rill --json --yes
```

`--list` reads the live catalog at https://forkable.dev/templates.json
(2.5 second timeout) and falls back to the `catalog.json` bundled in this
package (`FORKABLE_OFFLINE=1` skips the fetch, `FORKABLE_CATALOG_URL`
overrides it). Only templates with `"status": "available"` can be forked; a
coming-soon id stops with `TEMPLATE_COMING_SOON`.

With `--json`, every human line (install logs, the demo, the template's
welcome) goes to stderr, and stdout gets exactly one JSON object at the
end:

```json
{
  "ok": true,
  "dir": "/abs/path/my-inbox",
  "template": "rill",
  "version": "0.1.0",
  "cliVersion": "0.3.0",
  "packageManager": "pnpm",
  "packageManagerCommand": "pnpm",
  "installed": true,
  "demoExitCode": 0,
  "git": true,
  "nextSteps": [{ "read": "/abs/path/my-inbox/AGENTS.md", "why": "..." }],
  "envNeededToGoLive": ["..."],
  "agentsMd": "/abs/path/my-inbox/AGENTS.md",
  "warnings": [],
  "welcome": "/abs/path/my-inbox/forkable/welcome.mjs"
}
```

`version` is the template's version, `cliVersion` is this package's. A
failure prints the same object with `"ok": false`, a stable `code` and
`error: { code, message, fix }`, and exits non-zero: `USAGE` and
`NAME_MISSING` (2), `DIR_EXISTS`, `UNKNOWN_TEMPLATE`,
`TEMPLATE_COMING_SOON`, `TEMPLATE_NOT_BUNDLED`, `PNPM_MISSING`,
`INSTALL_FAILED`, `DEMO_FAILED` (the demo's own exit status) and
`INTERNAL` (1).

JSON mode also turns on by itself when stdin is not a TTY and either `CI`
is set or stdout is not a TTY. A person piping the output to a log still
has a TTY on stdin and keeps the human output. `--no-json` forces it off.

A template with a `pnpm-workspace.yaml` (Rill) needs pnpm. When pnpm is
not on PATH, create-forkable tries `corepack pnpm` and stops with
`PNPM_MISSING` only if that fails too.

The demo needs no account and no keys. Going live does: a person makes
one Connect app in the One dashboard. Stop there and ask them. Never ask
for, copy or write a secret, and read the fork's `AGENTS.md` before
changing code.

MIT licensed.
