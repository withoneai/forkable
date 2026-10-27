# Forkable

Fork a business. The team comes with it.

```
npm create forkable@latest my-business --for "real estate agents" --in "Los Angeles"
```

This repo has two things:

- **[`starter/`](./starter)** — the base every Forkable business starts
  from. [One Connect](https://withone.ai) prewired, a keyless Acme Inc
  demo that exits 0 with no account and no keys, one runtime agent to
  build on, and a go-to-market kit.
- **[`create-forkable/`](./create-forkable)** — the `npm create forkable`
  CLI. Copies the starter, fills in who a fork is for and where, installs,
  and runs the keyless demo.

See each folder's own README for details.

## Contributing

Build a business on the starter and publish it as a template, or help
with the starter and the CLI. [CONTRIBUTING.md](./CONTRIBUTING.md) covers
giving your coding agent One's integrations (CLI or MCP), what the starter
already handles, the template checklist and how to send a pull request.
The short version is at [forkable.dev/contribute](https://forkable.dev/contribute).

MIT licensed.
