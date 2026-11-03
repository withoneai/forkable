// Adapted from earlier One Systems code (MIT).
// Copyright (c) 2026 One Systems, Inc.
// Portions Copyright (c) 2025 Paperclip AI (forked). See LICENSES/harness-MIT.txt.

import { spawn } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HarnessModel } from "./types.js";

/**
 * Model lists labeled the way each provider labels them, read from the
 * installed CLI, never a hand table that goes stale:
 *   claude  the catalog literal baked into the `claude` bundle (there is no
 *           `claude models`); one entry per family, newest first. Re-read
 *           when the binary changes (it auto-updates).
 *   codex   `codex app-server` -> model/list; context windows from
 *           $CODEX_HOME/models_cache.json.
 *   openclaw has no listing; its own config picks.
 */

/** Static fallback when the bundle scan finds nothing. Ids are `claude` CLI aliases. */
export const CLAUDE_FALLBACK_MODELS: HarnessModel[] = [
  { id: "claude-opus-5", label: "Opus 5", hint: "Powerful" },
  { id: "claude-sonnet-5", label: "Sonnet 5", hint: "Balanced" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", hint: "Fastest" },
];

const CLAUDE_FAMILY_ORDER = ["fable", "opus", "sonnet", "haiku"];
const CLAUDE_FAMILY_HINT: Record<string, string> = {
  fable: "Most capable",
  opus: "Powerful",
  sonnet: "Balanced",
  haiku: "Fastest",
};
const MAX_CLAUDE_BUNDLE_BYTES = 512 * 1024 * 1024;

const claudeCache = new Map<string, { stamp: string; models: HarnessModel[] }>();

/** Anthropic's catalog as baked into the installed Claude Code bundle. */
export function discoverClaudeModels(bin: string): HarnessModel[] {
  try {
    const real = realpathSync(bin);
    const st = statSync(real);
    const stamp = `${real}:${st.size}:${st.mtimeMs}`;
    const hit = claudeCache.get(real);
    if (hit && hit.stamp === stamp) return hit.models;
    if (st.size > MAX_CLAUDE_BUNDLE_BYTES) return [];
    const bytes = readFileSync(real);
    const anchor = bytes.indexOf("latest_per_family:{");
    if (anchor < 0) return [];
    const window = bytes
      .subarray(Math.max(0, anchor - 128 * 1024), Math.min(bytes.length, anchor + 4096))
      .toString("latin1");
    const models = parseClaudeCatalog(window);
    claudeCache.set(real, { stamp, models });
    return models;
  } catch {
    return [];
  }
}

/** Exported for tests: parse the catalog literal out of bundle text. */
export function parseClaudeCatalog(text: string): HarnessModel[] {
  const latest = /latest_per_family:\{([^}]*)\}/.exec(text)?.[1] ?? "";
  const latestByFamily = new Map<string, string>();
  for (const m of latest.matchAll(/([a-z0-9_]+):"([^"]+)"/g)) latestByFamily.set(m[1]!, m[2]!);
  const displayNames = new Map<string, string>();
  const windows = new Map<string, number>();
  const entries = [...text.matchAll(/\{id:"(claude-[^"]+)",family:"[^"]+",display_name:"([^"]+)"/g)];
  entries.forEach((m, i) => {
    displayNames.set(m[1]!, m[2]!);
    const body = text.slice(m.index!, entries[i + 1]?.index ?? m.index! + 4000);
    const w = Number(/context:\{window:([0-9.e+]+)/.exec(body)?.[1]);
    if (Number.isFinite(w) && w > 0) windows.set(m[1]!, w);
  });
  if (!latestByFamily.size || !displayNames.size) return [];
  const families = [...latestByFamily.keys()].sort((a, b) => {
    const ia = CLAUDE_FAMILY_ORDER.indexOf(a);
    const ib = CLAUDE_FAMILY_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const out: HarnessModel[] = [];
  for (const family of families) {
    const id = latestByFamily.get(family)!;
    const label = displayNames.get(id);
    if (!label) continue;
    out.push({ id, label, hint: CLAUDE_FAMILY_HINT[family] ?? "", ...(windows.has(id) ? { contextWindow: windows.get(id) } : {}) });
  }
  return out;
}

type CodexModel = { id?: unknown; model?: unknown; displayName?: unknown; description?: unknown; hidden?: unknown; upgrade?: unknown };

function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

/** ~/.codex/models_cache.json: context_window scaled by effective_context_window_percent. */
export function codexWindows(file = path.join(codexHome(), "models_cache.json")): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const cache = JSON.parse(readFileSync(file, "utf8")) as {
      models?: { slug?: string; context_window?: number; effective_context_window_percent?: number }[];
    };
    for (const m of cache.models ?? []) {
      if (!m.slug || !m.context_window) continue;
      out.set(m.slug, Math.round((m.context_window * (m.effective_context_window_percent ?? 100)) / 100));
    }
  } catch {
    // Codex never ran: unknown.
  }
  return out;
}

function codexOption(entry: CodexModel, windows: Map<string, number>): HarnessModel | null {
  const id = typeof entry.model === "string" ? entry.model : typeof entry.id === "string" ? entry.id : "";
  if (!id || entry.hidden === true) return null;
  const label = typeof entry.displayName === "string" && entry.displayName ? entry.displayName : id;
  const description = typeof entry.description === "string" ? entry.description : "";
  const hint = typeof entry.upgrade === "string" && entry.upgrade ? "Retiring soon" : description;
  const contextWindow = windows.get(id);
  return { id, label, hint, ...(contextWindow ? { contextWindow } : {}) };
}

let codexModelsCache: { at: number; models: HarnessModel[] } | null = null;

/** `codex app-server` speaks JSON-RPC over stdio; model/list carries display names. */
export function discoverCodexModels(bin: string, env: Record<string, string> = process.env as Record<string, string>, force = false): Promise<HarnessModel[]> {
  if (!force && codexModelsCache && Date.now() - codexModelsCache.at < 10 * 60_000) return Promise.resolve(codexModelsCache.models);
  return new Promise((resolve) => {
    const child = spawn(bin, ["app-server"], { cwd: os.tmpdir(), stdio: ["pipe", "pipe", "ignore"], env });
    let settled = false;
    let buffer = "";
    const windows = codexWindows();
    const finish = (models: HarnessModel[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      if (models.length) codexModelsCache = { at: Date.now(), models };
      resolve(models);
    };
    const send = (message: object) => {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      } catch {
        finish([]);
      }
    };
    const timer = setTimeout(() => finish([]), 8_000);
    child.stdin.on("error", () => finish([]));
    child.on("error", () => finish([]));
    child.on("close", () => finish([]));
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) continue;
        try {
          const message = JSON.parse(line) as { id?: unknown; result?: { data?: CodexModel[] } };
          if (message.id === 1) {
            send({ method: "initialized", params: {} });
            send({ id: 2, method: "model/list", params: { cursor: null, limit: 100, includeHidden: false } });
          } else if (message.id === 2) {
            finish((message.result?.data ?? []).map((m) => codexOption(m, windows)).filter((m): m is HarnessModel => m !== null));
          }
        } catch {
          // diagnostics that are not protocol JSON
        }
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "builder", title: "Builder", version: "0.1.0" }, capabilities: {} } });
  });
}
