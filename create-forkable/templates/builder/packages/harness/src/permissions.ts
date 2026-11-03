import { HARNESS_NAMES, mcpPrefix } from "./names.js";
import type { Permission } from "./types.js";

/**
 * Permission levels to CLI flags. `build` is the default
 * for every project. The deny list holds at every level, `full` included:
 * Claude honors deny rules even with --dangerously-skip-permissions.
 */

/** Every level. Also written to each project's .claude/settings.json. */
export const DENY_LIST: string[] = [
  "Bash(npm run dev*)", "Bash(pnpm dev*)", "Bash(pnpm run dev*)", "Bash(yarn dev*)", "Bash(bun dev*)",
  "Bash(vite*)", "Bash(npx vite*)", "Bash(pnpm exec vite*)", "Bash(pnpm vite*)",
  "Bash(wrangler*)", "Bash(npx wrangler*)", "Bash(pnpm exec wrangler*)",
  "Bash(nohup *)", "Bash(one *)", "Bash(npx @withone/*)",
  "Bash(npm install*)", "Bash(npm i *)", "Bash(pnpm add*)", "Bash(pnpm install*)", "Bash(pnpm i *)", "Bash(yarn add*)",
  "Bash(git push*)", "Bash(git remote*)", "Bash(git reset*)", "Bash(git checkout*)", "Bash(git commit*)", "Bash(git rebase*)",
  "Bash(curl *)", "Bash(wget *)", "Bash(security *)", "Bash(*security find-*)",
  "Read(~/.ssh/**)", "Read(~/.one/**)", "Read(~/.builder/.env)", "Read(~/.builder/config.json)", "Read(~/.builder/db/**)", "Read(~/.builder/state/**)", "Read(~/.aws/**)", "Read(**/.dev.vars)", "Read(**/.env*)",
];

/** The Claude `build` allow list. */
export const BUILD_ALLOW: string[] = [
  "Read", "Edit", "Write", "MultiEdit", "Glob", "Grep", "WebSearch", "WebFetch",
  "Bash(pnpm build*)", "Bash(pnpm typecheck*)", "Bash(pnpm exec tsc*)", "Bash(pnpm test*)", "Bash(pnpm exec vitest*)",
  "Bash(pnpm lint*)", "Bash(git status*)", "Bash(git diff*)", "Bash(git log*)", "Bash(ls *)", "Bash(cat *)",
  "Bash(rg *)", "Bash(grep *)", `Bash(${HARNESS_NAMES.slug}-one *)`, `${mcpPrefix()}*`,
];

export function claudePermissionFlags(level: Permission, extraAllow: string[] = []): string[] {
  const deny = ["--disallowedTools", ...DENY_LIST];
  switch (level) {
    case "build":
      return [
        "--permission-mode", "acceptEdits",
        "--permission-prompts", "none",
        "--allowedTools", ...BUILD_ALLOW, ...extraAllow.filter((r) => !BUILD_ALLOW.includes(r)),
        ...deny,
      ];
    case "plan":
      return ["--permission-mode", "plan", ...deny];
    case "full":
      return ["--dangerously-skip-permissions", ...deny];
  }
}

/** First turn: `--sandbox` or the bypass flag. */
export function codexPermissionFlags(level: Permission): string[] {
  switch (level) {
    case "build":
      return ["--sandbox", "workspace-write"];
    case "plan":
      return ["--sandbox", "read-only"];
    case "full":
      return ["--dangerously-bypass-approvals-and-sandbox"];
  }
}

/** `codex exec resume` has no --sandbox flag (verified on 0.163.0): config key instead. */
export function codexResumePermissionFlags(level: Permission): string[] {
  switch (level) {
    case "build":
      return ["-c", 'sandbox_mode="workspace-write"'];
    case "plan":
      return ["-c", 'sandbox_mode="read-only"'];
    case "full":
      return ["--dangerously-bypass-approvals-and-sandbox"];
  }
}

/** OpenClaw: no permission flags (its exec profile fences tools to --cwd); plan is unsupported. */
export function openclawSupports(level: Permission): boolean {
  return level !== "plan";
}

/**
 * Claude `--settings` JSON: the PostToolUse steer hook and permissions.deny.
 * `--settings` merges onto the project's settings.
 */
export function claudeSettingsJson(o: { steerHookCommand?: string | null; deny?: string[] }): string {
  const settings: Record<string, unknown> = { permissions: { deny: o.deny ?? DENY_LIST } };
  if (o.steerHookCommand) {
    settings.hooks = { PostToolUse: [{ matcher: "", hooks: [{ type: "command", command: o.steerHookCommand }] }] };
  }
  return JSON.stringify(settings);
}

/** What the project's .claude/settings.json holds. */
export function projectClaudeSettings(): { permissions: { deny: string[] } } {
  return { permissions: { deny: [...DENY_LIST] } };
}
