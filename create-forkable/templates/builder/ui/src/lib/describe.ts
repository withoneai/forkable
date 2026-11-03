// Tool call -> a sentence for the activity card ("Edited src/App.tsx").
// Structured on purpose (tense, object, salience, icon) for the activity
// cards; @builder/harness/describe has the plain-sentence version for logs.
import type { ToolKind } from "@builder/harness/types";

export interface ToolLike {
  name: string;
  kind: ToolKind;
  detail?: string;
  files?: string[];
  /** MCP tools carry their input (platform, intent, actionId). */
  input?: Record<string, unknown>;
}

export interface Described {
  /** Past tense, shown once the call ends. */
  done: string;
  /** Present tense, shown while it runs. */
  running: string;
  /** The object, rendered mono (a path or a command). */
  object: string | null;
  /** quiet rows (reads, searches) coalesce; loud rows stand out. */
  salience: "quiet" | "normal" | "loud";
  icon: "read" | "write" | "run" | "search" | "one" | "web" | "plan" | "other";
}

const PLATFORM_NAMES: Record<string, string> = {
  gmail: "Gmail", github: "GitHub", hubspot: "HubSpot", slack: "Slack", stripe: "Stripe", notion: "Notion",
  "google-calendar": "Google Calendar", "google-drive": "Google Drive", "google-sheets": "Google Sheets", linear: "Linear",
};

export function platformName(key: string): string {
  const k = key.toLowerCase();
  return PLATFORM_NAMES[k] ?? k.split(/[-_]/).map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(" ");
}

/** Wrappers change how a command runs, never what it does. */
function unwrap(cmd: string): string {
  let c = cmd.trim();
  // `/bin/zsh -lc '...'` from Codex
  const sh = /^(?:\/bin\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/.exec(c);
  if (sh) c = sh[2]!;
  for (;;) {
    const prev = c;
    c = c.replace(/^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, "");
    c = c.replace(/^(?:nohup|exec|time|command|env)\s+/, "");
    c = c.replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+/, "");
    if (c === prev) return c;
  }
}

function short(s: string, n = 64): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function rel(p: string): string {
  // Project-relative when the harness reports absolute paths.
  const m = /\/projects\/[^/]+\/(.+)$/.exec(p);
  return m ? m[1]! : p.replace(/^\.\//, "");
}

export function describeTool(t: ToolLike): Described {
  const name = t.name;
  const file = t.files?.[0] ? rel(t.files[0]) : t.detail && t.kind !== "run" ? rel(t.detail) : null;
  const lower = name.toLowerCase();

  if (t.kind === "one" || lower.startsWith("mcp__builder__") || lower.startsWith("builder-one")) {
    const tool = lower.replace(/^mcp__builder__/, "");
    const inPlat = typeof t.input?.platform === "string" ? (t.input.platform as string) : null;
    const plat = inPlat ? platformName(inPlat) : t.detail && /^[a-z0-9-]+$/i.test(t.detail) ? platformName(t.detail) : null;
    const intent = typeof t.input?.intent === "string" ? (t.input.intent as string).slice(0, 60) : null;
    switch (tool) {
      case "one_find_actions": return { done: plat ? `Looked up ${plat} actions` : "Looked up actions", running: plat ? `Looking up ${plat} actions` : "Looking up actions", object: intent, salience: "normal", icon: "one" };
      case "one_load_action": return { done: plat ? `Read ${plat} docs` : "Read action docs", running: "Reading action docs", object: null, salience: "normal", icon: "one" };
      case "one_platforms": return { done: "Listed platforms", running: "Listing platforms", object: null, salience: "quiet", icon: "one" };
      case "one_granted": return { done: "Checked the app's One Connect", running: "Checking the app's One Connect", object: null, salience: "quiet", icon: "one" };
      // The raw catalog id is noise in the feed; the Access tab names every action.
      case "one_add_action": return { done: plat ? `Added a ${plat} action` : "Added an action", running: plat ? `Adding a ${plat} action` : "Adding an action", object: null, salience: "loud", icon: "one" };
      case "one_remove_action": return { done: "Removed an action", running: "Removing an action", object: t.detail ?? null, salience: "normal", icon: "one" };
      case "one_scope_preview": return { done: "Checked what the app asks for", running: "Checking what the app asks for", object: null, salience: "quiet", icon: "one" };
      case "project_errors": return { done: "Checked the errors", running: "Checking the errors", object: null, salience: "quiet", icon: "search" };
      case "project_add_dependency": return { done: "Added a package", running: "Adding a package", object: t.detail ?? null, salience: "loud", icon: "run" };
      case "project_screenshot": return { done: "Took a screenshot", running: "Taking a screenshot", object: null, salience: "quiet", icon: "read" };
      default: return { done: `Used ${tool}`, running: `Using ${tool}`, object: null, salience: "normal", icon: "one" };
    }
  }

  if (t.kind === "write") {
    const created = /^write$/i.test(name);
    const many = (t.files?.length ?? 0) > 1;
    if (many) return { done: `Edited ${t.files!.length} files`, running: `Editing ${t.files!.length} files`, object: null, salience: "normal", icon: "write" };
    return { done: created ? "Wrote" : "Edited", running: created ? "Writing" : "Editing", object: file, salience: "normal", icon: "write" };
  }

  if (t.kind === "run") {
    const cmd = unwrap(t.detail ?? name);
    return { done: "Ran", running: "Running", object: short(cmd), salience: /\b(typecheck|tsc|test|build|vitest)\b/.test(cmd) ? "normal" : "normal", icon: "run" };
  }

  if (t.kind === "read") {
    if (/^(grep|search)$/i.test(name)) return { done: "Searched for", running: "Searching for", object: t.detail ? short(t.detail, 40) : null, salience: "quiet", icon: "search" };
    if (/^(glob|ls)$/i.test(name)) return { done: "Listed files", running: "Listing files", object: t.detail ? short(t.detail, 40) : null, salience: "quiet", icon: "search" };
    return { done: "Read", running: "Reading", object: file, salience: "quiet", icon: "read" };
  }

  if (/^web(search|fetch)$/i.test(name) || name === "web_search") {
    return { done: lower.includes("fetch") ? "Read a page" : "Searched the web", running: lower.includes("fetch") ? "Reading a page" : "Searching the web", object: t.detail ? short(t.detail, 48) : null, salience: "quiet", icon: "web" };
  }
  if (/^todowrite$/i.test(name) || name === "todo_list") return { done: "Updated the plan", running: "Planning", object: null, salience: "quiet", icon: "plan" };
  return { done: `Used ${name}`, running: `Using ${name}`, object: t.detail ? short(t.detail, 48) : null, salience: "quiet", icon: "other" };
}
