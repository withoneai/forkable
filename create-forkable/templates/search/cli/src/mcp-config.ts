// `search mcp-config`: the snippet that points an MCP client at Search's /mcp. The
// client does its own OAuth (DCR + PKCE) against Search the first time it connects,
// so no token ever goes into a config file. `search install <agent>` writes the
// same entries for you.

export type McpClient = "claude-code" | "codex" | "cursor" | "vscode" | "claude-desktop" | "json";
export const MCP_CLIENTS: McpClient[] = ["claude-code", "codex", "cursor", "vscode", "claude-desktop", "json"];

export interface McpConfigContext { node: string; bin: string }

export function mcpConfig(client: McpClient, server: string, ctx?: McpConfigContext): string {
  const base = server.replace(/\/+$/, "");
  const url = `${base}/mcp`;
  switch (client) {
    case "claude-code":
      return [
        "# Claude Code: run this once (user scope, so it works in every project)",
        `claude mcp add --scope user --transport http search ${url}`,
        "",
        "# Then in Claude Code type /mcp, pick search and choose Authenticate.",
        "# Your browser opens Search's sign-in; Search must be running.",
        "# Or let Search do it: pnpm run search install claude-code",
      ].join("\n");
    case "codex":
      return [
        "# Codex: run these once",
        `codex mcp add search --url ${url}`,
        "codex mcp login search",
        "",
        "# or add this to ~/.codex/config.toml, then run codex mcp login search",
        "[mcp_servers.search]",
        `url = "${url}"`,
      ].join("\n");
    case "cursor":
      return [
        "# Cursor: add this to ~/.cursor/mcp.json (or .cursor/mcp.json in a project),",
        "# then in Cursor open Settings, then MCP, and click Connect next to search.",
        "# Or let Search do it: pnpm run search install cursor",
        JSON.stringify({ mcpServers: { search: { url } } }, null, 2),
      ].join("\n");
    case "vscode":
      return [
        "# VS Code: add this to .vscode/mcp.json in a project (or run MCP: Open User Configuration),",
        "# then start the server from that file and allow the sign-in.",
        JSON.stringify({ servers: { search: { type: "http", url } } }, null, 2),
        "",
        "# or in one line:",
        `code --add-mcp '${JSON.stringify({ name: "search", type: "http", url })}'`,
      ].join("\n");
    case "claude-desktop": {
      const command = ctx?.node ?? "node";
      const args = [ctx?.bin ?? "<the Search folder>/cli/bin/search.mjs", "mcp", "--server", base, "--as", "claude-desktop"];
      return [
        "# Claude Desktop: add this to claude_desktop_config.json (Settings, Developer, Edit Config),",
        "# then quit and reopen Claude Desktop. Your browser opens once to allow it.",
        "# Or let Search do it: pnpm run search install claude-desktop",
        JSON.stringify({ mcpServers: { search: { command, args } } }, null, 2),
      ].join("\n");
    }
    case "json":
      return JSON.stringify({ mcpServers: { search: { type: "http", url } } }, null, 2);
  }
}
