import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import * as git from "../src/git.js";

const who = { name: "Test", email: "test@localhost" };
const dirs: string[] = [];
const repo = async () => {
  const d = mkdtempSync(join(tmpdir(), "bld-git-test-"));
  dirs.push(d);
  await git.initRepo(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("git checkpoints", () => {
  it("snapshots the working tree without touching HEAD or the index", async () => {
    const d = await repo();
    writeFileSync(join(d, "a.txt"), "one\n");
    const first = await git.commitWorkingTree(d, git.message("Template", { "Builder-Kind": "template" }), who);
    expect(first).not.toBeNull();
    writeFileSync(join(d, "b.txt"), "new\n");
    const head = await git.headCommit(d);
    const snap = await git.snapshotTree(d);
    expect(snap).not.toBe(await git.treeOf(d, head!));
    expect(await git.headCommit(d)).toBe(head);
    const status = await git.runGit(d, ["status", "--porcelain"]);
    expect(status.stdout).toContain("?? b.txt"); // still untracked in the real index
  });

  it("commits with trailers, diff counts, and returns null when nothing changed", async () => {
    const d = await repo();
    writeFileSync(join(d, "a.txt"), "one\n");
    await git.commitWorkingTree(d, git.message("Template", {}), who);
    const before = (await git.snapshotTree(d))!;
    writeFileSync(join(d, "a.txt"), "one\ntwo\nthree\n");
    writeFileSync(join(d, "c.txt"), "c\n");
    const after = (await git.snapshotTree(d))!;
    const files = await git.diffFiles(d, before, after);
    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ["a.txt", "M", 2, 0],
      ["c.txt", "A", 1, 0],
    ]);
    const msg = git.message("A task list for Acme Inc", { "Builder-Turn": "t_1", "Builder-Harness": "replay", "Builder-Session": "s1", "Builder-Kind": "user" });
    const made = await git.commitWorkingTree(d, msg, who);
    const [entry] = await git.log(d, 1);
    expect(entry!.sha).toBe(made!.sha);
    expect(entry!.trailers).toMatchObject({ "Builder-Turn": "t_1", "Builder-Harness": "replay", "Builder-Session": "s1", "Builder-Kind": "user" });
    expect(await git.commitWorkingTree(d, msg, who)).toBeNull();
    expect((await git.runGit(d, ["status", "--porcelain"])).stdout.trim()).toBe("");
  });

  it("restores as a new commit, never moving main backwards", async () => {
    const d = await repo();
    writeFileSync(join(d, "a.txt"), "v1\n");
    const v1 = (await git.commitWorkingTree(d, git.message("v1", {}), who))!.sha;
    writeFileSync(join(d, "a.txt"), "v2\n");
    writeFileSync(join(d, "later.txt"), "added in v2\n");
    const v2 = (await git.commitWorkingTree(d, git.message("v2", {}), who))!.sha;
    writeFileSync(join(d, "untracked.log"), "keep me\n");
    const reflogBefore = await git.reflog(d);
    const restored = await git.restoreAsNewCommit(d, v1, git.message("Restore to v1", { "Builder-Kind": "restore" }), who);
    expect(readFileSync(join(d, "a.txt"), "utf8")).toBe("v1\n");
    expect(existsSync(join(d, "later.txt"))).toBe(false);
    expect(readFileSync(join(d, "untracked.log"), "utf8")).toBe("keep me\n");
    const log = await git.log(d);
    expect(log.map((l) => l.sha)).toEqual([restored, v2, v1]);
    const reflogAfter = await git.reflog(d);
    expect(reflogAfter.slice(1)).toEqual(reflogBefore); // only one new entry, nothing rewritten
    expect(reflogAfter.join("\n")).not.toMatch(/reset/);
    expect(await git.treeOf(d, restored)).toBe(await git.treeOf(d, v1));
  });
});
