// Fixtures for the in-browser mock server (VITE_MOCK=1). Acme Inc, made up.
import type { HarnessInfo } from "@builder/harness/types";
import type { ActivityRow, Checkpoint, FeedEvent, FileEntry, ManifestAction, Project, ProjectError, Receipt, Settings, Turn, TurnEventRow } from "@builder/core/types";
import type { AccessTestResponse, ActivityResponse, ConnectSetupInfo, ConnectTemplatesResponse, MeResponse, ProjectConnectResponse, ScopesResponse } from "@builder/core/api-types";
import type { OneCliStatus } from "@builder/core/types";

const now = Date.now();
export const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const sec = (iso: string, s: number) => new Date(new Date(iso).getTime() + s * 1000).toISOString();

export const PREVIEW_ORIGIN = `http://localhost:${window.location.port || "5380"}`;

const CLAUDE_MODELS = [
  { id: "claude-opus-4-1", label: "Opus 4.1", hint: "Most capable", contextWindow: 200_000 },
  { id: "claude-sonnet-4-5", label: "Sonnet 4.5", hint: "Fast and smart", contextWindow: 200_000 },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", hint: "Fastest", contextWindow: 200_000 },
];

export function harnesses(scenario: string): HarnessInfo[] {
  const none = scenario === "noagent";
  const searched = ["/opt/homebrew/bin", "/usr/local/bin", "~/.local/bin", "~/.npm-global/bin", "~/.nvm/versions/node/v22.12.0/bin", "~/.codex/bin"];
  return [
    {
      id: "claude-code", label: "Claude Code", status: "ready",
      bin: none ? null : "/Users/acme/.local/bin/claude", version: none ? null : "2.1.306",
      signedIn: none ? null : scenario === "signedout" ? false : true, searched: none ? searched : undefined,
      models: none ? [] : CLAUDE_MODELS,
      caps: { stream: "token", resume: "native", mcp: "per-run", images: true, steer: true, plan: true, costUsd: true },
    },
    {
      id: "codex", label: "Codex", status: "ready",
      bin: none ? null : "/Users/acme/.local/bin/codex", version: none ? null : "0.163.0", signedIn: none ? null : true, searched: none ? searched : undefined,
      models: none ? [] : [{ id: "gpt-5.6-sol", label: "gpt-5.6-sol", hint: "Default" }, { id: "gpt-5.6-terra", label: "gpt-5.6-terra" }],
      caps: { stream: "block", resume: "native", mcp: "per-run", images: true, steer: false, plan: true, costUsd: false },
    },
    {
      id: "openclaw", label: "OpenClaw", status: "preview",
      bin: none ? null : "/opt/homebrew/bin/openclaw", version: none ? null : "2026.8.1", signedIn: null, searched: none ? searched : undefined,
      models: [],
      caps: { stream: "final", resume: "state-dir", mcp: "none", images: false, steer: false, plan: false, costUsd: true },
    },
  ];
}

export const settings: Settings = {
  defaultHarness: "claude-code", defaultModel: null, defaultPermission: "build", autoFix: true, theme: "system", size: "default", pendingPrompt: null,
};

const base = (id: string, slug: string, name: string, over: Partial<Project> = {}): Project => ({
  id, slug, name, path: `/Users/acme/.builder/projects/${slug}`, previewUrl: `${PREVIEW_ORIGIN}/`, templateVersion: "1.a3f9c2",
  harness: "claude-code", model: null, permission: "build", autoFix: true, createdAt: ago(240), updatedAt: ago(2), archivedAt: null,
  lastShot: `${id}-latest.png`, published: false, devPort: 52001, preview: "ready", previewStep: null, activeTurnId: null, openErrors: 2, ...over,
});

export function projects(scenario: string): Project[] {
  return [
    base("p_tasks", "acme-tasks", "Acme tasks", { activeTurnId: scenario === "failed" ? null : "t4", openErrors: 2 }),
    base("p_invoices", "acme-invoices", "Acme invoices", { harness: "codex", updatedAt: ago(60 * 5), devPort: 52002, activeTurnId: "i2", openErrors: 0 }),
    base("p_booking", "acme-booking", "Studio booking", { updatedAt: ago(60 * 30), lastShot: "p_booking-latest.png", openErrors: 0, published: true }),
    base("p_new", "acme-crm", "Acme CRM", { updatedAt: ago(0.2), lastShot: null, activeTurnId: "n1", openErrors: 0, preview: scenario === "starting" ? "starting" : "ready", previewStep: scenario === "starting" ? "Installing packages" : null }),
  ];
}

let seqN = 0;
const ev = (turnId: string, at: string, event: FeedEvent): TurnEventRow => ({ turnId, seq: ++seqN, at, event });

