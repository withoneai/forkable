// HTTP + SSE contract between server and ui (docs/CONTRACT.md). Browser-safe.

import type { HarnessInfo, HarnessId, Permission } from "@builder/harness/types";
import type {
  ActivityRow,
  BuilderIdentity,
  CallSite,
  DirectEdit,
  CatalogPlatform,
  Checkpoint,
  GrantKind,
  OneCliStatus,
  ProjectConnect,
  Manifest,
  ManifestDiff,
  Receipt,
  ScopeIssue,
  FeedEvent,
  FileChange,
  FileEntry,
  PreviewState,
  Project,
  ProjectError,
  ProjectSummary,
  Selection,
  Settings,
  Turn,
  TurnEventRow,
  TurnStatus,
  VisitorGrant,
  VersionPreview,
} from "./types.js";

export type { HarnessInfo };

/** Every error body: `{ error: { code, message } }` with a human message. */
export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface HealthResponse {
  ok: true;
  name: string;
  version: string;
  ports: { server: number; proxy: number };
  home: string;
}

export interface MeResponse {
  /** The One CLI's account (`one --agent whoami`): who Builder knows One as. Null until the CLI is signed in. */
  me: BuilderIdentity | null;
  /** "one": the One CLI is signed in. "sample": the keyless stub (every answer is Sample). null: no usable CLI. */
  grant: GrantKind | null;
  cli: OneCliStatus;
}

/** GET /api/one/cli, POST /api/one/cli/login, POST /api/one/cli/refresh */
export interface OneCliResponse {
  cli: OneCliStatus;
}

export interface HarnessesResponse {
  harnesses: HarnessInfo[];
  /** The id the Home chip shows first. */
  defaultId: HarnessId | null;
}

export interface SettingsResponse {
  settings: Settings;
  paths: { home: string; projects: string; db: string; cache: string };
  ports: { server: number; proxy: number; devRange: [number, number] };
}
export type SettingsPatch = Partial<Settings>;

export interface ProjectsResponse {
  projects: ProjectSummary[];
}

export interface CreateProjectBody {
  prompt?: string;
  name?: string;
  template?: "blank";
  harness?: HarnessId;
  model?: string | null;
  permission?: Permission;
  /** "plan": the first turn proposes a plan instead of building (Plan first on Home). */
  mode?: "build" | "plan";
  /** Images attached on Home: staged file names from POST /api/attachments, moved into the project for the first turn. */
  images?: string[];
}
export interface CreateProjectResponse {
  project: Project;
  /** The first turn when a prompt was given. */
  turn: Turn | null;
}

export interface ProjectResponse {
  project: Project;
}
export interface ProjectPatch {
  name?: string;
  harness?: HarnessId;
  model?: string | null;
  permission?: Permission;
  autoFix?: boolean;
}

export interface EditsBody {
  edits: DirectEdit[];
}
/** POST /api/projects/:id/edits */
export interface EditsResponse {
  /** Applied by the platform as one checkpoint. */
  applied: number;
  /** Sent to the agent as one batched turn (comments always are). */
  deferred: { loc: string; kind: DirectEdit["kind"]; reason: string }[];
  checkpoint: Checkpoint | null;
  turn: Turn | null;
}
export interface AttachmentResponse {
  file: string;
  url: string;
}

/** GET /api/projects/:id/version, POST /api/projects/:id/checkpoints/:sha/preview. */
export interface VersionResponse {
  version: VersionPreview | null;
}

export interface CreateTurnBody {
  prompt: string;
  images?: string[];
  selections?: Selection[];
  mode?: "build" | "plan";
}
/** 202. When another turn is running the new one is `queued`. */
export interface CreateTurnResponse {
  turn: Turn;
}

export interface TurnsResponse {
  turns: Turn[];
  /** Pass as `before` for the next page; null at the start. */
  nextBefore: string | null;
}
export interface TurnEventsResponse {
  events: TurnEventRow[];
}

export interface FilesResponse {
  files: FileEntry[];
}
export interface FileResponse {
  path: string;
  content: string;
  generated: boolean;
  /** Binary or over 1 MB: content is "" and this is true. */
  tooLarge?: boolean;
}
export interface PutFileBody {
  path: string;
  content: string;
}

export interface CheckpointsResponse {
  checkpoints: Checkpoint[];
}
export interface DiffResponse {
  sha: string;
  files: (FileChange & { patch: string })[];
}
export interface CheckpointResponse {
  checkpoint: Checkpoint | null; // null when there was nothing to commit
}

