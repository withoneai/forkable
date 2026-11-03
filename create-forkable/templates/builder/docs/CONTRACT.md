# Builder: contract

The glue between `packages/harness`, `packages/core`, `packages/template`,
`server`, `ui` and `cli`. The code is the final word on field names: types live in
`packages/harness/src/types.ts`, `packages/core/src/types.ts` and
`packages/core/src/api-types.ts`.

The product name is `BRAND` in `packages/core/src/brand.ts`. Below, "builder"
means `BRAND.slug`, "Builder" means `BRAND.name`, `BUILDER_` means
`BRAND.envPrefix`.

---

## 1. Packages and who owns what

| Package | Owns | Never imports |
|---|---|---|
| `@builder/harness` | find and drive the CLIs: resolver, executor, parsers, adapters (claude-code, codex, openclaw, replay), env, permission flags, model catalogs | server, DB, UI |
| `@builder/template` | the generated-app template (files with brand tokens), `render.ts`, `warm.ts`, `TEMPLATE_VERSION` | core, server |
| `@builder/core` | domain logic, no HTTP: DB, workspace, git, checkpoints, turns, auto-fix, errors, dev servers, verifier, shims, process scan | server, ui |
| `@builder/server` | Hono on 51989, preview proxy on 51990, SSE hub, routes, injected preview client (`server/src/preview/client/`) | ui |
| `@builder/ui` | Vite + React 19 editor on 5380 (dev) or served from 51989 (built) | core runtime (types only: `@builder/core/types`, `@builder/core/api-types`, `@builder/harness/types`) |
| `@builder/cli` | `builder start|demo|doctor` | ui |

## 2. Workspace on disk

```
$BUILDER_HOME (default ~/.builder)
  .env                    the Connect app vars when the Keychain is not used (mode 0600); never read by agents
  env-index.json          names, where each value is stored, when it changed (no values, mode 0600)
  state/<projectId>/app.env  a project's values when the Keychain is not used (mode 0600)
  config.json             Settings (types.ts Settings)
  db/                     embedded Postgres data dir
  shims/                  builder-one, one, pnpm, npm, npx, vite, wrangler, steer-hook.mjs, mcp.mjs
  cache/catalog/          catalog answers
  cache/template/<v>/     warm template: rendered files + node_modules, installed once
  state/<projectId>/      spill files, turn logs, openclaw state (never in git)
  projects/<slug>/        one git repo per app
```

Slug: `[a-z0-9-]{3,40}`, unique, from the first prompt or name.

## 3. Ports

| What | Port |
|---|---|
| Platform server (API, SSE, relay, built UI), 127.0.0.1 only | 51989 pinned; refuse to start when taken and name the holder |
| UI dev | 5380, proxies `/api` to 51989 |
| Preview proxy | 51990 pinned, `http://<slug>.localhost:51990/` |
| Project dev servers | 52000 to 52999, bind test, recorded per project, `strictPort` |
| Embedded Postgres | first free from 51995 |

At most 3 dev servers run; the least recently viewed stops after 15 idle
minutes. Turn concurrency: 2 globally, 1 per project.

Every harness process env carries `BUILDER_AGENT=1`, `BUILDER_PROJECT_ID`,
`BUILDER_TURN_ID`. The dev server env carries `BUILDER_PROJECT_ID`,
`BUILDER_DEV_PORT`, `BUILDER_HMR_PORT=51990`, `BUILDER_RELAY_URL`,
`BUILDER_RELAY_TOKEN` (never `BUILDER_AGENT`).

## 4. Harness

Interface: `packages/harness/src/types.ts`. Beyond the basic turn fields (all
optional or derivable): `TurnInput.stateDir`, `TurnInput.turnId`,
`TurnInput.settingsJson` (Claude `--settings` JSON built by core: steer hook +
`permissions.deny`), `TurnInput.replay` (`{file, index?, speed?}`),
`HarnessInfo.note`, `ZERO_USAGE`, `McpSpec.name`, `TurnInput.priorCostUsd`,
`TurnResult.sessionCostUsd` (stored in `turns.session_cost_usd`, passed back on
the next Claude resume so cost stays a per-turn delta), `tool_start.input`
(MCP tools only). A `text` event is a finished block and replaces the
`text_delta`s before it.

Verified, see each adapter's header: Claude
`--session-id` with `-p` stream-json, `--permission-prompts none`, deny
rules, `--setting-sources project,local` skipping user hooks while
`--settings` hooks still run; Codex needs `default_tools_approval_mode =
"approve"` for MCP calls under `codex exec`, its MCP child reaches
127.0.0.1 with the sandbox on while a shell `curl` does not (so Codex gets
the catalog over MCP, never the `builder-one` shim); OpenClaw 2026.8.1 fails
every run here on its own missing-runtime error.

Entry points (`@builder/harness`):

```ts
export function getHarness(id: HarnessId): Harness;
export function detectAll(opts?: { force?: boolean; includeReplay?: boolean }): Promise<HarnessInfo[]>;
export const DENY_LIST: string[];                 // every level
export const BUILD_ALLOW: string[];               // Claude build allow list
export function cleanEnv(base?: NodeJS.ProcessEnv): Record<string, string>;
export function agentEnv(o: { projectId: string; turnId: string; shimsDir: string; base?: NodeJS.ProcessEnv }): Record<string, string>;
export function resolveBin(name: string): Promise<string | null>;
export function runProcess(...)                   // executor, used by core for installs too
```

