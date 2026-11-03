import os from "node:os";
import { describe, expect, it } from "vitest";
import { claudeArgv } from "../src/adapters/claude.js";
import { codexArgv } from "../src/adapters/codex.js";
import { openclawArgv } from "../src/adapters/openclaw.js";
import { agentEnv, cleanEnv } from "../src/env.js";
import {
  BUILD_ALLOW,
  claudePermissionFlags,
  claudeSettingsJson,
  codexPermissionFlags,
  codexResumePermissionFlags,
  DENY_LIST,
  openclawSupports,
} from "../src/permissions.js";
import type { TurnInput } from "../src/types.js";

const input = (over: Partial<TurnInput> = {}): TurnInput => ({
  cwd: "/work/acme",
  prompt: "Change the heading",
  permission: "build",
  systemAppend: "Do not start a dev server.",
  mcp: { command: "node", args: ["/home/.builder/shims/mcp.mjs"], env: { BUILDER_API: "http://127.0.0.1:51989", BUILDER_TURN_TOKEN: "t" } },
  env: {},
  timeoutMs: 1_200_000,
  idleMs: 240_000,
  stateDir: "/home/.builder/state/p1",
  turnId: "t1",
  ...over,
});

const after = (argv: string[], flag: string) => argv[argv.indexOf(flag) + 1];

describe("permission tables", () => {
  it("the deny list covers dev servers, installs, git writes, network and secrets", () => {
    for (const rule of ["Bash(pnpm dev*)", "Bash(vite*)", "Bash(wrangler*)", "Bash(one *)", "Bash(pnpm add*)", "Bash(git push*)", "Bash(git commit*)", "Bash(curl *)", "Read(**/.dev.vars)", "Read(~/.builder/.env)", "Read(~/.builder/db/**)"]) {
      expect(DENY_LIST).toContain(rule);
    }
    expect(DENY_LIST).toHaveLength(40);
  });

  it("claude build: acceptEdits, no prompts, allow list, deny list last", () => {
    const f = claudePermissionFlags("build", ["Bash(node scripts/x.mjs)"]);
    expect(f.slice(0, 4)).toEqual(["--permission-mode", "acceptEdits", "--permission-prompts", "none"]);
    expect(f).toContain("mcp__builder__*");
    expect(f).toContain("Bash(builder-one *)");
    expect(f).toContain("Bash(node scripts/x.mjs)");
    expect(f.slice(f.indexOf("--disallowedTools") + 1)).toEqual(DENY_LIST);
    expect(BUILD_ALLOW).not.toContain("Bash(pnpm dev*)");
  });

  it("claude plan and full keep the deny list", () => {
    expect(claudePermissionFlags("plan")).toEqual(["--permission-mode", "plan", "--disallowedTools", ...DENY_LIST]);
    expect(claudePermissionFlags("full")).toEqual(["--dangerously-skip-permissions", "--disallowedTools", ...DENY_LIST]);
  });

  it("codex levels, first turn and resume", () => {
    expect(codexPermissionFlags("build")).toEqual(["--sandbox", "workspace-write"]);
    expect(codexPermissionFlags("plan")).toEqual(["--sandbox", "read-only"]);
    expect(codexPermissionFlags("full")).toEqual(["--dangerously-bypass-approvals-and-sandbox"]);
    expect(codexResumePermissionFlags("build")).toEqual(["-c", 'sandbox_mode="workspace-write"']);
    expect(codexResumePermissionFlags("plan")).toEqual(["-c", 'sandbox_mode="read-only"']);
  });

  it("openclaw has no plan mode", () => {
    expect(openclawSupports("plan")).toBe(false);
    expect(openclawSupports("build")).toBe(true);
  });

  it("settings JSON carries the steer hook and the deny list", () => {
    const s = JSON.parse(claudeSettingsJson({ steerHookCommand: "node /h/steer-hook.mjs" }));
    expect(s.permissions.deny).toEqual(DENY_LIST);
    expect(s.hooks.PostToolUse[0].hooks[0].command).toBe("node /h/steer-hook.mjs");
    expect(JSON.parse(claudeSettingsJson({})).hooks).toBeUndefined();
  });
});

