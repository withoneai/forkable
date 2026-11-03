/**
 * OpenClaw adapter, shown as "Preview". Written fresh: the
 * generic plain-stdout adapter elsewhere is not valid for 2026.8.1.
 *
 * Verified on OpenClaw 2026.8.1, 2026-10-24:
 * - `openclaw agent exec --json --cwd <dir> --state-dir <dir> --message-file -
 *   --timeout <s>` reads the prompt from stdin and prints one envelope at the
 *   end (fixtures/harness/openclaw/error-runtime-missing.json).
 * - `--state-dir` must already exist ("Use an existing state directory").
 * - On this machine every run fails before the model with OpenClaw's own
 *   message: the configured "codex" runtime plugin is missing. `--isolated`
 *   fails the same way. So a successful envelope and state-dir resume could
 *   not be observed; two failed runs with one state dir got different
 *   sessionIds. Resume is treated as "the same state dir", unverified.
 * - Nothing streams, so the idle clock is off for this harness (only the
 *   hard ceiling applies).
 */

import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveBinPath, searchedDirs, versionOf } from "../binPath.js";
import { cleanEnv } from "../env.js";
import { runProcess, startProcess } from "../executor.js";
import { isOpenClawSetupError, openClawEvents, parseOpenClawEnvelope } from "../parsers/openclaw.js";
import { openclawSupports } from "../permissions.js";
import type { Harness, HarnessInfo, TurnInput, TurnResult } from "../types.js";
import { ZERO_USAGE } from "../types.js";
import { cachedDetect, failedResult, logFileFor, makeTurn, preparePrompt, withPlatformNotes } from "./common.js";

export const OPENCLAW_NOTE = "Runs one step at a time. You see the result when it finishes.";

export function openclawStateDir(input: Pick<TurnInput, "stateDir">): string {
  return path.join(input.stateDir, "openclaw");
}

export function openclawArgv(bin: string, input: TurnInput): string[] {
  const seconds = Math.max(30, Math.ceil(input.timeoutMs / 1000));
  return [
    bin, "agent", "exec", "--json",
    "--cwd", input.cwd,
    "--state-dir", openclawStateDir(input),
    "--message-file", "-",
    "--timeout", String(seconds),
    ...(input.model ? ["--model", input.model] : []),
  ];
}

const CAPS: HarnessInfo["caps"] = {
  stream: "final",
  resume: "state-dir",
  mcp: "none",
  images: false,
  steer: false,
  plan: false,
  costUsd: true,
};

async function detectOpenClaw(): Promise<HarnessInfo> {
  const base = { id: "openclaw" as const, label: "OpenClaw", status: "preview" as const, caps: CAPS, signedIn: null, models: [] };
  const bin = resolveBinPath("openclaw");
  if (!bin) return { ...base, bin: null, version: null, searched: searchedDirs(), note: "OpenClaw is not installed" };
  const ver = await runProcess([bin, "--version"], { cwd: os.tmpdir(), timeoutMs: 10_000, env: cleanEnv() });
  return { ...base, bin, version: versionOf(ver.stdout), note: OPENCLAW_NOTE };
}

export const openclawHarness: Harness = {
  id: "openclaw",
  detect: cachedDetect(detectOpenClaw),
  start(input: TurnInput) {
    return makeTurn(async ({ push, onCancel, cancelled }) => {
      if (!openclawSupports(input.permission)) return failedResult("Plan mode is not available for OpenClaw");
      const bin = resolveBinPath("openclaw");
      if (!bin) return failedResult("OpenClaw is not installed");
      mkdirSync(openclawStateDir(input), { recursive: true });
      const prompt = withPlatformNotes(preparePrompt(input), input.systemAppend);
      const proc = startProcess(openclawArgv(bin, input), {
        cwd: input.cwd,
        env: input.env,
        stdin: prompt,
        // The ceiling sits a little past OpenClaw's own --timeout so its envelope wins.
        timeoutMs: input.timeoutMs + 15_000,
        idleMs: 0,
        logFile: logFileFor(input),
      });
      onCancel(() => proc.cancel());
      const r = await proc.done;
      const env = parseOpenClawEnvelope(r.stdout);
      if (env) for (const ev of openClawEvents(env)) push(ev);
      const result: TurnResult = {
        sessionId: env?.sessionId ?? null,
        text: env?.final ?? "",
        usage: env?.usage ?? { ...ZERO_USAGE },
        costUsd: env?.costUsd ?? null,
        exit: "ok",
      };
      if (r.spawnError) return { ...result, exit: "error", error: `Could not start OpenClaw: ${r.spawnError}` };
      // Exit codes: 0 ok, 1 error, 2 timeout, 130 SIGINT, 143 SIGTERM.
      if (cancelled() || r.cancelled || r.exitCode === 130 || r.exitCode === 143) return { ...result, exit: "cancelled" };
      if (r.timedOut || r.exitCode === 2 || env?.status === "timeout") return { ...result, exit: "timeout", error: env?.error?.message ?? "The turn ran past its time limit" };
      if (!env) return { ...result, exit: "error", error: r.stderr.trim().slice(0, 2000) || `OpenClaw exited with ${r.exitCode ?? r.signal} and no result` };
      if (!env.ok || r.exitCode !== 0) return { ...result, exit: "error", error: env.error?.message ?? "OpenClaw could not finish this step" };
      return result;
    });
  },
};

export { isOpenClawSetupError };
