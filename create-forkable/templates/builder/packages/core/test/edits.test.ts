import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyDirectEdits, deferredPrompt, editSubject } from "../src/edits.js";

const APP = `import { cn } from "@/lib/utils";

export default function App({ title }: { title: string }) {
  return (
    <main className="flex flex-col gap-4 p-6">
      <h1 className="text-28 font-semibold">Hello Acme</h1>
      <p className={cn("text-13 text-muted-foreground", title && "italic")}>
        Track what matters
      </p>
      <h2>{title}</h2>
      <button>Save {title}</button>
    </main>
  );
}
`;

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "edits-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "App.tsx"), APP);
  return dir;
}

describe("direct edits", () => {
  it("changes literal text at a loc", () => {
    const dir = project();
    const r = applyDirectEdits(dir, [{ kind: "text", loc: "src/App.tsx:6:7", before: "Hello Acme", after: "Welcome to Acme Inc" }]);
    expect(r.applied).toHaveLength(1);
    expect(r.deferred).toHaveLength(0);
    expect(r.files).toEqual(["src/App.tsx"]);
    const src = readFileSync(join(dir, "src", "App.tsx"), "utf8");
    expect(src).toContain(`<h1 className="text-28 font-semibold">Welcome to Acme Inc</h1>`);
    expect(src).not.toContain("Hello Acme");
  });

  it("keeps multi-line literal text's indentation and escapes braces", () => {
    const dir = project();
    const r = applyDirectEdits(dir, [{ kind: "text", loc: "src/App.tsx:7:7", before: "Track what matters", after: "Track {everything}" }]);
    expect(r.applied).toHaveLength(1);
    const src = readFileSync(join(dir, "src", "App.tsx"), "utf8");
    expect(src).toContain(`\n        {"Track {everything}"}\n      </p>`);
  });

  it("swaps a class for a ladder token in a literal className", () => {
    const dir = project();
    const r = applyDirectEdits(dir, [{ kind: "class", loc: "src/App.tsx:6:7", remove: ["text-28"], add: ["text-15"] }]);
    expect(r.applied).toHaveLength(1);
    expect(readFileSync(join(dir, "src", "App.tsx"), "utf8")).toContain(`<h1 className="font-semibold text-15">`);
  });

  it("swaps inside the first literal of cn()", () => {
    const dir = project();
    const r = applyDirectEdits(dir, [{ kind: "class", loc: "src/App.tsx:7:7", remove: ["text-muted-foreground"], add: ["text-accent"] }]);
    expect(r.applied).toHaveLength(1);
    expect(readFileSync(join(dir, "src", "App.tsx"), "utf8")).toContain(`cn("text-13 text-accent", title && "italic")`);
  });

  it("adds a className where there is none", () => {
    const dir = project();
    const r = applyDirectEdits(dir, [{ kind: "class", loc: "src/App.tsx:10:7", remove: [], add: ["text-15"] }]);
    expect(r.applied).toHaveLength(1);
    expect(readFileSync(join(dir, "src", "App.tsx"), "utf8")).toContain(`<h2 className="text-15">{title}</h2>`);
  });

  it("sends non-literal text to the agent batch instead", () => {
    const dir = project();
    const r = applyDirectEdits(dir, [
      { kind: "text", loc: "src/App.tsx:10:7", before: "Quarterly report", after: "Annual report" },
      { kind: "text", loc: "src/App.tsx:11:7", before: "Save Quarterly report", after: "Store Quarterly report" },
      { kind: "class", loc: "src/App.tsx:7:7", remove: ["italic"], add: [] },
      { kind: "comment", loc: "src/App.tsx:5:5", text: "More breathing room here", tag: "main" },
      { kind: "text", loc: "src/App.tsx:6:7", before: "Hello Acme", after: "Hi Acme" },
    ]);
    expect(r.applied.map((e) => e.loc)).toEqual(["src/App.tsx:6:7"]);
    expect(r.deferred).toHaveLength(4);
    expect(r.deferred[0]!.reason).toMatch(/expression/);
    const prompt = deferredPrompt(r.deferred);
    expect(prompt).toContain(`change the text "Quarterly report" to "Annual report"`);
    expect(prompt).toContain("More breathing room here");
    expect(editSubject(r.applied)).toBe("Edited 1 text in the preview");
    expect(readFileSync(join(dir, "src", "App.tsx"), "utf8")).toContain("<h2>{title}</h2>");
  });

  it("refuses paths outside the project", () => {
    const dir = project();
    const r = applyDirectEdits(dir, [{ kind: "text", loc: "../../etc/App.tsx:1:1", before: "a", after: "b" }]);
    expect(r.applied).toHaveLength(0);
    expect(r.deferred[0]!.reason).toMatch(/not a component file/);
  });
});