Replay scenario (`fixtures/replay/<scenario>.json`):

```json
{ "turns": [ { "match": "optional substring of the prompt",
               "events": [ HarnessEvent ],
               "writes": [ { "path": "src/App.tsx", "content": "..." } ],
               "delete": [ "src/old.ts" ],
               "delayMs": 40 } ] }
```

Turn selection: `input.replay.index` if given, else the first turn whose
`match` is a substring of the prompt, else turns in order by a counter kept in
`<stateDir>/replay-<scenario>.json`. Writes are applied after the events
before the last one, so a watcher sees files land mid-turn.

## 5. Generated project

`packages/template` is a workspace member whose `package.json` is the app's
own (name rewritten at render). Its files carry brand tokens, only inside
strings and prose so the template typechecks in the workspace:

| Token | Value |
|---|---|
| `__BRAND_NAME__` | `BRAND.name` |
| `__BRAND_SLUG__` | `BRAND.slug` |
| `__ENV_PREFIX__` | `BRAND.envPrefix` |
| `__PROJECT_NAME__` | project name |
| `__PROJECT_SLUG__` | project slug |
| `__BRAND_PROJECT_DIR__` | `BRAND.projectDir` |
| `__BRAND_HOME_DIR__` | `BRAND.homeDir` |
| dir `_project_dir_/` | `BRAND.projectDir` |
| `_gitignore`, `_AGENTS.md`, `_CLAUDE.md`, `_claude/`, `_agents/` | the real names (stored renamed so they do not act inside this workspace) |

`@builder/template/render`:

```ts
export const TEMPLATE_VERSION: string;   // "1" + content hash, recorded as templateVersion
export function renderTemplate(dest: string, vars: { name: string; slug: string; projectId: string; brand: typeof BRAND }): Promise<void>;
export function warmTemplate(cacheRoot: string, brand, log): Promise<string>; // cache/template/<v>, pnpm install --offline (prefer-offline fallback)
```

Scaffold (core `workspace.ts`): `cloneTemplate(cache/template/<v>,
projects/<slug>)` (APFS clone, with native binaries symlinked back to the
warm cache so macOS does not re-scan them from a new path), then `applyProjectVars`, `.dev.vars`,
`git init`, commit "Template". An old `cache/template/<v>` is never deleted
while projects made from it exist. The dev server env never carries
`NODE_ENV` (production turns Fast Refresh off).

Dev server: the platform spawns `node node_modules/vite/bin/vite.js` in the
project with the dev env above. `vite.config.ts` reads them:
`server.port = BUILDER_DEV_PORT`, `strictPort`, `host 127.0.0.1`,
`hmr.clientPort = BUILDER_HMR_PORT`, `allowedHosts [".localhost"]`.
With `BUILDER_PROJECT_ID` unset it is a plain Vite app.

`tools/dev-tagger.ts`: adds `data-builder-loc="src/App.tsx:42:8"` (1-based
line, 1-based column) to intrinsic JSX in `src/**`; posts build errors to
`${BUILDER_RELAY_URL}/errors` (`DevServerErrorBody`, `Authorization: Bearer
<relay token>`), and `{clear: true}` after a good update.

`tools/guard-dev.mjs`: exits 1 with "The preview runs inside Builder. Use
project_add_dependency to add a package." when `BUILDER_AGENT=1`.

## 6. Preview proxy and injected client

- `/__builder/client.js` (built by esbuild from `server/src/preview/client/`
  at server start, brand slug and editor origin injected with `define`).
- `POST /__builder/events`: body `PreviewBeacon | PreviewBeacon[]`.
- `GET /__builder/ping` -> `{ok: true, slug}`.
- HTML responses get `<script src="/__builder/client.js" defer></script>`
  before `</head>`.
- Dev server down or starting: a "Starting preview" page that polls
  `/__builder/ping?ready=1` and reloads.
- Channel messages: `PreviewToEditor` / `EditorToPreview` in `api-types.ts`.
  Every message carries `source: "builder-preview"` or `"builder-editor"`. The
  iframe posts to `http://127.0.0.1:51989` and also to `http://127.0.0.1:5380`
  when the editor runs from UI dev (the UI
  dev port must work too). The client accepts editor messages from those two
  origins only.
- Select mode: hover outline, click selects (Cmd/Ctrl-click adds), ArrowUp
  and ArrowDown walk ancestors and children, Esc leaves. In select mode the
  client forwards S, Esc, Cmd+K and `?` to the editor as `key` messages.

## 7. Errors and auto-fix

`signature = sha1(source + "\n" + normalized message + "\n" + file:line)`.
Normalized: numbers in `?v=...`, hashes, ports, absolute project paths and
timestamps removed. An open error is one with `resolvedAt = null`.

Resolution rules: `types` rows resolve when the next `tsc` pass no longer
reports them; `build` rows resolve on a `clear` from the dev-tagger or a
clean HMR; `runtime`, `network`, `console` rows resolve when the verifier's
fresh load after a turn does not see them again (rows from before the load).

Auto-fix: max 3 fix turns per user turn; stops early on a
repeated signature; `POST /fix` resets the budget.

Types: core runs `tsc --noEmit -p .` once per settle, plus a run on Code
saves, without a resident `--watch` process per project.

## 8. Checkpoints

