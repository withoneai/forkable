import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import type { Bus } from "./bus.js";
import type { Db } from "./db/client.js";
import { errors } from "./db/schema.js";
import { newId } from "./ids.js";
import type { ErrorSource, ProjectError } from "./types.js";

// One table of errors per project, deduped by signature.

export interface ErrorInput {
  source: ErrorSource;
  message: string;
  file?: string | null;
  line?: number | null;
  col?: number | null;
  stack?: string | null;
  severity?: "error" | "warning";
}

/** Strip what changes between two sightings of the same error. */
export function normalizeMessage(message: string, projectPath?: string): string {
  let m = message;
  if (projectPath) m = m.split(projectPath + "/").join("").split(projectPath).join("");
  return m
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\?[tv]=[\w.-]+/g, "")
    .replace(/https?:\/\/[a-z0-9.-]+(:\d+)?/gi, "")
    .replace(/\b[0-9a-f]{8,}\b/gi, "#")
    .replace(/\d{4}-\d\d-\d\dT[\d:.]+Z?/g, "")
    .replace(/:\d+:\d+\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function signatureOf(e: ErrorInput, projectPath?: string): string {
  const where = e.file ? `${e.file}:${e.line ?? ""}` : "";
  return createHash("sha1").update(`${e.source}\n${normalizeMessage(e.message, projectPath)}\n${where}`).digest("hex");
}

/** Project-relative path, or null when the path is outside the project or in node_modules. */
export function projectFile(file: string | null | undefined, projectPath: string): string | null {
  if (!file) return null;
  let f = file.replace(/^file:\/\//, "").replace(/\?.*$/, "");
  try {
    f = decodeURIComponent(f);
  } catch {
    /* keep */
  }
  if (/^https?:\/\//.test(f)) f = new URL(f).pathname.replace(/^\/@fs/, "");
  if (f.startsWith(projectPath + "/")) f = f.slice(projectPath.length + 1);
  f = f.replace(/^\/+/, "");
  if (f.includes("node_modules") || f.startsWith("@") || f.startsWith("..")) return null;
  return f || null;
}

/** Keep only frames that point into the project's own files. */
export function trimStack(stack: string | null | undefined, projectPath: string): string | null {
  if (!stack) return null;
  const lines = stack.split("\n");
  const kept = lines.filter((l, i) => i === 0 || (!l.includes("node_modules") && (l.includes("/src/") || l.includes("/server/") || l.includes(projectPath))));
  return kept.slice(0, 12).join("\n").slice(0, 4000);
}

/** `src/App.tsx(18,7): error TS2322: Type ...` lines from tsc. Continuation lines join the message. */
export function parseTsc(output: string): ErrorInput[] {
  const out: ErrorInput[] = [];
  const re = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/;
  for (const raw of output.split("\n")) {
    const line = raw.replace(/\u001b\[[0-9;]*m/g, "");
    const m = line.match(re);
    if (m) {
      out.push({ source: "types", file: m[1]!.trim(), line: Number(m[2]), col: Number(m[3]), message: `${m[5]}: ${m[6]}`, severity: "error" });
    } else if (out.length && /^\s{2,}\S/.test(line)) {
      const last = out[out.length - 1]!;
      if (last.message.length < 1500) last.message += `\n${line.trim()}`;
    }
  }
  return out;
}

type Row = typeof errors.$inferSelect;

export function toProjectError(r: Row): ProjectError {
  return {
    id: r.id,
    signature: r.signature,
    source: r.source as ErrorSource,
    file: r.file,
    line: r.line,
    col: r.col,
    message: r.message,
    stack: r.stack,
    firstSeen: r.firstSeen.toISOString(),
    lastSeen: r.lastSeen.toISOString(),
    count: r.count,
    turnId: r.turnId,
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    severity: (r.severity as "error" | "warning") ?? "error",
  };
}

export class ErrorStore {
  constructor(private db: Db, private bus: Bus) {}

  /** Scrubs a project's stored environment values out of error text (set by the platform). */
  redact: (projectId: string, text: string) => string = (_id, t) => t;

  async record(projectId: string, projectPath: string, input: ErrorInput, turnId: string | null = null): Promise<ProjectError> {
    const scrub = (t: string | null | undefined) => (t ? this.redact(projectId, t) : t);
    input = { ...input, message: scrub(input.message) ?? input.message, stack: scrub(input.stack) };
    const e: ErrorInput = { ...input, file: projectFile(input.file, projectPath) ?? (input.file && !input.file.startsWith("/") ? input.file : null) };
    if (!e.file) e.line = e.col = null;
    const signature = signatureOf(e, projectPath);
    const now = new Date();
    const [open] = await this.db
      .select()
      .from(errors)
      .where(and(eq(errors.projectId, projectId), eq(errors.signature, signature), isNull(errors.resolvedAt)))
      .limit(1);
    let row: Row;
    if (open) {
      [row] = (await this.db
        .update(errors)
        .set({ lastSeen: now, count: open.count + 1, stack: trimStack(e.stack, projectPath) ?? open.stack })
        .where(eq(errors.id, open.id))
        .returning()) as [Row];
    } else {
      [row] = (await this.db
        .insert(errors)
        .values({
          id: newId("e"),
          projectId,
          signature,
          source: e.source,
          severity: e.severity ?? "error",
          file: e.file ?? null,
          line: e.line ?? null,
          col: e.col ?? null,
          message: normalizeDisplay(e.message, projectPath),
          stack: trimStack(e.stack, projectPath),
          firstSeen: now,
          lastSeen: now,
          turnId,
        })
        .returning()) as [Row];
      await this.changed(projectId);
    }
    return toProjectError(row);
  }

  async open(projectId: string): Promise<ProjectError[]> {
    const rows = await this.db
      .select()
      .from(errors)
      .where(and(eq(errors.projectId, projectId), isNull(errors.resolvedAt)))
      .orderBy(desc(errors.lastSeen));
    return rows.map(toProjectError);
  }

  async list(projectId: string, onlyOpen: boolean): Promise<ProjectError[]> {
    if (onlyOpen) return this.open(projectId);
    const rows = await this.db.select().from(errors).where(eq(errors.projectId, projectId)).orderBy(desc(errors.lastSeen)).limit(200);
    return rows.map(toProjectError);
  }

  async countOpen(projectId: string): Promise<number> {
    return (await this.open(projectId)).filter((e) => e.severity === "error").length;
  }

  /** Resolve open rows of the given sources that were last seen before `before` (not seen again since). */
  async resolveStale(projectId: string, sources: ErrorSource[], before: Date): Promise<number> {
    const rows = await this.db
      .update(errors)
      .set({ resolvedAt: new Date() })
      .where(and(eq(errors.projectId, projectId), isNull(errors.resolvedAt), inArray(errors.source, sources), lt(errors.lastSeen, before)))
      .returning({ id: errors.id });
    if (rows.length) await this.changed(projectId);
    return rows.length;
  }

  /** Replace the open set of one source with a fresh full report (tsc, build). */
  async replaceSource(projectId: string, projectPath: string, source: ErrorSource, found: ErrorInput[], turnId: string | null): Promise<ProjectError[]> {
    const startedAt = new Date(Date.now() - 1);
    const out: ProjectError[] = [];
    for (const f of found) out.push(await this.record(projectId, projectPath, { ...f, source }, turnId));
    await this.resolveStale(projectId, [source], startedAt);
    return out;
  }

  async resolveAll(projectId: string, sources: ErrorSource[]): Promise<void> {
    const rows = await this.db
      .update(errors)
      .set({ resolvedAt: new Date() })
      .where(and(eq(errors.projectId, projectId), isNull(errors.resolvedAt), inArray(errors.source, sources)))
      .returning({ id: errors.id });
    if (rows.length) await this.changed(projectId);
  }

  private async changed(projectId: string): Promise<void> {
    this.bus.emit(projectId, { type: "errors.changed", open: await this.countOpen(projectId) });
  }
}

function normalizeDisplay(message: string, projectPath: string): string {
  return message.split(projectPath + "/").join("").replace(/\u001b\[[0-9;]*m/g, "").slice(0, 4000);
}