export interface ErrorsResponse {
  errors: ProjectError[];
}
export interface FixBody {
  errorIds?: string[];
}

/** Server-sent events on GET /api/projects/:id/events. `event:` is the type. */
export type ProjectEvent =
  | { type: "hello"; projectId: string }
  | { type: "turn.started"; turn: Turn }
  | { type: "turn.event"; turnId: string; seq: number; event: FeedEvent; at: string }
  | { type: "turn.status"; turnId: string; status: TurnStatus; fixAttempt: number; step?: string | null }
  | { type: "turn.ended"; turn: Turn }
  | { type: "checkpoint.created"; checkpoint: Checkpoint }
  | { type: "preview.status"; state: PreviewState; step?: string | null; message?: string | null }
  /** The version preview's dev server (Preview this version), not the live one. */
  | { type: "version.status"; sha: string; state: PreviewState; step?: string | null; message?: string | null }
  | { type: "preview.hmr"; ok: boolean; message?: string }
  | { type: "errors.changed"; open: number }
  | { type: "install"; state: "running" | "done" | "failed"; tail: string }
  | { type: "harness.denied"; turnId: string; tool: string; reason?: string }
  | { type: "project.updated"; project: Project }
  | { type: "scopes.changed"; manifest: Manifest; diff: ManifestDiff }
  | { type: "activity"; row: ActivityRow }
  | { type: "publish.progress"; target: PublishTarget | "scan"; publishId: number | null; step: string; status: PublishStepStatus; detail?: string | null }
  | { type: "publish.done"; publish: PublishRecord }
  /** A project value was set or removed. Names only, never a value. */
  | { type: "env.changed"; names: string[] };

export type ProjectEventType = ProjectEvent["type"];

// ---- Preview channel (injected client <-> editor), over postMessage ----

/** iframe -> editor. Every message has `source: "<slug>-preview"`. */
export type PreviewToEditor =
  | { kind: "hello"; path: string; title: string }
  | { kind: "route"; path: string }
  | { kind: "hmr"; ok: boolean; message?: string }
  | { kind: "select"; selections: Selection[]; additive: boolean; ancestors: string[] }
  | { kind: "hover"; loc: string | null }
  | { kind: "key"; key: string; meta: boolean; shift: boolean; alt: boolean }
  | { kind: "mode"; mode: PreviewMode }
  /** Edit text (T): the builder changed an element's text in place. */
  | { kind: "edit-text"; loc: string; tag: string; before: string; after: string }
  /** Comment (C): the builder clicked an element to comment on. */
  | { kind: "comment"; selection: Selection }
  /** Ask One's answer from inside the preview: status (401 signed out), and whether One refused it. */
  | { kind: "receipt-test"; ticket: string; status: number; blockedByGrant: boolean; message?: string };

export type PreviewMode = "none" | "select" | "text" | "comment";

/** editor -> iframe. Every message has `source: "<slug>-editor"`. */
export type EditorToPreview =
  | { kind: "mode"; mode: PreviewMode }
  | { kind: "highlight"; loc: string | null }
  | { kind: "clear" }
  | { kind: "scroll-to"; loc: string }
  /** Style panel: swap classes live on every element with this loc (instant preview). */
  | { kind: "apply-class"; loc: string; remove: string[]; add: string[] }
  /** Elements with a pending edit get a dashed marker. */
  | { kind: "pending"; locs: string[] }
  /** Access, Ask One: run this ticket's call on the developer's sign-in to the app (POST /api/one/dev/receipt-test). */
  | { kind: "receipt-test"; ticket: string };

/** Beacon body posted by the injected client to /__builder/events (array allowed). */
export interface PreviewBeacon {
  kind: "runtime" | "console" | "network" | "blank" | "unhandledrejection";
  level: "error" | "warning";
  message: string;
  stack?: string;
  file?: string;
  line?: number;
  col?: number;
  /** network only */
  status?: number;
  path?: string;
  refusal?: { source: string; code: string };
  page: string;
  at: number;
}

/** Error body posted by tools/dev-tagger.ts to ${BUILDER_RELAY_URL}/errors. */
export interface DevServerErrorBody {
  source: "build" | "server";
  message: string;
  file?: string;
  line?: number;
  col?: number;
  stack?: string;
  /** "clear" means the last build error is gone (HMR update applied). */
  clear?: boolean;
}

// ---- One built in ---------------------------------------

/** `connectionDefinition` rules, one per connector. */
export interface PermissionSetAsk {
  name: string;
  connectorRules: { type: "connectionDefinition"; connectionDefinitionId: string; methods: string[]; actionIds: string[] }[];
}

