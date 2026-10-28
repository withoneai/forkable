import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { App } from "./App";
import { ContributePage } from "./components/contribute/ContributePage";
import { McpPage } from "./components/mcp/McpPage";

// Build-time prerender (scripts/prerender.mjs): the HTML an agent or a plain
// fetch gets, with the real copy, template cards and commands in it. The
// client then hydrates the same tree (main.tsx, contribute.tsx, mcp.tsx).
export function render(page: "home" | "contribute" | "mcp"): string {
  const tree = page === "home" ? <App /> : page === "mcp" ? <McpPage /> : <ContributePage />;
  return renderToString(<StrictMode>{tree}</StrictMode>);
}
