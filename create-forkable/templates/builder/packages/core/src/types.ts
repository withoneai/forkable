// Domain types shared by core, server and ui. Browser-safe: types only.

import type { HarnessEvent, HarnessId, Permission, Usage, TurnExit } from "@builder/harness/types";

export type { HarnessEvent, HarnessId, Permission, Usage, TurnExit };

/** "plan": a read-only turn that proposes a plan (Plan mode); "edit": direct edits from the preview. */
export type TurnKind = "user" | "fix" | "edit" | "restore" | "manual" | "plan";

export type TurnStatus =
  | "queued"
  | "running"
  | "settling"
  | "verifying"
  | "fixing"
  | "done"
  | "failed"
  | "cancelled";

export const ACTIVE_STATUSES: TurnStatus[] = ["queued", "running", "settling", "verifying", "fixing"];

export type PreviewState = "starting" | "ready" | "error" | "stopped";

export interface ProjectSummary {
  id: string;
  slug: string;
  name: string;
  path: string;
  previewUrl: string;
  templateVersion: string;
  harness: HarnessId;
  model: string | null;
  permission: Permission;
  autoFix: boolean;
  createdAt: string;
  /** Last turn end or file edit. */
  updatedAt: string;
  archivedAt: string | null;
  /** Shot file name of the newest checkpoint with one (GET .../shots/:file). */
  lastShot: string | null;
  published: boolean;
}

export interface Project extends ProjectSummary {
  devPort: number | null;
  preview: PreviewState;
  /** Human step while the preview starts ("Installing packages"). */
  previewStep: string | null;
  /** The running or queued turn, if any. */
  activeTurnId: string | null;
  openErrors: number;
}

/** Events that the platform adds to a turn's feed, next to the harness events. */
export type PlatformEvent =
  | { t: "step"; step: string } // "Saving a checkpoint", "Checking the preview"
  | { t: "note"; text: string; tone?: "info" | "warn" } // "Stopped a server the agent started"
  | { t: "checkpoint"; sha: string; subject: string; additions: number; deletions: number; files: number }
  | { t: "fix_plan"; errors: number; attempt: number; max: number }
  /** Old feeds only (before per-project Connect): an action for a platform the builder's grant did not reach. */
  | { t: "connect_needed"; platform: string; name: string }
  /** The code calls platforms and this app has no One Connect yet: "This app uses Gmail. Turn on One Connect for it?" */
  | { t: "connect_offer"; platforms: { platform: string; name: string }[] }
  /** The builder answered that card: turned One Connect on, or not now. */
  | { t: "connect_answer"; choice: "on" | "later" }
  /** This version asks for more than the one before it: "Gmail · send (write)". */
  | { t: "asks_more"; lines: string[] }
  /** A message the builder sent while the turn ran (steering). */
  | { t: "steer"; text: string }
  /** The agent read the steer messages queued so far (Claude's hook). */
  | { t: "steer_read"; count: number }
  /** The code runs these on the owner's grant for visitors and the builder has not allowed them (the Allow card). */
  | { t: "visitors_needed"; actions: { actionId: string; line: string }[] }
  /** The builder answered that card: allowed them, or kept sign-in required (a follow-up turn). */
  | { t: "visitors_answer"; choice: "allow" | "keep"; actionIds: string[] }
  /** The code reads environment variables that have no value yet (the "This app needs X" card). Names only. */
  | { t: "env_needed"; vars: { name: string; why: string | null; sites: { file: string; line: number }[] }[] };

export type FeedEvent = HarnessEvent | PlatformEvent;

export interface TurnEventRow {
  turnId: string;
  seq: number;
  at: string;
  event: FeedEvent;
}

export interface Selection {
  /** "src/App.tsx:42:8" */
  loc: string;
  tag: string;
  text?: string;
  classes?: string;
  rect?: { x: number; y: number; width: number; height: number };
}

