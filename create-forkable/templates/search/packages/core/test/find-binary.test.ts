// Finding an agent's CLI on Windows (read from the code, not run on Windows):
// `where` lists every match, often npm's extensionless shim first, which execFile
// cannot start; the picker takes the .exe, then a .cmd shim.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickWhereLine } from "../src/local-agent.js";

describe("Windows `where` output", () => {
  it("skips the extensionless npm shim and takes the .cmd", () => {
    const out = "C:\\Users\\a\\AppData\\Roaming\\npm\\claude\r\nC:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd\r\n";
    assert.equal(pickWhereLine(out), "C:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd");
  });
  it("prefers an .exe over a .cmd", () => {
    assert.equal(pickWhereLine("C:\\x\\codex.cmd\r\nC:\\y\\codex.exe\r\n"), "C:\\y\\codex.exe");
  });
  it("gives nothing when only an extensionless file is there", () => {
    assert.equal(pickWhereLine("C:\\x\\claude\r\n"), null);
  });
});