/** GET /api/projects/:id/scopes */
export interface ScopesResponse {
  /** Derived from the working tree now (what the dev check uses). */
  manifest: Manifest;
  /** `.builder/scopes.json` at HEAD. */
  committed: Manifest | null;
  /** Null until a publish. */
  lastPublished: Manifest | null;
  /** manifest against lastPublished, else against committed. */
  diff: ManifestDiff;
  ask: PermissionSetAsk;
  /** Connectors with no conn_def id yet (catalog unavailable); left out of the ask. */
  askMissing: string[];
  callSites: CallSite[];
  issues: ScopeIssue[];
  /** "No schema for this action; types are loose" and similar, per action id. */
  warnings: { actionId: string; message: string }[];
  platforms: Record<string, CatalogPlatform>;
  /** "send", "get threads": the receipt verb for every manifest, committed and installed action. */
  verbs: Record<string, string>;
  /** The builder's setting for visitors on their grant (off by default). */
  visitors: VisitorGrant;
  /** What a published app gets as APP_VISITOR_ACTIONS: the allowed owner-run ids, or "none". */
  visitorEnv: string;
}

/** PATCH /api/projects/:id/visitors. `answer` records the chat card's choice on that turn. */
export interface VisitorsPatchBody {
  enabled?: boolean;
  allow?: string[];
  disallow?: string[];
  answer?: { turnId: string; choice: "allow" | "keep"; actionIds: string[] };
}
export interface VisitorsResponse {
  visitors: VisitorGrant;
}

// ---- One Connect per project (docs/CONTRACT.md section 18) ---------------

/** A Connect app the builder made in the One dashboard, as Builder keeps it: names and status, never a value. */
export interface ConnectSetupInfo {
  id: string;
  name: string;
  /** "project": made for one project (it owns it). "template": saved for reuse. */
  kind: "project" | "template";
  ownerProjectId: string | null;
  ownerProjectName: string | null;
  /** The keyless sample's stand-in (stub One), never a real app. */
  sample: boolean;
  /** ONE_CLIENT_ID, ONE_CLIENT_SECRET, ONE_CONNECT_KEY, ONE_PERMISSION_SET: set or missing, where, the last four of the client id. */
  vars: EnvVarStatus[];
  /** Client id, secret and connect key are all set. */
  configured: boolean;
  /** Projects linked to it (One Connect on or off). */
  usedBy: { id: string; name: string; slug: string; enabled: boolean }[];
  createdAt: string;
  updatedAt: string;
}

/** The addresses this project's Connect app must list, exactly. */
export interface ConnectRedirectUris {
  /** The shared preview callback: one registration covers every project on this computer. */
  preview: string;
  /** The published app's callback, once it has a Vercel project (or the one it would get). */
  production: string | null;
  /** Where production came from: the last deploy, or the name the next deploy would use. */
  productionSource: "deployed" | "planned" | null;
}

/** GET /api/projects/:id/connect */
export interface ProjectConnectResponse {
  connect: ProjectConnect;
  /** The setup this project points at, when any. */
  setup: ConnectSetupInfo | null;
  /** The setup is this project's own (not a template or another project's). */
  owned: boolean;
  /** One Connect can be turned on: a setup is linked and configured. */
  ready: boolean;
  redirectUris: ConnectRedirectUris;
  templates: ConnectSetupInfo[];
  /** Other projects' own Connect apps, to reuse. */
  others: { projectId: string; name: string; slug: string; setup: ConnectSetupInfo }[];
  /** Platforms the code calls (the manifest), for "This app uses Gmail". */
  usesOne: { platform: string; name: string }[];
  /** Where the preview's Sign in with One starts. */
  previewSignIn: string;
  store: EnvStoreInfo;
  dashboardUrl: string;
  /** Sent back as the x-<slug>-csrf header on every change. */
  csrf: string;
  sample: boolean;
}

/** PUT /api/projects/:id/connect (editor only, CSRF). */
export type ProjectConnectBody =
  | { enabled: boolean; answer?: { turnId: string } }
  | { use: "new"; name?: string }
  | { use: "template"; setupId: string; copy?: boolean }
  | { use: "project"; projectId: string; copy?: boolean }
  | { use: "none" }
  | { answer: { turnId: string; choice: "later" } };

/** GET /api/connect/templates */
export interface ConnectTemplatesResponse {
  templates: ConnectSetupInfo[];
  /** Every project's own setup too (Builder Settings lists both). */
  projectSetups: ConnectSetupInfo[];
  redirectUri: string;
  store: EnvStoreInfo;
  dashboardUrl: string;
  csrf: string;
  sample: boolean;
}

