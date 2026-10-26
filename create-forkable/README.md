# create-forkable

```
npm create forkable@latest my-business --for "real estate agents" --in "Los Angeles"
```

Copies the [Forkable](https://forkable.dev) starter into `./my-business`,
fills in `local/profile.md` with who it's for and where, makes a fresh
git history, installs, and runs the keyless Acme Inc demo. No account and
no keys needed for any of that.

```
Usage: npm create forkable@latest <name> [options]

  <name>              Directory and project name for the new fork.

Options:
  --for <who>         Who this fork is for, e.g. "real estate agents".
  --in <where>        Where, e.g. "Los Angeles". Written into local/profile.md.
  --template <id>     Template to copy. Default: forkable-starter.
  -h, --help          Show this help.
```

Two templates ship in this package: `forkable-starter` (the default, a
small single-package app), and `rill` (`--template rill`), a full AI
email client with its own pnpm workspace, database and UI. A template
that ships a `pnpm-workspace.yaml` installs and runs with pnpm instead of
npm; everything else needs nothing beyond Node. More official and
community templates are coming; see [forkable.dev](https://forkable.dev).

MIT licensed.