One commit per turn that changed the tree. Trailers `Builder-Turn`, `Builder-Harness`,
`Builder-Session`, `Builder-Kind`. Restore never uses `reset --hard`.
The "Template" commit has `Builder-Kind: template`.

## 9. Server API

Editor routes need `Origin` absent or one of `http://127.0.0.1:51989`,
`http://localhost:51989`, `http://127.0.0.1:5380`, `http://localhost:5380`
and refuse preview origins
(`*.localhost:51990`). Errors are `ApiError`.

```
GET   /api/health                                  HealthResponse
GET   /api/me                                      MeResponse (me null until sign-in)
GET   /api/harnesses?force=1                       HarnessesResponse
GET   /api/settings  PATCH /api/settings           SettingsResponse
GET   /api/projects                                ProjectsResponse
POST  /api/projects                                CreateProjectBody -> CreateProjectResponse (201)
GET   /api/projects/:id                            ProjectResponse
PATCH /api/projects/:id                            ProjectPatch -> ProjectResponse
DELETE /api/projects/:id?deleteFiles=1             204
POST  /api/projects/:id/turns                      CreateTurnBody -> CreateTurnResponse (202)
POST  /api/projects/:id/turns/:turnId/cancel       { turn }
POST  /api/projects/:id/turns/:turnId/steer        {text} -> { queued: true }
GET   /api/projects/:id/turns?before=              TurnsResponse (newest first, 30 per page)
GET   /api/projects/:id/turns/:turnId/events?after=<seq>   TurnEventsResponse
GET   /api/projects/:id/events                     SSE, ProjectEvent
GET   /api/projects/:id/files                      FilesResponse (whole tree, gitignored and node_modules excluded)
GET   /api/projects/:id/file?path=                 FileResponse
PUT   /api/projects/:id/file                       PutFileBody -> FileResponse
POST  /api/projects/:id/checkpoint                 CheckpointResponse
GET   /api/projects/:id/checkpoints                CheckpointsResponse (newest first)
GET   /api/projects/:id/checkpoints/:sha/diff      DiffResponse
POST  /api/projects/:id/checkpoints/:sha/restore   CheckpointResponse
POST  /api/projects/:id/checkpoints/:sha/bookmark  {on} -> CheckpointResponse
GET   /api/projects/:id/errors?open=1              ErrorsResponse
POST  /api/projects/:id/fix                        FixBody -> CreateTurnResponse
POST  /api/projects/:id/preview/restart            ProjectResponse
POST  /api/projects/:id/preview/viewed             204 (keeps the dev server warm)
GET   /api/projects/:id/shots/:file                image/png
GET   /api/turns/:turnId/steer                     turn token; {text: string | null} (Claude hook)
POST  /api/relay/:projectId/errors                 relay token; DevServerErrorBody
GET   /api/me                                      MeResponse {me, grant: "one"|"sample"|null, connectApp, signInUrl}
GET   /api/one/authorize?returnTo=  GET /api/one/callback   the builder's Connect app (sets builder_sid)
POST  /api/one/disconnect                          MeResponse
POST  /api/relay/:projectId/run                    relay token; RelayRunBody -> RunResult (403 local | 423 held | 403 one/sample | provider status)
GET   /api/relay/:projectId/me                     relay token; {user, grant, canSignIn}
GET   /api/relay/:projectId/authorize?returnTo=    no token (redirect only)
POST  /api/catalog/{find,load,platforms,granted,add,remove,scopes}   turn token; {markdown, needsConnection?}
POST  /api/mcp/:tool                               turn token; one_find_actions, one_load_action, one_platforms,
                                                   one_granted, one_add_action, one_remove_action, one_scope_preview,
                                                   project_errors, project_add_dependency, project_screenshot (text)
GET   /api/projects/:id/scopes                     ScopesResponse (+ askMissing, warnings, platforms, verbs)
GET   /api/projects/:id/grant                      GrantResponse
GET   /api/projects/:id/activity?before=<id>       ActivityResponse (rows, nextBefore, receipts)
POST  /api/projects/:id/access/test-local {platform}  AccessTestResponse
POST  /api/projects/:id/access/test-one   {platform}  AccessTestResponse
```

SSE adds `scopes.changed {manifest, diff}` and `activity {row}`; the feed adds
`connect_needed {platform, name}` and `asks_more {lines}`.

SSE: `ProjectEvent` (`event:` = `type`, `data:` = JSON, `id:` = a counter),
a heartbeat every 25 s, and a replay of the running turn's ring buffer
(`turn.started` + its `turn.event`s) to a client that connects late.

## 10. Turn lifecycle

`queued -> running -> settling -> verifying -> (fixing n) -> done | failed | cancelled`.

- **running**: before spawning: commit "Manual edits" if the tree differs from
  HEAD; snapshot. The harness streams events (stored in `turn_events`,
  broadcast as `turn.event`).
- **settling**: wait for 1.5 s with no file change, run an install when
  `package.json` changed, run `tsc`.
- **verifying**: Playwright on the preview, shot to
  `.builder/shots/<turnId>.png`.
- Commit if the tree changed (checkpoint event, `checkpoint.created`).
- **fixing**: a child turn (`kind: "fix"`, `parentTurnId`, `fixAttempt`) runs
  the same lifecycle; the parent's status is `fixing` while it runs and ends
  `done` or `failed` after the last child.