function turn(over: Partial<Turn> & Pick<Turn, "id" | "projectId" | "prompt">): Turn {
  return {
    kind: "user", parentTurnId: null, fixAttempt: 0, selections: [], harness: "claude-code", model: null, sessionId: "6f2c1d0a-4b1e-4d5e-9a1f-1c2d3e4f5a6b",
    status: "done", exit: "ok", error: null, usage: { input: 18_200, output: 3_900, cacheRead: 92_000, cacheWrite: 6_100 }, costUsd: 0.21,
    startedAt: ago(200), endedAt: ago(197), createdAt: ago(200), checkpointSha: null, text: "", ...over,
  };
}

// ---- acme-tasks ----------------------------------------------------------
const t1s = ago(200);
const GET_THREADS = "conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ";
const SEND_EMAIL = "conn_mod_def::GGXAjWkZO8U::uMc1LQIHTTKzeMm3rLL5gQ";
const DELETE_MESSAGE = "conn_mod_def::GJ3ocgKltKQ::s8UCfiDLSaO9w9oPU32TYA";
const f1s = ago(196.5);
const t2s = ago(120);
export const turnsTasks: Turn[] = [
  turn({ id: "t1", projectId: "p_tasks", prompt: "A task list for Acme Inc with owners, due dates and a done state", startedAt: t1s, endedAt: sec(t1s, 86), createdAt: t1s, checkpointSha: "c1a2b3d4e5f60718293a4b5c6d7e8f9012345678" }),
  turn({ id: "f1", projectId: "p_tasks", kind: "fix", parentTurnId: "t1", fixAttempt: 1, prompt: "Fix 1 error", startedAt: f1s, endedAt: sec(f1s, 21), createdAt: f1s, checkpointSha: "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3", usage: { input: 4_100, output: 640, cacheRead: 40_000, cacheWrite: 0 }, costUsd: 0.03 }),
  turn({ id: "t2", projectId: "p_tasks", prompt: "Let people drag tasks to reorder them", selections: [{ loc: "src/components/TaskList.tsx:24:6", tag: "ul", text: "", classes: "flex flex-col" }], status: "failed", exit: "ok", startedAt: t2s, endedAt: sec(t2s, 190), createdAt: t2s, checkpointSha: "e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6" }),
  ...[1, 2, 3].map((n) => turn({ id: `f2${n}`, projectId: "p_tasks", kind: "fix", parentTurnId: "t2", fixAttempt: n, prompt: "Fix 2 errors", status: n < 3 ? "done" : "failed", startedAt: sec(t2s, 60 + n * 40), endedAt: sec(t2s, 90 + n * 40), createdAt: sec(t2s, 60 + n * 40), checkpointSha: n === 1 ? "f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0" : null, usage: { input: 3_000, output: 500, cacheRead: 30_000, cacheWrite: 0 }, costUsd: 0.02 })),
  turn({ id: "t3", projectId: "p_tasks", kind: "restore", prompt: "Restored to d4e5f6a: Fix 1 error", startedAt: ago(30), endedAt: ago(30), createdAt: ago(30), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: null, checkpointSha: "a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0" }),
  turn({ id: "t4", projectId: "p_tasks", prompt: "Add a filter for overdue tasks, and show them in red", status: "running", exit: null, startedAt: ago(1.2), endedAt: null, createdAt: ago(1.2), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: null }),
];

const write = (turnId: string, at: string, id: string, name: string, file: string): TurnEventRow[] => [
  ev(turnId, at, { t: "tool_start", id, name, kind: "write", files: [`/Users/acme/.builder/projects/acme-tasks/${file}`] }),
  ev(turnId, sec(at, 2), { t: "tool_end", id, ok: true }),
];
const read = (turnId: string, at: string, id: string, file: string): TurnEventRow[] => [
  ev(turnId, at, { t: "tool_start", id, name: "Read", kind: "read", files: [file] }),
  ev(turnId, sec(at, 0.4), { t: "tool_end", id, ok: true }),
];
const run = (turnId: string, at: string, id: string, cmd: string, ok = true, preview?: string): TurnEventRow[] => [
  ev(turnId, at, { t: "tool_start", id, name: "Bash", kind: "run", detail: cmd }),
  ev(turnId, sec(at, 4), { t: "tool_end", id, ok, preview }),
];

