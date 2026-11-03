// Adapted from earlier One Systems code (MIT).
// Copyright (c) 2026 One Systems, Inc.
// Portions Copyright (c) 2025 Paperclip AI (forked). See LICENSES/harness-MIT.txt.

import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * A Codex session's context size from its rollout log
 * (~/.codex/sessions/YYYY/MM/DD/rollout-*-<thread>.jsonl, the last
 * `token_count` event): `codex exec --json` does not carry it.
 */

export type SessionContext = { contextTokens?: number; contextWindow?: number };

const TAIL_BYTES = 512 * 1024;

function readTail(file: string, limit = TAIL_BYTES): string {
  const size = statSync(file).size;
  const start = Math.max(0, size - limit);
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

const rolloutByThread = new Map<string, string>();

function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

export function findCodexRollout(threadId: string, root = path.join(codexHome(), "sessions")): string | null {
  const cached = rolloutByThread.get(threadId);
  if (cached && existsSync(cached)) return cached;
  const desc = (dir: string) => {
    try {
      return readdirSync(dir).sort().reverse();
    } catch {
      return [];
    }
  };
  for (const y of desc(root)) {
    for (const m of desc(path.join(root, y))) {
      for (const d of desc(path.join(root, y, m))) {
        const dir = path.join(root, y, m, d);
        const hit = desc(dir).find((f) => f.endsWith(`${threadId}.jsonl`));
        if (hit) {
          const file = path.join(dir, hit);
          rolloutByThread.set(threadId, file);
          return file;
        }
      }
    }
  }
  return null;
}

export function codexContextFromRollout(text: string): SessionContext | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.includes('"token_count"')) continue;
    try {
      const o = JSON.parse(line) as {
        payload?: { type?: string; info?: { last_token_usage?: { input_tokens?: number }; model_context_window?: number } | null };
      };
      const info = o.payload?.type === "token_count" ? o.payload.info : null;
      if (!info) continue;
      const tokens = info.last_token_usage?.input_tokens;
      const window = info.model_context_window;
      return {
        ...(typeof tokens === "number" && tokens > 0 ? { contextTokens: tokens } : {}),
        ...(typeof window === "number" && window > 0 ? { contextWindow: window } : {}),
      };
    } catch {
      // a torn line at the tail's cut
    }
  }
  return null;
}

export async function codexSessionContext(threadId: string, home?: string | null): Promise<SessionContext | null> {
  const file = findCodexRollout(threadId, path.join(home || codexHome(), "sessions"));
  return file ? codexContextFromRollout(readTail(file)) : null;
}