/** POST /api/connect/templates {name, values?, fromSetupId?} and the setup routes. */
export interface ConnectSetupResponse {
  setup: ConnectSetupInfo;
}

export interface ActivityResponse {
  rows: ActivityRow[];
  nextBefore: number | null;
  /** Latest refusals as receipts, newest first. */
  receipts: Receipt[];
}

/** POST /api/projects/:id/access/test-local and test-one */
export interface AccessTestResponse {
  /** The refusal receipt, when something refused. */
  receipt: Receipt | null;
  /** Plain words for the other outcomes (the honest 404 note, nothing to test). */
  note: string | null;
  action: { actionId: string; title: string; method: string } | null;
  /**
   * Ask One, live: a one-use ticket the editor hands to the preview (channel
   * `receipt-test`), where the app runs the call on your sign-in to it and
   * reports One's answer. The result arrives as an Activity row.
   */
  ticket?: string;
}

/** POST /api/catalog/* and the MCP tools answer with Markdown for the agent. */
export interface CatalogToolResponse {
  markdown: string;
  needsConnection?: string;
}

// ---- Publish -------------------------------------------

export type PublishTarget = "github" | "vercel";
export type PublishStepStatus = "running" | "done" | "failed" | "skipped";

/** One scan finding. Never carries a secret value, only where and what kind. */
export interface ScanFinding {
  /** build, typecheck, secret, env_value, dev_vars, too_many_files, manifest_drift, BLD001..BLD005, one_env_client, unauthed_db_route, cors, sql_raw, audit, widened, large_file, visitor_not_allowed, visitor_writes */
  code: string;
  level: "block" | "warn";
  title: string;
  detail?: string | null;
  file?: string | null;
  line?: number | null;
}

export type CheckState = "ok" | "failed" | "skipped";

export interface ScanResult {
  sha: string;
  shortSha: string;
  subject: string | null;
  /** True when nothing blocks. */
  ok: boolean;
  blocks: ScanFinding[];
  warns: ScanFinding[];
  checks: { build: CheckState; typecheck: CheckState; secrets: number; manifest: "matches" | "drift"; audit: CheckState };
  /** Notes that are neither block nor warn ("pnpm audit not run: offline"). */
  notes: string[];
  files: number;
  bytes: number;
  /** sha256 of the manifest serialized at this sha. */
  manifestHash: string;
  /** Manifest lines asked for beyond the last publish ("Gmail · send (write)"). */
  widened: string[];
  /** APP_VISITOR_ACTIONS for this version: the allowed owner-run action ids, comma-separated, or "none". */
  visitorActions: string;
  ms: number;
  at: string;
}

export interface GitHubPublishOptions {
  repo: string;
  /** Private unless the builder picked public on purpose. */
  visibility: "private" | "public";
  /** Required with public: the dialog's "Anyone can see this code" confirmation. */
  confirmPublic?: boolean;
}

export interface VercelPublishOptions {
  project: string;
  /** Overrides the app's Connect app client id (not a secret). Default: the project's One Connect. */
  clientId?: string;
  /** The ask (permission set) id made from the Access tab's JSON (not a secret). Default: the Connect app's. */
  permissionSet?: string;
  /** libSQL URL (libsql:// or https://). Not a secret; never carries the token. */
  databaseUrl?: string;
  /** Optional. Sent once to Vercel as a sensitive variable; never stored, logged or returned. */
  databaseAuthToken?: string;
}

export type PublishBody =
  | { target: "github"; sha?: string; options: GitHubPublishOptions }
  | { target: "vercel"; sha?: string; options: VercelPublishOptions };

export interface PublishStep {
  step: string;
  status: PublishStepStatus;
  detail?: string | null;
}

export interface HealthChecklistItem {
  key: string;
  label: string;
  ok: boolean;
  /** What to do when it is not set (no value ever). */
  how: string;
}

export interface GitHubPublishResult {
  kind: "github";
  owner: string;
  repo: string;
  url: string;
  private: boolean;
  branch: string;
  commitSha: string;
  /** True when GitHub's main moved since the last export, so this went to <slug>-sync. */
  conflict: boolean;
  firstExport: boolean;
  counts: { repo: number; blobs: number; trees: number; commits: number; refs: number };
  skipped: string[];
}