export const eventsTasks: Record<string, TurnEventRow[]> = {
  t1: [
    ev("t1", t1s, { t: "session", id: "6f2c1d0a" }),
    ev("t1", sec(t1s, 1), { t: "thinking", text: "The template already has the UI kit and a Hono app. A tasks table in D1, an API route, and a list page with owner and due date columns.", delta: false }),
    ...read("t1", sec(t1s, 6), "r1", "src/App.tsx"),
    ...read("t1", sec(t1s, 7), "r2", "server/db/schema.ts"),
    ...read("t1", sec(t1s, 8), "r3", "src/components/ui/table.tsx"),
    ev("t1", sec(t1s, 9), { t: "text", text: "I'll add a tasks table, two API routes and a list page that uses the kit's table." }),
    ...write("t1", sec(t1s, 12), "w1", "Edit", "server/db/schema.ts"),
    ev("t1", sec(t1s, 14), { t: "tool_start", id: "o1", name: "mcp__builder__one_find_actions", kind: "one", detail: "gmail list my latest email threads", input: { platform: "gmail", intent: "list my latest email threads" } }),
    ev("t1", sec(t1s, 15), { t: "tool_end", id: "o1", ok: true }),
    ev("t1", sec(t1s, 16), { t: "tool_start", id: "o2", name: "mcp__builder__one_add_action", kind: "one", detail: GET_THREADS, input: { actionId: GET_THREADS, platform: "gmail" } }),
    ev("t1", sec(t1s, 17), { t: "tool_end", id: "o2", ok: true }),
    ev("t1", sec(t1s, 17), { t: "connect_needed", platform: "gmail", name: "Gmail" }),
    ...write("t1", sec(t1s, 20), "w2", "Edit", "server/app.ts"),
    ...write("t1", sec(t1s, 34), "w3", "Write", "src/components/TaskList.tsx"),
    ...write("t1", sec(t1s, 50), "w4", "Edit", "src/App.tsx"),
    ...run("t1", sec(t1s, 60), "b1", "pnpm typecheck", false, "src/App.tsx(18,7): error TS2322: Type 'string' is not assignable to type 'Date'."),
    ev("t1", sec(t1s, 70), { t: "text", text: "The task list is in place:\n\n- **Tasks table** in D1 with title, owner, due date and done\n- `GET /api/tasks` and `PATCH /api/tasks/:id`\n- A list page with owner avatars and a done checkbox\n\nSample data uses Acme Inc's team." }),
    ev("t1", sec(t1s, 80), { t: "usage", usage: { input: 18_200, output: 3_900, cacheRead: 92_000, cacheWrite: 6_100 }, total: true }),
    ev("t1", sec(t1s, 84), { t: "checkpoint", sha: "c1a2b3d4e5f60718293a4b5c6d7e8f9012345678", subject: "A task list for Acme Inc with owners, due dates and a done state", additions: 212, deletions: 3, files: 4 }),
    ev("t1", sec(t1s, 85), { t: "asks_more", lines: ["Gmail · get threads (read)", "Gmail · send (write)"] }),
  ],
  f1: [
    ev("f1", f1s, { t: "fix_plan", errors: 1, attempt: 1, max: 3 }),
    ...read("f1", sec(f1s, 1), "fr1", "src/App.tsx"),
    ...write("f1", sec(f1s, 5), "fw1", "Edit", "src/App.tsx"),
    ...run("f1", sec(f1s, 9), "fb1", "pnpm typecheck"),
    ev("f1", sec(f1s, 18), { t: "text", text: "`dueDate` arrives as an ISO string from the API. It is parsed once in `toTask` now, so the type matches." }),
    ev("f1", sec(f1s, 20), { t: "checkpoint", sha: "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3", subject: "Fix 1 error", additions: 4, deletions: 2, files: 1 }),
  ],
  t2: [
    ev("t2", t2s, { t: "thinking", text: "Pointer events on the list rows, an order column, and a PATCH that writes the new order.", delta: false }),
    ...read("t2", sec(t2s, 5), "r21", "src/components/TaskList.tsx"),
    ...write("t2", sec(t2s, 10), "w21", "Edit", "src/components/TaskList.tsx"),
    ...write("t2", sec(t2s, 22), "w22", "Edit", "server/app.ts"),
    ev("t2", sec(t2s, 26), { t: "denied", tool: "pnpm add @dnd-kit/core", reason: "Add packages with project_add_dependency." }),
    ev("t2", sec(t2s, 40), { t: "text", text: "Rows can be dragged now. The order is saved on drop." }),
    ev("t2", sec(t2s, 58), { t: "checkpoint", sha: "e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6", subject: "Let people drag tasks to reorder them", additions: 64, deletions: 12, files: 2 }),
  ],
  ...Object.fromEntries([1, 2, 3].map((n) => {
    const s = sec(t2s, 60 + n * 40);
    return [`f2${n}`, [
      ev(`f2${n}`, s, { t: "fix_plan", errors: 2, attempt: n, max: 3 }),
      ...write(`f2${n}`, sec(s, 3), `f2w${n}`, "Edit", "src/components/TaskList.tsx"),
      ...run(`f2${n}`, sec(s, 9), `f2b${n}`, "pnpm typecheck", false, "src/components/TaskList.tsx(31,22): error TS2339: Property 'order' does not exist on type 'Task'."),
      ev(`f2${n}`, sec(s, 20), { t: "text", text: n < 3 ? "Added the order field to the client type." : "The server schema needs a migration for the order column, which this pass did not cover." }),
    ]];
  })),
  t3: [],
  t4: [
    ev("t4", ago(1.2), { t: "session", id: "6f2c1d0a" }),
    ev("t4", sec(ago(1.2), 1), { t: "thinking", text: "Overdue is dueDate before today and not done.", delta: false }),
    ev("t4", sec(ago(1.2), 9), { t: "tool_start", id: "lr0", name: "Glob", kind: "read", detail: "src/**/*.tsx" }),
    ev("t4", sec(ago(1.2), 10), { t: "tool_end", id: "lr0", ok: true }),
  ],
};