export interface Turn {
  id: string;
  projectId: string;
  kind: TurnKind;
  parentTurnId: string | null;
  fixAttempt: number;
  prompt: string;
  selections: Selection[];
  harness: HarnessId;
  model: string | null;
  sessionId: string | null;
  status: TurnStatus;
  exit: TurnExit | null;
  error: string | null;
  usage: Usage;
  costUsd: number | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  checkpointSha: string | null;
  /** Assistant's final text (summary shown under the turn). */
  text: string;
}

export interface FileChange {
  path: string;
  status: "A" | "M" | "D";
  additions: number;
  deletions: number;
}

export interface Checkpoint {
  sha: string;
  shortSha: string;
  projectId: string;
  turnId: string | null;
  kind: TurnKind | "template";
  subject: string;
  harness: HarnessId | null;
  files: FileChange[];
  additions: number;
  deletions: number;
  shot: string | null;
  bookmarked: boolean;
  restoredFrom: string | null;
  createdAt: string;
  /** Publish badges; empty until a publish. */
  published: ("github" | "vercel")[];
}

export type ErrorSource = "build" | "types" | "runtime" | "network" | "install" | "server" | "manifest" | "one";

export interface ProjectError {
  id: string;
  signature: string;
  source: ErrorSource;
  file: string | null;
  line: number | null;
  col: number | null;
  message: string;
  stack: string | null;
  firstSeen: string;
  lastSeen: string;
  count: number;
  turnId: string | null;
  resolvedAt: string | null;
  severity: "error" | "warning";
}

export interface Settings {
  defaultHarness: HarnessId | null;
  defaultModel: string | null;
  defaultPermission: Permission;
  autoFix: boolean;
  theme: "system" | "light" | "dark";
  size: "small" | "default" | "large";
  pendingPrompt: string | null;
  /** Images attached on Home with the pending prompt: staged file names (POST /api/attachments). */
  pendingImages?: string[] | null;
}

/**
 * Preview this version: a checkpoint exported to the
 * project's state dir and served on its own dev port and host, without
 * touching the project's HEAD, index or working tree.
 */
export interface VersionPreview {
  projectId: string;
  sha: string;
  shortSha: string;
  subject: string;
  /** http://<slug>--v-<shortsha>.localhost:<proxy>/ */
  url: string;
  state: PreviewState;
  step: string | null;
  message: string | null;
  openedAt: string;
}

export interface FileEntry {
  path: string; // project relative, "/" separated
  type: "file" | "dir";
  size?: number;
  generated?: boolean; // read-only in Code (actions.gen.ts)
}

// ---- One built in ------------------------------------------

/** GET read; POST/PUT/PATCH write; DELETE delete; a POST the catalog marks as a read stays read. */
export type ActionLevel = "read" | "write" | "delete";

/** One entry in `.builder/actions.json`. */
export interface InstalledAction {
  actionId: string;
  platform: string;
  /** Wrapper name when the title-derived one collides. */
  alias?: string;
}

export interface ManifestAction {
  platform: string;
  connDefId: string | null;
  actionId: string;
  title: string;
  method: string;
  level: ActionLevel;
  /**
   * Who the calls run as, present only when a call site uses
   * `one(c, { as: "owner" })`: ["owner"] (only visitors trigger it, on the
   * builder's grant) or ["user", "owner"] (both). Absent means users only.
   */
  runsAs?: ("user" | "owner")[];
}

/**
 * Per project, off by default: may visitors who are
 * not signed in trigger these actions on the app owner's grant. Stored in
 * the platform's database, never in the project's files, so the agent cannot
 * turn it on. Effective list: `enabled ? actions : []`.
 */
export interface VisitorGrant {
  enabled: boolean;
  /** Action ids the builder ticked. */
  actions: string[];
}

/** `.builder/scopes.json`: what the code calls, nothing more. */
export interface Manifest {
  version: 1;
  actions: ManifestAction[];
  /** Installed wrappers with no call site: not in the ask. */
  unused: string[];
}

