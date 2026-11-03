// Checkpoints: one commit per turn that changed the tree,
// "Manual edits" before a turn, restore as a new commit, bookmarks.

import { and, desc, eq } from "drizzle-orm";
import type { HarnessId } from "@builder/harness/types";
import { BRAND, trailer } from "./brand.js";
import type { Bus } from "./bus.js";
import type { Db } from "./db/client.js";
import { checkpoints, publishes } from "./db/schema.js";
import * as git from "./git.js";
import type { Checkpoint, FileChange, TurnKind } from "./types.js";

type Row = typeof checkpoints.$inferSelect;

export function toCheckpoint(r: Row): Checkpoint {
  return {
    sha: r.sha,
    shortSha: r.sha.slice(0, 7),
    projectId: r.projectId,
    turnId: r.turnId,
    kind: r.kind as Checkpoint["kind"],
    subject: r.subject,
    harness: (r.harness as HarnessId) ?? null,
    files: r.files,
    additions: r.additions,
    deletions: r.deletions,
    shot: r.shot,
    bookmarked: r.bookmarked,
    restoredFrom: r.restoredFrom,
    createdAt: r.createdAt.toISOString(),
    published: [],
  };
}

const FALLBACK_ID = { name: BRAND.name, email: `${BRAND.slug}@localhost` };

export interface CommitMeta {
  subject: string;
  kind: TurnKind;
  turnId: string | null;
  harness: HarnessId | null;
  sessionId: string | null;
  restoredFrom?: string | null;
  body?: string;
}

export class Checkpoints {
  constructor(private db: Db, private bus: Bus) {}

  /** Files changed between two trees, as the UI shows them. */
  async changes(cwd: string, from: string, to: string): Promise<FileChange[]> {
    const files = await git.diffFiles(cwd, from, to);
    return files.map((f) => ({ path: f.path, status: f.status, additions: f.additions, deletions: f.deletions }));
  }

  /** Commit the working tree when it differs from HEAD. Null when nothing changed. */
  async commit(projectId: string, cwd: string, meta: CommitMeta): Promise<Checkpoint | null> {
    const head = await git.headCommit(cwd);
    const who = await git.identity(cwd, FALLBACK_ID);
    const msg = git.message(
      meta.subject,
      {
        [trailer("Turn")]: meta.turnId,
        [trailer("Harness")]: meta.harness,
        [trailer("Session")]: meta.sessionId,
        [trailer("Kind")]: meta.kind,
      },
      meta.body,
    );
    const made = await git.commitWorkingTree(cwd, msg, who);
    if (!made) return null;
    return this.record(projectId, cwd, made.sha, head, meta);
  }

  private async record(projectId: string, cwd: string, sha: string, parent: string | null, meta: CommitMeta): Promise<Checkpoint> {
    const files = parent ? await this.changes(cwd, parent, sha) : [];
    const subject = git.message(meta.subject, {}).split("\n")[0]!;
    const [row] = await this.db
      .insert(checkpoints)
      .values({
        sha,
        projectId,
        turnId: meta.turnId,
        kind: meta.kind,
        subject,
        harness: meta.harness,
        files,
        additions: files.reduce((n, f) => n + f.additions, 0),
        deletions: files.reduce((n, f) => n + f.deletions, 0),
        restoredFrom: meta.restoredFrom ?? null,
      })
      .returning();
    const cp = toCheckpoint(row!);
    this.bus.emit(projectId, { type: "checkpoint.created", checkpoint: cp });
    return cp;
  }

  /** Before a turn: commit edits made outside the agent as "Manual edits". */
  async manualEdits(projectId: string, cwd: string): Promise<Checkpoint | null> {
    return this.commit(projectId, cwd, { subject: "Manual edits", kind: "manual", turnId: null, harness: null, sessionId: null });
  }

  async restore(projectId: string, cwd: string, sha: string): Promise<Checkpoint> {
    const target = await this.get(projectId, sha);
    if (!target) throw new Error("That version is not in this project's history");
    await this.manualEdits(projectId, cwd);
    const head = await git.headCommit(cwd);
    if (head === sha) throw new Error("That version is already the current one");
    const subject = `Restore to ${sha.slice(0, 7)}: ${target.subject}`;
    const who = await git.identity(cwd, FALLBACK_ID);
    const newSha = await git.restoreAsNewCommit(cwd, sha, git.message(subject, { [trailer("Kind")]: "restore" }), who);
    const cp = await this.record(projectId, cwd, newSha, head, {
      subject,
      kind: "restore",
      turnId: null,
      harness: null,
      sessionId: null,
      restoredFrom: sha,
    });
    if (target.shot) await this.setShot(projectId, newSha, target.shot);
    return { ...cp, shot: target.shot };
  }

  async list(projectId: string): Promise<Checkpoint[]> {
    const rows = await this.db.select().from(checkpoints).where(eq(checkpoints.projectId, projectId)).orderBy(desc(checkpoints.createdAt));
    const badges = await this.publishedBadges(projectId);
    return rows.map((r) => ({ ...toCheckpoint(r), published: badges.get(r.sha) ?? [] }));
  }

  /** "Published to GitHub / Vercel" per sha, from successful publishes. */
  async publishedBadges(projectId: string): Promise<Map<string, ("github" | "vercel")[]>> {
    const rows = await this.db.select({ sha: publishes.sha, target: publishes.target }).from(publishes).where(and(eq(publishes.projectId, projectId), eq(publishes.status, "ok")));
    const out = new Map<string, ("github" | "vercel")[]>();
    for (const r of rows) {
      const list = out.get(r.sha) ?? [];
      if (!list.includes(r.target as "github")) list.push(r.target as "github" | "vercel");
      out.set(r.sha, list);
    }
    return out;
  }

  async latest(projectId: string): Promise<Checkpoint | null> {
    const [r] = await this.db.select().from(checkpoints).where(eq(checkpoints.projectId, projectId)).orderBy(desc(checkpoints.createdAt)).limit(1);
    return r ? toCheckpoint(r) : null;
  }

  async get(projectId: string, sha: string): Promise<Checkpoint | null> {
    const rows = await this.db.select().from(checkpoints).where(eq(checkpoints.projectId, projectId));
    const r = rows.find((x) => x.sha === sha || (sha.length >= 7 && x.sha.startsWith(sha)));
    return r ? toCheckpoint(r) : null;
  }

  async setShot(projectId: string, sha: string, shot: string): Promise<void> {
    await this.db.update(checkpoints).set({ shot }).where(and(eq(checkpoints.projectId, projectId), eq(checkpoints.sha, sha)));
  }

  async bookmark(projectId: string, sha: string, on: boolean): Promise<Checkpoint | null> {
    const cp = await this.get(projectId, sha);
    if (!cp) return null;
    const [r] = await this.db
      .update(checkpoints)
      .set({ bookmarked: on })
      .where(and(eq(checkpoints.projectId, projectId), eq(checkpoints.sha, cp.sha)))
      .returning();
    return r ? toCheckpoint(r) : null;
  }

  async diff(cwd: string, sha: string): Promise<(FileChange & { patch: string })[]> {
    const parent = await git.runGit(cwd, ["rev-parse", "--verify", "-q", `${sha}^`]);
    const from = parent.ok ? parent.stdout.trim() : git.EMPTY_TREE;
    const files = await this.changes(cwd, from, sha);
    return Promise.all(files.slice(0, 200).map(async (f) => ({ ...f, patch: await git.diffPatch(cwd, from, sha, f.path, 200_000) })));
  }
}