/** Played over SSE after load, about one every 700 ms. */
export const liveTasks: FeedEvent[] = [
  { t: "tool_start", id: "lr1", name: "Read", kind: "read", files: ["src/components/TaskList.tsx"] },
  { t: "tool_end", id: "lr1", ok: true },
  { t: "tool_start", id: "lr2", name: "Grep", kind: "read", detail: "dueDate" },
  { t: "tool_end", id: "lr2", ok: true },
  { t: "tool_start", id: "lr3", name: "Read", kind: "read", files: ["src/lib/tasks.ts"] },
  { t: "tool_end", id: "lr3", ok: true },
  { t: "text_delta", text: "I'll add an " },
  { t: "text_delta", text: "Overdue filter next to All and Done, " },
  { t: "text_delta", text: "and color the due date red when a task is late." },
  { t: "text", text: "I'll add an Overdue filter next to All and Done, and color the due date red when a task is late." },
  { t: "step", step: "Agent is writing TaskList.tsx" },
  { t: "tool_start", id: "lw1", name: "Edit", kind: "write", files: ["/Users/acme/.builder/projects/acme-tasks/src/components/TaskList.tsx"] },
  { t: "tool_end", id: "lw1", ok: true },
  { t: "tool_start", id: "lw2", name: "Edit", kind: "write", files: ["/Users/acme/.builder/projects/acme-tasks/src/lib/tasks.ts"] },
  { t: "tool_end", id: "lw2", ok: true },
  { t: "step", step: "Running pnpm typecheck" },
  { t: "tool_start", id: "lb1", name: "Bash", kind: "run", detail: "pnpm typecheck" },
];

export const checkpointsTasks: Checkpoint[] = [
  { sha: "a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0", shortSha: "a9b8c7d", projectId: "p_tasks", turnId: "t3", kind: "restore", subject: "Restore to d4e5f6a: Fix 1 error", harness: null, files: [{ path: "src/components/TaskList.tsx", status: "M", additions: 12, deletions: 64 }, { path: "server/app.ts", status: "M", additions: 0, deletions: 9 }], additions: 12, deletions: 73, shot: "p_tasks-c2.png", bookmarked: false, restoredFrom: "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3", createdAt: ago(30), published: [] },
  { sha: "f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0", shortSha: "f1a2b3c", projectId: "p_tasks", turnId: "f21", kind: "fix", subject: "Fix 2 errors", harness: "claude-code", files: [{ path: "src/components/TaskList.tsx", status: "M", additions: 3, deletions: 1 }], additions: 3, deletions: 1, shot: "p_tasks-c3.png", bookmarked: false, restoredFrom: null, createdAt: sec(t2s, 130), published: [] },
  { sha: "e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6", shortSha: "e7f8a9b", projectId: "p_tasks", turnId: "t2", kind: "user", subject: "Let people drag tasks to reorder them", harness: "claude-code", files: [{ path: "src/components/TaskList.tsx", status: "M", additions: 55, deletions: 12 }, { path: "server/app.ts", status: "M", additions: 9, deletions: 0 }], additions: 64, deletions: 12, shot: "p_tasks-c3.png", bookmarked: false, restoredFrom: null, createdAt: sec(t2s, 58), published: [] },
  { sha: "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3", shortSha: "d4e5f6a", projectId: "p_tasks", turnId: "f1", kind: "fix", subject: "Fix 1 error", harness: "claude-code", files: [{ path: "src/App.tsx", status: "M", additions: 4, deletions: 2 }], additions: 4, deletions: 2, shot: "p_tasks-c2.png", bookmarked: true, restoredFrom: null, createdAt: sec(f1s, 20), published: [] },
  { sha: "c1a2b3d4e5f60718293a4b5c6d7e8f9012345678", shortSha: "c1a2b3d", projectId: "p_tasks", turnId: "t1", kind: "user", subject: "A task list for Acme Inc with owners, due dates and a done state", harness: "claude-code", files: [{ path: "src/components/TaskList.tsx", status: "A", additions: 148, deletions: 0 }, { path: "src/App.tsx", status: "M", additions: 22, deletions: 3 }, { path: "server/app.ts", status: "M", additions: 28, deletions: 0 }, { path: "server/db/schema.ts", status: "M", additions: 14, deletions: 0 }], additions: 212, deletions: 3, shot: "p_tasks-c1.png", bookmarked: false, restoredFrom: null, createdAt: sec(t1s, 84), published: [] },
  { sha: "0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c", shortSha: "0b1c2d3", projectId: "p_tasks", turnId: null, kind: "template", subject: "Template", harness: null, files: [], additions: 0, deletions: 0, shot: null, bookmarked: false, restoredFrom: null, createdAt: ago(201), published: [] },
];

