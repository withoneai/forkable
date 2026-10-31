# @search/ui

The Search web app: Vite, React 19, Tailwind 4, TanStack Query, React Router.
Dev port 5680, proxying `/api`, `/mcp`, `/oauth`, `/.well-known`, `/authorize`,
`/token`, `/register` and `/revoke` to the server on 127.0.0.1:52289
(`VITE_API_TARGET` overrides it).

## Run

```sh
pnpm --filter @search/ui dev:mock     # no server needed: the browser answers every /api route from the Acme sample
pnpm --filter @search/ui dev          # real server on 52289 (start it first, or use the root `pnpm dev`)
pnpm --filter @search/ui typecheck
pnpm --filter @search/ui build
node ui/scripts/smoke-ui.mjs          # Playwright smoke; starts its own mock UI on 5681
SMOKE_URL=http://localhost:5680 node ui/scripts/smoke-ui.mjs   # against a running UI, mock or real
node ui/scripts/shoot.mjs [outDir] [1024,1280,1536]            # QA screenshots, light and dark
```

The mock is switched by `VITE_MOCK=1` only. Unset it and the same code talks to
the real server; no screen knows which one answers.

## Layout

| Path | What |
|---|---|
| `src/contract/api-types.ts` | Types re-exported from `@search/core` (`api-types.ts`, `contract.ts`). Types only. |
| `src/contract/query.ts` | `parseQuery`, `formatQuery`, `applyChip` from `@search/core/query/parse`, plus UI helpers (`opValues` as strings, `freeText`, `isQuestion`, `partialOperator`, `resolveDate`). |
| `src/contract/keymap.ts` | The keyboard table. The `?` sheet and the palette render from it. Move to `@search/core/keymap.ts` when core ships one (CONTRACT section 1 lists it). |
| `src/lib/` | `api.ts` (every CONTRACT 6.2 route), `queries.ts` (query keys from CONTRACT 9), `events.tsx` (one EventSource, invalidations per event), `chatStream.ts` (POST /chat SSE reader), `keys.ts` (Rill's global key layer), `workspace.tsx` (the list, preview and dock share one selection and one query), theme, scale, toast. |
| `src/components/` | Shell (sidebar, rail, dock slot), CommandPalette, Cheatsheet, Logo (the S mark), SourceLogo, `results/` (box, chips, rows, entity strip, answer strip), `preview/`, `chat/` (dock, citations, proposal card, composer), `profile/` (New profile steps), `ui/` (Rill's primitives). |
| `src/screens/` | SearchPage (home and results), EntityPage, SourceDetail, Access, ConnectSetup, Start, `settings/` (General, Integrations, New profile sheet, Search, Assistant, Database, API). |
| `src/mock/` | Dev-only server: `world.ts` (the Acme cast and storylines, about 60 items across the 11 sources), `search.ts` (operators applied in memory), `routes-*.ts`, `catalog.ts` (Zendesk sample for the New profile flow). Never bundled without `VITE_MOCK=1`. |

## Logo

`src/components/Logo.tsx` renders the S mark from the Forkable brand kit
(`src/assets/brand/`, plus `public/favicon.*` and `public/brand/icon/`),
copied by `node ../scripts/sync-brand.mjs`. Never hand-edit the copies.

## Contract gaps the UI ran into

All 13 were decided and built in Phase 2: see `docs/CONTRACT.md` section 14.
The list below is the original record.

Things the UI needed that `docs/CONTRACT.md` does not define yet. The mock
answers them in the shape noted, so the server can match or the contract can
say otherwise.

1. **No `GET /profiles/:id`, and `ApiProfile.json` has no guarantee on the list route.** The source Fields tab needs the full profile. The mock fills `json` on `GET /profiles`.
2. **`ProposalOutput.fieldNotes[].target` has no vocabulary.** The field map understands `fields.<name>`, `facets.<name>`, `list.idPath`, `refs.<role>` and `is.email`. The contract should list the allowed targets.
3. **`ValidationIssue.sampleIds` has no order rule**, so "fails on 2 of 5 samples" cannot be tied to the preview pager reliably.
4. **`Citation` has no item kind.** The hover card cannot say Deal or Mail without fetching the item. Suggest `kind: ItemKind`.
5. **No model name for sample answers.** The mock sends `model: "fixture"` for replayed answers and `"extractive"` for the no-model answerer (SPEC 11.4); the UI labels them "Sample answer, replayed" and "Sample answer, no model". The contract should fix these two strings.
6. **`ChatEvent` has no message id on `done`.** The dock writes the finished assistant message into the chat cache itself. `{ type: "done"; messageId }` would let it refetch instead.
7. **`ConnectSetupResponse` has no "the ask changed" flag.** "Update the Connect app" shows whenever a client id is saved. Suggest `create.askChanged: boolean` (SPEC D26).
8. **`AccessResponse` has no grant status or mode.** The grant card cannot say Active, Reconnect required or Sample. Suggest `status: "active" | "reconnect_required" | "revoked" | "none"` and `mode: "fixture" | "connect"`.
9. **`EntityChip` has no `isSelf` and no email.** The From and With chips need "Me" and need to keep the user out of the people list; the UI compares names against `/me`. Suggest `isSelf: boolean` on `EntityChip`.
10. **`GET /entities` caps at `limit=10`.** The chip menus want every person and company with items. Suggest allowing `limit` up to 200.
11. **Scope is not in the URL contract.** CONTRACT 9 says the box state is `/?q=`; the UI also keeps `scope` and `sort` in the URL (`/?q=...&scope=deal&sort=newest`) so a scoped search is linkable.
12. **No "recently opened items" route.** search-ux-mobbin.md 2.1 mixes recently opened items into Recent on home; only `/recent-searches` exists, so home shows searches only.
13. **Rerank `reason` for the sample.** The mock answers `reranked: false, reason: "sample_no_fixture"` for every query; fine, but the list's "reranked by Jev" line is untested until the server serves `fixtures/sample/rerank.json`.