- Messages sent while a turn runs: on Claude they are steered (read after the
  next tool call); elsewhere they wait as a `queued` user turn.

## 11. DB

Drizzle over embedded Postgres in `$BUILDER_HOME/db`. Tables
(`users`, `sessions`, `connect_users`, `settings`, `projects`, `turns`,
`turn_events`, `checkpoints`, `errors`, `activity`, `publishes`). Settings live in
`config.json`, not the table.

## 12. One built in

Read with section 18: there is no builder-level
Connect app (`connect` is now `ConnectSetups`, per project), the catalog
runs through the One CLI, and the relay is replaced by the app's own One
calls plus the local check. The manifest, codegen and receipt rules below
still hold.

Core services on `Platform`: `connect` (ConnectService: the builder's Connect
app from `BUILDER_HOME/.env`, sign-in, whoami, merge by cu_ then One user id
then email), `catalog` (find/load/platforms/granted, 24 h disk cache),
`scopes` (actions.json, actions.gen.ts, the live and committed manifest),
`activity`, `relay`, `access` (the two refusal tests).

Grant kinds: `one` (the builder's real key-mode grant) and `sample` (the stub
from `fixtures/`, `grant: "sample"` or `BUILDER_STUB_GRANT=1`). Receipt and
Activity sources: `one`, `local`, `held`, `sample`, plus `platform` for
catalog reads. Formats in `packages/core/src/receipts.ts`; only `one` and
`sample` produce "declined, 403".

Files per project: `.builder/actions.json` (`InstalledAction[]`),
`server/one/actions.gen.ts` (generated, read-only in Code),
`.builder/scopes.json` (`Manifest`, written after every turn and committed
with it). Manifest rows: `platform, connDefId, actionId, title, method, level`.
Errors from the extractor are source `manifest`, message prefixed with the
BLD code; BLD005 is a warning and never enters the fix loop.

Relay body (`server/one/client.ts` preview mode): `{platform, actionId,
method, path, title, body?, query?, pathParams?, headers?}`. Answers:
`{ok: true, status, data}`; local `{ok: false, status: 403, source: "local",
blockedByManifest: true, blockedByGrant: false, refusal}`; held `423`;
grant `{ok: false, status: 403, source: "one"|"sample", blockedByGrant: true,
refusal}`; provider errors `{ok: false, status, data}`.

## 13. Publish

Core: `PublishService` on `Platform.publish` (`packages/core/src/publish/`):
`actions.ts` (the catalog ids below), `files.ts` (upload set from
`git ls-tree` at the sha, blobs via `git cat-file --batch`, skip > 10 MB,
block > 2,000 files), `scan.ts`, `github.ts`, `vercel.ts`, `service.ts`.
Every call is `runAction` on the builder's grant with the builder's
connection key for `github` / `vercel`, and one Activity row with source
`platform`. Nothing publishes while a turn runs (409 `turn_running`).

```
POST  /api/projects/:id/publish/scan {sha?}       {scan: ScanResult}
POST  /api/projects/:id/publish PublishBody      202 PublishStartResponse; 409 scan_blocked carries {scan}
GET   /api/projects/:id/publishes                PublishesResponse (history, targets, head, hasAppTables, busy)
```

SSE adds `publish.progress {target: "scan"|"github"|"vercel", publishId,
step, status, detail}` and `publish.done {publish}`. Types in
`api-types.ts` (`ScanResult`, `ScanFinding`, `PublishRecord`, ...).
`publishes` gained `result`, `options`, `steps`, `error`, `grant`
(migration 0003). `options` keeps repo and visibility, or project, client
id, ask id and the database host. Never a token.

Catalog actions (all `conn_mod_def::`): GitHub create repo
`GJ3Z4tE4G5A::lTHBrlzlSouqu-x8AHeT3Q`, blob `GJ3ZJkM0oow::6pCvkMJYSue8xhH4Bvy6eQ`,
tree `GJ3ZKCHKkUA::xHBDE-LtSkWfVdTQxLIp3g`, commit `GJ3ZJrwmLbo::Rp9vt2o3RBqDxBLQ1sRRng`,
get ref `GJ3ZKe5vDKs::xb13z7ZBRnOWekJ-N_TG3w`, create ref
`GJ3ZJzQSbw4::FMDSgh1WS5mvn2imiAkk2w`, update ref `GJ3ZK-BoUAw::f8MXbEVgQJ2sEdoPzO3NPA`.
Vercel create project `GIi2endVvxY::4QRYvqrsShinBQfxYdpIMA`, env
`GIi2iy8hP4o::Bn9C2U8RREySIMiqwHKn2w` (path `{{IDORNAME}}`), deployment
`GIi152aO03U::KTvTF_0ZTaS3tObzavwy0g`, and the status read:
**Get a Deployment by ID or URL `conn_mod_def::GIi15DgMrtk::4sacesKzT3abQ63_h7ZSfw`**
(GET `/v13/deployments/{{idOrUrl}}`). Promote and domain are listed, not
called. Path params are keyed as each path spells them
(`pathParams()` matches case-insensitively), since `@withone/connect`
fills `{{name}}` by exact key.

