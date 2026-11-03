import os from "node:os";
import path from "node:path";
import { HARNESS_NAMES } from "./names.js";

/**
 * The environment a harness process gets. Nothing of ours rides along: no
 * One credential, no database URL, no platform variables, and none of the
 * session variables of a Claude Code that may have started the server
 * (a nested `claude` reads those and misbehaves).
 */

const STRIP_PREFIXES = ["ONE_", "PG"];
const STRIP_EXACT = new Set([
  "DATABASE_URL",
  // A parent Claude Code session's own variables.
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
]);
const STRIP_PATTERNS = [/^CLAUDE_CODE_SESSION_/, /^CLAUDE_CODE_MESSAGING_/];
/** Provider keys: stripped unless the builder opted into API-key mode. */
const API_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY"];

export function cleanEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const prefix = HARNESS_NAMES.envPrefix;
  const keyMode = base[`${prefix}API_KEY_MODE`] === "1";
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (k.startsWith(prefix)) continue;
    if (STRIP_PREFIXES.some((p) => k.startsWith(p))) continue;
    if (STRIP_EXACT.has(k) || STRIP_PATTERNS.some((re) => re.test(k))) continue;
    if (!keyMode && API_KEYS.includes(k)) continue;
    out[k] = v;
  }
  // Claude keys its Keychain entry off whether CLAUDE_CONFIG_DIR is set at all:
  // never pass it pointing at the default dir.
  const cfg = out.CLAUDE_CONFIG_DIR;
  if (cfg && path.resolve(cfg) === path.join(os.homedir(), ".claude")) delete out.CLAUDE_CONFIG_DIR;
  return out;
}

export interface AgentEnvOpts {
  projectId: string;
  turnId: string;
  shimsDir: string;
  base?: NodeJS.ProcessEnv;
  /** Extra variables (e.g. BUILDER_API, BUILDER_TURN_TOKEN for shims). Added last. */
  extra?: Record<string, string>;
}

/** cleanEnv() + the agent tags + the shims dir first on PATH. */
export function agentEnv(o: AgentEnvOpts): Record<string, string> {
  const p = HARNESS_NAMES.envPrefix;
  const env = cleanEnv(o.base);
  env[`${p}AGENT`] = "1";
  env[`${p}PROJECT_ID`] = o.projectId;
  env[`${p}TURN_ID`] = o.turnId;
  const rest = (env.PATH ?? "").split(path.delimiter).filter((d) => d && d !== o.shimsDir);
  env.PATH = [o.shimsDir, ...rest].join(path.delimiter);
  return { ...env, ...(o.extra ?? {}) };
}
