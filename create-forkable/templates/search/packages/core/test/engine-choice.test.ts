// Settings, Assistant, "AI engine": which engine writes, from the saved choice,
// SEARCH_LOCAL_ENGINE, SEARCH_HOSTED and which local CLIs are ready.

import assert from "node:assert/strict";
import { test } from "node:test";
import { envOverride, resolveEngine, parseClaudeCatalog } from "../src/local-agent.js";

const both = ["claude-code", "codex"] as const;

test("auto takes Claude Code, else Codex, else One", () => {
  assert.deepEqual(resolveEngine({ choice: "auto", override: null, hosted: false, ready: [...both] }), { effective: "auto", run: "claude-code", reason: null });
  assert.deepEqual(resolveEngine({ choice: "auto", override: null, hosted: false, ready: ["codex"] }), { effective: "auto", run: "codex", reason: null });
  assert.deepEqual(resolveEngine({ choice: "auto", override: null, hosted: false, ready: [] }), { effective: "auto", run: null, reason: "not_found" });
  // an old settings row without the field is auto
  assert.equal(resolveEngine({ choice: undefined, override: null, hosted: false, ready: ["codex"] }).run, "codex");
});

test("an explicit choice runs that CLI, or One when it is not ready", () => {
  assert.equal(resolveEngine({ choice: "codex", override: null, hosted: false, ready: [...both] }).run, "codex");
  assert.equal(resolveEngine({ choice: "claude-code", override: null, hosted: false, ready: [...both] }).run, "claude-code");
  assert.deepEqual(resolveEngine({ choice: "codex", override: null, hosted: false, ready: ["claude-code"] }), { effective: "codex", run: null, reason: "unavailable" });
  assert.deepEqual(resolveEngine({ choice: "one", override: null, hosted: false, ready: [...both] }), { effective: "one", run: null, reason: "chosen" });
});

test("SEARCH_LOCAL_ENGINE wins over the setting", () => {
  assert.equal(envOverride("off"), "one");
  assert.equal(envOverride("0"), "one");
  assert.equal(envOverride("codex"), "codex");
  assert.equal(envOverride("Claude-Code"), "claude-code");
  assert.equal(envOverride(""), null);
  assert.equal(envOverride("bogus"), null);
  assert.deepEqual(resolveEngine({ choice: "one", override: "codex", hosted: false, ready: [...both] }), { effective: "codex", run: "codex", reason: null });
  assert.deepEqual(resolveEngine({ choice: "claude-code", override: "one", hosted: false, ready: [...both] }), { effective: "one", run: null, reason: "off" });
  assert.equal(resolveEngine({ choice: "codex", override: "auto", hosted: false, ready: [...both] }).run, "claude-code");
});

test("hosted forces One, whatever the setting or env says", () => {
  for (const choice of ["auto", "claude-code", "codex", "one"] as const) {
    assert.deepEqual(resolveEngine({ choice, override: "claude-code", hosted: true, ready: [...both] }), { effective: "one", run: null, reason: "hosted" });
  }
});

test("Claude models come out of the bundle's catalog, newest per family", () => {
  const text = 'x{id:"claude-opus-5-5",family:"opus",display_name:"Opus 5.5"},{id:"claude-haiku-5-5",family:"haiku",display_name:"Haiku 5.5"},latest_per_family:{haiku:"claude-haiku-5-5",opus:"claude-opus-5-5"}';
  assert.deepEqual(parseClaudeCatalog(text).map((m) => m.value), ["claude-opus-5-5", "claude-haiku-5-5"]);
  assert.deepEqual(parseClaudeCatalog("nothing here"), []);
});