export const errorsTasks: ProjectError[] = [
  { id: "e1", signature: "s1", source: "types", file: "src/components/TaskList.tsx", line: 31, col: 22, message: "Property 'order' does not exist on type 'Task'.", stack: null, firstSeen: ago(100), lastSeen: ago(1), count: 3, turnId: "f23", resolvedAt: null, severity: "error" },
  { id: "e2", signature: "s2", source: "runtime", file: "src/components/TaskList.tsx", line: 40, col: 9, message: "Warning: Each child in a list should have a unique \"key\" prop.", stack: null, firstSeen: ago(90), lastSeen: ago(2), count: 6, turnId: "f23", resolvedAt: null, severity: "warning" },
];

// ---- acme-invoices (Codex, a queued message) ------------------------------
export const turnsInvoices: Turn[] = [
  turn({ id: "i1", projectId: "p_invoices", harness: "codex", prompt: "An invoices page for Acme Inc with a status column and totals", startedAt: ago(320), endedAt: ago(316), createdAt: ago(320), usage: { input: 39_491, output: 2_049, cacheRead: 32_512, cacheWrite: 0 }, costUsd: null, checkpointSha: "aa11bb22cc33dd44ee55ff6600112233445566778" }),
  turn({ id: "i2", projectId: "p_invoices", harness: "codex", prompt: "Add a Mark as paid button", status: "running", exit: null, startedAt: ago(0.6), endedAt: null, createdAt: ago(0.6), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: null }),
  turn({ id: "i3", projectId: "p_invoices", harness: "codex", prompt: "Also sort by due date", status: "queued", exit: null, startedAt: null, endedAt: null, createdAt: ago(0.2), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: null }),
];
export const eventsInvoices: Record<string, TurnEventRow[]> = {
  i1: [
    ev("i1", ago(320), { t: "session", id: "01a16cb5" }),
    ev("i1", sec(ago(320), 3), { t: "tool_start", id: "c1", name: "command_execution", kind: "run", detail: "/bin/zsh -lc 'ls src'" }),
    ev("i1", sec(ago(320), 4), { t: "tool_end", id: "c1", ok: true }),
    ev("i1", sec(ago(320), 30), { t: "tool_start", id: "c2", name: "file_change", kind: "write", files: ["src/routes/Invoices.tsx", "server/app.ts"] }),
    ev("i1", sec(ago(320), 31), { t: "tool_end", id: "c2", ok: true }),
    ev("i1", sec(ago(320), 200), { t: "text", text: "Added the invoices page with Draft, Sent and Paid states and a totals row." }),
    ev("i1", sec(ago(320), 230), { t: "checkpoint", sha: "aa11bb22cc33dd44ee55ff6600112233445566778", subject: "An invoices page for Acme Inc with a status column and totals", additions: 180, deletions: 6, files: 3 }),
  ],
  i2: [ev("i2", ago(0.6), { t: "session", id: "01a16cb5" }), ev("i2", sec(ago(0.6), 2), { t: "tool_start", id: "c3", name: "command_execution", kind: "run", detail: "/bin/zsh -lc 'rg -n \"status\" src/routes/Invoices.tsx'" })],
  i3: [],
};