Template: `api/index.ts`
exports a Web handler that passes `process.env` as the Hono bindings;
`pnpm build:vercel` runs `tools/build-vercel.mjs`, which applies libSQL
migrations when `DATABASE_URL` is set (`tools/migrate-libsql.mjs`), builds
the client with `vite build --mode vercel` (no Cloudflare plugin) and
writes `.vercel/output` (Build Output API v3): `static/`, one Node.js
function `functions/api.func` (esbuild bundle of `tools/vercel-node.mjs`
around `api/index.ts`), routes `/api/*` to it then the SPA fallback.
`server/db/client.ts`: D1 when `DB` is bound, else libSQL over HTTP
(`drizzle-orm/libsql/web`). `/api/one/health` adds
`configured.databaseAuthToken`; `db` is true for D1 or a `DATABASE_URL`.

## 14. Quality

Routes:

```
POST  /api/projects/:id/edits        EditsBody {edits: DirectEdit[]} -> EditsResponse {applied, deferred[{loc, kind, reason}], checkpoint, turn}; 409 turn_running
POST  /api/projects/:id/attachments  raw image body (content-type image/png|jpeg|webp|gif, 8 MB) -> 201 {file, url}
GET   /api/projects/:id/attachments/:file
POST  /api/projects/:id/turns        CreateTurnBody.images = attachment file names; mode "plan" -> kind "plan"
POST  /api/projects                  CreateProjectBody.mode "plan" (Plan first on Home)
```

`DirectEdit` (types.ts): `{kind: "text", loc, before, after}`,
`{kind: "class", loc, remove[], add[]}`, `{kind: "comment", loc, text, tag?, excerpt?}`.
Core: `applyDirectEdits(projectPath, edits)`, `deferredPrompt`, `editSubject`
in `packages/core/src/edits.ts`.

Turn kinds add `plan` (read-only, permission `plan` for that turn) and
`edit` (a recorded divider for an applied edit checkpoint). Feed events add
`{t: "steer", text}` and `{t: "steer_read", count}`.

Channel : `PreviewMode` is
`none | select | text | comment`. Preview to editor adds
`edit-text {loc, tag, before, after}` and `comment {selection}`; editor to
preview adds `apply-class {loc, remove, add}` (live swap on every element
with that loc) and `pending {locs}` (dashed markers). In text mode a click on
an element with its own text makes it `contenteditable="plaintext-only"`;
Enter keeps, Esc undoes, blur keeps.

Template: `one(c, { as: "owner" })` runs public routes on the owner's grant
(`APP_OWNER_EMAIL` when published, the builder in preview).

Env for tools only (never set by the product): `BUILDER_SERVER_PORT`,
`BUILDER_PROXY_PORT`.

## 15. Visitors on the owner's grant

Off by default, per project and per action, set only by the builder.

```
PATCH /api/projects/:id/visitors VisitorsPatchBody {enabled?, allow?[], disallow?[], answer?{turnId, choice: "allow"|"keep", actionIds[]}}
      -> VisitorsResponse {visitors: VisitorGrant}; 403 editor_only without an Origin header
```

`VisitorGrant` (types.ts) is `{enabled, actions[]}`, stored in
`projects.visitor_grant` (migration 0004); effective ids are
`enabled ? actions : []`. Helpers in `packages/core/src/visitors.ts`
(browser-safe): `parseVisitors`, `patchVisitors`, `visitorSplit`,
`visitorEnvValue`, `runsAsOwner`, `runsAsUser`.

- Manifest: `CallSite.as?: "owner"`; `ManifestAction.runsAs?: ("user" |
  "owner")[]`, present only when a site runs as the owner (also in
  scopes.json then).
- `ScopesResponse` adds `visitors: VisitorGrant` and `visitorEnv` (the
  APP_VISITOR_ACTIONS value for the working tree).
- Relay: `RelayRunBody.as?: "user" | "owner"`. An owner-run call whose id is
  not allowed answers 403 `{source: "local", refusal: {code: "visitors_off"
  | "visitor_not_allowed"}}`, never calls One, writes a Local Activity row.
  Receipt line `<Platform> · <verb>   held locally, not allowed for
  visitors`, badge Local.
- Feed events: `{t: "visitors_needed", actions: [{actionId, line}]}` at the
  end of a turn, `{t: "visitors_answer", choice, actionIds}` when the
  builder answers the card.
- Scan findings: `visitor_not_allowed` (block, one per action),
  `visitor_writes` (warn, the allowed owner-run writes in `detail`).
  `ScanResult.visitorActions` is the env value at that sha.
- Published env: `APP_VISITOR_ACTIONS`, comma-separated action ids or
  `none`, plain, set on every Vercel deploy. The template's connect client
  refuses an owner-run id not in it with the same local codes.

## 16. Environment values

When an env var is needed, the product shows a safe UI to add it. Two scopes, one secure input: the builder's
Connect app (`builder`) and each project's app values (`project:<id>`).

Write-only. No route, SSE event, log line, error message, harness env,
prompt or project file ever carries a value. Responses carry names, set or
missing, where stored, when changed, and for non-secret ids the last four
(`…ab12`; the redirect URI in full). Secret-looking names (`isSecretName`,
unknown names count as secret) show nothing.

Storage (`packages/core/src/envstore.ts`): macOS login Keychain through
`/usr/bin/security -i` (the value on stdin, base64, read back to confirm),
service `builder.env`, account `<sha1(home)[0:10]>/<scope>/<NAME>`. Else,
or when the Keychain refuses: `BUILDER_HOME/.env` (builder) or
`state/<projectId>/app.env` (project), mode 0600. `env-index.json` (0600)
keeps names, where, updatedAt and non-secret hints. Hand-written lines in
`.env` still count (`manual: true`). `BUILDER_SECRETS=file|keychain` and
`BUILDER_ENV_PROBE=off` are for tools only.

