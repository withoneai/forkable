# forkable.dev

The Forkable landing page: a static Vite + React + Tailwind site, prerendered
to HTML, with agent-readable twins (`/llms.txt`, `/index.md`, `/start.md`,
`/templates.json`, the agent skill). Copy for agents lives in `agent/`; the
template list comes from `../create-forkable/catalog.json`.

```
pnpm install
pnpm dev                 # http://localhost:5173
pnpm build               # dist/, prerendered pages and agent files
pnpm preview --port 4173
```

The blocks gallery is served under `/blocks/`: build `../blocks` and copy its
`dist/` into `dist/blocks/` before deploying.

Deploy: Workers Static Assets (`wrangler.jsonc`). Change `name` and remove
or replace the forkable.dev `routes` before deploying your own copy.

MIT for the code. The Forkable name and marks in `public/` are not covered
by the license.
