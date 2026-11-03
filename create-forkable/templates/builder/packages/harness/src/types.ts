// The harness contract. Browser-safe: types only.

export type HarnessId = "claude-code" | "codex" | "openclaw" | "replay";

export interface HarnessModel {
  id: string;
  label: string;
  hint?: string;
  contextWindow?: number;
}

export interface HarnessCaps {
  stream: "token" | "block" | "final";
  resume: "native" | "state-dir" | "none";
  mcp: "per-run" | "none";
  images: boolean;
  steer: boolean;
  plan: boolean;
  costUsd: boolean;
}

export interface HarnessInfo {
  id: HarnessId;
  label: string; // "Claude Code", "Codex", "OpenClaw"
  status: "ready" | "preview"; // openclaw = "preview"
  bin: string | null;
  version: string | null;
  signedIn: boolean | null; // null = cannot tell
  searched?: string[]; // when bin is null
  models: HarnessModel[];
  caps: HarnessCaps;
  /** Human sentence when something is off ("Sign in to Claude Code"), else undefined. */
  note?: string;
}

export type Permission = "build" | "plan" | "full";

export interface McpSpec {
  /** Server name the agent sees (default "builder", see names.ts). */
  name?: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface TurnInput {
  cwd: string;
  prompt: string; // > 100 KB spilled to stateDir/prompt-<turn>.md
  images?: string[]; // absolute paths under .builder/shots
  sessionId?: string | null; // only when owned by this harness
  model?: string | null; // in this harness's namespace
  permission: Permission;
  systemAppend: string; // per-turn facts (5.7)
  mcp: McpSpec | null;
  env: Record<string, string>; // cleanEnv() + tags + shim PATH first
  extraAllow?: string[]; // "Allow once" grants from the UI
  timeoutMs: number; // default 20 min
  idleMs: number; // default 4 min without output
  /** Where spill files and full logs go (BUILDER_HOME/state/<projectId>). */
  stateDir: string;
  /** Turn id, for spill/log file names. */
  turnId: string;
  /** Claude only: JSON for --settings (steer hook + permissions.deny). Built by the caller. */
  settingsJson?: string;
  /** Replay only: scenario file (fixtures/replay/<scenario>.json) and the turn index to play. */
  replay?: { file: string; index?: number; speed?: number };
  /** Claude only: the session's running total_cost_usd before this turn, so costUsd is a delta. */
  priorCostUsd?: number | null;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export type ToolKind = "read" | "write" | "run" | "one" | "other";

export type HarnessEvent =
  | { t: "session"; id: string }
  // text_delta streams the block being written; text is the finished block and
  // replaces whatever deltas came before it since the last text.
  | { t: "text_delta"; text: string }
  | { t: "text"; text: string }
  | { t: "thinking"; text: string; delta?: boolean }
  | {
      t: "tool_start";
      id: string;
      name: string;
      kind: ToolKind;
      /** The command, path, pattern or query, for the card's expanded view. */
      detail?: string;
      /** Project-relative when inside cwd, else absolute. */
      files?: string[];
      /** Small tool inputs (MCP tools only), strings clipped. Feeds describeTool. */
      input?: Record<string, unknown>;
    }
  | { t: "tool_end"; id: string; ok: boolean; preview?: string }
  | { t: "denied"; tool: string; reason?: string }
  | { t: "usage"; usage: Usage; total: boolean }
  | { t: "limit"; resetsAt?: string }
  | { t: "retry"; attempt: number; error: string }
  | { t: "mcp"; name: string; status: "connected" | "failed"; error?: string }
  | { t: "error"; message: string };

export type TurnExit = "ok" | "error" | "cancelled" | "timeout" | "limit" | "signed_out";

export interface TurnResult {
  sessionId: string | null;
  text: string;
  usage: Usage;
  costUsd: number | null; // CLI estimate, never billed by us
  exit: TurnExit;
  error?: string;
  /** Claude: the session's running total_cost_usd after this turn (store it, pass as priorCostUsd). */
  sessionCostUsd?: number | null;
}

export interface Turn {
  events: AsyncIterable<HarnessEvent>;
  done: Promise<TurnResult>;
  cancel(): Promise<void>; // SIGINT, then group SIGTERM after 3 s, SIGKILL after 5 more
  steer?(text: string): void;
}

export interface Harness {
  id: HarnessId;
  detect(force?: boolean): Promise<HarnessInfo>;
  start(input: TurnInput): Turn;
}

export const ZERO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
