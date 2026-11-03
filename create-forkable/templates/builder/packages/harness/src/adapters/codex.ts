// Adapted from earlier One Systems code (MIT).
// Copyright (c) 2026 One Systems, Inc.
// Portions Copyright (c) 2025 Paperclip AI (forked). See LICENSES/harness-MIT.txt.

/**
 * Codex adapter.
 *
 * Verified on codex-cli 0.163.0, 2026-10-24, with real calls
 * (fixtures/harness/codex):
 * - `codex exec --json -C <dir> --sandbox workspace-write -m <model> ... -`
 *   reads the prompt from stdin.
 * - `codex exec resume <thread> --json -c sandbox_mode="workspace-write" -`
 *   continues the thread (resume has no --sandbox and no -C: cwd comes from
 *   the spawn).
 * - Per-run MCP through `-c mcp_servers.<name>.command/args/env` works, but
 *   exec's approval policy is "never", so every MCP call is refused ("MCP
 *   tool call requires approval, but approval policy is never") unless
 *   `mcp_servers.<name>.default_tools_approval_mode="approve"` is set
 *   (valid values: auto, prompt, writes, approve). We set it: the tools are
 *   read-only catalog lookups.
 * - With the sandbox on, the MCP child reached 127.0.0.1 (it runs outside
 *   the sandbox); a shell `curl` to the same loopback port failed (exit 7):
 *   the agent's shell has no network, the MCP server does.
 * - `codex login status` exits 0 when signed in.
 */

import os from "node:os";
import { resolveBinPath, searchedDirs, versionOf } from "../binPath.js";
import { cleanEnv } from "../env.js";
import { runProcess, startProcess } from "../executor.js";
import { discoverCodexModels } from "../modelCatalog.js";
import { HARNESS_NAMES } from "../names.js";
import { CodexStreamParser } from "../parsers/codex.js";
import { codexPermissionFlags, codexResumePermissionFlags } from "../permissions.js";
import { UsageMeter } from "../usage.js";
import type { Harness, HarnessInfo, McpSpec, TurnInput, TurnResult } from "../types.js";
import { cachedDetect, failedResult, logFileFor, makeTurn, preparePrompt, RESUME_FAILED, withPlatformNotes } from "./common.js";

const tomlString = (s: string): string => JSON.stringify(s);
const tomlKey = (k: string): string => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k));

/** `-c` overrides that register the MCP server for this run only. */
export function codexMcpArgs(mcp: McpSpec): string[] {
  const name = mcp.name ?? HARNESS_NAMES.slug;
  const env = Object.entries(mcp.env)
    .map(([k, v]) => `${tomlKey(k)}=${tomlString(v)}`)
    .join(",");
  return [
    "-c", `mcp_servers.${name}.command=${tomlString(mcp.command)}`,
    "-c", `mcp_servers.${name}.args=[${mcp.args.map(tomlString).join(",")}]`,
    "-c", `mcp_servers.${name}.env={${env}}`,
    "-c", `mcp_servers.${name}.default_tools_approval_mode="approve"`,
  ];
}

export function codexArgv(bin: string, input: TurnInput): string[] {
  const resume = !!input.sessionId;
  const images = (input.images ?? []).flatMap((p) => ["-i", p]);
  const model = input.model ? ["-m", input.model] : [];
  const mcp = input.mcp ? codexMcpArgs(input.mcp) : [];
  if (resume) {
    return [bin, "exec", "resume", input.sessionId!, "--json", ...images, ...model, ...codexResumePermissionFlags(input.permission), ...mcp, "-"];
  }
  return [bin, "exec", "--json", "-C", input.cwd, ...images, ...model, ...codexPermissionFlags(input.permission), ...mcp, "-"];
}

const CAPS: HarnessInfo["caps"] = {
  stream: "block",
  resume: "native",
  mcp: "per-run",
  images: true,
  steer: false,
  plan: true,
  costUsd: false,
};

async function detectCodex(): Promise<HarnessInfo> {
  const base = { id: "codex" as const, label: "Codex", status: "ready" as const, caps: CAPS };
  const bin = resolveBinPath("codex");
  if (!bin) return { ...base, bin: null, version: null, signedIn: null, searched: searchedDirs(), models: [], note: "Codex is not installed" };
  const env = cleanEnv();
  const [ver, login, models] = await Promise.all([
    runProcess([bin, "--version"], { cwd: os.tmpdir(), timeoutMs: 10_000, env }),
    runProcess([bin, "login", "status"], { cwd: os.tmpdir(), timeoutMs: 15_000, env }),
    discoverCodexModels(bin, env).catch(() => []),
  ]);
  const signedIn = login.spawnError ? null : login.exitCode === 0;
  return {
    ...base,
    bin,
    version: versionOf(ver.stdout),
    signedIn,
    models,
    ...(signedIn === false ? { note: "Sign in to Codex. Run codex login in a terminal, then retry." } : {}),
  };
}

export const codexHarness: Harness = {
  id: "codex",
  detect: cachedDetect(detectCodex),
  start(input: TurnInput) {
    return makeTurn(async ({ push, onCancel, cancelled }) => {
      const bin = resolveBinPath("codex");
      if (!bin) return failedResult("Codex is not installed");
      const prompt = withPlatformNotes(preparePrompt(input), input.systemAppend);
      const parser = new CodexStreamParser(input.cwd, input.mcp?.name ?? HARNESS_NAMES.slug);
      const meter = new UsageMeter();
      const proc = startProcess(codexArgv(bin, input), {
        cwd: input.cwd,
        env: input.env,
        stdin: prompt,
        timeoutMs: input.timeoutMs,
        idleMs: input.idleMs,
        logFile: logFileFor(input),
        onLine: (line) => {
          for (const ev of parser.parse(line)) {
            if (ev.t === "usage") meter.push(ev);
            push(ev);
          }
        },
      });
      onCancel(() => proc.cancel());
      const r = await proc.done;
      const result: TurnResult = {
        sessionId: parser.threadId ?? input.sessionId ?? null,
        text: parser.lastText,
        usage: meter.value,
        costUsd: null,
        exit: "ok",
      };
      const stderr = r.stderr.trim();
      if (r.spawnError) return { ...result, exit: "error", error: `Could not start Codex: ${r.spawnError}` };
      if (cancelled() || r.cancelled) return { ...result, exit: "cancelled" };
      if (r.timedOut) return { ...result, exit: "timeout", error: r.timeoutKind === "idle" ? "No output for too long" : "The turn ran past its time limit" };
      if (input.sessionId && !parser.threadId && /no (?:rollout|session|thread|conversation)[^\n]*found|not found/i.test(stderr)) {
        return { ...result, sessionId: null, exit: "error", error: `${RESUME_FAILED}: ${stderr.slice(0, 500)}` };
      }
      if (parser.signedOut || /not logged in|codex login/i.test(stderr)) return { ...result, exit: "signed_out", error: parser.failed ?? "Codex is signed out" };
      if (parser.limited) return { ...result, exit: "limit", error: parser.failed ?? "Usage limit reached" };
      if (parser.failed || r.exitCode !== 0) {
        return { ...result, exit: "error", error: parser.failed ?? (stderr.slice(0, 2000) || `Codex exited with ${r.exitCode ?? r.signal}`) };
      }
      return result;
    });
  },
};
