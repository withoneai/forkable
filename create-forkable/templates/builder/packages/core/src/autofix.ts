// The auto-fix loop's decisions, pure so they are easy to test.
// The turn engine (turns.ts) runs the loop.

import type { ProjectError } from "./types.js";

export const MAX_FIX_TURNS = 3;
const MAX_ERROR_BYTES = 8 * 1024;

/** Sources that never enter the loop: a One refusal is a grant question, not a code bug. */
const EXCLUDED = new Set(["one"]);

/**
 * Errors a fix turn should take on: open errors not present before the turn
 * started, plus pre-existing ones in files the turn touched. Warnings, One
 * refusals and held rows are excluded.
 */
export function errorsToFix(open: ProjectError[], before: Set<string>, touched: Set<string>): ProjectError[] {
  return open.filter((e) => {
    if (e.severity !== "error") return false;
    if (EXCLUDED.has(e.source)) return false;
    if (e.message.includes("held_during_build")) return false;
    if (!before.has(e.signature)) return true;
    return !!e.file && touched.has(e.file);
  });
}

/** A fix turn that left one of its own targets open is a repeat: stop. */
export function repeated(targeted: ProjectError[], openAfter: ProjectError[]): ProjectError[] {
  const still = new Set(openAfter.map((e) => e.signature));
  return targeted.filter((e) => still.has(e.signature));
}

export type LoopDecision = { action: "done" } | { action: "fix"; errors: ProjectError[] } | { action: "give_up"; errors: ProjectError[]; reason: "cap" | "repeat" };

export function decide(o: { attemptsUsed: number; toFix: ProjectError[]; lastTargets: ProjectError[] | null; openAfter: ProjectError[] }): LoopDecision {
  if (o.toFix.length === 0) return { action: "done" };
  if (o.lastTargets) {
    const rep = repeated(o.lastTargets, o.openAfter);
    if (rep.length) return { action: "give_up", errors: o.toFix, reason: "repeat" };
  }
  if (o.attemptsUsed >= MAX_FIX_TURNS) return { action: "give_up", errors: o.toFix, reason: "cap" };
  return { action: "fix", errors: o.toFix };
}

const where = (e: ProjectError) => (e.file ? `${e.file}${e.line ? `:${e.line}${e.col ? `:${e.col}` : ""}` : ""}` : "no file");

export function describeErrors(errors: ProjectError[]): string {
  const lines: string[] = [];
  let bytes = 0;
  for (const e of errors) {
    const block = `- [${e.source}] ${where(e)}\n  ${e.message.split("\n").join("\n  ")}${e.stack && e.source === "runtime" ? `\n  ${e.stack.split("\n").slice(1, 5).join("\n  ")}` : ""}`;
    if (bytes + block.length > MAX_ERROR_BYTES) {
      lines.push(`- and ${errors.length - lines.length} more`);
      break;
    }
    lines.push(block);
    bytes += block.length;
  }
  return lines.join("\n");
}

/** The prompt for a fix turn. */
export function fixPrompt(errors: ProjectError[], shot: string | null): string {
  const files = [...new Set(errors.map((e) => e.file).filter(Boolean))] as string[];
  const visual = errors.some((e) => e.source === "runtime" && /blank|did not load/i.test(e.message));
  return [
    `Fix only these errors. Do not refactor or restyle.`,
    "",
    describeErrors(errors),
    files.length ? `\nFiles involved: ${files.join(", ")}` : "",
    visual && shot ? `\nRead this image first: ${shot}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** "Fix 1 type error in src/App.tsx" */
export function fixSubject(errors: ProjectError[]): string {
  const kinds = new Set(errors.map((e) => e.source));
  const noun = kinds.size === 1 && kinds.has("types") ? "type error" : "error";
  const n = errors.length;
  const files = [...new Set(errors.map((e) => e.file).filter(Boolean))];
  return `Fix ${n} ${noun}${n === 1 ? "" : "s"}${files.length === 1 ? ` in ${files[0]}` : ""}`;
}
