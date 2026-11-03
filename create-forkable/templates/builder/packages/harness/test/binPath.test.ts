import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { nvmBinDirs, resolveBinPath, searchedDirs, versionOf, wellKnownBinDirs } from "../src/binPath.js";

describe("binPath", () => {
  it("resolves a binary on PATH to an absolute path", () => {
    const sh = resolveBinPath("sh");
    expect(sh && path.isAbsolute(sh)).toBe(true);
  });

  it("misses cleanly and lists where it looked", () => {
    expect(resolveBinPath("definitely-not-a-cli-xyz")).toBeNull();
    const dirs = searchedDirs();
    expect(dirs).toContain(path.join(os.homedir(), ".codex", "bin"));
    expect(dirs.at(-1)).toMatch(/-ilc command -v$/);
  });

  it("refuses shell-meaningful names before any shell probe", () => {
    expect(resolveBinPath("x; rm -rf /")).toBeNull();
  });

  it("puts the nvm default alias first, then versions descending", () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "harness-nvm-"));
    for (const v of ["v18.20.0", "v22.1.0", "v24.14.0", "v24.2.0"]) mkdirSync(path.join(home, ".nvm/versions/node", v, "bin"), { recursive: true });
    mkdirSync(path.join(home, ".nvm/alias"), { recursive: true });
    writeFileSync(path.join(home, ".nvm/alias/default"), "22\n");
    const dirs = nvmBinDirs(home).map((d) => d.split("/").at(-2));
    expect(dirs).toEqual(["v22.1.0", "v24.14.0", "v24.2.0", "v18.20.0"]);
  });

  it("includes the codex bin dir among the well-known dirs", () => {
    expect(wellKnownBinDirs()).toContain(path.join(os.homedir(), ".codex", "bin"));
  });

  it("reads versions", () => {
    expect(versionOf("2.1.306 (Claude Code)")).toBe("2.1.306");
    expect(versionOf("codex-cli 0.163.0")).toBe("0.163.0");
    expect(versionOf("OpenClaw 2026.8.1 (ea80657)")).toBe("2026.8.1");
    expect(versionOf("nothing")).toBeNull();
  });
});