Routes (`server/src/env.ts`). Every env route wants a loopback `Host`
(`127.0.0.1` or `localhost` on 51989 or 5380, against DNS rebinding) and
answers `cache-control: no-store`. Every change also wants an editor
`Origin` and the header `x-builder-csrf` equal to the per-process token
from the GET responses.

```
GET    /api/env/connect                 ConnectEnvResponse {vars, configured, store, redirectUri, dashboardUrl, signInUrl, grant, me, csrf}
PUT    /api/env/connect                 EnvSaveBody {values} -> ConnectEnvResponse; 400 EnvInvalidBody {error, fields}; reloads the Connect client (no restart)
DELETE /api/env/connect/:name           -> ConnectEnvResponse
POST   /api/env/connect/check           {values?} (typed, unsaved) -> ConnectCheckResponse {ok, items[{name, level, message}], online, onlineMessage}
GET    /api/projects/:id/env            ProjectEnvResponse {vars: ProjectEnvVar[], missing, publishMissing, store, csrf}
PUT    /api/projects/:id/env            EnvSaveBody -> ProjectEnvResponse; emits env.changed {names}; restarts a running preview
DELETE /api/projects/:id/env/:name      -> ProjectEnvResponse; same
```

Check: format per field (`validateConnectVar` in the browser-safe
`envvars.ts`, also run live in the form), then `POST
https://api.withone.ai/oauth/token` with the client id and secret and a
code that cannot exist: `invalid_grant` is "accepted", `invalid_client` or
401 is "refused", anything else "unreachable". Nothing is created or run.
With the stub grant it answers `sample` and calls nothing.

Project values (`envservice.ts`, `envscan.ts`):
- Names come from the code (`process.env.X`, `c.env.X`, `c.env["X"]`,
  `const { X } = c.env`, `import.meta.env.VITE_X` marked `client`; not
  `server/one/**`, not line comments), plus `APP_OWNER_EMAIL` when an
  action runs as the owner, plus whatever is stored. Platform and host
  names (`BUILDER_*`, `ONE_MODE`, `ONE_REDIRECT_URI`,
  `APP_VISITOR_ACTIONS`, `NODE_ENV`, ...) are refused.
- Target: `publish` for `DATABASE_URL`, `DATABASE_AUTH_TOKEN`,
  `APP_OWNER_EMAIL` and the app's own `ONE_CLIENT_ID`,
  `ONE_CLIENT_SECRET`, `ONE_CONNECT_KEY`, `ONE_PERMISSION_SET`; `both` for
  the rest.
- Preview: the dev server env gets `BUILDER_APP_ENV` (one JSON object of
  the `both` values); the template's `vite.config.ts` hands them to the
  Worker as vars (`c.env.X`, and `process.env.X` under nodejs_compat).
  Dev server output and error rows are scrubbed of every loaded value
  (`[hidden]`).
- Publish (Vercel): stored values fill the dialog's empty client id, ask
  id, database URL and token; the rest go in one env call of their own,
  every one `type: "sensitive"`. Error text is scrubbed of all of them.
  GitHub export carries code only.
