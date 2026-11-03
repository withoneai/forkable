// Adapted from earlier One Systems code (MIT).
// Copyright (c) 2026 One Systems, Inc.
// Portions Copyright (c) 2025 Paperclip AI (forked). See LICENSES/harness-MIT.txt.
//
// Browser-safe (no node imports): the UI imports this for the turn cards.

import type { HarnessEvent, ToolKind } from "./types.js";

/**
 * A tool call as a sentence the builder can read: verb, then object. The
 * rule: say what the agent DID, not which tool it
 * used; wrappers (`cd x &&`, `nohup`, env assignments) are stripped first; an
 * unknown command degrades to an honest "Ran <program>" with the raw command
 * one click away. Never invent meaning.
 */

type ToolStart = Extract<HarnessEvent, { t: "tool_start" }>;

const PLATFORM_NAMES: Record<string, string> = {
  gmail: "Gmail", github: "GitHub", hubspot: "HubSpot", linkedin: "LinkedIn", quickbooks: "QuickBooks",
  youtube: "YouTube", openai: "OpenAI", sendgrid: "SendGrid", "google-calendar": "Google Calendar",
  "google-drive": "Google Drive", "google-sheets": "Google Sheets", "google-docs": "Google Docs",
  clickup: "ClickUp", x: "X", posthog: "PostHog", elevenlabs: "ElevenLabs", "outlook-mail": "Outlook",
};

