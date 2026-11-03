import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EventQueue } from "../queue.js";
import { ZERO_USAGE, type HarnessEvent, type HarnessInfo, type Turn, type TurnInput, type TurnResult } from "../types.js";

/** Prompts past this are written to a file and named instead. */
export const SPILL_BYTES = 100 * 1024;
export const DETECT_TTL_MS = 10 * 60_000;

/** Error prefix when a resume found no conversation. Core retries fresh with a handoff block. */
export const RESUME_FAILED = "resume_failed";

export function isResumeFailure(result: Pick<TurnResult, "error">): boolean {
  return !!result.error && result.error.startsWith(RESUME_FAILED);
}

/** The prompt as the CLI should get it: images named first, big prompts spilled to a file. */
export function preparePrompt(input: TurnInput): string {
  let prompt = input.prompt;
  if (input.images?.length) {
    const lines = input.images.map((p) => `Read this image first: ${p}`);
    prompt = `${lines.join("\n")}\n\n${prompt}`;
  }
  if (Buffer.byteLength(prompt, "utf8") > SPILL_BYTES) {
    try {
      mkdirSync(input.stateDir, { recursive: true });
      const file = path.join(input.stateDir, `prompt-${input.turnId}.md`);
      writeFileSync(file, prompt);
      return `The full request is in ${file}. Read that file first, then do what it asks.`;
    } catch {
      // fall back to the full prompt
    }
  }
  return prompt;
}

/** Codex and OpenClaw have no append flag: the per-turn facts ride in a fenced block. */
export function withPlatformNotes(prompt: string, systemAppend: string): string {
  const notes = systemAppend.trim();
  if (!notes) return prompt;
  return `\`\`\`text Platform notes\n${notes}\n\`\`\`\n\n${prompt}`;
}

export function logFileFor(input: TurnInput): string {
  return path.join(input.stateDir, `turn-${input.turnId}.log`);
}

export function failedResult(error: string, exit: TurnResult["exit"] = "error"): TurnResult {
  return { sessionId: null, text: "", usage: { ...ZERO_USAGE }, costUsd: null, exit, error };
}

/**
 * Turn plumbing shared by the spawning adapters: an event queue the body
 * pushes into, a cancel hook the body sets, done when the body resolves.
 */
export function makeTurn(
  body: (ctx: { push(ev: HarnessEvent): void; onCancel(fn: () => Promise<void>): void; cancelled(): boolean }) => Promise<TurnResult>,
): Turn {
  const q = new EventQueue<HarnessEvent>();
  let cancelFn: (() => Promise<void>) | null = null;
  let wasCancelled = false;
  const done = (async () => {
    try {
      return await body({
        push: (ev) => q.push(ev),
        onCancel: (fn) => {
          cancelFn = fn;
        },
        cancelled: () => wasCancelled,
      });
    } catch (err) {
      return failedResult((err as Error).message ?? String(err));
    } finally {
      q.end();
    }
  })();
  return {
    events: q,
    done,
    async cancel() {
      wasCancelled = true;
      if (cancelFn) await cancelFn();
      await done.catch(() => {});
    },
  };
}

/** Per-harness detect cache. */
export function cachedDetect(fn: () => Promise<HarnessInfo>): (force?: boolean) => Promise<HarnessInfo> {
  let cached: { at: number; info: HarnessInfo } | null = null;
  let inflight: Promise<HarnessInfo> | null = null;
  return async (force = false) => {
    // A miss (not installed) is always re-probed: "install, then Retry" must work.
    if (!force && cached && cached.info.bin && Date.now() - cached.at < DETECT_TTL_MS) return cached.info;
    if (inflight) return inflight;
    inflight = fn()
      .then((info) => {
        cached = { at: Date.now(), info };
        return info;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}
