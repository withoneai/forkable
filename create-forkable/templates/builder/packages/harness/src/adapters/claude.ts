// Adapted from earlier One Systems code (MIT).
// Copyright (c) 2026 One Systems, Inc.
// Portions Copyright (c) 2025 Paperclip AI (forked). See LICENSES/harness-MIT.txt.

/**
 * Claude Code adapter, the primary harness.
 *
 * Verified on Claude Code 2.1.306, 2026-10-24, with real Haiku calls
 * (fixtures/harness/claude):
 * - `-p --output-format stream-json --verbose --session-id <uuid we mint>`
 *   works with the prompt on stdin; system/init reports our id.
 * - `-r <id> -p ...` resumes the same session (same id back).
 * - A resume with an unknown id exits 1 with a `result` whose
 *   `errors: ["No conversation found with session ID: ..."]`.
 * - `--permission-prompts none` exists (choices host, none) and
 *   `--permission-mode` takes acceptEdits, auto, bypassPermissions, manual,
 *   dontAsk, plan. A deny rule (`Bash(curl *)`) refuses with
 *   system/permission_denied and result.permission_denials.
 * - In acceptEdits, read-only commands Claude considers safe (`date`) run
 *   even when the allow list does not name them.
 * - `--strict-mcp-config --mcp-config '{"mcpServers":{"builder":...}}'`
 *   shows `mcp_servers: [{name:"builder", status:"connected"}]` in init.
 * - `--setting-sources project,local` skips the user's hooks: with
 *   `--include-hook-events`, the user PreToolUse:Bash hook fired with
 *   `user,project,local` and did not fire without `user`. Hooks passed
 *   through `--settings` still run (our PostToolUse steer hook fired and
 *   its additionalContext reached the model).
 * - `--include-partial-messages` is listed in --help (probed at runtime).
 */

import { randomUUID } from "node:crypto";
import os from "node:os";
import { resolveBinPath, searchedDirs, versionOf } from "../binPath.js";
import { cleanEnv } from "../env.js";
import { runProcess, startProcess } from "../executor.js";
import { CLAUDE_FALLBACK_MODELS, discoverClaudeModels } from "../modelCatalog.js";
import { HARNESS_NAMES } from "../names.js";
import { ClaudeStreamParser } from "../parsers/claude.js";
import { claudePermissionFlags, claudeSettingsJson } from "../permissions.js";
import { UsageMeter } from "../usage.js";
import type { Harness, HarnessInfo, TurnInput, TurnResult } from "../types.js";
import { cachedDetect, failedResult, logFileFor, makeTurn, preparePrompt, RESUME_FAILED } from "./common.js";

const STDIN_CAP = 10 * 1024 * 1024;

const partialProbes = new Map<string, Promise<boolean>>();
/** Does this `claude` understand --include-partial-messages? `--help` once, then cached. */
export function claudeSupportsPartial(bin: string): Promise<boolean> {
  let probe = partialProbes.get(bin);
  if (!probe) {
    probe = runProcess([bin, "--help"], { cwd: os.tmpdir(), timeoutMs: 10_000, env: cleanEnv() })
      .then((r) => /--include-partial-messages/.test(`${r.stdout}\n${r.stderr}`))
      .catch(() => false);
    partialProbes.set(bin, probe);
  }
  return probe;
}

export interface ClaudeArgvOpts {
  partial: boolean;
  sessionId: string;
  resume: boolean;
}

/** The argv for one turn (exported for the permission table tests). */
export function claudeArgv(bin: string, input: TurnInput, o: ClaudeArgvOpts): string[] {
  const argv = [bin];
  if (o.resume) argv.push("-r", o.sessionId);
  argv.push("-p", "--output-format", "stream-json", "--verbose");
  if (o.partial) argv.push("--include-partial-messages");
  if (!o.resume) argv.push("--session-id", o.sessionId);
  if (input.model) argv.push("--model", input.model);
  argv.push("--setting-sources", "project,local", "--strict-mcp-config");
  if (input.mcp) {
    const name = input.mcp.name ?? HARNESS_NAMES.slug;
    argv.push("--mcp-config", JSON.stringify({ mcpServers: { [name]: { command: input.mcp.command, args: input.mcp.args, env: input.mcp.env } } }));
  }
  if (input.systemAppend.trim()) argv.push("--append-system-prompt", input.systemAppend);
  argv.push("--settings", input.settingsJson ?? claudeSettingsJson({}));
  // Permission flags last: --allowedTools and --disallowedTools are variadic.
  argv.push(...claudePermissionFlags(input.permission, input.extraAllow ?? []));
  return argv;
}

/** One tool-less Haiku line: the only reliable "is the subscription signed in" test. */
async function probeSignIn(bin: string): Promise<boolean | null> {
  const r = await runProcess(
    [bin, "-p", "--model", "haiku", "--tools", "", "--setting-sources", "project,local", "--strict-mcp-config", "--output-format", "json", "Reply with the word ready"],
    { cwd: os.tmpdir(), timeoutMs: 30_000, env: cleanEnv() },
  );
  const text = `${r.stdout}\n${r.stderr}`;
  if (/not logged in|\/login|invalid api key|authentication_failed|please run .*login/i.test(text)) return false;
  try {
    const out = JSON.parse(r.stdout.trim()) as { is_error?: boolean };
    if (r.exitCode === 0 && out.is_error !== true) return true;
  } catch {
    // not JSON
  }
  return r.exitCode === 0 ? true : null;
}

