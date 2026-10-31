// `search mcp-config`: the snippet that points an MCP client at Search's /mcp. The
// client does its own OAuth (DCR + PKCE) against Search the first time it connects,
// so no token ever goes into a config file.

export type McpClient = "claude-code" | "codex" | "claude-desktop" | "json";
export const MCP_CLIENTS: McpClient[] = ["claude-code", "codex", "claude-desktop", "json"];

export function mcpConfig(client: McpClient, server: string): string {
  const url = `${server.replace(/\/+$/, "")}/mcp`;
  switch (client) {
    case "claude-code":
      return [
        "# Claude Code: run this once (add --scope user to use it in every project)",
        `claude mcp add --transport http search ${url}`,
        "",
        "# or put this in .mcp.json at the root of a project",
        JSON.stringify({ mcpServers: { search: { type: "http", url } } }, null, 2),
        "",
        "# Then in Claude Code run /mcp, pick search and choose Authenticate.",
        "# Your browser opens Search's sign-in; Search must be running (search start).",
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
    case "claude-desktop":
      return [
        "# Claude Desktop: add this to claude_desktop_config.json (Settings, Developer, Edit Config).",
        "# mcp-remote bridges Desktop's local servers to Search's HTTP endpoint and runs the sign-in.",
        JSON.stringify({ mcpServers: { search: { command: "npx", args: ["-y", "mcp-remote", url] } } }, null, 2),
      ].join("\n");
    case "json":
      return JSON.stringify({ mcpServers: { search: { type: "http", url } } }, null, 2);
  }
}
