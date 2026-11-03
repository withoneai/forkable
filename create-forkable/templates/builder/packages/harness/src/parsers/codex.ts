// Adapted from earlier One Systems code (MIT).
// Copyright (c) 2026 One Systems, Inc.
// Portions Copyright (c) 2025 Paperclip AI (forked). See LICENSES/harness-MIT.txt.

import { HARNESS_NAMES } from "../names.js";
import type { HarnessEvent, Usage } from "../types.js";
import { asCount, parseJsonLine, relativize, smallInput, toolResultPreview } from "./util.js";

/**
 * `codex exec --json` to HarnessEvents. JSONL: thread.started (thread_id is
 * the resume handle), item.started / item.completed (agent_message,
 * reasoning, command_execution, file_change, mcp_tool_call, web_search,
 * todo_list), turn.completed (usage), turn.failed / error. Text arrives as
 * whole blocks. Changed files must come from the tree diff, not these
 * events: Codex often writes files with a shell command.
 */

type Item = {
  id?: unknown;
  type?: unknown;
  text?: unknown;
  status?: unknown;
  command?: unknown;
  aggregated_output?: unknown;
  exit_code?: unknown;
  changes?: { path?: unknown; kind?: unknown }[];
  server?: unknown;
  tool?: unknown;
  arguments?: unknown;
  result?: { content?: unknown } | null;
  error?: { message?: unknown } | null;
  query?: unknown;
};

export class CodexStreamParser {
  threadId: string | null = null;
  lastText = "";
  failed: string | null = null;
  usage: Usage | null = null;
  signedOut = false;
  limited = false;

  constructor(
    private readonly cwd?: string,
    private readonly mcpName: string = HARNESS_NAMES.slug,
  ) {}

  parse(line: string): HarnessEvent[] {
    const obj = parseJsonLine(line);
    if (!obj) return [];
    const out: HarnessEvent[] = [];
    const type = typeof obj.type === "string" ? obj.type : "";
    const threadId = obj.thread_id ?? obj.threadId;
    if (type === "thread.started" && typeof threadId === "string") {
      this.threadId = threadId;
      out.push({ t: "session", id: threadId });
      return out;
    }

    const item = (obj.item ?? null) as Item | null;
    if (item && typeof item.type === "string") {
      const id = typeof item.id === "string" ? item.id : `item-${Math.random().toString(36).slice(2)}`;
      const started = type === "item.started";
      const completed = type === "item.completed";
      switch (item.type) {
        case "agent_message":
          if (completed && typeof item.text === "string" && item.text) {
            this.lastText = item.text;
            out.push({ t: "text", text: item.text });
          }
          break;
        case "reasoning":
          if (completed && typeof item.text === "string" && item.text.trim()) out.push({ t: "thinking", text: item.text });
          break;
        case "command_execution": {
          const command = typeof item.command === "string" ? item.command : "";
          if (started) out.push({ t: "tool_start", id, name: "command_execution", kind: "run", ...(command ? { detail: command } : {}) });
          else if (completed) {
            const ok = item.status === "completed" && (item.exit_code === 0 || item.exit_code === undefined || item.exit_code === null);
            const preview = toolResultPreview(item.aggregated_output);
            out.push({ t: "tool_end", id, ok, ...(preview ? { preview } : {}) });
          }
          break;
        }
        case "file_change": {
          const files = (item.changes ?? [])
            .map((c) => (typeof c?.path === "string" ? relativize(c.path, this.cwd) : null))
            .filter((f): f is string => !!f);
          if (started) out.push({ t: "tool_start", id, name: "file_change", kind: "write", files, ...(files[0] ? { detail: files[0] } : {}) });
          else if (completed) out.push({ t: "tool_end", id, ok: item.status !== "failed" });
          break;
        }
        case "mcp_tool_call": {
          const server = String(item.server ?? "");
          const tool = String(item.tool ?? "");
          const name = `mcp__${server}__${tool}`;
          if (started) {
            const kind = server === this.mcpName && tool.startsWith("one_") ? "one" : "other";
            out.push({ t: "tool_start", id, name, kind, input: smallInput(item.arguments) ?? {} });
          } else if (completed) {
            const errMsg = typeof item.error?.message === "string" ? item.error.message : null;
            const preview = errMsg ?? toolResultPreview(item.result?.content);
            out.push({ t: "tool_end", id, ok: item.status === "completed" && !errMsg, ...(preview ? { preview } : {}) });
            if (errMsg && /requires approval/i.test(errMsg)) out.push({ t: "denied", tool: name, reason: errMsg });
          }
          break;
        }
        case "web_search": {
          const q = typeof item.query === "string" ? item.query : undefined;
          if (started) out.push({ t: "tool_start", id, name: "web_search", kind: "read", ...(q ? { detail: q } : {}) });
          else if (completed) out.push({ t: "tool_end", id, ok: item.status !== "failed" });
          break;
        }
        default:
          // todo_list and future kinds: nothing the builder needs to see.
          break;
      }
      return out;
    }

    if (type === "turn.completed") {
      const raw = (obj.usage ?? null) as Record<string, unknown> | null;
      if (raw) {
        // input_tokens INCLUDES the cached part; Usage.input is fresh input.
        const cached = asCount(raw.cached_input_tokens);
        const usage: Usage = {
          input: Math.max(0, asCount(raw.input_tokens) - cached),
          output: asCount(raw.output_tokens),
          cacheRead: cached,
          cacheWrite: asCount(raw.cache_write_input_tokens),
        };
        this.usage = usage;
        out.push({ t: "usage", usage, total: true });
      }
      return out;
    }

    if (type === "turn.failed" || type === "error") {
      const err = (obj.error ?? null) as { message?: unknown } | null;
      const message =
        (err && typeof err.message === "string" && err.message) ||
        (typeof obj.message === "string" && obj.message) ||
        "The Codex turn failed";
      if (/401|unauthorized|not logged in|login/i.test(message)) this.signedOut = true;
      if (/usage limit|rate limit/i.test(message)) this.limited = true;
      if (type === "turn.failed") this.failed = message;
      out.push({ t: "error", message });
    }
    return out;
  }
}
