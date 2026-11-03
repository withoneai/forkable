// @builder/harness: find and drive the coding agents the builder already has.
// No server, DB or UI imports (CONTRACT 1).

import { claudeHarness } from "./adapters/claude.js";
import { codexHarness } from "./adapters/codex.js";
import { openclawHarness } from "./adapters/openclaw.js";
import { replayHarness } from "./adapters/replay.js";
import { clearBinCache } from "./binPath.js";
import { HARNESS_NAMES } from "./names.js";
import type { Harness, HarnessId, HarnessInfo } from "./types.js";

export * from "./types.js";
export { HARNESS_NAMES, mcpPrefix } from "./names.js";
export { resolveBin, resolveBinPath, searchedDirs, clearBinCache, versionOf, wellKnownBinDirs } from "./binPath.js";
export {
  startProcess,
  runProcess,
  killAllGroups,
  groupAlive,
  type ProcessOpts,
  type ProcessResult,
  type RunningProcess,
} from "./executor.js";
export { cleanEnv, agentEnv, type AgentEnvOpts } from "./env.js";
export {
  DENY_LIST,
  BUILD_ALLOW,
  claudePermissionFlags,
  codexPermissionFlags,
  codexResumePermissionFlags,
  openclawSupports,
  claudeSettingsJson,
  projectClaudeSettings,
} from "./permissions.js";
export { describeTool, describeDenied, platformName, unwrapCommand } from "./describe.js";
export { ClaudeStreamParser } from "./parsers/claude.js";
export { CodexStreamParser } from "./parsers/codex.js";
export { parseOpenClawEnvelope, openClawEvents, isOpenClawSetupError } from "./parsers/openclaw.js";
export { UsageMeter } from "./usage.js";
export { RESUME_FAILED, isResumeFailure, SPILL_BYTES } from "./adapters/common.js";
export { claudeArgv, claudeSupportsPartial } from "./adapters/claude.js";
export { codexArgv, codexMcpArgs } from "./adapters/codex.js";
export { openclawArgv, openclawStateDir, OPENCLAW_NOTE } from "./adapters/openclaw.js";
export { loadScenario, pickTurn, type ReplayScenario, type ReplayTurn } from "./adapters/replay.js";
export { discoverClaudeModels, discoverCodexModels, parseClaudeCatalog, codexWindows, CLAUDE_FALLBACK_MODELS } from "./modelCatalog.js";
export { codexSessionContext, type SessionContext } from "./sessionContext.js";

const HARNESSES: Record<HarnessId, Harness> = {
  "claude-code": claudeHarness,
  codex: codexHarness,
  openclaw: openclawHarness,
  replay: replayHarness,
};

/** Picker order: Claude Code first. */
export const HARNESS_ORDER: HarnessId[] = ["claude-code", "codex", "openclaw", "replay"];

export function getHarness(id: HarnessId): Harness {
  const h = HARNESSES[id];
  if (!h) throw new Error(`Unknown harness ${id}`);
  return h;
}

/** Every harness's HarnessInfo. Replay only with includeReplay or BUILDER_DEV=1. */
export async function detectAll(opts: { force?: boolean; includeReplay?: boolean } = {}): Promise<HarnessInfo[]> {
  if (opts.force) clearBinCache();
  const withReplay = opts.includeReplay || process.env[`${HARNESS_NAMES.envPrefix}DEV`] === "1";
  const ids = HARNESS_ORDER.filter((id) => id !== "replay" || withReplay);
  return Promise.all(ids.map((id) => HARNESSES[id].detect(opts.force)));
}

/** The default: the first ready, installed harness that is not signed out (Claude Code first). */
export function pickDefault(infos: HarnessInfo[]): HarnessId | null {
  const usable = infos.filter((i) => i.id !== "replay" && i.bin && i.signedIn !== false);
  return (usable.find((i) => i.status === "ready") ?? usable[0])?.id ?? null;
}