- Feed event `{t: "env_needed", vars: [{name, why, sites}]}` at the end of
  a user or fix turn that touched a file reading a missing `both` name, or
  whose agent asked with `project_env` (a fix turn does not repeat its
  parent's names). The chat card "This app needs X" holds the secure input.
- MCP tool `project_env {request?: [{name, why}]}` (turn token): answers
  names and set or missing only. The per-turn facts add the same line.
- The deny list adds `Bash(security *)`; `.env*` and `state/**` were
  already denied.

Honest limit, as with the relay token: the app's own code runs with its
values in preview, so code the agent writes could print one into the
page. The values never reach the agent through the platform.

## 17. Preview this version, images on Home

Routes:

```
POST   /api/projects/:id/checkpoints/:sha/preview   -> 201 VersionResponse {version: VersionPreview}; 404 not_found (not in history)
GET    /api/projects/:id/version                    -> VersionResponse {version: VersionPreview | null}
POST   /api/projects/:id/version/viewed             204 (keeps the version's dev server warm)
DELETE /api/projects/:id/version                    204 (Back to current: stops it and removes its tree)
POST   /api/relay/:projectId/v/:short/run           version relay token; RelayRunBody -> RunResult (reads run; anything else 403 local version_preview)
GET    /api/relay/:projectId/v/:short/me            version relay token; {user, grant, canSignIn}
POST   /api/relay/:projectId/v/:short/errors        version relay token; accepted and dropped
GET    /api/relay/:projectId/v/:short/authorize     no token (redirect back to the version host)
POST   /api/attachments                             raw image body (image/png|jpeg|webp|gif, 8 MB) -> 201 {file, url}; staged, no project yet
GET    /api/attachments/:file   DELETE /api/attachments/:file
POST   /api/projects                                CreateProjectBody.images = staged file names, moved into the project for the first turn
PATCH  /api/settings                                Settings.pendingImages = staged names kept with pendingPrompt (filtered to files on disk)
```

`VersionPreview` (types.ts): `{projectId, sha, shortSha, subject, url,
state: PreviewState, step, message, openedAt}`. One per project; opening
another stops the first. SSE adds `version.status {sha, state, step?,
message?}` (the live preview keeps `preview.status`).

- Host: `http://<slug>--v-<shortsha>.localhost:<proxy>/` (`versionLabel`,
  `parseVersionLabel` in `packages/core/src/versions.ts`; a slug never holds
  `--`). A closed version answers a small "This version preview is closed"
  page. Beacons from a version host are dropped (not the project's errors).
- Tree: `state/<projectId>/versions/<sha12>/` from `git archive <sha> | tar
  -x` (HEAD, the index and the working tree are never touched, nothing is
  committed), `node_modules` an APFS clone (`cp -cR`) of the project's, a
  fresh `.wrangler` (the D1 migrations of that version applied to an empty
  database), its own `.dev.vars` with `BUILDER_RELAY_URL=.../api/relay/<id>/v/<short>`
  and a random token held in memory.
- Dev server: one more `DevServers` entry under `versionKey` (`<projectId>@<sha12>`),
  port from 52000 to 52999, counted in the 3 running, stops after 5 idle
  minutes (15 for live ones), tagged `BUILDER_PREVIEW_HOME` so the boot sweep
  stops it; the boot also removes every `state/*/versions` tree.
- Relay: the version's own manifest (derived from its tree); a call whose
  level is not `read` answers 403 `{source: "local", refusal: {code:
  "version_preview"}}` before One, with a Local Activity row and the line
  `<Platform> · <verb>   held locally, previewing an older version`.
- Keyboard: `V` (keymap `previewVersion`): in History, preview the
  highlighted version; while one is shown, back to current. S, T and C do
  nothing on a version preview. Palette: "Preview <subject>" per recent
  version and "Back to the current version".

## 18. Per-project Connect, the shared callback and the One CLI

Each project has its own optional One Connect. There is no Builder-level
Connect app, and Builder knows One through the local One CLI.

Model (`packages/core/src/connect.ts`, migration 0005). A **setup** is a
Connect app Builder was given: a `connect_setups` row (`id` `cs_...`,
`name`, `kind` `project` or `template`, `owner_project_id`, `sample`) and
its values in the env store under scope `connect:<setupId>`, write-only
(section 16 rules: Keychain first, never returned). Names:
`ONE_CLIENT_ID`, `ONE_CLIENT_SECRET`, `ONE_CONNECT_KEY` (required),
`ONE_PERMISSION_SET` (optional). `ONE_REDIRECT_URI`, `ONE_MODE` and
`ONE_API_URL` are the platform's and cannot be stored. A project's
`projects.one_connect` is `{ enabled, setupId, via }` with `via` `new`
(its own), `template` or `project` (another project's), linked by
reference. A copy makes the project's own setup with the values copied
inside the server. `enabled` needs a configured setup. Removing a setup is
refused (409 `in_use`) while any project links it. Removing a project
removes its own setup unless another project links it (then it stays,
unowned).

Every change below needs the editor's Origin, a loopback Host and the
`x-builder-csrf` token (from any GET here); a turn has none of them, so the
agent can never turn One Connect on. Every response is `no-store` and
carries names and status, never a value.

| Route | Does |
|---|---|
| `GET /api/connect/templates` | `ConnectTemplatesResponse`: templates, every project's own setup, the preview redirect URI, store, dashboard URL, csrf, sample |
| `POST /api/connect/templates` `{name, values?}` or `{name, fromSetupId}` | a new template (values checked first), or a copy of a setup saved as one |
| `PATCH /api/connect/setups/:sid` `{name}` | rename |
| `DELETE /api/connect/setups/:sid` | remove setup and values (409 while used) |
| `PUT /api/connect/setups/:sid/env` `{values}` | save values; running previews on it restart |
| `DELETE /api/connect/setups/:sid/env/:name` | remove one value |
| `POST /api/connect/setups/:sid/check` `{values?}`, `POST /api/connect/check` `{values}` | formats, then One's token endpoint with a code that cannot exist (`ConnectCheckResponse`; sample: format only) |
| `GET /api/projects/:id/connect` | `ProjectConnectResponse`: `connect`, `setup`, `owned`, `ready`, `redirectUris {preview, production, productionSource}`, `templates`, `others`, `usesOne`, `previewSignIn`, store, csrf |
| `PUT /api/projects/:id/connect` | `{use: "new", name?}` (own setup, left off), `{use: "template", setupId, copy?}`, `{use: "project", projectId, copy?}` (both turn it on), `{use: "none"}`, `{enabled}`; any of them with `answer: {turnId}` records the turn-end card's answer (`connect_answer` on or later), or `{answer: {turnId, choice: "later"}}` alone. A change of on/off or setup restarts the preview |
| `POST /api/projects/:id/connect/save-template` `{name}` | the project's setup saved as a template (a copy) |

Turn feed: after a user or fix turn whose manifest has actions while One
Connect is off, once per project until answered: `{t: "connect_offer",
platforms: [{platform, name}]}`; the answer `{t: "connect_answer", choice:
"on" | "later"}`. The UI card reads "This app uses Gmail. Turn on One
Connect for it?". The MCP tool `one_granted` reports the app's One Connect.

**Preview env** (`ConnectSetups.previewEnv`, through the dev server's own
env, never a file): off gives only `ONE_MODE=off`; on gives `ONE_MODE=connect`,
the setup's values and `ONE_REDIRECT_URI` = the shared preview callback,
plus on the sample `ONE_API_URL=<server>/api/stub-one` and
`BUILDER_ONE_SAMPLE=1`. `.dev.vars` carries only `BUILDER_DEV_URL`,
`BUILDER_DEV_TOKEN` and `BUILDER_PROJECT_ID`; version previews get
`BUILDER_DEV_URL=<server>/api/dev/<id>/v/<short>` and their own token.

**The shared preview callback.** `PREVIEW_CALLBACK` =
`http://127.0.0.1:51990/api/one/callback`, one registration for every
project. The app's `/api/one/authorize` first calls
`POST /api/dev/:projectId/oauth-state {state}` (or `/v/:short/oauth-state`)
with its dev token; the state must be the package's (base64url, 16 to 128
characters) and is kept in memory, at most 2000, for 10 minutes. The proxy
answers `GET /api/one/callback` on `127.0.0.1:51990`: it takes the state
once and redirects (302) to `http://<label>.localhost:51990/api/one/callback`
with only `code`, `state`, `error`, `error_description`, where `<label>` is
the project's slug (or `<slug>--v-<short>`) from the database, never from
the request. Unknown, used or expired state answers a 400 page. PKCE is
unchanged: the verifier cookie stays on the app's host, scoped to
`/api/one`, and the app exchanges the code with the same redirect URI.
Published: `https://<project>.vercel.app/api/one/callback`
(`redirectUriFor`), shown in Settings and Publish.

**The local check** (`packages/core/src/devgate.ts`), dev token
as Bearer:

| Route | Body | Answer |
|---|---|---|
| `POST /api/dev/:projectId/check` | `{platform, actionId, method, path, title, as?}` | 200 `{allow: true, level, source}` or 403/423 `{allow: false, body}` with the refusal and a Local or Held receipt |
| `POST /api/dev/:projectId/report` | `{platform, actionId, status, ok, blockedByGrant?, ms?, code?}` | `{ok: true}`; writes the Activity row, One's refusal as source `one` (`sample` on the stub) |
| `POST /api/dev/:projectId/ticket` | `{ticket}` | Access, Ask One: the call a one-use ticket stands for (2 minutes), once |
| `POST /api/dev/:projectId/v/:short/{check,report,oauth-state,errors}` | as above | a version preview: its own manifest, writes refused `version_preview`, errors dropped |

Ask One live: `POST /api/projects/:id/access/test-one` answers `{action,
ticket}` (needs One Connect on); the editor posts `{kind: "receipt-test",
ticket}` to the preview over the channel, the app's
`POST /api/one/dev/receipt-test` redeems it and runs the call on the
developer's sign-in, and the preview answers `{kind: "receipt-test",
ticket, status, blockedByGrant, message?}`. The receipt arrives as an
Activity row. On the sample the stub One answers in place.

**The One CLI** (`packages/core/src/onecli.ts`, `onesource.ts`). Builder
shells out to `one` (Node 22 first on its PATH when the system Node is
refused) and never reads the CLI's credential files. `OneCliStatus`:
`installed, path, version, node, signedIn, account {name, email}, mode
("cli" | "sample"), error, checkedAt, loginRunning, installHint`; cached 60
s, `force` re-runs `one --version` and `one --agent whoami`.

| Route | Does |
|---|---|
| `GET /api/one/cli?force=1` | `{cli}` |
| `POST /api/one/cli/refresh` | `{cli}`, checked again |
| `POST /api/one/cli/login` | starts `one login` (browser), `{cli}` with `loginRunning`; editor only (Origin), 409 `no_cli` when missing; stopped after 10 minutes |
| `GET /api/me` | `{me, grant, cli}`: the CLI's account, `grant` `one` when signed in, `sample` on the stub |

Uses: the catalog (`one --agent actions find`, `actions load`; schemas
from `~/.one/cache/knowledge/<id>.json` after a load), the builder's
connections for Publish (`one --agent list`), and publish: each GitHub or
Vercel action as a private one-step flow file (mode 0600 in a 0700 temp
dir, removed right after), so no body or secret is on a command line;
Vercel files go base64 since the flow runner reads `{{`. `PublishesResponse`
carries `cli` and `connect {enabled, setupName, productionRedirectUri}`;
Vercel gets the project's Connect values (`ONE_CLIENT_ID` plain, secret and
key sensitive) and `ONE_MODE=connect`, or `ONE_MODE=off` when One Connect is
off, and the scan blocks One calls in an app without One Connect. The
Publish dialog says "Runs on your One account through the One CLI".
Unverified live: no publish, execute or Connect app creation was run while
building this.

UI (`ui/src`): Settings, One CLI and Connect templates
(`screens/Settings.tsx`); the project's Settings tab, One Connect
(`components/editor/ProjectSettingsPane.tsx`, `/p/:id/settings`, Cmd 5);
the setup screen at project scope (`/setup/connect/:sid?project=:id`),
template scope (`/setup/connect/:sid`) and new template
(`/setup/connect?new=template`) (`screens/ConnectSetup.tsx`); the turn-end
card (`ConnectOfferCard` in `components/chat/TurnView.tsx`); Access section
2, Sign in with One; Publish. `scripts/smoke-ui.ts --connect-only` covers
them and writes shots to `docs/qa/per-project-connect/`.
