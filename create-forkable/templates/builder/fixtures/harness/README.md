# Harness fixtures

Recorded or seeded CLI output for the parser tests in `packages/harness/test`.

| File | Source |
|---|---|
| `claude/write-bash-mcp.jsonl` | real, Claude Code 2.1.306, Haiku, 2026-10-24: minted `--session-id`, a stub `builder` MCP server (connected), a `--settings` PostToolUse hook, a Write and a Bash call, `--include-partial-messages --include-hook-events` |
| `claude/resume.jsonl` | real, `-r <that session>`: the same session id comes back |
| `claude/resume-missing.jsonl` | real, `-r` with an unknown id: exit 1, `errors: ["No conversation found ..."]` |
| `claude/denied.jsonl` | real, `curl` on the deny list: `system/permission_denied` and `result.permission_denials` |
| `claude/seed-stream.jsonl`, `signed-out.jsonl` | hand-written (MCP failed init, retry, rate limit, ghost result id) |
| `codex/write-mcp.jsonl` | real, codex-cli 0.163.0, `--sandbox workspace-write`, MCP server via `-c` with `default_tools_approval_mode="approve"` (the MCP child reached 127.0.0.1) |
| `codex/resume.jsonl` | real, `codex exec resume <id> -c sandbox_mode="workspace-write" -` |
| `codex/mcp-approval-failed.jsonl` | real output, retyped: without the approval key, `exec` refuses every MCP call ("requires approval, but approval policy is never"); shell `curl` to loopback fails (sandbox has no network) |
| `codex/failed.jsonl` | hand-written |
| `openclaw/error-runtime-missing.json` | real, OpenClaw 2026.8.1 on this machine: the configured runtime plugin is missing |
| `openclaw/ok-synthetic.json` | hand-written from the documented envelope fields (no successful run was possible here) |

Local paths were rewritten to `/Users/acme`.
