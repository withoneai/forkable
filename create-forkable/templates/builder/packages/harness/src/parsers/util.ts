import path from "node:path";
import type { Usage } from "../types.js";

export const asCount = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;

/** Some CLIs prefix lines with terminal escapes; find the JSON object, if any. */
export function parseJsonLine(line: string): Record<string, unknown> | null {
  const start = line.indexOf("{");
  if (start === -1) return null;
  try {
    const obj = JSON.parse(line.slice(start)) as unknown;
    return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The first lines of a tool result, for the card's expanded view. */
export function toolResultPreview(content: unknown): string | undefined {
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content
      .map((c) => (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : ""))
      .join("\n");
  }
  // eslint-disable-next-line no-control-regex
  text = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/<\/?tool_use_error>/g, "").trim();
  if (!text) return undefined;
  const lines = text.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
  const head = lines.slice(0, 6).join("\n");
  const clipped = head.length > 400 ? `${head.slice(0, 399)}…` : head;
  return lines.length > 6 && !clipped.endsWith("…") ? `${clipped}\n…` : clipped;
}

/** Project-relative when inside cwd (handles /private/tmp vs /tmp), else as given. */
export function relativize(file: string, cwd: string | undefined): string {
  if (!cwd || !path.isAbsolute(file)) return file;
  const variants = [cwd, cwd.startsWith("/private/") ? cwd.slice("/private".length) : `/private${cwd}`];
  for (const root of variants) {
    const rel = path.relative(root, file);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel.split(path.sep).join("/");
  }
  return file;
}

/** Small MCP inputs for describeTool; strings clipped, big values dropped. */
export function smallInput(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v.length > 300 ? `${v.slice(0, 299)}…` : v;
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
  }
  return out;
}

export const addUsage = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
});