// ---- acme-crm (first build in progress) ------------------------------------
export const turnsNew: Turn[] = [
  turn({ id: "n1", projectId: "p_new", prompt: "A small CRM for Acme Inc: companies, contacts and a pipeline board", status: "running", exit: null, startedAt: ago(0.3), endedAt: null, createdAt: ago(0.3), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: null }),
];
export const eventsNew: Record<string, TurnEventRow[]> = {
  n1: [
    ev("n1", ago(0.3), { t: "session", id: "9d8c7b6a" }),
    ev("n1", sec(ago(0.3), 1), { t: "thinking", text: "Three tables, a board with columns per stage.", delta: false }),
    ev("n1", sec(ago(0.3), 6), { t: "tool_start", id: "nr1", name: "Read", kind: "read", files: ["src/App.tsx"] }),
    ev("n1", sec(ago(0.3), 7), { t: "tool_end", id: "nr1", ok: true }),
    ev("n1", sec(ago(0.3), 8), { t: "step", step: "Agent is writing App.tsx" }),
    ev("n1", sec(ago(0.3), 8), { t: "tool_start", id: "nw1", name: "Write", kind: "write", files: ["src/App.tsx"] }),
  ],
};
export const checkpointsNew: Checkpoint[] = [
  { sha: "1234567890abcdef1234567890abcdef12345678", shortSha: "1234567", projectId: "p_new", turnId: null, kind: "template", subject: "Template", harness: null, files: [], additions: 0, deletions: 0, shot: null, bookmarked: false, restoredFrom: null, createdAt: ago(0.4), published: [] },
];

// ---- files -------------------------------------------------------------------
export const files: FileEntry[] = [
  "AGENTS.md", "CLAUDE.md", "package.json", "vite.config.ts", "wrangler.jsonc", "tsconfig.json", "index.html",
  "src/main.tsx", "src/App.tsx", "src/index.css", "src/lib/api.ts", "src/lib/tasks.ts", "src/components/TaskList.tsx",
  "src/components/ui/button.tsx", "src/components/ui/card.tsx", "src/components/ui/table.tsx", "src/components/ui/badge.tsx",
  "src/components/connect/ConnectButton.tsx", "src/components/connect/Receipt.tsx", "src/routes/Home.tsx",
  "server/app.ts", "server/worker.ts", "server/db/schema.ts", "server/db/client.ts", "server/one/index.ts", "server/one/client.ts", "server/one/actions.gen.ts",
  "tools/dev-tagger.ts", "tools/guard-dev.mjs",
].map((path) => ({ path, type: "file" as const, size: 1200, generated: path.endsWith("actions.gen.ts") || undefined }));

export const fileContent: Record<string, string> = {
  "src/App.tsx": `import { useQuery } from "@tanstack/react-query";
import { TaskList } from "./components/TaskList";
import { Card } from "./components/ui/card";
import { api } from "./lib/api";
import { toTask, type Task } from "./lib/tasks";

export function App() {
  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: async () => (await api.get<Task[]>("/api/tasks")).map(toTask),
  });

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="flex items-end justify-between">
        <div>
          <p className="text-11 font-medium uppercase tracking-wide text-muted-foreground">Acme Inc</p>
          <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        </div>
      </header>
      <Card>
        <TaskList tasks={tasks.data ?? []} loading={tasks.isLoading} />
      </Card>
    </main>
  );
}
`,
  "server/app.ts": `import { Hono } from "hono";
import { db } from "./db/client";
import { tasks } from "./db/schema";

export const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/tasks", async (c) => {
  const rows = await db(c).select().from(tasks).orderBy(tasks.dueDate);
  return c.json(rows);
});
`,
  "server/one/actions.gen.ts": `// Generated by Builder from One's catalog. Do not edit.
export {};
`,
  "package.json": `{
  "name": "acme-tasks",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node tools/guard-dev.mjs && vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  }
}
`,
};

export const diffPatch = (path: string) => `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -14,9 +14,12 @@ export function TaskList({ tasks, loading }: Props) {
   if (loading) return <TableSkeleton rows={6} />;
   return (
-    <ul className="flex flex-col">
-      {tasks.map((t) => <TaskRow task={t} />)}
+    <ul className="flex flex-col divide-y divide-border">
+      {tasks.map((t) => (
+        <TaskRow key={t.id} task={t} overdue={isOverdue(t)} />
+      ))}
     </ul>
   );
 }
`;

// ---- One built in ----------------------------------------------

export const cli = (scenario: string): OneCliStatus => ({
  installed: scenario !== "nocli",
  path: scenario === "nocli" ? null : "/Users/acme/.npm-global/bin/one",
  version: scenario === "nocli" ? null : "2.9.2",
  node: null,
  signedIn: scenario !== "nocli" && scenario !== "signedout",
  account: scenario === "nocli" || scenario === "signedout" ? null : { name: "Avery Chen", email: "avery@acme.example" },
  mode: "cli",
  error: scenario === "nocli" ? "The One CLI is not installed. Install it with npm install -g @withone/cli." : scenario === "signedout" ? "The One CLI is not signed in." : null,
  checkedAt: ago(0),
  loginRunning: false,
  installHint: "npm install -g @withone/cli",
});

