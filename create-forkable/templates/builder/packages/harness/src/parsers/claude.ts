// Adapted from earlier One Systems code (MIT).
// Copyright (c) 2026 One Systems, Inc.
// Portions Copyright (c) 2025 Paperclip AI (forked). See LICENSES/harness-MIT.txt.

import { claudeToolKind } from "../describe.js";
import { HARNESS_NAMES } from "../names.js";
import type { HarnessEvent, Usage } from "../types.js";
import { asCount, parseJsonLine, relativize, smallInput, toolResultPreview } from "./util.js";

/**
 * Claude Code `--output-format stream-json --verbose` to HarnessEvents.
 * One JSON object per line. We only trust `session_id` from `system/init`: a
 * failed resume still ends with a `result` carrying a throwaway id.
 */

export interface ClaudeInit {
  sessionId: string;
  model: string | null;
  mcpServers: { name: string; status: string }[];
  mcpErrors: string[];
}

export interface ClaudeFinal {
  text: string;
  isError: boolean;
  errors: string[];
  usage: Usage | null;
  totalCostUsd: number | null;
  numTurns: number | null;
  contextWindow: number | null;
  subtype: string | null;
}

export function claudeUsage(u: unknown): Usage | null {
  if (!u || typeof u !== "object") return null;
  const raw = u as Record<string, unknown>;
  const usage = {
    input: asCount(raw.input_tokens),
    output: asCount(raw.output_tokens),
    cacheRead: asCount(raw.cache_read_input_tokens),
    cacheWrite: asCount(raw.cache_creation_input_tokens),
  };
  return Object.values(usage).some((v) => v > 0) ? usage : null;
}

/** The context window of the model that read the most this turn. */
function mainModelWindow(modelUsage: unknown): number | null {
  if (!modelUsage || typeof modelUsage !== "object") return null;
  let best: { read: number; window: number } | null = null;
  for (const m of Object.values(modelUsage as Record<string, Record<string, unknown>>)) {
    const window = asCount(m?.contextWindow);
    if (!window) continue;
    const read = asCount(m.inputTokens) + asCount(m.cacheReadInputTokens) + asCount(m.cacheCreationInputTokens);
    if (!best || read > best.read) best = { read, window };
  }
  return best?.window ?? null;
}

type Block = {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
};

export class ClaudeStreamParser {
  init: ClaudeInit | null = null;
  final: ClaudeFinal | null = null;
  signedOut = false;
  limited = false;
  private deniedIds = new Set<string>();
  /** One API message arrives as several assistant events carrying the same usage: count it once. */
  private usageIds = new Set<string>();

  constructor(
    private readonly cwd?: string,
    private readonly mcpName: string = HARNESS_NAMES.slug,
  ) {}

  parse(line: string): HarnessEvent[] {
    const obj = parseJsonLine(line.trim());
    if (!obj) return [];
    return this.parseEvent(obj);
  }