/** "google-calendar" -> "Google Calendar". */
export function platformName(key: string): string {
  const k = key.toLowerCase();
  if (PLATFORM_NAMES[k]) return PLATFORM_NAMES[k]!;
  return k
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

export function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

function clip(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Strip wrappers until the program that does the work is first. */
export function unwrapCommand(command: string): string {
  let c = command.trim();
  // Codex wraps every command: /bin/zsh -lc "..."
  const shellWrap = /^(?:\/bin\/)?(?:ba|z)?sh\s+-l?c\s+(["'])([\s\S]*)\1\s*$/.exec(c);
  if (shellWrap) c = shellWrap[2]!.replace(/\\"/g, '"');
  for (;;) {
    const prev = c;
    c = c.replace(/^\(+\s*/, "");
    c = c.replace(/^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, "");
    c = c.replace(/^(?:nohup|exec|time|command)\s+/, "");
    c = c.replace(/^timeout\s+\d\S*\s+/, "");
    c = c.replace(/^env\s+/, "");
    c = c.replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+/, "");
    if (c === prev) return c;
  }
}

function describeCommand(raw: string): string {
  const c = unwrapCommand(raw);
  const words = c.split(/\s+/);
  const [p0 = "", p1 = "", p2 = ""] = words;
  const rest = words.slice(1).join(" ");
  const slugOne = /^[a-z0-9-]+-one$/.test(p0);
  if (slugOne) {
    if (p1 === "find") return p2 ? `Searched ${platformName(p2)} actions` : "Searched actions";
    if (p1 === "load") return "Read action docs";
    if (p1 === "add") return "Added an action";
    if (p1 === "granted") return "Checked your connections";
    if (p1 === "scopes") return "Checked what the app asks for";
    return "Read the catalog";
  }
  if (p0 === "git") {
    if (p1 === "status") return "Checked git status";
    if (p1 === "diff") return "Looked at the changes";
    if (p1 === "log") return "Read the history";
    return `Ran git ${p1}`.trim();
  }
  if (p0 === "ls") return p1 && !p1.startsWith("-") ? `Listed ${p1}` : "Listed files";
  if (p0 === "cat" || p0 === "head" || p0 === "tail" || p0 === "sed") {
    const file = words.slice(1).find((w) => !w.startsWith("-") && /[./]/.test(w));
    return file ? `Read ${file}` : "Read a file";
  }
  if (p0 === "rg" || p0 === "grep") return "Searched the code";
  if (p0 === "pnpm" || p0 === "npm" || p0 === "yarn" || p0 === "bun") {
    const sub = p1 === "run" || p1 === "exec" ? `${p1} ${p2}` : p1;
    return `Ran ${p0} ${sub}`.trim();
  }
  if (p0 === "tsc" || (p0 === "npx" && p1 === "tsc")) return "Checked types";
  if (!c.includes(" ")) return `Ran ${clip(c, 40)}`;
  return `Ran ${clip(`${p0} ${rest}`, 48)}`;
}

function filesLabel(files: string[] | undefined, detail: string | undefined): string {
  if (files && files.length > 1) return `${files.length} files`;
  const f = files?.[0] ?? detail ?? "";
  return f || "a file";
}

/** The card sentence for a tool call: "Edited src/App.tsx", "Ran pnpm typecheck", "Read Gmail docs". */
export function describeTool(ev: ToolStart): string {
  const name = ev.name;
  const short = name.replace(/^mcp__.+?__/, "");
  const input = ev.input ?? {};
  const platform = typeof input.platform === "string" ? platformName(input.platform) : null;

  if (name.startsWith("mcp__") || ev.kind === "one") {
    switch (short) {
      case "one_find_actions":
        return platform ? `Searched ${platform} actions` : "Searched actions";
      case "one_load_action":
        return platform ? `Read ${platform} docs` : "Read action docs";
      case "one_platforms":
        return "Looked up platforms";
      case "one_granted":
        return "Checked your connections";
      case "one_add_action":
        return platform ? `Added a ${platform} action` : "Added an action";
      case "one_remove_action":
        return "Removed an action";
      case "one_scope_preview":
        return "Checked what the app asks for";
      case "project_errors":
        return "Checked the errors";
      case "project_add_dependency":
        return typeof input.name === "string" ? `Added ${input.name}` : "Added a package";
      case "project_screenshot":
        return "Took a screenshot";
      case "project_env":
        return Array.isArray(input.request) && input.request.length ? "Asked you for a value" : "Checked the environment";
      default:
        return `Used ${short.replace(/_/g, " ")}`;
    }
  }

  switch (name) {
    case "Write":
      return `Wrote ${filesLabel(ev.files, ev.detail)}`;
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
    case "file_change":
      return `Edited ${filesLabel(ev.files, ev.detail)}`;
    case "Read":
      return `Read ${filesLabel(ev.files, ev.detail)}`;
    case "Glob":
      return "Looked for files";
    case "Grep":
      return ev.detail ? `Searched the code for ${clip(ev.detail, 32)}` : "Searched the code";
    case "WebSearch":
    case "web_search":
      return ev.detail ? `Searched the web for ${clip(ev.detail, 36)}` : "Searched the web";
    case "WebFetch": {
      const host = ev.detail ? /^https?:\/\/([^/]+)/.exec(ev.detail)?.[1] : null;
      return host ? `Read ${host}` : "Read a web page";
    }
    case "ToolSearch":
      return "Looked up tools";
    case "TodoWrite":
    case "todo_list":
      return "Updated the plan";
    case "Task":
    case "Agent":
      return "Started a helper agent";
    case "Bash":
    case "command_execution":
      return ev.detail ? describeCommand(ev.detail) : "Ran a command";
  }
  if (ev.kind === "run") return ev.detail ? describeCommand(ev.detail) : "Ran a command";
  if (ev.kind === "write") return `Edited ${filesLabel(ev.files, ev.detail)}`;
  if (ev.kind === "read") return ev.detail ? `Read ${clip(ev.detail, 40)}` : "Looked something up";
  return `Used ${name.replace(/[_-]+/g, " ")}`;
}

/** "Codex tried to run curl, which this project does not allow". */
export function describeDenied(ev: Extract<HarnessEvent, { t: "denied" }>, harnessLabel = "The agent"): string {
  const what = /^Bash\((.*)\)$/.exec(ev.tool)?.[1] ?? ev.tool;
  return `${harnessLabel} tried to use ${clip(what, 48)}, which this project does not allow`;
}

/** Tool kind from a Claude tool name (shared by the parsers). */
export function claudeToolKind(name: string, mcpServer = "builder"): ToolKind {
  if (name === "Edit" || name === "Write" || name === "MultiEdit" || name === "NotebookEdit") return "write";
  if (name === "Bash") return "run";
  if (["Read", "Glob", "Grep", "LS", "WebSearch", "WebFetch"].includes(name)) return "read";
  if (name.startsWith(`mcp__${mcpServer}__one_`)) return "one";
  return "other";
}
