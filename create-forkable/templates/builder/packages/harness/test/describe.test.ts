import { describe, expect, it } from "vitest";
import { describeDenied, describeTool, platformName, unwrapCommand } from "../src/describe.js";

const tool = (name: string, extra: Record<string, unknown> = {}) =>
  ({ t: "tool_start", id: "1", name, kind: "other", ...extra }) as Parameters<typeof describeTool>[0];

describe("describeTool", () => {
  it("speaks in verbs", () => {
    expect(describeTool(tool("Edit", { kind: "write", files: ["src/App.tsx"] }))).toBe("Edited src/App.tsx");
    expect(describeTool(tool("Write", { kind: "write", files: ["a.ts", "b.ts"] }))).toBe("Wrote 2 files");
    expect(describeTool(tool("Bash", { kind: "run", detail: "cd /work/acme && pnpm typecheck" }))).toBe("Ran pnpm typecheck");
    expect(describeTool(tool("command_execution", { kind: "run", detail: "/bin/zsh -lc \"git status --short\"" }))).toBe("Checked git status");
    expect(describeTool(tool("mcp__builder__one_load_action", { kind: "one", input: { platform: "gmail" } }))).toBe("Read Gmail docs");
    expect(describeTool(tool("mcp__builder__one_find_actions", { kind: "one", input: { platform: "google-calendar", intent: "x" } }))).toBe(
      "Searched Google Calendar actions",
    );
    expect(describeTool(tool("mcp__builder__project_add_dependency", { input: { name: "zod" } }))).toBe("Added zod");
    expect(describeTool(tool("Bash", { kind: "run", detail: "builder-one find stripe invoices" }))).toBe("Searched Stripe actions");
    expect(describeTool(tool("Grep", { kind: "read", detail: "useState" }))).toBe("Searched the code for useState");
    expect(describeTool(tool("WebFetch", { kind: "read", detail: "https://example.com/a" }))).toBe("Read example.com");
  });

  it("unwraps wrappers", () => {
    expect(unwrapCommand("cd x && FOO=1 nohup pnpm build")).toBe("pnpm build");
  });

  it("names platforms and denials", () => {
    expect(platformName("hubspot")).toBe("HubSpot");
    expect(platformName("acme-crm")).toBe("Acme Crm");
    expect(describeDenied({ t: "denied", tool: "Bash(curl x)" }, "Codex")).toBe("Codex tried to use curl x, which this project does not allow");
  });
});
