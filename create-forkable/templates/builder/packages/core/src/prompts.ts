// Per-turn facts for the harness: the system append and the
// handoff block when a session cannot be resumed.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { HarnessId, Permission } from "@builder/harness/types";
import { BRAND } from "./brand.js";
import * as git from "./git.js";
import type { Checkpoint, ProjectError, Selection, Turn, TurnKind } from "./types.js";

const PERMISSION_TEXT: Record<Permission, string> = {
  build: "Build: you can read and edit files in this project and run the allowed checks (pnpm typecheck, pnpm build, pnpm test, git status/diff/log).",
  plan: "Plan: read only. Do not edit files.",
  full: "Full access: the builder opted in, but the platform rules below still hold.",
};

export function selectionLines(selections: Selection[]): string {
  return selections
    .map((s) => `- <${s.tag}> at ${s.loc}${s.text ? ` "${s.text.slice(0, 80).replace(/\s+/g, " ")}"` : ""}${s.classes ? ` class="${s.classes.slice(0, 120)}"` : ""}`)
    .join("\n");
}

export function systemAppend(o: {
  kind: TurnKind;
  previewUrl: string;
  permission: Permission;
  openErrors: ProjectError[];
  selections: Selection[];
  restored: Checkpoint | null;
  fixAttempt: number;
  /** One facts: the manifest summary and whether One Connect is on. */
  one?: string;
}): string {
  const lines = [
    `You are the coding agent inside ${BRAND.name}, a local app builder. The project is a Vite + React + Hono app in the current directory; AGENTS.md has the house rules.`,
    `Turn kind: ${o.kind}${o.kind === "fix" ? ` (attempt ${o.fixAttempt} of 3)` : ""}.`,
    `Do not start a dev server. The preview is already running at ${o.previewUrl} and reloads on save.`,
    `Do not install packages by command, run wrangler, or commit. ${BRAND.name} installs when package.json changes (or use the project_add_dependency tool) and saves a checkpoint after every turn.`,
    `Permission level. ${PERMISSION_TEXT[o.permission]}`,
    `Platform calls (Gmail, Slack, Stripe, ...) only through one(c).run with a wrapper from server/one/actions.gen.ts. Look actions up with one_find_actions, then one_add_action <actionId>; never guess an action id, never call a provider URL or SDK, never put a key anywhere.`,
    "When you finish, reply with two or three plain sentences saying what changed. No headings.",
  ];
  if (o.one) lines.push(o.one);
  if (o.restored) lines.push(`Files were restored to checkpoint ${o.restored.restoredFrom?.slice(0, 7) ?? ""} (${o.restored.subject}). Your memory of later edits is stale; read files again before editing.`);
  if (o.openErrors.length) {
    lines.push(
      `Open errors in the project right now:\n${o.openErrors
        .slice(0, 10)
        .map((e) => `- [${e.source}] ${e.file ? `${e.file}${e.line ? `:${e.line}` : ""} ` : ""}${e.message.split("\n")[0]!.slice(0, 200)}`)
        .join("\n")}`,
    );
  }
  if (o.selections.length) lines.push(`The builder selected these elements in the preview (file:line:col):\n${selectionLines(o.selections)}`);
  return lines.join("\n");
}

function tree(dir: string, depth: number, prefix = ""): string[] {
  if (depth < 0) return [];
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => !n.startsWith(".") && n !== "node_modules" && n !== "dist").sort();
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const n of names.slice(0, 40)) {
    const p = join(dir, n);
    const isDir = statSync(p, { throwIfNoEntry: false })?.isDirectory();
    out.push(`${prefix}${n}${isDir ? "/" : ""}`);
    if (isDir) out.push(...tree(p, depth - 1, `${prefix}  `));
  }
  return out;
}

/** Context for a fresh session: last turns, recent commits, the file tree, open errors. */
export async function handoff(o: { cwd: string; turns: Turn[]; openErrors: ProjectError[]; fromHarness: HarnessId | null }): Promise<string> {
  const log = await git.runGit(o.cwd, ["log", "--oneline", "-15", "main"]);
  const recent = o.turns
    .filter((t) => t.kind === "user" || t.kind === "fix")
    .slice(0, 6)
    .reverse()
    .map((t) => `- ${t.kind === "fix" ? "(fix) " : ""}${t.prompt.split("\n")[0]!.slice(0, 200)}${t.text ? `\n  Result: ${t.text.replace(/\s+/g, " ").slice(0, 300)}` : ""}`)
    .join("\n");
  return [
    `Context from earlier work on this project${o.fromHarness ? ` (done with ${o.fromHarness})` : ""}. You are starting a fresh session, so read files before editing.`,
    recent ? `Recent requests:\n${recent}` : "",
    `Recent checkpoints (git log):\n${log.stdout.trim()}`,
    `Files (depth 3):\n${tree(o.cwd, 2).join("\n")}`,
    o.openErrors.length ? `Open errors:\n${o.openErrors.slice(0, 10).map((e) => `- [${e.source}] ${e.file ?? ""} ${e.message.split("\n")[0]}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The prompt the harness sees for a user turn: the text plus selections and images. */
export function userPrompt(prompt: string, selections: Selection[], images: string[]): string {
  const parts = [prompt.trim()];
  if (selections.length) parts.push(`Selected in the preview:\n${selectionLines(selections)}`);
  // The adapters name the images themselves (Claude: "Read this image first", Codex: -i).
  if (images.length) parts.push(`${images.length === 1 ? "An image is" : `${images.length} images are`} attached; look at ${images.length === 1 ? "it" : "them"} before you start.`);
  return parts.join("\n\n");
}

/** Plan mode: the agent reads and proposes; the builder edits the plan and says build. */
export function planPrompt(prompt: string): string {
  return `${prompt}

Plan mode: do not edit any file. Read what you need, then answer with a short plan the builder can edit: a one-line goal, then numbered steps (files to add or change, the One actions you would look up, the tables you would add), then open questions if any. Plain text, no code blocks longer than three lines.`;
}
