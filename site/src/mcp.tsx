import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import "./index.css";
import { McpPage } from "./components/mcp/McpPage";

const root = document.getElementById("root")!;
const tree = (
  <StrictMode>
    <McpPage />
  </StrictMode>
);
// Prerendered at build time (scripts/prerender.mjs); `pnpm dev` serves an
// empty root, so fall back to a plain render there.
if (root.hasChildNodes()) hydrateRoot(root, tree);
else createRoot(root).render(tree);
