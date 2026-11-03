# Rename checklist

The product name lives in one constant, `BRAND` in
`packages/core/src/brand.ts`. Everything that can import it derives from it.
This list is what cannot, and what to touch when the name changes.

## Rendered automatically (no edit needed)

The template's files carry tokens that `packages/template/render.ts` fills
from the `BRAND` values core passes in, so generated projects pick up a
rename on their own:

| Token | From |
|---|---|
| `__BRAND_NAME__` | `BRAND.name` |
| `__BRAND_SLUG__` | `BRAND.slug` |
| `__ENV_PREFIX__` | `BRAND.envPrefix` |
| `__BRAND_PROJECT_DIR__` | `BRAND.projectDir` |
| `__BRAND_HOME_DIR__` | `BRAND.homeDir` |
| dir `_project_dir_/` | renamed to `BRAND.projectDir` |

Files with brand tokens: `_AGENTS.md`, `_claude/settings.json` (the
`Read(~/<homeDir>/**)` deny rule), `_gitignore`, `server/env.ts`,
`server/one/actions.gen.ts`, `server/one/client.ts`,
`server/one/connect.ts`, `tools/dev-tagger.ts`, `tools/guard-dev.mjs`,
`vite.config.ts`.

The preview client (`server/src/preview/client/`) takes the slug from
`buildPreviewClient({ slug })` at build time (`data-<slug>-loc`,
`/__<slug>/*`, the `<slug>-preview` and `<slug>-editor` message sources,
the `<slug>-overlay` element, `window.__<slug>_preview__`).

## Edit by hand

- Package names `@builder/*` in every `package.json` and the imports that
  use them (`@builder/core`, `@builder/harness`, `@builder/template`,
  `@builder/server`, `@builder/ui`, `@builder/cli`).
- The `bin` name `builder` in `cli/package.json`.
- `packages/template/package.json` `name` (`@builder/template`; rewritten to
  the project slug at render, so it only matters inside this workspace).
- The repo's root `package.json` `name`.
- `packages/harness/src/names.ts`: the harness cannot import `BRAND`, so the MCP
  server name `builder` and the env prefix `BUILDER_` are written there.
- `ui/src/lib/brand.ts`: the editor imports types only, so it repeats the
  name and slug there.
- `packages/template/server/one/session.ts` cookie `app_sid` (the published
  app's own cookie, brand-free on purpose; nothing to rename).

## Not to rename

- `ONE_*` variables and `@withone/connect`: One's names, not ours.
