// Template cache pruning: old versions piled up (16 of them, 8.8 GB). Keep the
// current one and the newest other, never touch a dir a warm is filling, and
// leave older projects running (their native links become copies first).
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { NATIVES_MARKER, pruneTemplateCache, READY_MARKER, templateCacheSize, warmsInProgress } from "@builder/template/render";
import { BRAND } from "../src/brand.js";

const root = mkdtempSync(join(tmpdir(), `${BRAND.slug}-prune-test-`));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const NATIVE = "node_modules/.pnpm/workerd@1/node_modules/workerd/bin/workerd";

/** A warm version dir whose ready marker is `ageMin` minutes old. */
function version(cache: string, name: string, ageMin: number, o: { warm?: boolean } = {}) {
  const d = join(cache, name);
  mkdirSync(join(d, dirname(NATIVE)), { recursive: true });
  writeFileSync(join(d, "package.json"), "{}\n");
  writeFileSync(join(d, NATIVE), `#!/bin/sh\necho ${name}\n`);
  chmodSync(join(d, NATIVE), 0o755);
  writeFileSync(join(d, NATIVES_MARKER), `${JSON.stringify([NATIVE])}\n`);
  const t = new Date(Date.now() - ageMin * 60_000);
  if (o.warm !== false) {
    writeFileSync(join(d, READY_MARKER), "x\n");
    utimesSync(join(d, READY_MARKER), t, t);
  }
  utimesSync(d, t, t);
  return d;
}

/** A project cloned from `versionDir`: its native is a link back into the cache, as cloneTemplate makes it. */
function project(dir: string, versionDir: string) {
  mkdirSync(join(dir, dirname(NATIVE)), { recursive: true });
  symlinkSync(join(versionDir, NATIVE), join(dir, NATIVE));
  return dir;
}

describe("pruneTemplateCache", () => {
  it("keeps the current version and the newest other, deletes the rest and dead warms' leftovers", async () => {
    const cache = join(root, "basic");
    version(cache, "1-current", 50);
    version(cache, "1-old1", 30);
    version(cache, "1-old2", 300);
    version(cache, "1-old3", 600);
    mkdirSync(join(cache, "1-current.tmp-999999-1-abc"), { recursive: true }); // pid 999999: not running
    const r = await pruneTemplateCache(cache, { current: "1-current" });
    expect(r.skipped).toBeNull();
    expect(r.kept).toEqual(["1-current", "1-old1"]);
    expect(readdirSync(cache).sort()).toEqual(["1-current", "1-old1"]);
    expect(r.removed.sort()).toEqual(["1-current.tmp-999999-1-abc", "1-old2", "1-old3"]);
  });

  it("does nothing while a warm is in progress (a tmp dir whose process is alive)", async () => {
    const cache = join(root, "busy");
    version(cache, "1-current", 1);
    version(cache, "1-old1", 30);
    version(cache, "1-old2", 300);
    const tmp = join(cache, `1-next.tmp-${process.pid}-1-abc`);
    mkdirSync(tmp, { recursive: true });
    expect(warmsInProgress(cache)).toEqual([`1-next.tmp-${process.pid}-1-abc`]);
    const r = await pruneTemplateCache(cache, { current: "1-current" });
    expect(r.skipped).toMatch(/warm is in progress/);
    expect(readdirSync(cache).sort()).toEqual(["1-current", "1-next.tmp-" + process.pid + "-1-abc", "1-old1", "1-old2"].sort());
  });

  it("leaves a young version without its marker (another process is priming it), removes an old broken one", async () => {
    const cache = join(root, "priming");
    version(cache, "1-current", 1);
    version(cache, "1-priming", 1, { warm: false });
    version(cache, "1-broken", 120, { warm: false });
    const r = await pruneTemplateCache(cache, { current: "1-current" });
    expect(r.removed).toEqual(["1-broken"]);
    expect(existsSync(join(cache, "1-priming"))).toBe(true);
  });

  it("copies a project's native links before their version goes, and leaves links into kept versions alone", async () => {
    const cache = join(root, "projects");
    const cur = version(cache, "1-current", 1);
    const kept = version(cache, "1-old1", 30);
    const gone = version(cache, "1-old2", 300);
    const pOld = project(join(root, "p-old"), gone);
    const pKept = project(join(root, "p-kept"), kept);
    const pCur = project(join(root, "p-cur"), cur);
    const r = await pruneTemplateCache(cache, { current: "1-current", projectDirs: [pOld, pKept, pCur, join(root, "missing")] });
    expect(r.removed).toEqual(["1-old2"]);
    expect(r.relinked).toBe(1);
    const f = join(pOld, NATIVE);
    expect(lstatSync(f).isSymbolicLink()).toBe(false);
    expect(readFileSync(f, "utf8")).toContain("1-old2");
    expect(statSync(f).mode & 0o111).not.toBe(0);
    expect(lstatSync(join(pKept, NATIVE)).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(pCur, NATIVE)).isSymbolicLink()).toBe(true);
  });

  it("follows a scratch home's cache symlink when matching links", async () => {
    const real = join(root, "shared");
    version(real, "1-current", 1);
    version(real, "1-old1", 30);
    const gone = version(real, "1-old2", 300);
    const scratch = join(root, "scratch-cache");
    symlinkSync(real, scratch);
    // Cloned through another scratch home's link: the target names a different path to the same dir.
    const p = project(join(root, "p-scratch"), gone);
    const r = await pruneTemplateCache(scratch, { current: "1-current", projectDirs: [p] });
    expect(r.removed).toEqual(["1-old2"]);
    expect(r.relinked).toBe(1);
    expect(lstatSync(join(p, NATIVE)).isSymbolicLink()).toBe(false);
  });

  it("reports the cache size and its version count", async () => {
    const s = await templateCacheSize(join(root, "basic"));
    expect(s.versions).toBe(2);
    expect(s.bytes).toBeGreaterThan(0);
    expect((await templateCacheSize(join(root, "nope"))).bytes).toBe(0);
  });
});