export interface VercelPublishResult {
  kind: "vercel";
  projectId: string;
  projectName: string;
  deploymentId: string;
  url: string;
  productionUrl: string;
  redirectUri: string;
  readyState: string;
  envSet: string[];
  health: { reached: boolean; mode: string | null; checklist: HealthChecklistItem[] };
  counts: { project: number; env: number; deployment: number; polls: number };
}

export interface PublishRecord {
  id: number;
  projectId: string;
  target: PublishTarget;
  sha: string;
  shortSha: string;
  status: "running" | "ok" | "failed";
  url: string | null;
  repo: string | null;
  manifestHash: string | null;
  scan: ScanResult | null;
  result: GitHubPublishResult | VercelPublishResult | null;
  /** Options kept for next time: repo and visibility, or project, client id, ask id and the database host. Never a token. */
  options: Record<string, string | boolean | null> | null;
  steps: PublishStep[];
  error: string | null;
  /** "one" (live grant) or "sample" (stub grant, nothing left this computer). */
  grant: GrantKind | null;
  at: string;
}

export interface PublishTargetInfo {
  /** The platform is connected to the builder's own One account (the One CLI's `one list`). */
  connected: boolean;
  name: string;
  image: string | null;
  last: PublishRecord | null;
}

/** GET /api/projects/:id/publishes */
export interface PublishesResponse {
  publishes: PublishRecord[];
  /** "one": the One CLI is signed in (publish runs on your own One account). "sample": the stub. null: no usable CLI. */
  grant: GrantKind | null;
  cli: OneCliStatus;
  /** The app's own Connect app, which goes to Vercel with it. */
  connect: { enabled: boolean; setupName: string | null; productionRedirectUri: string | null };
  targets: { github: PublishTargetInfo; vercel: PublishTargetInfo & { redirectUriFor: string } };
  /** The checkpoint a publish would use now (HEAD). */
  head: { sha: string; shortSha: string; subject: string } | null;
  /** True when the app has tables beyond the template's users, sessions and connect_users. */
  hasAppTables: boolean;
  /** A turn is running; publish waits. */
  busy: boolean;
}

/** POST /api/projects/:id/publish (202) */
export interface PublishStartResponse {
  publish: PublishRecord;
}

// ---- Environment (docs/CONTRACT.md section 16). Names and status only: no
// response, event or error ever carries a stored value.

import type { EnvWhere } from "./envvars.js";

export interface EnvVarStatus {
  name: string;
  present: boolean;
  /** Secret names never show any part of their value. */
  secret: boolean;
  required: boolean;
  where: EnvWhere | null;
  /** "macOS Keychain", "~/.builder/.env (only you can read it)". */
  whereLabel: string;
  updatedAt: string | null;
  /** "…ab12" for non-secret ids; the full address for the redirect URI; else null. */
  hint: string | null;
  /** Put in the .env file by hand, not through the setup screen. */
  manual?: boolean;
}

export interface EnvStoreInfo {
  preferred: EnvWhere;
  label: string;
  /** The fallback file for this scope, as the builder would type it. */
  file: string;
}

/** PUT /api/connect/setups/:id/env, PUT /api/projects/:id/env */
export interface EnvSaveBody {
  values: Record<string, string>;
}

/** 400 invalid: one message per field, never the value. */
export interface EnvInvalidBody {
  error: { code: "invalid"; message: string };
  fields: Record<string, string>;
}

export interface EnvCheckItem {
  name: string;
  level: "ok" | "warn" | "error";
  message: string;
}

/** POST /api/connect/setups/:id/check {values?}, POST /api/connect/check {values} */
export interface ConnectCheckResponse {
  ok: boolean;
  items: EnvCheckItem[];
  /** One's answer to the client id and secret: accepted, refused, not reachable, or not asked. */
  online: "accepted" | "refused" | "unreachable" | "skipped" | "sample";
  onlineMessage: string;
}

export interface ProjectEnvVar extends EnvVarStatus {
  /** "both": the preview's dev server and the published app. "publish": the published app only. */
  target: "both" | "publish";
  why: string | null;
  /** Where the code reads it, file:line. */
  sites: { file: string; line: number }[];
  /** Read in browser code (import.meta.env), so it ends up in the page. */
  client: boolean;
  /** The code reads it or the app's setup needs it. */
  needed: boolean;
}

/** GET /api/projects/:id/env */
export interface ProjectEnvResponse {
  vars: ProjectEnvVar[];
  /** Needed in preview and not set. */
  missing: string[];
  /** Needed by the published app and not set. */
  publishMissing: string[];
  store: EnvStoreInfo;
  csrf: string;
}