const CAPS: HarnessInfo["caps"] = {
  stream: "token",
  resume: "native",
  mcp: "per-run",
  images: true,
  steer: true,
  plan: true,
  costUsd: true,
};

async function detectClaude(): Promise<HarnessInfo> {
  const base = { id: "claude-code" as const, label: "Claude Code", status: "ready" as const, caps: CAPS };
  const bin = resolveBinPath("claude");
  if (!bin) {
    return { ...base, bin: null, version: null, signedIn: null, searched: searchedDirs(), models: CLAUDE_FALLBACK_MODELS, note: "Claude Code is not installed" };
  }
  const [ver, signedIn, partial] = await Promise.all([
    runProcess([bin, "--version"], { cwd: os.tmpdir(), timeoutMs: 10_000, env: cleanEnv() }),
    probeSignIn(bin).catch(() => null),
    claudeSupportsPartial(bin),
  ]);
  const discovered = discoverClaudeModels(bin);
  return {
    ...base,
    caps: { ...CAPS, stream: partial ? "token" : "block" },
    bin,
    version: versionOf(ver.stdout),
    signedIn,
    models: discovered.length ? discovered : CLAUDE_FALLBACK_MODELS,
    ...(signedIn === false ? { note: "Sign in to Claude Code. Run claude in a terminal and log in, then retry." } : {}),
  };
}

const lastCost = new Map<string, number>();

export const claudeHarness: Harness = {
  id: "claude-code",
  detect: cachedDetect(detectClaude),
  start(input: TurnInput) {
    return makeTurn(async ({ push, onCancel, cancelled }) => {
      const bin = resolveBinPath("claude");
      if (!bin) return failedResult("Claude Code is not installed");
      const partial = await claudeSupportsPartial(bin);
      const resume = !!input.sessionId;
      const sessionId = input.sessionId ?? randomUUID();
      const prompt = preparePrompt(input);
      if (Buffer.byteLength(prompt) > STDIN_CAP) return failedResult("The prompt is over 10 MB");
      const argv = claudeArgv(bin, input, { partial, sessionId, resume });
      const parser = new ClaudeStreamParser(input.cwd, input.mcp?.name ?? HARNESS_NAMES.slug);
      const meter = new UsageMeter();
      let text = "";
      let pending = "";
      let mcpFailure: string | null = null;
      let sawInit = false;

      const proc = startProcess(argv, {
        cwd: input.cwd,
        env: input.env,
        stdin: prompt,
        timeoutMs: input.timeoutMs,
        idleMs: input.idleMs,
        logFile: logFileFor(input),
        onLine: (line) => {
          for (const ev of parser.parse(line)) {
            if (ev.t === "text_delta") pending += ev.text;
            if (ev.t === "text") {
              text = text ? `${text}\n\n${ev.text}` : ev.text;
              pending = "";
            }
            if (ev.t === "usage") meter.push(ev);
            push(ev);
          }
          if (!sawInit && parser.init) {
            sawInit = true;
            if (input.mcp) {
              const name = input.mcp.name ?? HARNESS_NAMES.slug;
              const server = parser.init.mcpServers.find((s) => s.name === name);
              if (!server || server.status !== "connected") {
                mcpFailure = parser.init.mcpErrors.join("; ") || (server ? `status ${server.status}` : "not listed");
                if (!server) push({ t: "mcp", name, status: "failed", error: mcpFailure });
                void proc.cancel();
              }
            }
          }
        },
      });
      onCancel(() => proc.cancel());
      const r = await proc.done;
      const final = parser.final;
      const realSession = parser.init?.sessionId ?? null;
      const errorsText = final?.errors.join("; ") ?? "";
      let costUsd: number | null = null;
      const sessionCostUsd = final?.totalCostUsd ?? null;
      if (sessionCostUsd !== null && realSession) {
        // On resume total_cost_usd is the conversation's running total: take the delta.
        const prior = input.priorCostUsd ?? (resume ? (lastCost.get(realSession) ?? null) : 0);
        costUsd = prior === null ? null : Math.max(0, sessionCostUsd - prior);
        lastCost.set(realSession, sessionCostUsd);
      }
      const result: TurnResult = {
        sessionId: realSession,
        text: final?.text || text || pending,
        usage: meter.value,
        costUsd,
        sessionCostUsd,
        exit: "ok",
      };
      if (r.spawnError) return { ...result, exit: "error", error: `Could not start Claude Code: ${r.spawnError}` };
      if (mcpFailure) return { ...result, exit: "error", error: `The catalog tool did not start: ${mcpFailure}` };
      if (cancelled() || r.cancelled) return { ...result, exit: "cancelled" };
      if (r.timedOut) return { ...result, exit: "timeout", error: r.timeoutKind === "idle" ? "No output for too long" : "The turn ran past its time limit" };
      if (/No conversation found/i.test(errorsText) || /No conversation found/i.test(r.stderr)) {
        return { ...result, sessionId: null, exit: "error", error: `${RESUME_FAILED}: ${errorsText || r.stderr.trim()}` };
      }
      if (parser.signedOut) return { ...result, exit: "signed_out", error: errorsText || "Claude Code is signed out" };
      if (parser.limited && (final?.isError || r.exitCode !== 0)) return { ...result, exit: "limit", error: errorsText || "Usage limit reached" };
      if (final?.isError || r.exitCode !== 0) {
        return { ...result, exit: "error", error: errorsText || r.stderr.trim().slice(0, 2000) || `Claude Code exited with ${r.exitCode ?? r.signal}` };
      }
      return result;
    });
  },
};