describe("argv builders", () => {
  it("claude first turn: minted session id, stdin prompt, MCP, sources, append", () => {
    const argv = claudeArgv("/bin/claude", input({ model: "claude-sonnet-5" }), { partial: true, sessionId: "abc", resume: false });
    expect(argv.slice(0, 5)).toEqual(["/bin/claude", "-p", "--output-format", "stream-json", "--verbose"]);
    expect(argv).toContain("--include-partial-messages");
    expect(after(argv, "--session-id")).toBe("abc");
    expect(argv).not.toContain("-r");
    expect(after(argv, "--model")).toBe("claude-sonnet-5");
    expect(after(argv, "--setting-sources")).toBe("project,local");
    expect(argv).toContain("--strict-mcp-config");
    expect(JSON.parse(after(argv, "--mcp-config")!).mcpServers.builder.command).toBe("node");
    expect(after(argv, "--append-system-prompt")).toBe("Do not start a dev server.");
    expect(JSON.parse(after(argv, "--settings")!).permissions.deny).toEqual(DENY_LIST);
    expect(argv).not.toContain("Change the heading"); // prompt goes on stdin
    expect(argv.at(-1)).toBe(DENY_LIST.at(-1));
  });

  it("claude resume: -r, no --session-id, no MCP when none", () => {
    const argv = claudeArgv("/bin/claude", input({ sessionId: "abc", mcp: null }), { partial: false, sessionId: "abc", resume: true });
    expect(argv.slice(0, 4)).toEqual(["/bin/claude", "-r", "abc", "-p"]);
    expect(argv).not.toContain("--session-id");
    expect(argv).not.toContain("--mcp-config");
    expect(argv).toContain("--strict-mcp-config");
  });

  it("codex first turn and resume", () => {
    const first = codexArgv("/bin/codex", input({ model: "gpt-5.6-terra", images: ["/s/a.png"] }));
    expect(first.slice(0, 5)).toEqual(["/bin/codex", "exec", "--json", "-C", "/work/acme"]);
    expect(after(first, "-i")).toBe("/s/a.png");
    expect(after(first, "-m")).toBe("gpt-5.6-terra");
    expect(after(first, "--sandbox")).toBe("workspace-write");
    expect(first).toContain('mcp_servers.builder.command="node"');
    expect(first).toContain('mcp_servers.builder.args=["/home/.builder/shims/mcp.mjs"]');
    expect(first).toContain('mcp_servers.builder.env={BUILDER_API="http://127.0.0.1:51989",BUILDER_TURN_TOKEN="t"}');
    expect(first).toContain('mcp_servers.builder.default_tools_approval_mode="approve"');
    expect(first.at(-1)).toBe("-");
    expect(first).not.toContain("--dangerously-bypass-approvals-and-sandbox");

    const resume = codexArgv("/bin/codex", input({ sessionId: "th_1" }));
    expect(resume.slice(0, 5)).toEqual(["/bin/codex", "exec", "resume", "th_1", "--json"]);
    expect(resume).toContain('sandbox_mode="workspace-write"');
    expect(resume).not.toContain("--sandbox");
    expect(resume).not.toContain("-C");
    expect(resume.at(-1)).toBe("-");
  });

  it("openclaw: exec envelope, state dir per project, stdin message", () => {
    const argv = openclawArgv("/bin/openclaw", input({ timeoutMs: 600_000 }));
    expect(argv.slice(0, 4)).toEqual(["/bin/openclaw", "agent", "exec", "--json"]);
    expect(after(argv, "--cwd")).toBe("/work/acme");
    expect(after(argv, "--state-dir")).toBe("/home/.builder/state/p1/openclaw");
    expect(after(argv, "--message-file")).toBe("-");
    expect(after(argv, "--timeout")).toBe("600");
  });
});

describe("env", () => {
  const base = {
    PATH: "/usr/bin:/bin",
    HOME: "/h",
    ONE_SECRET: "x",
    ONE_RUN_JOB_ID: "j",
    BUILDER_RELAY_TOKEN: "r",
    DATABASE_URL: "postgres://",
    PGPASSWORD: "p",
    ANTHROPIC_API_KEY: "k",
    OPENAI_API_KEY: "k",
    CLAUDECODE: "1",
    CLAUDE_CODE_SESSION_ID: "s",
    CLAUDE_CONFIG_DIR: `${os.homedir()}/.claude`,
    KEEP_ME: "yes",
  };

  it("cleanEnv strips our secrets, the parent session and default CLAUDE_CONFIG_DIR", () => {
    const env = cleanEnv(base);
    expect(Object.keys(env).sort()).toEqual(["HOME", "KEEP_ME", "PATH"]);
  });

  it("API-key mode keeps provider keys", () => {
    const env = cleanEnv({ ...base, BUILDER_API_KEY_MODE: "1" });
    expect(env.ANTHROPIC_API_KEY).toBe("k");
    expect(env.BUILDER_API_KEY_MODE).toBeUndefined();
  });

  it("keeps a non-default CLAUDE_CONFIG_DIR", () => {
    expect(cleanEnv({ CLAUDE_CONFIG_DIR: "/elsewhere" }).CLAUDE_CONFIG_DIR).toBe("/elsewhere");
  });

  it("agentEnv tags the process and puts shims first on PATH", () => {
    const env = agentEnv({ projectId: "p1", turnId: "t1", shimsDir: "/h/.builder/shims", base, extra: { BUILDER_API: "http://127.0.0.1:51989" } });
    expect(env.BUILDER_AGENT).toBe("1");
    expect(env.BUILDER_PROJECT_ID).toBe("p1");
    expect(env.BUILDER_TURN_ID).toBe("t1");
    expect(env.BUILDER_API).toBe("http://127.0.0.1:51989");
    expect(env.BUILDER_RELAY_TOKEN).toBeUndefined();
    expect(env.PATH).toBe("/h/.builder/shims:/usr/bin:/bin");
  });
});
