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

Today the only template is `forkable-starter` itself, bundled in this
package. More official and community templates (a full business like
Rill or Brief, not just the base) are coming; see
[forkable.dev](https://forkable.dev).

MIT licensed.