export type ScopeCode = "BLD001" | "BLD002" | "BLD003" | "BLD004" | "BLD005";

export interface ScopeIssue {
  code: ScopeCode;
  severity: "error" | "warning";
  file: string;
  line: number;
  col: number;
  message: string;
}

export interface CallSite {
  actionId: string;
  file: string;
  line: number;
  col: number;
  /** "owner": `one(c, { as: "owner" }).run(...)`, runs on the owner's grant for visitors. */
  as?: "owner";
}

export interface ManifestDiff {
  added: ManifestAction[];
  removed: ManifestAction[];
  /** Same action, higher level. */
  raised: { action: ManifestAction; from: ActionLevel }[];
  /** True when the new manifest asks for more (added or raised). */
  widened: boolean;
  /** "Gmail · send (write)" for each added or raised action. */
  lines: string[];
}

/** Who refused (or ran) a call. Never mixed in one receipt. */
export type ReceiptSource = "one" | "local" | "held" | "sample";
export type ActivitySource = ReceiptSource | "platform";

export interface ActivityRow {
  id: number;
  projectId: string;
  at: string;
  platform: string | null;
  actionId: string | null;
  title: string | null;
  method: string | null;
  path: string | null;
  source: ActivitySource;
  status: number | null;
  ok: boolean | null;
  blockedByGrant: boolean | null;
  refusal: { source: ReceiptSource; code: string; message?: string } | null;
  ms: number | null;
  turnId: string | null;
}

export interface Receipt {
  /** "Gmail · delete   declined, 403" */
  line: string;
  source: ReceiptSource;
  /** "One", "Local", "Paused", "Sample" */
  badge: string;
  caption: string;
  platform: string;
  actionId: string | null;
  at: string;
}

/** The builder's One identity (whoami), never a credential. */
export interface BuilderIdentity {
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

/**
 * What a call ran on: "one" (live: the One CLI for catalog and publish, the
 * project's own Connect app in preview) or "sample" (the keyless stub, every
 * answer labeled Sample).
 */
export type GrantKind = "one" | "sample";

/** The One CLI on this machine, as Settings, One CLI shows it (`one --version`, `one --agent whoami`). */
export interface OneCliStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
  /** The Node directory put first on the CLI's PATH, when one is. */
  node: string | null;
  signedIn: boolean;
  /** The CLI's own account (whoami). Shown to the builder, never logged. */
  account: { name: string | null; email: string | null } | null;
  /** "sample": the keyless stub stands in for the CLI; nothing leaves this computer. */
  mode: "cli" | "sample";
  /** Why it is not usable, in plain words. */
  error: string | null;
  checkedAt: string;
  /** `one login` started from Builder and still waiting for the browser. */
  loginRunning: boolean;
  installHint: string;
}

/** How a project got its Connect app: made for it, a saved template, or another project's. */
export type ConnectVia = "new" | "template" | "project";

/**
 * A project's One Connect (projects.one_connect): off by default. When on,
 * the app's login is Sign in with One on its own Connect app (setupId), and
 * preview calls run on the developer's own sign-in to it.
 */
export interface ProjectConnect {
  enabled: boolean;
  setupId: string | null;
  via: ConnectVia | null;
}

export interface GrantConnection {
  platform: string;
  name: string;
  image: string | null;
  /** The connection's own title in One ("avery@acme.example"). */
  title: string | null;
  access: "full" | "methods" | "actions";
  methods?: string[];
}

export interface CatalogPlatform {
  platform: string;
  name: string;
  connDefId: string | null;
  image: string | null;
  category?: string | null;
}

/** A pending edit from the preview: literal text, a class swap, or a comment for the agent. */
export type DirectEdit =
  | { kind: "text"; loc: string; before: string; after: string }
  | { kind: "class"; loc: string; remove: string[]; add: string[] }
  | { kind: "comment"; loc: string; text: string; tag?: string; excerpt?: string };
