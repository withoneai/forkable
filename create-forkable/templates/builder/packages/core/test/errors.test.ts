import { describe, expect, it } from "vitest";
import * as autofix from "../src/autofix.js";
import { normalizeMessage, parseTsc, projectFile, signatureOf } from "../src/errors.js";
import type { ProjectError } from "../src/types.js";

const P = "/Users/x/.builder/projects/acme";

describe("error signatures", () => {
  it("dedupes sightings that differ only in noise", () => {
    const a = signatureOf({ source: "runtime", message: `TypeError: x is undefined at http://acme.localhost:51990/src/App.tsx?t=1712345:18:7`, file: "src/App.tsx", line: 18 }, P);
    const b = signatureOf({ source: "runtime", message: `TypeError: x is undefined at http://acme.localhost:51990/src/App.tsx?t=9999999:18:9`, file: "src/App.tsx", line: 18 }, P);
    expect(a).toBe(b);
  });
  it("keeps different sources, files and lines apart", () => {
    const base = { message: "boom", file: "src/App.tsx", line: 1 };
    const s = new Set([
      signatureOf({ ...base, source: "runtime" }),
      signatureOf({ ...base, source: "build" }),
      signatureOf({ ...base, source: "runtime", line: 2 }),
      signatureOf({ ...base, source: "runtime", file: "src/b.tsx" }),
    ]);
    expect(s.size).toBe(4);
  });
  it("strips project paths and colors", () => {
    expect(normalizeMessage(`\u001b[31m${P}/src/App.tsx failed\u001b[0m`, P)).toBe("src/App.tsx failed");
    expect(projectFile(`${P}/src/App.tsx`, P)).toBe("src/App.tsx");
    expect(projectFile(`http://acme.localhost:51990/src/App.tsx?t=1`, P)).toBe("src/App.tsx");
    expect(projectFile(`${P}/node_modules/react/index.js`, P)).toBeNull();
  });
  it("parses tsc output with continuation lines", () => {
    const out = `src/App.tsx(18,7): error TS2322: Type 'number' is not assignable to type 'string'.\nserver/app.ts(3,1): error TS2304: Cannot find name 'foo'.\n  Did you mean 'for'?\n`;
    const e = parseTsc(out);
    expect(e).toHaveLength(2);
    expect(e[0]).toMatchObject({ source: "types", file: "src/App.tsx", line: 18, col: 7 });
    expect(e[1]!.message).toContain("Did you mean");
  });
});

const err = (sig: string, over: Partial<ProjectError> = {}): ProjectError => ({
  id: sig, signature: sig, source: "types", file: "src/App.tsx", line: 1, col: 1, message: sig, stack: null,
  firstSeen: "", lastSeen: "", count: 1, turnId: null, resolvedAt: null, severity: "error", ...over,
});

describe("auto-fix decisions", () => {
  it("takes new errors and old ones in touched files, never One refusals or warnings", () => {
    const open = [err("new"), err("old-touched"), err("old-other", { file: "src/x.tsx" }), err("refusal", { source: "one" }), err("warn", { severity: "warning" })];
    const picked = autofix.errorsToFix(open, new Set(["old-touched", "old-other"]), new Set(["src/App.tsx"]));
    expect(picked.map((e) => e.signature)).toEqual(["new", "old-touched"]);
  });
  it("stops at 3 fix turns", () => {
    expect(autofix.decide({ attemptsUsed: 3, toFix: [err("a")], lastTargets: [err("z")], openAfter: [err("a")] })).toMatchObject({ action: "give_up", reason: "cap" });
    expect(autofix.decide({ attemptsUsed: 2, toFix: [err("a")], lastTargets: [err("z")], openAfter: [err("a")] }).action).toBe("fix");
  });
  it("stops on a repeated signature", () => {
    expect(autofix.decide({ attemptsUsed: 1, toFix: [err("a")], lastTargets: [err("a")], openAfter: [err("a")] })).toMatchObject({ action: "give_up", reason: "repeat" });
  });
  it("is done when nothing is left", () => {
    expect(autofix.decide({ attemptsUsed: 1, toFix: [], lastTargets: [err("a")], openAfter: [] }).action).toBe("done");
  });
  it("caps the error text at 8 KB", () => {
    const many = Array.from({ length: 200 }, (_, i) => err(`e${i}`, { message: "x".repeat(200) }));
    expect(autofix.describeErrors(many).length).toBeLessThan(8 * 1024 + 200);
    expect(autofix.fixPrompt([err("a")], null)).toMatch(/^Fix only these errors\. Do not refactor or restyle\./);
  });
});