  parseEvent(obj: Record<string, unknown>): HarnessEvent[] {
    const out: HarnessEvent[] = [];
    const type = obj.type;
    const subtype = obj.subtype;

    if (type === "system") {
      if (subtype === "init" && typeof obj.session_id === "string") {
        const servers = Array.isArray(obj.mcp_servers)
          ? (obj.mcp_servers as { name?: unknown; status?: unknown }[]).map((s) => ({
              name: String(s?.name ?? ""),
              status: String(s?.status ?? ""),
            }))
          : [];
        const errors = Array.isArray(obj.mcp_server_errors)
          ? (obj.mcp_server_errors as unknown[]).map((e) =>
              typeof e === "string" ? e : e && typeof e === "object" ? String((e as { error?: unknown; message?: unknown }).error ?? (e as { message?: unknown }).message ?? JSON.stringify(e)) : String(e),
            )
          : [];
        this.init = {
          sessionId: obj.session_id,
          model: typeof obj.model === "string" ? obj.model : null,
          mcpServers: servers,
          mcpErrors: errors,
        };
        out.push({ t: "session", id: obj.session_id });
        for (const s of servers) {
          if (s.status === "connected") out.push({ t: "mcp", name: s.name, status: "connected" });
          else if (s.status === "failed") out.push({ t: "mcp", name: s.name, status: "failed", ...(errors.length ? { error: errors.join("; ") } : {}) });
        }
      } else if (subtype === "api_retry") {
        const error = String(obj.error ?? obj.error_status ?? "retry");
        if (error === "authentication_failed") this.signedOut = true;
        out.push({ t: "retry", attempt: asCount(obj.attempt), error });
      } else if (subtype === "permission_denied") {
        const id = typeof obj.tool_use_id === "string" ? obj.tool_use_id : null;
        if (id) this.deniedIds.add(id);
        out.push({
          t: "denied",
          tool: String(obj.tool_name ?? "tool"),
          ...(typeof obj.message === "string" ? { reason: obj.message } : {}),
        });
      }
      return out;
    }

    if (type === "rate_limit_event") {
      const info = (obj.rate_limit_info ?? {}) as { status?: unknown; resetsAt?: unknown };
      const status = String(info.status ?? "");
      if (status && status !== "allowed" && status !== "allowed_warning") {
        this.limited = true;
        const at = typeof info.resetsAt === "number" ? new Date(info.resetsAt * 1000).toISOString() : undefined;
        out.push({ t: "limit", ...(at ? { resetsAt: at } : {}) });
      }
      return out;
    }

    if (type === "stream_event") {
      const ev = (obj.event ?? {}) as { type?: string; delta?: { type?: string; text?: string; thinking?: string } };
      if (ev.type === "content_block_delta") {
        if (ev.delta?.type === "text_delta" && typeof ev.delta.text === "string") out.push({ t: "text_delta", text: ev.delta.text });
        if (ev.delta?.type === "thinking_delta" && typeof ev.delta.thinking === "string")
          out.push({ t: "thinking", text: ev.delta.thinking, delta: true });
      }
      return out;
    }

    const message = (obj.message ?? null) as { id?: unknown; content?: Block[]; usage?: unknown } | null;
    // Subagent traffic (parent_tool_use_id set) stays inside its Task card.
    const sub = obj.parent_tool_use_id != null;

    if (type === "assistant" && message?.content && !sub) {
      for (const p of message.content) {
        if (p?.type === "text" && typeof p.text === "string" && p.text) out.push({ t: "text", text: p.text });
        else if (p?.type === "thinking" && typeof p.thinking === "string" && p.thinking.trim()) out.push({ t: "thinking", text: p.thinking });
        else if (p?.type === "tool_use" && typeof p.id === "string") out.push(this.toolStart(p));
      }
      const usage = claudeUsage(message.usage);
      const mid = typeof message.id === "string" ? message.id : null;
      if (usage && !(mid && this.usageIds.has(mid))) {
        if (mid) this.usageIds.add(mid);
        out.push({ t: "usage", usage, total: false });
      }
      return out;
    }

    if (type === "user" && message?.content && !sub) {
      for (const p of message.content) {
        if (p?.type === "tool_result" && typeof p.tool_use_id === "string") {
          const preview = toolResultPreview(p.content);
          out.push({ t: "tool_end", id: p.tool_use_id, ok: p.is_error !== true, ...(preview ? { preview } : {}) });
        }
      }
      return out;
    }

    if (type === "result") {
      const errors = Array.isArray(obj.errors) ? (obj.errors as unknown[]).filter((e): e is string => typeof e === "string") : [];
      const usage = claudeUsage(obj.usage);
      this.final = {
        text: typeof obj.result === "string" ? obj.result : "",
        isError: obj.is_error === true,
        errors,
        usage,
        totalCostUsd: typeof obj.total_cost_usd === "number" && Number.isFinite(obj.total_cost_usd) ? obj.total_cost_usd : null,
        numTurns: typeof obj.num_turns === "number" ? obj.num_turns : null,
        contextWindow: mainModelWindow(obj.modelUsage),
        subtype: typeof subtype === "string" ? subtype : null,
      };
      if (errors.some((e) => /\/login|not logged in|invalid api key|authentication/i.test(e))) this.signedOut = true;
      if (errors.some((e) => /usage limit|rate limit reached|limit reached/i.test(e))) this.limited = true;
      if (Array.isArray(obj.permission_denials)) {
        for (const d of obj.permission_denials as { tool_name?: unknown; tool_use_id?: unknown; tool_input?: { command?: unknown } }[]) {
          const id = typeof d.tool_use_id === "string" ? d.tool_use_id : null;
          if (id && this.deniedIds.has(id)) continue;
          if (id) this.deniedIds.add(id);
          const tool = String(d.tool_name ?? "tool");
          const cmd = typeof d.tool_input?.command === "string" ? d.tool_input.command : null;
          out.push({ t: "denied", tool: cmd ? `${tool}(${cmd})` : tool });
        }
      }
      if (usage) out.push({ t: "usage", usage, total: true });
      return out;
    }
    return out;
  }

  private toolStart(p: Block): HarnessEvent {
    const name = typeof p.name === "string" ? p.name : "tool";
    const input = p.input ?? {};
    const kind = claudeToolKind(name, this.mcpName);
    const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);
    let detail: string | undefined;
    let files: string[] | undefined;
    if (kind === "write" || name === "Read") {
      const f = str("file_path") ?? str("notebook_path") ?? str("path");
      if (f) {
        files = [relativize(f, this.cwd)];
        detail = files[0];
      }
    } else if (name === "Bash") detail = str("command");
    else if (name === "Grep" || name === "Glob") detail = str("pattern");
    else if (name === "WebFetch") detail = str("url");
    else if (name === "WebSearch") detail = str("query");
    else if (name === "Task" || name === "Agent") detail = str("description");
    const ev: HarnessEvent = {
      t: "tool_start",
      id: p.id as string,
      name,
      kind,
      ...(detail ? { detail } : {}),
      ...(files ? { files } : {}),
      ...(name.startsWith("mcp__") ? { input: smallInput(input) } : {}),
    };
    return ev;
  }
}