export const me = (scenario: string): MeResponse => {
  const c = cli(scenario);
  return { me: c.signedIn && c.account ? { ...c.account, avatarUrl: null } : null, grant: c.signedIn ? "one" : null, cli: c };
};

// ---- One Connect per project (CONTRACT 18) --------------------------------

const PREVIEW_CALLBACK = "http://127.0.0.1:51990/api/one/callback";
const setVars = (hint: string | null, configured = true): ConnectSetupInfo["vars"] =>
  ["ONE_CLIENT_ID", "ONE_CLIENT_SECRET", "ONE_CONNECT_KEY", "ONE_PERMISSION_SET"].map((name) => {
    const present = configured && name !== "ONE_PERMISSION_SET";
    return { name, present, secret: name === "ONE_CLIENT_SECRET" || name === "ONE_CONNECT_KEY", required: name !== "ONE_PERMISSION_SET", where: present ? "keychain" : null, whereLabel: present ? "macOS Keychain" : "Not set", updatedAt: present ? ago(60 * 26) : null, hint: name === "ONE_CLIENT_ID" && present ? hint : null };
  }) as ConnectSetupInfo["vars"];

export const setups: ConnectSetupInfo[] = [
  { id: "cs_acme", name: "Acme Inc apps", kind: "template", ownerProjectId: null, ownerProjectName: null, sample: false, vars: setVars("...7f3a"), configured: true, usedBy: [{ id: "p_tasks", name: "Acme tasks", slug: "acme-tasks", enabled: true }, { id: "p_booking", name: "Room booking", slug: "room-booking", enabled: true }], createdAt: ago(60 * 48), updatedAt: ago(60 * 26) },
  { id: "cs_inv", name: "Invoices Connect app", kind: "project", ownerProjectId: "p_invoices", ownerProjectName: "Invoices", sample: false, vars: setVars("...c21e"), configured: true, usedBy: [{ id: "p_invoices", name: "Invoices", slug: "invoices", enabled: false }], createdAt: ago(60 * 30), updatedAt: ago(60 * 30) },
];

export const templates = (): ConnectTemplatesResponse => ({
  templates: setups.filter((x) => x.kind === "template"),
  projectSetups: setups.filter((x) => x.kind === "project"),
  redirectUri: PREVIEW_CALLBACK,
  store: { preferred: "keychain", label: "the macOS Keychain", file: "~/.builder/env/connect.env" },
  dashboardUrl: "https://app.withone.ai",
  csrf: "mock",
  sample: false,
});

export function projectConnect(projectId: string, slug: string): ProjectConnectResponse {
  const setup = setups.find((x) => x.usedBy.some((u) => u.id === projectId)) ?? null;
  const used = setup?.usedBy.find((u) => u.id === projectId);
  return {
    connect: { enabled: Boolean(used?.enabled), setupId: setup?.id ?? null, via: setup ? (setup.kind === "template" ? "template" : "new") : null },
    setup,
    owned: Boolean(setup && setup.ownerProjectId === projectId),
    ready: Boolean(setup?.configured),
    redirectUris: { preview: PREVIEW_CALLBACK, production: `https://${slug}.vercel.app/api/one/callback`, productionSource: "planned" },
    templates: setups.filter((x) => x.kind === "template"),
    others: setups.filter((x) => x.kind === "project" && x.ownerProjectId !== projectId).map((x) => ({ projectId: x.ownerProjectId!, name: x.ownerProjectName!, slug: "invoices", setup: x })),
    usesOne: projectId === "p_tasks" ? [{ platform: "gmail", name: "Gmail" }] : [],
    previewSignIn: `http://${slug}.localhost:51990/api/one/authorize`,
    store: templates().store,
    dashboardUrl: "https://app.withone.ai",
    csrf: "mock",
    sample: false,
  };
}

const gmailP = { platform: "gmail", name: "Gmail", connDefId: "conn_def::19QDvh", image: "https://assets.withone.ai/connectors/gmail.svg", category: "Email" };
const threads: ManifestAction = { platform: "gmail", connDefId: gmailP.connDefId, actionId: GET_THREADS, title: "List and View Email Threads", method: "POST", level: "read" };
const send: ManifestAction = { platform: "gmail", connDefId: gmailP.connDefId, actionId: SEND_EMAIL, title: "Send Email", method: "POST", level: "write" };

export function scopes(projectId: string): ScopesResponse {
  if (projectId !== "p_tasks") {
    return { manifest: { version: 1, actions: [], unused: [] }, committed: null, lastPublished: null, diff: { added: [], removed: [], raised: [], widened: false, lines: [] }, ask: { name: "ask", connectorRules: [] }, askMissing: [], callSites: [], issues: [], warnings: [], platforms: {}, verbs: {}, visitors: { enabled: false, actions: [] }, visitorEnv: "none" };
  }
  return {
    visitors: { enabled: false, actions: [] },
    visitorEnv: "none",
    verbs: { [GET_THREADS]: "get threads", [SEND_EMAIL]: "send", "conn_mod_def::GJ3oa8bJZNA::ZS9kXmE_Rzi4utfESor_ng": "get profile" },
    manifest: { version: 1, actions: [threads, send], unused: ["conn_mod_def::GJ3oa8bJZNA::ZS9kXmE_Rzi4utfESor_ng"] },
    committed: { version: 1, actions: [threads], unused: [] },
    lastPublished: null,
    diff: { added: [send], removed: [], raised: [], widened: true, lines: ["Gmail · send (write)"] },
    ask: { name: "acme-tasks ask", connectorRules: [{ type: "connectionDefinition", connectionDefinitionId: gmailP.connDefId, methods: ["POST"], actionIds: [GET_THREADS, SEND_EMAIL] }] },
    askMissing: [],
    callSites: [
      { actionId: GET_THREADS, file: "server/inbox.ts", line: 11, col: 13 },
      { actionId: SEND_EMAIL, file: "server/inbox.ts", line: 25, col: 13 },
    ],
    issues: [{ code: "BLD005", severity: "warning", file: "server/digest.ts", line: 8, col: 3, message: "This route calls one(c).run without await requireUser(c) first." }],
    warnings: [{ actionId: "conn_mod_def::GJ3oa8bJZNA::ZS9kXmE_Rzi4utfESor_ng", message: "No schema for this action; types are loose." }],
    platforms: { gmail: gmailP },
  };
}

const localReceipt: Receipt = { line: "Gmail · delete   held locally, not in this app's manifest", source: "local", badge: "Local", caption: "Stopped on your computer before it reached One. Your published app's ask won't include it.", platform: "gmail", actionId: DELETE_MESSAGE, at: ago(3) };
const sampleReceipt: Receipt = { line: "Gmail · delete   declined, 403", source: "sample", badge: "Sample", caption: "Replayed from fixtures in the shape One returns. Not a live call.", platform: "gmail", actionId: DELETE_MESSAGE, at: ago(2) };

let rowId = 100;
const row = (min: number, r: Partial<ActivityRow>): ActivityRow => ({ id: ++rowId, projectId: "p_tasks", at: ago(min), platform: "gmail", actionId: GET_THREADS, title: "List and View Email Threads", method: "POST", path: "/v1/gmail/get-threads", source: "sample", status: 200, ok: true, blockedByGrant: false, refusal: null, ms: 42, turnId: null, ...r });

export function activity(projectId: string): ActivityResponse {
  if (projectId !== "p_tasks") return { rows: [], nextBefore: null, receipts: [] };
  return {
    rows: [
      row(2, { actionId: DELETE_MESSAGE, title: "Permanently Delete a User's Gmail Message", method: "DELETE", status: 403, ok: false, blockedByGrant: true, refusal: { source: "sample", code: "blocked_by_grant" }, ms: 18 }),
      row(3, { actionId: DELETE_MESSAGE, title: "Permanently Delete a User's Gmail Message", method: "DELETE", source: "local", status: 403, ok: false, refusal: { source: "local", code: "not_in_manifest" }, ms: 6 }),
      row(9, { actionId: SEND_EMAIL, title: "Send Email", source: "held", status: 423, ok: false, refusal: { source: "held", code: "held_during_build" }, ms: 4 }),
      row(11, { ms: 51 }),
      row(12, { ms: 47 }),
      row(40, { source: "platform", title: "Added Send Email", method: "GET", path: "catalog load", ms: null }),
      row(41, { source: "platform", title: "Searched Gmail actions", method: "GET", path: "catalog find", actionId: null, ms: null }),
    ],
    nextBefore: null,
    receipts: [sampleReceipt, localReceipt],
  };
}

export const accessTest = (kind: "local" | "one"): AccessTestResponse => ({
  receipt: kind === "local" ? { ...localReceipt, at: new Date().toISOString() } : { ...sampleReceipt, at: new Date().toISOString() },
  note: null,
  action: { actionId: DELETE_MESSAGE, title: "Permanently Delete a User's Gmail Message", method: "DELETE" },
});
